import { expect, test } from 'bun:test'
import { layoutMermaid, parseRegisteredMermaid, renderMermaidSVGWithReceipt } from '../agent/core.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import type { GraphLayoutHints } from '../types.ts'

const SOURCE = 'flowchart LR\n A --> B\n A --> C\n B --> D\n C --> D\n A --> D'

function layout(source: string, layoutHints?: GraphLayoutHints, backend: 'elk' | 'agentic' = 'elk') {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse failed')
  return layoutMermaid(parsed.value, { layoutHints, graphLayout: { backend } })
}

test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'])('rank preferences retain every relationship: %s', header => {
  const source = SOURCE.replace('flowchart LR', header)
  for (const backend of ['elk', 'agentic'] as const) {
    const out = layout(source, { ranks: { A: 0, B: 1, C: 2, D: 3 }, shortEdges: ['A->D'] }, backend)
    const x = (id: string) => out.nodes.find(node => node.id === id)!.x
    expect(x('A')).toBeLessThan(x('B'))
    expect(x('B')).toBeLessThan(x('C'))
    expect(x('C')).toBeLessThan(x('D'))
    expect(out.edges.map(edge => `${edge.from}->${edge.to}`).sort()).toEqual(['A->B', 'A->C', 'A->D', 'B->D', 'C->D'])
  }
})

test('adjacency changes sibling order without editing source', () => {
  const out = layout(SOURCE, { adjacent: [['C', 'B']] })
  expect(out.nodes.find(node => node.id === 'C')!.y).toBeLessThan(out.nodes.find(node => node.id === 'B')!.y)
  expect(out.edges).toHaveLength(5)
})

test.each(['A->B', 'A->B#0', 'A->B#1'])('short-edge preferences accept duplicate-edge occurrence %s', id => {
  for (const backend of ['elk', 'agentic'] as const) {
    const out = layout('flowchart LR\n A --> B\n A --> B', { shortEdges: [id] }, backend)
    expect(out.edges).toHaveLength(2)
  }
})

test.each([
  { ranks: { absent: 1 } },
  { adjacent: [['A', 'absent']] },
  { adjacent: [['B', 'C'], ['C', 'D']] },
  { adjacent: [['B', 'B']] },
  { shortEdges: ['absent'] },
])('invalid references refuse layout instead of silently ignoring hints: %j', hints => {
  for (const backend of ['elk', 'agentic'] as const) expect(() => layout(SOURCE, hints, backend)).toThrow('LAYOUT_HINT_INVALID')
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

// Preferences affect Native placement without editing authored relationships.
test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'].flatMap(header => [
  { header, hints: { adjacent: [['C', 'B']] } },
  { header, hints: { shortEdges: ['A->D'] } },
]))('native selection applies active preferences: %j', ({ header, hints }) => {
  const source = SOURCE.replace('flowchart LR', header)
  const stages: string[] = []
  const native = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, {
    graphLayout: { backend: 'agentic' }, layoutHints: hints,
  }))
  expect(stages).not.toContain('elk')
  expect(native.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
  expect(renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic', fallback: 'elk' }, layoutHints: hints }).svg).toBe(native.svg)
  expect(layout(source, hints, 'agentic').edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'A->C', 'B->D', 'C->D', 'A->D'])
})

test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'])('native adjacency preserves preferred peer model order: %s', header => {
  const source = SOURCE.replace('flowchart LR', header)
  const placed = layout(source, { adjacent: [['C', 'B']] }, 'agentic')
  expect(placed.nodes.find(node => node.id === 'C')!.y).toBeLessThan(placed.nodes.find(node => node.id === 'B')!.y)
})

test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'])('native short-edge priority chooses the near end of a flexible branch: %s', header => {
  const source = `${header}\n A --> B\n B --> C\n C --> D\n A --> X\n X --> D`
  const early = layout(source, { shortEdges: ['A->X'] }, 'agentic')
  const late = layout(source, { shortEdges: ['X->D'] }, 'agentic')
  const x = (placed: typeof early, id: string) => placed.nodes.find(node => node.id === id)!.x
  expect(x(early, 'X') - x(early, 'A')).toBeLessThan(x(early, 'D') - x(early, 'X'))
  expect(x(late, 'D') - x(late, 'X')).toBeLessThan(x(late, 'X') - x(late, 'A'))
  expect(early.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->C', 'C->D', 'A->X', 'X->D'])
  expect(late.edges).toHaveLength(5)
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

// Partition zero includes unlisted siblings: a backward authored arrow remains
// backward, rather than pulling its target into the explicitly later partition.
test.each(['TD', 'BT', 'LR', 'RL'])('native ordered partitions retain backward arrows in %s', direction => {
  const source = `flowchart ${direction}\nAPI[API] -->|reads| DB[Database]\nDB --> Log[Log]\nAPI --> Cache[Cache]`
  const hints = { ranks: { API: 0, DB: 1 } }
  const stages: string[] = []
  const first = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, {
    graphLayout: { backend: 'agentic' }, layoutHints: hints,
  }))
  const second = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic' }, layoutHints: hints })
  expect(first.svg).toBe(second.svg)
  expect(first.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
  expect(stages).not.toContain('elk')
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse failed')
  const placed = layoutMermaid(parsed.value, { graphLayout: { backend: 'agentic' }, layoutHints: hints })
  const horizontal = direction === 'LR' || direction === 'RL'
  const main = (id: string) => {
    const node = placed.nodes.find(node => node.id === id)!
    return (horizontal ? node.x : node.y) * (direction === 'BT' || direction === 'RL' ? -1 : 1)
  }
  for (const id of ['API', 'Log', 'Cache']) expect(main(id)).toBeLessThan(main('DB'))
  expect(placed.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['API->DB', 'DB->Log', 'API->Cache'])
})

test('native partitions are local to the authored container', () => {
  const source = 'flowchart LR\nsubgraph Outer\nA --> B\nB --> C\nend\nX --> Outer'
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse failed')
  const placed = layoutMermaid(parsed.value, { graphLayout: { backend: 'agentic' }, layoutHints: { ranks: { B: 1, X: 1 } } })
  const x = (id: string) => placed.nodes.find(node => node.id === id)!.x
  expect(x('A')).toBeLessThan(x('B'))
  expect(x('C')).toBeLessThan(x('B'))
  expect(x('B')).toBeLessThan(x('X'))
  expect(placed.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->C', 'X->Outer'])
})

test('native validates authored rank references', () => {
  const layoutHints = { ranks: { absent: 1 } }
  expect(() => renderMermaidSVGWithReceipt(SOURCE, { graphLayout: { backend: 'agentic' }, layoutHints })).toThrow('LAYOUT_HINT_INVALID')
})


test('partition zero leaves cyclic native placement unconstrained', () => {
  const source = 'flowchart LR\n A --> B\n B --> A'
  const plain = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic' } })
  const ranked = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic' }, layoutHints: { ranks: { A: 0 } } })
  expect(ranked.svg).toBe(plain.svg)
  expect(ranked.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
})


test('native partitions retain reciprocal relationships through graph certification', () => {
  const source = 'flowchart LR\n A --> B\n B --> A\n B --> C'
  const options = { graphLayout: { backend: 'agentic' as const }, layoutHints: { ranks: { C: 1 } } }
  const first = renderMermaidSVGWithReceipt(source, options)
  expect(renderMermaidSVGWithReceipt(source, options).svg).toBe(first.svg)
  expect(first.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse failed')
  const placed = layoutMermaid(parsed.value, options)
  const x = (id: string) => placed.nodes.find(node => node.id === id)!.x
  expect(x('A')).toBeLessThan(x('C'))
  expect(x('B')).toBeLessThan(x('C'))
  expect(placed.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->A', 'B->C'])
})


test('native adjacency stays local and does not invent a common rank', () => {
  const source = 'flowchart LR\nsubgraph Outer\nA --> B\nA --> C\nB --> D\nC --> D\nend\nX --> Outer'
  const placed = layout(source, { adjacent: [['C', 'B']] }, 'agentic')
  expect(placed.nodes.find(node => node.id === 'C')!.y).toBeLessThan(placed.nodes.find(node => node.id === 'B')!.y)
  const chain = layout('flowchart LR\n A --> B\n B --> C', { adjacent: [['C', 'B']] }, 'agentic')
  expect(chain.nodes.find(node => node.id === 'B')!.x).toBeLessThan(chain.nodes.find(node => node.id === 'C')!.x)
  for (const backend of ['elk', 'agentic'] as const) {
    expect(() => layout(source, { adjacent: [['B', 'X']] }, backend)).toThrow('LAYOUT_HINT_INVALID')
  }
})

test('native rank, order and shortness preferences retain authored reciprocal occurrences together', () => {
  const source = 'flowchart LR\n A --> B\n B --> A\n A --> X\n B --> C\n C --> D\n X --> D'
  const hints = { ranks: { C: 1, D: 2 }, adjacent: [['X', 'B']], shortEdges: ['A->X', 'B->A#0'] }
  const first = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic' }, layoutHints: hints })
  expect(renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic' }, layoutHints: hints }).svg).toBe(first.svg)
  expect(first.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
  const placed = layout(source, hints, 'agentic')
  const x = (id: string) => placed.nodes.find(node => node.id === id)!.x
  expect(x('X')).toBeLessThan(x('C'))
  expect(x('B')).toBeLessThan(x('C'))
  expect(x('C')).toBeLessThan(x('D'))
  expect(placed.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->A', 'A->X', 'B->C', 'C->D', 'X->D'])
})
