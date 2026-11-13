import { pointOnRoutingBoundary, shapeRoutingProfile, type ShapeRoutingBoundary } from './shape-outline.ts'
import type { Point, PositionedNode } from './types.ts'

/** Exact-outline contact must carry an outward shaft, not merely a point on
 * the far side of the node. Envelopes deliberately make no such claim. */
export function isOutwardShapeApproach(node: PositionedNode, endpoint: Point, adjacent: Point, tolerance = 1e-6): boolean | undefined {
  const boundary = shapeRoutingProfile(node).boundary
  if (boundary.kind === 'envelope' || boundary.kind === 'none') return undefined
  return outwardContact(boundary, endpoint, adjacent, tolerance)
}

function outwardContact(boundary: ShapeRoutingBoundary, endpoint: Point, adjacent: Point, tolerance: number): boolean {
  const dx = adjacent.x - endpoint.x, dy = adjacent.y - endpoint.y
  const length = Math.hypot(dx, dy)
  if (length <= 1e-9 || Math.abs(dx) > tolerance && Math.abs(dy) > tolerance) return false
  const side = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'E' : 'W' : dy > 0 ? 'S' : 'N'
  const cross = side === 'E' || side === 'W' ? endpoint.y : endpoint.x
  const contact = pointOnRoutingBoundary(boundary, side, cross)
  if (!contact || Math.hypot(contact.x - endpoint.x, contact.y - endpoint.y) > tolerance) return false
  // A tangent to a curved cap can be its extreme point on both axes without
  // departing along an outward normal (notably the top of a capsule).
  let nx = 0, ny = 0
  if (boundary.kind === 'ellipse') {
    nx = (endpoint.x - boundary.cx) / boundary.rx / boundary.rx
    ny = (endpoint.y - boundary.cy) / boundary.ry / boundary.ry
  } else if (boundary.kind === 'stadium') {
    const core = boundary.halfWidth - boundary.radius
    nx = endpoint.x - Math.max(boundary.cx - core, Math.min(boundary.cx + core, endpoint.x))
    ny = endpoint.y - boundary.cy
  } else if (boundary.kind === 'cylinder') {
    const top = boundary.y + boundary.capRadiusY, bottom = boundary.y + boundary.height - boundary.capRadiusY
    if (endpoint.y >= top && endpoint.y <= bottom) nx = endpoint.x - boundary.cx
    else {
      nx = (endpoint.x - boundary.cx) / (boundary.width / 2) / (boundary.width / 2)
      ny = (endpoint.y - (endpoint.y < top ? top : bottom)) / boundary.capRadiusY / boundary.capRadiusY
    }
  } else return true
  const normal = Math.hypot(nx, ny)
  return normal > 0 && Number.isFinite(normal) && (nx * (dx / length) + ny * (dy / length)) / normal > 0
}

function onOrInsideBoundary(boundary: ShapeRoutingBoundary, point: Point): boolean {
  if (boundary.kind === 'polygon') {
    let inside = false
    for (let i = 0, j = boundary.points.length - 1; i < boundary.points.length; j = i++) {
      const a = boundary.points[i]!, b = boundary.points[j]!
      const dx = b.x - a.x, dy = b.y - a.y
      const cross = (point.x - a.x) * dy - (point.y - a.y) * dx
      if (Math.abs(cross) <= 1e-6 * Math.hypot(dx, dy) &&
        (point.x - a.x) * (point.x - b.x) + (point.y - a.y) * (point.y - b.y) <= 1e-6) return true
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
  }
  const left = pointOnRoutingBoundary(boundary, 'W', point.y), right = pointOnRoutingBoundary(boundary, 'E', point.y)
  return Boolean(left && right && point.x >= left.x - 1e-6 && point.x <= right.x + 1e-6)
}

function hasExteriorPrefix(boundary: ShapeRoutingBoundary, a: Point, b: Point): boolean {
  if (!onOrInsideBoundary(boundary, a) || !onOrInsideBoundary(boundary, b)) return true
  if (boundary.kind !== 'polygon') return false // the other exact outlines are convex
  const dx = b.x - a.x, dy = b.y - a.y
  const vertical = Math.abs(dx) <= 1e-6
  const length = vertical ? dy : dx
  if (Math.abs(length) <= 1e-9) return false
  const cuts = [0, 1]
  for (let index = 0; index < boundary.points.length; index++) {
    const p = boundary.points[index]!, q = boundary.points[(index + 1) % boundary.points.length]!
    const hit = vertical ? intersectVertical(a.x, p, q) : intersectHorizontal(a.y, p, q)
    if (hit) {
      const t = (vertical ? hit.y - a.y : hit.x - a.x) / length
      if (t > 0 && t < 1) cuts.push(t)
    }
  }
  cuts.sort((x, y) => x - y)
  return cuts.some((cut, index) => {
    const next = cuts[index + 1]
    if (next === undefined || next - cut <= 1e-9) return false
    const t = (cut + next) / 2
    return !onOrInsideBoundary(boundary, { x: a.x + dx * t, y: a.y + dy * t })
  })
}

/** Remove only a hidden/tangent terminal prefix up to its first usable exit.
 * The retained route is an existing subpath: no corridor is invented. A valid
 * first exterior shaft returns immediately, so later excursions and self-loop
 * returns are untouched. If no exact exit exists, leave it for certification
 * to reject instead of manufacturing a port. */
export function trimOccludedShapeEndpoint(points: Point[], node: PositionedNode, isStart: boolean): Point[] {
  if (points.length < 2) return points
  const boundary = shapeRoutingProfile(node).boundary
  if (boundary.kind === 'envelope' || boundary.kind === 'none') return points
  const ordered = isStart ? points : [...points].reverse()
  const endpoint = ordered[0]!
  if (!onOrInsideBoundary(boundary, endpoint)) return points // exterior stale endpoints belong to re-anchoring
  const adjacent = ordered.find(point => Math.hypot(point.x - endpoint.x, point.y - endpoint.y) > 1e-9)
  if (!adjacent || outwardContact(boundary, endpoint, adjacent, 1e-6)) return points
  for (let index = 0; index < ordered.length - 1; index++) {
    const a = ordered[index]!, b = ordered[index + 1]!
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (length <= 1e-9) continue
    if (Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6) return points // diagonal repair owns this case
    const side = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'E' : 'W' : dy > 0 ? 'S' : 'N'
    const hit = boundary.kind === 'polygon' ? clipPolygon(a, b, boundary.points)
      : pointOnRoutingBoundary(boundary, side, side === 'E' || side === 'W' ? a.y : a.x)
    if (hit) {
      const t = ((hit.x - a.x) * dx + (hit.y - a.y) * dy) / length ** 2
      const tail = ordered.slice(index + 1)
      const next = tail.find(point => Math.hypot(point.x - hit.x, point.y - hit.y) > 1e-9)
      if (t >= -1e-9 && t <= 1 + 1e-9 && next && outwardContact(boundary, hit, next, 1e-6)) {
        if (hasExteriorPrefix(boundary, a, hit)) return points
        const trimmed = Math.hypot(hit.x - b.x, hit.y - b.y) <= 1e-9 ? tail : [hit, ...tail]
        return isStart ? trimmed : trimmed.reverse()
      }
    }
    // Once a prefix has entered exterior space it is no longer hidden. A
    // later re-entry cannot authorize erasing that excursion or a loop return.
    if (hasExteriorPrefix(boundary, a, b)) return points
  }
  return points
}

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
  if (isStart) result[0] = clipWithBoxSide(points[0]!, points[1]!, node, boundary)
  else {
    const last = points.length - 1
    result[last] = clipWithBoxSide(points[last]!, points[last - 1]!, node, boundary)
  }
  return result
}

// Only a genuine miss may fall back to the current, unambiguous box-port side.
function clipWithBoxSide(endpoint: Point, adjacent: Point, node: PositionedNode, boundary: ShapeRoutingBoundary): Point {
  const contact = clip(endpoint, adjacent, boundary)
  if (contact !== null) return contact
  const tol = 1e-6
  if (endpoint.x < node.x - tol || endpoint.x > node.x + node.width + tol
    || endpoint.y < node.y - tol || endpoint.y > node.y + node.height + tol) return endpoint
  const faces = [
    Math.abs(endpoint.y - node.y) <= tol ? 'N' as const : undefined,
    Math.abs(endpoint.y - node.y - node.height) <= tol ? 'S' as const : undefined,
    Math.abs(endpoint.x - node.x) <= tol ? 'W' as const : undefined,
    Math.abs(endpoint.x - node.x - node.width) <= tol ? 'E' as const : undefined,
  ].filter(side => side !== undefined)
  const side = faces.length === 1 ? faces[0] : undefined
  if (!side) return endpoint
  return pointOnRoutingBoundary(boundary, side, side === 'N' || side === 'S' ? endpoint.x : endpoint.y) ?? endpoint
}

function clip(endpoint: Point, adjacent: Point, boundary: ShapeRoutingBoundary): Point | null {
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
): Point | null {
  const { cx, cy, rx, ry } = ellipse
  if (rx <= 0 || ry <= 0) return null
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (vertical) {
    const dx = (endpoint.x - cx) / rx
    if (Math.abs(dx) > 1) return null
    return { x: endpoint.x, y: cy - dir * ry * Math.sqrt(Math.max(0, 1 - dx * dx)) }
  }
  const dy = (endpoint.y - cy) / ry
  if (Math.abs(dy) > 1) return null
  return { x: cx - dir * rx * Math.sqrt(Math.max(0, 1 - dy * dy)), y: endpoint.y }
}

function clipStadium(
  endpoint: Point,
  adjacent: Point,
  stadium: Extract<ShapeRoutingBoundary, { kind: 'stadium' }>,
): Point | null {
  const { cx, cy, halfWidth, radius } = stadium
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (vertical) {
    const dx = Math.abs(endpoint.x - cx)
    if (dx <= halfWidth - radius) return { x: endpoint.x, y: cy - dir * radius }
    const capX = dx - (halfWidth - radius)
    if (capX > radius) return null
    return { x: endpoint.x, y: cy - dir * Math.sqrt(Math.max(0, radius * radius - capX * capX)) }
  }
  const dy = Math.abs(endpoint.y - cy)
  if (dy > radius) return null
  return { x: cx - dir * ((halfWidth - radius) + Math.sqrt(Math.max(0, radius * radius - dy * dy))), y: endpoint.y }
}

function clipCylinder(
  endpoint: Point,
  adjacent: Point,
  cylinder: Extract<ShapeRoutingBoundary, { kind: 'cylinder' }>,
): Point | null {
  const { cx, y, width, height, capRadiusY: ry } = cylinder
  const halfWidth = width / 2
  const top = y + ry
  const bottom = y + height - ry
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (!vertical) {
    if (endpoint.y >= top && endpoint.y <= bottom) return { x: cx - dir * halfWidth, y: endpoint.y }
    const capCy = endpoint.y < top ? top : bottom
    const capY = (endpoint.y - capCy) / ry
    if (Math.abs(capY) > 1) return null
    return { x: cx - dir * halfWidth * Math.sqrt(Math.max(0, 1 - capY * capY)), y: endpoint.y }
  }
  const dx = (endpoint.x - cx) / halfWidth
  if (Math.abs(dx) > 1) return null
  const span = ry * Math.sqrt(Math.max(0, 1 - dx * dx))
  return dir > 0 ? { x: endpoint.x, y: top - span } : { x: endpoint.x, y: bottom + span }
}

function clipPolygon(endpoint: Point, adjacent: Point, points: Point[]): Point | null {
  const { vertical } = rayInfo(endpoint, adjacent)
  let best: Point | null = null
  let bestDistance = Infinity
  for (let index = 0; index < points.length; index++) {
    const first = points[index]!
    const second = points[(index + 1) % points.length]!
    // Preserve an existing boundary contact, including diagonal candidates
    // whose contact lies between polygon vertices. Route repair owns the
    // diagonal; projecting it onto an axis must not slide its valid port.
    const dx = second.x - first.x, dy = second.y - first.y
    const ex = endpoint.x - first.x, ey = endpoint.y - first.y
    if (Math.abs(ex * dy - ey * dx) < 1e-6 && ex * (endpoint.x - second.x) + ey * (endpoint.y - second.y) <= 1e-6) {
      // A far-side contact can already be on the outline while its shaft
      // crosses the node. Preserve only contacts that depart outside it.
      const length = Math.hypot(adjacent.x - endpoint.x, adjacent.y - endpoint.y)
      const step = length > 0 ? Math.min(0.0001 / length, 0.5) : 0
      const probe = { x: endpoint.x + (adjacent.x - endpoint.x) * step, y: endpoint.y + (adjacent.y - endpoint.y) * step }
      let inside = false, crosses = false
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]!, b = points[j]!
        const vx = adjacent.x - endpoint.x, vy = adjacent.y - endpoint.y
        const sx = b.x - a.x, sy = b.y - a.y, determinant = vx * sy - vy * sx
        if (Math.abs(determinant) > 1e-9) {
          const ax = a.x - endpoint.x, ay = a.y - endpoint.y
          const t = (ax * sy - ay * sx) / determinant, u = (ax * vy - ay * vx) / determinant
          if (t * length > 1e-6 && t <= 1 && u >= 0 && u <= 1) crosses = true
        }
        if ((a.y > probe.y) !== (b.y > probe.y) && probe.x < (b.x - a.x) * (probe.y - a.y) / (b.y - a.y) + a.x) inside = !inside
      }
      if (!inside && !crosses) return endpoint
    }
    const hit = vertical
      ? intersectVertical(endpoint.x, first, second)
      : intersectHorizontal(endpoint.y, first, second)
    if (!hit) continue
    const distance = Math.hypot(hit.x - adjacent.x, hit.y - adjacent.y)
    if (distance < bestDistance) { best = hit; bestDistance = distance }
  }
  return best
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
