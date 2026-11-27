// Route geometry is a value. A pass that moves a route or its caption publishes
// a new points array of new point objects (and a new label position) instead
// of editing the old ones, so object identity can stand for content: a cache
// keyed by a points array, or a candidate copied before a proposal, can never
// observe a later edit. Under unit-test assertions the pipeline freezes routes
// after every pass, so an in-place edit fails at its source. Routes stay
// values after the pipeline: the finished graph is immutable
// (positioned-values.ts).

import type { Point, PositionedEdge } from '../types.ts'
import { LABEL_PILL_PADDING } from '../shared/edge-label-geometry.ts'

type Axis = 'x' | 'y'

/** How far a caption's centre may sit from its own route: half its pill plus
 * four pixels, the rubric's labelOffRoute bound. */
export function captionOnRouteAllowance(block: { height: number }): number {
  return block.height / 2 + LABEL_PILL_PADDING + 4
}

/** A lane tolerance for a caption with no retained text block. The graph
 * pipeline retains every block at extraction, before any run moves. */
const UNMEASURED_RIDE = 12
/** A caption this close to a run sits on it. */
const ON_RUN = 0.5

/** A caption rides a run when its centre lies on the run, or within its
 * on-route allowance beside it and nearer it than any other segment of its
 * route, and inside the run's extent along it. A caption seated beside the
 * run (ELK's offset, or an offset seat of the one seat rule) rides it as much
 * as one seated on it, so every pass that moves a run across moves such a
 * caption with it; one seated on the segment the move stretches stays on
 * that segment. The run is `route[first..last]`, collinear on `cross`. */
export function captionRidesRun(edge: PositionedEdge, route: readonly Point[], first: number, last: number, cross: Axis): boolean {
  const label = edge.labelPosition
  if (!label) return false
  const main: Axis = cross === 'x' ? 'y' : 'x'
  let lo = Infinity, hi = -Infinity
  for (let i = first; i <= last; i++) { lo = Math.min(lo, route[i]![main]); hi = Math.max(hi, route[i]![main]) }
  if (label[main] < lo - ON_RUN || label[main] > hi + ON_RUN) return false
  const across = Math.abs(label[cross] - route[first]![cross])
  if (across <= ON_RUN) return true
  if (across > (edge.labelBlock ? captionOnRouteAllowance(edge.labelBlock) : UNMEASURED_RIDE)) return false
  for (let i = 1; i < route.length; i++) {
    if ((i <= first || i > last) && segmentDistance(label, route[i - 1]!, route[i]!) <= across) return false
  }
  return true
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Translate a whole route and its caption. */
export function translateRoute(edge: PositionedEdge, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return
  edge.points = edge.points.map(point => ({ ...point, x: point.x + dx, y: point.y + dy }))
  if (edge.labelPosition) edge.labelPosition = { ...edge.labelPosition, x: edge.labelPosition.x + dx, y: edge.labelPosition.y + dy }
}

/** Translate a whole route and its caption along one axis. */
export function shiftRoute(edge: PositionedEdge, axis: Axis, delta: number): void {
  translateRoute(edge, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0)
}

/** Move only the caption along one axis. */
export function shiftLabel(edge: PositionedEdge, axis: Axis, delta: number): void {
  if (edge.labelPosition) edge.labelPosition = { ...edge.labelPosition, [axis]: edge.labelPosition[axis] + delta }
}

/** Seat the caption at `value` on one axis. */
export function setLabelAxis(edge: PositionedEdge, axis: Axis, value: number): void {
  if (edge.labelPosition) edge.labelPosition = { ...edge.labelPosition, [axis]: value }
}

/** Replace the endpoint at `index` with a copy of `point`. */
export function replaceRoutePoint(edge: PositionedEdge, index: number, point: Point): void {
  edge.points = edge.points.map((old, at) => (at === index ? { ...point } : old))
}

/**
 * Translate a terminal run across the flow: the collinear points at the start
 * (or end) of the route move by `delta` on `cross`, stretching the segment that
 * leaves the run. A caption riding that run (captionRidesRun) follows it.
 * `anchorFar` keeps the far endpoint in place.
 */
export function shiftTerminalRun(edge: PositionedEdge, fromEnd: boolean, cross: Axis, delta: number, anchorFar = false): void {
  const points = edge.points
  if (points.length === 0) return
  const start = fromEnd ? points.length - 1 : 0, step = fromEnd ? -1 : 1, far = fromEnd ? 0 : points.length - 1
  const ref = points[start]![cross]
  const moved = new Set<number>()
  let inner = start
  for (let i = start; i >= 0 && i < points.length; i += step) {
    if (Math.abs(points[i]![cross] - ref) > 0.5) break
    if (anchorFar && i === far) break
    moved.add(i)
    inner = i
  }
  const rides = captionRidesRun(edge, points, Math.min(start, inner), Math.max(start, inner), cross)
  edge.points = points.map((point, i) => (moved.has(i) ? { ...point, [cross]: point[cross] + delta } : point))
  if (rides) shiftLabel(edge, cross, delta)
}

/** Freeze every route and caption so an in-place edit throws (assertions only). */
export function freezeRoutes(edges: readonly PositionedEdge[] | undefined): void {
  for (const edge of edges ?? []) {
    if (!Object.isFrozen(edge.points)) {
      for (const point of edge.points) Object.freeze(point)
      Object.freeze(edge.points)
    }
    if (edge.labelPosition) Object.freeze(edge.labelPosition)
  }
}
