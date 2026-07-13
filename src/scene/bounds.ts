import { measureTextWidth } from '../text-metrics.ts'
import { rotateBoxBounds, type AxisAlignedBox } from '../shared/transformed-bounds.ts'
import type { ConnectorMark, Geometry, MarkerDescriptor, SceneNode, ScenePoint } from './ir.ts'

function pointsBounds(points: Array<{ x: number; y: number }>): AxisAlignedBox | undefined {
  if (points.length === 0) return undefined
  return {
    x0: Math.min(...points.map(point => point.x)),
    y0: Math.min(...points.map(point => point.y)),
    x1: Math.max(...points.map(point => point.x)),
    y1: Math.max(...points.map(point => point.y)),
  }
}

export function unionSceneBounds(
  left: AxisAlignedBox | undefined,
  right: AxisAlignedBox | undefined,
): AxisAlignedBox | undefined {
  if (!left) return right
  if (!right) return left
  return {
    x0: Math.min(left.x0, right.x0),
    y0: Math.min(left.y0, right.y0),
    x1: Math.max(left.x1, right.x1),
    y1: Math.max(left.y1, right.y1),
  }
}

export function expandSceneBounds(box: AxisAlignedBox, amount: number): AxisAlignedBox {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0
  return { x0: box.x0 - safe, y0: box.y0 - safe, x1: box.x1 + safe, y1: box.y1 + safe }
}

export function geometryBounds(geometry: Geometry): AxisAlignedBox | undefined {
  switch (geometry.kind) {
    case 'rect': return { x0: geometry.x, y0: geometry.y, x1: geometry.x + geometry.width, y1: geometry.y + geometry.height }
    case 'circle': return { x0: geometry.cx - geometry.r, y0: geometry.cy - geometry.r, x1: geometry.cx + geometry.r, y1: geometry.cy + geometry.r }
    case 'ellipse': return { x0: geometry.cx - geometry.rx, y0: geometry.cy - geometry.ry, x1: geometry.cx + geometry.rx, y1: geometry.cy + geometry.ry }
    case 'line': return { x0: Math.min(geometry.x1, geometry.x2), y0: Math.min(geometry.y1, geometry.y2), x1: Math.max(geometry.x1, geometry.x2), y1: Math.max(geometry.y1, geometry.y2) }
    case 'polygon':
    case 'polyline': return pointsBounds(geometry.points)
    case 'compound': {
      const children = geometry.children.map(geometryBounds).filter((box): box is AxisAlignedBox => box !== undefined)
      if (children.length === 0) return undefined
      return {
        x0: Math.min(...children.map(box => box.x0)), y0: Math.min(...children.map(box => box.y0)),
        x1: Math.max(...children.map(box => box.x1)), y1: Math.max(...children.map(box => box.y1)),
      }
    }
    case 'path': return undefined
  }
}

function connectorAnchorPoints(node: ConnectorMark): { start?: ScenePoint; end?: ScenePoint } {
  const start = node.endpoints.start?.point
  const end = node.endpoints.end?.point
  if (start || end) return { ...(start ? { start } : {}), ...(end ? { end } : {}) }
  if (node.geometry.kind === 'line') {
    return {
      start: { x: node.geometry.x1, y: node.geometry.y1 },
      end: { x: node.geometry.x2, y: node.geometry.y2 },
    }
  }
  const points = node.geometry.points
  if (!points || points.length === 0) return {}
  return { start: points[0], end: points[points.length - 1] }
}

function markerBoundsAt(
  marker: MarkerDescriptor | undefined,
  anchor: ScenePoint | undefined,
  strokeWidth: number,
): AxisAlignedBox | undefined {
  if (!marker || !anchor) return undefined
  const local = marker.bounds
    ?? (marker.geometry ? geometryBounds(marker.geometry) : undefined)
    ?? (marker.viewBox ? {
      x0: marker.viewBox.x,
      y0: marker.viewBox.y,
      x1: marker.viewBox.x + marker.viewBox.width,
      y1: marker.viewBox.y + marker.viewBox.height,
    } : undefined)
  if (!local) return undefined
  const refX = marker.ref?.x ?? 0
  const refY = marker.ref?.y ?? 0
  const unitScale = marker.units === 'strokeWidth' ? strokeWidth : 1
  const scale = Math.max(0, marker.scale ?? 1) * unitScale
  // Auto orientation may rotate around the marker ref. A radial square is a
  // conservative AABB for every tangent and avoids path parsing.
  const radius = Math.max(
    Math.abs(local.x0 - refX), Math.abs(local.x1 - refX),
    Math.abs(local.y0 - refY), Math.abs(local.y1 - refY),
  ) * scale
  return {
    x0: anchor.x - radius,
    y0: anchor.y - radius,
    x1: anchor.x + radius,
    y1: anchor.y + radius,
  }
}

function numericStrokeWidth(width: string | number): number {
  const parsed = typeof width === 'number' ? width : parseFloat(width)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 1
}

function connectorLocalBounds(node: ConnectorMark): AxisAlignedBox | undefined {
  let local = node.geometry.kind === 'path'
    ? pointsBounds(node.geometry.points)
    : geometryBounds(node.geometry)
  if (!local) return undefined

  const width = numericStrokeWidth(node.stroke.width)
  const halfWidth = width / 2
  const joinExtent = node.stroke.lineJoin === 'miter' || node.stroke.lineJoin === 'miter-clip'
    ? halfWidth * Math.max(1, node.stroke.miterLimit)
    : halfWidth
  local = expandSceneBounds(local, joinExtent)

  const anchors = connectorAnchorPoints(node)
  local = unionSceneBounds(local, markerBoundsAt(node.markers.start, anchors.start, width))!
  local = unionSceneBounds(local, markerBoundsAt(node.markers.end, anchors.end, width))!
  const routePoints = node.geometry.kind === 'line'
    ? [{ x: node.geometry.x1, y: node.geometry.y1 }, { x: node.geometry.x2, y: node.geometry.y2 }]
    : node.geometry.points
  const interior = routePoints.slice(1, -1)
  if (node.markers.mid.length === 1) {
    for (const anchor of interior) local = unionSceneBounds(local, markerBoundsAt(node.markers.mid[0], anchor, width))!
  } else {
    for (let index = 0; index < node.markers.mid.length; index++) {
      local = unionSceneBounds(local, markerBoundsAt(node.markers.mid[index], interior[index], width))!
    }
  }
  for (const label of node.labels) {
    if (label.bounds) local = unionSceneBounds(local, label.bounds)!
  }
  return local
}

/** World-space visual bounds for typed Scene geometry. Connector paths use
 * routed source points and include stroke, endpoint markers, and label bounds. */
export function nodeWorldBounds(node: SceneNode): AxisAlignedBox | undefined {
  let local: AxisAlignedBox | undefined
  if (node.kind === 'shape') local = geometryBounds(node.geometry)
  else if (node.kind === 'connector') local = connectorLocalBounds(node)
  else if (node.kind === 'text') {
    const width = measureTextWidth(node.text, node.fontSize, 500)
    const x0 = node.anchor === 'middle' ? node.x - width / 2 : node.anchor === 'end' ? node.x - width : node.x
    local = { x0, y0: node.y - node.fontSize, x1: x0 + width, y1: node.y + node.fontSize * 0.28 }
  } else return undefined
  if (!local || !node.transform) return local
  if (node.transform.kind === 'rotate') {
    return rotateBoxBounds(local, { x: node.transform.cx, y: node.transform.cy }, node.transform.angle)
  }
  return local
}
