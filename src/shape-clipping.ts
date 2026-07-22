import { shapeRoutingProfile, type ShapeRoutingBoundary } from './shape-outline.ts'
import type { Point, PositionedNode } from './types.ts'

/** Clip an ELK endpoint to the routing boundary paired with its painted shape. */
export function clipEdgeToShape(points: Point[], node: PositionedNode, isStart: boolean): Point[] {
  if (points.length < 2) return points
  const boundary = shapeRoutingProfile(node).boundary
  // ELK already routes box-shaped nodes to their exact painted boundary. A
  // second rectangle clip is not merely redundant: after node equalisation it
  // can collapse a short labelled edge without moving its label. Conservative
  // envelopes are likewise not claims about a painted outline, so they must not
  // trigger a geometric repair.
  if (boundary.kind === 'rect' || boundary.kind === 'envelope' || boundary.kind === 'none') return points
  const result = [...points]
  if (isStart) result[0] = clip(points[0]!, points[1]!, boundary)
  else {
    const last = points.length - 1
    result[last] = clip(points[last]!, points[last - 1]!, boundary)
  }
  return result
}

function clip(endpoint: Point, adjacent: Point, boundary: ShapeRoutingBoundary): Point {
  switch (boundary.kind) {
    case 'ellipse': return clipEllipse(endpoint, adjacent, boundary)
    case 'stadium': return clipStadium(endpoint, adjacent, boundary)
    case 'cylinder': return clipCylinder(endpoint, adjacent, boundary)
    case 'polygon': return clipPolygon(endpoint, adjacent, boundary.points)
    case 'rect':
    case 'envelope': return endpoint
    case 'none': return endpoint
  }
}

function rayInfo(endpoint: Point, adjacent: Point): { vertical: boolean; dir: 1 | -1 } {
  const dx = endpoint.x - adjacent.x
  const dy = endpoint.y - adjacent.y
  const vertical = Math.abs(dx) < Math.abs(dy)
  return { vertical, dir: (vertical ? dy : dx) >= 0 ? 1 : -1 }
}

function clipEllipse(
  endpoint: Point,
  adjacent: Point,
  ellipse: Extract<ShapeRoutingBoundary, { kind: 'ellipse' }>,
): Point {
  const { cx, cy, rx, ry } = ellipse
  if (rx <= 0 || ry <= 0) return endpoint
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (vertical) {
    const dx = (endpoint.x - cx) / rx
    if (Math.abs(dx) > 1) return endpoint
    return { x: endpoint.x, y: cy - dir * ry * Math.sqrt(Math.max(0, 1 - dx * dx)) }
  }
  const dy = (endpoint.y - cy) / ry
  if (Math.abs(dy) > 1) return endpoint
  return { x: cx - dir * rx * Math.sqrt(Math.max(0, 1 - dy * dy)), y: endpoint.y }
}

function clipStadium(
  endpoint: Point,
  adjacent: Point,
  stadium: Extract<ShapeRoutingBoundary, { kind: 'stadium' }>,
): Point {
  const { cx, cy, halfWidth, radius } = stadium
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (vertical) {
    const dx = Math.abs(endpoint.x - cx)
    if (dx <= halfWidth - radius) return { x: endpoint.x, y: cy - dir * radius }
    const capX = dx - (halfWidth - radius)
    if (capX > radius) return endpoint
    return { x: endpoint.x, y: cy - dir * Math.sqrt(Math.max(0, radius * radius - capX * capX)) }
  }
  const dy = Math.abs(endpoint.y - cy)
  if (dy > radius) return endpoint
  return { x: cx - dir * ((halfWidth - radius) + Math.sqrt(Math.max(0, radius * radius - dy * dy))), y: endpoint.y }
}

function clipCylinder(
  endpoint: Point,
  adjacent: Point,
  cylinder: Extract<ShapeRoutingBoundary, { kind: 'cylinder' }>,
): Point {
  const { cx, y, width, height, capRadiusY: ry } = cylinder
  const halfWidth = width / 2
  const top = y + ry
  const bottom = y + height - ry
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (!vertical) {
    if (endpoint.y >= top && endpoint.y <= bottom) return { x: cx - dir * halfWidth, y: endpoint.y }
    const capCy = endpoint.y < top ? top : bottom
    const capY = (endpoint.y - capCy) / ry
    if (Math.abs(capY) > 1) return endpoint
    return { x: cx - dir * halfWidth * Math.sqrt(Math.max(0, 1 - capY * capY)), y: endpoint.y }
  }
  const dx = (endpoint.x - cx) / halfWidth
  if (Math.abs(dx) > 1) return endpoint
  const span = ry * Math.sqrt(Math.max(0, 1 - dx * dx))
  return dir > 0 ? { x: endpoint.x, y: top - span } : { x: endpoint.x, y: bottom + span }
}

function clipPolygon(endpoint: Point, adjacent: Point, points: Point[]): Point {
  const { vertical } = rayInfo(endpoint, adjacent)
  let best: Point | null = null
  let bestDistance = Infinity
  for (let index = 0; index < points.length; index++) {
    const first = points[index]!
    const second = points[(index + 1) % points.length]!
    const hit = vertical
      ? intersectVertical(endpoint.x, first, second)
      : intersectHorizontal(endpoint.y, first, second)
    if (!hit) continue
    const distance = Math.hypot(hit.x - adjacent.x, hit.y - adjacent.y)
    if (distance < bestDistance) { best = hit; bestDistance = distance }
  }
  return best ?? endpoint
}

function intersectHorizontal(y: number, first: Point, second: Point): Point | null {
  const dy = second.y - first.y
  if (Math.abs(dy) < 1e-6) return null
  const ratio = (y - first.y) / dy
  if (ratio < 0 || ratio > 1) return null
  return { x: first.x + ratio * (second.x - first.x), y }
}

function intersectVertical(x: number, first: Point, second: Point): Point | null {
  const dx = second.x - first.x
  if (Math.abs(dx) < 1e-6) return null
  const ratio = (x - first.x) / dx
  if (ratio < 0 || ratio > 1) return null
  return { x, y: first.y + ratio * (second.y - first.y) }
}
