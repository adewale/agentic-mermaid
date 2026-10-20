/** Shared painted-route crossing metric. No layout, renderer, or agent dependencies. */
interface CrossingPoint { readonly x: number; readonly y: number }

export interface CrossingPolyline {
  readonly points: readonly CrossingPoint[]
  /** Omitted means visible, including older public layout projections. */
  readonly visible?: boolean
}

/** Physical pixel tolerance, independent of the length of either segment. */
const ENDPOINT_EPSILON = 0.01

interface Segment {
  a: CrossingPoint
  b: CrossingPoint
  edgeIndex: number
  pointIndex: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function localRays(segment: Segment, point: CrossingPoint, routes: readonly CrossingPolyline[]): [CrossingPoint, CrossingPoint] | undefined {
  const close = (p: CrossingPoint): boolean => Math.hypot(p.x - point.x, p.y - point.y) <= ENDPOINT_EPSILON
  const vertex = close(segment.a) ? segment.pointIndex : close(segment.b) ? segment.pointIndex + 1 : -1
  if (vertex < 0) return [segment.a, segment.b]
  const points = routes[segment.edgeIndex]!.points
  let before = vertex - 1, after = vertex + 1
  while (before >= 0 && close(points[before]!)) before--
  while (after < points.length && close(points[after]!)) after++
  // Contacts at a route's physical endpoints are not proper crossings.
  if (before < 0 || after >= points.length) return undefined
  return [points[before]!, points[after]!]
}

function crossingPoint(a: Segment, b: Segment, routes: readonly CrossingPolyline[]): CrossingPoint | undefined {
  const ax = a.b.x - a.a.x, ay = a.b.y - a.a.y
  const bx = b.b.x - b.a.x, by = b.b.y - b.a.y
  const positive = ax * by, negative = ay * bx
  const determinant = positive - negative
  // Bound cancellation relative to the actual terms: an absolute cutoff
  // would mistake tiny, perpendicular subdivision segments for parallel ink.
  if (Math.abs(determinant) <= Number.EPSILON * (Math.abs(positive) + Math.abs(negative))) return undefined
  const dx = b.a.x - a.a.x, dy = b.a.y - a.a.y
  const t = (dx * by - dy * bx) / determinant
  const u = (dx * ay - dy * ax) / determinant
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined
  const point = { x: a.a.x + t * ax, y: a.a.y + t * ay }
  const aRays = localRays(a, point, routes), bRays = localRays(b, point, routes)
  if (!aRays || !bRays) return undefined
  // Straight segment interiors always cross here. At an internal polyline
  // vertex, the four outgoing rays must alternate by route around the point:
  // this admits harmless subdivisions while excluding bends that only touch.
  if (aRays[0] === a.a && aRays[1] === a.b && bRays[0] === b.a && bRays[1] === b.b) return point
  const rays = [...aRays.map(p => ({ angle: Math.atan2(p.y - point.y, p.x - point.x), edge: 0 })),
    ...bRays.map(p => ({ angle: Math.atan2(p.y - point.y, p.x - point.x), edge: 1 }))]
    .sort((p, q) => p.angle - q.angle)
  for (let i = 0; i < rays.length; i++) {
    const current = rays[i]!, next = rays[(i + 1) % rays.length]!
    const gap = (next.angle - current.angle + 2 * Math.PI) % (2 * Math.PI)
    if (current.edge === next.edge || gap < 1e-9) return undefined
  }
  return point
}

/**
 * Count visible proper crossing incidences per logical edge pair and location.
 * Two edge pairs crossing at the same point count twice; one pair crossing at
 * two points also counts twice. Subdividing a polyline at a crossing does not
 * duplicate or erase it. Endpoint contacts, tangencies, collinear shared ink,
 * self-intersections, and invisible routes do not count. Sharing a graph node
 * does not exempt two routes from crossings elsewhere.
 *
 * The x/y bounding-box broad phase is shared by final ranking, pass budgets,
 * and public quality. `involved` preserves original route indices.
 */
export function countPolylineCrossings(routes: readonly CrossingPolyline[], involved?: ReadonlySet<number>): number {
  const segments: Segment[] = []
  routes.forEach((route, edgeIndex) => {
    if (route.visible === false) return
    for (let pointIndex = 0; pointIndex + 1 < route.points.length; pointIndex++) {
      const a = route.points[pointIndex]!, b = route.points[pointIndex + 1]!
      if (a.x === b.x && a.y === b.y) continue
      segments.push({ a, b, edgeIndex, pointIndex, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) })
    }
  })
  segments.sort((a, b) => a.minX - b.minX || a.minY - b.minY || a.edgeIndex - b.edgeIndex || a.pointIndex - b.pointIndex)
  let active: Segment[] = []
  const locations = new Map<string, CrossingPoint[]>()
  for (const segment of segments) {
    active = active.filter(other => other.maxX >= segment.minX)
    for (const other of active) {
      if (other.edgeIndex === segment.edgeIndex || (involved && !involved.has(other.edgeIndex) && !involved.has(segment.edgeIndex)) || other.maxY < segment.minY || other.minY > segment.maxY) continue
      const point = crossingPoint(segment, other, routes)
      if (!point) continue
      const key = `${Math.min(segment.edgeIndex, other.edgeIndex)}:${Math.max(segment.edgeIndex, other.edgeIndex)}`
      const previous = locations.get(key)
      if (previous) previous.push(point)
      else locations.set(key, [point])
    }
    active.push(segment)
  }
  let crossings = 0
  for (const points of locations.values()) {
    // An epsilon neighbourhood is not transitive. Always choose representatives
    // in coordinate order so route direction or subdivision cannot choose a
    // middle location first and suppress both otherwise-distinct outer ones.
    points.sort((a, b) => a.x - b.x || a.y - b.y)
    const distinct: CrossingPoint[] = []
    for (const point of points) {
      if (!distinct.some(previous => Math.hypot(previous.x - point.x, previous.y - point.y) <= ENDPOINT_EPSILON)) distinct.push(point)
    }
    crossings += distinct.length
  }
  return crossings
}
