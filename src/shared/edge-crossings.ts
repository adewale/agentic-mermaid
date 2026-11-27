/** Shared painted-route crossing metric. No layout, renderer, or agent dependencies. */
import { countIndexedCrossings, prepareIndexedCrossings } from './edge-crossings-indexed.ts'

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
  const segments = visibleSegments(routes)
  const indexed = segments.length >= INDEXED_CROSSING_SEGMENTS ? indexedCrossings(routes, segments, involved) : undefined
  return indexed ?? sweepPolylineCrossings(routes, segments, involved)
}

/** @internal The indexed evaluation at every size, for differential tests.
 * Undefined outside its numeric domain, where the reference sweep applies. */
export function countIndexedPolylineCrossings(routes: readonly CrossingPolyline[], involved?: ReadonlySet<number>): number | undefined {
  return indexedCrossings(routes, visibleSegments(routes), involved)
}

function indexedCrossings(routes: readonly CrossingPolyline[], segments: Segment[], involved: ReadonlySet<number> | undefined): number | undefined {
  const byRoute = segments.slice()
  segments.sort(segmentOrder)
  return countIndexedCrossings(routes.length, byRoute, segments, involved, (a, b) => crossingPoint(a, b, routes), distinctCrossingLocations, edge => routes[edge]!.points)
}

/** Below this many segments the reference sweep is cheaper than indexing. */
const INDEXED_CROSSING_SEGMENTS = 256

/** A visible route normally has at least one segment, so from this many
 * routes a complete count is indexed. Producers announce them before placement
 * so a lazy host loads the counter before, not after, that work. */
export function anticipateCrossingCounts(visibleRoutes: number): void {
  if (visibleRoutes >= INDEXED_CROSSING_SEGMENTS) prepareIndexedCrossings()
}

const segmentOrder = (a: Segment, b: Segment): number => a.minX - b.minX || a.minY - b.minY || a.edgeIndex - b.edgeIndex || a.pointIndex - b.pointIndex

function visibleSegments(routes: readonly CrossingPolyline[]): Segment[] {
  const segments: Segment[] = []
  routes.forEach((route, edgeIndex) => {
    if (route.visible === false) return
    for (let pointIndex = 0; pointIndex + 1 < route.points.length; pointIndex++) {
      const a = route.points[pointIndex]!, b = route.points[pointIndex + 1]!
      if (a.x === b.x && a.y === b.y) continue
      segments.push({ a, b, edgeIndex, pointIndex, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) })
    }
  })
  return segments
}

/** The reference evaluation: every closed bounding-box overlap, pair by pair. */
function sweepPolylineCrossings(routes: readonly CrossingPolyline[], segments: Segment[], involved?: ReadonlySet<number>): number {
  segments.sort(segmentOrder)
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
  // Physical endpoint contact tolerance must not merge distinct incidences.
  // Only numerically identical locations are duplicates; canonical order
  // makes representative selection independent of route traversal.
  for (const points of locations.values()) crossings += distinctCrossingLocations(points)
  return crossings
}

/** A route with the authored ends it connects, for contact checks. */
export interface ContactPolyline extends CrossingPolyline {
  /** Node (or group) ids of the route's two ends. */
  readonly ends: readonly [string, string]
}

/** Unrelated route pairs whose ink meets other than in a proper crossing. */
export interface RouteContacts {
  /** Pairs that meet at a point: a shared corner, a T-junction, or a vertex
   * of one within the contact radius of the other. */
  touches: number
  /** Pairs that share a run within the contact radius of collinear, in
   * either direction. */
  overlaps: number
}

/** Ink closer than this reads as touching: one connector stroke. */
export const ROUTE_CONTACT_RADIUS = 1
/** A shared run longer than this is an overlap rather than a touch. */
const CONTACT_OVERLAP = 1

function pointSegmentDistance(p: CrossingPoint, a: CrossingPoint, b: CrossingPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/** Distance between two segments that have no proper crossing, and the end
 * of one that is nearest the other. Segments meeting only at an end of one
 * of them (a corner, a T-junction) are at distance 0. */
function nearestEnd(a: Segment, b: Segment): { distance: number; at: CrossingPoint } {
  let distance = Infinity, at = a.a
  for (const [p, q, r] of [[a.a, b.a, b.b], [a.b, b.a, b.b], [b.a, a.a, a.b], [b.b, a.a, a.b]] as const) {
    const d = pointSegmentDistance(p, q, r)
    if (d < distance) { distance = d; at = p }
  }
  return { distance, at }
}

/** Length of the run two near-parallel segments share within `radius` of
 * each other; 0 when they are not parallel or not that close. */
function sharedRun(a: Segment, b: Segment, radius: number): number {
  const ax = a.b.x - a.a.x, ay = a.b.y - a.a.y, length = Math.hypot(ax, ay)
  const bx = b.b.x - b.a.x, by = b.b.y - b.a.y, other = Math.hypot(bx, by)
  // Within a hundredth of a radian: a run a fraction of a pixel off collinear.
  if (Math.abs(ax * by - ay * bx) > 0.01 * length * other) return 0
  const ux = ax / length, uy = ay / length
  const offset = (p: CrossingPoint) => Math.abs((p.x - a.a.x) * uy - (p.y - a.a.y) * ux)
  if (offset(b.a) > radius || offset(b.b) > radius) return 0
  const along = (p: CrossingPoint) => (p.x - a.a.x) * ux + (p.y - a.a.y) * uy
  return Math.max(0, Math.min(length, Math.max(along(b.a), along(b.b))) - Math.max(0, Math.min(along(b.a), along(b.b))))
}

/**
 * Count visible route pairs that share no end, yet whose ink meets other
 * than in a proper crossing. Such a meeting reads as a junction: two routes
 * turning at one corner read as each other's continuation, so the drawing
 * shows edges that do not exist, and a shared run hides which route owns it.
 * Contact near a proper crossing of the same pair (within twice the radius)
 * is part of that crossing. Each pair counts once: as an overlap when it
 * shares a run, otherwise as a touch. Proper crossings are counted by
 * `countPolylineCrossings`, so the two measures never count one meeting twice.
 */
export function measureRouteContacts(routes: readonly ContactPolyline[], radius = ROUTE_CONTACT_RADIUS): RouteContacts {
  // Routes drawn as a bus repeat one segment across many routes (a 60 x 60
  // fan draws 18,000 segments as 241 distinct ones). The geometry-only tests
  // run once per pair of distinct directed segments; only the route-dependent
  // crossing test runs per pair of routes, and only where a touch is possible.
  const byGeometry = new Map<string, Segment[]>()
  for (const segment of visibleSegments(routes)) {
    const key = `${segment.a.x},${segment.a.y},${segment.b.x},${segment.b.y}`
    const members = byGeometry.get(key)
    if (members) members.push(segment)
    else byGeometry.set(key, [segment])
  }
  const classes = [...byGeometry.values()].sort((a, b) => segmentOrder(a[0]!, b[0]!))
  const count = routes.length
  const overlapping = new Uint32Array(Math.ceil(count * count / 32))
  let overlaps = 0
  const touchPoints = new Map<number, CrossingPoint[]>()
  const pairIndex = (a: Segment, b: Segment) => Math.min(a.edgeIndex, b.edgeIndex) * count + Math.max(a.edgeIndex, b.edgeIndex)
  const unrelated = (a: Segment, b: Segment): boolean => {
    if (a.edgeIndex === b.edgeIndex) return false
    const ends = routes[a.edgeIndex]!.ends, otherEnds = routes[b.edgeIndex]!.ends
    return !(ends[0] === otherEnds[0] || ends[0] === otherEnds[1] || ends[1] === otherEnds[0] || ends[1] === otherEnds[1])
  }
  const markOverlap = (a: Segment, b: Segment): void => {
    const index = pairIndex(a, b), word = index >>> 5, bit = 1 << (index & 31)
    if (overlapping[word]! & bit) return
    overlapping[word]! |= bit
    overlaps++
  }
  const overlapped = (index: number): boolean => (overlapping[index >>> 5]! & (1 << (index & 31))) !== 0
  const addTouch = (a: Segment, b: Segment, at: CrossingPoint): void => {
    const index = pairIndex(a, b), points = touchPoints.get(index)
    if (points) points.push(at)
    else touchPoints.set(index, [at])
  }
  /** One pair of segments of unrelated routes, `later` after `earlier` in
   * segment order: the complete per-pair rule. A crossing is retained by
   * re-evaluating the pair's routes below, only where a touch needs it. */
  const evaluate = (later: Segment, earlier: Segment): void => {
    if (crossingPoint(later, earlier, routes)) return
    if (sharedRun(later, earlier, radius) > CONTACT_OVERLAP) { markOverlap(later, earlier); return }
    const near = nearestEnd(later, earlier)
    if (near.distance <= radius) addTouch(later, earlier, near.at)
  }
  const ordered = (a: Segment, b: Segment): [Segment, Segment] => segmentOrder(a, b) > 0 ? [a, b] : [b, a]
  const axis = (segment: Segment): 'h' | 'v' | undefined => segment.a.y === segment.b.y ? 'h' : segment.a.x === segment.b.x ? 'v' : undefined
  // Segments sharing an axis orientation are exactly parallel, so they never
  // cross and the shared run alone decides an overlap for every member pair.
  const nearPairs: [Segment[], Segment[]][] = []
  const visitClasses = (later: Segment[], earlier: Segment[]): void => {
    const a = later[0]!, b = earlier[0]!, orientation = axis(a), other = axis(b)
    if (orientation !== undefined && other !== undefined) {
      if (orientation !== other) {
        // Perpendicular axis segments share no run; only a touch remains,
        // decided per pair of routes once the overlaps are known.
        if (nearestEnd(a, b).distance <= radius) nearPairs.push([later, earlier])
        return
      }
      const run = sharedRun(a, b, radius) > CONTACT_OVERLAP
      // Member order follows route indices where two classes tie on their
      // leading corner; both orders must then agree to decide by class.
      const tied = a !== b && a.minX === b.minX && a.minY === b.minY
      if (!tied || run === (sharedRun(b, a, radius) > CONTACT_OVERLAP)) {
        if (run) {
          for (const p of later) for (const q of earlier) if (p !== q && unrelated(p, q)) markOverlap(p, q)
        } else if (nearestEnd(a, b).distance <= radius) nearPairs.push([later, earlier])
        return
      }
    }
    for (const p of later) for (const q of earlier) if (p !== q && unrelated(p, q)) evaluate(...ordered(p, q))
  }
  const active: Segment[][] = []
  for (const members of classes) {
    const segment = members[0]!
    if (members.length > 1) visitClasses(members, members)
    let retained = 0
    for (let index = 0; index < active.length; index++) {
      const other = active[index]!, rep = other[0]!
      if (!(rep.maxX + radius >= segment.minX)) continue
      active[retained++] = other
      if (rep.maxY + radius < segment.minY || rep.minY - radius > segment.maxY) continue
      visitClasses(members, other)
    }
    active.length = retained
    active.push(members)
  }
  // Touches matter only for pairs that share no run.
  for (const [later, earlier] of nearPairs) {
    for (const p of later) for (const q of earlier) {
      if (p === q || !unrelated(p, q) || overlapped(pairIndex(p, q))) continue
      const [first, second] = ordered(p, q)
      if (crossingPoint(first, second, routes)) continue
      addTouch(first, second, nearestEnd(first, second).at)
    }
  }
  // A touch within twice the radius of a proper crossing of the same pair is
  // part of that crossing: gather each touching pair's crossings.
  const byRoute = new Map<number, Segment[]>()
  for (const members of classes) for (const segment of members) {
    const list = byRoute.get(segment.edgeIndex)
    if (list) list.push(segment)
    else byRoute.set(segment.edgeIndex, [segment])
  }
  let touches = 0
  for (const [index, points] of touchPoints) {
    if (overlapped(index)) continue
    const crossings: CrossingPoint[] = []
    for (const p of byRoute.get(Math.floor(index / count))!) for (const q of byRoute.get(index % count)!) {
      const [first, second] = ordered(p, q)
      const crossing = crossingPoint(first, second, routes)
      if (crossing) crossings.push(crossing)
    }
    if (points.some(point => crossings.every(crossing => Math.hypot(crossing.x - point.x, crossing.y - point.y) > 2 * radius))) touches++
  }
  return { touches, overlaps }
}
