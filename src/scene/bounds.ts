import { tryParseCssColor } from '../shared/color-math.ts'
import { rotateBoxBounds, type AxisAlignedBox } from '../shared/transformed-bounds.ts'
import type { ConnectorLabelDescriptor, ConnectorMark, Geometry, MarkPaint, MarkerDescriptor, SceneNode, ScenePoint, SceneTransform } from './ir.ts'
import { connectorEndpointAnchors, connectorMidpoints } from './connector-geometry.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { composeMatrices, inverseMatrix, transformMatrix, transformPoint } from './transforms.ts'

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

/** Conservative bounds from the typed path authority, never from serialized
 * SVG. Béziers stay inside their control hull; arcs stay inside their complete
 * rotated ellipse. Invalid input has no bound, rather than a partial one. */
function pathBounds(d: string): AxisAlignedBox | undefined {
  const number = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
  let index = 0, x = 0, y = 0, startX = 0, startY = 0
  let command = '', previous = ''
  let control: ScenePoint | undefined
  let result: AxisAlignedBox | undefined
  const skip = (): void => { while (index < d.length && /[\s,]/.test(d[index]!)) index++ }
  const read = (flag = false): number | undefined => {
    skip()
    if (flag) {
      const value = d[index]
      if (value !== '0' && value !== '1') return undefined
      index++
      return Number(value)
    }
    number.lastIndex = index
    const match = number.exec(d)
    if (!match) return undefined
    index = number.lastIndex
    const value = Number(match[0])
    return Number.isFinite(value) ? value : undefined
  }
  const include = (px: number, py: number): boolean => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false
    result = unionSceneBounds(result, { x0: px, y0: py, x1: px, y1: py })
    return true
  }
  while (true) {
    skip()
    if (index >= d.length) return result
    if (/[a-zA-Z]/.test(d[index]!)) {
      command = d[index++]!
      if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(command) || (!result && command.toUpperCase() !== 'M')) return undefined
      if (command.toUpperCase() === 'Z') {
        x = startX; y = startY; previous = 'Z'; control = undefined; command = ''
        continue
      }
    }
    if (!command) return undefined
    const upper = command.toUpperCase(), relative = command !== upper
    const count = upper === 'A' ? 7 : upper === 'C' ? 6 : upper === 'S' || upper === 'Q' ? 4 : upper === 'H' || upper === 'V' ? 1 : 2
    const args: number[] = []
    for (let i = 0; i < count; i++) {
      const value = read(upper === 'A' && (i === 3 || i === 4))
      if (value === undefined) return undefined
      args.push(value)
    }
    const px = (i: number): number => args[i]! + (relative ? x : 0)
    const py = (i: number): number => args[i]! + (relative ? y : 0)
    let nextX: number, nextY: number, nextControl: ScenePoint | undefined
    if (upper === 'H') { nextX = px(0); nextY = y }
    else if (upper === 'V') { nextX = x; nextY = py(0) }
    else if (upper === 'C' || upper === 'S' || upper === 'Q' || upper === 'T') {
      const reflected = control && (upper === 'S' ? previous === 'C' || previous === 'S' : previous === 'Q' || previous === 'T')
        ? { x: 2 * x - control.x, y: 2 * y - control.y } : { x, y }
      if ((upper === 'S' || upper === 'T') && !include(reflected.x, reflected.y)) return undefined
      for (let i = 0; i < count - 2; i += 2) if (!include(px(i), py(i + 1))) return undefined
      nextX = px(count - 2); nextY = py(count - 1)
      nextControl = upper === 'T' ? reflected : { x: px(count - 4), y: py(count - 3) }
    } else if (upper === 'A') {
      nextX = px(5); nextY = py(6)
      let rx = Math.abs(args[0]!), ry = Math.abs(args[1]!)
      if (rx > 0 && ry > 0 && (nextX !== x || nextY !== y)) {
        const angle = args[2]! % 360 * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
        const dx = (x - nextX) / 2, dy = (y - nextY) / 2
        const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy
        const correction = Math.hypot(xp / rx, yp / ry)
        if (correction > 1) { rx *= correction; ry *= correction }
        const ratio = (xp / rx) ** 2 + (yp / ry) ** 2
        const factor = (args[3] === args[4] ? -1 : 1) * Math.sqrt(Math.max(0, (1 - ratio) / ratio))
        const cxp = factor * rx * yp / ry, cyp = -factor * ry * xp / rx
        const cx = cos * cxp - sin * cyp + (x + nextX) / 2
        const cy = sin * cxp + cos * cyp + (y + nextY) / 2
        const extentX = Math.hypot(rx * cos, ry * sin), extentY = Math.hypot(rx * sin, ry * cos)
        if (!include(cx - extentX, cy - extentY) || !include(cx + extentX, cy + extentY)) return undefined
      }
    } else {
      nextX = px(0); nextY = py(1)
      if (upper === 'M') { startX = nextX; startY = nextY; command = relative ? 'l' : 'L' }
    }
    if (!include(nextX, nextY)) return undefined
    x = nextX; y = nextY; control = nextControl; previous = upper
  }
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
      const children = geometry.children.map(geometryBounds)
      if (children.length === 0 || children.some(box => box === undefined)) return undefined
      const measured = children as AxisAlignedBox[]
      return {
        x0: Math.min(...measured.map(box => box.x0)), y0: Math.min(...measured.map(box => box.y0)),
        x1: Math.max(...measured.map(box => box.x1)), y1: Math.max(...measured.map(box => box.y1)),
      }
    }
    case 'path': return pathBounds(geometry.d)
  }
}

function markerBoundsAt(
  marker: MarkerDescriptor | undefined,
  anchor: ScenePoint | undefined,
  strokeWidth: number,
  painted = false,
  angle?: number,
): AxisAlignedBox | undefined {
  if (!marker || !anchor) return undefined
  const geometry = marker.geometry ? geometryBounds(marker.geometry) : undefined
  if (painted && marker.geometry && !geometry) return undefined
  let local = marker.bounds
    ?? geometry
    ?? (marker.viewBox ? {
      x0: marker.viewBox.x,
      y0: marker.viewBox.y,
      x1: marker.viewBox.x + marker.viewBox.width,
      y1: marker.viewBox.y + marker.viewBox.height,
    } : undefined)
    ?? (marker.size ? { x0: 0, y0: 0, x1: marker.size.width, y1: marker.size.height } : undefined)
  if (!local) return undefined
  if (painted) {
    local = unionSceneBounds(local, geometry)!
    const extent = paintedStrokeExtent(marker.paint ?? {}, true)
    if (extent === undefined) return undefined
    local = expandSceneBounds(local, extent)
  }
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
  const scale = Math.max(painted ? 1 : 0, marker.scale ?? 1) * unitScale
  if (angle !== undefined) {
    const radians = angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians)
    const corners = [[viewportLocal.x0, viewportLocal.y0], [viewportLocal.x0, viewportLocal.y1], [viewportLocal.x1, viewportLocal.y0], [viewportLocal.x1, viewportLocal.y1]]
      .map(([x, y]) => ({ x: anchor.x + ((x! - refX) * cosine - (y! - refY) * sine) * scale, y: anchor.y + ((x! - refX) * sine + (y! - refY) * cosine) * scale }))
    return corners.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ? pointsBounds(corners) : undefined
  }
  // Auto orientation may rotate around the marker ref. A radial square is a
  // conservative AABB for every tangent and avoids path parsing.
  const extentX = Math.max(Math.abs(viewportLocal.x0 - refX), Math.abs(viewportLocal.x1 - refX))
  const extentY = Math.max(Math.abs(viewportLocal.y0 - refY), Math.abs(viewportLocal.y1 - refY))
  const radius = (painted ? Math.hypot(extentX, extentY) : Math.max(extentX, extentY)) * scale
  return {
    x0: anchor.x - radius,
    y0: anchor.y - radius,
    x1: anchor.x + radius,
    y1: anchor.y + radius,
  }
}

export interface ConnectorMarkerPaintRegion {
  position: 'start' | 'mid' | 'end'
  resource: string
  anchor: ScenePoint
  repaint: string
  bounds?: AxisAlignedBox
}

/** Individual marker occurrences from the native connector authority. */
export function connectorMarkerPaintRegions(node: ConnectorMark, parentTransform?: SceneTransform): ConnectorMarkerPaintRegion[] {
  const geometry = node.route.geometry, endpoints = connectorEndpointAnchors(geometry, node.route.closed)
  const mids = connectorMidpoints(geometry, node.route.closed)
  const transform = composedTransform(parentTransform, node.transform)
  const result: ConnectorMarkerPaintRegion[] = []
  const include = (position: ConnectorMarkerPaintRegion['position'], marker: MarkerDescriptor | undefined, anchor: ScenePoint | undefined, tangent?: ScenePoint): void => {
    if (!marker || !anchor) return
    const angle = typeof marker.orient === 'number' ? marker.orient : marker.orient === undefined ? 0 : tangent ? Math.atan2(tangent.y, tangent.x) * 180 / Math.PI + (position === 'start' && marker.orient === 'auto-start-reverse' ? 180 : 0) : undefined
    const strokeWidth = numericStrokeWidth(node.stroke.width)
    const local = markerBoundsAt(marker, anchor, strokeWidth, true, angle)
    const matrix = transformMatrix(transform)
    // Equality is about the actual resource, orientation, unit scale and
    // composed linear transform, rather than an owner or resource count.
    const repaint = JSON.stringify([marker, angle ?? ['unknown', geometry], marker.units === 'userSpaceOnUse' ? 1 : strokeWidth, matrix.slice(0, 4)])
    result.push({ position, resource: marker.id, anchor: transformPoint(anchor, matrix), repaint, ...(local ? { bounds: transformedBounds(local, transform) } : {}) })
  }
  endpoints.starts.forEach((anchor, index) => include('start', node.markers.start, anchor, node.route.contours[index]?.startTangent))
  endpoints.ends.forEach((anchor, index) => include('end', node.markers.end, anchor, node.route.contours[index]?.endTangent))
  if (node.markers.mid.length === 1) for (const anchor of mids) include('mid', node.markers.mid[0], anchor)
  else node.markers.mid.forEach((marker, index) => include('mid', marker, mids[index]))
  return result
}

function numericStrokeWidth(width: string | number): number {
  const parsed = typeof width === 'number' ? width : parseFloat(width)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 1
}

function connectorLocalBounds(node: ConnectorMark): AxisAlignedBox | undefined {
  const geometry = node.route.geometry
  let local = geometry.kind === 'path'
    ? pointsBounds(geometry.points)
    : geometryBounds(geometry)
  if (!local) return undefined

  const width = numericStrokeWidth(node.stroke.width)
  const halfWidth = width / 2
  const joinExtent = node.stroke.lineJoin === 'miter' || node.stroke.lineJoin === 'miter-clip'
    ? halfWidth * Math.max(1, node.stroke.miterLimit)
    : halfWidth
  local = expandSceneBounds(local, joinExtent)

  const anchors = connectorEndpointAnchors(geometry, node.route.closed)
  for (const anchor of anchors.starts) local = unionSceneBounds(local, markerBoundsAt(node.markers.start, anchor, width))!
  for (const anchor of anchors.ends) local = unionSceneBounds(local, markerBoundsAt(node.markers.end, anchor, width))!
  const interior = connectorMidpoints(geometry, node.route.closed)
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

const connectorLabelBlocks = new WeakMap<ConnectorLabelDescriptor, PixelTextBlock>()

/** One prepared text authority for connector-owned emission and visual bounds.
 * Default literal interpretation preserves External Scene v1's escaped text. */
export function connectorInlineLabelText(label: ConnectorLabelDescriptor): PixelTextBlock {
  const input = resolveLabelContent(label.text, label.textContent)
  const source = typeof input === 'string' ? input : input.source
  if (label.block) {
    const block = label.block
    if (block.prepared.source !== source
      || (label.fontSize !== undefined && label.fontSize !== block.fontSize)
      || (label.fontWeight !== undefined && label.fontWeight !== block.fontWeight)
      || (label.letterSpacing !== undefined && label.letterSpacing !== block.letterSpacing)
      || (label.display !== undefined && label.display !== block.prepared.display)) {
      throw new TypeError('Connector inline label typography and source must agree with its prepared block')
    }
    return block
  }
  const fontSize = label.fontSize ?? 12
  const fontWeight = label.fontWeight ?? 400
  const letterSpacing = label.letterSpacing ?? 0
  const display = label.display ?? 'literal'
  const prior = connectorLabelBlocks.get(label)
  if (prior && (typeof input === 'string' ? prior.prepared.source === source : prior.prepared === input) && prior.fontSize === fontSize
    && prior.fontWeight === fontWeight && prior.letterSpacing === letterSpacing
    && prior.prepared.display === display) return prior
  const block = preparePixelText(input, { display, fontSize, fontWeight, letterSpacing })
  connectorLabelBlocks.set(label, block)
  return block
}

/** Conservative visual box for connector-owned inline label artwork. Shared
 * with External Scene admission so a declared box cannot under-report the
 * SVG that will actually be emitted. */
export function connectorInlineLabelVisualBounds(
  label: ConnectorLabelDescriptor,
): AxisAlignedBox | undefined {
  if (label.visual?.kind !== 'inline' || !label.anchor || label.fontSize === undefined || label.textAnchor === undefined) return undefined
  const block = connectorInlineLabelText(label)
  const labelWidth = block.width
  const x0 = label.textAnchor === 'middle'
    ? label.anchor.x - labelWidth / 2
    : label.textAnchor === 'end' ? label.anchor.x - labelWidth : label.anchor.x
  const y = label.anchor.y - Math.max(0, label.clearance ?? 0)
  const halo = Math.max(0, label.halo?.width ?? 0) / 2
  return expandSceneBounds({
    x0,
    y0: y - block.fontSize * 0.35 - block.height / 2,
    x1: x0 + labelWidth,
    y1: y - block.fontSize * 0.35 + block.height / 2,
  }, halo)
}

/** World-space visual bounds for typed Scene geometry. Connector paths use
 * routed source points and include stroke, endpoint markers, and label bounds. */
export function nodeWorldBounds(node: SceneNode): AxisAlignedBox | undefined {
  let local: AxisAlignedBox | undefined
  if (node.kind === 'shape') local = geometryBounds(node.geometry)
  else if (node.kind === 'connector') local = connectorLocalBounds(node)
  else if (node.kind === 'text') {
    const metrics = node.textLayout ?? preparePixelText(node.text, { display: node.display, fontSize: node.fontSize, fontWeight: node.fontWeight ?? 500, letterSpacing: node.letterSpacing })
    const width = metrics.width
    const x0 = node.anchor === 'middle' ? node.x - width / 2 : node.anchor === 'end' ? node.x - width : node.x
    const offsetY = 'offsetY' in metrics ? metrics.offsetY : -node.fontSize * 0.35
    local = { x0, y0: node.y + offsetY - metrics.height / 2, x1: x0 + width, y1: node.y + offsetY + metrics.height / 2 }
  } else return undefined
  return local ? transformedBounds(local, node.transform) : undefined
}

export function transformedBounds(box: AxisAlignedBox, transform?: SceneTransform): AxisAlignedBox | undefined {
  if (![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) return undefined
  if (!transform) return box
  if (transform.kind === 'rotate') return rotateBoxBounds(box, { x: transform.cx, y: transform.cy }, transform.angle)
  const m = transformMatrix(transform)
  const corners = [[box.x0, box.y0], [box.x0, box.y1], [box.x1, box.y0], [box.x1, box.y1]]
    .map(([x, y]) => transformPoint({ x: x!, y: y! }, m))
  return corners.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ? pointsBounds(corners) : undefined
}

function composedTransform(parent: SceneTransform | undefined, child: SceneTransform | undefined): SceneTransform | undefined {
  if (!parent) return child
  if (!child) return parent
  const [a, b, c, d, e, f] = composeMatrices(transformMatrix(parent), transformMatrix(child))
  return { kind: 'matrix', a, b, c, d, e, f }
}

/** Numeric user-unit/px strokes have a typed extent. Relative and unresolved
 * CSS units do not: treating `1em` or `var(...)` as one pixel would undercount. */
function paintedStrokeExtent(paint: MarkPaint, hasJoins: boolean): number | undefined {
  if (paint.stroke === undefined || paint.stroke === 'none' || paint.stroke === 'transparent' || tryParseCssColor(paint.stroke)?.[3] === 0) return 0
  const raw = paint.strokeWidth ?? '1'
  if (!/^\s*(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:px)?\s*$/.test(raw)) return undefined
  const half = Number.parseFloat(raw) / 2
  if (!Number.isFinite(half)) return undefined
  const miter = paint.strokeLinejoin ?? 'miter'
  const limit = Number(paint.strokeMiterlimit ?? 4)
  if (!Number.isFinite(limit) || limit < 1) return undefined
  const join = hasJoins && (miter === 'miter' || miter === 'miter-clip') ? half * limit : half
  // A square cap rotated relative to the axes can extend sqrt(2)*half on
  // either axis. Round/butt caps stay inside the half-width envelope.
  const extent = Math.max(join, paint.strokeLinecap === 'square' ? half * Math.SQRT2 : half)
  return Number.isFinite(extent) ? extent : undefined
}

function paintedBox(box: AxisAlignedBox, extent: number, nonScaling: boolean, transform?: SceneTransform): AxisAlignedBox | undefined {
  if (!nonScaling) return transformedBounds(expandSceneBounds(box, extent), transform)
  const world = transformedBounds(box, transform)
  return world ? expandSceneBounds(world, extent) : undefined
}

/** A single symmetric cubic with horizontal endpoint tangents has no joins.
 * Its normal's horizontal component is bounded by the midpoint slope; butt
 * caps add no tangent extension. This keeps thick flow ribbons measurable
 * without applying an unrelated polyline miter envelope to the whole curve.
 */
function symmetricCubicStrokeBounds(d: string, halfWidth: number): AxisAlignedBox | undefined {
  if (!/^[\s,0-9eE.+\-MC]+$/.test(d)) return undefined
  const tokens = d.match(/[MC]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)
  if (!tokens || tokens.length !== 10 || tokens[0] !== 'M' || tokens[3] !== 'C') return undefined
  const values = tokens.filter(token => token !== 'M' && token !== 'C').map(Number)
  if (!values.every(Number.isFinite)) return undefined
  const [x0, y0, x1, y1, x2, y2, x3, y3] = values as [number, number, number, number, number, number, number, number]
  const dx = (x3 - x0) / 2, dy = y3 - y0
  if (dx === 0 || x1 !== x2 || Math.abs(x1 - (x0 + x3) / 2) > 1e-8 || y1 !== y0 || y2 !== y3) return undefined
  const horizontal = halfWidth * Math.abs(dy) / Math.hypot(dx, dy)
  return { x0: Math.min(x0, x3) - horizontal, y0: Math.min(y0, y3) - halfWidth, x1: Math.max(x0, x3) + horizontal, y1: Math.max(y0, y3) + halfWidth }
}

function connectorPaintBounds(node: ConnectorMark, transform?: SceneTransform): AxisAlignedBox | undefined {
  const geometry = node.route.geometry
  const local = geometryBounds(geometry)
  const extent = paintedStrokeExtent({ stroke: node.stroke.color, strokeWidth: String(node.stroke.width), strokeLinecap: node.stroke.lineCap, strokeLinejoin: node.stroke.lineJoin, strokeMiterlimit: String(node.stroke.miterLimit) }, geometry.kind !== 'line')
  if (!local || extent === undefined) return undefined
  const singleCubic = geometry.kind === 'path' && node.stroke.lineCap === 'butt' && !node.stroke.nonScaling
    ? symmetricCubicStrokeBounds(geometry.d, numericStrokeWidth(node.stroke.width) / 2) : undefined
  let result = singleCubic ? transformedBounds(singleCubic, transform) : paintedBox(local, extent, node.stroke.nonScaling, transform)
  if (!result) return undefined
  const width = numericStrokeWidth(node.stroke.width)
  const anchors = connectorEndpointAnchors(geometry, node.route.closed)
  const mids = connectorMidpoints(geometry, node.route.closed)
  const markers: Array<{ marker: MarkerDescriptor; anchor: ScenePoint | undefined }> = [
    ...anchors.starts.flatMap(anchor => node.markers.start ? [{ marker: node.markers.start, anchor }] : []),
    ...anchors.ends.flatMap(anchor => node.markers.end ? [{ marker: node.markers.end, anchor }] : []),
    ...(node.markers.mid.length === 1
      ? mids.map(anchor => ({ marker: node.markers.mid[0]!, anchor }))
      : node.markers.mid.map((marker, index) => ({ marker, anchor: mids[index] }))),
  ]
  for (const { marker, anchor } of markers) {
    const bounds = markerBoundsAt(marker, anchor, width, true)
    const world = bounds && transformedBounds(bounds, transform)
    if (!world) return undefined
    result = unionSceneBounds(result, world)!
  }
  for (const label of node.labels) {
    // Companion TextMarks own their own artwork and transform. Inline labels
    // belong to this connector; legacy declared bounds remain conservative.
    const bounds = unionSceneBounds(label.bounds, connectorInlineLabelVisualBounds(label))
    if (label.visual?.kind === 'inline' && !bounds) return undefined
    if (bounds) {
      const world = transformedBounds(bounds, transform)
      if (!world) return undefined
      result = unionSceneBounds(result, world)!
    }
  }
  return result
}

/** Conservative painted bounds, independent of legacy layout/hit envelopes.
 * Pass the ancestor transform before stroke expansion, so non-scaling strokes
 * retain their world-space width. Unknown artwork is wholly unmeasured. */
export function nodePaintBounds(node: SceneNode, parentTransform?: SceneTransform): AxisAlignedBox | undefined {
  return paintBounds(node, parentTransform)
}

function paintBounds(node: SceneNode, parentTransform?: SceneTransform): AxisAlignedBox | undefined {
  const transform = composedTransform(parentTransform, node.transform)
  if (!inverseMatrix(transformMatrix(transform))) return undefined
  let local: AxisAlignedBox | undefined
  if (node.kind === 'shape') {
    local = geometryBounds(node.geometry)
    const extent = paintedStrokeExtent(node.paint, ['polygon', 'polyline', 'path', 'compound'].includes(node.geometry.kind))
    if (!local || extent === undefined) return undefined
    const base = paintedBox(local, extent, node.paint.vectorEffect === 'non-scaling-stroke', transform)
    if (!node.conditionalPaint) return base
    const alternate = paintedStrokeExtent(node.conditionalPaint, ['polygon', 'polyline', 'path', 'compound'].includes(node.geometry.kind))
    if (!base || alternate === undefined) return undefined
    const alternateBounds = paintedBox(local, alternate, node.conditionalPaint.vectorEffect === 'non-scaling-stroke', transform)
    return alternateBounds ? unionSceneBounds(base, alternateBounds) : undefined
  } else if (node.kind === 'connector') {
    return connectorPaintBounds(node, transform)
  } else if (node.kind === 'text') {
    // nodeWorldBounds already uses the retained occupied band/offset. Apply
    // the transform only once, after optional text stroke expansion.
    local = nodeWorldBounds({ ...node, transform: undefined })
    const extent = paintedStrokeExtent(node.paint, false)
    if (!local || extent === undefined) return undefined
    return paintedBox(local, extent, node.paint.vectorEffect === 'non-scaling-stroke', transform)
  } else if (node.kind === 'group') {
    for (const child of node.children) {
      if (child.node.kind === 'document' && child.node.nonPaint) continue
      const bounds = paintBounds(child.node, transform)
      if (!bounds) return undefined
      local = unionSceneBounds(local, bounds)
    }
  } else return undefined
  return local
}
