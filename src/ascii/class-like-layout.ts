import {materializeClassConstruction,type ClassConstruction} from './class-constructive-layout.ts'
import type { Direction as DiagramDirection } from '../types.ts'
import type { Direction, GridCoord } from './types.ts'
import { Up, Down, Left, Right, gridKey } from './types.ts'
import { getClearAxisPath, getPath } from './pathfinder.ts'
import { OccupancyMap } from './occupancy.ts'
import { allocateFacePort, countFaceDemand, faceSize } from './terminal-geometry.ts'
import { tryParseCssColor, toHex } from '../shared/color-math.ts'
import { measuredText, type MeasuredTerminalText, type TerminalBounds, type TerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { allocateTerminalRoute, paintTerminalRoute, type TerminalRoute } from './terminal-route.ts'

export type BoxSide = 'T' | 'B' | 'L' | 'R'
/** Distance from the exterior port to the first freely routed cell. The
 * protected approach includes both ends, so it occupies distance + 1 cells. */
export const BOX_ROUTE_APPROACH_DISTANCE = 2
export interface TerminalBox extends TerminalBounds { id: string; container?: boolean; headerHeight?: number }
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
export class TerminalBoxRouteUnavailable extends Error {}
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
export function allocateBoxRoutes(boxes: readonly TerminalBox[], relations: readonly BoxRelation[], direction: DiagramDirection, additionalObstacles: readonly TerminalBox[] = []): BoxRoute[] {
  const byId = new Map(boxes.map(box => [box.id, box]))
  const counts = faceCounts(relations, direction, byId), cursors = new Map<string, number>()
  const port = (id: string, side: BoxSide): BoxPort => {
    const box = byId.get(id)!, key = `${id}\0${side}`, index = cursors.get(key) ?? 0
    cursors.set(key, index + 1)
    const count = counts.get(id)![side]
    return allocateFacePort(box, side, index, count)
  }
  const plans = relations.map(relation => {
    if (!byId.has(relation.from) || !byId.has(relation.to)) throw new Error(`Terminal route ${relation.id} has no allocated endpoint box`)
    const [from, to] = sides(relation, direction, byId)
    return { relation, source: port(relation.from, from), target: port(relation.to, to) }
  })
  // The map is a search adapter over cell rectangles; its payload is unused by
  // getPath. No family-specific node store or dense output canvas is copied.
  const blocker = true
  const occupied = new OccupancyMap(), cardCells = new Set<string>(), routeCells = new Set<string>()
  const markerCells = new Set<string>()
  const textBounds: TerminalBounds[] = []
  const occupy = (bounds: TerminalBounds) => {
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) occupied.set(`${x},${y}`, blocker)
  }
  const geometry = [...boxes, ...additionalObstacles]
  const obstacles = geometry.flatMap(box => box.container ? [{ x: box.x, y: box.y, width: box.width, height: box.headerHeight ?? 1 }] : [box])
  const textObstacles = geometry.flatMap(box => box.container ? [
    { x: box.x, y: box.y, width: box.width, height: box.headerHeight ?? 1 },
    { x: box.x, y: box.y, width: 1, height: box.height },
    { x: box.x + box.width - 1, y: box.y, width: 1, height: box.height },
    { x: box.x, y: box.y + box.height - 1, width: box.width, height: 1 },
  ] : [box])
  obstacles.forEach(occupy)
  for (const key of occupied.keys()) cardCells.add(key)
  for (const plan of plans) for (const point of [plan.source, plan.target]) {
    const d = delta[point.side]
    for (let step = 0; step <= BOX_ROUTE_APPROACH_DISTANCE; step++) markerCells.add(`${point.x + d.x * step},${point.y + d.y * step}`)
  }
  const text = (lines: readonly string[] | undefined, anchors: readonly GridCoord[]): BoxText | undefined => {
    if (!lines?.some(line => line.length > 0)) return undefined
    const measured = measuredText(lines), width = measured.width, height = measured.height
    const free = (bounds: TerminalBounds) => {
      const clearance = { x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2 }
      if (bounds.x < 0 || bounds.y < 0 || textObstacles.some(box => overlaps(clearance, box)) || textBounds.some(other => overlaps(clearance, other))) return false
      // A label beside an exit can seal it between neighboring face ports.
      // Keep the same one-cell clearance around complete marker approaches.
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
  for (const key of markerCells) occupied.set(key, blocker)
  const routes: BoxRoute[] = []
  for (const plan of plans) {
    const { relation, source, target } = plan
    const fromLabel = text(relation.fromLines, [source]), toLabel = text(relation.toLines, [target])
    const sourceExit = { x: source.x + delta[source.side].x * BOX_ROUTE_APPROACH_DISTANCE, y: source.y + delta[source.side].y * BOX_ROUTE_APPROACH_DISTANCE }
    const targetExit = { x: target.x + delta[target.side].x * BOX_ROUTE_APPROACH_DISTANCE, y: target.y + delta[target.side].y * BOX_ROUTE_APPROACH_DISTANCE }
    // Previously used routes are obstacles on the first attempt. The bounded
    // shared search may fall back to an ordinary crossing when necessary.
    const removed: Array<[string, true]> = []
    // The middle path starts outside each protected marker approach. Keeping
    // its inner cells occupied prevents a detour through an endpoint before
    // doubling back to its exit and losing that turn when the marker paints.
    for (const point of [sourceExit, targetExit]) {
      const key = gridKey(point), previous = occupied.get(key)
      if (previous && !cardCells.has(key)) { removed.push([key, previous]); occupied.delete(key) }
    }
    const clearExit = (point: BoxPort): boolean => {
      const d = delta[point.side]
      return Array.from({ length: BOX_ROUTE_APPROACH_DISTANCE + 1 }, (_, step) => step).every(step => !cardCells.has(`${point.x + d.x * step},${point.y + d.y * step}`))
    }
    const exitsClear = sourceExit.x >= 0 && sourceExit.y >= 0 && targetExit.x >= 0 && targetExit.y >= 0 && clearExit(source) && clearExit(target)
    const path = () => getClearAxisPath(occupied, sourceExit, targetExit)
      ?? getPath(occupied, sourceExit, targetExit, preferred[source.side])
    let middle = exitsClear ? path() : null
    if (!middle) {
      const removedRoutes: string[] = []
      // Cross line ink only; endpoint markers and their approaches stay
      // protected even where an earlier route also owns those cells.
      for (const key of routeCells) if (occupied.has(key) && !cardCells.has(key) && !markerCells.has(key)) { occupied.delete(key); removedRoutes.push(key) }
      middle = exitsClear ? path() : null
      for (const key of removedRoutes) occupied.set(key, blocker)
    }
    for (const [key, previous] of removed) occupied.set(key, previous)
    if (!middle) throw new TerminalBoxRouteUnavailable(`No feasible terminal route for ${relation.id}; move the related cards or reduce their label footprint`)
    const approach = (port: BoxPort) => Array.from({ length: BOX_ROUTE_APPROACH_DISTANCE }, (_, step) => step === 0 ? port : ({ x: port.x + delta[port.side].x * step, y: port.y + delta[port.side].y * step }))
    const points = [...approach(source), ...middle, ...approach(target).reverse()]
    for (const point of points) { const key = gridKey(point); routeCells.add(key); occupied.set(key, blocker) }
    const label = text(relation.lines, [points[Math.floor(points.length / 2)]!, source, target])
    routes.push(sealRoute({ ...plan, points, ...(label ? { label } : {}), ...(fromLabel ? { fromLabel } : {}), ...(toLabel ? { toLabel } : {}) }))
  }
  return routes
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
