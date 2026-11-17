import { expect, test } from 'bun:test'
import type { MeasuredRouteGraph } from '../layout/measured-graph.ts'
import { scoreMeasuredRouteCrossings, segmentEntersMeasuredBox } from '../layout/measured-route-safety.ts'
import { layoutMermaidWithReceipt } from '../agent/core.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'

test.each(['G --> A', 'A --> G'])('public ELK retains a real containing-frame contact and leaf contact for %s', relationship => {
  const source = `flowchart TD\nsubgraph G[Group]\nA[Leaf]\nend\n${relationship}`
  const options = { graphLayout: { backend: 'elk' as const } }
  const rendered = layoutMermaidWithReceipt(source, options), layout = rendered.layout
  const group = layout.groups!.find(group => group.id === 'G')!, leaf = layout.nodes.find(node => node.id === 'A')!, edge = layout.edges[0]!
  expect([edge.from, edge.to]).toEqual(relationship === 'G --> A' ? ['G', 'A'] : ['A', 'G'])
  expect(layout.nodes.map(node => node.id)).toEqual(['A'])
  expect(group.members).toEqual(['A'])
  const points = edge.from === 'G' ? edge.path : edge.path.toReversed()
  const start = points[0]!, inside = points[1]!
  // ELK may select any frame face; the physical contact must enter the frame.
  expect(start[0] === group.x && inside[0] > start[0] && inside[1] === start[1]
    || start[0] === group.x + group.w && inside[0] < start[0] && inside[1] === start[1]
    || start[1] === group.y && inside[1] > start[1] && inside[0] === start[0]
    || start[1] === group.y + group.h && inside[1] < start[1] && inside[0] === start[0]).toBe(true)
  expect(Math.abs(inside[0] - start[0]) + Math.abs(inside[1] - start[1])).toBeGreaterThanOrEqual(8)
  const last = points.at(-1)!, previous = points.at(-2)!
  expect(last[0] === leaf.x && previous[0] < last[0] || last[0] === leaf.x + leaf.w && previous[0] > last[0]
    || last[1] === leaf.y && previous[1] < last[1] || last[1] === leaf.y + leaf.h && previous[1] > last[1]).toBe(true)
  expect(Math.abs(last[0] - previous[0]) + Math.abs(last[1] - previous[1])).toBeGreaterThanOrEqual(8)
  for (let cursor = 1; cursor < points.length; cursor++) expect(segmentEntersMeasuredBox({ x: points[cursor - 1]![0], y: points[cursor - 1]![1] }, { x: points[cursor]![0], y: points[cursor]![1] }, { x: group.x, y: group.y, width: group.w, height: 28 })).toBe(false)
  expect(rendered.receipt.layoutDecisions).toContainEqual(expect.objectContaining({ selected: 'elk' }))
  const svg = renderMermaidSVGWithReceipt(source, options)
  expect(svg.svg).toContain('data-from="' + edge.from + '" data-to="' + edge.to + '"')
  expect(svg.receipt.layoutCertification?.status).toBe('passed')
})

test('public ELK composes an ancestor label corridor with ordinary and lifted relationships', () => {
  const source = `flowchart TD
subgraph G[Group]
  A[Leaf] --> B[Worker]
end
C[External]
G -->|inside| A
B --> C
C --> G`
  const options = { graphLayout: { backend: 'elk' as const } }, output = layoutMermaidWithReceipt(source, options)
  const { layout } = output, group = layout.groups!.find(group => group.id === 'G')!
  expect(layout.edges.map(edge => [edge.from, edge.to]).sort()).toEqual([['A', 'B'], ['G', 'A'], ['B', 'C'], ['C', 'G']].sort())
  expect([...group.members].sort()).toEqual(['A', 'B'])
  const ancestor = layout.edges.find(edge => edge.from === 'G' && edge.to === 'A')!
  expect(ancestor.path[0]![0]).toBe(group.x)
  expect(ancestor.path[1]![0]).toBeGreaterThan(group.x)
  expect(ancestor.label?.text).toBe('inside')
  const points = ancestor.path.map(([x, y]) => ({ x, y }))
  for (let cursor = 1; cursor < points.length; cursor++) expect(segmentEntersMeasuredBox(points[cursor - 1]!, points[cursor]!, { x: group.x, y: group.y, width: group.w, height: 28 })).toBe(false)
  const subjects = [...layout.nodes, ...layout.groups!], indices = new Map(subjects.map((subject, index) => [subject.id, index]))
  const measured: MeasuredRouteGraph = { edges: layout.edges.map(edge => ({ source: indices.get(edge.from)!, target: indices.get(edge.to)! })) }
  const routes = layout.edges.map(edge => ({ points: edge.path.map(([x, y]) => ({ x, y })), style: 'solid' }))
  for (const [index, route] of routes.entries()) expect(scoreMeasuredRouteCrossings(route.points, index, routes, measured)).toBeDefined()
  expect(layoutMermaidWithReceipt(source, options).layout).toEqual(layout)
  expect(output.receipt.layoutDecisions).toContainEqual(expect.objectContaining({ selected: 'elk' }))
  expect(renderMermaidSVGWithReceipt(source, options).receipt.layoutCertification?.status).toBe('passed')
})
