import { layoutNativeGraphPlacementSync, retainGraphText, translatePositionedGraph } from '../layout-engine.ts'
import { resolveEdgeInlineStyle, resolveNodeInlineStyle } from '../color-resolver.ts'
import { graphClassNames } from '../shared/graph-classes.ts'
import { assertMermaidGraphWork } from '../shared/diagram-limits.ts'
import { graphTextBlock } from '../graph-text.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import { pointOnRoutingBoundary, shapeCardinalPorts, shapeRoutingProfile } from '../shape-outline.ts'
import { createSparseVisibilityGraph } from '../layout/compound-sparse-visibility.ts'
import { simplifyOrthogonal, type Terminal } from '../layout/compound-visibility.ts'
import { rectsOverlap } from '../layout/geometry.ts'
import { segmentEntersMeasuredBox, type MeasuredBox } from '../layout/measured-route-safety.ts'
import { bundledLabelCandidates, labelBoxAt } from '../layout/passes/bundled-labels.ts'
import { labelTouchesNeighborRoute, symmetricParallelOuterLanePoints } from '../layout/passes/parallel-lanes.ts'
import { translateGeometryToNonNegativeOrigin } from '../layout/route-geometry.ts'
import { labelHaloExtension } from '../shared/edge-label-geometry.ts'
import type { Direction, MermaidGraph, MermaidSubgraph, Point, PositionedEdge, PositionedGraph, PositionedGroup, PositionedNode } from '../types.ts'
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
  const owners = new Map<string, number>(), sourceGroups = new Map<string, MermaidSubgraph>()
  const inputs = lanes.map((lane, index) => {
    owners.set(lane.id, index)
    for (const id of lane.nodes) owners.set(id, index)
    const groups = lane.source?.children ?? []
    const visit = (group: MermaidSubgraph): void => { owners.set(group.id, index); sourceGroups.set(group.id, group); group.children.forEach(visit) }
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
    const source = sourceGroups.get(group.id)
    if (source) group.nodeIds = source.nodeIds.filter(id => graph.nodes.has(id))
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
  let width = Math.max(titleBand ? titleBand.width + 2 * padding : 0, horizontal ? extent + 2 * padding : Math.max(2 * padding, cursor - gap + padding))
  let height = (horizontal ? Math.max(2 * padding, cursor - gap + padding) : extent + 2 * padding) + (titleBand?.height ?? 0)
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
  const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({ ...edge, edgeIndex, points: [],
    ...(edge.label !== undefined ? { labelBlock: graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge') } : {}),
    inlineStyle: resolveEdgeInlineStyle(edgeIndex, graph), classNames: edge.id ? graphClassNames(graph.classAssignments.get(edge.id)) : [] }))
  const channels = parallelHandoffChannels(byId, edges, headers, owners, horizontal, style)
  const terminals = edges.map(edge => {
    const channel = channels.get(edge)
    return channel ? { source: { port: channel.points[0]!, stub: channel.points[1]! }, target: { port: channel.points.at(-1)!, stub: channel.points.at(-2)! } }
      : { source: ports(edge.source, edge.target, 'source'), target: ports(edge.target, edge.source, 'target') }
  })
  const anchors = terminals.flatMap(pair => [pair.source.stub, pair.target.stub])
  for (const channel of channels.values()) {
    anchors.push(...channel.points.slice(2, -2))
    if (channel.caption) for (const x of [channel.caption.x, channel.caption.x + channel.caption.width]) for (const y of [channel.caption.y, channel.caption.y + channel.caption.height]) anchors.push({ x, y })
  }
  const reservedCaptions = [...channels].flatMap(([owner, channel]) => channel.caption ? [{ owner, box: channel.caption }] : [])
  const routingTerminals: Terminal[] = anchors.map(point => ({ port: point, stub: point, penalty: 0 }))
  let left = 0, top = 0, right = width, bottom = height
  if (channels.size) for (const point of anchors) {
    left = Math.min(left, point.x - padding); top = Math.min(top, point.y - padding)
    right = Math.max(right, point.x + padding); bottom = Math.max(bottom, point.y + padding)
  }
  // The visibility kernel admits obstacle boundaries. Occurrence detours can
  // graze a card on the way to an outside channel, so reserve painted clearance.
  const clearance = channels.size ? Math.max(8, style.lineWidth * 2 + 2) : 0
  const obstacles = channels.size ? [...nodes.map(box => ({ x: box.x - clearance, y: box.y - clearance, width: box.width + clearance * 2, height: box.height + clearance * 2 })), ...headers.map(box => ({ x: box.x - 2, y: box.y - 2, width: box.width + 4, height: box.height + 4 }))] : [...nodes, ...headers]
  const grid = graph.edges.length ? createSparseVisibilityGraph({ x: left, y: top, width: right - left, height: bottom - top }, obstacles, routingTerminals, anchors,
    8, { pairs: 8_000_000, arcs: 8_000_000, swaps: 8_000_000 }, 200_000, fail) : undefined
  try {
    for (const [edgeIndex, edge] of edges.entries()) {
      const pair = terminals[edgeIndex]!, channel = channels.get(edge)
      const stops = channel ? channel.points.slice(1, -1) : [pair.source.stub, pair.target.stub]
      const points = [pair.source.port, stops[0]!]
      for (let index = 1; index < stops.length; index++) {
        const start = stops[index - 1]!
        points.push(...grid!.route([{ port: start, stub: start, penalty: 0 }], stops[index]!, undefined,
          (a, b) => reservedCaptions.every(candidate => candidate.owner === edge || !segmentEntersMeasuredBox(a, b, candidate.box))).slice(1))
      }
      edge.points = simplifyOrthogonal([...points, pair.target.port])
      if (!channel && edge.label) {
        const segment = edge.points.slice(1).map((point, index) => ({ a: edge.points[index]!, b: point }))
          .sort((a, b) => (Math.abs(b.a.x - b.b.x) + Math.abs(b.a.y - b.b.y)) - (Math.abs(a.a.x - a.b.x) + Math.abs(a.a.y - a.b.y)))[0]
        if (segment) edge.labelPosition = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 }
      }
    }
    seatParallelHandoffLabels(nodes, edges, headers, channels, style, fail)
    if (channels.size) {
      let halo = 0
      for (const edge of edges) if (edge.label) halo = Math.max(halo, labelHaloExtension(edge, style.lineWidth))
      translateGeometryToNonNegativeOrigin(nodes, edges, groups, padding, style, halo)
      if (titleBand) {
        // Outside channels can normalize above the original lane placement,
        // or stay positive while still entering the title band. Move all
        // content together, reserving the complete caption paint envelope.
        let contentTop = Infinity
        for (const node of nodes) contentTop = Math.min(contentTop, node.y - style.lineWidth / 2)
        for (const group of groups) contentTop = Math.min(contentTop, group.y - style.lineWidth / 2)
        for (const edge of edges) {
          const stroke = style.lineWidth * (edge.style === 'thick' ? 2 : 1)
          for (const point of edge.points) contentTop = Math.min(contentTop, point.y - stroke / 2)
          if (edge.label && edge.labelPosition) contentTop = Math.min(contentTop, labelBoxAt(edge, edge.labelPosition, style).y - labelHaloExtension(edge, style.lineWidth))
        }
        const shift = padding + titleBand.height - contentTop
        if (shift > 0) translatePositionedGraph({ width, height, nodes, groups, edges }, shift)
      }
      const grow = (box: MeasuredBox): void => {
        width = Math.max(width, box.x + box.width + padding)
        height = Math.max(height, box.y + box.height + padding)
      }
      nodes.forEach(grow); groups.forEach(grow)
      for (const edge of edges) {
        for (const point of edge.points) {
          width = Math.max(width, point.x + padding); height = Math.max(height, point.y + padding)
        }
        if (edge.label && edge.labelPosition) {
          const box = labelBoxAt(edge, edge.labelPosition, style)
          grow({ x: box.x - halo, y: box.y - halo, width: box.width + halo * 2, height: box.height + halo * 2 })
        }
      }
    }
    return { width, height, nodes, groups, edges, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, padding) } : {}) }
  } finally { grid?.retire() }
}

/** Occurrences, including reverse hand-offs, need individual painted channels.
 * Reuse graph lane geometry while responsibility frames stay transparent. Each
 * approach is still routed by the shared obstacle graph, including nested ink. */
type HandoffChannel = { points: Point[]; direction: Direction; caption?: MeasuredBox }

function parallelHandoffChannels(byId: ReadonlyMap<string, PositionedNode | PositionedGroup>, edges: PositionedEdge[], headers: MeasuredBox[], owners: ReadonlyMap<string, number>, horizontal: boolean, style: ReturnType<typeof resolveRenderStyle>): Map<PositionedEdge, HandoffChannel> {
  const pairs = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.source === edge.target || edge.style === 'invisible' || !byId.has(edge.source) || !byId.has(edge.target)) continue
    const key = [edge.source, edge.target].sort().join('\0'), pair = pairs.get(key) ?? []
    pair.push(edge); pairs.set(key, pair)
  }
  const channels = new Map<PositionedEdge, HandoffChannel>()
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const box of [...byId.values(), ...headers]) {
    left = Math.min(left, box.x); top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.width); bottom = Math.max(bottom, box.y + box.height)
  }
  let pitchX = 24, pitchY = 24
  for (const pair of pairs.values()) if (pair.length > 1) for (const edge of pair) {
    const halo = labelHaloExtension(edge, style.lineWidth)
    pitchX = Math.max(pitchX, (edge.labelBlock?.width ?? 0) + 24 + 2 * halo)
    pitchY = Math.max(pitchY, (edge.labelBlock?.height ?? 0) + 24 + 2 * halo)
  }
  let occurrence = 0
  for (const pair of pairs.values()) {
    if (pair.length < 2) continue
    const first = pair[0]!, crossLane = owners.get(first.source) !== owners.get(first.target)
    const alongX = crossLane ? !horizontal : horizontal
    const cross = alongX ? 'y' : 'x'
    const low = alongX ? top : left, high = alongX ? bottom : right, pitch = alongX ? pitchY : pitchX
    for (const [index, edge] of pair.entries()) {
      const source = byId.get(edge.source)!, target = byId.get(edge.target)!
      const positive = alongX ? target.x + target.width / 2 >= source.x + source.width / 2 : target.y + target.height / 2 >= source.y + source.height / 2
      const direction: Direction = alongX ? positive ? 'LR' : 'RL' : positive ? 'TD' : 'BT'
      const channelIndex = occurrence++
      const offset = pitch / 2 + 16 + Math.floor(channelIndex / 2) * pitch
      const lane = channelIndex % 2 ? high + offset : low - offset
      // The shared kernel needs only endpoint rectangles. Group frames have a
      // rectangular boundary; task ports are clipped back to their true shape.
      const sourceNode: PositionedNode = 'shape' in source ? source : { ...source, shape: 'rectangle' }
      const targetNode: PositionedNode = 'shape' in target ? target : { ...target, shape: 'rectangle' }
      const points = symmetricParallelOuterLanePoints(sourceNode, targetNode, direction, lane, index, pair.length)
      for (const [node, at, side] of [[sourceNode, 0, alongX ? positive ? 'E' : 'W' : positive ? 'S' : 'N'], [targetNode, points.length - 1, alongX ? positive ? 'W' : 'E' : positive ? 'N' : 'S']] as const) {
        const port = pointOnRoutingBoundary(shapeRoutingProfile(node).boundary, side, points[at]![cross])
        if (port) {
          points[at] = port
          points[at === 0 ? 1 : points.length - 2] = side === 'E' ? { x: node.x + node.width + 12, y: port.y }
            : side === 'W' ? { x: node.x - 12, y: port.y }
              : side === 'S' ? { x: port.x, y: node.y + node.height + 12 } : { x: port.x, y: node.y - 12 }
        }
      }
      // Reserve a segment that fits the complete painted caption. Nearby
      // task faces otherwise leave too little room even on an outside lane.
      const axis = alongX ? 'x' : 'y', alongSize = alongX ? 'width' : 'height'
      const a = points[2]!, b = points[points.length - 3]!
      const needed = (edge.labelBlock?.[alongSize] ?? 0) + 64 + 2 * labelHaloExtension(edge, style.lineWidth)
      if (Math.abs(b[axis] - a[axis]) < needed) {
        const midpoint = (a[axis] + b[axis]) / 2, sign = positive ? 1 : -1
        a[axis] = midpoint - sign * needed / 2
        b[axis] = midpoint + sign * needed / 2
      }
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const pill = edge.label ? labelBoxAt(edge, center, style) : undefined
      const halo = labelHaloExtension(edge, style.lineWidth) + 4
      const caption = pill ? { x: pill.x - halo, y: pill.y - halo, width: pill.width + halo * 2, height: pill.height + halo * 2 } : undefined
      channels.set(edge, { points, direction, caption })
    }
  }
  return channels
}

function seatParallelHandoffLabels(nodes: PositionedNode[], edges: PositionedEdge[], headers: MeasuredBox[], channels: ReadonlyMap<PositionedEdge, { direction: Direction }>, style: ReturnType<typeof resolveRenderStyle>, fail: (reason: string) => never): void {
  for (const [edge, channel] of channels) {
    if (!edge.label) continue
    const halo = labelHaloExtension(edge, style.lineWidth)
    const seat = bundledLabelCandidates(edge, edge.points, nodes, channel.direction, style, (_edge, point) => {
      const pill = labelBoxAt(edge, point, style), box = { x: pill.x - halo, y: pill.y - halo, width: pill.width + halo * 2, height: pill.height + halo * 2 }
      if (headers.some(header => rectsOverlap(box, header, 2)) || nodes.some(node => rectsOverlap(box, node, 2))) return false
      if (edges.some(other => other !== edge && other.label && other.labelPosition && rectsOverlap(box, labelBoxAt(other, other.labelPosition, style), halo + 2))) return false
      return !labelTouchesNeighborRoute(edge, { x: box.x, y: box.y, w: box.width, h: box.height }, edges)
    })[0]
    if (!seat) fail('parallel hand-off caption has no clear owned segment')
    edge.labelPosition = seat.point
  }
}
