import type { Direction as DiagramDirection } from '../types.ts'
import type { Direction, GridCoord } from './types.ts'
import { Up, Down, Left, Right, gridKey } from './types.ts'
import { getClearAxisPath, getPath, type RouteSearchWork, type RouteStep } from './pathfinder.ts'
import { OccupancyMap } from './occupancy.ts'
import { allocateFacePort, countFaceDemand, faceSize } from './terminal-geometry.ts'
import { tryParseCssColor, toHex } from '../shared/color-math.ts'
import { measuredText, type MeasuredTerminalText, type TerminalBounds, type TerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { allocateTerminalRoute, paintTerminalBus, paintTerminalRoute, type TerminalRoute } from './terminal-route.ts'
import { drawMultiBox } from './draw.ts'
import { TERMINAL_ROUTE_CHANNEL_LIMIT, TERMINAL_ROUTE_SEARCH_LIMIT, TerminalWorkLimitError } from './terminal-limits.ts'

export type BoxSide = 'T' | 'B' | 'L' | 'R'
/** Distance from the exterior port to the first freely routed cell. The
 * protected approach includes both ends, so it occupies distance + 1 cells. */
export const BOX_ROUTE_APPROACH_DISTANCE = 2
export interface TerminalBox extends TerminalBounds {
  id: string
  container?: boolean
  headerHeight?: number
  /** A container's header text cells. Given them, routes may cross the rest
   * of the header band straight through, as they cross its other borders, but
   * never run along inside it; without them the whole band is an obstacle.
   * Captions still keep out of the band. */
  headerLabel?: TerminalBounds
  /** The cards an enclosing container (a class namespace) holds, at any
   * depth. Given them, a route crosses the container's border only straight
   * through, perpendicular to it and never at a corner, and only when one of
   * the route's endpoints lies inside; every other route keeps out of it. */
  encloses?: ReadonlySet<string>
}
export interface BoxRelation {
  id: string
  from: string
  to: string
  lines?: readonly string[]
  fromLines?: readonly string[]
  toLines?: readonly string[]
}
export interface BoxPort extends Readonly<GridCoord> { readonly side: BoxSide }
/**
 * A closed complete-bipartite block of alike relations, drawn as one bus: each
 * source's relations leave through one shared port and stem into a collector
 * run, the collector meets a distributor run at one junction, and the
 * distributor stems into one shared port of each target. Every relation keeps
 * its own identity, endpoints and markers along its own complete path. Shared
 * bus ink misstates nothing because the block is complete: wherever the paths
 * of s -> t and s' -> t' share ink, s -> t' and s' -> t are also relations of
 * the block, alike. Collector ink runs toward the junction and distributor ink
 * away from it, so no two members share a cell in opposite directions.
 */
export interface BoxBus {
  readonly id: string
  /** Indices of the member relations, in authored order. */
  readonly members: readonly number[]
  readonly sources: readonly string[]
  readonly targets: readonly string[]
}
export interface BoxText extends Readonly<TerminalBounds> { readonly lines: readonly string[]; readonly text: MeasuredTerminalText }
export class TerminalBoxRouteUnavailable extends Error {
  constructor(message: string, readonly relationIndex: number) { super(message) }
}
const allocatedRoute = Symbol('allocated terminal box route')
const allocatedRoutes = new WeakSet<object>()
export interface BoxRoute {
  readonly [allocatedRoute]: true
  readonly relation: Readonly<BoxRelation>
  readonly source: BoxPort
  readonly target: BoxPort
  readonly points: readonly Readonly<GridCoord>[]
  readonly path: TerminalRoute
  readonly label?: BoxText
  readonly fromLabel?: BoxText
  readonly toLabel?: BoxText
}

const delta: Record<BoxSide, GridCoord> = { T: { x: 0, y: -1 }, B: { x: 0, y: 1 }, L: { x: -1, y: 0 }, R: { x: 1, y: 0 } }
const preferred: Record<BoxSide, Direction> = { T: Up, B: Down, L: Left, R: Right }
function sides(relation: BoxRelation, direction: DiagramDirection, boxes?: ReadonlyMap<string, TerminalBox>): readonly [BoxSide, BoxSide] {
  if (relation.from === relation.to) return ['R', 'B']
  const from = boxes?.get(relation.from), to = boxes?.get(relation.to)
  if (from && to) {
    const vertical = direction !== 'LR' && direction !== 'RL'
    if (vertical && from.y + from.height <= to.y) return ['B', 'T']
    if (vertical && to.y + to.height <= from.y) return ['T', 'B']
    if (from.x + from.width <= to.x) return ['R', 'L']
    if (to.x + to.width <= from.x) return ['L', 'R']
    if (from.y + from.height <= to.y) return ['B', 'T']
    if (to.y + to.height <= from.y) return ['T', 'B']
  }
  if (direction === 'LR') return ['R', 'L']
  if (direction === 'RL') return ['L', 'R']
  if (direction === 'BT') return ['T', 'B']
  return ['B', 'T']
}

/**
 * The closed complete-bipartite blocks of alike relations that contract to a
 * bus: sources S and targets T with |S|, |T| >= 2 and |S||T| > |S| + |T|,
 * every s -> t joined by exactly one relation, all with the same defined
 * `signature` (the family's complete shared paint: kind, markers, shaft, and
 * no text), and no other relation leaving a source or entering a target.
 * Deterministic: blocks follow their first member, members authored order.
 */
export function bipartiteBuses(relations: readonly BoxRelation[], signature: (relation: BoxRelation, index: number) => string | undefined): BoxBus[] {
  const pairs = new Map<string, number>(), outgoing = new Map<string, number>(), incoming = new Map<string, number>()
  for (const relation of relations) {
    const pair = JSON.stringify([relation.from, relation.to])
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1)
    outgoing.set(relation.from, (outgoing.get(relation.from) ?? 0) + 1)
    incoming.set(relation.to, (incoming.get(relation.to) ?? 0) + 1)
  }
  const families = new Map<string, Map<string, number[]>>(), order = new Map<string, number>()
  relations.forEach((relation, index) => {
    for (const id of [relation.from, relation.to]) if (!order.has(id)) order.set(id, order.size)
    const family = relation.from === relation.to || pairs.get(JSON.stringify([relation.from, relation.to])) !== 1 ? undefined : signature(relation, index)
    if (family === undefined) return
    const bySource = families.get(family) ?? new Map<string, number[]>()
    families.set(family, bySource)
    bySource.set(relation.from, [...(bySource.get(relation.from) ?? []), index])
  })
  const buses: Array<Omit<BoxBus, 'id'>> = []
  for (const bySource of families.values()) {
    const byTargets = new Map<string, { members: number[]; sources: string[]; targets: string[] }>()
    for (const [source, members] of bySource) {
      const targets = members.map(index => relations[index]!.to).sort((a, b) => order.get(a)! - order.get(b)!), key = JSON.stringify(targets)
      const draft = byTargets.get(key)
      if (draft) { draft.sources.push(source); draft.members.push(...members) } else byTargets.set(key, { members: [...members], sources: [source], targets })
    }
    for (const { members, sources, targets } of byTargets.values()) {
      if (sources.length < 2 || targets.length < 2 || sources.length * targets.length <= sources.length + targets.length) continue
      if (sources.some(id => outgoing.get(id) !== targets.length) || targets.some(id => incoming.get(id) !== sources.length)) continue
      buses.push({ members: members.sort((a, b) => a - b), sources, targets })
    }
  }
  return buses.sort((a, b) => a.members[0]! - b.members[0]!).map((bus, index) => Object.freeze({ id: `bus:${index}`, ...bus }))
}

/** Face capacity belongs to allocation, before any node or connector is painted. */
export function boxFaceSizes(relations: readonly BoxRelation[], direction: DiagramDirection, boxes?: readonly TerminalBox[], buses: readonly BoxBus[] = []): Map<string, { width: number; height: number }> {
  const counts = faceCounts(relations, direction, boxes ? new Map(boxes.map(box => [box.id, box])) : undefined, buses)
  return new Map([...counts].map(([id, count]) => [id, faceSize(count)]))
}

/** The bus each relation index belongs to. */
const busOf = (buses: readonly BoxBus[]): Map<number, BoxBus> => new Map(buses.flatMap(bus => bus.members.map(index => [index, bus] as const)))

/** A bus's relations at one card face share one port, so they demand one. */
function faceCounts(relations: readonly BoxRelation[], direction: DiagramDirection, boxes?: ReadonlyMap<string, TerminalBox>, buses: readonly BoxBus[] = []): Map<string, Record<BoxSide, number>> {
  const member = busOf(buses), shared = new Set<string>()
  return countFaceDemand(relations.flatMap((relation, index) => {
    const [from, to] = sides(relation, direction, boxes), bus = member.get(index)
    return ([['start', relation.from, from], ['end', relation.to, to]] as const).flatMap(([end, id, side]) => {
      if (bus) {
        const key = `${bus.id}\0${end}\0${id}\0${side}`
        if (shared.has(key)) return []
        shared.add(key)
      }
      return [{ id, side }]
    })
  }))
}

export { faceCounts as boxFaceDemands }

function sealRoute(route: Omit<BoxRoute, typeof allocatedRoute | 'path'>): BoxRoute {
  const path = allocateTerminalRoute(route.relation.id,
    { ...route.source, nodeId: route.relation.from, end: 'start' },
    { ...route.target, nodeId: route.relation.to, end: 'end' }, route.points)
  const relation = Object.freeze({ ...route.relation, ...Object.fromEntries(['lines', 'fromLines', 'toLines'].flatMap(key => {
    const lines = route.relation[key as 'lines']
    return lines ? [[key, Object.freeze([...lines])]] : []
  })) })
  const allocated = Object.freeze({ ...route, [allocatedRoute]: true as const, relation, points: path.points, path })
  allocatedRoutes.add(allocated)
  return allocated
}

/** Reflect model rectangles in cell space. Their text is laid out afterwards. */
export function reverseBoxes(boxes: Iterable<TerminalBox>, direction: DiagramDirection): void {
  const items = [...boxes]
  if (direction !== 'RL' && direction !== 'BT') return
  const right = Math.max(0, ...items.map(box => box.x + box.width)), bottom = Math.max(0, ...items.map(box => box.y + box.height))
  const left = Math.min(Infinity, ...items.map(box => box.x)), top = Math.min(Infinity, ...items.map(box => box.y))
  const marginX = Math.max(4, left), marginY = Math.max(4, top)
  for (const box of items) {
    if (direction === 'RL') box.x = right - box.x - box.width + marginX
    else box.y = bottom - box.y - box.height + marginY
  }
}

const overlaps = (a: TerminalBounds, b: TerminalBounds): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/**
 * Reuse the terminal A* search, with one per-render occupancy map. Card faces,
 * marker exits, all text rectangles and earlier routes are allocated here.
 * Family code supplies its own boxes, labels and endpoint marker semantics.
 */
export function allocateBoxRoutes(boxes: readonly TerminalBox[], relations: readonly BoxRelation[], direction: DiagramDirection, additionalObstacles: readonly TerminalBox[] = [], work?: RouteSearchWork, first: readonly number[] = [], fanning?: (relation: BoxRelation) => boolean, buses: readonly BoxBus[] = []): BoxRoute[] {
  const byId = new Map(boxes.map(box => [box.id, box]))
  const member = busOf(buses)
  const counts = faceCounts(relations, direction, byId, buses), cursors = new Map<string, number>()
  // Self-relationships leave the right face and return through the bottom
  // face, one nested slot each: the n-th loop of a card (n = 0 innermost)
  // takes the n-th port from that corner on both faces, so the loops nest
  // without crossing. Every other endpoint keeps its encounter order, except
  // that a fan's endpoints take its slots in the order of their opposite
  // cards along the face (encounter order between equals), so the fan's
  // routes need not cross one another.
  const selfRank = new Map<BoxRelation, number>(), selfCount = new Map<string, number>()
  for (const relation of relations) {
    if (relation.from !== relation.to) continue
    const rank = selfCount.get(relation.from) ?? 0
    selfRank.set(relation, rank); selfCount.set(relation.from, rank + 1)
  }
  // A fan is a face of three or more ports, all of `fanning` relations, whose
  // routes, all but at most one, meet a face of fewer at their other end (a
  // star's hub, not a crowded all-pairs table).
  const slots = new Map<string, number>(), fanFaces = new Set<string>()
  if (fanning) {
    const faces = new Map<string, Array<{ end: string; along: number; order: number; opposite: number; fanning: boolean }>>()
    relations.forEach((relation, index) => {
      if (relation.from === relation.to || !byId.has(relation.from) || !byId.has(relation.to)) return
      const [fromSide, toSide] = sides(relation, direction, byId)
      for (const [end, id, side, otherId, otherSide] of [['start', relation.from, fromSide, relation.to, toSide], ['end', relation.to, toSide, relation.from, fromSide]] as const) {
        const other = byId.get(otherId)!, face = faces.get(`${id}\0${side}`) ?? []
        face.push({ end: `${index}\0${end}`, along: side === 'T' || side === 'B' ? 2 * other.x + other.width : 2 * other.y + other.height, order: face.length, opposite: counts.get(otherId)![otherSide], fanning: fanning(relation) && !member.has(index) })
        faces.set(`${id}\0${side}`, face)
      }
    })
    for (const [key, face] of faces) {
      if (face.length < 3 || face.some(endpoint => !endpoint.fanning) || face.filter(endpoint => endpoint.opposite >= 3).length > 1) continue
      fanFaces.add(key)
      face.sort((a, b) => a.along - b.along || a.order - b.order).forEach((endpoint, slot) => slots.set(endpoint.end, slot))
    }
  }
  // A bus's relations at one face take the one port its first member takes.
  const sharedPorts = new Map<string, BoxPort>()
  const port = (id: string, side: BoxSide, end: string, loop?: number, shared?: string): BoxPort => {
    const known = shared === undefined ? undefined : sharedPorts.get(shared)
    if (known) return known
    const box = byId.get(id)!, count = counts.get(id)![side]
    if (loop !== undefined) return allocateFacePort(box, side, count - 1 - loop, count)
    const key = `${id}\0${side}`, index = slots.get(end) ?? cursors.get(key) ?? 0
    cursors.set(key, (cursors.get(key) ?? 0) + 1)
    const allocated = allocateFacePort(box, side, index, count)
    if (shared !== undefined) sharedPorts.set(shared, allocated)
    return allocated
  }
  const plans = relations.map((relation, index) => {
    if (!byId.has(relation.from) || !byId.has(relation.to)) throw new Error(`Terminal route ${relation.id} has no allocated endpoint box`)
    const [from, to] = sides(relation, direction, byId)
    const loop = selfRank.get(relation), bus = member.get(index)
    return { relation, index, source: port(relation.from, from, `${index}\0start`, loop, bus && `${bus.id}\0start\0${relation.from}\0${from}`), target: port(relation.to, to, `${index}\0end`, loop, bus && `${bus.id}\0end\0${relation.to}\0${to}`), ...(loop === undefined ? {} : { loop }) }
  })
  // The map is a search adapter over cell rectangles; its payload is unused by
  // getPath. No family-specific node store or dense output canvas is copied.
  const blocker = true
  // Route axes: 1 horizontal, 2 vertical, 3 a turn or an existing crossing.
  const occupied = new OccupancyMap(), cardCells = new Set<string>(), routeCells = new Map<string, number>()
  // Every occupied cell except crossable route ink: cards, protected marker
  // approaches and text. The crossing search reads it directly instead of
  // removing and restoring all earlier route ink for each failed route.
  const solid = new OccupancyMap()
  // Numeric mirror of routeCells (cells are nonnegative) for the crossing rule.
  const routeAxes = new Map<number, number>()
  // The low bit protects a physical approach; upper bits count pending
  // caption-only escape reservations beyond those approaches.
  const markerCells = new Map<string, number>()
  const textBounds: TerminalBounds[] = []
  const occupy = (bounds: TerminalBounds) => {
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) { occupied.set(`${x},${y}`, blocker); solid.set(`${x},${y}`, blocker) }
  }
  const geometry = [...boxes, ...additionalObstacles]
  const obstacles = geometry.flatMap(box => box.container ? [box.headerLabel ?? { x: box.x, y: box.y, width: box.width, height: box.headerHeight ?? 1 }] : [box])
  const textObstacles = geometry.flatMap(box => box.container ? [
    { x: box.x, y: box.y, width: box.width, height: box.headerHeight ?? 1 },
    { x: box.x, y: box.y, width: 1, height: box.height },
    { x: box.x + box.width - 1, y: box.y, width: 1, height: box.height },
    { x: box.x, y: box.y + box.height - 1, width: box.width, height: 1 },
  ] : [box])
  obstacles.forEach(occupy)
  // A header band whose text cells are named is crossed, never travelled:
  // no horizontal step may enter, leave or run inside it.
  const bandCells = new Set<number>()
  for (const box of geometry) if (box.container && box.headerLabel) {
    const label = box.headerLabel
    for (let y = box.y; y < box.y + (box.headerHeight ?? 1); y++) for (let x = box.x; x < box.x + box.width; x++) {
      if (!overlaps(label, { x, y, width: 1, height: 1 })) bandCells.add(x * 0x4000000 + y)
    }
  }
  const acrossBands = bandCells.size ? (fromX: number, fromY: number, toX: number, toY: number): boolean => fromX === toX || (!bandCells.has(fromX * 0x4000000 + fromY) && !bandCells.has(toX * 0x4000000 + toY)) : undefined
  // Enclosing borders: the container's index and the step axis that may
  // cross each border cell (1 horizontal, 2 vertical, 0 none at a corner).
  const enclosures = geometry.filter(box => box.container && box.encloses)
  const borderCells = new Map<number, { frame: number; axis: number }>()
  enclosures.forEach((box, frame) => {
    const right = box.x + box.width - 1, bottom = box.y + box.height - 1
    for (let x = box.x; x <= right; x++) for (const y of [box.y, bottom]) borderCells.set(x * 0x4000000 + y, { frame, axis: x === box.x || x === right ? 0 : 2 })
    for (let y = box.y + 1; y < bottom; y++) for (const x of [box.x, right]) borderCells.set(x * 0x4000000 + y, { frame, axis: 1 })
  })
  const stepPolicy = (relation: BoxRelation): RouteStep | undefined => {
    if (!borderCells.size) return acrossBands
    const entered = enclosures.map(box => box.encloses!.has(relation.from) || box.encloses!.has(relation.to))
    const crosses = (key: number, axis: number): boolean => {
      const border = borderCells.get(key)
      return !border || (entered[border.frame]! && border.axis === axis)
    }
    return (fromX, fromY, toX, toY) => {
      const axis = fromX === toX ? 2 : 1
      return crosses(fromX * 0x4000000 + fromY, axis) && crosses(toX * 0x4000000 + toY, axis) && (!acrossBands || acrossBands(fromX, fromY, toX, toY))
    }
  }
  for (const key of occupied.keys()) cardCells.add(key)
  for (const plan of plans) for (const point of [plan.source, plan.target]) {
    const d = delta[point.side]
    for (let step = 0; step <= BOX_ROUTE_APPROACH_DISTANCE + 1; step++) {
      const key = `${point.x + d.x * step},${point.y + d.y * step}`
      const previous = markerCells.get(key) ?? 0
      markerCells.set(key, step <= BOX_ROUTE_APPROACH_DISTANCE ? previous | 1 : previous + 2)
    }
  }
  const text = (lines: readonly string[] | undefined, anchors: readonly GridCoord[]): BoxText | undefined => {
    if (!lines?.some(line => line.length > 0)) return undefined
    const measured = measuredText(lines), width = measured.width, height = measured.height
    const free = (bounds: TerminalBounds) => {
      const clearance = { x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2 }
      if (bounds.x < 0 || bounds.y < 0 || textObstacles.some(box => overlaps(clearance, box)) || textBounds.some(other => overlaps(clearance, other))) return false
      // A later route may need to cross earlier ink before turning into its
      // approach. Caption-only escape cells retain room on both sides of that
      // crossing without extending the protected routing obstacle.
      for (let y = clearance.y; y < clearance.y + clearance.height; y++) for (let x = clearance.x; x < clearance.x + clearance.width; x++) if (markerCells.has(`${x},${y}`)) return false
      for (let y = bounds.y; y < bounds.y + height; y++) for (let x = bounds.x; x < bounds.x + width; x++) if (routeCells.has(`${x},${y}`)) return false
      return true
    }
    // Nearest meaningful anchors first; all candidates are complete rectangles.
    for (let radius = 0; radius < 24; radius++) for (const anchor of anchors) {
      const candidates = [
        { x: anchor.x + 2, y: anchor.y - height - radius },
        { x: anchor.x + 2 + radius, y: anchor.y },
        { x: anchor.x - width - 2 - radius, y: anchor.y },
        { x: anchor.x + 2, y: anchor.y + 1 + radius },
      ]
      for (const candidate of candidates) {
        const bounds = { ...candidate, width, height }
        if (!free(bounds)) continue
        textBounds.push(bounds); occupy(bounds)
        return Object.freeze({ ...bounds, lines: Object.freeze([...lines]), text: measured })
      }
    }
    // A non-clipping feasible fallback is outside the occupied geometry. Hard
    // width policy can refuse this complete result with its existing error.
    let x = Math.max(2, ...geometry.map(box => box.x + box.width + 2), ...textBounds.map(bounds => bounds.x + bounds.width + 2))
    const y = Math.max(0, anchors[0]?.y ?? 0)
    while (!free({ x, y, width, height })) x++
    const bounds = { x, y, width, height }; textBounds.push(bounds); occupy(bounds)
    return Object.freeze({ ...bounds, lines: Object.freeze([...lines]), text: measured })
  }
  for (const [key, reservation] of markerCells) if (reservation & 1) { occupied.set(key, blocker); solid.set(key, blocker) }
  const routes: BoxRoute[] = []
  const physicalMarker = (key: string) => ((markerCells.get(key) ?? 0) & 1) === 1
  const approachCells = (port: BoxPort, steps = BOX_ROUTE_APPROACH_DISTANCE) => Array.from({ length: steps + 1 }, (_, step) => `${port.x + delta[port.side].x * step},${port.y + delta[port.side].y * step}`)
  const record = (points: readonly GridCoord[]) => {
    for (let index = 0; index < points.length; index++) {
      const point = points[index]!, previous = points[index - 1], next = points[index + 1], key = gridKey(point)
      const axis = (previous ? previous.x === point.x ? 2 : 1 : 0) | (next ? next.x === point.x ? 2 : 1 : 0)
      routeCells.set(key, (routeCells.get(key) ?? 0) | axis); occupied.set(key, blocker)
      routeAxes.set(point.x * 0x4000000 + point.y, routeCells.get(key)!)
    }
  }
  // Only unallocated routes need caption escape space. Retiring a route
  // retains coincident physical approaches and other pending reservations.
  const retireReservations = (source: BoxPort, target: BoxPort) => {
    for (const point of [source, target]) {
      const d = delta[point.side], distance = BOX_ROUTE_APPROACH_DISTANCE + 1
      const key = `${point.x + d.x * distance},${point.y + d.y * distance}`, remaining = markerCells.get(key)! - 2
      if (remaining) markerCells.set(key, remaining)
      else markerCells.delete(key)
    }
  }
  /** Self-loop labels, and the cells of every self-loop route. A loop label
   * touches its own loop and keeps a blank cell from every other loop. */
  const loopLabels: TerminalBounds[] = [], loopCells = new Set<string>()
  const ring = (bounds: TerminalBounds) => Array.from({ length: (bounds.width + 2) * (bounds.height + 2) }, (_, i) => ({ x: bounds.x - 1 + (i % (bounds.width + 2)), y: bounds.y - 1 + Math.floor(i / (bounds.width + 2)) }))
    .filter(cell => cell.x < bounds.x || cell.x >= bounds.x + bounds.width || cell.y < bounds.y || cell.y >= bounds.y + bounds.height)
  /** The next free nested slot outside each card's right-bottom corner. */
  const loopSlot = new Map<string, { x: number; y: number }>()
  /**
   * A self-loop drawn as its own nested slot around the card's right-bottom
   * corner: out of the right face, down past the bottom, back into the bottom
   * face. Its label sits just inside the slot, under the loop's bottom leg and
   * beside its rising leg; the next loop of the card passes outside that
   * label with a blank cell between. Undefined when the slot would touch a
   * card, another endpoint approach, text or an earlier route.
   */
  const constructLoop = (plan: (typeof plans)[number]): { points: GridCoord[]; label?: BoxText } | undefined => {
    const { relation, source, target } = plan
    if (source.side !== 'R' || target.side !== 'B') return undefined
    const slot = loopSlot.get(relation.from) ?? { x: source.x + BOX_ROUTE_APPROACH_DISTANCE + 1, y: target.y + BOX_ROUTE_APPROACH_DISTANCE + 1 }
    const points: GridCoord[] = []
    const run = (to: GridCoord) => {
      const from = points.at(-1)!, dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y)
      for (let x = from.x + dx, y = from.y + dy; x !== to.x + dx || y !== to.y + dy; x += dx, y += dy) points.push({ x, y })
    }
    points.push({ x: source.x, y: source.y })
    run({ x: slot.x, y: source.y }); run({ x: slot.x, y: slot.y }); run({ x: target.x, y: slot.y }); run({ x: target.x, y: target.y })
    // Its own approaches and caption escape cells belong to this loop.
    const own = new Set([...approachCells(source, BOX_ROUTE_APPROACH_DISTANCE + 1), ...approachCells(target, BOX_ROUTE_APPROACH_DISTANCE + 1)])
    const nearLabel = new Set(loopLabels.flatMap(ring).map(gridKey))
    if (points.some(point => {
      const key = gridKey(point)
      return cardCells.has(key) || routeCells.has(key) || nearLabel.has(key) || (physicalMarker(key) && !own.has(key)) || textBounds.some(bounds => overlaps(bounds, { ...point, width: 1, height: 1 }))
    })) return undefined
    let label: BoxText | undefined
    let next = { x: slot.x + 2, y: slot.y + 2 }
    if (relation.lines?.some(line => line.length > 0)) {
      const measured = measuredText(relation.lines), bounds = { x: target.x + 1, y: slot.y + 1, width: measured.width, height: measured.height }
      const clearance = { x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2 }
      const blocked = (x: number, y: number) => cardCells.has(`${x},${y}`) || routeCells.has(`${x},${y}`) || (markerCells.has(`${x},${y}`) && !own.has(`${x},${y}`)) || points.some(point => point.x === x && point.y === y)
      let clear = !textObstacles.some(box => overlaps(clearance, box)) && !textBounds.some(other => overlaps(clearance, other))
      for (let y = bounds.y; clear && y < bounds.y + bounds.height; y++) for (let x = bounds.x; clear && x < bounds.x + bounds.width; x++) if (blocked(x, y)) clear = false
      if (!clear) return undefined
      label = Object.freeze({ ...bounds, lines: Object.freeze([...relation.lines]), text: measured })
      next = { x: Math.max(next.x, bounds.x + bounds.width + 1), y: bounds.y + bounds.height + 1 }
    }
    loopSlot.set(relation.from, next)
    if (label) { textBounds.push(label); occupy(label); loopLabels.push(label) }
    return { points, ...(label ? { label } : {}) }
  }
  /** A searched self-loop's label: the first free rectangle touching its own
   * path (under, over, right of or left of a path cell, lowest cells first)
   * that no other loop touches. Undefined when there is none. */
  const searchedLoopLabel = (lines: readonly string[] | undefined, points: readonly GridCoord[]): BoxText | undefined => {
    if (!lines?.some(line => line.length > 0)) return undefined
    const measured = measuredText(lines), own = new Set(points.map(gridKey))
    const free = (bounds: TerminalBounds) => {
      const clearance = { x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2 }
      if (bounds.x < 0 || bounds.y < 0 || textObstacles.some(box => overlaps(clearance, box)) || textBounds.some(other => overlaps(clearance, other))) return false
      for (let y = clearance.y; y < clearance.y + clearance.height; y++) for (let x = clearance.x; x < clearance.x + clearance.width; x++) if (markerCells.has(`${x},${y}`)) return false
      for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) if (routeCells.has(`${x},${y}`)) return false
      return true
    }
    const cells = [...points].sort((a, b) => b.y - a.y || a.x - b.x)
    for (const cell of cells) {
      for (const candidate of [{ x: cell.x, y: cell.y + 1 }, { x: cell.x, y: cell.y - measured.height }, { x: cell.x + 1, y: cell.y }, { x: cell.x - measured.width, y: cell.y }]) {
        const bounds = { ...candidate, width: measured.width, height: measured.height }
        if (!free(bounds) || points.some(point => overlaps(bounds, { ...point, width: 1, height: 1 }))) continue
        if (ring(bounds).some(around => loopCells.has(gridKey(around)) && !own.has(gridKey(around)))) continue
        textBounds.push(bounds); occupy(bounds); loopLabels.push(bounds)
        return Object.freeze({ ...bounds, lines: Object.freeze([...lines]), text: measured })
      }
    }
    return undefined
  }
  /**
   * Every bus is drawn before any other route searches, at fixed cells: from
   * each shared source port straight across the gap to the collector run,
   * along it to the junction, two cells on to the distributor run, along it
   * and straight into each shared target port. The collector runs on the
   * first row (or column) past every source approach, the distributor two
   * cells beyond, and the junction at the members' median crossing, unless
   * those cells touch a card, text, another route or an unrelated approach,
   * when the next feasible row and junction are taken. Later routes cross
   * bus ink only perpendicularly, as they cross any route.
   */
  function constructBuses(): Set<number> {
    const done = new Set<number>(), planAt = new Map(plans.map(plan => [plan.index, plan]))
    const opposite = { T: 'B', B: 'T', L: 'R', R: 'L' } as const
    for (const bus of buses) {
      const members = bus.members.map(index => planAt.get(index)!), side = members[0]!.source.side
      const unavailable = () => new TerminalBoxRouteUnavailable(`No feasible terminal bus for ${bus.id}; move its cards apart`, bus.members[0]!)
      if (members.some(plan => plan.source.side !== side || plan.target.side !== opposite[side])) throw unavailable()
      // Depth grows from the sources toward the targets; along runs across it.
      const vertical = side === 'T' || side === 'B', sign = side === 'B' || side === 'R' ? 1 : -1
      const depth = (point: GridCoord) => sign * (vertical ? point.y : point.x), along = (point: GridCoord) => vertical ? point.x : point.y
      const at = (a: number, d: number): GridCoord => vertical ? { x: a, y: sign * d } : { x: sign * d, y: a }
      const sources = [...new Map(members.map(plan => [gridKey(plan.source), plan.source])).values()]
      const targets = [...new Map(members.map(plan => [gridKey(plan.target), plan.target])).values()]
      const own = new Set([...sources, ...targets].flatMap(point => approachCells(point)))
      const low = Math.max(...sources.map(point => depth(point) + BOX_ROUTE_APPROACH_DISTANCE))
      const high = Math.min(...targets.map(point => depth(point) - BOX_ROUTE_APPROACH_DISTANCE)) - 2
      const crossings = members.flatMap(plan => [along(plan.source), along(plan.target)]).sort((a, b) => a - b)
      const median = crossings[(crossings.length - 1) >> 1]!, first = crossings[0]!, last = crossings.at(-1)!
      // The junction keeps off every stem, so each run meets it as a tee that
      // cannot read as a crossing, and a cell away from them where it can.
      const stems = new Set(crossings), crowding = (a: number) => (stems.has(a) ? 2 : stems.has(a - 1) || stems.has(a + 1) ? 1 : 0)
      const junctions = Array.from({ length: last - first + 1 }, (_, offset) => first + offset).sort((a, b) => crowding(a) - crowding(b) || Math.abs(a - median) - Math.abs(b - median) || a - b).slice(0, 16)
      const free = (point: GridCoord): boolean => {
        const key = gridKey(point)
        return point.x >= 0 && point.y >= 0 && !cardCells.has(key) && !routeCells.has(key) && (!physicalMarker(key) || own.has(key)) && !textBounds.some(bounds => overlaps(bounds, { ...point, width: 1, height: 1 }))
      }
      const run = (points: GridCoord[], to: GridCoord) => {
        const from = points.at(-1)!, dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y)
        for (let x = from.x + dx, y = from.y + dy; x !== to.x + dx || y !== to.y + dy; x += dx, y += dy) points.push({ x, y })
      }
      const path = (source: BoxPort, target: BoxPort, collector: number, junction: number): GridCoord[] => {
        const points: GridCoord[] = [{ x: source.x, y: source.y }]
        for (const goal of [at(along(source), collector), at(junction, collector), at(junction, collector + 2), at(along(target), collector + 2), target]) run(points, goal)
        return points
      }
      let chosen: { collector: number; junction: number } | undefined, policyChecks = 0
      search: for (let collector = low; collector <= high; collector++) for (const junction of junctions) {
        // The union of member paths: every stem, both runs and the junction.
        const span = (values: number[]) => [Math.min(junction, ...values), Math.max(junction, ...values)] as const
        const cells: GridCoord[] = []
        for (const point of sources) { const stem = [{ x: point.x, y: point.y }]; run(stem, at(along(point), collector)); cells.push(...stem) }
        for (const point of targets) { const stem = [{ x: point.x, y: point.y }]; run(stem, at(along(point), collector + 2)); cells.push(...stem) }
        for (const [row, values] of [[collector, sources.map(along)], [collector + 2, targets.map(along)]] as const) {
          const [from, to] = span(values)
          for (let a = from; a <= to; a++) cells.push(at(a, row))
        }
        cells.push(at(junction, collector + 1))
        if (!cells.every(free)) continue
        if (policyChecks++ >= 4) break search
        for (const plan of members) {
          const policy = stepPolicy(plan.relation), points = path(plan.source, plan.target, collector, junction)
          if (policy && points.some((point, index) => index > 0 && !policy(points[index - 1]!.x, points[index - 1]!.y, point.x, point.y))) continue search
        }
        chosen = { collector, junction }
        break
      }
      if (!chosen) throw unavailable()
      for (const plan of members) {
        const points = path(plan.source, plan.target, chosen.collector, chosen.junction)
        record(points)
        retireReservations(plan.source, plan.target)
        routes[plan.index] = sealRoute({ relation: plan.relation, source: plan.source, target: plan.target, points })
        done.add(plan.index)
      }
    }
    return done
  }
  // Self-loops claim their nested corner slots, innermost first, before other
  // routes search: an outer shortest path could otherwise enclose and seal a
  // later exit. Relations listed in `first` (ones that failed an earlier
  // attempt) search next. Returned routes retain authored order.
  const rank = (index: number) => { const at = first.indexOf(index); return at < 0 ? first.length : at }
  // Each route of a fan runs across toward its opposite card on the row (or
  // column) nearest that card it can take (see `staircase`). It must take it
  // before any route whose fan port its run passes, so routes toward higher
  // coordinates take the fan in port order and routes toward lower ones in
  // reverse.
  const along = (point: BoxPort) => point.side === 'T' || point.side === 'B' ? point.x : point.y
  const fanEnd = (plan: (typeof plans)[number]): { port: BoxPort; other: BoxPort; key: string } | undefined => {
    if (plan.loop !== undefined) return undefined
    const source = `${plan.relation.from}\0${plan.source.side}`, target = `${plan.relation.to}\0${plan.target.side}`
    return fanFaces.has(source) ? { port: plan.source, other: plan.target, key: source }
      : fanFaces.has(target) ? { port: plan.target, other: plan.source, key: target }
      : undefined
  }
  const fanRank = new Map<(typeof plans)[number], number>()
  const fans = new Map<string, Array<{ plan: (typeof plans)[number]; at: number; rising: boolean }>>()
  for (const plan of plans) {
    const end = fanEnd(plan)
    if (!end) continue
    const list = fans.get(end.key) ?? []
    list.push({ plan, at: along(end.port), rising: along(end.other) > along(end.port) }); fans.set(end.key, list)
  }
  for (const list of fans.values()) for (const rising of [true, false]) list.filter(item => item.rising === rising).sort((a, b) => rising ? a.at - b.at : b.at - a.at).forEach((item, order) => fanRank.set(item.plan, order))
  plans.sort((a, b) => {
    const aLoop = a.loop !== undefined, bLoop = b.loop !== undefined
    return aLoop !== bLoop ? (aLoop ? -1 : 1) : rank(a.index) - rank(b.index) || (fanRank.get(a) ?? 0) - (fanRank.get(b) ?? 0) || a.index - b.index
  })
  const bussed = constructBuses()
  for (const plan of plans) {
    if (bussed.has(plan.index)) continue
    const { relation, source, target, index: relationIndex } = plan
    const fromLabel = text(relation.fromLines, [source]), toLabel = text(relation.toLines, [target])
    const loop = plan.loop === undefined ? undefined : constructLoop(plan)
    if (loop) {
      record(loop.points)
      retireReservations(source, target)
      for (const point of loop.points) loopCells.add(gridKey(point))
      routes[relationIndex] = sealRoute({ relation, source, target, points: loop.points, ...(loop.label ? { label: loop.label } : {}), ...(fromLabel ? { fromLabel } : {}), ...(toLabel ? { toLabel } : {}) })
      continue
    }
    const sourceExit = { x: source.x + delta[source.side].x * BOX_ROUTE_APPROACH_DISTANCE, y: source.y + delta[source.side].y * BOX_ROUTE_APPROACH_DISTANCE }
    const targetExit = { x: target.x + delta[target.side].x * BOX_ROUTE_APPROACH_DISTANCE, y: target.y + delta[target.side].y * BOX_ROUTE_APPROACH_DISTANCE }
    // Previously used routes are obstacles on the first attempt. The bounded
    // shared search may fall back to an ordinary crossing when necessary.
    const removed: Array<[string, true, boolean]> = []
    // The middle path starts outside each protected marker approach. Keeping
    // its inner cells occupied prevents a detour through an endpoint before
    // doubling back to its exit and losing that turn when the marker paints.
    for (const point of [sourceExit, targetExit]) {
      const key = gridKey(point), previous = occupied.get(key)
      if (previous && !cardCells.has(key)) { removed.push([key, previous, solid.delete(key)]); occupied.delete(key) }
    }
    const clearExit = (point: BoxPort): boolean => {
      const d = delta[point.side]
      return Array.from({ length: BOX_ROUTE_APPROACH_DISTANCE + 1 }, (_, step) => step).every(step => !cardCells.has(`${point.x + d.x * step},${point.y + d.y * step}`))
    }
    const exitsClear = sourceExit.x >= 0 && sourceExit.y >= 0 && targetExit.x >= 0 && targetExit.y >= 0 && clearExit(source) && clearExit(target)
    const policy = stepPolicy(relation)
    const clearAxis = () => {
      const straight = getClearAxisPath(occupied, sourceExit, targetExit)
      return straight && policy && straight.some((point, index) => index > 0 && !policy(straight[index - 1]!.x, straight[index - 1]!.y, point.x, point.y)) ? null : straight
    }
    // A route on a fan between opposite faces first tries the three-segment
    // path that crosses as close to the fan's opposite card as it can: along
    // its exit, across, and on to the other exit.
    const fan = fanEnd(plan)
    const staircase = (): GridCoord[] | null => {
      const vertical = source.side === 'B' && target.side === 'T' || source.side === 'T' && target.side === 'B'
      if (!fan || (!vertical && !(source.side === 'R' && target.side === 'L' || source.side === 'L' && target.side === 'R'))) return null
      const late = fan.port === source
      const near = vertical ? sourceExit.y : sourceExit.x, far = vertical ? targetExit.y : targetExit.x
      const [first, last] = late ? [far, near] : [near, far], step = Math.sign(last - first)
      if (!step) return null
      const free = (point: GridCoord) => point.x >= 0 && point.y >= 0 && (!occupied.has(gridKey(point)) || (point.x === targetExit.x && point.y === targetExit.y))
      for (let turn = first; turn !== last + step; turn += step) {
        const corner = vertical ? [{ x: sourceExit.x, y: turn }, { x: targetExit.x, y: turn }] : [{ x: turn, y: sourceExit.y }, { x: turn, y: targetExit.y }]
        const points: GridCoord[] = [sourceExit]
        const run = (goal: GridCoord) => {
          const previous = points.at(-1)!, dx = Math.sign(goal.x - previous.x), dy = Math.sign(goal.y - previous.y)
          for (let x = previous.x + dx, y = previous.y + dy; ; x += dx, y += dy) { points.push({ x, y }); if (x === goal.x && y === goal.y) break }
        }
        for (const goal of [...corner, targetExit]) if (goal.x !== points.at(-1)!.x || goal.y !== points.at(-1)!.y) run(goal)
        if (points.slice(1).every(free) && (!policy || points.every((point, index) => index === 0 || policy(points[index - 1]!.x, points[index - 1]!.y, point.x, point.y)))) return points
      }
      return null
    }
    const path = () => clearAxis() ?? staircase() ?? getPath(occupied, sourceExit, targetExit, preferred[source.side], policy, work)
    // A searched self-loop first keeps a blank cell from every loop label.
    const halo = plan.loop === undefined ? [] : loopLabels.flatMap(ring).map(gridKey).filter(key => !occupied.has(key))
    for (const key of halo) occupied.set(key, blocker)
    let middle = exitsClear ? path() : null
    for (const key of halo) occupied.delete(key)
    if (!middle && halo.length) middle = exitsClear ? path() : null
    if (!middle) {
      // Cross line ink only; endpoint markers and their approaches stay
      // protected even where an earlier route also owns those cells.
      // A crossing must enter and leave straight prior ink perpendicularly.
      // Removing occupancy alone admits shared runs and turns, which are not
      // crossings and cannot retain two independently connected route owners.
      const canCross = (fromX: number, fromY: number, toX: number, toY: number): boolean => {
        const axis = fromX === toX ? 2 : 1
        const fromAxis = routeAxes.get(fromX * 0x4000000 + fromY), toAxis = routeAxes.get(toX * 0x4000000 + toY)
        return (fromAxis === undefined || fromAxis === (axis === 1 ? 2 : 1))
          && (toAxis === undefined || toAxis === (axis === 1 ? 2 : 1))
      }
      middle = exitsClear ? getPath(solid, sourceExit, targetExit, preferred[source.side], policy ? (fromX, fromY, toX, toY) => canCross(fromX, fromY, toX, toY) && policy(fromX, fromY, toX, toY) : canCross, work) : null
    }
    if (!middle && work && work.pops >= work.limit) throw new TerminalWorkLimitError('route-search', work.limit)
    for (const [key, previous, wasSolid] of removed) { occupied.set(key, previous); if (wasSolid) solid.set(key, previous) }
    if (!middle) throw new TerminalBoxRouteUnavailable(`No feasible terminal route for ${relation.id}; move the related cards or reduce their label footprint`, relationIndex)
    const approach = (port: BoxPort) => Array.from({ length: BOX_ROUTE_APPROACH_DISTANCE }, (_, step) => step === 0 ? port : ({ x: port.x + delta[port.side].x * step, y: port.y + delta[port.side].y * step }))
    const points = [...approach(source), ...middle, ...approach(target).reverse()]
    record(points)
    retireReservations(source, target)
    if (plan.loop !== undefined) for (const point of points) loopCells.add(gridKey(point))
    const label = (plan.loop === undefined ? undefined : searchedLoopLabel(relation.lines, points)) ?? text(relation.lines, [points[Math.floor(points.length / 2)]!, source, target])
    routes[relationIndex] = sealRoute({ relation, source, target, points, ...(label ? { label } : {}), ...(fromLabel ? { fromLabel } : {}), ...(toLabel ? { toLabel } : {}) })
  }
  return routes
}

/**
 * Route a family layout, widening its corridors until every relation routes.
 * Greedy routing can fill a narrow corridor, or wall in a face whose ports have
 * not routed yet. After a failure `layout(channel)` re-places the family's
 * cards with `channel` extra cells in every gap it owns, its outer margin
 * included; the search may detour as far past the right and bottom extent; and
 * the relation that failed routes before the others. The first attempt keeps
 * the family's own spacing and order. All attempts share one search-work
 * ceiling, so a diagram too dense for terminal cells fails with a typed limit
 * instead of an unroutable edge. `accept` may refuse a complete attempt's
 * routes with TerminalBoxRouteUnavailable, which widens them as a failed
 * search does; `fanning` names the relations whose faces may form fans.
 */
export function allocateChannelledBoxRoutes(layout: (channel: number) => { boxes: readonly TerminalBox[]; obstacles?: readonly TerminalBox[] }, relations: readonly BoxRelation[], direction: DiagramDirection, options: { accept?: (routes: BoxRoute[]) => void; fanning?: (relation: BoxRelation) => boolean; buses?: readonly BoxBus[] } = {}): BoxRoute[] {
  const work: RouteSearchWork = { pops: 0, limit: TERMINAL_ROUTE_SEARCH_LIMIT }
  const first: number[] = []
  for (let channel = 0; ; channel = channel ? channel * 2 : 4) {
    const { boxes, obstacles } = layout(channel)
    work.margin = channel
    try {
      const routes = allocateBoxRoutes(boxes, relations, direction, obstacles, work, first, options.fanning, options.buses)
      options.accept?.(routes)
      return routes
    } catch (error) {
      if (!(error instanceof TerminalBoxRouteUnavailable)) throw error
      if (channel >= TERMINAL_ROUTE_CHANNEL_LIMIT) throw new TerminalWorkLimitError('route-channel', TERMINAL_ROUTE_CHANNEL_LIMIT)
      if (!first.includes(error.relationIndex)) first.push(error.relationIndex)
    }
  }
}

/** Paint each route's own ports; the compositor owns compatible intersections. */
export function paintBoxRoute(doc: TerminalDocument, route: BoxRoute, owner: TerminalOwner, ascii: boolean, dashed = false): void {
  if (!allocatedRoutes.has(route)) throw new TypeError('Terminal routes must come from box allocation')
  if (owner.kind !== 'edge' || owner.id !== route.relation.id || owner.from !== route.relation.from || owner.to !== route.relation.to) throw new TypeError('Terminal route identity must match its allocated endpoints')
  if (!paintTerminalRoute(doc, route.path, owner, ascii, dashed ? 'dashed' : 'solid')) throw new Error(`Allocated terminal route ${owner.id} conflicts with admitted geometry`)
}

/** Paint a bus's member routes together; each keeps its own identity. */
export function paintBoxBus(doc: TerminalDocument, routes: readonly BoxRoute[], owners: readonly TerminalOwner[], ascii: boolean, dashed = false): void {
  routes.forEach((route, index) => {
    const owner = owners[index]
    if (!allocatedRoutes.has(route)) throw new TypeError('Terminal routes must come from box allocation')
    if (owner?.kind !== 'edge' || owner.id !== route.relation.id || owner.from !== route.relation.from || owner.to !== route.relation.to) throw new TypeError('Terminal route identity must match its allocated endpoints')
  })
  if (!paintTerminalBus(doc, routes.map((route, index) => ({ route: route.path, owner: owners[index]! })), ascii, dashed ? 'dashed' : 'solid')) throw new Error(`Allocated terminal bus ${owners[0]?.bundle} conflicts with admitted geometry`)
}

export function paintBoxText(doc: TerminalDocument, text: BoxText | undefined, owner: TerminalOwner): void {
  owner = doc.element(owner)
  if (text) doc.textBlock(text.x, text.y, text.text, { owner, role: 'text', kind: 'text' })
}

/** Class and ER share card ink and compartment ownership after family layout. */
export function paintClassLikeCard(
  doc: TerminalDocument,
  box: TerminalBox & { sections: string[][] },
  owner: TerminalOwner,
  family: 'class' | 'er',
  ascii: boolean,
  classDefs: ReadonlyMap<string, Readonly<Record<string, string>>>,
  node: { className?: string; inlineStyle?: Readonly<Record<string, string>> },
  generated: (name: string) => string,
): void {
  doc.region(owner, { x: box.x, y: box.y, width: box.width, height: box.height })
  doc.fill(box.x, box.y, box.width, box.height, { owner, kind: 'surface' })
  const card = drawMultiBox(box.sections, ascii, 1, { width: box.width, height: box.height })
  if (classDefs.size || node.inlineStyle) {
    const style = Object.assign({}, classDefs.get('default'))
    for (const name of (node.className ?? '').split(/\s+/)) Object.assign(style, classDefs.get(name))
    Object.assign(style, node.inlineStyle)
    const paint = classLikePaint(doc, family, box.id, style)
    if (paint.text || paint.stroke) for (const [, , cell] of card.entries()) {
      const color = cell.kind === 'text' ? paint.text : paint.stroke
      if (color) cell.color = color
    }
  }
  let y = 1
  box.sections.forEach((section, index) => {
    const bounds = { x: 1, y, width: box.width - 2, height: Math.max(1, section.length) },
      compartment: TerminalOwner = { id: generated(`${box.id}:compartment:${index}`), kind: 'compartment', parent: { id: box.id, kind: 'node' } }
    card.attributeWithin(compartment, bounds)
    card.region(compartment, bounds)
    y += bounds.height + 1
  })
  doc.scope(owner, () => doc.overlay(card, box.x, box.y))
}

/** Report only authored style properties whose terminal realization is lossy. */
export function classLikePaint(doc: TerminalDocument, family: 'class' | 'er', id: string, style: Record<string, string>): { text?: string; stroke?: string } {
  const paint: { text?: string; stroke?: string } = {}
  for (const [property, value] of Object.entries(style)) {
    if (property === 'color' || property === 'stroke') {
      const parsed = tryParseCssColor(value)
      if (parsed) {
        paint[property === 'color' ? 'text' : 'stroke'] = toHex(parsed[0], parsed[1], parsed[2])
        if (parsed[3] < 1) doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `${family}.${id}.style.${property}.alpha`, message: `Authored ${family} ${property} alpha on ${id} projects to solid terminal ink.` })
        continue
      }
    }
    const realization = property === 'fill' ? 'an unfilled terminal card surface'
      : property === 'stroke-width' || property === 'stroke-dasharray' || property === 'stroke' ? 'one-cell terminal borders'
      : property === 'color' ? 'the resolved terminal text palette'
      : 'the terminal card, text and border vocabulary'
    doc.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `${family}.${id}.style.${property}`, message: `Authored ${family} style ${property}:${value} on ${id} projects to ${realization}.` })
  }
  return paint
}
