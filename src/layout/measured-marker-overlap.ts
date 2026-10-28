import type { ClassMarkerPiece } from '../class/relationship-paint.ts'

/** Positive-area overlap of trusted canonical marker pieces. No allocations or
 * ownership/opacity inference; the caller owns those distinct policy checks. */
export function classMarkerPiecesOverlap(left: readonly ClassMarkerPiece[], right: readonly ClassMarkerPiece[], charge?: (units: number) => void): boolean {
  for (let i = 0; i < left.length; i++)
    for (let j = 0; j < right.length; j++) {
      charge?.(1)
      const a = left[i]!,
        b = right[j]!
      if (a.kind === 'circle') {
        if (b.kind === 'circle') {
          const dx = a.cx - b.cx,
            dy = a.cy - b.cy,
            r = a.r + b.r
          if (a.r > 0 && b.r > 0 && dx * dx + dy * dy < r * r) return true
        } else if (circlePolygon(a.cx, a.cy, a.r, b.points, charge)) return true
      } else if (b.kind === 'circle') {
        if (circlePolygon(b.cx, b.cy, b.r, a.points, charge)) return true
      } else if (polygons(a.points, b.points, charge)) return true
    }
  return false
}

type Polygon = Extract<ClassMarkerPiece, { kind: 'polygon' }>['points']
function polygons(a: Polygon, b: Polygon, charge?: (units: number) => void): boolean {
  if (a.length < 3 || b.length < 3) return false
  const origin = a[0]!
  let axes = 0
  for (let source = 0; source < 2; source++) {
    const polygon = source === 0 ? a : b
    for (let i = 0; i < polygon.length; i++) {
      charge?.(1)
      const p = polygon[i]!,
        q = polygon[(i + 1) % polygon.length]!,
        nx = p.y - q.y,
        ny = q.x - p.x
      if (nx === 0 && ny === 0) continue
      axes++
      let lowA = Infinity,
        highA = -Infinity,
        lowB = Infinity,
        highB = -Infinity
      for (let k = 0; k < a.length; k++) {
        charge?.(1)
        const point = a[k]!,
          value = (point.x - origin.x) * nx + (point.y - origin.y) * ny
        lowA = Math.min(lowA, value)
        highA = Math.max(highA, value)
      }
      for (let k = 0; k < b.length; k++) {
        charge?.(1)
        const point = b[k]!,
          value = (point.x - origin.x) * nx + (point.y - origin.y) * ny
        lowB = Math.min(lowB, value)
        highB = Math.max(highB, value)
      }
      if (Math.min(highA, highB) <= Math.max(lowA, lowB)) return false
    }
  }
  return axes > 0
}
function circlePolygon(cx: number, cy: number, radius: number, points: Polygon, charge?: (units: number) => void): boolean {
  if (!(radius > 0) || points.length < 3) return false
  let sign = 0,
    inside = true,
    area = 0,
    distanceSquared = Infinity
  const origin = points[0]!
  for (let i = 0; i < points.length; i++) {
    charge?.(1)
    const a = points[i]!,
      b = points[(i + 1) % points.length]!,
      dx = b.x - a.x,
      dy = b.y - a.y,
      cross = dx * (cy - a.y) - dy * (cx - a.x)
    area += (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
    if (cross !== 0) {
      if (sign !== 0 && Math.sign(cross) !== sign) inside = false
      sign ||= Math.sign(cross)
    }
    const length = dx * dx + dy * dy,
      t = length > 0 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / length)) : 0
    distanceSquared = Math.min(distanceSquared, (a.x + t * dx - cx) ** 2 + (a.y + t * dy - cy) ** 2)
  }
  return area !== 0 && (inside || distanceSquared < radius * radius)
}
