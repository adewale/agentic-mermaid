import { tryParseCssColor } from '../shared/color-math.ts'
import { rotateBoxBounds, type AxisAlignedBox } from '../shared/transformed-bounds.ts'
import type { ConnectorContourSemantics, ConnectorLabelDescriptor, ConnectorMark, Geometry, MarkPaint, MarkerDescriptor, SceneNode, ScenePoint, SceneTransform } from './ir.ts'
import { connectorEndpointAnchors, connectorMidpoints } from './connector-geometry.ts'
import { preparePixelText, preparedTextInkBounds, preparedInterTextBounds, hasPreparedInterTextEnvelope, type PixelTextBlock } from '../shared/prepared-text.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { composeMatrices, inverseMatrix, transformMatrix, transformPoint } from './transforms.ts'
import { writtenPolylineProjectionOf } from './written-geometry.ts'

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
export interface TypedPathSegment {
  readonly bounds: AxisAlignedBox
  /** Exact straight ink authority; a curve's control hull is only an envelope. */
  readonly line?: readonly [ScenePoint, ScenePoint]
}

function pathBounds(d: string, visit?: (segment: TypedPathSegment) => boolean, work?: () => boolean, retainContours?: (contours: readonly ConnectorContourSemantics[] | undefined) => void): AxisAlignedBox | undefined {
  const number = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
  let index = 0, x = 0, y = 0, startX = 0, startY = 0
  let command = '', previous = ''
  let control: ScenePoint | undefined
  let result: AxisAlignedBox | undefined
  let segmentBounds: AxisAlignedBox | undefined
  let stopped = false
  const contours: Array<{ start: ScenePoint; end: ScenePoint; closed: boolean; startTangent?: ScenePoint; endTangent?: ScenePoint }> = []
  let contour: (typeof contours)[number] | undefined, knownTangents = true
  const consume = (count: number): boolean => {
    if (work) for (let i = 0; i < count; i++) if (!work()) { stopped = true; return false }
    return true
  }
  const skip = (): void => { while (index < d.length && /[\s,]/.test(d[index]!)) { if (!consume(1)) return; index++ } }
  const read = (flag = false): number | undefined => {
    skip()
    if (stopped) return undefined
    if (flag) {
      const value = d[index]
      if (value !== '0' && value !== '1') return undefined
      if (!consume(1)) return undefined
      index++
      return Number(value)
    }
    number.lastIndex = index
    const match = number.exec(d)
    if (!match) return undefined
    if (!consume(match[0].length)) return undefined
    index = number.lastIndex
    const value = Number(match[0])
    return Number.isFinite(value) ? value : undefined
  }
  const include = (px: number, py: number): boolean => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false
    result = unionSceneBounds(result, { x0: px, y0: py, x1: px, y1: py })
    if (visit) segmentBounds = unionSceneBounds(segmentBounds, { x0: px, y0: py, x1: px, y1: py })
    return true
  }
  const direction = (...points: readonly ScenePoint[]): ScenePoint | undefined => {
    const origin = points[0]!
    for (let i = 1; i < points.length; i++) {
      const dx = points[i]!.x - origin.x, dy = points[i]!.y - origin.y, length = Math.hypot(dx, dy)
      if (length > 0 && Number.isFinite(length)) return { x: dx / length, y: dy / length }
    }
    return undefined
  }
  while (true) {
    skip()
    if (stopped) return undefined
    if (index >= d.length) {
      if (retainContours && knownTangents) {
        for (const item of contours) {
          if (!consume(12)) return undefined
          Object.freeze(item.start); Object.freeze(item.end)
          if (item.startTangent) Object.freeze(item.startTangent)
          if (item.endTangent) Object.freeze(item.endTangent)
          Object.freeze(item)
        }
        retainContours(Object.freeze(contours))
      } else retainContours?.(undefined)
      return result
    }
    if (/[a-zA-Z]/.test(d[index]!)) {
      if (!consume(1)) return undefined
      command = d[index++]!
      if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(command) || (!result && command.toUpperCase() !== 'M')) return undefined
      if (command.toUpperCase() === 'Z') {
        if (retainContours) {
          if (!consume(16) || !contour) return undefined
          const tangent = direction({ x, y }, { x: startX, y: startY })
          contour.startTangent ??= tangent
          if (tangent) contour.endTangent = tangent
          contour.end = { x: startX, y: startY }; contour.closed = true
        }
        if (visit && !visit({ bounds: { x0: Math.min(x, startX), y0: Math.min(y, startY), x1: Math.max(x, startX), y1: Math.max(y, startY) }, line: [{ x, y }, { x: startX, y: startY }] })) return undefined
        x = startX; y = startY; previous = 'Z'; control = undefined; command = ''
        continue
      }
    }
    if (!command) return undefined
    const upper = command.toUpperCase(), relative = command !== upper
    if (visit) segmentBounds = { x0: x, y0: y, x1: x, y1: y }
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
    let firstControl: ScenePoint | undefined, lastControl: ScenePoint | undefined
    if (upper === 'H') { nextX = px(0); nextY = y }
    else if (upper === 'V') { nextX = x; nextY = py(0) }
    else if (upper === 'C' || upper === 'S' || upper === 'Q' || upper === 'T') {
      const reflected = control && (upper === 'S' ? previous === 'C' || previous === 'S' : previous === 'Q' || previous === 'T')
        ? { x: 2 * x - control.x, y: 2 * y - control.y } : { x, y }
      if ((upper === 'S' || upper === 'T') && !include(reflected.x, reflected.y)) return undefined
      for (let i = 0; i < count - 2; i += 2) if (!include(px(i), py(i + 1))) return undefined
      nextX = px(count - 2); nextY = py(count - 1)
      nextControl = upper === 'T' ? reflected : { x: px(count - 4), y: py(count - 3) }
      if (retainContours) {
        firstControl = upper === 'S' || upper === 'T' ? reflected : { x: px(0), y: py(1) }
        lastControl = nextControl
      }
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
    if (retainContours) {
      if (!consume(24)) return undefined
      const end = { x: nextX, y: nextY }, start = { x, y }
      if (upper === 'M') {
        contour = { start: end, end, closed: false }; contours.push(contour)
      } else if (contour) {
        if (upper === 'A' || contour.closed) knownTangents = false
        const startTangent = firstControl ? direction(start, firstControl, lastControl!, end) : direction(start, end)
        const backwards = lastControl ? direction(end, lastControl, firstControl!, start) : direction(end, start)
        contour.startTangent ??= startTangent
        if (backwards) contour.endTangent = { x: -backwards.x, y: -backwards.y }
        contour.end = end
      } else knownTangents = false
    }
    if (visit && upper !== 'M' && !visit({ bounds: segmentBounds!, ...(['L', 'H', 'V'].includes(upper) ? { line: [{ x, y }, { x: nextX, y: nextY }] as const } : {}) })) return undefined
    x = nextX; y = nextY; control = nextControl; previous = upper
  }
}

/** Visit the same admitted typed-path segments used by geometry bounds.
 * Returning false stops bounded consumers without accepting a partial path. */
export function visitTypedPathSegments(d: string, visit: (segment: TypedPathSegment) => boolean, work?: () => boolean, retainContours?: (contours: readonly ConnectorContourSemantics[] | undefined) => void): boolean {
  return pathBounds(d, visit, work, retainContours) !== undefined
}

export function geometryBounds(geometry: Geometry): AxisAlignedBox | undefined {
  switch (geometry.kind) {
    case 'rect': return { x0: geometry.x, y0: geometry.y, x1: geometry.x + geometry.width, y1: geometry.y + geometry.height }
    case 'circle': return { x0: geometry.cx - geometry.r, y0: geometry.cy - geometry.r, x1: geometry.cx + geometry.r, y1: geometry.cy + geometry.r }
    case 'ellipse': return { x0: geometry.cx - geometry.rx, y0: geometry.cy - geometry.ry, x1: geometry.cx + geometry.rx, y1: geometry.cy + geometry.ry }
    case 'line': return { x0: Math.min(geometry.x1, geometry.x2), y0: Math.min(geometry.y1, geometry.y2), x1: Math.max(geometry.x1, geometry.x2), y1: Math.max(geometry.y1, geometry.y2) }
    case 'polygon': return pointsBounds(geometry.points)
    case 'polyline': return unionSceneBounds(pointsBounds(geometry.points), writtenPolylineProjectionOf(geometry)?.rawBounds)
    case 'compound': {
      let bounds: AxisAlignedBox | undefined
      for (const child of geometry.children) {
        const measured = geometryBounds(child)
        if (!measured) return undefined
        bounds = unionSceneBounds(bounds, measured)
      }
      return bounds
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

/** Axial support at unit carrier width, using the same geometry, reference,
 * viewBox, marker scale and stroked envelope as painted marker queries. */
export function markerTerminalDepth(marker: MarkerDescriptor, position: 'start' | 'end'): number {
  const angle = typeof marker.orient === 'number' ? marker.orient
    : position === 'start' && marker.orient === 'auto-start-reverse' ? 180 : 0
  const bounds = markerBoundsAt(marker, { x: 0, y: 0 }, 1, true, angle)
  if (!bounds) throw new TypeError(`Unmeasured terminal marker ${marker.id}`)
  return Math.max(0, position === 'start' ? bounds.x1 : -bounds.x0)
}

export interface ConnectorMarkerPaintRegion {
  position: 'start' | 'mid' | 'end'
  resource: string
  anchor: ScenePoint
  repaint: string
  hull?: readonly ScenePoint[]
  padding?: number
  bounds?: AxisAlignedBox
}

/** Individual marker occurrences from the native connector authority. */
export function connectorMarkerPaintRegions(node: {
  route: Pick<ConnectorMark['route'], 'geometry' | 'closed' | 'contours'>
  stroke: Pick<ConnectorMark['stroke'], 'width'>
  markers: ConnectorMark['markers']
  transform?: SceneTransform
}, parentTransform?: SceneTransform, servedContours?: readonly ConnectorContourSemantics[]): ConnectorMarkerPaintRegion[] {
  const geometry = node.route.geometry, endpoints = servedContours ? { starts: servedContours.map(contour => contour.start), ends: servedContours.map(contour => contour.end) } : connectorEndpointAnchors(geometry, node.route.closed)
  const written = geometry.kind === 'polyline' ? writtenPolylineProjectionOf(geometry) : undefined
  const mids = node.markers.mid.length ? connectorMidpoints(geometry, node.route.closed) : []
  const transform = composedTransform(parentTransform, node.transform)
  const result: ConnectorMarkerPaintRegion[] = []
  const include = (position: ConnectorMarkerPaintRegion['position'], marker: MarkerDescriptor | undefined, anchor: ScenePoint | undefined, tangent?: ScenePoint): void => {
    if (!marker || !anchor) return
    const angle = typeof marker.orient === 'number' ? marker.orient : tangent ? Math.atan2(tangent.y, tangent.x) * 180 / Math.PI + (position === 'start' && marker.orient === 'auto-start-reverse' ? 180 : 0) : undefined
    const strokeWidth = numericStrokeWidth(node.stroke.width)
    // The original operands retain their conservative envelope. Only the
    // served pose below supplies a hull or visible-ink/contact witness.
    const rawAnchor = position === 'start' ? written?.rawStart : position === 'end' ? written?.rawEnd : undefined
    const rawTangent = position === 'start' ? written?.rawStartTangent : position === 'end' ? written?.rawEndTangent : undefined
    const rawAngle = typeof marker.orient === 'number' ? marker.orient : rawTangent ? Math.atan2(rawTangent.y, rawTangent.x) * 180 / Math.PI + (position === 'start' && marker.orient === 'auto-start-reverse' ? 180 : 0) : undefined
    const local = unionSceneBounds(markerBoundsAt(marker, anchor, strokeWidth, true, angle), markerBoundsAt(marker, rawAnchor, strokeWidth, true, rawAngle))
    const matrix = transformMatrix(transform)
    // Equality is about the actual resource, orientation, unit scale and
    // composed linear transform, rather than an owner or resource count.
    const repaint = JSON.stringify([{ ...marker, orient: marker.orient ?? 'auto' }, angle ?? ['unknown', geometry], marker.units === 'userSpaceOnUse' ? 1 : strokeWidth, matrix.slice(0, 4)])
    let hull: ScenePoint[] | undefined, padding: number | undefined
    if (angle !== undefined && marker.geometry?.kind === 'polygon' && marker.geometry.points.length <= 64) {
      const sizeScale = marker.viewBox && marker.size ? Math.min(marker.size.width / marker.viewBox.width, marker.size.height / marker.viewBox.height) : 1
      const scale = sizeScale * Math.max(1, marker.scale ?? 1) * (marker.units === 'userSpaceOnUse' ? 1 : strokeWidth)
      const radians = angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians)
      hull = marker.geometry.points.map(point => {
        const x = (point.x - (marker.ref?.x ?? 0)) * scale, y = (point.y - (marker.ref?.y ?? 0)) * scale
        return transformPoint({ x: anchor.x + x * cosine - y * sine, y: anchor.y + x * sine + y * cosine }, matrix)
      })
      const [a, b, c, d] = matrix
      const norm = (Math.hypot(a + d, b - c) + Math.hypot(a - d, b + c)) / 2
      const extent = paintedStrokeExtent(marker.paint ?? {}, true)
      padding = extent === undefined ? undefined : extent * scale * norm
      if (padding === undefined || !Number.isFinite(padding) || !hull.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) hull = undefined
    }
    result.push({ position, resource: marker.id, anchor: transformPoint(anchor, matrix), repaint, ...(hull ? { hull, padding } : {}), ...(local ? { bounds: transformedBounds(local, transform) } : {}) })
  }
  endpoints.starts.forEach((anchor, index) => include('start', node.markers.start, anchor, (servedContours ?? node.route.contours)[index]?.startTangent))
  endpoints.ends.forEach((anchor, index) => include('end', node.markers.end, anchor, (servedContours ?? node.route.contours)[index]?.endTangent))
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
  const written = geometry.kind === 'polyline' ? writtenPolylineProjectionOf(geometry) : undefined
  if (written) {
    local = unionSceneBounds(local, markerBoundsAt(node.markers.start, written.rawStart, width))!
    local = unionSceneBounds(local, markerBoundsAt(node.markers.end, written.rawEnd, width))!
  }
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
  return expandSceneBounds(preparedTextInkBounds(block, label.anchor.x, y, label.textAnchor, 0) ?? {
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
  // Observe mutable caller fields in the same corner order before selecting
  // a translation shortcut. Zero coordinates retain all four signed-zero extrema.
  const x00 = box.x0, y00 = box.y0, x01 = box.x0, y01 = box.y1,
    x10 = box.x1, y10 = box.y0, x11 = box.x1, y11 = box.y1
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1
    && x00 === x01 && y00 === y10 && x10 === x11 && y01 === y11
    && x00 !== 0 && y00 !== 0 && x10 !== 0 && y01 !== 0
    && Number.isFinite(x00) && Number.isFinite(y00) && Number.isFinite(x10) && Number.isFinite(y01)) {
    const first = transformPoint({ x: x00, y: y00 }, m), last = transformPoint({ x: x11, y: y11 }, m)
    return Number.isFinite(first.x) && Number.isFinite(first.y) && Number.isFinite(last.x) && Number.isFinite(last.y)
      ? { x0: Math.min(first.x, last.x), y0: Math.min(first.y, last.y), x1: Math.max(first.x, last.x), y1: Math.max(first.y, last.y) } : undefined
  }
  const corners = [[x00, y00], [x01, y01], [x10, y10], [x11, y11]]
    .map(([x, y]) => transformPoint({ x: x!, y: y! }, m))
  return corners.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ? pointsBounds(corners) : undefined
}

function composedTransform(parent: SceneTransform | undefined, child: SceneTransform | undefined): SceneTransform | undefined {
  if (!parent) return child
  if (!child) return parent
  const [a, b, c, d, e, f] = composeMatrices(transformMatrix(parent), transformMatrix(child))
  return { kind: 'matrix', a, b, c, d, e, f }
}

/** An open explicit two-point polyline has one segment and no stroke join.
 * Paths/closed contours retain their conservative extent, regardless of their
 * sampled point count. Cap extent remains owned by paintedStrokeExtent. */
export function connectorStrokeHasJoins(route: Pick<ConnectorMark['route'], 'geometry' | 'closed'>): boolean {
  return route.geometry.kind !== 'line' && !(route.geometry.kind === 'polyline' && route.geometry.points.length === 2 && !route.closed)
}

/** Numeric user-unit/px strokes have a typed extent. Relative and unresolved
 * CSS units do not: treating `1em` or `var(...)` as one pixel would undercount. */
export function paintedStrokeExtent(paint: MarkPaint, hasJoins: boolean): number | undefined {
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

/** A butt-capped straight segment paints only its perpendicular half-width
 * band, nothing past its endpoints, so an axis line that ends on the canvas
 * edge stays on the canvas. Round and square caps, and a zero-length segment,
 * keep the axis-free envelope. */
function lineStrokeBox(line: Extract<Geometry, { kind: 'line' }>, extent: number, cap: MarkPaint['strokeLinecap']): AxisAlignedBox {
  const box = geometryBounds(line)!
  const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1)
  if ((cap !== undefined && cap !== 'butt') || length === 0) return expandSceneBounds(box, extent)
  const x = extent * Math.abs(line.y2 - line.y1) / length, y = extent * Math.abs(line.x2 - line.x1) / length
  return { x0: box.x0 - x, y0: box.y0 - y, x1: box.x1 + x, y1: box.y1 + y }
}

function strokedBox(geometry: Geometry, box: AxisAlignedBox, extent: number, cap: MarkPaint['strokeLinecap'], nonScaling: boolean, transform?: SceneTransform): AxisAlignedBox | undefined {
  return geometry.kind === 'line' && !nonScaling ? transformedBounds(lineStrokeBox(geometry, extent, cap), transform) : paintedBox(box, extent, nonScaling, transform)
}

/** A flow ribbon `M x0 y0 C c y0, c y3, x3 y3`, its shared control abscissa
 * strictly between the ends (a Sankey link's rounded midpoint), has
 * horizontal end tangents and no joins, and its butt caps add no tangent
 * extension. Its x moves monotonically from end to end, so the stroke reaches
 * past an end only where the half-width normal outruns the run left to that
 * end, which a gently bent ribbon never does. This keeps thick ribbons
 * measured to their ink rather than by a polyline miter envelope.
 */
function ribbonCubicStrokeBounds(d: string, halfWidth: number): AxisAlignedBox | undefined {
  if (!/^[\s,0-9eE.+\-MC]+$/.test(d)) return undefined
  const tokens = d.match(/[MC]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)
  if (!tokens || tokens.length !== 10 || tokens[0] !== 'M' || tokens[3] !== 'C') return undefined
  const values = tokens.filter(token => token !== 'M' && token !== 'C').map(Number)
  if (!values.every(Number.isFinite)) return undefined
  const [x0, y0, x1, y1, x2, y2, x3, y3] = values as [number, number, number, number, number, number, number, number]
  if (x1 !== x2 || y1 !== y0 || y2 !== y3 || !((x1 - x0) * (x3 - x1) > 0)) return undefined
  const near = Math.abs(x1 - x0), far = Math.abs(x3 - x1), rise = Math.abs(y3 - y0), toward = Math.sign(x3 - x0)
  const ends = [x0 - toward * ribbonEndOvershoot(far, near, rise, halfWidth), x3 + toward * ribbonEndOvershoot(near, far, rise, halfWidth)]
  return { x0: Math.min(...ends), y0: Math.min(y0, y3) - halfWidth, x1: Math.max(...ends), y1: Math.max(y0, y3) + halfWidth }
}

/** An upper bound on how far a flow ribbon's stroke of half width `half`
 * reaches past its t = 1 end along x. `near` and `far` are the control
 * abscissa's distances from the t = 0 and t = 1 ends, `rise` the ends'
 * vertical offset. At t the reach is (1 − t)(6·half·rise·t / |B'(t)| − run(t)),
 * where run(t) = near(1 − t)² + far(1 + t + t²) is the x still to go per unit
 * of (1 − t). Each slice of t bounds both terms by their interval extremes
 * (x' and run are convex quadratics, t(1 − t) is concave). The reach is never
 * more than `half`, and is 0 when no slice can reach past the end. */
export function ribbonEndOvershoot(near: number, far: number, rise: number, half: number): number {
  const slices = 32
  let reach = 0
  for (let i = 0; i < slices; i++) {
    const t0 = i / slices, t1 = (i + 1) / slices
    const at = (t: number): number => Math.min(t1, Math.max(t0, t))
    const speed = (t: number): number => 3 * (near * (1 - t) ** 2 + far * t * t)
    const run = (t: number): number => near * (1 - t) ** 2 + far * (1 + t + t * t)
    const lift = 6 * rise * Math.min(t0 * (1 - t0), t1 * (1 - t1))
    const excess = 6 * half * rise * t1 / Math.hypot(speed(at(near / (near + far))), lift) - run(at((2 * near - far) / (2 * (near + far))))
    if (excess > 0) reach = Math.max(reach, (1 - t0) * excess)
  }
  return Math.min(half, reach)
}

function connectorPaintBounds(node: ConnectorMark, transform?: SceneTransform): AxisAlignedBox | undefined {
  const geometry = node.route.geometry
  const local = geometryBounds(geometry)
  const extent = paintedStrokeExtent({ stroke: node.stroke.color, strokeWidth: String(node.stroke.width), strokeLinecap: node.stroke.lineCap, strokeLinejoin: node.stroke.lineJoin, strokeMiterlimit: String(node.stroke.miterLimit) }, connectorStrokeHasJoins(node.route))
  if (!local || extent === undefined) return undefined
  const singleCubic = geometry.kind === 'path' && node.stroke.lineCap === 'butt' && !node.stroke.nonScaling
    ? ribbonCubicStrokeBounds(geometry.d, numericStrokeWidth(node.stroke.width) / 2) : undefined
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
  const written = geometry.kind === 'polyline' ? writtenPolylineProjectionOf(geometry) : undefined
  if (written) {
    if (node.markers.start) markers.push({ marker: node.markers.start, anchor: written.rawStart })
    if (node.markers.end) markers.push({ marker: node.markers.end, anchor: written.rawEnd })
  }
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
export function nodePaintBounds(node: SceneNode, parentTransform?: SceneTransform, documentFont?: string): AxisAlignedBox | undefined {
  return paintBounds(node, parentTransform, documentFont)
}

function paintBounds(node: SceneNode, parentTransform?: SceneTransform, documentFont?: string): AxisAlignedBox | undefined {
  const transform = composedTransform(parentTransform, node.transform)
  if (transform && !inverseMatrix(transformMatrix(transform))) return undefined
  let local: AxisAlignedBox | undefined
  if (node.kind === 'shape') {
    local = geometryBounds(node.geometry)
    if (!local) return undefined
    const open = ['polygon', 'polyline', 'path', 'compound'].includes(node.geometry.kind)
    // A compound's pieces may stroke more widely than its summary paint.
    let base: AxisAlignedBox | undefined
    for (const paint of [node.paint, ...node.childPaints ?? []]) {
      const extent = paintedStrokeExtent(paint, open)
      const box = extent === undefined ? undefined : strokedBox(node.geometry, local, extent, paint.strokeLinecap, paint.vectorEffect === 'non-scaling-stroke', transform)
      if (!box) return undefined
      base = base ? unionSceneBounds(base, box) : box
    }
    if (!node.conditionalPaint) return base
    const alternate = paintedStrokeExtent(node.conditionalPaint, ['polygon', 'polyline', 'path', 'compound'].includes(node.geometry.kind))
    if (!base || alternate === undefined) return undefined
    const alternateBounds = strokedBox(node.geometry, local, alternate, node.conditionalPaint.strokeLinecap, node.conditionalPaint.vectorEffect === 'non-scaling-stroke', transform)
    return alternateBounds ? unionSceneBounds(base, alternateBounds) : undefined
  } else if (node.kind === 'connector') {
    return connectorPaintBounds(node, transform)
  } else if (node.kind === 'text') {
    // nodeWorldBounds already uses the retained occupied band/offset. Apply
    // the transform only once, after optional text stroke expansion.
    const block = node.measurement === 'prepared' ? node.block : undefined
    const matches = block && node.fontSize === block.fontSize && (node.fontWeight ?? block.fontWeight) === block.fontWeight
      && (node.letterSpacing ?? 0) === block.letterSpacing && !node.fontStyle && !node.textDecoration && !node.dominantBaseline && !node.spans
    const position = matches ? { x: node.x, y: node.y, anchor: node.anchor, baselineShift: node.baselineShift ?? 0.35 } : undefined
    const ink = position ? preparedTextInkBounds(block!, position.x, position.y, position.anchor, position.baselineShift) : undefined
    local = ink ?? nodeWorldBounds({ ...node, transform: undefined })
    if (!ink && block && hasPreparedInterTextEnvelope(block) && position) {
      const envelope = preparedInterTextBounds(block, position.x, position.y, position.anchor, position.baselineShift, documentFont)
      if (envelope) local = unionSceneBounds(local, envelope)
    }
    const extent = paintedStrokeExtent(node.paint, false)
    if (!local || extent === undefined) return undefined
    return paintedBox(local, extent, node.paint.vectorEffect === 'non-scaling-stroke', transform)
  } else if (node.kind === 'group') {
    for (const child of node.children) {
      if (child.node.kind === 'document' && child.node.nonPaint) continue
      const bounds = paintBounds(child.node, transform, documentFont)
      if (!bounds) return undefined
      local = unionSceneBounds(local, bounds)
    }
  } else return undefined
  return local
}
