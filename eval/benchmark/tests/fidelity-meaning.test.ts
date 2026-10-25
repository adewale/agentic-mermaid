import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyMeaningFailure, createMeaningAdapter, normalizeMeaning } from '../fidelity/adapters.ts'
import { assessMeaning, type AuthoredFidelityCase, type NormalizedMeaning } from '../fidelity/meaning.ts'

const witness: AuthoredFidelityCase = {
  id: 'owned-relationships', family: 'flowchart', required: true, source: 'flowchart LR\nA[Alpha]-->B[Beta]\nA-->B\nB-->A', features: ['parallel-reciprocal'], provenance: 'Independent authored expectation',
  expected: { labels: ['Alpha', 'Beta'], nodes: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }], edges: [{ source: 'A', target: 'B', directed: true }, { source: 'A', target: 'B', directed: true }, { source: 'B', target: 'A', directed: true }], groups: [{ id: 'G', label: 'Group', members: ['A', 'B'] }], facts: { direction: 'LR' } },
}
const valid = (): NormalizedMeaning => ({ family: 'flowchart', nodes: structuredClone(witness.expected.nodes), edges: structuredClone(witness.expected.edges), groups: structuredClone(witness.expected.groups), facts: { direction: 'LR' }, unavailable: {} })

test('semantic admission rejects wrong endpoints, collapsed parallel edges, direction loss, identity relabeling and wrong immediate ownership', () => {
  expect(assessMeaning(witness, valid()).passed).toBe(true)
  const mutations = [
    (m: NormalizedMeaning) => { m.edges![0]!.target = 'C' },
    (m: NormalizedMeaning) => { m.edges!.pop() },
    (m: NormalizedMeaning) => { m.edges!.splice(0, 1) },
    (m: NormalizedMeaning) => { m.edges![0]!.directed = false },
    (m: NormalizedMeaning) => { m.nodes![0]!.label = 'Beta'; m.nodes![1]!.label = 'Alpha' },
    (m: NormalizedMeaning) => { m.groups![0]!.members = ['A'] },
    (m: NormalizedMeaning) => { m.nodes!.push({ id: 'A', label: 'Alpha' }) },
    (m: NormalizedMeaning) => { m.nodes![0]!.id = ' A ' },
  ]
  for (const mutate of mutations) { const model = valid(); mutate(model); expect(assessMeaning(witness, model).passed).toBe(false) }
})

test('missing evidence cannot pass, while available wrong values fail separately from unavailable projections', () => {
  const model = valid(); delete model.facts.direction
  expect(assessMeaning(witness, model)).toMatchObject({ complete: false, passed: false })
  expect(assessMeaning(witness, model).checks.find(check => check.criterion === 'fact:direction')?.status).toBe('unavailable')
  model.facts.direction = 'TB'
  expect(assessMeaning(witness, model)).toMatchObject({ complete: true, passed: false })
  expect(assessMeaning(witness, model).checks.find(check => check.criterion === 'fact:direction')?.status).toBe('failed')
  expect(assessMeaning(witness).checks.every(check => check.status === 'unavailable')).toBe(true)
})

test('numeric values and relationship markers remain independently checked even when all labels survive', () => {
  const source = { family: 'er', expected: { labels: ['User', 'Order'], edges: [{ source: 'User', target: 'Order', directed: false, startMarker: 'one-only', endMarker: 'zero-or-many' }], facts: { links: [{ value: 7 }] } } }
  const observed: NormalizedMeaning = { family: 'er', edges: [{ source: 'User', target: 'Order', directed: false, startMarker: 'one-only', endMarker: 'zero-or-many' }], facts: { links: [{ value: 7 }] }, unavailable: {} }
  expect(assessMeaning(source, observed).passed).toBe(true)
  observed.edges![0]!.endMarker = 'one-only'
  expect(assessMeaning(source, observed).checks.find(check => check.criterion === 'relationships')?.status).toBe('failed')
  observed.facts.links = [{ value: 70 }]
  expect(assessMeaning(source, observed).checks.find(check => check.criterion === 'fact:links')?.status).toBe('failed')
})

test('reviewed public model projections preserve nesting and sequence order without reparsing authored input', () => {
  const graph = normalizeMeaning('agentic', 'flowchart', { graph: { nodes: new Map([['A', { label: 'Alpha' }], ['B', { label: 'Beta' }]]), edges: [], direction: 'LR', subgraphs: [{ id: 'Outer', label: 'Outer', nodeIds: [], children: [{ id: 'Inner', label: 'Inner', nodeIds: ['A', 'B'], children: [] }] }] } })
  expect(graph.groups).toEqual([{ id: 'Outer', label: 'Outer', members: ['Inner'] }, { id: 'Inner', label: 'Inner', members: ['A', 'B'] }])
  const sequence = normalizeMeaning('agentic', 'sequence', { participants: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }], messages: [{ from: 'B', to: 'A', text: 'Finish', arrow: '-->>' }], statements: [{ kind: 'fragment', fragment: { fragmentKind: 'loop', label: 'Retry', branches: [{ messages: [{ from: 'A', to: 'B', text: 'Request', arrow: '->>' }] }] } }, { kind: 'message', ref: 0 }, { kind: 'opaque-block', lines: ['Note over A,B: Remember'] }] })
  expect(sequence.facts['message-order']).toEqual([{ from: 'A', to: 'B', text: 'Request' }, { from: 'B', to: 'A', text: 'Finish' }])
  expect(sequence.facts.notes).toBeUndefined()
  expect(sequence.unavailable['fact:notes']).toContain('source-preserved')
})

test('Mermaid public Event Modeling getter transport preserves actual frame identities and endpoints', () => {
  const frame = (name: string, entityIdentifier: string) => ({ frame: { name, entityIdentifier } })
  const first = frame('01', 'CartUI'), second = frame('02', 'AddItem')
  const observed = normalizeMeaning('mermaid', 'eventmodeling', { getState: () => ({ boxes: [first, second], relations: [{ sourceBox: first, targetBox: second }] }) })
  expect(observed.nodes).toEqual([{ id: '01', label: 'CartUI' }, { id: '02', label: 'AddItem' }])
  expect(observed.edges).toEqual([{ source: '01', target: '02', directed: true, label: '' }])
  expect(observed.facts['frame-order']).toEqual(['CartUI', 'AddItem'])
})

test('declared unordered fact collections allow authored rename order changes without discarding duplicates', () => {
  const source = { family: 'quadrant', expected: { labels: ['Renamed', 'Beta'], unorderedFacts: ['points'], facts: { points: [{ label: 'Renamed', x: .2 }, { label: 'Beta', x: .8 }, { label: 'Beta', x: .8 }] } } }
  const model: NormalizedMeaning = { family: 'quadrant', facts: { points: [{ label: 'Beta', x: .8 }, { label: 'Beta', x: .8 }, { label: 'Renamed', x: .2 }] }, unavailable: {} }
  expect(assessMeaning(source, model).passed).toBe(true)
  ;(model.facts.points as unknown[]).shift()
  expect(assessMeaning(source, model).passed).toBe(false)
})

test('actual adapter family and public serializer return are observed rather than supplied by the requested case', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fidelity-public-return-'))
  try {
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'agentic-mermaid', version: '0.4.2', type: 'module' }))
    writeFileSync(join(root, 'dist/agent-core.js'), 'export function parseRegisteredMermaid(source){if(source==="opaque")return {ok:true,value:{body:{kind:"opaque",source}}};let reads=0;return {ok:true,value:{body:{kind:"class",get classes(){reads++;return [{id:"C",members:[]}]},projectionReads:()=>reads,relations:[],notes:[]}}}};export function serializeMermaid(){return "classDiagram\\nclass C"}')
    const adapter = await createMeaningAdapter({ tool: 'agentic', packageRoot: root })
    const raw = await adapter.acquireRaw('flowchart LR\nA-->B', 'flowchart')
    expect(raw.publicAccepted).toBe(true)
    expect(raw.raw.projectionReads()).toBe(0)
    expect(await adapter.acquireRaw('opaque', 'flowchart')).toMatchObject({ status: 'unsupported', publicAccepted: true })
    const result = await adapter.parse('flowchart LR\nA-->B', 'flowchart')
    expect(result.meaning?.family).toBe('class')
    expect(assessMeaning(witness, result.meaning).passed).toBe(false)
    expect(await adapter.serialize?.('classDiagram\nclass C')).toBe('classDiagram\nclass C')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('only reviewed source rejection earns negative credit; backend/resource faults retain unavailable evidence', () => {
  class PublicPeleError extends Error { constructor(public code: string, message: string) { super(message) } }
  expect(classifyMeaningFailure('pele', new PublicPeleError('syntax', 'Invalid source'), PublicPeleError)).toMatchObject({ status: 'rejected', publicAccepted: false })
  expect(classifyMeaningFailure('pele', new PublicPeleError('unsupported-diagram', 'Unknown header'), PublicPeleError)).toMatchObject({ status: 'unsupported', publicAccepted: false })
  for (const error of [new PublicPeleError('resource-limit', 'Parser source budget exceeded'), new Error('Parser backend failed'), new TypeError('Cannot read parser'), Object.assign(new Error('Parse error on line 2: backend was unavailable'), { name: 'TimeoutError' })]) expect(classifyMeaningFailure('pele', error, PublicPeleError)).toMatchObject({ status: 'unavailable', publicAccepted: null })
  expect(classifyMeaningFailure('mermaid', new Error('"dogs" has invalid value: -60.67. Negative values are not allowed in pie charts. All slice values must be >= 0.'))).toMatchObject({ status: 'rejected', publicAccepted: false })
  expect(classifyMeaningFailure('mermaid', new Error('Backend reports invalid value: -60.67. Negative values are not allowed'))).toMatchObject({ status: 'unavailable', publicAccepted: null })
})
