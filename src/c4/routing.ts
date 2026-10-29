import { graphEdgeTerminalClearance } from '../graph-connectors.ts'
import { C4RouteWorkLimitError } from './errors.ts'
export { C4RouteWorkLimitError } from './errors.ts'
import type { Point, PositionedEdge, PositionedNode, PositionedGroup, MermaidGraph } from '../types.ts'
import type { planC4Identity } from './identity.ts'
import type { C4Box } from './placement.ts'
import { simplifyPolyline, applyRouteContracts, repairLabelsOffOwnRoute, separateEdgeLabelPills, closeRouteContracts, repairMarkerTerminals, laneContextFor, findLabelSlot, recertifyReroutedEdge, type LabelMetricsStyle } from '../route-contracts.ts'
import { rerouteEdgesThroughNodes } from '../layout/passes/obstacle-routing.ts'
import { calculatePathMidpoint } from '../layout/geometry.ts'
import { segmentThroughShape } from '../layout-rubric.ts'

type Side = 'T' | 'R' | 'B' | 'L'
interface Rect { x: number; y: number; width: number; height: number }
const delta: Record<Side, Point> = { T: { x: 0, y: -1 }, R: { x: 1, y: 0 }, B: { x: 0, y: 1 }, L: { x: -1, y: 0 } }
const contains = (a: Rect, b: Rect) => a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height
const center = (b: Rect): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
function sides(a: C4Box, b: C4Box): [Side, Side] {
  if (a.id === b.id) return ['R', 'B']
  if (a.container && contains(a, b)) return ['B', 'B']
  if (b.container && contains(b, a)) return ['B', 'B']
  const ac = center(a), bc = center(b)
  if (Math.abs(ac.x - bc.x) >= Math.abs(ac.y - bc.y)) return ac.x <= bc.x ? ['R', 'L'] : ['L', 'R']
  return ac.y <= bc.y ? ['B', 'T'] : ['T', 'B']
}
/** The point a fraction `t` of the way along a face's usable span. */
function portAt(box: C4Box, side: Side, t: number): Point {
  if (side === 'T' || side === 'B') {
    const curve = box.cylinder ? 8 * (1 - Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))) : 0
    return { x: box.x + box.width * t, y: box.y + (side === 'B' ? box.height - curve : curve) }
  }
  const header = box.container ? box.headerHeight ?? 0 : box.cylinder ? 8 : 0
  return { x: box.x + (side === 'R' ? box.width : 0), y: box.y + header + (box.height - header - (box.cylinder ? 8 : 0)) * t }
}
function port(box: C4Box, side: Side, index: number, count: number): Point {
  return portAt(box, side, (index + 1) / (count + 1))
}

/** A step smaller than this between facing ports draws as a dogleg, not a
 * deliberate offset. */
const DOGLEG = 8
const OPPOSITE: Record<Side, Side> = { T: 'B', R: 'L', B: 'T', L: 'R' }

/** Evenly spaced ports on facing sides of different lengths sit a few pixels
 * apart. Put the target port level with the source port instead, when that
 * stays on the target face and clear of the face's other ports. */
function facingPort(start: Point, startSide: Side, box: C4Box, side: Side, index: number, count: number): Point {
  const end = port(box, side, index, count)
  if (OPPOSITE[startSide] !== side) return end
  const along = side === 'L' || side === 'R' ? 'y' : 'x'
  const offset = start[along] - end[along]
  if (offset === 0 || Math.abs(offset) >= DOGLEG) return end
  const first = portAt(box, side, 0), last = portAt(box, side, 1)
  const t = (start[along] - first[along]) / (last[along] - first[along])
  if (!(t > 0 && t < 1)) return end
  const level = portAt(box, side, t)
  for (let other = 0; other < count; other++) {
    if (other !== index && Math.abs(port(box, side, other, count)[along] - level[along]) < DOGLEG) return end
  }
  return level
}



/** Sample nearby obstacle faces plus the exterior. At most 16 coordinates per
 * axis and five interior segments per candidate; all physical checks share the
 * request budget. This repairs failed local routes without a grid search. */
function physicalCorridor(start: Point, end: Point, obstacles: PositionedNode[], through: (a: Point, b: Point, node: PositionedNode) => boolean): Point[] | undefined {
  const coordinates = (axis: 'x' | 'y', size: 'width' | 'height') => {
    const values = [...new Set(obstacles.flatMap(node => [node[axis] - 10, node[axis] + node[size] + 10]))]
    const exterior = [Math.min(start[axis], end[axis], ...values), Math.max(start[axis], end[axis], ...values)]
    const distance = (value: number) => Math.min(Math.abs(value - start[axis]), Math.abs(value - end[axis]))
    return [...new Set([...exterior, ...values.sort((a, b) => distance(a) - distance(b) || a - b).slice(0, 14)])]
  }
  const xs = coordinates('x', 'width'), ys = coordinates('y', 'height')
  const candidates: Point[][] = []
  for (const x of xs) candidates.push([start, { x, y: start.y }, { x, y: end.y }, end])
  for (const y of ys) candidates.push([start, { x: start.x, y }, { x: end.x, y }, end])
  for (const x of xs) for (const y of ys) {
    candidates.push([start, { x: start.x, y }, { x, y }, { x, y: end.y }, end])
    candidates.push([start, { x, y: start.y }, { x, y }, { x: end.x, y }, end])
  }
  const length = (points: Point[]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0)
  const clear = (a: Point, b: Point) => obstacles.every(node => !through(a, b, node))
  const choose = (routes: Point[][]) => routes.map(simplifyPolyline).sort((a, b) => length(a) - length(b) || a.length - b.length)
    .find(points => points.slice(1).every((point, index) => clear(points[index]!, point)))
  const simple = choose(candidates)
  if (simple) return simple
  // A nested header can require separate departure and arrival bands: first
  // leave the card's row, go around the header, then enter the target's row.
  const startYs = ys.filter(y => clear(start, { x: start.x, y })), endYs = ys.filter(y => clear({ x: end.x, y }, end))
  const startXs = xs.filter(x => clear(start, { x, y: start.y })), endXs = xs.filter(x => clear({ x, y: end.y }, end))
  const nested: Point[][] = []
  for (const x of xs) for (const a of startYs) for (const b of endYs) nested.push([start, { x: start.x, y: a }, { x, y: a }, { x, y: b }, { x: end.x, y: b }, end])
  for (const y of ys) for (const a of startXs) for (const b of endXs) nested.push([start, { x: a, y: start.y }, { x: a, y }, { x: b, y }, { x: b, y: end.y }, end])
  return choose(nested)
}
export function routeC4Pixels(boxes: ReadonlyMap<string, C4Box>, positioned: { nodes: PositionedNode[]; groups: PositionedGroup[]; edges: PositionedEdge[] }, graph: MermaidGraph, style: LabelMetricsStyle, identities: ReturnType<typeof planC4Identity>): void {
  const { edges } = positioned
  const headerNodes: PositionedNode[] = [...boxes.values()].filter(box => box.container).map(box => ({ ...box, id: identities.generated(`c4-header-obstacle:${box.id}`, ['c4', 'header-obstacle', box.id]), height: box.headerHeight ?? 1, shape: 'rectangle', label: '' }))
  const physicalObstacles = [...positioned.nodes, ...headerNodes]
  let physicalChecks = 0
  const charge = () => { if (++physicalChecks > 400_000) throw new C4RouteWorkLimitError() }
  const through = (a: Point, b: Point, node: PositionedNode) => { charge(); return segmentThroughShape(a, b, node) }
  const exit = (point: Point, side: Side, sign: number, lane: number, owner: string): Point => {
    const ray = { x: delta[side].x * sign, y: delta[side].y * sign }
    let distance = lane
    for (const node of physicalObstacles) {
      charge()
      if (node.id === owner) continue
      const aligned = ray.x ? point.y > node.y && point.y < node.y + node.height : point.x > node.x && point.x < node.x + node.width
      if (!aligned) continue
      const entry = ray.x > 0 ? node.x - point.x : ray.x < 0 ? point.x - node.x - node.width : ray.y > 0 ? node.y - point.y : point.y - node.y - node.height
      if (entry >= 0) distance = Math.min(distance, Math.max(0, entry - 2))
    }
    return { x: point.x + ray.x * distance, y: point.y + ray.y * distance }
  }
  const stubs = new Map<PositionedEdge, { start: Point; end: Point; startExit: Point; endExit: Point; seed?: Point[] }>()
  const counts = new Map<string, number>(), cursors = new Map<string, number>()
  const plans = edges.flatMap(edge => { const source = boxes.get(edge.source), target = boxes.get(edge.target); if (!source || !target) return []; const [startSide, endSide] = sides(source, target); for (const [id, side] of [[source.id, startSide], [target.id, endSide]]) { const key = `${id}\0${side}`; counts.set(key, (counts.get(key) ?? 0) + 1) }; return [{ edge, source, target, startSide, endSide }] })
  const pairs = new Map<string, typeof plans>()
  for (const plan of plans) { const key = JSON.stringify([plan.source.id, plan.target.id].sort()); const members = pairs.get(key) ?? []; members.push(plan); pairs.set(key, members) }
  for (const [index, plan] of plans.entries()) {
    const { edge, source, target, startSide, endSide } = plan
    const cursor = (box: C4Box, side: Side) => { const key = `${box.id}\0${side}`, index = cursors.get(key) ?? 0; cursors.set(key, index + 1); return { index, count: counts.get(key)! } }
    const startPort = cursor(source, startSide), endPort = cursor(target, endSide)
    const start = port(source, startSide, startPort.index, startPort.count)
    const end = source.id === target.id ? port(target, endSide, endPort.index, endPort.count) : facingPort(start, startSide, target, endSide, endPort.index, endPort.count)
    const startSign = source.container && source.id !== target.id && contains(source, target) ? -1 : 1
    const endSign = target.container && source.id !== target.id && contains(target, source) ? -1 : 1
    const pair = pairs.get(JSON.stringify([source.id, target.id].sort()))!
    const corridor = startSide === 'R' || startSide === 'L'
      ? Math.max(24, ...pair.map(item => (item.edge.labelBlock?.width ?? 0) + 32))
      : Math.max(24, ...pair.map(item => (item.edge.labelBlock?.height ?? 0) + 24))
    const shift = (pair.indexOf(plan) - (pair.length - 1) / 2) * corridor
    const lane = 14 + (index % 5) * 4
    const terminal = graphEdgeTerminalClearance(edge, style)
    const startExit = exit(start, startSide, startSign, Math.max(lane, terminal.start ? terminal.start + (style.edgeBendRadius ?? 0) : 0), source.id)
    const endExit = exit(end, endSide, endSign, Math.max(lane, terminal.end ? terminal.end + (style.edgeBendRadius ?? 0) : 0), target.id)
    stubs.set(edge, { start, end, startExit, endExit })
    // C4 owns only the physical face choice and initial corridor. Shared graph
    // route passes repair crossings, allocate labels and certify final routes.
    let middle: Point[]
    if (source.id === target.id) {
      const right = source.x + source.width + lane + (edge.labelBlock?.width ?? 0) / 2
      const bottom = source.y + source.height + lane + (edge.labelBlock?.height ?? 0) / 2
      middle = [startExit, { x: right, y: startExit.y }, { x: right, y: bottom }, { x: endExit.x, y: bottom }, endExit]
    } else if (startSide === 'R' || startSide === 'L') {
      const x = (startExit.x + endExit.x) / 2 + shift
      middle = [startExit, { x, y: startExit.y }, { x, y: endExit.y }, endExit]
    } else {
      const y = (startExit.y + endExit.y) / 2 + shift
      middle = [startExit, { x: startExit.x, y }, { x: endExit.x, y }, endExit]
    }
    edge.points = simplifyPolyline([start, ...middle, end])
    stubs.get(edge)!.seed = edge.points
    if (edge.label) edge.labelPosition = calculatePathMidpoint(edge.points)
  }
  applyRouteContracts(positioned, graph, new Set(), style)
  repairLabelsOffOwnRoute(positioned, graph, style)
  separateEdgeLabelPills(positioned, graph, style)
  closeRouteContracts(positioned, graph, style)
  // Container frames are endpoint surfaces, not solid interior obstacles. Give
  // the shared rerouter the actual endpoint frame plus the opaque header bands
  // and leaf cards. This preserves boundary references without blocking every
  // descendant as if the ancestor were a filled node.
  for (const edge of edges) {
    const stub = stubs.get(edge)!
    const source = boxes.get(edge.source)!, target = boxes.get(edge.target)!
    const horizontal = Math.abs(center(source).x - center(target).x) >= Math.abs(center(source).y - center(target).y)
    const direction = horizontal ? center(source).x <= center(target).x ? 'LR' : 'RL' : center(source).y <= center(target).y ? 'TB' : 'BT'
    const anchorSource: PositionedNode = { id: identities.generated(`${edge.id}:routing-source`, ['c4', edge.id!, 'routing-source']), label: '', shape: 'rectangle', ...stub.startExit, width: 0, height: 0 }
    const anchorTarget: PositionedNode = { id: identities.generated(`${edge.id}:routing-target`, ['c4', edge.id!, 'routing-target']), label: '', shape: 'rectangle', ...stub.endExit, width: 0, height: 0 }
    const interior: PositionedEdge = { ...edge, source: anchorSource.id, target: anchorTarget.id, points: simplifyPolyline([stub.startExit, ...stub.seed!.slice(1, -1), stub.endExit]) }
    // A corridor must carry its measured label halo as well as its stroke.
    // Otherwise a path ten pixels below a database is clear for ink while
    // its two-line label is still painted underneath the database surface.
    const padX = (edge.labelBlock?.width ?? 0) / 2 + 10, padY = (edge.labelBlock?.height ?? 0) / 2 + 8
    const obstacles = [...positioned.nodes, ...headerNodes].map(node => node.id === edge.source || node.id === edge.target
      ? node : { ...node, x: node.x - padX, y: node.y - padY, width: node.width + padX * 2, height: node.height + padY * 2 })
    rerouteEdgesThroughNodes([...obstacles, anchorSource, anchorTarget], [interior], { ...graph, direction })
    // A full label halo cannot fit through every nested boundary exit. If that
    // stronger corridor has no solution, still route the shaft clear of actual
    // cards and opaque headers. The final C4 allocator separately places the
    // retained label halo; its visibility checks remain authoritative.
    const blocked = interior.points.slice(1).some((end, index) => physicalObstacles.some(node => through(interior.points[index]!, end, node)))
    if (blocked) interior.points = physicalCorridor(stub.startExit, stub.endExit, physicalObstacles, through) ?? interior.points
    edge.points = simplifyPolyline([stub.start, ...interior.points, stub.end])
    edge.labelPosition = calculatePathMidpoint(edge.points)
  }
  repairMarkerTerminals(positioned, graph, style)
  const labelNodes = [...positioned.nodes, ...headerNodes], labelPositioned = { ...positioned, nodes: labelNodes }
  const { ctx } = laneContextFor(labelNodes, edges, graph.direction, style, positioned.groups)
  ctx.finalLabelClearance = true
  for (const edge of edges) {
    if (!edge.label) continue
    const segments = edge.points.slice(1).map((end, index) => ({ start: edge.points[index]!, end })).sort((a, b) => (Math.abs(b.end.x - b.start.x) + Math.abs(b.end.y - b.start.y)) - (Math.abs(a.end.x - a.start.x) + Math.abs(a.end.y - a.start.y)))
    for (const { start, end } of segments) { const slot = findLabelSlot(edge, start, end, ctx); if (slot) { edge.labelPosition = slot; break } }
  }
  separateEdgeLabelPills(labelPositioned, graph, style)
  for (const edge of edges) { const source = boxes.get(edge.source)!, target = boxes.get(edge.target)!; recertifyReroutedEdge(edge, edge.routeCertificate, { ...source, label: '', shape: 'rectangle' }, { ...target, label: '', shape: 'rectangle' }) }
}
