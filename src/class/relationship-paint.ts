import type { MarkerDescriptor } from '../scene/ir.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { classInterfaceMarker } from './interface-occurrences.ts'
import type { RelationshipType } from './types.ts'
export function classMarkerResources(style: ResolvedRenderStyle): readonly MarkerDescriptor[] {
  const edgeColor = style.edgeStrokeColor ?? 'var(--_arrow)'
  const triangle = [
    { x: 0, y: 0 },
    { x: 12, y: 5 },
    { x: 0, y: 10 },
  ]
  const diamond = [
    { x: 7, y: 1 },
    { x: 13, y: 6 },
    { x: 7, y: 11 },
    { x: 1, y: 6 },
  ]
  return [
    { id: 'cls-inherit', shape: 'triangle', size: { width: 12, height: 10 }, ref: { x: 12, y: 5 }, orient: 'auto-start-reverse', overflow: 'visible', geometry: { kind: 'polygon', points: triangle }, paint: { fill: 'var(--bg)', stroke: edgeColor, strokeWidth: '1.5' } },
    { id: 'cls-composition', shape: 'diamond', size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 }, orient: 'auto-start-reverse', overflow: 'hidden', geometry: { kind: 'polygon', points: diamond }, paint: { fill: edgeColor, stroke: edgeColor, strokeWidth: '1' } },
    {
      id: 'cls-aggregation',
      shape: 'diamond-open',
      size: { width: 14, height: 12 },
      viewBox: { x: 0, y: 0, width: 14, height: 12 },
      ref: { x: 13, y: 6 },
      orient: 'auto-start-reverse',
      overflow: 'hidden',
      geometry: { kind: 'polygon', points: diamond },
      paint: { fill: 'var(--bg)', stroke: edgeColor, strokeWidth: '1.5' },
    },
    {
      id: 'cls-arrow',
      shape: 'open-arrow',
      size: { width: 8, height: 6 },
      ref: { x: 8, y: 3 },
      orient: 'auto-start-reverse',
      overflow: 'visible',
      geometry: {
        kind: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 8, y: 3 },
          { x: 0, y: 6 },
        ],
      },
      paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1.5' },
    },
    classInterfaceMarker(edgeColor),
  ]
}

export function getMarkerDefId(type: RelationshipType): string | null {
  switch (type) {
    case 'inheritance':
    case 'realization':
      return 'cls-inherit'
    case 'composition':
      return 'cls-composition'
    case 'aggregation':
      return 'cls-aggregation'
    case 'association':
    case 'dependency':
      return 'cls-arrow'
    case 'lollipop':
      return 'cls-lollipop'
    default:
      return null
  }
}

export const RELATION_LABEL_HALO_WIDTH = 3

export type ClassMarkerPiece = { kind: 'polygon'; points: { x: number; y: number }[] } | { kind: 'circle'; cx: number; cy: number; r: number }
/** Canonical Class resources contain only convex polygons, two-segment open
 * arrows and circles. Retain their actual fill/stroke pieces, including joins
 * and marker viewport clipping, instead of treating an AABB corner as paint. */
export function classMarkerPieces(marker: MarkerDescriptor, anchor: { x: number; y: number }, tangent: { x: number; y: number }, position: 'start' | 'end', strokeWidth: number): ClassMarkerPiece[] {
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
  if (filled && geometry.kind === 'polygon') local.push([...points])
  const count = geometry.kind === 'polygon' ? points.length : points.length - 1
  const vector = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const n = Math.hypot(b.x - a.x, b.y - a.y)
    return { x: (b.x - a.x) / n, y: (b.y - a.y) / n }
  }
  if (radius > 0) {
    for (let i = 0; i < count; i++) {
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
    if (marker.overflow === 'hidden' && view) {
      for (const [axis, boundary, low] of [
        ['x', view.x, true],
        ['x', view.x + view.width, false],
        ['y', view.y, true],
        ['y', view.y + view.height, false],
      ] as const)
        piece = clip(piece, axis, boundary, low)
    }
    const origin = piece[0]
    let area = 0
    if (origin)
      for (let i = 0; i < piece.length; i++) {
        const a = piece[i]!,
          b = piece[(i + 1) % piece.length]!
        area += (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
      }
    return piece.length >= 3 && area !== 0 ? [{ kind: 'polygon' as const, points: piece.map(world) }] : []
  })
}
