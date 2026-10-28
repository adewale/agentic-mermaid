import { afterAll, describe, expect, test } from 'bun:test'
import { applyOps, buildMermaid, createMermaid, mutate, parseRegisteredMermaid as parseMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { getFamily, replaceFamilyForTest, BUILTIN_FAMILY_METADATA, type BuiltinFamilyId } from '../agent/families.ts'
import type { DiagramKind } from '../agent/types.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { applyMutationBatch } from '../agent/mutate.ts'

// One long-lived pinned-Mermaid child is the oracle for every blank below.
const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

// Derived from the registry, so a new family is enrolled here automatically.
const ALL_KINDS: BuiltinFamilyId[] = BUILTIN_FAMILY_METADATA.map(f => f.id)

// What verify says about the blank diagram createMermaid returns. Mindmap
// grammar requires a root, so its blank slate carries a placeholder root node.
const BLANK_VERIFY = {
  packet: 'EMPTY_DIAGRAM',
  kanban: 'EMPTY_DIAGRAM',
  requirement: 'EMPTY_DIAGRAM',
  treemap: 'EMPTY_DIAGRAM',
  ishikawa: 'EMPTY_DIAGRAM',
  block: 'EMPTY_DIAGRAM',
  flowchart: 'EMPTY_DIAGRAM',
  state: 'EMPTY_DIAGRAM',
  sequence: 'EMPTY_DIAGRAM',
  timeline: 'EMPTY_DIAGRAM',
  class: 'EMPTY_DIAGRAM',
  er: 'EMPTY_DIAGRAM',
  journey: 'EMPTY_DIAGRAM',
  architecture: 'EMPTY_DIAGRAM',
  xychart: 'EMPTY_DIAGRAM',
  pie: 'EMPTY_DIAGRAM',
  quadrant: 'EMPTY_DIAGRAM',
  gantt: 'EMPTY_DIAGRAM',
  mindmap: 'placeholder root',
  gitgraph: 'EMPTY_DIAGRAM',
  radar: 'EMPTY_DIAGRAM',
  sankey: 'EMPTY_DIAGRAM',
  zenuml: 'EMPTY_DIAGRAM',
  eventmodeling: 'EMPTY_DIAGRAM',
  c4: 'EMPTY_DIAGRAM',
} as const satisfies Record<BuiltinFamilyId, 'EMPTY_DIAGRAM' | 'placeholder root'>

describe('createMermaid', () => {
  for (const kind of ALL_KINDS) {
    test(`returns a blank STRUCTURED ${kind} body that verify reports as ${BLANK_VERIFY[kind]}`, () => {
      const d = createMermaid(kind)
      expect({ kind: d.kind, body: d.body.kind }).toEqual({ kind, body: kind })
      const codes = verifyMermaid(d).warnings.map(w => w.code)
      if (BLANK_VERIFY[kind] === 'EMPTY_DIAGRAM') expect(codes).toContain('EMPTY_DIAGRAM')
      else expect({ codes, serialized: serializeMermaid(d) }).toEqual({ codes: [], serialized: 'mindmap\n  root\n' })
    })
  }
  test('serializes to the family header', () => {
    expect(serializeMermaid(createMermaid('flowchart'))).toStartWith('flowchart TD')
    expect(serializeMermaid(createMermaid('er'))).toStartWith('erDiagram')
    expect(serializeMermaid(createMermaid('quadrant'))).toStartWith('quadrantChart')
  })
  test('direction option applies to flowchart and state', () => {
    expect(serializeMermaid(createMermaid('flowchart', { direction: 'LR' }))).toStartWith('flowchart LR')
    const s = createMermaid('state', { direction: 'LR' })
    expect(s.body.kind === 'state' && s.body.direction).toBe('LR')
  })
  test('created diagrams feed straight into mutate', () => {
    const d = createMermaid('pie')
    const r = mutate(d, { kind: 'add_slice', label: 'A', value: 5 })
    expect(r.ok && serializeMermaid(r.value)).toBe('pie\n  "A" : 5\n')
  })
  test('unknown kind fails loudly', () => {
    expect(() => createMermaid('nonsense' as DiagramKind)).toThrow(/unknown diagram kind/)
  })
})

function renders(source: string): boolean {
  try {
    renderMermaidSVG(source)
    return true
  } catch {
    return false
  }
}

// A saved blank must read back the way pinned Mermaid reads it: typed and
// renderable where Mermaid accepts the bare header, and rejected through the
// family's opaque fallback where Mermaid rejects it (a Sankey needs a link).
// A Gantt with no tasks draws an empty chart while verify retains the
// EMPTY_DIAGRAM diagnostic checked above; it needs no invented time range.
// Read generously: Mermaid rejects bare class and C4 headers, but their meaning
// (an empty diagram) is clear, so ours reads them typed and draws them, and
// verify says Mermaid rejects it (upstream-rejection-parity.test.ts).
const BLANK_GENEROUS_READS: ReadonlySet<BuiltinFamilyId> = new Set(['class', 'c4', 'kanban', 'requirement', 'treemap', 'ishikawa'])

describe('a blank diagram survives a save wherever Mermaid accepts it', () => {
  for (const kind of ALL_KINDS) {
    test(`${kind}: serialize -> parse -> render agrees with Mermaid on the blank`, async () => {
      const source = serializeMermaid(createMermaid(kind))
      const read = (await upstream.parse(source)).ok || BLANK_GENEROUS_READS.has(kind)
      const reparsed = parseMermaid(source)
      expect({ source, reparsed: reparsed.ok && reparsed.value.body.kind, renders: renders(source) }).toEqual({ source, reparsed: read ? kind : 'opaque', renders: read })
    })
  }

  // Header furniture is not content: these blanks carry a header tail or a
  // title and still have nothing to plot.
  test.each<[BuiltinFamilyId, string]>([
    ['pie', 'pie showData\n'],
    ['pie', 'pie title Pets\n'],
    ['xychart', 'xychart-beta horizontal\n'],
    ['xychart', 'xychart-beta\n  title Sales\n'],
    ['radar', 'radar-beta\n  title Skills\n'],
    ['state', 'stateDiagram-v2\n  direction LR\n'],
  ])('%s blank %j that Mermaid accepts parses typed and renders', async (kind, source) => {
    const reparsed = parseMermaid(source)
    expect({ upstream: (await upstream.parse(source)).ok, reparsed: reparsed.ok && reparsed.value.body.kind, renders: renders(source) }).toEqual({ upstream: true, reparsed: kind, renders: true })
  })
})

describe('buildMermaid', () => {
  test('flowchart from ops round-trips and verifies', () => {
    const r = buildMermaid(
      'flowchart',
      [
        { kind: 'add_node', id: 'A', label: 'Start' },
        { kind: 'add_node', id: 'B', label: 'End' },
        { kind: 'add_edge', from: 'A', to: 'B', label: 'go' },
      ],
      { direction: 'LR' },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const src = serializeMermaid(r.value)
    expect(src).toBe('flowchart LR\n  A[Start] -->|go| B[End]\n')
    const reparsed = parseMermaid(src)
    expect(reparsed.ok && reparsed.value.body.kind).toBe('flowchart')
    expect(verifyMermaid(r.value).ok).toBe(true)
  })
  test('every family can be authored from a blank slate', () => {
    const cases = Object.entries({
      flowchart: [
        { kind: 'add_node', id: 'A', label: 'A' },
        { kind: 'add_edge', from: 'A', to: 'B' },
      ],
      state: [
        { kind: 'add_state', id: 'Idle' },
        { kind: 'add_transition', from: '[*]', to: 'Idle' },
      ],
      sequence: [
        { kind: 'add_participant', id: 'A' },
        { kind: 'add_participant', id: 'B' },
        { kind: 'add_message', from: 'A', to: 'B', text: 'hi' },
      ],
      timeline: [
        { kind: 'add_section', label: 'S' },
        { kind: 'add_period', sectionIndex: 0, label: '2024', events: ['e1'] },
      ],
      class: [{ kind: 'add_class', id: 'Animal', members: ['+name: string'] }],
      er: [
        { kind: 'add_entity', id: 'USER' },
        { kind: 'add_entity', id: 'ORDER' },
        { kind: 'add_relation', from: 'USER', to: 'ORDER', leftCard: 'one-only', rightCard: 'zero-or-many' },
      ],
      journey: [
        { kind: 'set_title', title: 'J' },
        { kind: 'add_section', label: 'S' },
        { kind: 'add_task', sectionIndex: 0, text: 't', score: 3 },
      ],
      architecture: [
        { kind: 'add_service', id: 'api', label: 'API' },
        { kind: 'add_service', id: 'db', label: 'DB' },
        { kind: 'add_edge', from: 'api', to: 'db', fromSide: 'R', toSide: 'L' },
      ],
      xychart: [
        { kind: 'set_title', title: 'X' },
        { kind: 'add_series', kind2: 'bar', values: [1, 2, 3] },
      ],
      pie: [{ kind: 'add_slice', label: 'A', value: 3 }],
      quadrant: [{ kind: 'add_point', label: 'p', x: 0.5, y: 0.5 }],
      gantt: [
        { kind: 'add_section', label: 'S' },
        { kind: 'add_task', sectionIndex: 0, label: 'T1', start: '2026-01-01', end: '3d' },
      ],
      mindmap: [{ kind: 'add_node', id: 'Idea', label: 'Idea', parent: 'root' }],
      gitgraph: [
        { kind: 'append_commit', id: 'c1' },
        { kind: 'create_branch', name: 'dev' },
        { kind: 'append_commit', id: 'c2' },
      ],
      radar: [
        { kind: 'add_axis', id: 'a', label: 'A' },
        { kind: 'add_axis', id: 'b', label: 'B' },
        { kind: 'add_axis', id: 'c', label: 'C' },
        { kind: 'add_curve', id: 'x', label: 'X', values: [1, 2, 3] },
      ],
      sankey: [{ kind: 'add_link', source: 'Coal', target: 'Power', value: 5 }],
      c4: [
        { kind: 'add_element', element: { id: 'client', label: 'Client', kind: 'person' } },
        { kind: 'add_element', element: { id: 'api', label: 'API', kind: 'system' } },
        { kind: 'add_relationship', relationship: { from: 'client', to: 'api', label: 'Calls' } },
      ],
      zenuml: [{ kind: 'insert_statement', statement: { kind: 'message', id: 'greeting', from: 'A', to: 'B', label: 'hi', reply: false } }],
      eventmodeling: [{ kind: 'insert_frame', frame: { id: '01', reset: false, type: 'ui', entity: 'CartUI', sources: [] } }],
      packet: [
        { kind: 'add_field', label: 'Port', bits: 16 },
        { kind: 'add_field', label: 'Payload', bits: 32 },
      ],
      kanban: [
        { kind: 'add_column', id: 'Todo', label: 'To do' },
        { kind: 'add_task', column: 'Todo', id: 'task', label: 'Implement' },
      ],
      requirement: [
        { kind: 'add_requirement', requirement: { name: 'speed', text: 'Respond quickly' } },
        { kind: 'add_element', element: { name: 'suite', type: 'test' } },
        { kind: 'add_relation', relation: { src: 'suite', dst: 'speed', type: 'verifies' } },
      ],
      treemap: [
        { kind: 'add_node', label: 'Build', value: 60 },
        { kind: 'add_node', label: 'Learn', value: 40 },
      ],
      ishikawa: [
        { kind: 'set_effect', label: 'Delay' },
        { kind: 'add_cause', label: 'Process' },
      ],
      block: [
        { kind: 'set_columns', columns: 2 },
        { kind: 'add_block', block: { id: 'api', label: 'API' } },
        { kind: 'add_block', block: { id: 'db', label: 'Store' } },
        { kind: 'add_edge', from: 'api', to: 'db' },
      ],
    } satisfies Record<BuiltinFamilyId, object[]>) as Array<[BuiltinFamilyId, object[]]>
    // Authored facts are independent of the registry and the writer under test.
    const expectedContent = {
      zenuml: ['A->B: hi'],
      eventmodeling: ['tf 01 ui CartUI'],
      flowchart: ['A --> B'],
      state: ['[*] --> Idle'],
      sequence: ['A->>B: hi'],
      timeline: ['2024 : e1'],
      class: ['Animal', '+name: string'],
      er: ['USER ||--o{ ORDER'],
      journey: ['title J', 'section S', 't: 3'],
      architecture: ['service api', 'service db', 'api:R --> L:db'],
      xychart: ['title X', 'bar [1, 2, 3]'],
      pie: ['"A" : 3'],
      quadrant: ['p: [0.5, 0.5]'],
      gantt: ['T1', '2026-01-01', '3d'],
      mindmap: ['root', 'Idea'],
      gitgraph: ['id:"c1"', 'dev', 'id:"c2"'],
      radar: ['{1, 2, 3}', 'A', 'B', 'C', 'X'],
      sankey: ['Coal,Power,5'],
      c4: ['Client', 'API', 'Calls'],
      packet: ['0-15: "Port"', '16-47: "Payload"'],
      kanban: ['Todo["To do"]', 'task["Implement"]'],
      requirement: ['Respond quickly', '"suite" - verifies -> "speed"'],
      treemap: ['"Build": 60', '"Learn": 40'],
      ishikawa: ['\nDelay\n  Process'],
      block: ['columns 2', 'API', 'Store'],
    } satisfies Record<BuiltinFamilyId, string[]>
    for (const [kind, ops] of cases) {
      const r = buildMermaid(kind, ops as never[])
      if (!r.ok) throw new Error(`${kind}: ${JSON.stringify(r.error)}`)
      const source = serializeMermaid(r.value)
      for (const fragment of expectedContent[kind]) expect({ kind, source }).toMatchObject({ source: expect.stringContaining(fragment) })
      const reparsed = parseMermaid(source)
      expect({ kind, reparsed: reparsed.ok && reparsed.value.body.kind }).toEqual({ kind, reparsed: kind })
    }
  })
  test('a failing op reports its index', () => {
    const r = buildMermaid('pie', [
      { kind: 'add_slice', label: 'A', value: 3 },
      { kind: 'set_slice_value', label: 'missing', value: 1 },
    ])
    expect(!r.ok && r.error.opIndex).toBe(1)
    expect(!r.ok && r.error.code).toBe('SLICE_NOT_FOUND')
  })
})

describe('structured-floor relaxation (build-up from empty)', () => {
  test('journey: ops may keep an EMPTY body empty while building up', () => {
    const d = createMermaid('journey')
    const r = mutate(d, { kind: 'set_title', title: 'T' })
    expect(r.ok).toBe(true)
  })
  test('journey: an emptied and reloaded journey can reuse its named section', () => {
    const built = buildMermaid('journey', [
      { kind: 'set_title', title: 'J' },
      { kind: 'add_section', label: 'S' },
      { kind: 'add_task', sectionIndex: 0, text: 't', score: 3 },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const r = mutate(built.value, { kind: 'remove_task', sectionIndex: 0, taskIndex: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reloaded = parseMermaid(serializeMermaid(r.value))
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    const filled = mutate(reloaded.value, { kind: 'add_task', sectionIndex: 0, text: 'Next', score: 5, actors: ['Me'] })
    expect(filled.ok && serializeMermaid(filled.value)).toBe('journey\n  title J\n  section S\n    Next: 5: Me\n')
    expect(filled.ok && verifyMermaid(filled.value).ok).toBe(true)
  })
  test('xychart: ops may keep an EMPTY body empty while building up', () => {
    const d = createMermaid('xychart')
    const r = mutate(d, { kind: 'set_title', title: 'T' })
    expect(r.ok).toBe(true)
  })
  test('xychart: an emptied and reloaded chart can replace its series', () => {
    const built = buildMermaid('xychart', [
      { kind: 'set_title', title: 'X' },
      { kind: 'add_series', kind2: 'bar', values: [1] },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const r = mutate(built.value, { kind: 'remove_series', index: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reloaded = parseMermaid(serializeMermaid(r.value))
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    const filled = mutate(reloaded.value, { kind: 'add_series', kind2: 'line', values: [2, 3] })
    expect(filled.ok && serializeMermaid(filled.value)).toBe('xychart-beta\n  title X\n  line [2, 3]\n')
    expect(filled.ok && verifyMermaid(filled.value).ok).toBe(true)
  })
})

describe('ER label-less relation round-trip', () => {
  test('add_relation without label serializes to a form that re-parses structured', () => {
    const r = buildMermaid('er', [
      { kind: 'add_entity', id: 'USER' },
      { kind: 'add_entity', id: 'ORDER' },
      { kind: 'add_relation', from: 'USER', to: 'ORDER', leftCard: 'one-only', rightCard: 'zero-or-many' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const src = serializeMermaid(r.value)
    expect(src).toContain('USER ||--o{ ORDER : ""')
    const reparsed = parseMermaid(src)
    expect(reparsed.ok && reparsed.value.body.kind).toBe('er')
    if (reparsed.ok && reparsed.value.body.kind === 'er') {
      expect(reparsed.value.body.relations[0]!.label).toBeUndefined()
    }
  })
})


test('a checked batch commits once and an invalid operation emits no partial source', () => {
  const descriptor = getFamily('flowchart')!
  let parses = 0
  const restore = replaceFamilyForTest('flowchart', { ...descriptor, parse: context => { parses++; return descriptor.parse!(context) } })
  try {
    const source = 'flowchart LR\n A --> B'
    const ops = Array.from({ length: 12 }, (_, index) => ({ kind: 'add_node', id: `Extra${index}`, label: `Extra ${index}` }))
    const result = applyOps({ source, ops })
    expect(result.ok).toBe(true)
    // Input admission, transaction closure and final faithfulness verification;
    // the parse budget must not grow with the number of operations.
    expect(parses).toBeLessThanOrEqual(3)
    if (result.ok) for (let index = 0; index < 12; index++) expect(result.source).toContain(`Extra ${index}`)
    const rejected = applyOps({ source, ops: [...ops, { kind: 'remove_node', id: 'absent' }] })
    expect(rejected).toMatchObject({ ok: false, opIndex: 12 })
    expect('source' in rejected).toBe(false)
  } finally { restore() }
})

test('owned Flowchart batches isolate inputs, failures and subsequent single edits', () => {
  const parsed = parseMermaid('flowchart LR\n A[Original] --> B[Other]')
  if (!parsed.ok || parsed.value.body.kind !== 'flowchart') throw Error('Expected Flowchart')
  const original = serializeMermaid(parsed.value)
  const ops = [{ kind: 'set_label', target: 'A', label: 'Changed' }, { kind: 'add_node', id: 'C', label: 'Third' }]
  const failed = applyMutationBatch(parsed.value, [...ops, { kind: 'add_node', id: 'Partial', label: 'Discard', parent: 'absent' }])
  expect(failed).toMatchObject({ ok: false, error: { opIndex: 2 } })
  expect(serializeMermaid(parsed.value)).toBe(original)
  const edited = applyMutationBatch(parsed.value, ops)
  if (!edited.ok || edited.value.body.kind !== 'flowchart') throw Error('Expected successful batch')
  expect([...edited.value.body.graph.nodes.keys()]).toEqual(['A', 'B', 'C'])
  expect(edited.value.body.graph.nodes.get('A')!.label).toBe('Changed')
  const saved = serializeMermaid(edited.value)
  const next = mutate(edited.value, { kind: 'rename_node', from: 'C', to: 'Next' })
  expect(next.ok).toBe(true)
  expect(serializeMermaid(edited.value)).toBe(saved)
  expect(serializeMermaid(parsed.value)).toBe(original)
  const empty = applyMutationBatch(parsed.value, [])
  expect(empty.ok && empty.value).toBe(parsed.value)
})

test('owned Sequence batches refold participant order and message references between operations', () => {
  const parsed = parseMermaid('sequenceDiagram\n A->>B: one\n %% preserve this\n B->>C: two\n C->>A: three')
  if (!parsed.ok || parsed.value.body.kind !== 'sequence') throw Error('Expected Sequence')
  const original = serializeMermaid(parsed.value)
  const ops = [
    { kind: 'remove_message', index: 0 },
    { kind: 'add_message', index: 0, from: 'D', to: 'C', text: 'first' },
    { kind: 'set_message_text', index: 2, text: 'last' },
  ]
  const failed = applyMutationBatch(parsed.value, [...ops, { kind: 'remove_message', index: 99 }])
  expect(failed).toMatchObject({ ok: false, error: { opIndex: 3 } })
  expect(serializeMermaid(parsed.value)).toBe(original)
  const edited = applyMutationBatch(parsed.value, ops)
  if (!edited.ok || edited.value.body.kind !== 'sequence') throw Error('Expected successful batch')
  expect(edited.value.body.participants.map(actor => actor.id)).toEqual(['D', 'C', 'B', 'A'])
  expect(edited.value.body.messages.map(message => [message.from, message.to, message.text])).toEqual([
    ['D', 'C', 'first'], ['B', 'C', 'two'], ['C', 'A', 'last'],
  ])
  const saved = serializeMermaid(edited.value)
  expect(saved).toContain('%% preserve this')
  const reloaded = parseMermaid(saved)
  if (!reloaded.ok || reloaded.value.body.kind !== 'sequence') throw Error('Expected Sequence after commit')
  expect(reloaded.value.body.participants).toEqual(edited.value.body.participants)
  expect(reloaded.value.body.messages.map(message => [message.from, message.to, message.text])).toEqual([
    ['D', 'C', 'first'], ['B', 'C', 'two'], ['C', 'A', 'last'],
  ])
  expect(serializeMermaid(reloaded.value)).toBe(saved)
  expect(mutate(edited.value, { kind: 'remove_participant', id: 'B' }).ok).toBe(true)
  expect(serializeMermaid(edited.value)).toBe(saved)
  expect(serializeMermaid(parsed.value)).toBe(original)
})
