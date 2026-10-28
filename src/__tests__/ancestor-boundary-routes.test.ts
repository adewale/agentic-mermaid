import { expect, test } from 'bun:test'
import { layoutAgenticGraph, type MeasuredGraph } from '../layout/agentic-layered.ts'
import { GraphLayoutUnsupportedError } from '../layout/backend.ts'
import { planAncestorBoundaryConnections, projectAncestorBoundaryPlaceholder, routeAncestorBoundaryConnection } from '../layout/ancestor-boundary-routes.ts'
import { pointOnMeasuredSegment, scoreMeasuredRouteCrossings, segmentEntersMeasuredBox } from '../layout/measured-route-safety.ts'
import { layoutMermaidWithReceipt } from '../agent/core.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
const work = () => ({ pairs: 500_000, arcs: 65536, swaps: 500_000 })
const padding = { top: 40, right: 20, bottom: 20, left: 20 }
const fixture = (): MeasuredGraph => ({
  direction: 'TD', padding: 20, nodeSpacing: 40, layerSpacing: 60, edgeSpacing: 8,
  nodes: [{ id: 'edge__0', width: 80, height: 36, parent: 1 }],
  groups: [{ id: 'group__0', minWidth: 120, headerHeight: 24, padding }, { id: 'nested__0', parent: 0, minWidth: 100, headerHeight: 24, padding }],
  edges: [
    { source: 1, target: 0, minSpan: 1, label: { width: 44, height: 12 } },
    { source: 0, target: 1, minSpan: 1, label: { width: 46, height: 12 } },
    { source: 1, target: 0, minSpan: 1 },
    { source: 1, target: 2, minSpan: 1, label: { width: 36, height: 12 } },
  ],
})

test.each(['G --> A', 'A --> G'])('public Native retains a real containing-frame contact and leaf contact for %s', relationship => {
  const source = `flowchart TD\nsubgraph G[Group]\nA[Leaf]\nend\n${relationship}`
  const native = { graphLayout: { backend: 'agentic' as const } }
  const rendered = layoutMermaidWithReceipt(source, native), layout = rendered.layout
  const group = layout.groups!.find(group => group.id === 'G')!, leaf = layout.nodes.find(node => node.id === 'A')!, edge = layout.edges[0]!
  expect([edge.from, edge.to]).toEqual(relationship === 'G --> A' ? ['G', 'A'] : ['A', 'G'])
  expect(layout.nodes.map(node => node.id)).toEqual(['A'])
  expect(group.members).toEqual(['A'])
  const points = edge.from === 'G' ? edge.path : edge.path.toReversed()
  expect(points[0]![0]).toBe(group.x)
  expect(points[1]![0]).toBeGreaterThan(group.x)
  expect(points[1]![1]).toBe(points[0]![1])
  expect(points[1]![0] - points[0]![0]).toBeGreaterThanOrEqual(8)
  const last = points.at(-1)!, previous = points.at(-2)!
  expect(last[0] === leaf.x && previous[0] < last[0] || last[0] === leaf.x + leaf.w && previous[0] > last[0]
    || last[1] === leaf.y && previous[1] < last[1] || last[1] === leaf.y + leaf.h && previous[1] > last[1]).toBe(true)
  expect(Math.abs(last[0] - previous[0]) + Math.abs(last[1] - previous[1])).toBeGreaterThanOrEqual(8)
  for (let cursor = 1; cursor < points.length; cursor++) expect(segmentEntersMeasuredBox({ x: points[cursor - 1]![0], y: points[cursor - 1]![1] }, { x: points[cursor]![0], y: points[cursor]![1] }, { x: group.x, y: group.y, width: group.w, height: 28 })).toBe(false)
  expect(rendered.receipt.layoutDecisions).toContainEqual(expect.objectContaining({ selected: 'agentic' }))
  const svg = renderMermaidSVGWithReceipt(source, native)
  expect(svg.svg).toContain('data-from="' + edge.from + '" data-to="' + edge.to + '"')
  expect(svg.receipt.layoutCertification?.status).toBe('passed')
})

test('public Native composes an ancestor label corridor with ordinary and lifted relationships', () => {
  const source = `flowchart TD
subgraph G[Group]
  A[Leaf] --> B[Worker]
end
C[External]
G -->|inside| A
B --> C
C --> G`
  const native = { graphLayout: { backend: 'agentic' as const } }, output = layoutMermaidWithReceipt(source, native)
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
  const measured: MeasuredGraph = { direction: 'TD', padding: 20, nodeSpacing: 40, layerSpacing: 60,
    nodes: subjects.map(subject => ({ id: subject.id, width: subject.w, height: subject.h })),
    edges: layout.edges.map(edge => ({ source: indices.get(edge.from)!, target: indices.get(edge.to)!, minSpan: 1 })) }
  const routes = layout.edges.map(edge => ({ points: edge.path.map(([x, y]) => ({ x, y })), style: 'solid' }))
  for (const [index, route] of routes.entries()) expect(scoreMeasuredRouteCrossings(route.points, index, routes, measured)).toBeDefined()
  expect(layoutMermaidWithReceipt(source, native).layout).toEqual(layout)
  expect(output.receipt.layoutDecisions).toContainEqual(expect.objectContaining({ selected: 'agentic' }))
  expect(renderMermaidSVGWithReceipt(source, native).receipt.layoutCertification?.status).toBe('passed')
})

test.each(['source', 'target'] as const)('long ancestor %s links reserve the authored minimum in their actual inward prefix', end => {
  let previous = 0
  for (const [span, minimum] of [[2, 136], [3, 224], [4, 312], [2048, 180184]] as const) {
    const relationship = end === 'source' ? `G ${'-'.repeat(span + 1)}> A` : `A ${'-'.repeat(span + 1)}> G`
    const source = `flowchart TD\nsubgraph G[Group]\nA[Leaf]\nend\n${relationship}`
    const native = { graphLayout: { backend: 'agentic' as const } }, output = layoutMermaidWithReceipt(source, native), layout = output.layout
    const group = layout.groups!.find(group => group.id === 'G')!, leaf = layout.nodes.find(node => node.id === 'A')!, edge = layout.edges[0]!
    expect([edge.from, edge.to]).toEqual(end === 'source' ? ['G', 'A'] : ['A', 'G'])
    const points = end === 'source' ? edge.path : edge.path.toReversed(), prefix = points[1]![0] - points[0]![0]
    expect(points[0]![0]).toBe(group.x)
    expect(points[1]![1]).toBe(points[0]![1])
    expect(prefix).toBeGreaterThanOrEqual(minimum)
    expect(prefix).toBeGreaterThan(previous)
    previous = prefix
    const body = points.at(-1)!, next = points.at(-2)!
    expect(body[0] === leaf.x && next[0] < body[0] || body[0] === leaf.x + leaf.w && next[0] > body[0]
      || body[1] === leaf.y && next[1] < body[1] || body[1] === leaf.y + leaf.h && next[1] > body[1]).toBe(true)
    expect(output.receipt.layoutDecisions).toContainEqual(expect.objectContaining({ selected: 'agentic' }))
    expect(renderMermaidSVGWithReceipt(source, native).receipt.layoutCertification?.status).toBe('passed')
  }
})

test.each([
  { name: 'default', arrow: '-->', lineWidth: 1, suffix: '' },
  { name: 'wide global shaft', arrow: '-->', lineWidth: 3, suffix: '' },
  { name: 'fixed inline marker', arrow: '-->', lineWidth: 1, suffix: '\nlinkStyle 0 stroke-width:20px' },
  { name: 'thick shaft', arrow: '==>', lineWidth: 2, suffix: '' },
])('a labelled leaf-to-ancestor $name arrow clears its actual marker and both headers', ({ arrow, lineWidth, suffix }) => {
  const source = `flowchart TD
subgraph Outer[Outer]
  subgraph Inner[Inner]
    A[Alpha]
  end
end
A ${arrow}|reports| Outer${suffix}`
  const native = { graphLayout: { backend: 'agentic' as const }, style: { roles: { edge: { lineWidth } } } }, layout = layoutMermaidWithReceipt(source, native).layout
  const svg = renderMermaidSVGWithReceipt(source, native)
  const halo = scanSvgStartTags(svg.svg).map(tag => Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value]))).find(attributes => attributes.class === 'edge-label-halo')!
  const [x, y, width, height] = ['x', 'y', 'width', 'height'].map(name => Number(halo[name]))
  expect([x, y, width, height].every(Number.isFinite)).toBe(true)
  for (const group of layout.groups!) expect(y! >= group.y + 28 || y! + height! <= group.y || x! + width! <= group.x || x! >= group.x + group.w).toBe(true)
  expect(svg.receipt.layoutCertification?.status).toBe('passed')
})

test('ancestor corridors preserve nested physical contacts, reciprocal/parallel occurrences, labels and authored input', () => {
  const input = fixture(), before = structuredClone(input), owners = new Int32Array([1, -1, 0]), budget = work()
  const plan = planAncestorBoundaryConnections(input, owners, budget, fail)
  expect([...plan.connections.keys()]).toEqual([0, 1, 2, 3])
  expect(plan.groups[0]!.padding.top).toBeGreaterThan(padding.top)
  expect(plan.groups[0]!.padding.left).toBeGreaterThan(padding.left)
  expect(plan.groups[1]).toBe(input.groups![1])
  const placed = layoutAgenticGraph({ ...input, groups: plan.groups, edges: [] })
  let allocated = placed.expandedVertices ?? 0
  const reserve = (amount: number): void => { if (allocated + amount > 32768) fail('shared expansion limit'); allocated += amount }
  placed.edges = input.edges.map((_, index) => projectAncestorBoundaryPlaceholder(plan, index, placed.groups!, reserve))
  const finished = new Set<number>()
  for (const index of plan.connections.keys()) {
    const route = routeAncestorBoundaryConnection(input, placed, owners, plan, index, {
      work: budget, remainingVertices: 32768 - allocated, reserveVertices: reserve, fail,
      accept: candidate => scoreMeasuredRouteCrossings(candidate.points, index,
        placed.edges.map((edge, other) => ({ ...edge, style: finished.has(other) ? 'solid' : 'invisible' })), input) !== undefined,
    })
    placed.edges[index] = route; finished.add(index)
    const connection = plan.connections.get(index)!, frame = placed.groups![connection.container]!
    const points = connection.containerEnd === 'source' ? route.points : route.points.toReversed()
    expect(new Set(points.map(point => `${point.x},${point.y}`)).size).toBe(points.length)
    expect(points[0]!.x).toBe(frame.x)
    expect(points[0]!.y).toBeGreaterThan(frame.y + 24)
    expect(points[1]!.y).toBe(points[0]!.y)
    expect(points[1]!.x).toBeGreaterThan(points[0]!.x)
    const box = connection.interior === 0 ? { ...placed.nodes[0]!, width: 80, height: 36 } : placed.groups![1]!
    const end = points.at(-1)!, previous = points.at(-2)!
    expect(end.x === box.x && previous.x < end.x || end.x === box.x + box.width && previous.x > end.x
      || end.y === box.y && previous.y < end.y || end.y === box.y + box.height && previous.y > end.y).toBe(true)
    for (const group of placed.groups!) for (let cursor = 1; cursor < route.points.length; cursor++) {
      expect(segmentEntersMeasuredBox(route.points[cursor - 1]!, route.points[cursor]!, { ...group, height: 24 })).toBe(false)
    }
    if (input.edges[index]!.label) expect(route.points.some((p, cursor) => cursor > 0 && pointOnMeasuredSegment(route.labelPosition!, route.points[cursor - 1]!, p))).toBe(true)
  }
  const all = placed.edges.map(edge => ({ ...edge, style: 'solid' }))
  for (const [index, route] of placed.edges.entries()) expect(scoreMeasuredRouteCrossings(route.points, index, all, input)).toBeDefined()
  expect(input).toEqual(before)
  expect(allocated).toBeLessThanOrEqual(32768)
  expect(layoutAgenticGraph(input).boundaryRoutes).toEqual([0, 1, 2, 3])
})

test('ancestor reservations retain original groups without incidence and keep allocation bounds', () => {
  const input = fixture(), owners = new Int32Array([1, -1, 0])
  const ordinary = { ...input, edges: [{ source: 0, target: 0, minSpan: 1 }] }
  expect(planAncestorBoundaryConnections(ordinary, owners, work(), fail).groups).toBe(input.groups!)
  const long = planAncestorBoundaryConnections({ ...input, edges: [{ source: 1, target: 0, minSpan: 2048 }] }, owners, work(), fail)
  expect(long.connections.get(0)!.minimumLead).toBe(180184)
  expect(long.groups[0]!.padding.left).toBeGreaterThanOrEqual(180192)
  const plan = planAncestorBoundaryConnections(input, owners, work(), fail)
  const placed = layoutAgenticGraph({ ...input, groups: plan.groups, edges: [] })
  placed.edges = input.edges.map((_, index) => projectAncestorBoundaryPlaceholder(plan, index, placed.groups!))
  let allocated = 0
  expect(() => routeAncestorBoundaryConnection(input, placed, owners, plan, 0, {
    work: work(), remainingVertices: 64, reserveVertices: amount => { allocated += amount }, fail, accept: () => true,
  })).toThrow('visibility-expansion limit')
  expect(allocated).toBeLessThanOrEqual(64)
})

// Ancestor occurrences reserve one measured corridor, independent of private
// sibling ranks. Invalid inputs and unrepresentable coordinate gaps still fail.
test('sparse ancestor prefixes reject invalid spans and unsafe coordinate gaps', () => {
  const input = fixture(), owners = new Int32Array([1, -1, 0])
  for (const minSpan of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => planAncestorBoundaryConnections({ ...input, edges: [{ source: 1, target: 0, minSpan }] }, owners, work(), fail)).toThrow(TypeError)
  }
  expect(() => planAncestorBoundaryConnections({ ...input, edges: [{ source: 1, target: 0, minSpan: Number.MAX_SAFE_INTEGER }] }, owners, work(), fail)).toThrow('coordinate-range limit')
  const shortWork = work(), longWork = work()
  planAncestorBoundaryConnections({ ...input, edges: [{ source: 1, target: 0, minSpan: 2 }] }, owners, shortWork, fail)
  planAncestorBoundaryConnections({ ...input, edges: [{ source: 1, target: 0, minSpan: 2048 }] }, owners, longWork, fail)
  expect(longWork).toEqual(shortWork)
})
