import { expect, test } from 'bun:test'
import { layoutMermaid, parseRegisteredMermaid, renderMermaidSVGWithReceipt } from '../agent/core.ts'
import { GraphLayoutUnsupportedError } from '../layout/backend.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import type { GraphLayoutHints } from '../types.ts'

const SOURCE = 'flowchart LR\n A --> B\n A --> C\n B --> D\n C --> D\n A --> D'

function layout(source: string, layoutHints?: GraphLayoutHints) {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse failed')
  return layoutMermaid(parsed.value, { layoutHints })
}

test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'])('rank preferences retain every relationship: %s', header => {
  const source = SOURCE.replace('flowchart LR', header)
  const out = layout(source, { ranks: { A: 0, B: 1, C: 2, D: 3 }, shortEdges: ['A->D'] })
  const x = (id: string) => out.nodes.find(node => node.id === id)!.x
  expect(x('A')).toBeLessThan(x('B'))
  expect(x('B')).toBeLessThan(x('C'))
  expect(x('C')).toBeLessThan(x('D'))
  expect(out.edges.map(edge => `${edge.from}->${edge.to}`).sort()).toEqual(['A->B', 'A->C', 'A->D', 'B->D', 'C->D'])
})

test('adjacency changes sibling order without editing source', () => {
  const out = layout(SOURCE, { adjacent: [['C', 'B']] })
  expect(out.nodes.find(node => node.id === 'C')!.y).toBeLessThan(out.nodes.find(node => node.id === 'B')!.y)
  expect(out.edges).toHaveLength(5)
})

test.each(['A->B', 'A->B#0', 'A->B#1'])('short-edge preferences accept duplicate-edge occurrence %s', id => {
  const out = layout('flowchart LR\n A --> B\n A --> B', { shortEdges: [id] })
  expect(out.edges).toHaveLength(2)
})

test.each([
  { ranks: { absent: 1 } },
  { adjacent: [['A', 'absent']] },
  { adjacent: [['B', 'C'], ['C', 'D']] },
  { shortEdges: ['absent'] },
])('invalid references refuse layout instead of silently ignoring hints: %j', hints => {
  expect(() => layout(SOURCE, hints)).toThrow('LAYOUT_HINT_INVALID')
})

test('hints participate in receipt identity and remain deterministic', () => {
  const hints = { ranks: { A: 0, B: 1, C: 2, D: 3 } }
  const plain = renderMermaidSVGWithReceipt(SOURCE)
  const first = renderMermaidSVGWithReceipt(SOURCE, { layoutHints: hints })
  const second = renderMermaidSVGWithReceipt(SOURCE, { layoutHints: hints })
  expect(first.svg).toBe(second.svg)
  expect(first.receipt.sharedRequestDigest).toBe(second.receipt.sharedRequestDigest)
  expect(first.receipt.sharedRequestDigest).not.toBe(plain.receipt.sharedRequestDigest)
})

// Native layout must not silently discard preferences introduced by ELK.
test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'].flatMap(header => [
  { header, hints: { ranks: { A: 0, B: 1, C: 2, D: 3 } } },
  { header, hints: { adjacent: [['C', 'B']] } },
  { header, hints: { shortEdges: ['A->D'] } },
]))('native selection declines active hints and explicit fallback retains them: %j', ({ header, hints }) => {
  const source = SOURCE.replace('flowchart LR', header)
  const stages: string[] = []
  expect(() => withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, {
    graphLayout: { backend: 'agentic' }, layoutHints: hints,
  }))).toThrow(GraphLayoutUnsupportedError)
  expect(stages).not.toContain('elk')
  const reference = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' }, layoutHints: hints })
  const fallback = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic', fallback: 'elk' }, layoutHints: hints })
  expect(fallback.svg).toBe(reference.svg)
  expect(fallback.receipt.layoutDecisions).toEqual([expect.objectContaining({
    requested: 'agentic', selected: 'elk', attempts: [
      { backend: 'agentic', outcome: 'unsupported', reason: 'layout hints' },
      { backend: 'elk', outcome: 'selected' },
    ],
  })])
})

test.each([{}, { ranks: {} }, { adjacent: [] }, { shortEdges: [] }])('empty hints retain native layout: %j', layoutHints => {
  const out = renderMermaidSVGWithReceipt(SOURCE, { graphLayout: { backend: 'agentic' }, layoutHints })
  expect(out.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
})

test('explicit fallback propagates invalid layout hints', () => {
  expect(() => renderMermaidSVGWithReceipt(SOURCE, {
    graphLayout: { backend: 'agentic', fallback: 'elk' }, layoutHints: { ranks: { absent: 1 } },
  })).toThrow('LAYOUT_HINT_INVALID')
})
