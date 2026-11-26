// The one seat rule for a graph edge caption. A caption sits on its own
// route, on or within the on-route allowance beside one of its runs. Its
// producer admits the seats whose paint is safe (clear of nodes, group
// headers, markers and shared trunks). Among them the best has the least
// cost: first the fewest text conflicts (over another caption or a node),
// then the fewest foreign shafts under the pill. Ties keep the producer's
// own preference order, so a clear first choice is kept as it is. A caller
// leaving a shared trunk ranks a seat on its own run before one beside it.

import type { Point, PositionedEdge, PositionedGroup, PositionedNode } from '../types.ts'
import { LABEL_PILL_PADDING, labelEndpointClearance, labelHaloExtension, labelRect, pillRect } from '../shared/edge-label-geometry.ts'
import { customTextMeasurementActive } from '../text-measurement-profile.ts'
import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
import { graphEdgeTextBlock } from '../graph-text.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { measureLabelConflicts } from './label-conflicts.ts'
import { calculatePathMidpoint } from './geometry.ts'
import type { LabelMetricsStyle } from './route-geometry.ts'
import { sharedTrunkConflict } from './route-lanes.ts'

export type LabelPaintRect = { x: number; y: number; w: number; h: number }

/** Match renderEdgeLabel's opaque halo, including thick-edge paint. */
export function labelHaloPadding(edge: PositionedEdge, style: LabelMetricsStyle): number {
  return labelHaloExtension(edge, style.lineWidth ?? 1)
}

/** Owned label-only passes leave routes fixed. Reentrant host measurement
 * can replace peer geometry, so only the owned path reuses marker footprints. */
export function labelPaintClearance(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] }, style: LabelMetricsStyle, work?: () => void) {
  work?.()
  let markers: ReturnType<typeof graphEdgeMarkerPaintRegions> | undefined
  const overlapsHeader = (pill: LabelPaintRect, groups: readonly PositionedGroup[]): boolean => groups.some(group => {
    work?.()
    // Production retains the measured strip. An unmeasured group cannot
    // establish a clear interior slot; keep its full extent conservative.
    const height = group.concurrencyRegion ? 0 : group.headerHeight ?? group.height
    return height > 0 && pill.x < group.x + group.width && pill.x + pill.w > group.x
      && pill.y < group.y + height && pill.y + pill.h > group.y || overlapsHeader(pill, group.children)
  })
  const overlapsMarker = (pill: LabelPaintRect): boolean => {
    const current = customTextMeasurementActive()
      ? positioned.edges.flatMap(edge => { work?.(); return graphEdgeMarkerPaintRegions(edge, style) })
      : markers ??= positioned.edges.flatMap(edge => { work?.(); return graphEdgeMarkerPaintRegions(edge, style) })
    for (const marker of current) {
      work?.()
      const box = marker.bounds
      if (box && pill.x < box.x1 && pill.x + pill.w > box.x0 && pill.y < box.y1 && pill.y + pill.h > box.y0) return true
    }
    return false
  }
  const clearPaintRect = (inner: LabelPaintRect, halo: number, edge: PositionedEdge): LabelPaintRect | undefined => {
    work?.()
    const pill = { x: inner.x - halo, y: inner.y - halo, w: inner.w + 2 * halo, h: inner.h + 2 * halo }
    // Own endpoint cards are obstacles too: a repair must not exchange a
    // route-label ambiguity for hidden authored text or terminal symbols.
    // Beside them the halo also leaves that end's marker and some line.
    const lineWidth = style.lineWidth ?? 1
    const sourceGap = labelEndpointClearance(edge, lineWidth, 'start') - halo, targetGap = labelEndpointClearance(edge, lineWidth, 'end') - halo
    if (positioned.nodes.some(node => {
      work?.()
      const gap = Math.max(0, node.id === edge.source ? sourceGap : 0, node.id === edge.target ? targetGap : 0)
      return pill.x < node.x + node.width + gap && pill.x + pill.w + gap > node.x && pill.y < node.y + node.height + gap && pill.y + pill.h + gap > node.y
    }) || overlapsHeader(pill, positioned.groups) || overlapsMarker(pill)) return undefined
    return pill
  }
  return { overlapsMarker, clearPaintRect }
}

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
 * The one rule's choice, for any caption geometry: the first admitted seat, in
 * the caller's order, of least cost, compared term by term; a seat of zero
 * cost ends the search. Graph captions measure their pills (seatLabel); C4
 * measures its own painted halo (c4/pixel-labels.ts).
 */
export function leastCostSeat(candidates: Iterable<Point>, admit: (point: Point) => boolean, cost: (point: Point) => readonly number[]): Point | undefined {
  let best: { seat: Point; cost: readonly number[] } | undefined
  for (const seat of candidates) {
    if (!admit(seat)) continue
    const terms = cost(seat)
    if (!best || cheaper(terms, best.cost)) best = { seat, cost: terms }
    if (best.cost.every(term => term === 0)) break
  }
  return best?.seat
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
  const best = leastCostSeat(candidates, admit, seat => {
    edge.labelPosition = seat
    const counts = measureLabelConflicts(positioned, style, involved)
    return [counts.labelLabel + counts.labelNode, ownRunFirst && routeDistance(seat, edge.points) > ON_ROUTE ? 1 : 0, counts.labelEdge]
  })
  edge.labelPosition = best ?? original
  return best
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

export type SeatGraph = { nodes: readonly PositionedNode[]; edges: readonly PositionedEdge[]; groups?: readonly PositionedGroup[] }

/**
 * A producer that writes a route seats its caption on that route by the one
 * rule, nearest `preferred` (by default the route's midpoint, which is kept
 * when it is clear): first on its runs, then just inside the on-route
 * allowance beside them (half the pill plus four pixels, the rubric's
 * labelOffRoute bound), never on a run another edge shares. A caption with
 * no such seat keeps its route's midpoint, for the settler's shared-trunk
 * repair to give it a private channel.
 */
export function seatCaption(edge: PositionedEdge, graph: SeatGraph, style: LabelMetricsStyle, preferred?: Point): void {
  if (!edge.label || edge.points.length < 2) return
  const midpoint = calculatePathMidpoint(edge.points), target = preferred ?? midpoint
  edge.labelPosition = midpoint
  const block = edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label, edge.labelContent), style)
  const allow = block.height / 2 + LABEL_PILL_PADDING + 4
  const nearest = (seats: Point[]) => seats.map((seat, index) => ({ seat, index, distance: Math.hypot(seat.x - target.x, seat.y - target.y) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index).map(entry => entry.seat)
  const seats = [...(routeDistance(target, edge.points) <= ON_ROUTE ? [target] : []), ...nearest(routeSeats(edge.points)), ...nearest([...routeSeats(edge.points, allow - 1), ...routeSeats(edge.points, 1 - allow)])]
  const edges = graph.edges as PositionedEdge[]
  const offTrunk = (seat: Point): boolean => !sharedTrunkConflict(edge, edges, style, seat)
  // Paint-safe seats first (halo clear of cards, headers and markers); where
  // none is, any seat off a shared trunk.
  const paint = labelPaintClearance({ nodes: graph.nodes as PositionedNode[], edges, groups: (graph.groups ?? []) as PositionedGroup[] }, style), halo = labelHaloPadding(edge, style)
  if (seatLabel(edge, graph, style, seats, seat => offTrunk(seat) && !!paint.clearPaintRect(pillRect(seat.x, seat.y, block), halo, edge))) return
  seatLabel(edge, graph, style, seats, offTrunk)
}

/**
 * ELK reserves each caption's room beside the route it draws. Where the
 * produced route differs (a cross-hierarchy or margin route joined or rebuilt
 * after ELK), or ELK reserved none, the caption is seated on its own route
 * by the one rule, nearest any room ELK reserved. A self-loop caption ELK
 * reserved sits beside its stub by design; one without that room (labels
 * kept out of ELK, or a stub rebuilt here) is seated on its stub, so every
 * caption leaves extraction with a seat, whether or not the self-loop
 * router later rebuilds the loop.
 */
export function seatLabelsOnOwnRoutes(graph: SeatGraph, style: LabelMetricsStyle): void {
  for (const edge of graph.edges) {
    if (!edge.label || edge.points.length < 2) continue
    if (edge.source === edge.target) {
      if (!edge.labelPosition) seatCaption(edge, graph, style)
      continue
    }
    const reserved = edge.labelPosition, rect = reserved && labelRect(edge, style)
    if (reserved && rect && routeDistance(reserved, edge.points) <= rect.h / 2 + 4) continue
    seatCaption(edge, graph, style, reserved)
  }
}
