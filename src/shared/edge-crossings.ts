/** Shared painted-route crossing metric. No layout, renderer, or agent dependencies. */
interface CrossingPoint { readonly x: number; readonly y: number }

export interface CrossingPolyline {
  readonly points: readonly CrossingPoint[]
  /** Omitted means visible, including older public layout projections. */
  readonly visible?: boolean
}

/** Physical pixel tolerance, independent of the length of either segment. */
const ENDPOINT_EPSILON = 0.01
export { ENDPOINT_EPSILON as CROSSING_ENDPOINT_RADIUS }

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

interface CrossingLocation extends CrossingPoint { error: number }
type RouteSegment = Pick<Segment, 'a' | 'b' | 'edgeIndex' | 'pointIndex'>

function locationTolerance(a: CrossingPoint, b: CrossingPoint): number {
  return 8 * Number.EPSILON * Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y))
}

function sameLocation(a: CrossingPoint, b: CrossingPoint, error = 0): boolean {
  const tolerance = Math.max(error, locationTolerance(a, b))
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
}

function pointOrder(a: CrossingPoint, b: CrossingPoint): number {
  return a.x - b.x || a.y - b.y
}

export function retainCrossingLocation(points: CrossingLocation[], point: CrossingLocation): void {
  const duplicate = points.find(p => p.x === point.x && p.y === point.y)
  if (duplicate) duplicate.error = Math.max(duplicate.error, point.error)
  else points.push(point)
}

export function distinctCrossingLocations(points: CrossingLocation[]): number {
  points.sort(pointOrder)
  const distinct: CrossingLocation[] = []
  for (const point of points) {
    if (!distinct.some(previous => sameLocation(previous, point, Math.max(previous.error, point.error)))) distinct.push(point)
  }
  return distinct.length
}

function localRays(segment: RouteSegment, point: CrossingLocation, routes: readonly CrossingPolyline[]): [CrossingPoint, CrossingPoint] | undefined {
  const points = routes[segment.edgeIndex]!.points
  // The physical contact tolerance belongs to the whole route's endpoints.
  // Applying it to internal bends changes topology when a segment is split.
  const endpointContact = (p: CrossingPoint): boolean => Math.hypot(p.x - point.x, p.y - point.y) <= ENDPOINT_EPSILON + Math.max(point.error, locationTolerance(p, point))
  if (endpointContact(points[0]!) || endpointContact(points[points.length - 1]!)) return undefined
  const sameVertex = (p: CrossingPoint): boolean => sameLocation(p, point, point.error)
  const vertex = sameVertex(segment.a) ? segment.pointIndex : sameVertex(segment.b) ? segment.pointIndex + 1 : -1
  if (vertex < 0) return [segment.a, segment.b]
  let before = vertex - 1, after = vertex + 1
  while (before >= 0 && sameVertex(points[before]!)) before--
  while (after < points.length && sameVertex(points[after]!)) after++
  // Contacts at a route's physical endpoints are not proper crossings.
  if (before < 0 || after >= points.length) return undefined
  return [points[before]!, points[after]!]
}

export function crossingPoint(a: RouteSegment, b: RouteSegment, routes: readonly CrossingPolyline[]): CrossingLocation | undefined {
  // The same geometry uses the same arithmetic under route reversal/order.
  let p = a.a, q = a.b, r = b.a, s = b.b
  if (pointOrder(p, q) > 0) [p, q] = [q, p]
  if (pointOrder(r, s) > 0) [r, s] = [s, r]
  if ((pointOrder(p, r) || pointOrder(q, s)) > 0) [p, q, r, s] = [r, s, p, q]
  const ax = q.x - p.x, ay = q.y - p.y
  const bx = s.x - r.x, by = s.y - r.y
  const positive = ax * by, negative = ay * bx
  const determinant = positive - negative
  // Bound cancellation relative to the actual terms: an absolute cutoff
  // would mistake tiny, perpendicular subdivision segments for parallel ink.
  if (Math.abs(determinant) <= Number.EPSILON * (Math.abs(positive) + Math.abs(negative))) return undefined
  const dx = r.x - p.x, dy = r.y - p.y
  const tx = dx * by, ty = dy * bx, ux = dx * ay, uy = dy * ax
  const t = (tx - ty) / determinant, u = (ux - uy) / determinant
  const denominatorScale = Math.abs(positive) + Math.abs(negative)
  // Cancellation can put an exact vertex just outside [0,1]. Snap only
  // within a numerical error bound, never within the physical contact radius.
  const parameterTolerance = (value: number, first: number, second: number): number =>
    8 * Number.EPSILON * (1 + (Math.abs(first) + Math.abs(second) + Math.abs(value) * denominatorScale) / Math.abs(determinant))
  const tTolerance = parameterTolerance(t, tx, ty), uTolerance = parameterTolerance(u, ux, uy)
  if (t < -tTolerance || t > 1 + tTolerance || u < -uTolerance || u > 1 + uTolerance) return undefined
  const tVertex = Math.abs(t) <= tTolerance ? p : Math.abs(t - 1) <= tTolerance ? q : undefined
  const uVertex = Math.abs(u) <= uTolerance ? r : Math.abs(u - 1) <= uTolerance ? s : undefined
  // Input endpoints can be much larger than the intersection coordinate.
  // Retain the calculation's error scale rather than using only result ULPs.
  const error = Math.max(locationTolerance(p, q), locationTolerance(r, s),
    tTolerance * (Math.abs(ax) + Math.abs(ay)), uTolerance * (Math.abs(bx) + Math.abs(by)))
  const point = { ...(tVertex ?? uVertex ?? { x: p.x + t * ax, y: p.y + t * ay }), error }
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
  const active: Segment[] = []
  const locations = new Map<string, CrossingLocation[]>()
  for (const segment of segments) {
    // Stable compaction retains the same candidate order without allocating a
    // new active array at every segment in repeated layout/search scoring.
    let retained = 0
    for (let index = 0; index < active.length; index++) {
      const other = active[index]!
      if (!(other.maxX >= segment.minX)) continue
      active[retained++] = other
      if (other.edgeIndex === segment.edgeIndex || (involved && !involved.has(other.edgeIndex) && !involved.has(segment.edgeIndex)) || other.maxY < segment.minY || other.minY > segment.maxY) continue
      const point = crossingPoint(segment, other, routes)
      if (!point) continue
      const key = `${Math.min(segment.edgeIndex, other.edgeIndex)}:${Math.max(segment.edgeIndex, other.edgeIndex)}`
      const previous = locations.get(key)
      // Subdivision and retracing can emit the same location many times.
      // Remove exact duplicates before retaining the numerical dedup input.
      if (previous) {
        const duplicate = previous.find(p => p.x === point.x && p.y === point.y)
        if (duplicate) duplicate.error = Math.max(duplicate.error, point.error)
        else previous.push(point)
      }
      else locations.set(key, [point])
    }
    active.length = retained
    active.push(segment)
  }
  let crossings = 0
  for (const points of locations.values()) {
    // Physical endpoint contact tolerance must not merge distinct incidences.
    // Only numerically identical locations are duplicates; canonical order
    // makes representative selection independent of route traversal.
    points.sort(pointOrder)
    const distinct: CrossingLocation[] = []
    for (const point of points) {
      if (!distinct.some(previous => sameLocation(previous, point, Math.max(previous.error, point.error)))) distinct.push(point)
    }
    crossings += distinct.length
  }
  return crossings
}
