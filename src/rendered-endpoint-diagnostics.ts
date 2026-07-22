import type { Point, PositionedNode } from './types.ts'

/** Independent final-geometry policy. This module deliberately does not import
 * the production shape-outline authority: it is the falsifiable checker for
 * route endpoints after every producer and repair has run. */
export type RenderedEndpointPolicy = 'exact' | 'envelope' | 'none'

export interface RenderedEndpointContact {
  policy: RenderedEndpointPolicy
  onBoundary: boolean
}

const ENVELOPE_SEMANTICS = new Set([
  'cloud', 'brace', 'brace-r', 'braces', 'datastore', 'delay', 'h-cyl',
  'lin-cyl', 'curv-trap', 'doc', 'lin-doc', 'docs', 'st-rect', 'flag',
  'bow-rect', 'tag-doc',
])

/** Diagnose one endpoint against the independently restated painted geometry.
 * Open/complex shapes explicitly audit their conservative layout envelope;
 * unenclosed text declares no boundary and is therefore not misreported as an
 * exact painted contact. */
export function renderedEndpointContact(
  node: PositionedNode,
  point: Point,
  tolerance = 1.5,
): RenderedEndpointContact {
  if (node.semanticShape === 'text') return { policy: 'none', onBoundary: false }
  if (node.semanticShape && ENVELOPE_SEMANTICS.has(node.semanticShape)) {
    return { policy: 'envelope', onBoundary: onRect(point, node.x, node.y, node.width, node.height, tolerance) }
  }

  const semanticPolygon = semanticPolygonVertices(node)
  if (semanticPolygon) return { policy: 'exact', onBoundary: onPolygon(point, semanticPolygon, tolerance) }

  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const minRadius = Math.min(node.width, node.height) / 2
  if (node.semanticShape === 'fork') {
    return { policy: 'exact', onBoundary: onRect(point, node.x, cy - 4, node.width, 8, tolerance) }
  }
  if (node.semanticShape === 'sm-circ') {
    const radius = Math.min(node.width, node.height) * .22
    return { policy: 'exact', onBoundary: onEllipse(point, cx, cy, radius, radius, tolerance) }
  }
  if (node.semanticShape === 'cross-circ') {
    return { policy: 'exact', onBoundary: onEllipse(point, cx, cy, node.width / 2, node.height / 2, tolerance) }
  }
  if (node.semanticShape === 'f-circ') {
    return { policy: 'exact', onBoundary: onEllipse(point, cx, cy, minRadius, minRadius, tolerance) }
  }

  switch (node.shape) {
    case 'diamond':
    case 'state-choice': return {
      policy: 'exact',
      onBoundary: Math.abs(
        Math.abs(point.x - cx) / (node.width / 2) +
        Math.abs(point.y - cy) / (node.height / 2) - 1,
      ) * Math.min(node.width, node.height) / 2 < tolerance,
    }
    case 'circle':
    case 'doublecircle':
    case 'state-history':
      return { policy: 'exact', onBoundary: onEllipse(point, cx, cy, minRadius, minRadius, tolerance) }
    case 'state-start':
    case 'state-end': {
      const radius = Math.max(0, minRadius - 2)
      return { policy: 'exact', onBoundary: onEllipse(point, cx, cy, radius, radius, tolerance) }
    }
    case 'stadium': {
      const radius = node.height / 2
      const coreHalf = node.width / 2 - radius
      const dx = Math.abs(point.x - cx)
      const onBoundary = dx <= coreHalf
        ? Math.abs(Math.abs(point.y - cy) - radius) < tolerance
        : Math.abs(Math.hypot(dx - coreHalf, point.y - cy) - radius) < tolerance
      return { policy: 'exact', onBoundary }
    }
    case 'hexagon': {
      const inset = node.height / 4
      return { policy: 'exact', onBoundary: onPolygon(point, [
        { x: node.x + inset, y: node.y }, { x: node.x + node.width - inset, y: node.y },
        { x: node.x + node.width, y: cy }, { x: node.x + node.width - inset, y: node.y + node.height },
        { x: node.x + inset, y: node.y + node.height }, { x: node.x, y: cy },
      ], tolerance) }
    }
    case 'cylinder': return {
      policy: 'exact',
      onBoundary: onCylinder(node, point, tolerance),
    }
    case 'trapezoid':
    case 'trapezoid-alt':
    case 'lean-r':
    case 'lean-l':
    case 'asymmetric':
      return { policy: 'exact', onBoundary: onPolygon(point, basePolygonVertices(node), tolerance) }
    default:
      return { policy: 'exact', onBoundary: onRect(point, node.x, node.y, node.width, node.height, tolerance) }
  }
}

function semanticPolygonVertices(node: PositionedNode): Point[] | null {
  const { x, y, width: w, height: h } = node
  const right = x + w, bottom = y + h, cx = x + w / 2, cy = y + h / 2
  switch (node.semanticShape) {
    case 'bang': return Array.from({ length: 16 }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 8
      const radius = index % 2 === 0 ? 1 : .62
      return { x: cx + Math.cos(angle) * w / 2 * radius, y: cy + Math.sin(angle) * h / 2 * radius }
    })
    case 'notch-rect': return [{ x: x + 10, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }, { x, y: y + 10 }]
    case 'hourglass': return [{ x, y }, { x: right, y }, { x: x + w * .62, y: cy }, { x: right, y: bottom }, { x, y: bottom }, { x: x + w * .38, y: cy }]
    case 'bolt': return [{ x: x + w * .55, y }, { x: x + w * .25, y: cy }, { x: x + w * .48, y: cy }, { x: x + w * .35, y: bottom }, { x: x + w * .78, y: y + h * .4 }, { x: x + w * .55, y: y + h * .4 }]
    case 'tri': return [{ x: cx, y }, { x: right, y: bottom }, { x, y: bottom }]
    case 'notch-pent': return [{ x, y }, { x: right - 10, y }, { x: right, y: cy }, { x: right - 10, y: bottom }, { x, y: bottom }, { x: x + 8, y: cy }]
    case 'flip-tri': return [{ x, y }, { x: right, y }, { x: cx, y: bottom }]
    case 'tag-rect': return [{ x: x + 10, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }, { x, y: y + 10 }]
    default: return null
  }
}

function basePolygonVertices(node: PositionedNode): Point[] {
  const { x, y, width: w, height: h } = node
  const right = x + w, bottom = y + h, cy = y + h / 2
  const inset = w * .15
  switch (node.shape) {
    case 'trapezoid': return [{ x: x + inset, y }, { x: right - inset, y }, { x: right, y: bottom }, { x, y: bottom }]
    case 'trapezoid-alt': return [{ x, y }, { x: right, y }, { x: right - inset, y: bottom }, { x: x + inset, y: bottom }]
    case 'lean-r': return [{ x: x + inset, y }, { x: right, y }, { x: right - inset, y: bottom }, { x, y: bottom }]
    case 'lean-l': return [{ x, y }, { x: right - inset, y }, { x: right, y: bottom }, { x: x + inset, y: bottom }]
    default: return [{ x: x + 12, y }, { x: right, y }, { x: right, y: bottom }, { x: x + 12, y: bottom }, { x, y: cy }]
  }
}

function onRect(point: Point, x: number, y: number, width: number, height: number, tolerance: number): boolean {
  const onVertical = Math.abs(point.x - x) < tolerance || Math.abs(point.x - (x + width)) < tolerance
  const onHorizontal = Math.abs(point.y - y) < tolerance || Math.abs(point.y - (y + height)) < tolerance
  return (onVertical && point.y >= y - tolerance && point.y <= y + height + tolerance) ||
    (onHorizontal && point.x >= x - tolerance && point.x <= x + width + tolerance)
}

function onEllipse(point: Point, cx: number, cy: number, rx: number, ry: number, tolerance: number): boolean {
  if (rx <= 0 || ry <= 0) return false
  return Math.abs(Math.hypot((point.x - cx) / rx, (point.y - cy) / ry) - 1) * Math.min(rx, ry) < tolerance
}

function onPolygon(point: Point, vertices: readonly Point[], tolerance: number): boolean {
  let best = Infinity
  for (let index = 0; index < vertices.length; index++) {
    best = Math.min(best, pointToSegmentDistance(point, vertices[index]!, vertices[(index + 1) % vertices.length]!))
  }
  return best <= tolerance
}

function onCylinder(node: PositionedNode, point: Point, tolerance: number): boolean {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const halfWidth = node.width / 2
  const capRadius = 7
  if (point.y >= node.y + capRadius - tolerance && point.y <= node.y + node.height - capRadius + tolerance &&
    Math.abs(Math.abs(point.x - cx) - halfWidth) < tolerance) return true
  const capY = point.y < cy ? node.y + capRadius : node.y + node.height - capRadius
  return Math.abs(Math.hypot((point.x - cx) / halfWidth, (point.y - capY) / capRadius) - 1) * Math.min(halfWidth, capRadius) < tolerance * 2
}

function pointToSegmentDistance(point: Point, first: Point, second: Point): number {
  const dx = second.x - first.x, dy = second.y - first.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - first.x, point.y - first.y)
  const ratio = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (first.x + ratio * dx), point.y - (first.y + ratio * dy))
}
