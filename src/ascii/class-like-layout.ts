import type { Direction as DiagramDirection } from '../types.ts'
import type { Direction, GridCoord } from './types.ts'
import { Up, Down, Left, Right, gridKey } from './types.ts'
import { getPath } from './pathfinder.ts'
import { OccupancyMap } from './occupancy.ts'
import { allocateFacePort, countFaceDemand, faceSize } from './terminal-geometry.ts'
import { tryParseCssColor, toHex } from '../shared/color-math.ts'
import { measuredText, type MeasuredTerminalText, type TerminalBounds, type TerminalDocument, type TerminalOwner } from './terminal-document.ts'

export type BoxSide = 'T' | 'B' | 'L' | 'R'
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
const allocatedRoute = Symbol('allocated terminal box route')
const allocatedRoutes = new WeakSet<object>()
export interface BoxRoute {
  readonly [allocatedRoute]: true
  readonly relation: Readonly<BoxRelation>
  readonly source: BoxPort
  readonly target: BoxPort
  readonly points: readonly Readonly<GridCoord>[]
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

function sealRoute(route: Omit<BoxRoute, typeof allocatedRoute>): BoxRoute {
  const { source, target, points } = route
  const same = (a: Readonly<GridCoord> | undefined, b: Readonly<GridCoord>) => a?.x === b.x && a.y === b.y
  const inward = (port: BoxPort) => ({ x: port.x - delta[port.side].x, y: port.y - delta[port.side].y })
  if (!same(points[0], source) || !same(points.at(-1), target) || same(points[1], inward(source)) || same(points.at(-2), inward(target))) throw new Error(`Terminal route ${route.relation.id} must join both allocated ports without entering their cards`)
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!, previous = points[index - 1]
    if (!Number.isSafeInteger(point.x) || point.x < 0 || !Number.isSafeInteger(point.y) || point.y < 0 || (previous && Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) !== 1)) throw new Error(`Terminal route ${route.relation.id} must be a complete contiguous cell path`)
  }
  const relation = Object.freeze({ ...route.relation, ...Object.fromEntries(['lines', 'fromLines', 'toLines'].flatMap(key => {
    const lines = route.relation[key as 'lines']
    return lines ? [[key, Object.freeze([...lines])]] : []
  })) })
  const allocated = Object.freeze({ ...route, [allocatedRoute]: true as const, relation, points: Object.freeze(points.map(point => Object.freeze({ ...point }))) })
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
    for (let step = 0; step <= 2; step++) markerCells.add(`${point.x + d.x * step},${point.y + d.y * step}`)
  }
  const text = (lines: readonly string[] | undefined, anchors: readonly GridCoord[]): BoxText | undefined => {
    if (!lines?.some(line => line.length > 0)) return undefined
    const measured = measuredText(lines), width = measured.width, height = measured.height
    const free = (bounds: TerminalBounds) => {
      const clearance = { x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2 }
      if (bounds.x < 0 || bounds.y < 0 || textObstacles.some(box => overlaps(clearance, box)) || textBounds.some(other => overlaps(clearance, other))) return false
      for (let y = bounds.y; y < bounds.y + height; y++) for (let x = bounds.x; x < bounds.x + width; x++) if (markerCells.has(`${x},${y}`) || routeCells.has(`${x},${y}`)) return false
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
    const sourceExit = { x: source.x + delta[source.side].x * 2, y: source.y + delta[source.side].y * 2 }
    const targetExit = { x: target.x + delta[target.side].x * 2, y: target.y + delta[target.side].y * 2 }
    // Previously used routes are obstacles on the first attempt. The bounded
    // shared search may fall back to an ordinary crossing when necessary.
    const removed: Array<[string, true]> = []
    for (const point of [source, target, sourceExit, targetExit, { x: source.x + delta[source.side].x, y: source.y + delta[source.side].y }, { x: target.x + delta[target.side].x, y: target.y + delta[target.side].y }]) {
      const key = gridKey(point), previous = occupied.get(key)
      if (previous && !cardCells.has(key)) { removed.push([key, previous]); occupied.delete(key) }
    }
    const clearExit = (point: BoxPort): boolean => {
      const d = delta[point.side]
      return [0, 1, 2].every(step => !cardCells.has(`${point.x + d.x * step},${point.y + d.y * step}`))
    }
    const exitsClear = sourceExit.x >= 0 && sourceExit.y >= 0 && targetExit.x >= 0 && targetExit.y >= 0 && clearExit(source) && clearExit(target)
    let middle = exitsClear ? getPath(occupied, sourceExit, targetExit, preferred[source.side]) : null
    if (!middle) {
      const removedRoutes: string[] = []
      for (const key of routeCells) if (occupied.has(key) && !cardCells.has(key)) { occupied.delete(key); removedRoutes.push(key) }
      middle = getPath(occupied, source, target, preferred[source.side])
      for (const key of removedRoutes) occupied.set(key, blocker)
    }
    for (const [key, previous] of removed) occupied.set(key, previous)
    if (!middle) throw new Error(`No feasible terminal route for ${relation.id}; move the related cards or reduce their label footprint`)
    const points = middle[0]?.x === sourceExit.x && middle[0]?.y === sourceExit.y
      ? [source, { x: source.x + delta[source.side].x, y: source.y + delta[source.side].y }, ...middle, { x: target.x + delta[target.side].x, y: target.y + delta[target.side].y }, target]
      : middle
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
  owner = doc.element(owner)
  doc.port(owner, { nodeId: route.relation.from, x: route.source.x, y: route.source.y, side: route.source.side, end: 'start' })
  doc.port(owner, { nodeId: route.relation.to, x: route.target.x, y: route.target.y, side: route.target.side, end: 'end' })
  const directions = new Map<string, number>()
  const ports: Record<BoxSide, number> = { T: 1, R: 2, B: 4, L: 8 }
  const add = (point: Readonly<GridCoord>, side: BoxSide) => { const key = gridKey(point); directions.set(key, (directions.get(key) ?? 0) | ports[side]) }
  for (let index = 1; index < route.points.length; index++) {
    const a = route.points[index - 1]!, b = route.points[index]!
    if (a.x === b.x && a.y === b.y) continue
    const side: BoxSide = b.x > a.x ? 'R' : b.x < a.x ? 'L' : b.y > a.y ? 'B' : 'T'
    const opposite: Record<BoxSide, BoxSide> = { R: 'L', L: 'R', T: 'B', B: 'T' }
    add(a, side); add(b, opposite[side])
  }
  const towardCard: Record<BoxSide, BoxSide> = { T: 'B', B: 'T', L: 'R', R: 'L' }
  add(route.source, towardCard[route.source.side]); add(route.target, towardCard[route.target.side])
  for (const [key, mask] of directions) {
    const comma = key.indexOf(','), x = Number(key.slice(0, comma)), y = Number(key.slice(comma + 1))
    const horizontal = (mask & 10) > 0, vertical = (mask & 5) > 0
    doc.stroke(x, y, mask, { owner, role: horizontal && vertical ? 'corner' : 'line', ascii, style: dashed ? 'dashed' : 'solid' })
  }
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
