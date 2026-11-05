import { expect, test } from 'bun:test'
import { parseRegisteredMermaid, serializeMermaid, mutate } from '../agent/core.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { parseSwimlane } from '../swimlane/parser.ts'
import { layoutSwimlane, swimlanePartitions } from '../swimlane/layout.ts'

const source = `swimlane-beta LR
subgraph Customer[Customer 👩‍💻]
  A[Browse]
  B{Pay}
end
subgraph Warehouse
  subgraph Dispatch
    C[Pick]
    D[Ship]
  end
end
A --> B
B handoff@-->|paid| C
C --> D
D -.-> B`

test('native Swimlane edits retain family, nested membership, shapes and cross-lane edge identities', () => {
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok || parsed.value.body.kind !== 'swimlane') throw new Error('expected native Swimlane')
  const edited = mutate(parsed.value, { kind: 'set_label', target: 'B', label: 'Paid?' })
  expect(edited.ok).toBe(true)
  if (!edited.ok) throw new Error(edited.error.message)
  const serialized = serializeMermaid(edited.value)
  expect(serialized).toStartWith('swimlane-beta LR')
  const reparsed = parseRegisteredMermaid(serialized)
  if (!reparsed.ok || reparsed.value.body.kind !== 'swimlane') throw new Error('expected native edited Swimlane')
  const graph = reparsed.value.body.graph
  expect(graph.nodes.get('B')).toMatchObject({ label: 'Paid?', shape: 'diamond' })
  expect(graph.edges[1]).toMatchObject({ id: 'handoff', source: 'B', target: 'C', label: 'paid' })
  expect(graph.subgraphs[1]?.children[0]).toMatchObject({ id: 'Dispatch', nodeIds: ['C', 'D'] })
})

test.each(['LR', 'RL', 'TD', 'BT'] as const)('Swimlane %s retains equal bands, owned cards and connected terminal handoffs', direction => {
  const input = source.replace('LR', direction)
  const pixel = layoutSwimlane(parseSwimlane(input))
  expect(pixel.groups.map(group => group.id)).toEqual(['Customer', 'Warehouse'])
  const axis = direction === 'LR' || direction === 'RL' ? 'width' : 'height'
  expect(pixel.groups[0]![axis]).toBe(pixel.groups[1]![axis])
  expect(pixel.edges[1]).toMatchObject({ id: 'handoff', source: 'B', target: 'C' })
  expect(pixel).toEqual(layoutSwimlane(parseSwimlane(input)))
  const svg = renderMermaidSVG(input)
  expect(svg).toContain('data-id="handoff"')
  expect(svg).toContain('data-parent-id="Warehouse"')
  const terminal = renderMermaidASCIIWithReceipt(input, { colorMode: 'none', layoutSafety: 'strict' })
  expect(terminal.receipt.layoutCertification?.status).toBe('passed')
  const regions = terminalDocumentOf(terminal)!.regions()
  expect(regions.find(region => region.id === 'handoff')).toMatchObject({ from: 'B', to: 'C', projectedText: 'paid' })
  expect(regions.find(region => region.id === 'C')).toMatchObject({ parentId: 'Dispatch', kind: 'node', projectedText: 'Pick' })
  expect(regions.find(region => region.id === 'Dispatch')).toMatchObject({ parentId: 'Warehouse', kind: 'subgraph' })
  const first = regions.find(region => region.id === 'Customer')!, second = regions.find(region => region.id === 'Warehouse')!
  expect(axis === 'width' ? first.canvasColEnd - first.canvasColStart : first.rowSpan).toBe(axis === 'width' ? second.canvasColEnd - second.canvasColStart : second.rowSpan)
})

test('implicit lane identities cannot collide with authored nodes and unsupported source is preserved', () => {
  const graph = parseSwimlane('swimlane-beta TD\n__swimlane_default__[Loose]\nsubgraph Team\nA[Owned]\nend\nA --> __swimlane_default__')
  expect(swimlanePartitions(graph).map(lane => lane.id)).toEqual(['Team', '__swimlane_default___'])
  const unsafe = 'swimlane-beta LR\nA --> B\nclick A callback'
  const parsed = parseRegisteredMermaid(unsafe)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('expected preserved source')
  expect(parsed.value.body).toMatchObject({ kind: 'opaque', family: 'swimlane' })
  expect(serializeMermaid(parsed.value).trimEnd()).toBe(unsafe)
})

test('the bare upstream graph keyword keeps its established Flowchart identity', () => {
  const legacy = parseRegisteredMermaid('swimlane LR;A-->B;')
  expect(legacy.ok && legacy.value.body.kind).toBe('flowchart')
  expect(renderMermaidSVG('swimlane LR;A-->B;')).toContain('A')
  const native = parseRegisteredMermaid('swimlane-beta LR;A-->B;')
  expect(native.ok && native.value.body.kind).toBe('swimlane')
})

test('independent lane hand-offs keep separate short routes instead of an unlabelled shared bus', () => {
  const input = ['swimlane-beta LR', ...Array.from({ length: 3 }, (_, lane) => [`subgraph L${lane}[Team ${lane}]`, ...Array.from({ length: 6 }, (_, item) => `n${lane}_${item}[Task ${lane}.${item}]`), 'end']), ...Array.from({ length: 6 }, (_, item) => [`n0_${item} --> n1_${item}`, `n1_${item} --> n2_${item}`])].flat().join('\n')
  const chart = layoutSwimlane(parseSwimlane(input)), firstLane = chart.nodes.filter(node => node.id.startsWith('n0_'))
  expect(new Set(firstLane.map(node => node.x)).size).toBe(6)
  expect(new Set(firstLane.map(node => node.y)).size).toBe(1)
  const segments = chart.edges.flatMap(edge => edge.points.slice(1).map((b, index) => ({ edge: edge.edgeIndex, a: edge.points[index]!, b })))
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i]!, b = segments[j]!
    if (a.edge === b.edge) continue
    const sameVerticalTrack = a.a.x === a.b.x && b.a.x === b.b.x && a.a.x === b.a.x
    const sameHorizontalTrack = a.a.y === a.b.y && b.a.y === b.b.y && a.a.y === b.a.y
    const overlap = sameVerticalTrack ? Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y)) - Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y)) : sameHorizontalTrack ? Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x)) - Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x)) : 0
    expect(overlap).toBeLessThanOrEqual(0)
  }
  for (const edge of chart.edges) {
    const from = chart.nodes.find(node => node.id === edge.source)!, to = chart.nodes.find(node => node.id === edge.target)!
    expect(edge.points[0]?.y).toBe(from.y + from.height)
    expect(edge.points.at(-1)?.y).toBe(to.y)
  }
})
