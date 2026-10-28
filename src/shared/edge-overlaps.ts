import type { PositionedEdge } from '../types.ts'

/** Opposite-direction shafts sharing positive-length collinear ink conceal
 * which route owns that span. Same-direction fan trunks and mere endpoint
 * contacts are excluded. Row buckets and an interval sweep avoid unrelated
 * segment pairs; a pair of edges counts once even when several runs overlap. */
export function countOpposingRouteOverlaps(edges: readonly Pick<PositionedEdge, 'style' | 'points'>[]): number {
  const segments = edges.flatMap((edge, edgeIndex) => edge.style === 'invisible' ? [] : edge.points.slice(1).flatMap((b, index) => {
    const a = edge.points[index]!
    const horizontal = Math.abs(a.y - b.y) <= 0.01
    if (!horizontal && Math.abs(a.x - b.x) > 0.01) return []
    const from = horizontal ? a.x : a.y, to = horizontal ? b.x : b.y
    if (Math.abs(to - from) <= 0.01) return []
    const cross = horizontal ? a.y : a.x
    return [{ edgeIndex, horizontal, cross, bucket: Math.floor(cross / 0.01), lo: Math.min(from, to), hi: Math.max(from, to), sign: Math.sign(to - from) }]
  })).sort((a, b) => a.lo - b.lo || a.edgeIndex - b.edgeIndex)
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

