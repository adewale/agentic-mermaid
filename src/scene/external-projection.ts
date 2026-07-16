/**
 * Canonical SVG projection for the declarative external Scene surface.
 *
 * Both construction and admission use these functions. External families may
 * supply semantic values, but they never supply an independent SVG/CSS
 * projection authority.
 */

import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import type {
  ConnectorGeometry,
  ConnectorMark,
  Geometry,
  GroupMark,
  MarkPaint,
  MarkerDescriptor,
  SceneNode,
  ScenePoint,
  ShapeMark,
  TextMark,
} from './ir.ts'
import { pathMoveCount } from './connector-geometry.ts'
import * as marks from './marks.ts'

function number(value: number): string {
  return String(value)
}

function pointList(points: readonly ScenePoint[]): string {
  return points.map(point => `${number(point.x)},${number(point.y)}`).join(' ')
}

/** Serialize every MarkPaint field as an escaped attribute value. Runtime
 * admission separately validates the field grammar before a backend can see
 * the result; escaping keeps construction inert even before that check. */
export function externalPaintAttributes(paint: MarkPaint): string {
  const attributes: string[] = []
  const add = (name: string, value: string | undefined) => {
    if (value !== undefined) attributes.push(`${name}="${escapeAttr(String(value))}"`)
  }
  add('fill', paint.fill)
  add('stroke', paint.stroke)
  add('stroke-width', paint.strokeWidth)
  add('stroke-dasharray', paint.strokeDasharray)
  add('stroke-dashoffset', paint.strokeDashoffset)
  add('stroke-linecap', paint.strokeLinecap)
  add('stroke-linejoin', paint.strokeLinejoin)
  add('stroke-miterlimit', paint.strokeMiterlimit)
  add('vector-effect', paint.vectorEffect)
  add('paint-order', paint.paintOrder)
  add('opacity', paint.opacity)
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
}

export function externalShapeSvg(geometry: Geometry, paint: MarkPaint): string {
  const attributes = externalPaintAttributes(paint)
  switch (geometry.kind) {
    case 'rect':
      return `<rect x="${number(geometry.x)}" y="${number(geometry.y)}" width="${number(geometry.width)}" height="${number(geometry.height)}"${geometry.rx === undefined ? '' : ` rx="${number(geometry.rx)}"`}${geometry.ry === undefined ? '' : ` ry="${number(geometry.ry)}"`}${attributes} />`
    case 'circle':
      return `<circle cx="${number(geometry.cx)}" cy="${number(geometry.cy)}" r="${number(geometry.r)}"${attributes} />`
    case 'ellipse':
      return `<ellipse cx="${number(geometry.cx)}" cy="${number(geometry.cy)}" rx="${number(geometry.rx)}" ry="${number(geometry.ry)}"${attributes} />`
    case 'line':
      return `<line x1="${number(geometry.x1)}" y1="${number(geometry.y1)}" x2="${number(geometry.x2)}" y2="${number(geometry.y2)}"${attributes} />`
    case 'polygon':
      return `<polygon points="${escapeAttr(pointList(geometry.points))}"${attributes} />`
    case 'polyline':
      return `<polyline points="${escapeAttr(pointList(geometry.points))}"${attributes} />`
    case 'path':
    case 'compound':
      throw new Error(`External shapes cannot project ${geometry.kind} geometry`)
  }
}

export function externalTextSvg(fields: Pick<TextMark, 'text' | 'x' | 'y' | 'fontSize' | 'anchor' | 'paint'>): string {
  return `<text x="${number(fields.x)}" y="${number(fields.y)}" text-anchor="${escapeAttr(fields.anchor)}" font-size="${number(fields.fontSize)}"${externalPaintAttributes(fields.paint)}>${escapeXml(fields.text)}</text>`
}

function connectorGeometryAttributes(geometry: ConnectorGeometry): string {
  switch (geometry.kind) {
    case 'line':
      return `x1="${number(geometry.x1)}" y1="${number(geometry.y1)}" x2="${number(geometry.x2)}" y2="${number(geometry.y2)}"`
    case 'polyline':
      return `points="${escapeAttr(pointList(geometry.points))}"`
    case 'path':
      return `d="${escapeAttr(geometry.d)}"`
  }
}

/** External Scene v1 has one path-contour authority. Keep this check shared by
 * construction and admission so a hand-built SceneDoc cannot claim topology
 * that the declarative builder itself would reject. */
export function assertExternalConnectorTopology(geometry: ConnectorGeometry, closed: boolean): void {
  if (geometry.kind !== 'path') {
    if (closed) throw new TypeError('External Scene closed topology is only valid for path geometry')
    return
  }
  if (geometry.subpaths !== undefined) {
    throw new TypeError('External Scene v1 does not expose typed connector subpaths')
  }
  if (pathMoveCount(geometry.d) !== 1) {
    throw new TypeError('External Scene v1 path geometry must contain exactly one SVG subpath')
  }
  const closeCommands = geometry.d.match(/[Zz]/g)?.length ?? 0
  if (closeCommands > 1 || closed !== (closeCommands === 1)) {
    throw new TypeError('External Scene connector closed must exactly match its single SVG path contour')
  }
  assertExternalPathPointAgreement(geometry, closed)
}

/** External Scene v1 deliberately has one path authority. Curved path data
 * cannot be proven equivalent to a caller-supplied hit/bounds polyline, so v1
 * admits only a linear M/L[/Z] contour and verifies every vertex. Rich curves
 * remain available to built-in family lowerings and can be exposed by a later
 * API version with a canonical flattening contract. */
function assertExternalPathPointAgreement(
  geometry: Extract<ConnectorGeometry, { kind: 'path' }>,
  closed: boolean,
): void {
  const tokens = geometry.d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  let index = 0
  const vertices: ScenePoint[] = []
  const number = (): number => {
    const token = tokens[index++]
    const value = Number(token)
    if (token === undefined || !Number.isFinite(value)) {
      throw new TypeError('External Scene v1 path must use finite canonical M/L vertices')
    }
    return value
  }
  if (tokens[index++] !== 'M') {
    throw new TypeError('External Scene v1 path must use one absolute M followed by absolute L vertices')
  }
  vertices.push({ x: number(), y: number() })
  let sawClose = false
  while (index < tokens.length) {
    const command = tokens[index++]
    if (command === 'Z') {
      sawClose = true
      if (index !== tokens.length) throw new TypeError('External Scene v1 path Z must terminate the contour')
      break
    }
    if (command !== 'L') {
      throw new TypeError('External Scene v1 path supports only absolute M/L/Z so route, bounds, hit geometry, and SVG cannot diverge')
    }
    vertices.push({ x: number(), y: number() })
  }
  if (sawClose !== closed) {
    throw new TypeError('External Scene connector closed must exactly match its single SVG path contour')
  }
  if (vertices.length !== geometry.points.length || vertices.some((point, pointIndex) => {
    const typed = geometry.points[pointIndex]
    return !typed || typed.x !== point.x || typed.y !== point.y
  })) {
    throw new TypeError('External Scene v1 path vertices must exactly match typed connector points')
  }
}

export function externalConnectorSvg(
  fields: { geometry: ConnectorGeometry; lineStyle: ConnectorMark['lineStyle']; paint: MarkPaint },
  startMarker: MarkerDescriptor | undefined,
  midMarker: MarkerDescriptor | undefined,
  endMarker: MarkerDescriptor | undefined,
): string {
  if (fields.lineStyle === 'invisible') return ''
  const markerAttributes = [
    ...(startMarker ? [`marker-start="url(#${escapeAttr(startMarker.id)})"`] : []),
    ...(midMarker ? [`marker-mid="url(#${escapeAttr(midMarker.id)})"`] : []),
    ...(endMarker ? [`marker-end="url(#${escapeAttr(endMarker.id)})"`] : []),
  ]
  return `<${fields.geometry.kind} ${connectorGeometryAttributes(fields.geometry)}${externalPaintAttributes(fields.paint)}${markerAttributes.length ? ` ${markerAttributes.join(' ')}` : ''} />`
}

/** Rebuild one structured external mark using only fields exposed by the
 * declarative builder. Admission compares the result with the supplied mark. */
export function canonicalExternalNode(node: ShapeMark | TextMark | GroupMark | ConnectorMark): SceneNode {
  switch (node.kind) {
    case 'shape':
      return marks.shape({
        id: node.id,
        role: node.role,
        geometry: node.geometry,
        paint: node.paint,
        ...(node.channels ? { channels: node.channels } : {}),
      }, externalShapeSvg(node.geometry, node.paint))
    case 'text':
      return marks.text({
        id: node.id,
        role: node.role,
        text: node.text,
        x: node.x,
        y: node.y,
        fontSize: node.fontSize,
        anchor: node.anchor,
        paint: node.paint,
        ...(node.channels ? { channels: node.channels } : {}),
      }, externalTextSvg(node))
    case 'group':
      return marks.group({
        id: node.id,
        role: node.role,
        open: '<g>',
        close: '</g>',
        children: node.children.map(child => ({ node: child.node, indent: 2 })),
        ...(node.channels ? { channels: node.channels } : {}),
      })
    case 'connector': {
      const start = node.markers.start
      const mid = node.markers.mid.length === 1 ? node.markers.mid[0] : undefined
      const end = node.markers.end
      const geometry = node.route.geometry
      const paint: MarkPaint = {
        fill: 'none',
        stroke: node.stroke.color,
        strokeWidth: String(node.stroke.width),
        ...(node.stroke.opacity === undefined ? {} : { opacity: String(node.stroke.opacity) }),
        ...(node.stroke.dash === undefined ? {} : {
          strokeDasharray: typeof node.stroke.dash.array === 'string' ? node.stroke.dash.array : node.stroke.dash.array.join(' '),
          ...(node.stroke.dash.offset === undefined ? {} : { strokeDashoffset: String(node.stroke.dash.offset) }),
        }),
        strokeLinecap: node.stroke.lineCap,
        strokeLinejoin: node.stroke.lineJoin,
        strokeMiterlimit: String(node.stroke.miterLimit),
        ...(node.stroke.paintOrder === undefined ? {} : { paintOrder: node.stroke.paintOrder }),
        ...(node.stroke.nonScaling ? { vectorEffect: 'non-scaling-stroke' as const } : {}),
      }
      assertExternalConnectorTopology(geometry, node.route.closed)
      return marks.connector({
        id: node.id,
        role: node.role,
        geometry,
        lineStyle: node.lineStyle,
        paint,
        endpoints: {
          ...(node.endpoints.from === undefined ? {} : { from: node.endpoints.from }),
          ...(node.endpoints.to === undefined ? {} : { to: node.endpoints.to }),
        },
        relationship: node.relationship,
        route: { closed: node.route.closed },
        markers: { ...(start ? { start } : {}), mid: mid ? [mid] : [], ...(end ? { end } : {}) },
        labels: node.labels,
        ...(node.channels ? { channels: node.channels } : {}),
      }, externalConnectorSvg({ geometry, lineStyle: node.lineStyle, paint }, start, mid, end))
    }
  }
}
