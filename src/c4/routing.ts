import { graphEdgeTerminalClearance } from '../graph-connectors.ts'
import { C4RouteWorkLimitError } from './errors.ts'
export { C4RouteWorkLimitError } from './errors.ts'
import type { Point, PositionedEdge, PositionedNode, PositionedGroup, MermaidGraph } from '../types.ts'
import type { planC4Identity } from './identity.ts'
import type { C4Box } from './placement.ts'
import { simplifyPolyline, applyRouteContracts, separateEdgeLabelPills, closeRouteContracts, repairMarkerTerminals, laneContextFor, findLabelSlot, recertifyReroutedEdge, type LabelMetricsStyle } from '../route-contracts.ts'
import { orthogonalFallback, routeOrthogonal, routeStraight, type RouterBox, type RouterDirection } from '../layout/orthogonal-router.ts'
import { calculatePathMidpoint } from '../layout/geometry.ts'
import { allocateGeneratedId } from '../shared/generated-identity.ts'
import { denseLabelSeats } from '../layout/label-seat-search.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

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

/** Sorted-pair keys of repeated relationships that all run as one straight
 * run between facing faces carrying nothing else, on ports far enough apart
 * that their labels stack across the run. Such a pair needs no corridor
 * wider than one label: its runs never step between the two faces. */
export function c4StraightPairs(boxes: ReadonlyMap<string, C4Box>, edges: readonly PositionedEdge[]): Set<string> {
  const counts = new Map<string, number>(), pairs = new Map<string, PositionedEdge[]>(), straight = new Set<string>()
  for (const edge of edges) {
    const source = boxes.get(edge.source), target = boxes.get(edge.target)
    if (!source || !target) continue
    const [startSide, endSide] = sides(source, target)
    for (const key of [`${source.id}\0${startSide}`, `${target.id}\0${endSide}`]) counts.set(key, (counts.get(key) ?? 0) + 1)
    const key = JSON.stringify([edge.source, edge.target].sort()), members = pairs.get(key) ?? []
    members.push(edge); pairs.set(key, members)
  }
  for (const [key, members] of pairs) {
    const [first, second] = JSON.parse(key) as [string, string], count = members.length
    if (count < 2 || first === second) continue
    const a = boxes.get(first)!, b = boxes.get(second)!, [sideA, sideB] = sides(a, b)
    if (OPPOSITE[sideA] !== sideB || counts.get(`${first}\0${sideA}`) !== count || counts.get(`${second}\0${sideB}`) !== count) continue
    if (members.some(edge => { const [start, end] = sides(boxes.get(edge.source)!, boxes.get(edge.target)!); return edge.source === first ? start !== sideA || end !== sideB : start !== sideB || end !== sideA })) continue
    const along = sideA === 'L' || sideA === 'R' ? 'y' : 'x'
    const band = Math.max(...members.map(edge => (along === 'y' ? edge.labelBlock?.height : edge.labelBlock?.width) ?? 0)) + 16
    let level = true
    for (let index = 0; index < count && level; index++) {
      const at = port(a, sideA, index, count)[along]
      level = at === port(b, sideB, index, count)[along] && (index === 0 || at - port(a, sideA, index - 1, count)[along] >= band)
    }
    if (level) straight.add(key)
  }
  return straight
}

const DIRECTION: Record<Side, RouterDirection> = { T: 'N', R: 'E', B: 'S', L: 'W' }
const REVERSE: Record<RouterDirection, RouterDirection> = { N: 'S', S: 'N', E: 'W', W: 'E' }
/** Checked grid steps over all of one diagram's routes. */
const ROUTE_WORK = 400_000
/** Grid steps the router's early checks that a route can arrive at all may
 * read over one diagram, apart from the route work. A relationship tries
 * several obstacle sets before the one it draws with; the checks let an
 * attempt that cannot arrive stop after a few states instead of charging
 * every step it can reach. Once they are spent, attempts search in full. */
const PROBE_WORK = 400_000
/** Running off the preferred corridors costs this share of the run's length:
 * enough to settle equal routes on a corridor, never worth a bend. */
const OFF_CORRIDOR = 0.05
/** A crossing costs as much as a modest detour, never a bend. */
const CROSSING = 150
/** A route longer than this many times the distance between its ports is a
 * detour worth trying other faces for. */
export const C4_DETOUR = 1.5
/** The ratio from which a face trial is always kept: a route this long
 * circles the canvas (mermaid#7492). Trials below it are kept only where
 * the final captions and arrowheads collide no more than without them. */
export const C4_CIRCLING_DETOUR = 3
/** Lines beyond the outermost obstacle on each side, OUTER_PITCH apart
 * (the routes' separation). */
const OUTER_LINES = 4, OUTER_PITCH = 8
/** What one bend costs when comparing faces, in pixels of route. */
const DETOUR_BEND = 200
/** Grid steps all of one diagram's detour retries may check together. */
const DETOUR_WORK = 200_000
const DETOUR_SPENT = Symbol('C4 detour budget spent')
const SIDES: readonly Side[] = ['T', 'R', 'B', 'L']
const routeLength = (points: readonly Point[]): number => points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index]!.x) + Math.abs(point.y - points[index]!.y), 0)

export function routeC4Pixels(boxes: ReadonlyMap<string, C4Box>, positioned: { nodes: PositionedNode[]; groups: PositionedGroup[]; edges: PositionedEdge[] }, graph: MermaidGraph, style: LabelMetricsStyle, identities: ReturnType<typeof planC4Identity>, detour = C4_DETOUR): void {
  const { edges } = positioned
  const headerNodes: PositionedNode[] = [...boxes.values()].filter(box => box.container).map(box => ({ ...box, id: allocateGeneratedId(identities.generated, `c4-header-obstacle:${box.id}`, ['c4', 'header-obstacle', box.id]), height: box.headerHeight ?? 1, shape: 'rectangle', label: '' }))
  const physicalObstacles = [...positioned.nodes, ...headerNodes]
  let work = 0, probeWork = 0, detourWork = 0, detouring = false
  // Trying other faces for a detour spends its own budget: running out ends
  // the trying, never the diagram.
  const charge = () => {
    if (detouring) { if (++detourWork > DETOUR_WORK) throw DETOUR_SPENT; return }
    if (++work > ROUTE_WORK) throw new C4RouteWorkLimitError()
  }
  const probe = () => ++probeWork <= PROBE_WORK
  // A lead leaves its owner's face, so only obstacles spanning that face
  // across the lead's axis can stop it. Index them once per owner and axis
  // instead of scanning every card for every lead.
  const leadObstacles = new Map<string, PositionedNode[]>()
  const exit = (point: Point, side: Side, sign: number, lane: number, owner: string): Point => {
    const ray = { x: delta[side].x * sign, y: delta[side].y * sign }
    const face = boxes.get(owner), [at, span] = ray.x ? ['y', 'height'] as const : ['x', 'width'] as const
    let candidates = physicalObstacles
    if (face && point[at] >= face[at] && point[at] <= face[at] + face[span]) {
      const key = `${owner}\0${at}`
      let indexed = leadObstacles.get(key)
      if (!indexed) {
        indexed = physicalObstacles.filter(node => { charge(); return node.id !== owner && node[at] < face[at] + face[span] && node[at] + node[span] > face[at] })
        leadObstacles.set(key, indexed)
      }
      candidates = indexed
    }
    let distance = lane
    for (const node of candidates) {
      charge()
      if (node.id === owner) continue
      const aligned = ray.x ? point.y > node.y && point.y < node.y + node.height : point.x > node.x && point.x < node.x + node.width
      if (!aligned) continue
      const entry = ray.x > 0 ? node.x - point.x : ray.x < 0 ? point.x - node.x - node.width : ray.y > 0 ? node.y - point.y : point.y - node.y - node.height
      if (entry >= 0) distance = Math.min(distance, Math.max(0, entry - 2))
    }
    return { x: point.x + ray.x * distance, y: point.y + ray.y * distance }
  }
  const box = (node: PositionedNode, padX = 0, padY = 0): RouterBox => ({ x0: node.x - padX, y0: node.y - padY, x1: node.x + node.width + padX, y1: node.y + node.height + padY })
  const physical = physicalObstacles.map(node => box(node))
  // Routes cross boundary frames but never run along one, where it would
  // vanish into the frame's outline, and keep off the lines of routes
  // already drawn where they can.
  const frames = [...boxes.values()].filter(item => item.container).flatMap(item => {
    const x1 = item.x + item.width, y1 = item.y + item.height
    return [[{ x: item.x, y: item.y }, { x: x1, y: item.y }], [{ x: x1, y: item.y }, { x: x1, y: y1 }], [{ x: item.x, y: y1 }, { x: x1, y: y1 }], [{ x: item.x, y: item.y }, { x: item.x, y: y1 }]] as const
  })
  // The gutter between each frame and its contents is a corridor too, and so
  // is a line just outside each frame, for routes that pass around one.
  const gutters = { x: [] as number[], y: [] as number[] }
  for (const frame of boxes.values()) {
    if (!frame.container) continue
    const x1 = frame.x + frame.width, y1 = frame.y + frame.height
    gutters.x.push(frame.x - 16, x1 + 16)
    gutters.y.push(frame.y - 16, y1 + 16)
    const inside = [...boxes.values()].filter(item => item !== frame && contains(frame, item))
    if (!inside.length) continue
    gutters.x.push((frame.x + Math.min(...inside.map(item => item.x))) / 2, (x1 + Math.max(...inside.map(item => item.x + item.width))) / 2)
    gutters.y.push((frame.y + (frame.headerHeight ?? 0) + Math.min(...inside.map(item => item.y))) / 2, (y1 + Math.max(...inside.map(item => item.y + item.height))) / 2)
  }
  const drawn: (readonly [Point, Point])[] = []
  const crossings = { segments: drawn, cost: CROSSING }
  const keepOff = (segments: readonly (readonly [Point, Point])[]) => ({ segments, separation: 8, gap: 16 })
  const routed = new Map<PositionedEdge, Point[]>()
  const counts = new Map<string, number>(), cursors = new Map<string, number>()
  const plans = edges.flatMap(edge => { const source = boxes.get(edge.source), target = boxes.get(edge.target); if (!source || !target) return []; const [startSide, endSide] = sides(source, target); for (const [id, side] of [[source.id, startSide], [target.id, endSide]]) { const key = `${id}\0${side}`; counts.set(key, (counts.get(key) ?? 0) + 1) }; return [{ edge, source, target, startSide, endSide }] })
  const pairs = new Map<string, typeof plans>()
  for (const plan of plans) { const key = JSON.stringify([plan.source.id, plan.target.id].sort()); const members = pairs.get(key) ?? []; members.push(plan); pairs.set(key, members) }
  const claimed = new Set<string>()
  for (const [index, plan] of plans.entries()) {
    const { edge, source, target, startSide, endSide } = plan
    const cursor = (box: C4Box, side: Side) => { const key = `${box.id}\0${side}`, index = cursors.get(key) ?? 0; cursors.set(key, index + 1); return { index, count: counts.get(key)! } }
    const startPort = cursor(source, startSide), endPort = cursor(target, endSide)
    const start = port(source, startSide, startPort.index, startPort.count)
    const end = source.id === target.id ? port(target, endSide, endPort.index, endPort.count) : facingPort(start, startSide, target, endSide, endPort.index, endPort.count)
    const startSign = source.container && source.id !== target.id && contains(source, target) ? -1 : 1
    const endSign = target.container && source.id !== target.id && contains(target, source) ? -1 : 1
    const pair = pairs.get(JSON.stringify([source.id, target.id].sort()))!
    const lane = 14 + (index % 5) * 4
    const terminal = graphEdgeTerminalClearance(edge, style)
    // A corridor must carry its measured label halo as well as its stroke.
    // Otherwise a path ten pixels below a database is clear for ink while
    // its two-line label is still painted underneath the database surface.
    // A full halo cannot fit through every nested boundary exit; then the
    // route only keeps clear of actual cards and opaque headers, and the
    // final label allocator places the retained label.
    const padX = (edge.labelBlock?.width ?? 0) / 2 + 10, padY = (edge.labelBlock?.height ?? 0) / 2 + 8
    const padded = physicalObstacles.map(node => node.id === edge.source || node.id === edge.target ? box(node) : box(node, padX, padY))
    const attempt = (startSide: Side, endSide: Side, start: Point, end: Point) => {
      const corridor = startSide === 'R' || startSide === 'L'
        ? Math.max(24, ...pair.map(item => (item.edge.labelBlock?.width ?? 0) + 32))
        : Math.max(24, ...pair.map(item => (item.edge.labelBlock?.height ?? 0) + 24))
      const shift = (pair.indexOf(plan) - (pair.length - 1) / 2) * corridor
      const startExit = exit(start, startSide, startSign, Math.max(lane, terminal.start ? terminal.start + (style.edgeBendRadius ?? 0) : 0), source.id)
      const endExit = exit(end, endSide, endSign, Math.max(lane, terminal.end ? terminal.end + (style.edgeBendRadius ?? 0) : 0), target.id)
      // C4 owns the physical face choice, the port leads and the corridors it
      // prefers: midway between the two leads, shifted apart for repeated
      // interactions between one pair, and for a self-interaction a loop wide
      // enough for its label. The shared router finds the route around every
      // card and header band.
      const preferred = source.id === target.id
        ? { x: [source.x + source.width + lane + (edge.labelBlock?.width ?? 0) / 2], y: [source.y + source.height + lane + (edge.labelBlock?.height ?? 0) / 2] }
        : startSide === 'R' || startSide === 'L' ? { x: [(startExit.x + endExit.x) / 2 + shift], y: [] } : { x: [], y: [(startExit.y + endExit.y) / 2 + shift] }
      // A face trial also has lines beyond everything the route keeps off, a
      // route separation apart, so it can pass round the outside of routes
      // already drawn in the outermost gutter (official fence #2). Only
      // trials have them: they search their own budget, and the extra lines
      // would cost every first route search work.
      const outer = { x: [] as number[], y: [] as number[] }
      if (detouring) {
        const [x0, y0, x1, y1] = [Math.min(...padded.map(b => b.x0)), Math.min(...padded.map(b => b.y0)), Math.max(...padded.map(b => b.x1)), Math.max(...padded.map(b => b.y1))]
        for (let k = 1; k <= OUTER_LINES; k++) { outer.x.push(x0 - k * OUTER_PITCH, x1 + k * OUTER_PITCH); outer.y.push(y0 - k * OUTER_PITCH, y1 + k * OUTER_PITCH) }
      }
      const channels = { x: [...preferred.x, ...gutters.x, ...outer.x], y: [...preferred.y, ...gutters.y, ...outer.y] }
      const leave = startSign > 0 ? DIRECTION[startSide] : REVERSE[DIRECTION[startSide]]
      const arrive = REVERSE[endSign > 0 ? DIRECTION[endSide] : REVERSE[DIRECTION[endSide]]]
      const request = { start, end, exit: leave, entry: arrive, stub: [Math.abs(startExit.x - start.x) + Math.abs(startExit.y - start.y), Math.abs(endExit.x - end.x) + Math.abs(endExit.y - end.y)] as const,
        clearance: 0, channels, offChannelCost: OFF_CORRIDOR, crossings, charge, probe }
      let route: Point[] | undefined
      search: for (const avoid of drawn.length ? [keepOff([...frames, ...drawn]), keepOff(frames)] : [keepOff(frames)]) for (const obstacles of [padded, physical]) {
        route = routeOrthogonal({ ...request, obstacles, avoid })
        if (route) break search
      }
      return { route, request }
    }
    const first = attempt(startSide, endSide, start, end)
    // Leads that end against another card leave no clear route; draw the
    // plainest orthogonal one rather than none.
    let route = first.route ?? routeOrthogonal({ ...first.request, obstacles: physical }) ?? routeOrthogonal({ ...first.request, obstacles: [] }) ?? orthogonalFallback(first.request)
    // Centred ports on facing faces of offset cards jog between them
    // (mermaid-v13#1177). A relationship that is alone on both faces moves
    // its two ends along them, within the middle half of each, to one
    // straight run, where that run keeps the rules its route was searched
    // under.
    if (route.length > 2 && source.id !== target.id && startSign > 0 && endSign > 0 && OPPOSITE[startSide] === endSide && counts.get(`${source.id}\0${startSide}`) === 1 && counts.get(`${target.id}\0${endSide}`) === 1) {
      const along = startSide === 'L' || startSide === 'R' ? 'y' : 'x'
      const middle = (item: C4Box, side: Side) => [portAt(item, side, 0.25)[along], portAt(item, side, 0.75)[along]] as const
      const slide = { start: middle(source, startSide), end: middle(target, endSide) }
      let straight: Point[] | undefined
      search: for (const avoid of drawn.length ? [keepOff([...frames, ...drawn]), keepOff(frames)] : [keepOff(frames)]) for (const obstacles of [padded, physical]) {
        straight = routeStraight({ ...first.request, obstacles, avoid }, slide)
        if (straight) break search
      }
      // A cylinder's curved face lies a little off the line its centre
      // port gives; the run keeps its line and ends on the face.
      const onFace = (item: C4Box, side: Side, point: Point) => {
        const from = portAt(item, side, 0)[along], to = portAt(item, side, 1)[along]
        return { ...portAt(item, side, (point[along] - from) / (to - from)), [along]: point[along] }
      }
      if (straight) route = [onFace(source, startSide, straight[0]!), onFace(target, endSide, straight[1]!)]
    }
    // The faces facing each other can force a route round the canvas, for
    // example out of a boundary whose header band blocks the way up
    // (mermaid#7492). Then try the faces no other interaction uses, and keep
    // the route that is shortest once each bend and crossing is charged.
    if (source.id !== target.id && startSign > 0 && endSign > 0 && routeLength(route) > detour * (Math.abs(end.x - start.x) + Math.abs(end.y - start.y))) {
      const free = (item: C4Box, side: Side) => !counts.has(`${item.id}\0${side}`) && !claimed.has(`${item.id}\0${side}`)
      const score = (points: readonly Point[]) => routeLength(points) + DETOUR_BEND * (simplifyPolyline(points.map(point => ({ x: point.x, y: point.y }))).length - 2)
        + CROSSING * countPolylineCrossings([{ points }, ...drawn.map(segment => ({ points: segment }))], new Set([0]))
      let best = { route, score: score(route), faces: [] as string[] }
      detouring = true
      try {
        for (const from of SIDES) for (const to of SIDES) {
          // The planned faces too: a trial routes with the outer lines.
          if ((from !== startSide && !free(source, from)) || (to !== endSide && !free(target, to))) continue
          const alternative = attempt(from, to, from === startSide ? start : portAt(source, from, 0.5), to === endSide ? end : portAt(target, to, 0.5)).route
          if (!alternative) continue
          const value = score(alternative)
          if (value < best.score - 0.5) best = { route: alternative, score: value, faces: [...from === startSide ? [] : [`${source.id}\0${from}`], ...to === endSide ? [] : [`${target.id}\0${to}`]] }
        }
      } catch (error) {
        if (error !== DETOUR_SPENT) throw error
      } finally {
        detouring = false
      }
      route = best.route
      for (const face of best.faces) claimed.add(face)
    }
    edge.points = simplifyPolyline(route.map(point => ({ x: point.x, y: point.y })))
    routed.set(edge, edge.points.map(point => ({ ...point })))
    for (let at = 1; at < edge.points.length; at++) drawn.push([edge.points[at - 1]!, edge.points[at]!])
    if (edge.label) edge.labelPosition = calculatePathMidpoint(edge.points)
  }
  // Shared graph route passes certify the routes; the routes themselves stay
  // as routed and their captions are seated below.
  applyRouteContracts(positioned, graph, new Set(), style)
  closeRouteContracts(positioned, graph, style)
  for (const edge of edges) {
    const points = routed.get(edge)
    if (!points) continue
    edge.points = points
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
  separateEdgeLabelPills(labelPositioned, graph, style, { seats: denseLabelSeats })
  for (const edge of edges) { const source = boxes.get(edge.source)!, target = boxes.get(edge.target)!; recertifyReroutedEdge(edge, edge.routeCertificate, { ...source, label: '', shape: 'rectangle' }, { ...target, label: '', shape: 'rectangle' }) }
}
