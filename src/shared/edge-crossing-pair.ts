import { crossingPoint, retainCrossingLocation, distinctCrossingLocations, type CrossingPolyline } from './edge-crossings.ts'
type CrossingPoint = CrossingPolyline['points'][number]
type CrossingLocation = NonNullable<ReturnType<typeof crossingPoint>>

/**
 * Exact two-route query for repeated repair proposals. The general sweep also
 * groups by logical edge pair; here there is only one pair, so segment sorting,
 * an active set and a keyed location map are unnecessary. Scratch segments are
 * private to this call: accepted repairs can mutate the input routes afterwards.
 */
export function countPolylinePairCrossings(first: CrossingPolyline, second: CrossingPolyline): number {
  return first.visible === false || second.visible === false ? 0 : countPointPairCrossings(first.points, second.points)
}

/** Route repair already owns visibility and needs no wrapper objects. */
export function countPointPairCrossings(first: readonly CrossingPoint[], second: readonly CrossingPoint[]): number {
  let routes: CrossingPolyline[] | undefined
  let locations: CrossingLocation[] | undefined
  for (let i = 0; i + 1 < first.length; i++) {
    const p = first[i]!, q = first[i + 1]!
    if (p.x === q.x && p.y === q.y) continue
    const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x), minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y)
    for (let j = 0; j + 1 < second.length; j++) {
      const r = second[j]!, s = second[j + 1]!
      if (r.x === s.x && r.y === s.y) continue
      if (maxX < Math.min(r.x, s.x) || minX > Math.max(r.x, s.x) || maxY < Math.min(r.y, s.y) || minY > Math.max(r.y, s.y)) continue
      if ((p.x === q.x && r.x === s.x) || (p.y === q.y && r.y === s.y)) continue
      routes ??= [{ points: first }, { points: second }]
      const point = crossingPoint({ a: p, b: q, edgeIndex: 0, pointIndex: i }, { a: r, b: s, edgeIndex: 1, pointIndex: j }, routes)
      if (!point) continue
      if (!locations) locations = [point]
      else retainCrossingLocation(locations, point)
    }
  }
  return locations ? distinctCrossingLocations(locations) : 0
}

