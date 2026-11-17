import { convertToElkFormat } from '../layout-engine.ts'
import { parseMermaid as parseFlowchart } from '../parser.ts'
import { expect, test } from 'bun:test'
import { layoutMermaid, parseRegisteredMermaid, renderMermaidSVGWithReceipt } from '../agent/core.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import type { GraphLayoutHints } from '../types.ts'

const SOURCE = 'flowchart LR\n A --> B\n A --> C\n B --> D\n C --> D\n A --> D'

function layout(source: string, layoutHints?: GraphLayoutHints, backend: 'elk' = 'elk') {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse failed')
  return layoutMermaid(parsed.value, { layoutHints, graphLayout: { backend } })
}

test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'])('rank preferences retain every relationship: %s', header => {
  const source = SOURCE.replace('flowchart LR', header)
  for (const backend of ['elk'] as const) {
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
  for (const backend of ['elk'] as const) {
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
  for (const backend of ['elk'] as const) expect(() => layout(SOURCE, hints, backend)).toThrow('LAYOUT_HINT_INVALID')
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

// Preferences reach ELK metadata without editing authored relationships.
test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'].flatMap(header => [
  { header, hints: { adjacent: [['C', 'B']] } },
  { header, hints: { shortEdges: ['A->D'] } },
]))('ELK selection retains active preferences: %j', ({ header, hints }) => {
  const source = SOURCE.replace('flowchart LR', header)
  const stages: string[] = []
  const native = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, {
    graphLayout: { backend: 'elk' }, layoutHints: hints,
  }))

  expect(native.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
  expect(renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk', fallback: 'none' }, layoutHints: hints }).svg).toBe(native.svg)
  expect(layout(source, hints, 'elk').edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'A->C', 'B->D', 'C->D', 'A->D'])
})

test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'])('ELK adjacency preserves preferred peer model order: %s', header => {
  const source = SOURCE.replace('flowchart LR', header)
  const placed = layout(source, { adjacent: [['C', 'B']] }, 'elk')
  expect(placed.nodes.find(node => node.id === 'C')!.y).toBeLessThan(placed.nodes.find(node => node.id === 'B')!.y)
})

test.each(['flowchart LR', 'stateDiagram-v2\n direction LR'])('short-edge hints target the selected authored occurrence: %s', header => {
  const source = `${header}\n A --> B\n B --> C\n C --> D\n A --> X\n X --> D`
  const early = layout(source, { shortEdges: ['A->X'] }, 'elk')
  const late = layout(source, { shortEdges: ['X->D'] }, 'elk')
  const graph = parseFlowchart(source.replace(header, 'flowchart LR'))
  const plain = convertToElkFormat(graph)
  for (const [selector, index] of [['A->X', 3], ['X->D', 4]] as const) {
    const input = convertToElkFormat(graph, { layoutHints: { shortEdges: [selector] } })
    expect(input.edges?.[index]?.layoutOptions).toMatchObject({ 'elk.layered.priority.shortness': '100', 'elk.layered.priority.direction': '100' })
    for (let i = 0; i < 5; i++) if (i !== index) expect(input.edges?.[i]?.layoutOptions).toEqual(plain.edges?.[i]?.layoutOptions)
  }
  expect(early.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->C', 'C->D', 'A->X', 'X->D'])
  expect(late.edges).toHaveLength(5)
})

test.each([{}, { ranks: {} }, { adjacent: [] }, { shortEdges: [] }])('empty hints retain ELK layout: %j', layoutHints => {
  const out = renderMermaidSVGWithReceipt(SOURCE, { graphLayout: { backend: 'elk' }, layoutHints })
  expect(out.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
})

test('explicit fallback propagates invalid layout hints', () => {
  expect(() => renderMermaidSVGWithReceipt(SOURCE, {
    graphLayout: { backend: 'elk', fallback: 'none' }, layoutHints: { ranks: { absent: 1 } },
  })).toThrow('LAYOUT_HINT_INVALID')
})

// Partition zero includes unlisted siblings: a backward authored arrow remains
// backward, rather than pulling its target into the explicitly later partition.
test.each(['TD', 'BT', 'LR', 'RL'])('ordered ELK partitions retain authored arrow direction in %s', direction => {
  const source = `flowchart ${direction}\nAPI[API] -->|reads| DB[Database]\nDB --> Log[Log]\nAPI --> Cache[Cache]`
  const hints = { ranks: { API: 0, DB: 1 } }
  const stages: string[] = []
  const first = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, {
    graphLayout: { backend: 'elk' }, layoutHints: hints,
  }))
  const second = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' }, layoutHints: hints })
  expect(first.svg).toBe(second.svg)
  expect(first.receipt.layoutDecisions?.[0]?.selected).toBe('elk')

  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse failed')
  const placed = layoutMermaid(parsed.value, { graphLayout: { backend: 'elk' }, layoutHints: hints })
  const input = convertToElkFormat(parseFlowchart(source), { layoutHints: hints })
  const nodes = new Map(input.children!.map(node => [node.id, node]))
  expect(input.layoutOptions?.['elk.partitioning.activate']).toBe('true')
  expect(nodes.get('DB')!.layoutOptions?.['elk.partitioning.partition']).toBe('1')
  for (const id of ['API', 'Log', 'Cache']) expect(nodes.get(id)!.layoutOptions?.['elk.partitioning.partition']).toBe('0')
  expect(placed.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['API->DB', 'DB->Log', 'API->Cache'])
})

test('ELK partitions are local to the authored container', () => {
  const source = 'flowchart LR\nsubgraph Outer\nA --> B\nB --> C\nend\nX --> Outer'
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse failed')
  const placed = layoutMermaid(parsed.value, { graphLayout: { backend: 'elk' }, layoutHints: { ranks: { B: 1, X: 1 } } })
  const input = convertToElkFormat(parseFlowchart(source), { layoutHints: { ranks: { B: 1, X: 1 } } })
  const outer = input.children!.find(node => node.id === 'Outer')!
  expect(input.layoutOptions?.['elk.partitioning.activate']).toBe('true')
  expect(outer.layoutOptions?.['elk.partitioning.activate']).toBe('true')
  expect(input.children!.find(node => node.id === 'X')!.layoutOptions?.['elk.partitioning.partition']).toBe('1')
  expect(outer.layoutOptions?.['elk.partitioning.partition']).toBe('0')
  expect(outer.children!.map(node => [node.id, node.layoutOptions?.['elk.partitioning.partition']])).toEqual([['A', '0'], ['B', '1'], ['C', '0']])
  expect(placed.edges.map(edge => `${edge.from}->${edge.to}`).sort()).toEqual(['A->B', 'B->C', 'X->Outer'].sort())
})

test('ELK validates authored rank references', () => {
  const layoutHints = { ranks: { absent: 1 } }
  expect(() => renderMermaidSVGWithReceipt(SOURCE, { graphLayout: { backend: 'elk' }, layoutHints })).toThrow('LAYOUT_HINT_INVALID')
})


test('partition zero leaves cyclic ELK placement unconstrained', () => {
  const source = 'flowchart LR\n A --> B\n B --> A'
  const plain = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' } })
  const ranked = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' }, layoutHints: { ranks: { A: 0 } } })
  expect(ranked.svg).toBe(plain.svg)
  expect(ranked.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
})


test('ELK partitions retain reciprocal relationships through graph certification', () => {
  const source = 'flowchart LR\n A --> B\n B --> A\n B --> C'
  const options = { graphLayout: { backend: 'elk' as const }, layoutHints: { ranks: { C: 1 } } }
  const first = renderMermaidSVGWithReceipt(source, options)
  expect(renderMermaidSVGWithReceipt(source, options).svg).toBe(first.svg)
  expect(first.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse failed')
  const placed = layoutMermaid(parsed.value, options)
  const x = (id: string) => placed.nodes.find(node => node.id === id)!.x
  expect(x('A')).toBeLessThan(x('C'))
  expect(x('B')).toBeLessThan(x('C'))
  expect(placed.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->A', 'B->C'])
})


test('adjacency remains local model order rather than a rank constraint', () => {
  const source = 'flowchart LR\nsubgraph Outer\nA --> B\nA --> C\nB --> D\nC --> D\nend\nX --> Outer'
  const placed = layout(source, { adjacent: [['C', 'B']] }, 'elk')
  expect(placed.nodes.find(node => node.id === 'C')!.y).toBeLessThan(placed.nodes.find(node => node.id === 'B')!.y)
  const chain = layout('flowchart LR\n A --> B\n B --> C', { adjacent: [['C', 'B']] }, 'elk')
  const input = convertToElkFormat(parseFlowchart('flowchart LR\n A --> B\n B --> C'), { layoutHints: { adjacent: [['C', 'B']] } })
  expect(input.children!.map(node => node.id)).toEqual(['A', 'C', 'B'])
  expect(input.layoutOptions?.['elk.layered.crossingMinimization.forceNodeModelOrder']).toBe('true')
  expect(input.children!.every(node => node.layoutOptions?.['elk.partitioning.partition'] === undefined)).toBe(true)
  expect(chain.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->C'])
  for (const backend of ['elk'] as const) {
    expect(() => layout(source, { adjacent: [['B', 'X']] }, backend)).toThrow('LAYOUT_HINT_INVALID')
  }
})

test('ELK rank, order and shortness preferences retain authored reciprocal occurrences together', () => {
  const source = 'flowchart LR\n A --> B\n B --> A\n A --> X\n B --> C\n C --> D\n X --> D'
  const hints = { ranks: { C: 1, D: 2 }, adjacent: [['X', 'B']], shortEdges: ['A->X', 'B->A#0'] }
  const first = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' }, layoutHints: hints })
  expect(renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' }, layoutHints: hints }).svg).toBe(first.svg)
  expect(first.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
  const placed = layout(source, hints, 'elk')
  const input = convertToElkFormat(parseFlowchart(source), { layoutHints: hints })
  const nodes = new Map(input.children!.map(node => [node.id, node]))
  expect(nodes.get('C')!.layoutOptions?.['elk.partitioning.partition']).toBe('1')
  expect(nodes.get('D')!.layoutOptions?.['elk.partitioning.partition']).toBe('2')
  for (const id of ['A', 'B', 'X']) expect(nodes.get(id)!.layoutOptions?.['elk.partitioning.partition']).toBe('0')
  expect(input.children!.map(node => node.id).slice(1, 3)).toEqual(['X', 'B'])
  for (const index of [1, 2]) expect(input.edges?.[index]?.layoutOptions).toMatchObject({ 'elk.layered.priority.shortness': '100', 'elk.layered.priority.direction': '100' })
  expect(placed.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->A', 'A->X', 'B->C', 'C->D', 'X->D'])
})
