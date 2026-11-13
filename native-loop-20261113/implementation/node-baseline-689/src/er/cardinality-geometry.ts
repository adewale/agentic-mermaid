import type { Cardinality } from './types.ts'
import type { Geometry, MarkPaint, ScenePoint } from '../scene/ir.ts'
import { nodePaintBounds, unionSceneBounds } from '../scene/bounds.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'

export interface ErCardinalityPiece { geometry: Geometry; paint: MarkPaint }
/** One call-local allowance shared by ER geometry and label repair. */
export interface ErGeometryWork { operations: number }
type ShapePiece = ErCardinalityPiece

export function erCardinalityPieces(
  point: { x: number; y: number },
  toward: { x: number; y: number },
  cardinality: Cardinality,
  stroke: MarkPaint,
): ShapePiece[] {
  const pieces: ShapePiece[] = []

  // Calculate direction from toward → point (unit vector)
  const dx = point.x - toward.x
  const dy = point.y - toward.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return []
  const ux = dx / len
  const uy = dy / len

  // Perpendicular direction
  const px = -uy
  const py = ux

  if (cardinality === 'parent') {
    const at = (back: number, side: number) => ({ x: point.x - ux * back + px * side, y: point.y - uy * back + py * side })
    return [{ geometry: { kind: 'polygon', points: [at(0, 0), at(6, 4), at(12, 0), at(6, -4)] }, paint: { fill: 'var(--bg)', ...stroke } }]
  }

  // Marker sits 4px from the endpoint, extending 12px back along the edge
  const tipX = point.x - ux * 4
  const tipY = point.y - uy * 4
  const backX = point.x - ux * 16
  const backY = point.y - uy * 16

  // Primitive vocabulary follows upstream's erMarkers reference exactly:
  //   one        = tick + tick        zero-one  = tick + circle
  //   many       = crow's foot + tick zero-many = crow's foot + circle
  // A tick is a perpendicular line; the circle marks the "zero" minimum.
  // Before this correction 'zero-one' drew TWO ticks (reading as "one and
  // only one" plus a circle) and 'many' drew no tick (one-or-more was
  // indistinguishable from a bare many).
  const hasCrowsFoot = cardinality === 'many' || cardinality === 'zero-many'
  const hasCircle = cardinality === 'zero-one' || cardinality === 'zero-many'

  /** Draw one tick (perpendicular line) centered on (cx, cy). */
  const pushTickAt = (cx: number, cy: number): void => {
    const halfW = 6
    const x1 = cx + px * halfW
    const y1 = cy + py * halfW
    const x2 = cx - px * halfW
    const y2 = cy - py * halfW
    pieces.push({ geometry: { kind: 'line', x1, y1, x2, y2 }, paint: stroke })
  }

  if (cardinality === 'one') {
    // Two ticks: one and only one. (The second tick keeps the historical
    // two-step arithmetic — (tip - 4u), not (point - 8u) — so existing `||`
    // markers stay byte-identical.)
    pushTickAt(tipX, tipY)
    pushTickAt(tipX - ux * 4, tipY - uy * 4)
  } else if (cardinality === 'zero-one') {
    // ONE tick at the tip; the circle behind it carries the "zero" minimum.
    pushTickAt(tipX, tipY)
  }

  // Crow's foot (three lines fanning out from tip)
  if (hasCrowsFoot) {
    const fanW = 7
    // Center line
    const cfTipX = tipX
    const cfTipY = tipY
    // Three lines from tip to back, fanning out
    const topX1 = cfTipX + px * fanW
    const topY1 = cfTipY + py * fanW
    pieces.push({
      // Top fan line
      geometry: { kind: 'line', x1: topX1, y1: topY1, x2: backX, y2: backY },
      paint: stroke,
    })
    pieces.push({
      // Center line
      geometry: { kind: 'line', x1: cfTipX, y1: cfTipY, x2: backX, y2: backY },
      paint: stroke,
    })
    const botX1 = cfTipX - px * fanW
    const botY1 = cfTipY - py * fanW
    pieces.push({
      // Bottom fan line
      geometry: { kind: 'line', x1: botX1, y1: botY1, x2: backX, y2: backY },
      paint: stroke,
    })
    // One-or-more: the "one" tick behind the foot (where zero-many's circle
    // sits), so `}|` and `}o` stay distinguishable at a glance.
    if (cardinality === 'many') {
      pushTickAt(point.x - ux * 20, point.y - uy * 20)
    }
  }

  // Circle (for zero variants)
  if (hasCircle) {
    const circleOffset = hasCrowsFoot ? 20 : 12
    const circleX = point.x - ux * circleOffset
    const circleY = point.y - uy * circleOffset
    pieces.push({
      geometry: { kind: 'circle', cx: circleX, cy: circleY, r: 4 },
      paint: { fill: 'var(--bg)', ...stroke },
    })
  }

  return pieces
}

/** The same emitted pieces own layout reservations and final admission. */
export function erCardinalityInk(point: ScenePoint, toward: ScenePoint, cardinality: Cardinality, lineWidth: number): readonly AxisAlignedBox[] | undefined {
  const paint = { stroke: '#000', strokeWidth: String(lineWidth + 0.25) }
  const pieces = erCardinalityPieces(point, toward, cardinality, paint)
  const bounds: AxisAlignedBox[] = []
  for (const piece of pieces) {
    const bound = nodePaintBounds({ kind: 'shape', id: 'cardinality', role: 'cardinality', geometry: piece.geometry, paint: piece.paint })
    if (!bound || !Object.values(bound).every(Number.isFinite)) return undefined
    bounds.push(bound)
  }
  return bounds
}

export function erCardinalityEnvelope(cardinality: Cardinality, lineWidth: number): AxisAlignedBox | undefined {
  const pieces = erCardinalityInk({ x: 0, y: 0 }, { x: 1, y: 0 }, cardinality, lineWidth)
  return pieces?.reduce<AxisAlignedBox | undefined>((all, piece) => unionSceneBounds(all, piece), undefined)
}

/** The renderer's exact opaque relationship pill, before palette resolution. */
export function erLabelPillGeometry(block: { width: number; height: number }, at: ScenePoint): Extract<Geometry, { kind: 'rect' }> {
  const width = block.width + 8, height = block.height + 6
  return { kind: 'rect', x: at.x - width / 2, y: at.y - height / 2, width, height, rx: 2, ry: 2 }
}

export function erLabelPillInk(block: { width: number; height: number }, at: ScenePoint): AxisAlignedBox | undefined {
  return nodePaintBounds({ kind: 'shape', id: 'label-pill', role: 'chrome', geometry: erLabelPillGeometry(block, at), paint: { fill: '#000', stroke: '#000', strokeWidth: '0.5' } })
}
