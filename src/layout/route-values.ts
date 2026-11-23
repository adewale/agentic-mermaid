// Route geometry is a value. A pass that moves a route or its caption publishes
// a new points array of new point objects (and a new label position) instead
// of editing the old ones, so object identity can stand for content: a cache
// keyed by a points array, or a candidate copied before a proposal, can never
// observe a later edit. Under unit-test assertions the pipeline freezes routes
// after every pass, so an in-place edit fails at its source; callers get
// unfrozen copies back when the pipeline ends.

import type { Point, PositionedEdge } from '../types.ts'

type Axis = 'x' | 'y'

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
 * leaves the run. A caption riding that run (within 12 px of its lane and inside
 * its main extent) follows it. `anchorFar` keeps the far endpoint in place.
 */
export function shiftTerminalRun(edge: PositionedEdge, fromEnd: boolean, cross: Axis, delta: number, anchorFar = false): void {
  const points = edge.points
  if (points.length === 0) return
  const main: Axis = cross === 'x' ? 'y' : 'x'
  const start = fromEnd ? points.length - 1 : 0, step = fromEnd ? -1 : 1, far = fromEnd ? 0 : points.length - 1
  const ref = points[start]![cross]
  const moved = new Set<number>()
  let mainLo = Infinity, mainHi = -Infinity
  for (let i = start; i >= 0 && i < points.length; i += step) {
    if (Math.abs(points[i]![cross] - ref) > 0.5) break
    if (anchorFar && i === far) break
    mainLo = Math.min(mainLo, points[i]![main])
    mainHi = Math.max(mainHi, points[i]![main])
    moved.add(i)
  }
  edge.points = points.map((point, i) => (moved.has(i) ? { ...point, [cross]: point[cross] + delta } : point))
  const label = edge.labelPosition
  if (label && Math.abs(label[cross] - ref) <= 12 && label[main] >= mainLo - 0.5 && label[main] <= mainHi + 0.5) shiftLabel(edge, cross, delta)
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

/** Hand back unfrozen copies once a pipeline ends, so callers may still edit
 * their own result. Edge identity and route content are unchanged. */
export function thawRoutes(edges: readonly PositionedEdge[] | undefined): void {
  for (const edge of edges ?? []) {
    if (Object.isFrozen(edge.points)) edge.points = edge.points.map(point => ({ ...point }))
    if (edge.labelPosition && Object.isFrozen(edge.labelPosition)) edge.labelPosition = { ...edge.labelPosition }
  }
}
