import type { PositionedEdge } from '../types.ts'

type InkEdge = Pick<PositionedEdge, 'style' | 'points'>

function axisRuns(edge: InkEdge, edgeIndex: number) {
  return edge.style === 'invisible' ? [] : edge.points.slice(1).flatMap((b, index) => {
    const a = edge.points[index]!
    const horizontal = Math.abs(a.y - b.y) <= 0.01
    if (!horizontal && Math.abs(a.x - b.x) > 0.01) return []
    const from = horizontal ? a.x : a.y, to = horizontal ? b.x : b.y
    if (Math.abs(to - from) <= 0.01) return []
    const cross = horizontal ? a.y : a.x
    return [{ edgeIndex, horizontal, cross, bucket: Math.floor(cross / 0.01), lo: Math.min(from, to), hi: Math.max(from, to), sign: Math.sign(to - from) }]
  })
}

/** Opposite-direction shafts sharing positive-length collinear ink conceal
 * which route owns that span. Same-direction fan trunks and mere endpoint
 * contacts are excluded. Row buckets and an interval sweep avoid unrelated
 * segment pairs; a pair of edges counts once even when several runs overlap. */
export function countOpposingRouteOverlaps(edges: readonly InkEdge[]): number {
  const segments = edges.flatMap(axisRuns).sort((a, b) => a.lo - b.lo || a.edgeIndex - b.edgeIndex)
  const rows = new Map<string, typeof segments>()
  const pairs = new Set<string>()
  for (const segment of segments) {
    for (let offset = -1; offset <= 1; offset++) {
      const key = `${segment.horizontal}:${segment.bucket + offset}`
      const active = (rows.get(key) ?? []).filter(other => other.hi - segment.lo > 0.01)
      rows.set(key, active)
      for (const other of active) {
        if (other.edgeIndex === segment.edgeIndex || other.sign === segment.sign || Math.abs(other.cross - segment.cross) > 0.01 ||
          Math.min(segment.hi, other.hi) - segment.lo <= 0.01) continue
        pairs.add(`${Math.min(segment.edgeIndex, other.edgeIndex)}:${Math.max(segment.edgeIndex, other.edgeIndex)}`)
      }
    }
    const key = `${segment.horizontal}:${segment.bucket}`
    rows.get(key)!.push(segment)
  }
  return pairs.size
}

/** The pairs `countOpposingRouteOverlaps` counts for one route: those of
 * `others` that run back along it. Scoring one changed route against fixed
 * peers this way avoids re-sweeping every other pair. */
export function opposingRoutePartners<T extends InkEdge>(route: InkEdge, others: readonly T[]): T[] {
  const mine = axisRuns(route, 0)
  const partners: T[] = []
  if (mine.length === 0) return partners
  const box = routeBounds(route)
  for (const other of others) {
    // Shared ink lies inside both routes' bounds; most peers are elsewhere.
    const near = routeBounds(other)
    if (near.x0 > box.x1 + 0.01 || near.x1 < box.x0 - 0.01 || near.y0 > box.y1 + 0.01 || near.y1 < box.y0 - 0.01) continue
    if (axisRuns(other, 1).some(b => mine.some(a =>
      a.horizontal === b.horizontal && a.sign !== b.sign && Math.abs(a.cross - b.cross) <= 0.01 && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0.01))) partners.push(other)
  }
  return partners
}

function routeBounds(edge: InkEdge): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const point of edge.points) {
    x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x)
    y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y)
  }
  return { x0, y0, x1, y1 }
}
