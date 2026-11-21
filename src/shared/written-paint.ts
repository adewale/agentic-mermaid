import type { Geometry, MarkPaint, ScenePoint } from '../scene/ir.ts'
import { paintedStrokeExtent } from '../scene/bounds.ts'
import type { AxisAlignedBox } from './transformed-bounds.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from './svg-number.ts'

export function writtenGeometry(geometry: Geometry): Geometry {
  if (geometry.kind === 'compound') return { ...geometry, children: geometry.children.map(writtenGeometry) }
  if (geometry.kind === 'path') return { ...geometry, d: formatSvgNumericAttribute('d', geometry.d) }
  if (geometry.kind === 'polygon' || geometry.kind === 'polyline') return { ...geometry, points: geometry.points.map(writtenPoint) }
  return Object.fromEntries(Object.entries(geometry).map(([key, value]) => [key, typeof value === 'number' ? Number(formatSvgNumber(value)) : value])) as Geometry
}

export const writtenPoint = (point: ScenePoint): ScenePoint => ({ x: Number(formatSvgNumber(point.x)), y: Number(formatSvgNumber(point.y)) })
export const finiteBox = (box: AxisAlignedBox | undefined): box is AxisAlignedBox => !!box && Object.values(box).every(Number.isFinite) && box.x0 <= box.x1 && box.y0 <= box.y1
export const boxesMeet = (a: AxisAlignedBox, b: AxisAlignedBox): boolean => {
  // Preserve the incoming conservative arithmetic/serialization separator.
  const error = (Math.abs(a.x0) + Math.abs(a.y0) + Math.abs(a.x1) + Math.abs(a.y1) + Math.abs(b.x0) + Math.abs(b.y0) + Math.abs(b.x1) + Math.abs(b.y1)) * 1e-10 + 1e-9
  return !Number.isFinite(error) || a.x0 < b.x1 + error && b.x0 < a.x1 + error && a.y0 < b.y1 + error && b.y0 < a.y1 + error
}

/** Written butt-capped orthogonal shafts and right-angle miter supports. */
export function orthogonalStrokeInk(points: readonly ScenePoint[], paint: MarkPaint): AxisAlignedBox[] | undefined {
  if (paint.strokeLinecap && paint.strokeLinecap !== 'butt' || paint.strokeLinejoin && paint.strokeLinejoin !== 'miter') return undefined
  const half = paintedStrokeExtent(paint, false)
  if (half === undefined) return undefined
  const boxes: AxisAlignedBox[] = []
  if (half === 0 || points.length < 2) return boxes
  let a = writtenPoint(points[0]!), previousVertical: boolean | undefined
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return undefined
  for (let i = 1; i < points.length; i++) {
    const b = writtenPoint(points[i]!)
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return undefined
    if (a.x === b.x && a.y === b.y) continue
    const vertical = a.x === b.x
    if (!vertical && a.y !== b.y) return undefined
    if (previousVertical !== undefined && previousVertical !== vertical) {
      boxes.push({ x0: a.x - half, y0: a.y - half, x1: a.x + half, y1: a.y + half })
    }
    boxes.push(vertical ? { x0: a.x - half, y0: Math.min(a.y, b.y), x1: a.x + half, y1: Math.max(a.y, b.y) }
      : { x0: Math.min(a.x, b.x), y0: a.y - half, x1: Math.max(a.x, b.x), y1: a.y + half })
    a = b
    previousVertical = vertical
  }
  return boxes
}
