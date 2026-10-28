import type { MarkerDescriptor } from './ir.ts'

export type MarkerPaintPiece = { kind: 'polygon'; points: { x: number; y: number }[] } | { kind: 'circle'; cx: number; cy: number; r: number }
/** Canonical Class resources contain only convex polygons, two-segment open
 * arrows and circles. Retain their actual fill/stroke pieces, including joins
 * and marker viewport clipping, instead of treating an AABB corner as paint. */
export function markerPaintPieces(marker: MarkerDescriptor, anchor: { x: number; y: number }, tangent: { x: number; y: number }, position: 'start' | 'end', strokeWidth: number, charge?: () => void): MarkerPaintPiece[] {
  charge?.()
  const geometry = marker.geometry
  if (!geometry) return []
  const factor = position === 'start' && marker.orient === 'auto-start-reverse' ? -1 : 1,
    length = Math.hypot(tangent.x, tangent.y)
  if (!length) return []
  const cosine = (factor * tangent.x) / length,
    sine = (factor * tangent.y) / length,
    view = marker.viewBox,
    scale = (marker.units === 'userSpaceOnUse' ? 1 : strokeWidth) * Math.max(1, marker.scale ?? 1) * (view && marker.size ? Math.min(marker.size.width / view.width, marker.size.height / view.height) : 1)
  if (!Number.isFinite(scale)) throw new TypeError('Nonfinite Class marker scale')
  if (scale <= 0) return []
  const world = (p: { x: number; y: number }) => {
    charge?.()
    const x = (p.x - (marker.ref?.x ?? 0)) * scale,
      y = (p.y - (marker.ref?.y ?? 0)) * scale
    return { x: anchor.x + cosine * x - sine * y, y: anchor.y + sine * x + cosine * y }
  }
  const paint = marker.paint ?? {},
    radius = paint.stroke && paint.stroke !== 'none' && paint.stroke !== 'transparent' ? Number.parseFloat(paint.strokeWidth ?? '1') / 2 : 0,
    filled = paint.fill !== undefined && paint.fill !== 'none' && paint.fill !== 'transparent'
  if (geometry.kind === 'circle') {
    const c = world({ x: geometry.cx, y: geometry.cy })
    return [{ kind: 'circle', cx: c.x, cy: c.y, r: (geometry.r + radius) * scale }]
  }
  if (geometry.kind !== 'polygon' && geometry.kind !== 'polyline') throw new TypeError('Unmeasured Class marker geometry')
  const points = geometry.points,
    local: { x: number; y: number }[][] = []
  if (filled && geometry.kind === 'polygon') {
    for (let i = 0; i < points.length; i++) charge?.()
    local.push([...points])
  }
  const count = geometry.kind === 'polygon' ? points.length : points.length - 1
  const vector = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    charge?.()
    const n = Math.hypot(b.x - a.x, b.y - a.y)
    return { x: (b.x - a.x) / n, y: (b.y - a.y) / n }
  }
  if (radius > 0) {
    for (let i = 0; i < count; i++) {
      charge?.()
      const a = points[i]!,
        b = points[(i + 1) % points.length]!,
        d = vector(a, b),
        n = { x: -d.y * radius, y: d.x * radius }
      local.push([
        { x: a.x + n.x, y: a.y + n.y },
        { x: b.x + n.x, y: b.y + n.y },
        { x: b.x - n.x, y: b.y - n.y },
        { x: a.x - n.x, y: a.y - n.y },
      ])
    }
    for (let i = geometry.kind === 'polygon' ? 0 : 1; i < (geometry.kind === 'polygon' ? points.length : points.length - 1); i++) {
      charge?.()
      const p = points[i]!,
        a = points[(i - 1 + points.length) % points.length]!,
        b = points[(i + 1) % points.length]!,
        u = vector(a, p),
        v = vector(p, b),
        turn = u.x * v.y - u.y * v.x
      if (!turn) continue
      const side = turn > 0 ? -1 : 1,
        q = { x: p.x - side * u.y * radius, y: p.y + side * u.x * radius },
        r = { x: p.x - side * v.y * radius, y: p.y + side * v.x * radius },
        t = ((r.x - q.x) * v.y - (r.y - q.y) * v.x) / turn,
        m = { x: q.x + t * u.x, y: q.y + t * u.y }
      local.push(Math.hypot(m.x - p.x, m.y - p.y) <= Number(paint.strokeMiterlimit ?? '4') * radius ? [p, q, m, r] : [p, q, r])
    }
  }
  const clip = (polygon: { x: number; y: number }[], axis: 'x' | 'y', boundary: number, low: boolean) => {
    const result: { x: number; y: number }[] = []
    for (let i = 0; i < polygon.length; i++) {
      charge?.()
      const a = polygon[i]!,
        b = polygon[(i + 1) % polygon.length]!,
        inside = (p: { x: number; y: number }) => (low ? p[axis] >= boundary : p[axis] <= boundary),
        aa = inside(a),
        bb = inside(b)
      if (aa) result.push(a)
      if (aa !== bb) {
        const t = (boundary - a[axis]) / (b[axis] - a[axis])
        result.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
      }
    }
    return result
  }
  return local.flatMap(piece => {
    charge?.()
    if (marker.overflow === 'hidden' && view) {
      for (const [axis, boundary, low] of [
        ['x', view.x, true],
        ['x', view.x + view.width, false],
        ['y', view.y, true],
        ['y', view.y + view.height, false],
      ] as const) {
        charge?.()
        piece = clip(piece, axis, boundary, low)
      }
    }
    const origin = piece[0]
    let area = 0
    if (origin)
      for (let i = 0; i < piece.length; i++) {
        charge?.()
        const a = piece[i]!,
          b = piece[(i + 1) % piece.length]!
        area += (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
      }
    return piece.length >= 3 && area !== 0 ? [{ kind: 'polygon' as const, points: piece.map(world) }] : []
  })
}
