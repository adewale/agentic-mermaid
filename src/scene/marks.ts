// ============================================================================
// Mark constructors — the only way family lowerings build scene nodes.
//
// Each constructor takes semantic fields plus the crisp SVG string the old
// emitter produced (the template literal moves into the lowering call site
// unchanged, so the byte stream cannot drift). group() is the exception: it
// *builds* its crisp from open/close/children with the same indent/join rules
// the string renderers used, so wrapper composition stays byte-exact while
// styled backends re-compose restyled children.
//
// scene-fidelity.test.ts closes the loop: it parses every crisp element and
// asserts the semantic fields agree, so a lowering cannot lie about geometry.
// ============================================================================

import type {
  ConnectorDash, ConnectorEndpointAnchor, ConnectorEndpoints, ConnectorGeometry,
  ConnectorHitGeometry, ConnectorLabelDescriptor, ConnectorMark, ConnectorRelationship,
  ConnectorRoute, ConnectorStroke, ConnectorTerminalProjection, ConnectorTerminalStrokeLoss, DocumentMark, GroupMark,
  Geometry, MarkPaint, MarkerDescriptor, MarkerRef, PreludeMark,
  RawMark, SceneNode, SceneRole, SceneTransform, SemanticChannels, ShapeMark, TextMark,
} from './ir.ts'
import type { DiagramColors } from '../theme.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import { ensureSvgIdentity, semanticIdentityForSvg } from './identity.ts'
import { ensureSvgAccessibility, relationAccessibility, relationAccessibilityForSvg } from './accessibility.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'

export function shape(fields: {
  id: string
  role: SceneRole
  geometry: Geometry
  paint: MarkPaint
  channels?: SemanticChannels
  transform?: SceneTransform
}, crisp: string): ShapeMark {
  const identity = semanticIdentityForSvg(crisp, fields)
  const accessibility = relationAccessibilityForSvg(crisp, identity)
  const decorated = ensureSvgAccessibility(ensureSvgIdentity(crisp, identity), accessibility)
  return { kind: 'shape', crisp: decorated, identity, accessibility, ...fields }
}

export interface ConnectorFields {
  id: string
  role: SceneRole
  geometry: ConnectorGeometry
  lineStyle: ConnectorMark['lineStyle']
  paint: MarkPaint
  startMarker?: MarkerRef
  endMarker?: MarkerRef
  /** Typed identity is authoritative; connector() never inspects crisp SVG. */
  identity?: Omit<SvgSemanticIdentity, 'role'>
  endpoints?: ConnectorEndpoints
  relationship?: Partial<ConnectorRelationship>
  route?: Partial<Omit<ConnectorRoute, 'geometry' | 'labelAnchors'>> & {
    labelAnchors?: readonly { x: number; y: number }[]
  }
  stroke?: Partial<Omit<ConnectorStroke, 'dash'>> & { dash?: ConnectorDash }
  markers?: { start?: MarkerDescriptor; mid?: readonly MarkerDescriptor[]; end?: MarkerDescriptor }
  labels?: readonly ConnectorLabelDescriptor[]
  hit?: Partial<ConnectorHitGeometry>
  /** Optional family-specific terminal limitation additions. Semantic fields
   * are always derived from the connector itself and cannot drift. */
  terminalProjection?: Partial<Pick<ConnectorTerminalProjection, 'diagnostics'>>
  /** Preserve legacy ARIA projection only where a family already emitted it. */
  projectAccessibilityToSvg?: boolean
  channels?: SemanticChannels
  transform?: SceneTransform
}

function connectorGeometryEndpoints(geometry: ConnectorGeometry): {
  start?: ConnectorEndpointAnchor
  end?: ConnectorEndpointAnchor
} {
  if (geometry.kind === 'line') {
    return {
      start: { point: { x: geometry.x1, y: geometry.y1 } },
      end: { point: { x: geometry.x2, y: geometry.y2 } },
    }
  }
  const points = geometry.points
  if (!points || points.length === 0) return {}
  return {
    start: { point: { ...points[0]! } },
    end: { point: { ...points[points.length - 1]! } },
  }
}

function numericStrokeWidth(width: string | number): number {
  const parsed = typeof width === 'number' ? width : parseFloat(width)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 1
}

function connectorDirection(
  endpoints: ConnectorEndpoints,
  startMarker: MarkerDescriptor | undefined,
  endMarker: MarkerDescriptor | undefined,
): ConnectorRelationship['direction'] {
  if (endpoints.from !== undefined && endpoints.from === endpoints.to) return 'self'
  if (startMarker && endMarker) return 'bidirectional'
  if (startMarker) return 'reverse'
  if (endMarker) return 'forward'
  return 'undirected'
}

function routePoints(geometry: ConnectorGeometry): readonly { x: number; y: number }[] {
  if (geometry.kind === 'line') return [
    { x: geometry.x1, y: geometry.y1 },
    { x: geometry.x2, y: geometry.y2 },
  ]
  return geometry.points
}

function endpointTangents(geometry: ConnectorGeometry): { start?: { x: number; y: number }; end?: { x: number; y: number } } {
  const points = routePoints(geometry)
  const tangent = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    return length > 0 ? { x: dx / length, y: dy / length } : undefined
  }
  let start
  for (let index = 1; index < points.length && !start; index++) start = tangent(points[0]!, points[index]!)
  let end
  for (let index = points.length - 2; index >= 0 && !end; index--) end = tangent(points[index]!, points[points.length - 1]!)
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) }
}

function terminalMarker(marker: MarkerDescriptor | undefined) {
  return marker ? { id: marker.id, shape: marker.shape } : undefined
}

function terminalStrokeLosses(
  route: ConnectorRoute,
  stroke: ConnectorStroke,
): ConnectorTerminalStrokeLoss[] {
  const losses: ConnectorTerminalStrokeLoss[] = [
    'continuous-geometry',
    'stroke-width',
    'stroke-cap',
    'stroke-join',
  ]
  if (route.bendRadius > 0) losses.push('bend-radius')
  if (stroke.opacity !== undefined) losses.push('stroke-opacity')
  if (stroke.lineJoin === 'miter' || stroke.lineJoin === 'miter-clip') losses.push('stroke-miter')
  if (stroke.dash) losses.push('dash-pattern')
  if (stroke.dash?.offset !== undefined) losses.push('dash-offset')
  if (stroke.pathLength !== undefined) losses.push('path-length')
  if (stroke.paintOrder !== undefined) losses.push('paint-order')
  if (stroke.nonScaling) losses.push('non-scaling-stroke')
  return losses
}

function decodedAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    // Spell this without a quote nested inside the opposite quote style. The
    // DOM-free source check intentionally uses a tiny lexical stripper rather
    // than a TypeScript parser; the nested spelling made it misclassify the
    // following source as one unterminated string and report a false positive.
    .replace(/&#39;|&apos;/g, String.fromCharCode(39))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Crisp SVG is a checked compatibility projection, never a second connector
 * authority. Built-in lowerings remain byte-exact, but any disagreement with
 * the typed route/stroke/marker fields fails at construction. */
function assertConnectorCrispProjection(mark: Pick<ConnectorMark, 'id' | 'geometry' | 'stroke' | 'markers'>, crisp: string): void {
  if (crisp === '') return
  const openingMatch = crisp.match(/^\s*<(line|polyline|path)\b[^>]*>/)
  if (!openingMatch) throw new Error(`Connector "${mark.id}" crisp projection must start with line, polyline, or path`)
  const opening = openingMatch[0]
  const tag = openingMatch[1]
  if (tag !== mark.geometry.kind) throw new Error(`Connector "${mark.id}" crisp geometry ${tag} disagrees with typed ${mark.geometry.kind}`)
  const attr = (name: string): string | undefined => {
    const value = opening.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
    return value === undefined ? undefined : decodedAttribute(value)
  }
  const sameText = (name: string, expected: string | undefined) => {
    const actual = attr(name)
    // A family CSS class may own omitted presentational attributes. When an
    // inline compatibility value exists, however, it must agree with the
    // typed connector; inline SVG cannot become a competing authority.
    if (actual === undefined) return
    if (actual !== expected) throw new Error(`Connector "${mark.id}" crisp ${name} disagrees with typed connector semantics`)
  }
  const sameNumber = (name: string, expected: number) => {
    const actual = Number(attr(name))
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9) {
      throw new Error(`Connector "${mark.id}" crisp ${name} disagrees with typed connector geometry`)
    }
  }
  if (mark.geometry.kind === 'line') {
    sameNumber('x1', mark.geometry.x1); sameNumber('y1', mark.geometry.y1)
    sameNumber('x2', mark.geometry.x2); sameNumber('y2', mark.geometry.y2)
  } else if (mark.geometry.kind === 'polyline') {
    const actual = (attr('points') ?? '').trim().split(/\s+/).filter(Boolean).map(pair => pair.split(',').map(Number))
    const expected = mark.geometry.points
    if (actual.length !== expected.length || actual.some((pair, index) =>
      pair.length !== 2 || Math.abs(pair[0]! - expected[index]!.x) > 1e-9 || Math.abs(pair[1]! - expected[index]!.y) > 1e-9)) {
      throw new Error(`Connector "${mark.id}" crisp points disagree with typed connector geometry`)
    }
  } else if ((attr('d') ?? '').replace(/[\s,]+/g, ' ').trim() !== mark.geometry.d.replace(/[\s,]+/g, ' ').trim()) {
    throw new Error(`Connector "${mark.id}" crisp path disagrees with typed connector geometry`)
  }
  sameText('stroke', mark.stroke.color)
  const rawWidth = attr('stroke-width')
  const actualWidth = Number(rawWidth)
  const expectedWidth = Number(mark.stroke.width)
  if (rawWidth !== undefined && (Number.isFinite(expectedWidth) ? Math.abs(actualWidth - expectedWidth) > 1e-9 : rawWidth !== String(mark.stroke.width))) {
    throw new Error(`Connector "${mark.id}" crisp stroke-width disagrees with typed connector semantics`)
  }
  sameText('stroke-opacity', mark.stroke.opacity === undefined ? '1' : String(mark.stroke.opacity))
  sameText('stroke-linecap', mark.stroke.lineCap)
  sameText('stroke-linejoin', mark.stroke.lineJoin)
  sameText('stroke-miterlimit', String(mark.stroke.miterLimit))
  const dash = mark.stroke.dash
  const expectedDash = dash === undefined ? undefined : typeof dash.array === 'string' ? dash.array : dash.array.join(' ')
  const actualDash = attr('stroke-dasharray')?.trim().replace(/\s+/g, ' ')
  if (actualDash !== undefined && actualDash !== expectedDash?.trim().replace(/\s+/g, ' ')) {
    throw new Error(`Connector "${mark.id}" crisp stroke-dasharray disagrees with typed connector semantics`)
  }
  sameText('stroke-dashoffset', dash?.offset === undefined ? undefined : String(dash.offset))
  sameText('pathLength', mark.stroke.pathLength === undefined ? undefined : String(mark.stroke.pathLength))
  sameText('paint-order', mark.stroke.paintOrder)
  sameText('vector-effect', mark.stroke.nonScaling ? 'non-scaling-stroke' : undefined)
  sameText('marker-start', mark.markers.start ? `url(#${mark.markers.start.id})` : undefined)
  sameText('marker-end', mark.markers.end ? `url(#${mark.markers.end.id})` : undefined)
}

export function connector(fields: ConnectorFields, crisp: string): ConnectorMark {
  const markerStart = fields.markers?.start ?? fields.startMarker
  const markerEnd = fields.markers?.end ?? fields.endMarker
  const geometryEndpoints = connectorGeometryEndpoints(fields.geometry)
  const endpoints: ConnectorEndpoints = {
    ...(fields.endpoints ?? {}),
    start: { ...geometryEndpoints.start, ...fields.endpoints?.start },
    end: { ...geometryEndpoints.end, ...fields.endpoints?.end },
  }
  const labels = fields.labels ?? []
  const identity: SvgSemanticIdentity = {
    id: fields.identity?.id ?? fields.id,
    role: fields.role,
    ...(fields.identity?.classNames ? { classNames: fields.identity.classNames } : {}),
    ...(fields.identity?.from ?? endpoints.from ? { from: fields.identity?.from ?? endpoints.from } : {}),
    ...(fields.identity?.to ?? endpoints.to ? { to: fields.identity?.to ?? endpoints.to } : {}),
  }
  const accessibility = relationAccessibility(identity, labels[0]?.text)
  // Deliberately project only id/role. Existing endpoint attributes in crisp
  // remain byte-for-byte; typed endpoints never silently change crisp SVG.
  const domIdentity: SvgSemanticIdentity = {
    id: identity.id,
    role: identity.role,
    ...(identity.classNames ? { classNames: identity.classNames } : {}),
  }
  let decorated = ensureSvgIdentity(crisp, fields.projectAccessibilityToSvg ? identity : domIdentity)
  if (fields.projectAccessibilityToSvg) decorated = ensureSvgAccessibility(decorated, accessibility)

  const width = fields.stroke?.width ?? fields.paint.strokeWidth ?? '1'
  const dash = fields.stroke?.dash
    ?? (fields.paint.strokeDasharray ? {
      array: fields.paint.strokeDasharray,
      ...(fields.paint.strokeDashoffset !== undefined ? { offset: fields.paint.strokeDashoffset } : {}),
    } : undefined)
  const opacity = fields.stroke?.opacity ?? fields.paint.opacity
  const paintOrder = fields.stroke?.paintOrder ?? fields.paint.paintOrder
  const stroke: ConnectorStroke = {
    color: fields.stroke?.color ?? fields.paint.stroke ?? 'var(--_line)',
    width,
    ...(opacity !== undefined ? { opacity } : {}),
    ...(dash ? { dash } : {}),
    lineCap: fields.stroke?.lineCap ?? fields.paint.strokeLinecap ?? 'butt',
    lineJoin: fields.stroke?.lineJoin ?? fields.paint.strokeLinejoin ?? 'miter',
    miterLimit: fields.stroke?.miterLimit ?? Number(fields.paint.strokeMiterlimit ?? 4),
    ...(fields.stroke?.pathLength !== undefined ? { pathLength: fields.stroke.pathLength } : {}),
    ...(paintOrder !== undefined ? { paintOrder } : {}),
    nonScaling: fields.stroke?.nonScaling ?? fields.paint.vectorEffect === 'non-scaling-stroke',
  }
  const route: ConnectorRoute = {
    geometry: fields.geometry,
    ownership: fields.route?.ownership ?? 'family',
    closed: fields.route?.closed ?? false,
    bendRadius: fields.route?.bendRadius ?? 0,
    ...(() => {
      const derived = endpointTangents(fields.geometry)
      return {
        ...(fields.route?.startTangent ?? derived.start ? { startTangent: fields.route?.startTangent ?? derived.start } : {}),
        ...(fields.route?.endTangent ?? derived.end ? { endTangent: fields.route?.endTangent ?? derived.end } : {}),
      }
    })(),
    labelAnchors: fields.route?.labelAnchors ?? labels.flatMap(label => label.anchor ? [label.anchor] : []),
  }
  const hit: ConnectorHitGeometry = {
    geometry: fields.hit?.geometry ?? fields.geometry,
    strokeWidth: fields.hit?.strokeWidth ?? Math.max(6, numericStrokeWidth(width)),
    pointerEvents: fields.hit?.pointerEvents ?? (fields.lineStyle === 'invisible' ? 'none' : 'stroke'),
  }
  const relationship: ConnectorRelationship = {
    kind: fields.relationship?.kind ?? fields.role,
    direction: fields.relationship?.direction ?? connectorDirection(endpoints, markerStart, markerEnd),
  }
  const strokeLosses = terminalStrokeLosses(route, stroke)
  const terminalProjection: ConnectorTerminalProjection = {
    realization: fields.lineStyle === 'invisible'
      ? 'unsupported'
      : 'projected',
    topology: fields.geometry.kind,
    direction: relationship.direction,
    relationship: relationship.kind,
    markers: {
      ...(markerStart ? { start: terminalMarker(markerStart) } : {}),
      mid: (fields.markers?.mid ?? []).map(marker => terminalMarker(marker)!),
      ...(markerEnd ? { end: terminalMarker(markerEnd) } : {}),
    },
    labels: labels.map(label => ({ ...(label.id !== undefined ? { id: label.id } : {}), text: label.text })),
    lineStyle: fields.lineStyle,
    strokeLosses,
    diagnostics: [
      fields.lineStyle === 'invisible'
        ? 'This connector affects layout but is intentionally absent from terminal output.'
        : `The terminal grid preserves connector semantics while projecting continuous stroke fields: ${strokeLosses.join(', ')}.`,
      ...(fields.terminalProjection?.diagnostics ?? []),
    ],
  }

  const result: ConnectorMark = {
    kind: 'connector',
    crisp: decorated,
    id: fields.id,
    role: fields.role,
    geometry: fields.geometry,
    lineStyle: fields.lineStyle,
    paint: fields.paint,
    ...(markerStart ? { startMarker: markerStart } : {}),
    ...(markerEnd ? { endMarker: markerEnd } : {}),
    endpoints,
    relationship,
    route,
    stroke,
    markers: { ...(markerStart ? { start: markerStart } : {}), mid: fields.markers?.mid ?? [], ...(markerEnd ? { end: markerEnd } : {}) },
    labels,
    hit,
    terminalProjection,
    identity,
    ...(fields.projectAccessibilityToSvg && accessibility ? { accessibility } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    ...(fields.transform ? { transform: fields.transform } : {}),
  }
  assertConnectorCrispProjection(result, result.crisp)
  return result
}

export function text(fields: {
  id: string
  role: SceneRole
  text: string
  x: number
  y: number
  fontSize: number
  anchor: TextMark['anchor']
  paint: MarkPaint
  channels?: SemanticChannels
  transform?: SceneTransform
}, crisp: string): TextMark {
  const identity = semanticIdentityForSvg(crisp, fields)
  const accessibility = relationAccessibilityForSvg(crisp, identity)
  const decorated = ensureSvgAccessibility(ensureSvgIdentity(crisp, identity), accessibility)
  return { kind: 'text', crisp: decorated, identity, accessibility, ...fields }
}

export function raw(fields: {
  id: string
  role: SceneRole
  channels?: SemanticChannels
}, crisp: string): RawMark {
  return { kind: 'raw', crisp, ...fields }
}

export function documentText(fields: {
  id: string
  element: 'title' | 'description'
  text: string
  domId?: string
}): DocumentMark {
  const tag = fields.element === 'title' ? 'title' : 'desc'
  const idAttr = fields.domId ? ` id="${escapeAttr(fields.domId)}"` : ''
  return { kind: 'document', role: 'chrome', crisp: `<${tag}${idAttr}>${escapeXml(fields.text)}</${tag}>`, ...fields }
}

export function definitions(
  fields: { id: string; markerResources?: readonly MarkerDescriptor[] },
  crisp: string,
): DocumentMark {
  return { kind: 'document', role: 'defs', element: 'definitions', crisp, ...fields }
}

export function documentClose(): DocumentMark {
  return { kind: 'document', id: 'svg-close', role: 'chrome', element: 'close', crisp: '</svg>' }
}

/** Indent every line of a serialized chunk by `n` spaces — the same transform
 *  the string renderers applied via `'  ' + s.replace(/\n/g, '\n  ')`. */
export function indentLines(s: string, n: number): string {
  if (n <= 0 || s === '') return s
  const pad = ' '.repeat(n)
  return pad + s.replace(/\n/g, `\n${pad}`)
}

export function group(fields: {
  id: string
  role: SceneRole
  open: string
  close: string
  children: Array<{ node: SceneNode; indent: number }>
  join?: string
  channels?: SemanticChannels
}): GroupMark {
  const join = fields.join ?? '\n'
  const identity = semanticIdentityForSvg(fields.open, fields)
  const accessibility = relationAccessibilityForSvg(fields.open, identity)
  const open = ensureSvgAccessibility(ensureSvgIdentity(fields.open, identity), accessibility)
  const segments: string[] = [open]
  for (const child of fields.children) {
    segments.push(indentLines(child.node.crisp, child.indent))
  }
  segments.push(fields.close)
  return {
    kind: 'group',
    crisp: segments.join(join),
    id: fields.id,
    role: fields.role,
    open,
    close: fields.close,
    children: fields.children,
    join,
    channels: fields.channels,
    identity,
    accessibility,
  }
}

export function prelude(fields: {
  id: string
  width: number
  height: number
  colors: DiagramColors
  transparent: boolean
  font: string
  hasMonoFont: boolean
  extraCss?: string
}, crisp: string): PreludeMark {
  return {
    kind: 'prelude',
    crisp,
    id: fields.id,
    role: 'prelude',
    prelude: {
      width: fields.width,
      height: fields.height,
      colors: fields.colors,
      transparent: fields.transparent,
      font: fields.font,
      hasMonoFont: fields.hasMonoFont,
      extraCss: fields.extraCss ?? '',
    },
  }
}
