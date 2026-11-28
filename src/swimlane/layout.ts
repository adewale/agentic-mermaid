import { estimateNodeSize, layoutElkGraphPlacementSync, retainGraphText, translatePositionedGraph } from '../layout-engine.ts'
import { resolveEdgeInlineStyle, resolveNodeInlineStyle } from '../color-resolver.ts'
import { graphClassNames } from '../shared/graph-classes.ts'
import { assertMermaidGraphWork } from '../shared/diagram-limits.ts'
import { graphTextBlock } from '../graph-text.ts'
import { graphGroupHeader } from '../graph-group-header.ts'
import { positionedHeaderRouteFindings } from '../layout/certification.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { mergeUncertifiedLayout } from '../layout/uncertified-layout.ts'
import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import { pointOnRoutingBoundary, shapeCardinalPorts, shapeRoutingProfile } from '../shape-outline.ts'
import { routeOrthogonal, routeStraight, type RouterBox, type RouterDirection } from '../layout/orthogonal-router.ts'
import { rectsOverlap } from '../layout/geometry.ts'
import type { MeasuredBox } from '../layout/measured-route-safety.ts'
import { bundledLabelCandidates, labelBoxAt, terminalLabelCorridorLength } from '../layout/passes/bundled-labels.ts'
import { labelTouchesNeighborRoute } from '../layout/passes/parallel-lanes.ts'
import { CLEARANCE, translateGeometryToNonNegativeOrigin } from '../layout/route-geometry.ts'
import { labelHaloExtension } from '../shared/edge-label-geometry.ts'
import type { Direction, MermaidGraph, MermaidSubgraph, Point, PositionedEdge, PositionedGraph, PositionedGroup, PositionedNode } from '../types.ts'
import { swimlanePartitions } from './model.ts'
export { swimlanePartitions } from './model.ts'

/** Ordinary Flowchart prepares and measures each lane's compound contents.
 * Swimlane owns band placement and all final routes; ELK supplies measured
 * placement without generic Flowchart route completion. */
export function layoutSwimlane(graph: MermaidGraph, options: NonNullable<Parameters<typeof layoutElkGraphPlacementSync>[1]> = {}, diagramTitle?: string): PositionedGraph {
  assertMermaidGraphWork(graph)
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL'
  const padding = options.padding ?? 40, inset = 24, gap = Math.max(48, options.nodeSpacing ?? 32)
  const style = resolveRenderStyle(options, undefined, options.styleFace)
  const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({ ...edge, edgeIndex, points: [],
    ...(graph.linkCurves?.size ? { curve: edge.curve ?? graph.linkCurves.get(edgeIndex) ?? graph.linkCurves.get('default') } : {}),
    ...(edge.label !== undefined ? { labelBlock: graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge') } : {}),
    inlineStyle: resolveEdgeInlineStyle(edgeIndex, graph), classNames: edge.id ? graphClassNames(graph.classAssignments.get(edge.id)) : [] }))
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
  // Self-loops have no rank/order contribution. Swimlane owns their routes,
  // so generic placement's loop-attachment capacity must not reject them.
  for (const edge of graph.edges) {
    const owner = owners.get(edge.source)
    if (edge.source !== edge.target && owner !== undefined && owner === owners.get(edge.target)) inputs[owner]!.edges.push(edge)
  }
  const occurrences = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.style === 'invisible') continue
    const key = [edge.source, edge.target].sort().join('\0'), pair = occurrences.get(key) ?? []
    pair.push(edge); occurrences.set(key, pair)
  }
  for (const [key, pair] of occurrences) if (pair.length < 2 && pair[0]!.source !== pair[0]!.target) occurrences.delete(key)
  // Independent caption seating needs genuine room between lanes for its
  // terminal markers and visible shaft, including ordinary hand-offs that
  // interact with an occurrence channel. Measure that space once, before packing.
  let laneGap = gap, contentGap = gap, layerGap = Math.max(options.layerSpacing ?? 64, 64)
  if (occurrences.size) for (const edge of edges) {
    if (edge.style === 'invisible' || edge.source === edge.target) continue
    if (owners.get(edge.source) !== owners.get(edge.target)) laneGap = Math.max(laneGap, terminalLabelCorridorLength(edge, horizontal ? 'TD' : 'LR', style))
    else {
      const corridor = terminalLabelCorridorLength(edge, graph.direction, style)
      contentGap = Math.max(contentGap, corridor); layerGap = Math.max(layerGap, corridor)
    }
  }
  const clearance = occurrences.size ? Math.max(8, (style.edgeBendRadius ?? 0) + style.lineWidth / 2) : 0
  const stubGap = Math.max(12, clearance + 4)
  // The face a route leaves or enters a task by: across lanes toward the
  // other lane, within one along the process direction.
  const portSide = (id: string, other: string, end: 'source' | 'target'): RouterDirection => {
    const forward = graph.direction !== 'RL' && graph.direction !== 'BT'
    const exiting = end === 'source' ? forward : !forward
    const ownLane = owners.get(id), otherLane = owners.get(other), crossing = ownLane !== undefined && otherLane !== undefined && ownLane !== otherLane
    return crossing ? (horizontal ? (otherLane > ownLane ? 'S' : 'N') : (otherLane > ownLane ? 'E' : 'W')) : horizontal ? (exiting ? 'E' : 'W') : (exiting ? 'S' : 'N')
  }
  const loops = selfLoopPlans(graph, edges, occurrences, owners, horizontal, portSide)
  const nodeSizes = occurrences.size ? occurrenceNodeSizes(graph, occurrences, owners, horizontal, style, options.nodeSizes, loops) : options.nodeSizes
  // Placement reserves each task's self-loops beside it, inside its own lane
  // and groups: the reserve is centred across the process direction, so
  // routes between aligned tasks stay straight, and one-sided along it.
  const reserves = new Map<string, Record<RouterDirection, number>>()
  const placementSizes = loops.size ? new Map(nodeSizes) : nodeSizes
  for (const [id, plan] of loops) {
    const node = graph.nodes.get(id)!
    const size = nodeSizes?.get(id) ?? estimateNodeSize(id, resolveLabelContent(node.label, node.labelContent), node.shape, style, graph.direction, undefined, node.labelBlock)
    const reach = selfLoopGeometry(plan, size.width, size.height, style, stubGap).reach
    const across = horizontal ? Math.max(reach.N, reach.S) : Math.max(reach.E, reach.W)
    const reserve = horizontal ? { ...reach, N: across, S: across } : { ...reach, E: across, W: across }
    reserves.set(id, reserve)
    ;(placementSizes as Map<string, { width: number; height: number }>).set(id, { width: size.width + reserve.W + reserve.E, height: size.height + reserve.N + reserve.S })
  }
  const measured = lanes.map((lane, index) => {
    const local = layoutElkGraphPlacementSync(inputs[index]!, { ...options, padding: inset, nodeSpacing: contentGap, layerSpacing: layerGap, nodeSizes: placementSizes })
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
    for (const node of local.nodes) {
      const reserve = reserves.get(node.id)
      if (!reserve) continue
      // Across the process direction the reserve is centred: keep the
      // task's centre exactly where placement aligned it.
      const width = node.width - reserve.W - reserve.E, height = node.height - reserve.N - reserve.S
      if (horizontal) { node.x += reserve.W; node.y = node.y + node.height / 2 - height / 2 }
      else { node.x = node.x + node.width / 2 - width / 2; node.y += reserve.N }
      node.width = width; node.height = height
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
    cursor += (horizontal ? height : width) + laneGap
  }
  let width = Math.max(titleBand ? titleBand.width + 2 * padding : 0, horizontal ? extent + 2 * padding : Math.max(2 * padding, cursor - laneGap + padding))
  let height = (horizontal ? Math.max(2 * padding, cursor - laneGap + padding) : extent + 2 * padding) + (titleBand?.height ?? 0)
  const byId = new Map<string, PositionedNode | PositionedGroup>(nodes.map(node => [node.id, node]))
  const collect = (group: PositionedGroup): void => { byId.set(group.id, group); group.children.forEach(collect) }
  groups.forEach(collect)
  const ports = (id: string, other: string, end: 'source' | 'target'): Terminal => {
    const node = byId.get(id)
    if (!node) throw new Error(`Swimlane edge ${end} "${id}" has no node or lane`)
    const side = portSide(id, other, end)
    const actual = 'shape' in node ? shapeCardinalPorts(node)[side]
      : { x: node.x + node.width / 2, y: node.y + node.height / 2 }
    const port = 'shape' in node ? actual : side === 'E' ? { x: node.x + node.width, y: actual.y }
      : side === 'W' ? { x: node.x, y: actual.y } : side === 'S' ? { x: actual.x, y: node.y + node.height } : { x: actual.x, y: node.y }
    return terminal(node, port, side, stubGap)
  }
  // Containers are transparent responsibility regions. Nodes and header ink
  // remain obstacles even when a connector crosses an unrelated lane.
  const headers: MeasuredBox[] = [], bands: MeasuredBox[] = []
  const addHeader = (group: PositionedGroup): void => {
    // Responsibility boundaries are crossed perpendicularly (HeaderCrossing
    // 'perpendicular'): no segment may travel inside the painted band, so a
    // crossing runs edge to edge, and it passes beside the painted title. The
    // title's leading padding is reserved with it, since a crossing between
    // the frame edge and the title would hug both.
    const { band, title } = graphGroupHeader(group, style)
    headers.push({ x: band.x - 6, y: title.y - 6, width: title.x + title.width + 12 - band.x, height: title.height + 12 })
    bands.push(band)
    group.children.forEach(addHeader)
  }
  groups.forEach(addHeader)
  const fail = (reason: string): never => { throw new Error(`Swimlane routing: ${reason}`) }
  const channels = handoffChannels(byId, occurrences, headers, owners, horizontal, style, stubGap, loops)
  // Occurrence detours run outside the content, so they keep painted
  // clearance from every card they pass on the way.
  const obstacles = channels.size ? [...nodes.map(box => routerBox(box, clearance)), ...headers.map(box => routerBox(box, 2))] : [...nodes.map(box => routerBox(box, CLEARANCE)), ...headers.map(box => routerBox(box))]
  // A route crosses a painted header band, stroke included, only
  // perpendicularly.
  const across = { horizontal: bands.map(box => routerBox(box, style.lineWidth / 2)) }
  // Lane and group frames are crossed, never followed: a run along a border
  // reads as the border, or as attached to the lane. Only where no route
  // keeps off them does a route ask again without them.
  const frameBoxes: RouterBox[] = []
  const addFrame = (group: PositionedGroup): void => { frameBoxes.push(routerBox(group)); group.children.forEach(addFrame) }
  groups.forEach(addFrame)
  const swimlaneFrames: SwimlaneFrames = { bands, boxes: frameBoxes }
  const frameClearance = Math.max(CLEARANCE, clearance), frameRules = [{ boxes: frameBoxes, clearance: frameClearance }, undefined]
  const separation = Math.max(6, clearance)
  // Lines across each gap between lanes, a separation apart, for routes that
  // find no line of their own on the ordinary grid.
  const gapLines: number[] = []
  for (let k = 1; k < groups.length; k++) {
    const previous = groups[k - 1]!, next = groups[k]!
    const from = (horizontal ? previous.y + previous.height : previous.x + previous.width) + frameClearance, to = (horizontal ? next.y : next.x) - frameClearance
    for (let at = from; at <= to + 1e-6; at += separation) gapLines.push(at)
  }
  const gapChannels = horizontal ? { y: gapLines } : { x: gapLines }
  // Each route's terminals, and the stubs they fix before any route is drawn.
  const stubOf = (end: Terminal): readonly [Point, Point] => [end.port, { x: end.port.x + STEP[end.side].x * end.stub, y: end.port.y + STEP[end.side].y * end.stub }]
  const terminals = edges.map(edge => {
    const channel = channels.get(edge)
    const source = channel?.source ?? ports(edge.source, edge.target, 'source'), target = channel?.target ?? ports(edge.target, edge.source, 'target')
    return { source, target, stubs: [stubOf(source), stubOf(target)] }
  })
  // Centred ports on facing faces of offset tasks jog a few pixels between
  // them (merman#242). A hand-off alone on both of its faces moves its two
  // ends along them, within the middle half of each, to one straight run
  // that keeps off every task, header, frame and other route's stub.
  const faceUse = new Map<string, number>()
  edges.forEach((edge, order) => {
    for (const [id, end] of [[edge.source, terminals[order]!.source], [edge.target, terminals[order]!.target]] as const) faceUse.set(`${id}\0${end.side}`, (faceUse.get(`${id}\0${end.side}`) ?? 0) + 1)
  })
  edges.forEach((edge, order) => {
    const { source, target } = terminals[order]!
    const from = byId.get(edge.source), to = byId.get(edge.target)
    if (channels.has(edge) || edge.source === edge.target || source.side !== OPPOSITE[target.side] || !from || !to || !('shape' in from) || !('shape' in to)) return
    if (![from, to].every(node => STRAIGHT_FACES.has(node.shape)) || faceUse.get(`${edge.source}\0${source.side}`) !== 1 || faceUse.get(`${edge.target}\0${target.side}`) !== 1) return
    if (Math.abs(source.port.x - target.port.x) < 1e-6 || Math.abs(source.port.y - target.port.y) < 1e-6) return
    const vertical = source.side === 'N' || source.side === 'S'
    const middle = (node: PositionedNode) => (vertical ? [node.x + node.width / 4, node.x + node.width * 3 / 4] : [node.y + node.height / 4, node.y + node.height * 3 / 4]) as [number, number]
    const others = terminals.flatMap((other, k) => k === order ? [] : other.stubs)
    const regions = [...channels.values()].flatMap(channel => channel.region ? [channel.region] : [])
    const captions = [...channels.values()].flatMap(channel => channel.stretches[0]![0]!.caption ? [routerBox(channel.stretches[0]![0]!.caption)] : [])
    const straight = routeStraight({ start: source.port, end: target.port, exit: source.side, entry: OPPOSITE[target.side], stub: [source.stub, target.stub], clearance: 0,
      obstacles: [...obstacles, ...regions, ...captions], axisObstacles: across, frames: frameRules[0]!, avoid: { segments: others, separation, gap: stubGap } }, { start: middle(from), end: middle(to) })
    if (!straight) return
    const ends = { source: terminal(from, straight[0]!, source.side, stubGap), target: terminal(to, straight[1]!, target.side, stubGap) }
    terminals[order] = { ...ends, stubs: [stubOf(ends.source), stubOf(ends.target)] }
  })
  // Every caption must find a clear seat on its own route. Where the routes
  // leave one no room, route again keeping less strictly off the routes
  // already drawn: first only off lines that do not meet a route's own
  // ports, then off every line or only unrelated ones, then off none.
  for (let policy = 0; ; policy++) {
    // Each occurrence keeps its caption stretch clear of every other route.
    const reserved = new Map<PositionedEdge, RouterBox>()
    for (const [owner, channel] of channels) if (channel.stretches[0]![0]!.caption) reserved.set(owner, routerBox(channel.stretches[0]![0]!.caption))
    // A route keeps off the lines of routes already drawn where it can, so
    // independent connectors do not read as one shared bus.
    const drawn: (readonly [Point, Point])[] = [], drawnBy: PositionedEdge[] = []
    // Crossing one costs as much as a modest detour, never a bend.
    const crossings = { segments: drawn, cost: 400 }
    for (const [order, edge] of edges.entries()) {
      const { source, target } = terminals[order]!, channel = channels.get(edge)
      // Unrelated routes (no shared task or lane) do not share a line: a
      // route keeps off theirs, drawn or still to come (their stubs are
      // already fixed by their ports). Related routes may share a trunk.
      const related = (other: PositionedEdge) => other.source === edge.source || other.source === edge.target || other.target === edge.source || other.target === edge.target
      const later = edges.slice(order + 1).flatMap((other, k) => related(other) ? [] : terminals[order + 1 + k]!.stubs)
      const unrelated = drawn.filter((_, k) => !related(drawnBy[k]!))
      const kept = [...obstacles, ...[...reserved].flatMap(([owner, box]) => owner === edge ? [] : [box])]
      // Other routes keep out of the space a task's self-loops enclose, so a
      // loop crosses nothing, where they can reach their ports without it.
      const enclosed = [...channels].flatMap(([owner, other]) => other.region && !(edge.source === edge.target && edge.source === owner.source) ? [other.region] : [])
      // Preferences relax in order: keeping off drawn lines as far as the
      // policy asks (a port two routes share cannot keep them apart), then
      // the longer leads, then the channel stretch. For each stretch the
      // variant whose route has the fewest bends, then the shortest, wins;
      // ties keep the earlier variant. Before keeping off no line at all, a
      // route keeps off the unrelated routes drawn so far, with lines across
      // the lane gaps to pass them on, except where its own fixed stubs
      // already meet one: first only the parts they meet, then those routes
      // whole.
      const sharesPort = ([a, b]: readonly [Point, Point]) => [a, b].some(point => [source.port, target.port].some(port => Math.abs(point.x - port.x) < 1e-6 && Math.abs(point.y - port.y) < 1e-6))
      const keepOff = (segments: readonly (readonly [Point, Point])[], lines?: typeof gapChannels) => ({ avoid: { segments, separation, gap: stubGap }, ...(lines ? { channels: lines } : {}) })
      const own = terminals[order]!.stubs, every = keepOff([...drawn, ...later]), apartFromUnrelated = keepOff([...unrelated, ...later])
      const rescues = [keepOff(own.reduce((kept, stub) => kept.flatMap(segment => outside(segment, stub, stubGap)), unrelated), gapChannels),
        keepOff(unrelated.filter(segment => own.every(stub => outside(segment, stub, stubGap)[0] === segment)), gapChannels)]
      const avoids = !drawn.length && !later.length ? [{}] : policy === 0 ? [every, keepOff([...drawn.filter(segment => !sharesPort(segment)), ...later]), apartFromUnrelated, ...rescues, {}] : policy === 1 ? [every, apartFromUnrelated, ...rescues, {}] : [{}]
      const stub = [source.stub, target.stub] as const
      const stubs = source.lead || target.lead ? [[source.lead ?? source.stub, target.lead ?? target.stub] as const, stub] : [stub]
      let route: ReturnType<typeof routeOrthogonal>, chosen: HandoffChannel['stretches'][number][number] | undefined, best = Infinity
      framing: for (const frames of frameRules) for (const extra of enclosed.length ? [enclosed, []] : [[]]) {
        const request = {
          start: source.port, end: target.port, exit: source.side, entry: OPPOSITE[target.side], stub, clearance: 0, axisObstacles: across,
          obstacles: [...kept, ...extra], ...(frames ? { frames } : {}),
        }
        search: for (const keeping of avoids) for (const stub of stubs) for (const variants of channel?.stretches ?? [[undefined]]) {
          for (const run of variants) {
            const candidate = routeOrthogonal({ ...request, stub, ...(run ? { via: run.via } : {}), ...keeping, crossings, guided: true })
            const cost = candidate ? routeCost(candidate) : Infinity
            if (cost < best) { route = candidate; chosen = run; best = cost }
            // Four turns (out to the channel, along it, back) is as few as an
            // outside channel allows; a later variant could save only length,
            // not worth another search.
            if (candidate && candidate.length - 2 <= 4) break
          }
          if (route) break search
        }
        if (route) break framing
      }
      if (chosen?.caption) reserved.set(edge, routerBox(chosen.caption))
      edge.points = (route ?? fail(`${edge.source} -> ${edge.target} has no clear route`)).map(point => ({ x: point.x, y: point.y }))
      // Aligned ports can differ by rounding; a run between them stays
      // exactly straight.
      for (let index = 1; index < edge.points.length; index++) {
        const previous = edge.points[index - 1]!, point = edge.points[index]!
        if (Math.abs(point.x - previous.x) < 1e-6) point.x = previous.x
        if (Math.abs(point.y - previous.y) < 1e-6) point.y = previous.y
      }
      for (let index = 1; index < edge.points.length; index++) { drawn.push([edge.points[index - 1]!, edge.points[index]!]); drawnBy.push(edge) }
      if (!channel && edge.label) {
        const segment = edge.points.slice(1).map((point, index) => ({ a: edge.points[index]!, b: point }))
          .sort((a, b) => (Math.abs(b.a.x - b.b.x) + Math.abs(b.a.y - b.b.y)) - (Math.abs(a.a.x - a.b.x) + Math.abs(a.a.y - a.b.y)))[0]
        if (segment) edge.labelPosition = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 }
      }
    }
    if (!channels.size) {
      // Midpoint captions keep their seats unless one lies on a title band
      // or across a frame line; that one takes the first clear seat on its
      // own route, where it has one.
      seatHandoffLabels(nodes, edges, headers, channels, graph.direction, style, swimlaneFrames, undefined, edge => !edge.label || clearOfFrames(labelBoxAt(edge, edge.labelPosition!, style), swimlaneFrames))
      break
    }
    try {
      seatHandoffLabels(nodes, edges, headers, channels, graph.direction, style, swimlaneFrames, fail)
      break
    } catch (error) {
      if (policy === 2) throw error
    }
  }
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
  const positioned: PositionedGraph = { width, height, nodes, groups, edges, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, padding) } : {}) }
  // Final routes against the painted headers, as graph layout certifies
  // subgraph bands: strict safety refuses, report safety draws the routes
  // with an uncertified receipt naming each band they misuse.
  const findings = positionedHeaderRouteFindings(positioned, style, 'perpendicular')
  if (findings.length && (options.layoutSafety === 'strict' || findings.some(finding => !finding.drawable))) {
    throw new LayoutCertificationError([{ strategy: 'swimlane:header-bands', violations: findings.map(finding => finding.text) }])
  }
  const uncertified = mergeUncertifiedLayout(undefined, 'swimlane:header-bands', findings.map(finding => finding.drawable!))
  return uncertified ? { ...positioned, uncertifiedLayout: uncertified } : positioned
}

/** Fractional occurrence contacts need enough physical face for their actual
 * marker resources. Feed only crowded rectangular dimensions to placement. */
function occurrenceNodeSizes(graph: MermaidGraph, pairs: ReadonlyMap<string, PositionedEdge[]>, owners: ReadonlyMap<string, number>, horizontal: boolean, style: ReturnType<typeof resolveRenderStyle>, existing: ReadonlyMap<string, { width: number; height: number }> | undefined, loops: ReadonlyMap<string, SelfLoopPlan>): ReadonlyMap<string, { width: number; height: number }> {
  const sizes = new Map(existing)
  for (const pair of pairs.values()) {
    const first = pair[0]!, alongX = owners.get(first.source) !== owners.get(first.target) ? !horizontal : horizontal
    let span = 0
    for (const edge of pair) for (const marker of graphEdgeMarkerPaintRegions({ ...edge, curve: undefined, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, { ...style, edgeBendRadius: 0 })) {
      if (marker.bounds) span = Math.max(span, marker.bounds.y1 - marker.bounds.y0)
    }
    if (!span) continue
    // A task's self-loops meet the half of each face nearer their face or
    // corner, beside whatever meets the face's centre.
    const plan = first.source === first.target ? loops.get(first.source) : undefined
    const crosses: ('width' | 'height')[] = !plan ? [alongX ? 'height' : 'width'] : plan.at.length === 2 ? ['width', 'height'] : [LOOP_TURNS[plan.at] % 2 ? 'width' : 'height']
    const minimum = (plan ? 2 : 1) * (pair.length + 1) * (span + 1)
    for (const id of first.source === first.target ? [first.source] : [first.source, first.target]) {
      const node = graph.nodes.get(id)
      if (!node || node.shape !== 'rectangle' || node.semanticShape) continue
      const size = { ...sizes.get(id) ?? estimateNodeSize(id, resolveLabelContent(node.label, node.labelContent), node.shape, style, graph.direction, undefined, node.labelBlock) }
      let grown = false
      for (const cross of crosses) if (size[cross] < minimum) { size[cross] = minimum; grown = true }
      if (grown) sizes.set(id, size)
    }
  }
  return sizes
}

/** Where a route meets its endpoint: the contact point, the side it leaves
 * or enters by, the stub that clears the endpoint's bounding box, and a
 * longer lead preferred where it is clear. */
type Terminal = { port: Point; side: RouterDirection; stub: number; lead?: number }
/** Outlines whose faces are flat, so an end may move along one. */
const STRAIGHT_FACES = new Set(['rectangle', 'rounded', 'subroutine'])
const OPPOSITE: Record<RouterDirection, RouterDirection> = { E: 'W', W: 'E', N: 'S', S: 'N' }
const STEP: Record<RouterDirection, Point> = { E: { x: 1, y: 0 }, W: { x: -1, y: 0 }, N: { x: 0, y: -1 }, S: { x: 0, y: 1 } }

function terminal(box: MeasuredBox, port: Point, side: RouterDirection, gap: number): Terminal {
  const inset = side === 'E' ? box.x + box.width - port.x : side === 'W' ? port.x - box.x : side === 'S' ? box.y + box.height - port.y : port.y - box.y
  return { port, side, stub: Math.max(0, inset) + gap }
}

/** Bends dominate length, as in the router's own search. */
function routeCost(route: readonly Point[]): number {
  let length = 0
  for (let index = 1; index < route.length; index++) length += Math.abs(route[index]!.x - route[index - 1]!.x) + Math.abs(route[index]!.y - route[index - 1]!.y)
  return (route.length - 2) * 1e4 + length
}

/** The parts of axis-aligned segment `segment` farther than `margin` from
 * the box of segment `stub`. */
function outside(segment: readonly [Point, Point], stub: readonly [Point, Point], margin: number): (readonly [Point, Point])[] {
  const x0 = Math.min(stub[0].x, stub[1].x) - margin, x1 = Math.max(stub[0].x, stub[1].x) + margin
  const y0 = Math.min(stub[0].y, stub[1].y) - margin, y1 = Math.max(stub[0].y, stub[1].y) + margin
  const [a, b] = segment, vertical = a.x === b.x
  const at = vertical ? a.x : a.y, lo = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x), hi = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x)
  const [from, to] = vertical ? [y0, y1] : [x0, x1]
  if (at <= (vertical ? x0 : y0) || at >= (vertical ? x1 : y1) || hi <= from || lo >= to) return [segment]
  const point = (along: number): Point => vertical ? { x: at, y: along } : { x: along, y: at }
  return [...(lo < from ? [[point(lo), point(from)] as const] : []), ...(hi > to ? [[point(to), point(hi)] as const] : [])]
}

function routerBox(box: MeasuredBox, margin = 0): RouterBox {
  return { x0: box.x - margin, y0: box.y - margin, x1: box.x + box.width + margin, y1: box.y + box.height + margin }
}

/** Occurrences (parallel and reciprocal hand-offs, self-loops on a lane or
 * group) each run on their own channel outside the content, alternating
 * sides, with a straight stretch long enough for the complete caption; a
 * task's self-loops run beside it instead. The shared router reaches the
 * channel from each port around every card, header and other caption. */
type HandoffChannel = { source: Terminal; target: Terminal; stretches: { via: Point[]; caption?: MeasuredBox }[][]; direction: Direction; region?: RouterBox }

function handoffChannels(byId: ReadonlyMap<string, PositionedNode | PositionedGroup>, allPairs: ReadonlyMap<string, PositionedEdge[]>, headers: MeasuredBox[], owners: ReadonlyMap<string, number>, horizontal: boolean, style: ReturnType<typeof resolveRenderStyle>, stubGap: number, loops: ReadonlyMap<string, SelfLoopPlan>): Map<PositionedEdge, HandoffChannel> {
  const channels = new Map<PositionedEdge, HandoffChannel>()
  // A task's self-loops stay beside it; the outside channels carry the rest.
  for (const [id, plan] of loops) selfLoopChannels(byId.get(id) as PositionedNode, plan, style, stubGap, channels)
  const pairs = [...allPairs.values()].filter(pair => !loops.has(pair[0]!.source) || pair[0]!.source !== pair[0]!.target)
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const box of [...byId.values(), ...headers]) {
    left = Math.min(left, box.x); top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.width); bottom = Math.max(bottom, box.y + box.height)
  }
  let pitchX = 24, pitchY = 24
  for (const pair of pairs) for (const edge of pair) {
    const halo = labelHaloExtension(edge, style.lineWidth)
    pitchX = Math.max(pitchX, (edge.labelBlock?.width ?? 0) + 24 + 2 * halo)
    pitchY = Math.max(pitchY, (edge.labelBlock?.height ?? 0) + 24 + 2 * halo)
  }
  let occurrence = 0
  for (const pair of pairs) {
    const first = pair[0]!, crossLane = owners.get(first.source) !== owners.get(first.target)
    const alongX = crossLane ? !horizontal : horizontal
    const axis = alongX ? 'x' : 'y', cross = alongX ? 'y' : 'x', crossSize = alongX ? 'height' : 'width'
    const low = alongX ? top : left, high = alongX ? bottom : right, pitch = alongX ? pitchY : pitchX
    // Contacts follow the channels across each face, outermost low channel
    // first and outermost high channel last, so the turns to them nest
    // instead of crossing.
    const firstChannel = occurrence, channel = (index: number) => firstChannel + index
    const slots = pair.map((_, index) => index).sort((a, b) => {
      const ca = channel(a), cb = channel(b), side = (ca % 2) - (cb % 2)
      return side || (ca % 2 ? ca - cb : cb - ca)
    })
    for (const [index, edge] of pair.entries()) {
      const source = byId.get(edge.source)!, target = byId.get(edge.target)!
      const positive = alongX ? target.x + target.width / 2 >= source.x + source.width / 2 : target.y + target.height / 2 >= source.y + source.height / 2
      const direction: Direction = alongX ? positive ? 'LR' : 'RL' : positive ? 'TD' : 'BT'
      const channelIndex = occurrence++
      const offset = pitch / 2 + 16 + Math.floor(channelIndex / 2) * pitch
      const lane = channelIndex % 2 ? high + offset : low - offset
      // Group frames have a rectangular boundary; task ports follow the true
      // shape.
      const fraction = (slots.indexOf(index) + 1) / (pair.length + 1)
      // Inner channels turn out later than outer ones on the same side, so
      // their turns nest too, where the longer lead is clear.
      const outer = pair.filter((_, other) => channel(other) % 2 === channelIndex % 2 && channel(other) > channelIndex).length
      const contact = (box: PositionedNode | PositionedGroup, side: RouterDirection): Terminal => {
        const node: PositionedNode = 'shape' in box ? box : { ...box, shape: 'rectangle' }
        const at = node[cross] + node[crossSize] * fraction
        const port = pointOnRoutingBoundary(shapeRoutingProfile(node).boundary, side, at)
          ?? (alongX ? { x: side === 'E' ? node.x + node.width : node.x, y: at } : { x: at, y: side === 'S' ? node.y + node.height : node.y })
        const plain = terminal(node, port, side, stubGap)
        return outer ? { ...plain, lead: plain.stub + outer * stubGap } : plain
      }
      const start = contact(source, alongX ? positive ? 'E' : 'W' : positive ? 'S' : 'N')
      const end = contact(target, alongX ? positive ? 'W' : 'E' : positive ? 'N' : 'S')
      // The route runs straight along its channel for the complete painted
      // caption, centred between the two leads. A stretch longer than the
      // leads leave room for may instead start at one lead and extend past
      // the other, where the centred one has no clear way back to a port.
      const lead = (t: Terminal) => t.port[axis] + (t.side === 'E' || t.side === 'S' ? 1 : -1) * (t.lead ?? t.stub)
      const from = lead(start), to = lead(end), midpoint = (from + to) / 2, sign = to === from ? (positive ? 1 : -1) : Math.sign(to - from)
      const needed = (edge.labelBlock?.[alongX ? 'width' : 'height'] ?? 0) + 32 + 2 * labelHaloExtension(edge, style.lineWidth)
      const stretches = [[midpoint - sign * needed / 2, midpoint + sign * needed / 2], ...(Math.abs(to - from) < needed ? [[from, from + sign * needed], [to - sign * needed, to]] : [])]
      // Each stretch is first tried reaching the channel level with each lead,
      // so the route turns straight out to it and back, then anywhere.
      const halo = labelHaloExtension(edge, style.lineWidth) + 4
      const variants = stretches.map(([first, last]) => {
        const pill = edge.label ? labelBoxAt(edge, alongX ? { x: (first! + last!) / 2, y: lane } : { x: lane, y: (first! + last!) / 2 }, style) : undefined
        const caption = pill ? { x: pill.x - halo, y: pill.y - halo, width: pill.width + halo * 2, height: pill.height + halo * 2 } : undefined
        const point = (along: number) => alongX ? { x: along, y: lane } : { x: lane, y: along }
        const leads = [...(sign * (first! - from) > 0 ? [from] : []), first!, last!, ...(sign * (to - last!) > 0 ? [to] : [])]
        return [...(leads.length > 2 ? [{ via: leads.map(point), caption }] : []), { via: [first!, last!].map(point), caption }]
      })
      channels.set(edge, { source: start, target: end, stretches: variants, direction })
    }
  }
  return channels
}

/** A caption's painted box that keeps off every lane and group title band
 * and crosses no frame line: one on a title or across a frame reads as
 * part of the lane, or as two captions (merman#242). */
function clearOfFrames(box: MeasuredBox, frames: SwimlaneFrames): boolean {
  if (frames.bands.some(band => rectsOverlap(box, band, 0))) return false
  const spans = (at: number, from: number, size: number) => from < at && at < from + size
  return frames.boxes.every(frame => {
    const alongX = box.x < frame.x1 && box.x + box.width > frame.x0, alongY = box.y < frame.y1 && box.y + box.height > frame.y0
    return !(alongX && (spans(frame.y0, box.y, box.height) || spans(frame.y1, box.y, box.height))) && !(alongY && (spans(frame.x0, box.x, box.width) || spans(frame.x1, box.x, box.width)))
  })
}
type SwimlaneFrames = { readonly bands: readonly MeasuredBox[]; readonly boxes: readonly RouterBox[] }

/** Seats captions on their own routes, each clear of tasks, headers, other
 * captions and neighbouring routes, preferring the first seat clear of the
 * title bands and frame lines too. Captions `keep` accepts keep their
 * seats; without `fail`, a caption with no clear seat keeps its own. */
function seatHandoffLabels(nodes: PositionedNode[], edges: PositionedEdge[], headers: MeasuredBox[], channels: ReadonlyMap<PositionedEdge, { direction: Direction }>, direction: Direction, style: ReturnType<typeof resolveRenderStyle>, frames: SwimlaneFrames, fail?: (reason: string) => never, keep: (edge: PositionedEdge) => boolean = () => false): void {
  // Every caption participates: an ordinary route can approach an occurrence
  // channel, and two independent midpoint choices can cover each other's ink.
  const original = new Map(edges.map(edge => [edge, edge.labelPosition])), kept = new Set(edges.filter(edge => edge.labelPosition && keep(edge)))
  for (const edge of edges) if (!kept.has(edge)) delete edge.labelPosition
  for (const edge of edges) {
    if (!edge.label || edge.style === 'invisible' || kept.has(edge)) continue
    const halo = labelHaloExtension(edge, style.lineWidth)
    const painted = (point: Point) => { const pill = labelBoxAt(edge, point, style); return { x: pill.x - halo, y: pill.y - halo, width: pill.width + halo * 2, height: pill.height + halo * 2 } }
    const seats = bundledLabelCandidates(edge, edge.points, nodes, channels.get(edge)?.direction ?? direction, style, (_edge, point) => {
      const box = painted(point)
      if (headers.some(header => rectsOverlap(box, header, 2)) || nodes.some(node => rectsOverlap(box, node, 2))) return false
      if (edges.some(other => {
        if (other === edge || !other.label || !other.labelPosition) return false
        const pill = labelBoxAt(other, other.labelPosition, style), halo = labelHaloExtension(other, style.lineWidth)
        return rectsOverlap(box, { x: pill.x - halo, y: pill.y - halo, width: pill.width + halo * 2, height: pill.height + halo * 2 }, 2)
      })) return false
      return !labelTouchesNeighborRoute(edge, { x: box.x, y: box.y, w: box.width, h: box.height }, edges)
    })
    const seat = seats.find(candidate => clearOfFrames(painted(candidate.point), frames)) ?? seats[0]
    if (seat) edge.labelPosition = seat.point
    else if (fail) fail('hand-off caption has no clear owned segment')
    else edge.labelPosition = original.get(edge)
  }
}

/** Where a task's self-loops run: nested around one face, leaving by one
 * neighbouring face and returning by the other, or around one corner. Each
 * contact sits between the face's centre, where ordinary routes meet it, and
 * the loop's own face or corner, so a loop arrives on its own terminal. */
type LoopAt = RouterDirection | 'SE' | 'SW' | 'NW' | 'NE'
type SelfLoopPlan = { at: LoopAt; loops: PositionedEdge[]; clear: boolean }
/** Quarter turns clockwise from the south face (and south-east corner), where
 * a loop leaves east and returns west (or south), clockwise. */
const LOOP_TURNS: Record<LoopAt, number> = { S: 0, W: 1, N: 2, E: 3, SE: 0, SW: 1, NW: 2, NE: 3 }
const CLOCKWISE: Record<RouterDirection, RouterDirection> = { E: 'S', S: 'W', W: 'N', N: 'E' }
const LOOP_PLACES: readonly LoopAt[] = ['S', 'N', 'E', 'W', 'SE', 'SW', 'NE', 'NW']

function turned(side: RouterDirection, turns: number): RouterDirection {
  for (let index = 0; index < turns; index++) side = CLOCKWISE[side]
  return side
}

/** Each task's self-loops go where they enclose nothing another route meets:
 * a face with no route at its centre and no contacts spread over it or its
 * neighbours' halves, else a corner. Only where every place is taken does a
 * loop enclose (and so cross) the fewest other routes. */
function selfLoopPlans(graph: MermaidGraph, edges: readonly PositionedEdge[], pairs: ReadonlyMap<string, PositionedEdge[]>, owners: ReadonlyMap<string, number>, horizontal: boolean, portSide: (id: string, other: string, end: 'source' | 'target') => RouterDirection): Map<string, SelfLoopPlan> {
  const plans = new Map<string, SelfLoopPlan>()
  for (const pair of pairs.values()) if (pair[0]!.source === pair[0]!.target && graph.nodes.has(pair[0]!.source)) plans.set(pair[0]!.source, { at: 'S', loops: pair, clear: true })
  if (!plans.size) return plans
  // Ordinary routes meet a face at its centre; occurrence contacts spread
  // across it. A same-lane occurrence may meet either process face.
  const centre = new Map<string, Record<RouterDirection, number>>(), spread = new Map<string, Record<RouterDirection, number>>()
  const add = (faces: Map<string, Record<RouterDirection, number>>, id: string, side: RouterDirection): void => {
    if (!plans.has(id)) return
    const counts = faces.get(id) ?? { N: 0, E: 0, S: 0, W: 0 }
    counts[side]++; faces.set(id, counts)
  }
  for (const edge of edges) {
    if (edge.style === 'invisible' || edge.source === edge.target) continue
    if (!pairs.has([edge.source, edge.target].sort().join('\0'))) {
      add(centre, edge.source, portSide(edge.source, edge.target, 'source')); add(centre, edge.target, portSide(edge.target, edge.source, 'target'))
      continue
    }
    const from = owners.get(edge.source), to = owners.get(edge.target)
    if (from !== undefined && to !== undefined && from !== to) {
      const out: RouterDirection = horizontal ? (to > from ? 'S' : 'N') : (to > from ? 'E' : 'W')
      add(spread, edge.source, out); add(spread, edge.target, OPPOSITE[out])
    } else for (const side of horizontal ? ['E', 'W'] as const : ['N', 'S'] as const) { add(spread, edge.source, side); add(spread, edge.target, side) }
  }
  const none = { N: 0, E: 0, S: 0, W: 0 }
  for (const [id, plan] of plans) {
    const centred = centre.get(id) ?? none, spreadOver = spread.get(id) ?? none
    let least = Infinity
    for (const at of LOOP_PLACES) {
      const load = at.length === 2 ? spreadOver[at[0] as RouterDirection] + spreadOver[at[1] as RouterDirection]
        : centred[at as RouterDirection] + spreadOver[at as RouterDirection] + spreadOver[turned(at as RouterDirection, 1)] + spreadOver[turned(at as RouterDirection, 3)]
      if (load < least) { least = load; plan.at = at }
    }
    plan.clear = least === 0
  }
  return plans
}

/** Nested loop sizes in the south-face (or south-east-corner) frame: `a` and
 * `b` are the task's half extents along and across that face. Loop `index`
 * meets the neighbouring face `t` from the loop's face (and, around a
 * corner, its own face `along` from the corner), leads out `s` and runs `d`
 * beyond the face, far enough for its complete caption. Inner loops meet
 * nearer the face and run nearer it, so nested loops never cross. `reach` is
 * how far the loops extend beyond each actual face. */
function selfLoopGeometry(plan: SelfLoopPlan, width: number, height: number, style: ReturnType<typeof resolveRenderStyle>, stubGap: number) {
  const turns = LOOP_TURNS[plan.at], corner = plan.at.length === 2, level = turns % 2 === 0
  const a = (level ? width : height) / 2, b = (level ? height : width) / 2, count = plan.loops.length
  let s = 0, d = 0, previous = 0
  const loops = plan.loops.map((edge, index) => {
    const pill = edge.label ? labelBoxAt(edge, { x: 0, y: 0 }, style) : undefined
    const halo = pill ? labelHaloExtension(edge, style.lineWidth) : 0
    // The caption runs along the face (or the corner's face).
    const c = pill ? (level ? pill.height : pill.width) / 2 + halo : 0
    const needed = (pill ? (level ? pill.width : pill.height) + 2 * halo : 0) + 2 * stubGap
    const t = b * (index + 1) / (count + 1), along = corner ? a * (index + 1) / (count + 1) : t
    s = Math.max(index ? s + stubGap : stubGap, corner ? needed - along : (needed - 2 * a) / 2)
    d = index ? Math.max(d + stubGap, d + previous + c + 4) : Math.max(stubGap, c + 4)
    previous = c
    return { edge, t, along, s, d, c }
  })
  const last = loops.at(-1)!, side = last.s + style.lineWidth
  const reach: Record<RouterDirection, number> = { N: 0, E: 0, S: 0, W: 0 }
  reach[turned('S', turns)] = last.d + last.c + style.lineWidth
  reach[turned('E', turns)] = side
  reach[turned('W', turns)] = corner ? 0 : side
  return { turns, corner, a, b, loops, reach }
}

/** Each loop leaves and returns through its own contacts, along its own
 * channel; the space the loops enclose is reserved from other routes. */
function selfLoopChannels(node: PositionedNode, plan: SelfLoopPlan, style: ReturnType<typeof resolveRenderStyle>, stubGap: number, channels: Map<PositionedEdge, HandoffChannel>): void {
  const { turns, corner, a, b, loops } = selfLoopGeometry(plan, node.width, node.height, style, stubGap)
  const cx = node.x + node.width / 2, cy = node.y + node.height / 2
  const at = (u: number, v: number): Point => {
    const [x, y] = turns === 0 ? [u, v] : turns === 1 ? [-v, u] : turns === 2 ? [-u, -v] : [v, -u]
    return { x: cx + x, y: cy + y }
  }
  const boundary = shapeRoutingProfile(node).boundary
  const contact = (side: RouterDirection, point: Point, lead: number): Terminal => {
    const port = pointOnRoutingBoundary(boundary, side, side === 'E' || side === 'W' ? point.y : point.x) ?? point
    return { ...terminal(node, port, side, stubGap), lead: terminal(node, port, side, lead).stub }
  }
  const exit = turned('E', turns), entry = turned(corner ? 'S' : 'W', turns), last = loops.at(-1)!
  // Other routes keep their spacing from the loops' outer runs; the inner
  // edges stay clear of the face centres they meet.
  const margin = stubGap / 2
  const [p, q] = [at(corner ? a - last.along : -a - last.s - margin, b - last.t), at(a + last.s + margin, b + last.d + last.c + margin)]
  const region = plan.clear ? { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) } : undefined
  for (const [index, loop] of loops.entries()) {
    const source = contact(exit, at(a, b - loop.t), loop.s)
    const target = corner ? contact(entry, at(a - loop.along, b), loop.d) : contact(entry, at(-a, b - loop.t), loop.s)
    const via = corner ? [at(a + loop.s, b + loop.d)] : [at(a + loop.s, b + loop.d), at(-a - loop.s, b + loop.d)]
    channels.set(loop.edge, { source, target, stretches: [[{ via }]], direction: turns % 2 ? 'TD' : 'LR', ...(region && !index ? { region } : {}) })
  }
}
