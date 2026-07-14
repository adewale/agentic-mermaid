import { measureTextWidth } from '../text-metrics.ts'
import { rotateBoxBounds, type AxisAlignedBox } from '../shared/transformed-bounds.ts'
import type { ConnectorLabelDescriptor, ConnectorMark, Geometry, MarkerDescriptor, SceneNode, ScenePoint } from './ir.ts'
import { connectorEndpointAnchors, connectorMidpoints } from './connector-geometry.ts'

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
    // Path marker geometry is intentionally not reparsed for bounds. Its
    // required marker viewport is the conservative local authority instead.
    ?? (marker.size ? { x0: 0, y0: 0, x1: marker.size.width, y1: marker.size.height } : undefined)
  if (!local) return undefined
  let refX = marker.ref?.x ?? 0
  let refY = marker.ref?.y ?? 0
  let viewportLocal = local
  if (marker.viewBox && marker.size) {
    // SVG's default preserveAspectRatio is xMidYMid meet. Normalize marker
    // coordinates into the marker viewport before applying markerUnits.
    const scale = Math.min(
      marker.size.width / marker.viewBox.width,
      marker.size.height / marker.viewBox.height,
    )
    const offsetX = (marker.size.width - marker.viewBox.width * scale) / 2
    const offsetY = (marker.size.height - marker.viewBox.height * scale) / 2
    const x = (value: number) => offsetX + (value - marker.viewBox!.x) * scale
    const y = (value: number) => offsetY + (value - marker.viewBox!.y) * scale
    viewportLocal = { x0: x(local.x0), y0: y(local.y0), x1: x(local.x1), y1: y(local.y1) }
    refX = x(refX)
    refY = y(refY)
  }
  // SVG's omitted markerUnits default is strokeWidth.
  const unitScale = (marker.units ?? 'strokeWidth') === 'strokeWidth' ? strokeWidth : 1
  const scale = Math.max(0, marker.scale ?? 1) * unitScale
  // Auto orientation may rotate around the marker ref. A radial square is a
  // conservative AABB for every tangent and avoids path parsing.
  const radius = Math.max(
    Math.abs(viewportLocal.x0 - refX), Math.abs(viewportLocal.x1 - refX),
    Math.abs(viewportLocal.y0 - refY), Math.abs(viewportLocal.y1 - refY),
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

  const anchors = connectorEndpointAnchors(node.geometry, node.route.closed)
  for (const anchor of anchors.starts) local = unionSceneBounds(local, markerBoundsAt(node.markers.start, anchor, width))!
  for (const anchor of anchors.ends) local = unionSceneBounds(local, markerBoundsAt(node.markers.end, anchor, width))!
  const interior = connectorMidpoints(node.geometry, node.route.closed)
  if (node.markers.mid.length === 1) {
    for (const anchor of interior) local = unionSceneBounds(local, markerBoundsAt(node.markers.mid[0], anchor, width))!
  } else {
    for (let index = 0; index < node.markers.mid.length; index++) {
      local = unionSceneBounds(local, markerBoundsAt(node.markers.mid[index], interior[index], width))!
    }
  }
  for (const label of node.labels) {
    if (label.bounds) local = unionSceneBounds(local, label.bounds)!
    local = unionSceneBounds(local, connectorInlineLabelVisualBounds(label))!
  }
  return local
}

/** Conservative visual box for connector-owned inline label artwork. Shared
 * with External Scene admission so a declared box cannot under-report the
 * SVG that will actually be emitted. */
export function connectorInlineLabelVisualBounds(
  label: ConnectorLabelDescriptor,
): AxisAlignedBox | undefined {
  if (label.visual?.kind !== 'inline' || !label.anchor || label.fontSize === undefined || label.textAnchor === undefined) return undefined
  const labelWidth = measureTextWidth(label.text, label.fontSize, 500)
  const x0 = label.textAnchor === 'middle'
    ? label.anchor.x - labelWidth / 2
    : label.textAnchor === 'end' ? label.anchor.x - labelWidth : label.anchor.x
  const y = label.anchor.y - Math.max(0, label.clearance ?? 0)
  const halo = Math.max(0, label.halo?.width ?? 0) / 2
  return expandSceneBounds({
    x0,
    y0: y - label.fontSize,
    x1: x0 + labelWidth,
    y1: y + label.fontSize * 0.28,
  }, halo)
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
