import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { asFlowchart, mutate, parseRegisteredMermaid, verifyMermaid } from '../agent/index.ts'
import { applyLayoutHints } from '../layout/layout-hints.ts'
import { findEdgeIndexById } from '../agent/flowchart-body.ts'
import type { ElkNode } from 'elkjs'
import { fcParameters } from './helpers/fc-parameters.ts'

function diagram(source = 'flowchart LR\n X --> Y\n A -->|first| B\n A -->|second| B') {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const flow = asFlowchart(parsed.value)
  if (!flow) throw new Error('expected structured Flowchart')
  return flow
}

function priorities(flow: ReturnType<typeof diagram>, id: string): number[] {
  const root: ElkNode = { id: 'root', edges: flow.body.graph.edges.map((edge, index) => ({ id: `e${index}`, sources: [edge.source], targets: [edge.target] })) }
  applyLayoutHints(root, flow.body.graph, { shortEdges: [id] })
  return root.edges!.flatMap((edge, index) => edge.layoutOptions?.['elk.layered.priority.shortness'] === '100' ? [index] : [])
}

test.each(['A->B', 'A->B#0', 'A->B#1'])('mutation and hints resolve the same exact edge occurrence: %s', id => {
  const flow = diagram()
  const expected = id.endsWith('#1') ? 2 : 1
  expect(priorities(flow, id)).toEqual([expected])
  const changed = mutate(flow, { kind: 'set_label', target: id, label: 'changed' })
  if (!changed.ok) throw new Error(JSON.stringify(changed.error))
  expect(changed.value.body.graph.edges.map(edge => edge.label)).toEqual([undefined, expected === 1 ? 'changed' : 'first', expected === 2 ? 'changed' : 'second'])
  const removed = mutate(flow, { kind: 'remove_edge', id })
  if (!removed.ok) throw new Error(JSON.stringify(removed.error))
  expect(removed.value.body.graph.edges.map(edge => edge.label)).toEqual([undefined, expected === 1 ? 'second' : 'first'])
})

test.each(['', '-1', '+1', '01', '1junk', '1.5', '0#2', '1e0', ' 1', '1\n'])('malformed occurrence #%j cannot select a valid prefix', suffix => {
  const flow = diagram()
  const id = `A->B#${suffix}`
  expect(mutate(flow, { kind: 'set_label', target: id, label: 'wrong' }).ok).toBe(false)
  expect(mutate(flow, { kind: 'remove_edge', id }).ok).toBe(false)
  expect(() => priorities(flow, id)).toThrow('LAYOUT_HINT_INVALID')
  expect(flow.body.graph.edges.map(edge => edge.label)).toEqual([undefined, 'first', 'second'])
})

test('generated interleaved graphs select exactly the requested relationship across APIs', () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom(['A', 'B'], ['B', 'A'], ['X', 'Y']), { minLength: 3, maxLength: 12 }),
    fc.nat(),
    (pairs, choice) => {
      const selected = choice % pairs.length
      const [from, to] = pairs[selected]!
      const occurrence = pairs.slice(0, selected).filter(([a, b]) => a === from && b === to).length
      const flow = diagram(`flowchart LR\n${pairs.map(([a, b], index) => ` ${a} edge_${index}@-->|L${index}| ${b}`).join('\n')}`)
      const aliases = [`edge_${selected}`, `${from}->${to}#${occurrence}`, ...(occurrence === 0 ? [`${from}->${to}`] : [])]
      for (const id of aliases) {
        expect(priorities(flow, id)).toEqual([selected])
        const changed = mutate(flow, { kind: 'set_label', target: id, label: 'changed' })
        if (!changed.ok) throw new Error(JSON.stringify(changed.error))
        expect(changed.value.body.graph.edges.map(edge => edge.label)).toEqual(pairs.map((_, index) => index === selected ? 'changed' : `L${index}`))
        const removed = mutate(flow, { kind: 'remove_edge', id })
        if (!removed.ok) throw new Error(JSON.stringify(removed.error))
        expect(removed.value.body.graph.edges.map(edge => edge.id)).toEqual(pairs.flatMap((_, index) => index === selected ? [] : [`edge_${index}`]))
      }
    },
  ), fcParameters({ numRuns: 150 }))
})

test('authored identity wins over an endpoint alias regardless of edge order', () => {
  for (const reverse of [false, true]) {
    const flow = diagram()
    flow.body.graph.edges[0]!.id = 'A->B#1'
    if (reverse) flow.body.graph.edges.reverse()
    const expected = reverse ? 2 : 0
    expect(priorities(flow, 'A->B#1')).toEqual([expected])
    // Graphs assembled through the layout API can carry identities that
    // cannot be written with the source grammar's edge-id token.
    expect(findEdgeIndexById(flow.body.graph, 'A->B#1')).toBe(expected)
  }
})

test('diagnostic edge references select the edge they describe after unrelated edges', () => {
  const flow = diagram('flowchart LR\n X --> Y\n A{choice} --> B\n A --> C\n A --> B')
  const result = verifyMermaid(flow)
  const duplicate = result.warnings.find(warning => warning.code === 'DUPLICATE_EDGE')
  if (!duplicate || duplicate.code !== 'DUPLICATE_EDGE') throw new Error('expected repeated-edge diagnosis')
  expect(duplicate.edge).toBe('A->B#1')
  expect(duplicate.duplicateOf).toBe('A->B#0')
  expect(result.warnings.filter(warning => warning.code === 'DECISION_BRANCH_UNLABELED').map(warning => warning.edge)).toEqual(['A->B#0', 'A->C#0', 'A->B#1'])
  const removed = mutate(flow, { kind: 'remove_edge', id: duplicate.edge })
  if (!removed.ok) throw new Error(JSON.stringify(removed.error))
  expect(removed.value.body.graph.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual(['X->Y', 'A->B', 'A->C'])
})

test('duplicate authored identities cannot make a diagnostic target the first edge twice', () => {
  const flow = diagram('flowchart LR\n X --> Y\n A same@--> B\n A same@--> B')
  const result = verifyMermaid(flow)
  const duplicate = result.warnings.find(warning => warning.code === 'DUPLICATE_EDGE')
  if (!duplicate || duplicate.code !== 'DUPLICATE_EDGE') throw new Error('expected repeated-edge diagnosis')
  expect(duplicate.duplicateOf).toBe('same')
  expect(duplicate.edge).toBe('A->B#1')
  expect(findEdgeIndexById(flow.body.graph, duplicate.duplicateOf)).toBe(1)
  expect(findEdgeIndexById(flow.body.graph, duplicate.edge)).toBe(2)
})
