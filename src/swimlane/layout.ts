import { layoutNativeGraphPlacementSync, retainGraphText } from '../layout-engine.ts'
import { resolveEdgeInlineStyle, resolveNodeInlineStyle } from '../color-resolver.ts'
import { graphClassNames } from '../shared/graph-classes.ts'
import { assertMermaidGraphWork } from '../shared/diagram-limits.ts'
import { graphTextBlock } from '../graph-text.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import { shapeCardinalPorts } from '../shape-outline.ts'
import { createSparseVisibilityGraph } from '../layout/compound-sparse-visibility.ts'
import { simplifyOrthogonal, type Terminal } from '../layout/compound-visibility.ts'
import type { MermaidGraph, MermaidSubgraph, Point, PositionedGraph, PositionedGroup, PositionedNode } from '../types.ts'
import { swimlanePartitions } from './model.ts'
export { swimlanePartitions } from './model.ts'

/** Ordinary Flowchart prepares and measures each lane's compound contents.
 * Swimlane owns band placement and cross-lane routes; generic graph routing
 * is deliberately skipped rather than computed and discarded. */
export function layoutSwimlane(graph: MermaidGraph, options: NonNullable<Parameters<typeof layoutNativeGraphPlacementSync>[1]> = {}, diagramTitle?: string): PositionedGraph {
  assertMermaidGraphWork(graph)
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL'
  const padding = options.padding ?? 40, inset = 24, gap = Math.max(48, options.nodeSpacing ?? 32)
  const style = resolveRenderStyle(options, undefined, options.styleFace)
  const titleBand = diagramTitleBand(diagramTitle, style)
  const lanes = swimlanePartitions(graph)
  // Build lane inputs once. Filtering the entire graph for every lane makes
  // a diagram with many small lanes need quadratic ownership work.
  const owners = new Map<string, number>()
  const inputs = lanes.map((lane, index) => {
    for (const id of lane.nodes) owners.set(id, index)
    const groups = lane.source?.children ?? []
    const visit = (group: MermaidSubgraph): void => { owners.set(group.id, index); group.children.forEach(visit) }
    groups.forEach(visit)
    return { ...graph, nodes: new Map<string, typeof graph.nodes extends Map<string, infer N> ? N : never>(), edges: [] as MermaidGraph['edges'], subgraphs: groups }
  })
  for (const [id, node] of graph.nodes) {
    const owner = owners.get(id)
    if (owner !== undefined) inputs[owner]!.nodes.set(id, node)
  }
  for (const edge of graph.edges) {
    const owner = owners.get(edge.source)
    if (owner !== undefined && owner === owners.get(edge.target)) inputs[owner]!.edges.push(edge)
  }
  const measured = lanes.map((lane, index) => {
    const local = layoutNativeGraphPlacementSync(inputs[index]!, { ...options, padding: inset, nodeSpacing: Math.max(gap, 32), layerSpacing: Math.max(options.layerSpacing ?? 64, 64) })
    // An isolated task is a complete component, not a new process row. Pack
    // independent components along the authored process direction inside the
    // lane so matching hand-offs retain separate, short crossing channels.
    if (!local.groups.length && local.nodes.length > 1) {
      const parent = new Map(local.nodes.map(node => [node.id, node.id]))
      const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; while (id !== root) { const next = parent.get(id)!; parent.set(id, root); id = next } return root }
      for (const edge of inputs[index]!.edges) { const a = find(edge.source), b = find(edge.target); if (a !== b) parent.set(b, a) }
      const components = new Map<string, PositionedNode[]>()
      for (const node of local.nodes) { const key = find(node.id), members = components.get(key) ?? []; members.push(node); components.set(key, members) }
      let cursor = inset, crossExtent = 0
      for (const component of components.values()) {
        const left = Math.min(...component.map(node => node.x)), top = Math.min(...component.map(node => node.y)), width = Math.max(...component.map(node => node.x + node.width)) - left, height = Math.max(...component.map(node => node.y + node.height)) - top
        const dx = (horizontal ? cursor : inset) - left, dy = (horizontal ? inset : cursor) - top
        for (const node of component) { node.x += dx; node.y += dy }
        cursor += (horizontal ? width : height) + gap
        crossExtent = Math.max(crossExtent, horizontal ? height : width)
      }
      local.width = horizontal ? cursor - gap + inset : crossExtent + inset * 2
      local.height = horizontal ? crossExtent + inset * 2 : cursor - gap + inset
    }
    retainGraphText({ ...local, edges: [] }, style)
    const title = graphTextBlock(resolveLabelContent(lane.label, lane.source?.labelContent), style, 'group')
    const header = Math.max(40, title.height + 16)
    return { lane, local, title, header, width: Math.max(local.width, title.width + 2 * inset, 80), height: Math.max(local.height, 48) + header }
  })
  const extent = Math.max(80, ...measured.map(item => horizontal ? item.width : item.height))
  const nodes: PositionedNode[] = [], groups: PositionedGroup[] = []
  let cursor = padding
  const shiftGroup = (group: PositionedGroup, dx: number, dy: number): void => {
    group.x += dx; group.y += dy
    group.children.forEach(child => shiftGroup(child, dx, dy))
  }
  for (const item of measured) {
    const x = horizontal ? padding : cursor, y = (horizontal ? cursor : padding) + (titleBand?.height ?? 0)
    const width = horizontal ? extent : item.width, height = horizontal ? item.height : extent
    const dx = x, dy = y + item.header
    for (const node of item.local.nodes) { node.x += dx; node.y += dy; nodes.push(node) }
    item.local.groups.forEach(group => shiftGroup(group, dx, dy))
    groups.push({ id: item.lane.id, label: item.lane.label, labelContent: item.lane.source?.labelContent,
      x, y, width, height, headerHeight: item.header, labelBlock: item.title, inlineStyle: resolveNodeInlineStyle(item.lane.id, graph),
      nodeIds: item.lane.source?.nodeIds.filter(id => graph.nodes.has(id)) ?? [...item.lane.nodes], children: item.local.groups })
    cursor += (horizontal ? height : width) + gap
  }
  const width = Math.max(titleBand ? titleBand.width + 2 * padding : 0, horizontal ? extent + 2 * padding : Math.max(2 * padding, cursor - gap + padding))
  const height = (horizontal ? Math.max(2 * padding, cursor - gap + padding) : extent + 2 * padding) + (titleBand?.height ?? 0)
  const byId = new Map<string, PositionedNode | PositionedGroup>(nodes.map(node => [node.id, node]))
  const collect = (group: PositionedGroup): void => { byId.set(group.id, group); group.children.forEach(collect) }
  groups.forEach(collect)
  const ports = (id: string, other: string, end: 'source' | 'target'): { port: Point; stub: Point } => {
    const node = byId.get(id)
    if (!node) throw new Error(`Swimlane edge ${end} "${id}" has no node or lane`)
    const forward = graph.direction !== 'RL' && graph.direction !== 'BT'
    const exiting = end === 'source' ? forward : !forward
    const ownLane = owners.get(id), otherLane = owners.get(other), crossing = ownLane !== undefined && otherLane !== undefined && ownLane !== otherLane
    const side = crossing ? (horizontal ? (otherLane > ownLane ? 'S' : 'N') : (otherLane > ownLane ? 'E' : 'W')) : horizontal ? (exiting ? 'E' : 'W') : (exiting ? 'S' : 'N')
    const actual = 'shape' in node ? shapeCardinalPorts(node)[side]
      : { x: node.x + node.width / 2, y: node.y + node.height / 2 }
    const port = 'shape' in node ? actual : side === 'E' ? { x: node.x + node.width, y: actual.y }
      : side === 'W' ? { x: node.x, y: actual.y } : side === 'S' ? { x: actual.x, y: node.y + node.height } : { x: actual.x, y: node.y }
    return { port, stub: { x: port.x + (side === 'E' ? 12 : side === 'W' ? -12 : 0), y: port.y + (side === 'S' ? 12 : side === 'N' ? -12 : 0) } }
  }
  const terminals = graph.edges.map(edge => ({ source: ports(edge.source, edge.target, 'source'), target: ports(edge.target, edge.source, 'target') }))
  const anchors = terminals.flatMap(pair => [pair.source.stub, pair.target.stub])
  const routingTerminals: Terminal[] = anchors.map(point => ({ port: point, stub: point, penalty: 0 }))
  // Containers are transparent responsibility regions. Nodes and header ink
  // remain obstacles even when a connector crosses an unrelated lane.
  const headers: Array<{ x: number; y: number; width: number; height: number }> = []
  const addHeader = (group: PositionedGroup): void => {
    // Responsibility boundaries are crossed perpendicularly; only actual
    // heading ink is an obstacle, not the entire width of an empty header.
    const block = group.labelBlock, header = group.headerHeight ?? 40
    headers.push({ x: group.x + 12, y: group.y + (header - (block?.height ?? 16)) / 2 - 6, width: (block?.width ?? group.width - 24) + 12, height: (block?.height ?? 16) + 12 })
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
      return { ...edge, edgeIndex, points, ...(edge.label !== undefined ? { labelBlock: graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge') } : {}), inlineStyle: resolveEdgeInlineStyle(edgeIndex, graph),
        classNames: edge.id ? graphClassNames(graph.classAssignments.get(edge.id)) : [],
        ...(edge.label && segment ? { labelPosition: { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 } } : {}) }
    })
    return { width, height, nodes, groups, edges, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, padding) } : {}) }
  } finally { grid?.retire() }
}
