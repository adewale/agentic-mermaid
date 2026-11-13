export interface Point2D { x: number; y: number }
export interface AxisAlignedBox { x0: number; y0: number; x1: number; y1: number }

/** Rotate one point around a pivot in SVG's clockwise-positive coordinate space. */
export function rotatePoint(point: Point2D, pivot: Point2D, angleDegrees: number): Point2D {
  const radians = angleDegrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  }
}

/** Smallest world-space AABB containing all corners of a rotated local box. */
export function rotateBoxBounds(box: AxisAlignedBox, pivot: Point2D, angleDegrees: number): AxisAlignedBox {
  if (angleDegrees % 360 === 0) return { ...box }
  const points = [
    rotatePoint({ x: box.x0, y: box.y0 }, pivot, angleDegrees),
    rotatePoint({ x: box.x1, y: box.y0 }, pivot, angleDegrees),
    rotatePoint({ x: box.x0, y: box.y1 }, pivot, angleDegrees),
    rotatePoint({ x: box.x1, y: box.y1 }, pivot, angleDegrees),
  ]
  return {
    x0: Math.min(...points.map(point => point.x)),
    y0: Math.min(...points.map(point => point.y)),
    x1: Math.max(...points.map(point => point.x)),
    y1: Math.max(...points.map(point => point.y)),
  }
}
