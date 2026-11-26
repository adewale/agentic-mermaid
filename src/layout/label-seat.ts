// The one seat rule for a graph edge caption. A caption sits on its own
// route, on or within the on-route allowance beside one of its runs. Its
// producer admits the seats whose paint is safe (clear of nodes, group
// headers, markers and shared trunks). Among them the best has the least
// cost: first the fewest text conflicts (over another caption or a node),
// then the fewest foreign shafts under the pill. Ties keep the producer's
// own preference order, so a clear first choice is kept as it is. A caller
// leaving a shared trunk ranks a seat on its own run before one beside it.

import type { Point, PositionedEdge, PositionedNode } from '../types.ts'
import { labelRect } from '../shared/edge-label-geometry.ts'
import { measureLabelConflicts } from './label-conflicts.ts'
import type { LabelMetricsStyle } from './route-geometry.ts'

const SEAT_STEP = 8
/** Work bound: a caption searches at most this many dense seats per offset. */
const MAX_SEATS = 256
/** Keep the pill off both terminals, where markers and port stubs sit. */
const END_CLEARANCE = 16

/** Every seat on the route's orthogonal runs, one step apart, clear of both
 * terminals, displaced across its run by `offset`. Unlike a caller's centred
 * samples, a pill may overhang a bend. */
export function routeSeats(points: readonly Point[], offset = 0): Point[] {
  const seats: Point[] = []
  const total = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0)
  let walked = 0
  for (let index = 1; index < points.length && seats.length < MAX_SEATS; index++) {
    const a = points[index - 1]!, b = points[index]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const vertical = Math.abs(a.x - b.x) < 0.5
    if (length > 0 && (vertical || Math.abs(a.y - b.y) < 0.5)) {
      for (let at = 0; at <= length && seats.length < MAX_SEATS; at += SEAT_STEP) {
        const along = walked + at
        if (along < END_CLEARANCE || total - along < END_CLEARANCE) continue
        seats.push({ x: a.x + (b.x - a.x) * at / length + (vertical ? offset : 0), y: a.y + (b.y - a.y) * at / length + (vertical ? 0 : offset) })
      }
    }
    walked += length
  }
  return seats
}

/** A seat this close to a run sits on it. */
const ON_ROUTE = 0.5

const cheaper = (a: readonly number[], b: readonly number[]): boolean => {
  const index = a.findIndex((term, i) => term !== b[i])
  return index >= 0 && a[index]! < b[index]!
}

/**
 * Seat `edge`'s caption by the one rule: the first admitted seat, in the
 * caller's order, of least cost. Returns that seat with the caption left
 * there, or undefined with the caption restored when no seat is admitted.
 * `ownRunFirst` ranks seats on a run before seats beside one, after text
 * conflicts and before shafts.
 */
export function seatLabel(
  edge: PositionedEdge,
  graph: { nodes: readonly PositionedNode[]; edges: readonly PositionedEdge[] },
  style: LabelMetricsStyle,
  candidates: Iterable<Point>,
  admit: (point: Point) => boolean,
  ownRunFirst = false,
): Point | undefined {
  const original = edge.labelPosition
  const involved = new Set([graph.edges.indexOf(edge)])
  const positioned = graph as { nodes: PositionedNode[]; edges: PositionedEdge[] }
  let best: { seat: Point; cost: number[] } | undefined
  for (const seat of candidates) {
    if (!admit(seat)) continue
    edge.labelPosition = seat
    const counts = measureLabelConflicts(positioned, style, involved)
    const cost = [counts.labelLabel + counts.labelNode, ownRunFirst && routeDistance(seat, edge.points) > ON_ROUTE ? 1 : 0, counts.labelEdge]
    if (!best || cheaper(cost, best.cost)) best = { seat, cost }
    if (best.cost.every(term => term === 0)) break
  }
  edge.labelPosition = best?.seat ?? original
  return best?.seat
}

/** Whether the caption's pill covers another caption, a node or a foreign shaft. */
export function labelInConflict(edge: PositionedEdge, graph: { nodes: readonly PositionedNode[]; edges: readonly PositionedEdge[] }, style: LabelMetricsStyle): boolean {
  return measureLabelConflicts(graph as { nodes: PositionedNode[]; edges: PositionedEdge[] }, style, new Set([graph.edges.indexOf(edge)])).total > 0
}

function routeDistance(point: Point, points: readonly Point[]): number {
  let distance = Infinity
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!, b = points[index]!
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    distance = Math.min(distance, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)))
  }
  return distance
}

/**
 * ELK reserves each caption's room beside the route it draws. Where the
 * produced route differs (a cross-hierarchy or margin route joined or rebuilt
 * after ELK), a caption left beyond the on-route allowance (half its pill
 * plus four pixels, the rubric's labelOffRoute bound) is seated on its own
 * route by the one rule, nearest the room ELK reserved. Self-loop captions
 * sit beside their stub by design.
 */
export function seatLabelsOnOwnRoutes(graph: { nodes: readonly PositionedNode[]; edges: readonly PositionedEdge[] }, style: LabelMetricsStyle): void {
  for (const edge of graph.edges) {
    const reserved = edge.labelPosition, rect = labelRect(edge, style)
    if (!reserved || !rect || edge.source === edge.target || edge.points.length < 2) continue
    const allow = rect.h / 2 + 4
    if (routeDistance(reserved, edge.points) <= allow) continue
    // On the route first; a run whose every on-route seat is crowded may
    // still seat the pill just inside the allowance, on either side.
    const nearest = (seats: Point[]) => seats.map((seat, index) => ({ seat, index, distance: Math.hypot(seat.x - reserved.x, seat.y - reserved.y) }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index).map(entry => entry.seat)
    const seats = [...nearest(routeSeats(edge.points)), ...nearest([...routeSeats(edge.points, allow - 1), ...routeSeats(edge.points, 1 - allow)])]
    seatLabel(edge, graph, style, seats, () => true)
  }
}
