/**
 * Shape-aware edge clipping utilities.
 *
 * ELK.js treats all nodes as rectangles for edge routing. For non-rectangular
 * shapes like diamonds, this causes edges to terminate at the bounding box
 * boundary instead of the actual shape vertices.
 *
 * This module provides utilities to clip edge endpoints to actual shape
 * boundaries after ELK layout is complete.
 */

import type { Point, PositionedNode } from './types.ts'

/**
 * Clip an edge endpoint to the actual shape boundary of a node.
 *
 * @param points - The edge points array
 * @param node - The node to clip to
 * @param isStart - True if clipping the start point (source), false for end (target)
 * @returns New points array with clipped endpoint
 */
export function clipEdgeToShape(
  points: Point[],
  node: PositionedNode,
  isStart: boolean
): Point[] {
  if (points.length < 2) return points

  // Only clip non-rectangular shapes
  if (node.shape === 'rectangle' || node.shape === 'service' || node.shape === 'rounded' || node.shape === 'subroutine') {
    return points
  }

  const result = [...points]
  const clip = (endpoint: Point, adjacent: Point): Point => {
    switch (node.shape) {
      case 'diamond': return clipToDiamond(endpoint, adjacent, node)
      case 'circle':
      case 'doublecircle':
      case 'state-start':
      case 'state-end': return clipToEllipse(endpoint, adjacent, node)
      case 'stadium': return clipToStadium(endpoint, adjacent, node)
      case 'hexagon': return clipToHexagon(endpoint, adjacent, node)
      case 'cylinder': return clipToCylinder(endpoint, adjacent, node)
      case 'trapezoid':
      case 'trapezoid-alt':
      case 'lean-r':
      case 'lean-l':
      case 'asymmetric': return clipToConvexPolygon(endpoint, adjacent, slantedShapePolygon(node))
      default: return endpoint
    }
  }

  if (isStart) {
    result[0] = clip(points[0]!, points[1]!)
  } else {
    const lastIdx = points.length - 1
    result[lastIdx] = clip(points[lastIdx]!, points[lastIdx - 1]!)
  }

  return result
}

// ---------------------------------------------------------------------------
// Outline clippers for the symmetric shapes. Each extends the edge's final
// orthogonal segment as a ray and finds where it meets the rendered outline,
// preserving orthogonality — ELK only knows the bounding box, so an endpoint
// that is not at a side midpoint would otherwise float off the curve.
// ---------------------------------------------------------------------------

function rayInfo(endpoint: Point, adjacent: Point): { vertical: boolean; dir: 1 | -1 } {
  const dx = endpoint.x - adjacent.x
  const dy = endpoint.y - adjacent.y
  const vertical = Math.abs(dx) < Math.abs(dy)
  return { vertical, dir: (vertical ? dy : dx) >= 0 ? 1 : -1 }
}

/** Ellipse inscribed in the bbox (circle when square). */
function clipToEllipse(endpoint: Point, adjacent: Point, node: PositionedNode): Point {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const rx = node.width / 2
  const ry = node.height / 2
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (vertical) {
    const dx = (endpoint.x - cx) / rx
    if (Math.abs(dx) > 1) return endpoint
    const span = ry * Math.sqrt(1 - dx * dx)
    // Entering downward hits the top half; upward hits the bottom half.
    return { x: endpoint.x, y: cy - dir * span }
  }
  const dy = (endpoint.y - cy) / ry
  if (Math.abs(dy) > 1) return endpoint
  const span = rx * Math.sqrt(1 - dy * dy)
  return { x: cx - dir * span, y: endpoint.y }
}

/** Flat top/bottom, semicircular ends of radius h/2. */
function clipToStadium(endpoint: Point, adjacent: Point, node: PositionedNode): Point {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const hw = node.width / 2
  const r = node.height / 2
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (vertical) {
    const dx = Math.abs(endpoint.x - cx)
    if (dx <= hw - r) return { x: endpoint.x, y: cy - dir * r }
    const ax = dx - (hw - r)
    if (ax > r) return endpoint
    return { x: endpoint.x, y: cy - dir * Math.sqrt(r * r - ax * ax) }
  }
  const dy = Math.abs(endpoint.y - cy)
  if (dy > r) return endpoint
  const span = (hw - r) + Math.sqrt(r * r - dy * dy)
  return { x: cx - dir * span, y: endpoint.y }
}

/** Six-gon: flat top/bottom inset by h/4, pointy E/W tips at mid-height. */
function clipToHexagon(endpoint: Point, adjacent: Point, node: PositionedNode): Point {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const hw = node.width / 2
  const hh = node.height / 2
  const inset = node.height / 4
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (vertical) {
    const dx = Math.abs(endpoint.x - cx)
    if (dx <= hw - inset) return { x: endpoint.x, y: cy - dir * hh }
    // Slanted corner: |dy| = hh * (1 - (dx - (hw - inset)) / inset)
    const t = (dx - (hw - inset)) / inset
    if (t > 1) return endpoint
    return { x: endpoint.x, y: cy - dir * hh * (1 - t) }
  }
  const dy = Math.abs(endpoint.y - cy)
  if (dy > hh) return endpoint
  // |dx| at this height: flat region ends at hw - inset, tip at hw.
  const span = dy >= 0 ? hw - inset * (dy / hh) : hw
  return { x: cx - dir * span, y: endpoint.y }
}

/** Vertical walls; elliptical caps of vertical radius 7 (renderer geometry). */
function clipToCylinder(endpoint: Point, adjacent: Point, node: PositionedNode): Point {
  const RY = 7
  const cx = node.x + node.width / 2
  const hw = node.width / 2
  const top = node.y + RY
  const bottom = node.y + node.height - RY
  const { vertical, dir } = rayInfo(endpoint, adjacent)
  if (!vertical) {
    if (endpoint.y >= top && endpoint.y <= bottom) {
      return { x: cx - dir * hw, y: endpoint.y } // straight wall
    }
    // Above/below the walls the horizontal ray meets a cap ellipse; keep the
    // ray's own y so the segment stays orthogonal.
    const capCy = endpoint.y < top ? top : bottom
    const dyCap = (endpoint.y - capCy) / RY
    if (Math.abs(dyCap) > 1) return endpoint
    const span = hw * Math.sqrt(1 - dyCap * dyCap)
    return { x: cx - dir * span, y: endpoint.y }
  }
  const dx = (endpoint.x - cx) / hw
  if (Math.abs(dx) > 1) return endpoint
  const span = RY * Math.sqrt(1 - dx * dx)
  return dir > 0
    ? { x: endpoint.x, y: top - span }      // entering downward: top cap
    : { x: endpoint.x, y: bottom + span }   // entering upward: bottom cap
}

/**
 * Rendered polygon outlines of the slanted shapes (renderer geometry: the
 * trapezoids and parallelograms shear by w * 0.15, the asymmetric flag
 * indents its left point by 12px).
 */
function slantedShapePolygon(node: PositionedNode): Point[] {
  const { x, y, width: w, height: h } = node
  const inset = w * 0.15
  switch (node.shape) {
    case 'trapezoid': // wider bottom
      return [{ x: x + inset, y }, { x: x + w - inset, y }, { x: x + w, y: y + h }, { x, y: y + h }]
    case 'trapezoid-alt': // wider top
      return [{ x, y }, { x: x + w, y }, { x: x + w - inset, y: y + h }, { x: x + inset, y: y + h }]
    case 'lean-r': // parallelogram leaning right
      return [{ x: x + inset, y }, { x: x + w, y }, { x: x + w - inset, y: y + h }, { x, y: y + h }]
    case 'lean-l': // parallelogram leaning left
      return [{ x, y }, { x: x + w - inset, y }, { x: x + w, y: y + h }, { x: x + inset, y: y + h }]
    case 'asymmetric': // flag with a pointed left edge
      return [{ x: x + 12, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x: x + 12, y: y + h }, { x, y: y + h / 2 }]
    default:
      return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  }
}

/**
 * Generic convex-polygon clipper: extend the edge's final orthogonal segment
 * as a ray and keep the polygon-boundary intersection nearest the OUTSIDE
 * endpoint (`adjacent`) — the entry point into the shape. Like clipToDiamond
 * this preserves orthogonality: the ray's own fixed coordinate is kept and
 * only the coordinate along the ray moves onto the outline. Returns the
 * endpoint unchanged when the ray misses the polygon.
 */
function clipToConvexPolygon(endpoint: Point, adjacent: Point, verts: Point[]): Point {
  const { vertical } = rayInfo(endpoint, adjacent)
  let best: Point | null = null
  let bestDist = Infinity
  for (let i = 0; i < verts.length; i++) {
    const p1 = verts[i]!
    const p2 = verts[(i + 1) % verts.length]!
    const hit = vertical
      ? intersectVerticalRayWithEdge(endpoint.x, p1, p2)
      : intersectHorizontalRayWithEdge(endpoint.y, p1, p2)
    if (!hit) continue
    const d = Math.hypot(hit.x - adjacent.x, hit.y - adjacent.y)
    if (d < bestDist) {
      bestDist = d
      best = hit
    }
  }
  return best ?? endpoint
}

/**
 * Clip a point to the diamond shape boundary using ray-polygon intersection.
 *
 * Diamond vertices are at the midpoints of the bounding box sides:
 * - Top: (cx, y)
 * - Right: (x + w, cy)
 * - Bottom: (cx, y + h)
 * - Left: (x, cy)
 *
 * For orthogonal edges, we extend the final segment as a ray and find where
 * it intersects the diamond boundary. This preserves orthogonality while
 * ensuring the edge terminates at the actual diamond shape.
 *
 * @param endpoint - The edge endpoint to clip
 * @param adjacent - The adjacent point (to determine ray direction)
 * @param node - The diamond node
 * @returns Clipped point on the diamond boundary
 */
function clipToDiamond(endpoint: Point, adjacent: Point, node: PositionedNode): Point {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const halfW = node.width / 2
  const halfH = node.height / 2

  // Diamond vertices
  const top: Point = { x: cx, y: node.y }
  const right: Point = { x: node.x + node.width, y: cy }
  const bottom: Point = { x: cx, y: node.y + node.height }
  const left: Point = { x: node.x, y: cy }

  // Determine approach direction from adjacent point
  const dx = endpoint.x - adjacent.x
  const dy = endpoint.y - adjacent.y

  // For orthogonal edges, one of dx or dy will be ~0
  const isVertical = Math.abs(dx) < Math.abs(dy)

  if (isVertical) {
    // Vertical ray at x = endpoint.x
    const rayX = endpoint.x

    if (dy > 0) {
      // Coming from above (moving down) → intersect with top half of diamond
      // Top half edges: left-top (left → top) and top-right (top → right)
      if (rayX <= cx) {
        // Intersect with left-top edge (from left vertex to top vertex)
        return intersectVerticalRayWithEdge(rayX, left, top) ?? top
      } else {
        // Intersect with top-right edge (from top vertex to right vertex)
        return intersectVerticalRayWithEdge(rayX, top, right) ?? top
      }
    } else {
      // Coming from below (moving up) → intersect with bottom half of diamond
      // Bottom half edges: left-bottom (bottom → left) and bottom-right (right → bottom)
      if (rayX <= cx) {
        // Intersect with bottom-left edge (from bottom vertex to left vertex)
        return intersectVerticalRayWithEdge(rayX, bottom, left) ?? bottom
      } else {
        // Intersect with bottom-right edge (from right vertex to bottom vertex)
        return intersectVerticalRayWithEdge(rayX, right, bottom) ?? bottom
      }
    }
  } else {
    // Horizontal ray at y = endpoint.y
    const rayY = endpoint.y

    if (dx > 0) {
      // Coming from left (moving right) → intersect with left half of diamond
      // Left half edges: top-left (top → left) and left-bottom (left → bottom)
      if (rayY <= cy) {
        // Intersect with top-left edge (from top vertex to left vertex)
        return intersectHorizontalRayWithEdge(rayY, top, left) ?? left
      } else {
        // Intersect with left-bottom edge (from left vertex to bottom vertex)
        return intersectHorizontalRayWithEdge(rayY, left, bottom) ?? left
      }
    } else {
      // Coming from right (moving left) → intersect with right half of diamond
      // Right half edges: top-right (top → right) and right-bottom (right → bottom)
      if (rayY <= cy) {
        // Intersect with top-right edge (from top vertex to right vertex)
        return intersectHorizontalRayWithEdge(rayY, top, right) ?? right
      } else {
        // Intersect with right-bottom edge (from right vertex to bottom vertex)
        return intersectHorizontalRayWithEdge(rayY, right, bottom) ?? right
      }
    }
  }
}

/**
 * Find intersection of a horizontal ray (y = rayY) with a line segment.
 * Returns the intersection point or null if no intersection.
 */
function intersectHorizontalRayWithEdge(rayY: number, p1: Point, p2: Point): Point | null {
  const dy = p2.y - p1.y
  if (Math.abs(dy) < 0.001) {
    // Edge is horizontal, no single intersection
    return null
  }

  const t = (rayY - p1.y) / dy
  if (t < 0 || t > 1) {
    // Intersection outside the edge segment
    return null
  }

  const x = p1.x + t * (p2.x - p1.x)
  return { x, y: rayY }
}

/**
 * Find intersection of a vertical ray (x = rayX) with a line segment.
 * Returns the intersection point or null if no intersection.
 */
function intersectVerticalRayWithEdge(rayX: number, p1: Point, p2: Point): Point | null {
  const dx = p2.x - p1.x
  if (Math.abs(dx) < 0.001) {
    // Edge is vertical, no single intersection
    return null
  }

  const t = (rayX - p1.x) / dx
  if (t < 0 || t > 1) {
    // Intersection outside the edge segment
    return null
  }

  const y = p1.y + t * (p2.y - p1.y)
  return { x: rayX, y }
}
