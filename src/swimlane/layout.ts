import { layoutNativeGraphPlacementSync } from '../layout-engine.ts'
import { resolveEdgeInlineStyle } from '../color-resolver.ts'
import { graphClassNames } from '../shared/graph-classes.ts'
import { assertMermaidGraphWork } from '../shared/diagram-limits.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { shapeCardinalPorts } from '../shape-outline.ts'
import { createSparseVisibilityGraph } from '../layout/compound-sparse-visibility.ts'
import { simplifyOrthogonal, type Terminal } from '../layout/compound-visibility.ts'
import type { MermaidGraph, MermaidSubgraph, Point, PositionedGraph, PositionedGroup, PositionedNode, RenderOptions } from '../types.ts'

export interface SwimlanePartition { id: string; label: string; source?: MermaidSubgraph; nodes: Set<string> }

/** Semantic ownership is shared by output adapters; geometry stays with each
 * adapter. The implicit lane never steals an authored identifier. */
export function swimlanePartitions(graph: MermaidGraph): SwimlanePartition[] {
  const assigned = new Set<string>()
  const descendants = (group: MermaidSubgraph, ids: Set<string>): void => {
    for (const id of group.nodeIds) if (graph.nodes.has(id)) { ids.add(id); assigned.add(id) }
    group.children.forEach(child => descendants(child, ids))
  }
  const lanes = graph.subgraphs.map(source => {
    const nodes = new Set<string>()
    descendants(source, nodes)
    return { id: source.id, label: source.label, source, nodes }
  })
  const groupIds = new Set<string>()
  const visit = (group: MermaidSubgraph): void => { groupIds.add(group.id); group.children.forEach(visit) }
  graph.subgraphs.forEach(visit)
  const loose = new Set([...graph.nodes.keys()].filter(id => !assigned.has(id) && !groupIds.has(id)))
  if (loose.size) {
    let id = '__swimlane_default__'
    while (graph.nodes.has(id) || groupIds.has(id)) id += '_'
    lanes.push({ id, label: '', source: undefined, nodes: loose })
  }
  return lanes
}

/** Ordinary Flowchart prepares and measures each lane's compound contents.
 * Swimlane owns band placement and cross-lane routes; generic graph routing
 * is deliberately skipped rather than computed and discarded. */
export function layoutSwimlane(graph: MermaidGraph, options: RenderOptions = {}): PositionedGraph {
  assertMermaidGraphWork(graph)
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL'
  const padding = options.padding ?? 40, inset = 24, header = 40, gap = options.nodeSpacing ?? 32
  const lanes = swimlanePartitions(graph)
  const measured = lanes.map(lane => {
    const childIds = new Set<string>()
    const groups = lane.source?.children ?? []
    const visit = (group: MermaidSubgraph): void => { childIds.add(group.id); group.children.forEach(visit) }
    groups.forEach(visit)
    const members = new Set([...lane.nodes, ...childIds])
    const local = layoutNativeGraphPlacementSync({
      ...graph,
      nodes: new Map([...graph.nodes].filter(([id]) => members.has(id))),
      edges: graph.edges.filter(edge => members.has(edge.source) && members.has(edge.target)),
      subgraphs: groups,
    }, { ...options, padding: inset, nodeSpacing: Math.max(gap, 32), layerSpacing: Math.max(options.layerSpacing ?? 64, 64) })
    const title = preparePixelText(lane.source?.labelContent ?? lane.label, { display: 'formatted', fontSize: 14, fontWeight: 600 })
    return { lane, local, title, width: Math.max(local.width, title.width + 2 * inset, 80), height: Math.max(local.height, 48) + header }
  })
  const extent = Math.max(80, ...measured.map(item => horizontal ? item.width : item.height))
  const nodes: PositionedNode[] = [], groups: PositionedGroup[] = []
  let cursor = padding
  const shiftGroup = (group: PositionedGroup, dx: number, dy: number): void => {
    group.x += dx; group.y += dy
    group.children.forEach(child => shiftGroup(child, dx, dy))
  }
  for (const item of measured) {
    const x = horizontal ? padding : cursor, y = horizontal ? cursor : padding
    const width = horizontal ? extent : item.width, height = horizontal ? item.height : extent
    const dx = x, dy = y + header
    for (const node of item.local.nodes) { node.x += dx; node.y += dy; nodes.push(node) }
    item.local.groups.forEach(group => shiftGroup(group, dx, dy))
    groups.push({ id: item.lane.id, label: item.lane.label, labelContent: item.lane.source?.labelContent,
      x, y, width, height, headerHeight: header, labelBlock: item.title,
      nodeIds: item.lane.source?.nodeIds.filter(id => graph.nodes.has(id)) ?? [...item.lane.nodes], children: item.local.groups })
    cursor += (horizontal ? height : width) + gap
  }
  const width = horizontal ? extent + 2 * padding : Math.max(2 * padding, cursor - gap + padding)
  const height = horizontal ? Math.max(2 * padding, cursor - gap + padding) : extent + 2 * padding
  const byId = new Map<string, PositionedNode | PositionedGroup>(nodes.map(node => [node.id, node]))
  const collect = (group: PositionedGroup): void => { byId.set(group.id, group); group.children.forEach(collect) }
  groups.forEach(collect)
  const ports = (id: string, end: 'source' | 'target'): { port: Point; stub: Point } => {
    const node = byId.get(id)
    if (!node) throw new Error(`Swimlane edge ${end} "${id}" has no node or lane`)
    const side = horizontal ? (end === 'source' ? 'E' : 'W') : (end === 'source' ? 'S' : 'N')
    const actual = 'shape' in node ? shapeCardinalPorts(node)[side]
      : { x: node.x + node.width / 2, y: node.y + node.height / 2 }
    const port = 'shape' in node ? actual : side === 'E' ? { x: node.x + node.width, y: actual.y }
      : side === 'W' ? { x: node.x, y: actual.y } : side === 'S' ? { x: actual.x, y: node.y + node.height } : { x: actual.x, y: node.y }
    return { port, stub: horizontal
      ? { x: end === 'source' ? node.x + node.width + 12 : node.x - 12, y: port.y }
      : { x: port.x, y: end === 'source' ? node.y + node.height + 12 : node.y - 12 } }
  }
  const terminals = graph.edges.map(edge => ({ source: ports(edge.source, 'source'), target: ports(edge.target, 'target') }))
  const anchors = terminals.flatMap(pair => [pair.source.stub, pair.target.stub])
  const routingTerminals: Terminal[] = anchors.map(point => ({ port: point, stub: point, penalty: 0 }))
  // Containers are transparent responsibility regions. Nodes and header ink
  // remain obstacles even when a connector crosses an unrelated lane.
  const headers: Array<{ x: number; y: number; width: number; height: number }> = []
  const addHeader = (group: PositionedGroup): void => {
    headers.push({ x: group.x, y: group.y, width: group.width, height: group.headerHeight ?? header })
    group.children.forEach(addHeader)
  }
  groups.forEach(addHeader)
  const fail = (reason: string): never => { throw new Error(`Swimlane routing: ${reason}`) }
  const grid = graph.edges.length ? createSparseVisibilityGraph({ x: 0, y: 0, width, height }, [...nodes, ...headers], routingTerminals, anchors,
    8, { pairs: 8_000_000, arcs: 8_000_000, swaps: 8_000_000 }, 200_000, fail) : undefined
  try {
    const edges = graph.edges.map((edge, edgeIndex) => {
      const pair = terminals[edgeIndex]!
      const middle = grid!.route([{ port: pair.source.stub, stub: pair.source.stub, penalty: 0 }], pair.target.stub)
      const points = simplifyOrthogonal([pair.source.port, ...middle, pair.target.port])
      const segment = points.slice(1).map((point, index) => ({ a: points[index]!, b: point }))
        .sort((a, b) => (Math.abs(b.a.x - b.b.x) + Math.abs(b.a.y - b.b.y)) - (Math.abs(a.a.x - a.b.x) + Math.abs(a.a.y - a.b.y)))[0]
      return { ...edge, edgeIndex, points, inlineStyle: resolveEdgeInlineStyle(edgeIndex, graph),
        classNames: edge.id ? graphClassNames(graph.classAssignments.get(edge.id)) : [],
        ...(edge.label && segment ? { labelPosition: { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 } } : {}) }
    })
    return { width, height, nodes, groups, edges }
  } finally { grid?.retire() }
}
