import {materializeClassConstruction,type ClassConstruction} from './class-constructive-layout.ts'
import type { Direction as DiagramDirection } from '../types.ts'
import type { Direction, GridCoord } from './types.ts'
import { Up, Down, Left, Right, gridKey } from './types.ts'
import { getClearAxisPath, getPath, type RouteSearchWork } from './pathfinder.ts'
import { OccupancyMap } from './occupancy.ts'
import { allocateFacePort, countFaceDemand, faceSize } from './terminal-geometry.ts'
import { tryParseCssColor, toHex } from '../shared/color-math.ts'
import { measuredText, type MeasuredTerminalText, type TerminalBounds, type TerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { allocateTerminalRoute, paintTerminalRoute, type TerminalRoute } from './terminal-route.ts'
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

/** Face capacity belongs to allocation, before any node or connector is painted. */
export function boxFaceSizes(relations: readonly BoxRelation[], direction: DiagramDirection, boxes?: readonly TerminalBox[]): Map<string, { width: number; height: number }> {
  const counts = faceCounts(relations, direction, boxes ? new Map(boxes.map(box => [box.id, box])) : undefined)
  return new Map([...counts].map(([id, count]) => [id, faceSize(count)]))
}

function faceCounts(relations: readonly BoxRelation[], direction: DiagramDirection, boxes?: ReadonlyMap<string, TerminalBox>): Map<string, Record<BoxSide, number>> {
  return countFaceDemand(relations.flatMap(relation => {
    const [from, to] = sides(relation, direction, boxes)
    return [{ id: relation.from, side: from }, { id: relation.to, side: to }]
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
export function allocateBoxRoutes(boxes: readonly TerminalBox[], relations: readonly BoxRelation[], direction: DiagramDirection, additionalObstacles: readonly TerminalBox[] = [], work?: RouteSearchWork, first: readonly number[] = []): BoxRoute[] {
  const byId = new Map(boxes.map(box => [box.id, box]))
  const counts = faceCounts(relations, direction, byId), cursors = new Map<string, number>()
  // Self-relationships leave the right face and return through the bottom
  // face, one nested slot each: the n-th loop of a card (n = 0 innermost)
  // takes the n-th port from that corner on both faces, so the loops nest
  // without crossing. Every other endpoint keeps its encounter order.
  const selfRank = new Map<BoxRelation, number>(), selfCount = new Map<string, number>()
  for (const relation of relations) {
    if (relation.from !== relation.to) continue
    const rank = selfCount.get(relation.from) ?? 0
    selfRank.set(relation, rank); selfCount.set(relation.from, rank + 1)
  }
  const port = (id: string, side: BoxSide, loop?: number): BoxPort => {
    const box = byId.get(id)!, count = counts.get(id)![side]
    if (loop !== undefined) return allocateFacePort(box, side, count - 1 - loop, count)
    const key = `${id}\0${side}`, index = cursors.get(key) ?? 0
    cursors.set(key, index + 1)
    return allocateFacePort(box, side, index, count)
  }
  const plans = relations.map((relation, index) => {
    if (!byId.has(relation.from) || !byId.has(relation.to)) throw new Error(`Terminal route ${relation.id} has no allocated endpoint box`)
    const [from, to] = sides(relation, direction, byId)
    const loop = selfRank.get(relation)
    return { relation, index, source: port(relation.from, from, loop), target: port(relation.to, to, loop), ...(loop === undefined ? {} : { loop }) }
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
  // Self-loops claim their nested corner slots, innermost first, before other
  // routes search: an outer shortest path could otherwise enclose and seal a
  // later exit. Relations listed in `first` (ones that failed an earlier
  // attempt) search next. Returned routes retain authored order.
  const rank = (index: number) => { const at = first.indexOf(index); return at < 0 ? first.length : at }
  plans.sort((a, b) => {
    const aLoop = a.loop !== undefined, bLoop = b.loop !== undefined
    return aLoop !== bLoop ? (aLoop ? -1 : 1) : rank(a.index) - rank(b.index) || a.index - b.index
  })
  for (const plan of plans) {
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
    const clearAxis = () => {
      const straight = getClearAxisPath(occupied, sourceExit, targetExit)
      return straight && acrossBands && straight.some((point, index) => index > 0 && !acrossBands(straight[index - 1]!.x, straight[index - 1]!.y, point.x, point.y)) ? null : straight
    }
    const path = () => clearAxis() ?? getPath(occupied, sourceExit, targetExit, preferred[source.side], acrossBands, work)
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
      middle = exitsClear ? getPath(solid, sourceExit, targetExit, preferred[source.side], acrossBands ? (fromX, fromY, toX, toY) => canCross(fromX, fromY, toX, toY) && acrossBands(fromX, fromY, toX, toY) : canCross, work) : null
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
 * instead of an unroutable edge.
 */
export function allocateChannelledBoxRoutes(layout: (channel: number) => { boxes: readonly TerminalBox[]; obstacles?: readonly TerminalBox[] }, relations: readonly BoxRelation[], direction: DiagramDirection): BoxRoute[] {
  const work: RouteSearchWork = { pops: 0, limit: TERMINAL_ROUTE_SEARCH_LIMIT }
  const first: number[] = []
  for (let channel = 0; ; channel = channel ? channel * 2 : 4) {
    const { boxes, obstacles } = layout(channel)
    work.margin = channel
    try {
      return allocateBoxRoutes(boxes, relations, direction, obstacles, work, first)
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

/** Only the admitted construction may bypass heuristic search; final routes use the canonical seal/WeakSet allocator. */
export function allocateConstructiveClassRoutes(plan:ClassConstruction):BoxRoute[]{return materializeClassConstruction(plan,sealRoute)}
