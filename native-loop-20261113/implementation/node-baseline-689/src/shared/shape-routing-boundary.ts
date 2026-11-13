import type { Point, PortSide } from '../types.ts'

/** Boundary consumed by routing. `envelope` is an explicit conservative
 * contract for open/decorated Bezier symbols; it is never presented as the
 * painted silhouette. */
export type ShapeRoutingBoundary =
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'stadium'; cx: number; cy: number; halfWidth: number; radius: number }
  | { kind: 'cylinder'; cx: number; y: number; width: number; height: number; capRadiusY: number }
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'envelope'; x: number; y: number; width: number; height: number; reason: string }
  | { kind: 'none'; reason: string }

/** Maximum vertex reserve shared with the shape owner's dynamic-side policy. */
export const DIAMOND_VERTEX_MARGIN = 10

/** The canonical painted polygon; retain its established arithmetic order. */
export function cardinalDiamondPoints(cx: number, cy: number, width: number, height: number): Point[] {
  return [
    { x: cx, y: cy - height / 2 }, { x: cx + width / 2, y: cy },
    { x: cx, y: cy + height / 2 }, { x: cx - width / 2, y: cy },
  ]
}

/** Exact boundary intersection, independent of preferred attachment policies. */
export function pointOnRoutingBoundary(boundary: ShapeRoutingBoundary, side: PortSide, crossCoordinate: number): Point | null {
  return boundaryIntersection(boundary, side === 'E' || side === 'W' ? 'x' : 'y', crossCoordinate, side === 'E' || side === 'S')
}

export function routingBounds(boundary: ShapeRoutingBoundary): { x: number; y: number; width: number; height: number } | null {
  switch (boundary.kind) {
    case 'rect':
    case 'envelope': return { x: boundary.x, y: boundary.y, width: boundary.width, height: boundary.height }
    case 'ellipse': return { x: boundary.cx - boundary.rx, y: boundary.cy - boundary.ry, width: boundary.rx * 2, height: boundary.ry * 2 }
    case 'stadium': return { x: boundary.cx - boundary.halfWidth, y: boundary.cy - boundary.radius, width: boundary.halfWidth * 2, height: boundary.radius * 2 }
    case 'cylinder': return { x: boundary.cx - boundary.width / 2, y: boundary.y, width: boundary.width, height: boundary.height }
    case 'polygon': {
      if (boundary.points.length === 0) return null
      const xs = boundary.points.map(point => point.x)
      const ys = boundary.points.map(point => point.y)
      const x = Math.min(...xs), y = Math.min(...ys)
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
    }
    case 'none': return null
  }
}

export function boundaryIntersection(
  boundary: ShapeRoutingBoundary,
  mainAxis: 'x' | 'y',
  cross: number,
  positive: boolean,
): Point | null {
  const choose = (values: number[]): number | null => values.length === 0 ? null : (positive ? Math.max(...values) : Math.min(...values))
  const point = (main: number): Point => mainAxis === 'x' ? { x: main, y: cross } : { x: cross, y: main }
  switch (boundary.kind) {
    case 'rect':
    case 'envelope': {
      const lo = mainAxis === 'x' ? boundary.y : boundary.x
      const hi = lo + (mainAxis === 'x' ? boundary.height : boundary.width)
      if (cross < lo - 1e-9 || cross > hi + 1e-9) return null
      return point(mainAxis === 'x'
        ? (positive ? boundary.x + boundary.width : boundary.x)
        : (positive ? boundary.y + boundary.height : boundary.y))
    }
    case 'ellipse': {
      const crossCenter = mainAxis === 'x' ? boundary.cy : boundary.cx
      const crossRadius = mainAxis === 'x' ? boundary.ry : boundary.rx
      const mainCenter = mainAxis === 'x' ? boundary.cx : boundary.cy
      const mainRadius = mainAxis === 'x' ? boundary.rx : boundary.ry
      if (crossRadius <= 0 || mainRadius <= 0) return null
      const scaled = (cross - crossCenter) / crossRadius
      if (Math.abs(scaled) > 1 + 1e-9) return null
      return point(mainCenter + (positive ? 1 : -1) * mainRadius * Math.sqrt(Math.max(0, 1 - scaled * scaled)))
    }
    case 'stadium': {
      if (mainAxis === 'x') {
        const dy = cross - boundary.cy
        if (Math.abs(dy) > boundary.radius + 1e-9) return null
        const main = (boundary.halfWidth - boundary.radius) + Math.sqrt(Math.max(0, boundary.radius ** 2 - dy ** 2))
        return point(boundary.cx + (positive ? main : -main))
      }
      const dx = Math.abs(cross - boundary.cx)
      if (dx > boundary.halfWidth + 1e-9) return null
      const capX = Math.max(0, dx - (boundary.halfWidth - boundary.radius))
      return point(boundary.cy + (positive ? 1 : -1) * Math.sqrt(Math.max(0, boundary.radius ** 2 - capX ** 2)))
    }
    case 'cylinder': {
      const halfWidth = boundary.width / 2
      const top = boundary.y + boundary.capRadiusY
      const bottom = boundary.y + boundary.height - boundary.capRadiusY
      if (mainAxis === 'x') {
        if (cross < boundary.y - 1e-9 || cross > boundary.y + boundary.height + 1e-9) return null
        const capCenter = cross < top ? top : cross > bottom ? bottom : cross
        const scaled = capCenter === cross ? 0 : (cross - capCenter) / boundary.capRadiusY
        return point(boundary.cx + (positive ? 1 : -1) * halfWidth * Math.sqrt(Math.max(0, 1 - scaled * scaled)))
      }
      const scaled = (cross - boundary.cx) / halfWidth
      if (Math.abs(scaled) > 1 + 1e-9) return null
      const span = boundary.capRadiusY * Math.sqrt(Math.max(0, 1 - scaled * scaled))
      return point(positive ? bottom + span : top - span)
    }
    case 'polygon': {
      const values: number[] = []
      for (let index = 0; index < boundary.points.length; index++) {
        const first = boundary.points[index]!
        const second = boundary.points[(index + 1) % boundary.points.length]!
        const firstCross = mainAxis === 'x' ? first.y : first.x
        const secondCross = mainAxis === 'x' ? second.y : second.x
        const firstMain = first[mainAxis], secondMain = second[mainAxis]
        const delta = secondCross - firstCross
        if (Math.abs(delta) < 1e-9) {
          if (Math.abs(cross - firstCross) < 1e-9) values.push(firstMain, secondMain)
          continue
        }
        const ratio = (cross - firstCross) / delta
        if (ratio >= -1e-9 && ratio <= 1 + 1e-9) values.push(firstMain + ratio * (secondMain - firstMain))
      }
      const main = choose(values)
      return main === null ? null : point(main)
    }
    case 'none': return null
  }
}

