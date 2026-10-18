import { sanitizeDisplayLines } from '../shared/text-controls.ts'
// ============================================================================
// Mark constructors — the only way family lowerings build scene nodes.
//
// Each constructor takes semantic fields plus its backend-private SVG
// serialization. group() builds serialization from open/close/children so
// styled backends can re-compose restyled children.
//
// scene-fidelity.test.ts closes the loop: it parses every serialized element and
// asserts the semantic fields agree, so a lowering cannot lie about geometry.
// ============================================================================

import type {
  ConnectorContourSemantics, ConnectorDash, ConnectorEndpointAnchor, ConnectorEndpoints, ConnectorGeometry,
  ConnectorHitGeometry, ConnectorLabelDescriptor, ConnectorMark, ConnectorRelationship,
  ConnectorRoute, ConnectorStroke, ConnectorTerminalProjection, DocumentMark, GroupMark,
  Geometry, LinearGradientDescriptor, MarkPaint, MarkerDescriptor,
  SceneNode, SceneOwner, SceneRole, SceneTransform, SemanticChannels, ShapeMark, TextMark,
} from './ir.ts'
import type { DiagramColors } from '../theme.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import { ensureSvgIdentity, semanticIdentityForSvg } from './identity.ts'
import { ensureSvgAccessibility, relationAccessibility, relationAccessibilityForSvg } from './accessibility.ts'
import { displayText, escapeAttr, escapeXml, renderMultilineText } from '../multiline-utils.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import type { LabelDisplay } from '../multiline-utils.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import {
  connectorContourSemantics,
  connectorGeometryHasCurves,
  connectorMidpoints,
  connectorSubpaths,
  pathMoveCount,
  sameConnectorPoint,
} from './connector-geometry.ts'
import { connectorInlineLabelText } from './bounds.ts'
import { deriveConnectorTerminalProjection } from './connector-terminal.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'
import { hasMarkerCss } from '../output-security.ts'
import { serializeTransform } from './transforms.ts'
import {
  attachSceneNodeSerialization,
  canonicalizeSceneNodeSerialization,
  sceneNodeSerialization,
} from './serialization.ts'

export function shape(fields: {
  id: string
  role: SceneRole
  /** Optional public DOM identity when the bounded Scene key is internal. */
  identity?: Omit<SvgSemanticIdentity, 'role'>
  owner?: SceneOwner
  visibility?: 'conditional'
  geometry: Geometry
  paint: MarkPaint
  surfaceFragment?: boolean
  channels?: SemanticChannels
  transform?: SceneTransform
}, crisp: string): ShapeMark {
  const identity: SvgSemanticIdentity = fields.identity
    ? { ...fields.identity, role: fields.role }
    : semanticIdentityForSvg(crisp, fields)
  const accessibility = fields.identity
    ? relationAccessibility(identity)
    : relationAccessibilityForSvg(crisp, identity)
  const decorated = ensureSvgAccessibility(ensureSvgIdentity(crisp, identity), accessibility)
  const result: ShapeMark = {
    kind: 'shape',
    id: fields.id,
    role: fields.role,
    identity,
    ...(fields.owner ? { owner: fields.owner } : {}),
    ...(fields.visibility ? { visibility: fields.visibility } : {}),
    ...(accessibility ? { accessibility } : {}),
    geometry: fields.geometry,
    paint: fields.paint,
    ...(fields.surfaceFragment !== undefined ? { surfaceFragment: fields.surfaceFragment } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    ...(fields.transform ? { transform: fields.transform } : {}),
  }
  return attachSceneNodeSerialization(result, decorated)
}

export interface ConnectorFields {
  id: string
  role: SceneRole
  geometry: ConnectorGeometry
  lineStyle: ConnectorMark['lineStyle']
  paint: MarkPaint
  /** Typed identity is authoritative; connector() never inspects crisp SVG. */
  identity?: Omit<SvgSemanticIdentity, 'role'>
  owner?: SceneOwner
  visibility?: 'conditional'
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
  channels?: SemanticChannels
  transform?: SceneTransform
}

// Runtime admission is closed too: TypeScript permits extra spread properties.
const CONNECTOR_FIELDS: Record<keyof ConnectorFields, true> = {
  id: true, role: true, geometry: true, lineStyle: true, paint: true,
  identity: true, owner: true, visibility: true, endpoints: true, relationship: true, route: true, stroke: true,
  markers: true, labels: true, hit: true, terminalProjection: true, channels: true, transform: true,
}
const CONNECTOR_MARKER_FIELDS: Record<keyof NonNullable<ConnectorFields['markers']>, true> = { start: true, mid: true, end: true }

function assertKnownConnectorFields(value: object, allowed: object, kind: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${kind} fields must be an object`)
  for (const key of Reflect.ownKeys(value)) {
    if (!Object.hasOwn(allowed, key)) throw new TypeError(`unknown ${kind} field "${String(key)}"`)
  }
}

function connectorGeometryEndpoints(geometry: ConnectorGeometry, closed: boolean): {
  start?: ConnectorEndpointAnchor
  end?: ConnectorEndpointAnchor
} {
  if (geometry.kind === 'line') {
    return {
      start: { point: { x: geometry.x1, y: geometry.y1 } },
      end: { point: { x: geometry.x2, y: geometry.y2 } },
    }
  }
  const subpaths = connectorSubpaths(geometry, closed)
  const start = subpaths[0]?.points[0]
  const finalContour = subpaths.at(-1)
  const end = finalContour?.closed ? finalContour.points[0] : finalContour?.points.at(-1)
  return {
    ...(start ? { start: { point: { ...start } } } : {}),
    ...(end ? { end: { point: { ...end } } } : {}),
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

function projectedMidMarkerId(id: string, geometry: ConnectorGeometry, closed: boolean, markers: readonly MarkerDescriptor[]): string | undefined {
  if (markers.length === 0) return undefined
  const interiorCount = connectorMidpoints(geometry, closed).length
  if (interiorCount === 0) {
    throw new RangeError(`Connector "${id}" has mid markers but no typed interior route points`)
  }
  if (markers.length !== 1 && markers.length !== interiorCount) {
    throw new RangeError(`Connector "${id}" mid markers must contain one repeated descriptor or one descriptor per interior route point`)
  }
  const markerIds = new Set(markers.map(marker => marker.id))
  if (markerIds.size !== 1) {
    throw new RangeError(`Connector "${id}" uses distinct mid markers that one SVG marker-mid carrier cannot represent`)
  }
  return markers[0]!.id
}

/** Typed markers own the references. Existing internal carrier attributes are
 * checked assertions, never a fallback source of marker semantics. */
function projectConnectorMarkerReferences(
  id: string,
  crisp: string,
  markerIds: Readonly<{ start?: string; mid?: string; end?: string }>,
): string {
  if (crisp === '') return crisp
  const tags = scanSvgStartTags(crisp)
  const carrier = tags[0]
  if (!carrier || !['line', 'polyline', 'path'].includes(carrier.name)) {
    throw new TypeError(`Connector "${id}": expected line/polyline/path`)
  }
  for (const tag of tags) {
    for (const attribute of tag.attributes) {
      if (attribute.name === 'marker' || (attribute.name === 'style' && hasMarkerCss(decodedSvgAttributeValue(tag, 'style') ?? ''))) {
        throw new TypeError(`Connector "${id}" SVG shorthand/CSS bypasses typed markers`)
      }
      if (!/^marker-(?:start|mid|end)$/.test(attribute.name)) continue
      if (tag !== carrier) throw new TypeError(`Connector "${id}" has typed markers on another element`)
      if (tag.attributes.filter(candidate => candidate.name === attribute.name).length !== 1) {
        throw new TypeError(`Connector "${id}" has duplicate ${attribute.name}`)
      }
      const position = attribute.name.slice(7) as keyof typeof markerIds
      const expected = markerIds[position] ? `url(#${markerIds[position]})` : undefined
      if (decodedSvgAttributeValue(tag, attribute.name) !== expected) {
        throw new TypeError(`Connector "${id}" ${attribute.name} disagrees with typed markers`)
      }
    }
  }
  let opening = crisp.slice(carrier.start, carrier.end)
  for (const [position, markerId] of Object.entries(markerIds)) {
    if (!markerId) continue
    const attribute = `marker-${position}`
    if (carrier.attributes.some(candidate => candidate.name === attribute)) continue
    opening = opening.replace(/\s*\/?>$/, ending => ` ${attribute}="url(#${escapeAttr(markerId)})"${ending}`)
  }
  return `${crisp.slice(0, carrier.start)}${opening}${crisp.slice(carrier.end)}`
}

function ensureConnectorTransformProjection(crisp: string, transform: SceneTransform | undefined): string {
  if (crisp === '' || !transform) return crisp
  const opening = crisp.match(/^\s*<(?:line|polyline|path)\b[^>]*>/)?.[0]
  if (!opening || /\stransform=/.test(opening)) return crisp
  const value = serializeTransform(transform)
  return crisp.replace(opening, opening.replace(/\s*\/?>$/, ending => ` transform="${value}"${ending}`))
}

function ensureConnectorRelationshipProjection(
  crisp: string,
  relationship: ConnectorRelationship,
): string {
  if (crisp === '') return crisp
  const opening = crisp.match(/^\s*<(?:line|polyline|path)\b[^>]*>/)?.[0]
  if (!opening) return crisp
  let projected = opening
  for (const [name, value] of [
    ['data-relationship', relationship.kind],
    ['data-direction', relationship.direction],
  ] as const) {
    if (!new RegExp(`\\s${name}=`).test(projected)) {
      projected = projected.replace(/\s*\/?>$/, ending => ` ${name}="${escapeAttr(value)}"${ending}`)
    }
  }
  return crisp.replace(opening, projected)
}

function connectorInlineLabelSvg(
  connectorId: string,
  label: ConnectorLabelDescriptor,
  index: number,
  transform: SceneTransform | undefined,
): string | undefined {
  if (label.visual?.kind !== 'inline') return undefined
  if (!label.anchor || !label.paint || label.fontSize === undefined || label.textAnchor === undefined) {
    throw new TypeError(`Connector "${connectorId}" inline label ${index + 1} requires anchor, paint, fontSize, and textAnchor`)
  }
  const block = connectorInlineLabelText(label)
  const attrs: string[] = [
    `data-id="${escapeAttr(label.id ?? `${connectorId}-label-${index + 1}`)}"`,
    'data-role="label"',
    `data-connector-label-for="${escapeAttr(connectorId)}"`,
    `font-size="${block.fontSize}"`,
    `font-weight="${block.fontWeight}"`,
    ...(block.letterSpacing ? [`letter-spacing="${block.letterSpacing}"`] : []),
    `text-anchor="${label.textAnchor}"`,
  ]
  if (transform?.kind === 'rotate') attrs.push(`transform="rotate(${transform.angle} ${transform.cx} ${transform.cy})"`)
  const paint: MarkPaint = {
    ...label.paint,
    ...(label.halo ? {
      stroke: label.halo.color ?? 'var(--bg)',
      strokeWidth: String(label.halo.width),
      paintOrder: 'stroke fill',
    } : {}),
  }
  const paintFields = [
    ['fill', paint.fill], ['stroke', paint.stroke], ['stroke-width', paint.strokeWidth],
    ['stroke-dasharray', paint.strokeDasharray], ['stroke-dashoffset', paint.strokeDashoffset],
    ['stroke-linecap', paint.strokeLinecap], ['stroke-linejoin', paint.strokeLinejoin],
    ['stroke-miterlimit', paint.strokeMiterlimit], ['vector-effect', paint.vectorEffect],
    ['paint-order', paint.paintOrder], ['opacity', paint.opacity],
  ] as const
  for (const [name, value] of paintFields) if (value !== undefined) attrs.push(`${name}="${escapeAttr(value)}"`)
  return renderMultilineText(block, label.anchor.x, label.anchor.y - Math.max(0, label.clearance ?? 0), block.fontSize, attrs.join(' '), 0)
}

export function connector(fields: ConnectorFields, crisp: string): ConnectorMark {
  assertKnownConnectorFields(fields, CONNECTOR_FIELDS, 'connector')
  if (fields.markers !== undefined) assertKnownConnectorFields(fields.markers, CONNECTOR_MARKER_FIELDS, 'marker')
  if (fields.geometry.kind !== 'path' && fields.route?.closed === true) {
    throw new TypeError(`Connector "${fields.id}" closed route topology requires path geometry`)
  }
  if (fields.geometry.kind === 'path') {
    const pathGeometry = fields.geometry
    const subpaths = pathGeometry.subpaths
    const moves = pathMoveCount(pathGeometry.d)
    if (moves > 1 && !subpaths) {
      throw new TypeError(`Connector "${fields.id}" path has multiple SVG subpaths but no typed subpaths`)
    }
    if (subpaths) {
      if (subpaths.length === 0 || subpaths.some(subpath => subpath.points.length < 2)) {
        throw new TypeError(`Connector "${fields.id}" typed subpaths must each contain at least two points`)
      }
      if (moves !== subpaths.length) {
        throw new TypeError(`Connector "${fields.id}" typed subpath count disagrees with SVG path moves`)
      }
      const flattened = subpaths.flatMap(subpath => subpath.points)
      if (flattened.length !== pathGeometry.points.length || flattened.some((point, index) => {
        const expected = pathGeometry.points[index]
        return !expected || expected.x !== point.x || expected.y !== point.y
      })) {
      throw new TypeError(`Connector "${fields.id}" typed subpaths disagree with the canonical point projection`)
      }
    }
  }
  const subpaths = connectorSubpaths(fields.geometry, fields.route?.closed ?? false)
  const derivedClosed = subpaths.length === 1 && subpaths[0]!.closed
  if (fields.geometry.kind === 'path' && fields.geometry.subpaths && fields.route?.closed !== undefined && fields.route.closed !== derivedClosed) {
    throw new TypeError(`Connector "${fields.id}" route.closed disagrees with typed subpath topology`)
  }
  const routeClosed = fields.geometry.kind === 'path' && fields.geometry.subpaths ? derivedClosed : fields.route?.closed ?? false
  if (fields.geometry.kind === 'path') {
    const closeCommands = fields.geometry.d.match(/[Zz]/g)?.length ?? 0
    const closedContours = fields.geometry.subpaths
      ? fields.geometry.subpaths.filter(subpath => subpath.closed).length
      : routeClosed ? 1 : 0
    if (closeCommands !== closedContours) {
      throw new TypeError(`Connector "${fields.id}" SVG close commands disagree with typed closed-contour semantics`)
    }
  }
  const markerStart = fields.markers?.start
  const markerEnd = fields.markers?.end
  const midMarkers = fields.markers?.mid ?? []
  for (const marker of [markerStart, ...midMarkers, markerEnd]) {
    if (marker?.geometry?.kind === 'path' && !marker.bounds && !marker.viewBox && !marker.size) {
      throw new TypeError(`Connector "${fields.id}" path marker "${marker.id}" requires bounds, viewBox, or size`)
    }
  }
  const midMarkerId = projectedMidMarkerId(fields.id, fields.geometry, routeClosed, midMarkers)
  const geometryEndpoints = connectorGeometryEndpoints(fields.geometry, routeClosed)
  for (const position of ['start', 'end'] as const) {
    const supplied = fields.endpoints?.[position]?.point
    const derived = geometryEndpoints[position]?.point
    if (supplied && derived && !sameConnectorPoint(supplied, derived)) {
      throw new TypeError(`Connector "${fields.id}" endpoints.${position}.point disagrees with typed route geometry`)
    }
  }
  const endpoints: ConnectorEndpoints = {
    ...(fields.endpoints ?? {}),
    start: { ...geometryEndpoints.start, ...fields.endpoints?.start },
    end: { ...geometryEndpoints.end, ...fields.endpoints?.end },
  }
  const relationship: ConnectorRelationship = {
    kind: fields.relationship?.kind ?? fields.role,
    direction: fields.relationship?.direction ?? connectorDirection(endpoints, markerStart, markerEnd),
  }
  const labels = (fields.labels ?? []).map(label => {
    const input = resolveLabelContent(label.text, label.textContent)
    const text = sanitizeDisplayLines(label.text)
    return { ...label, text, ...(typeof input !== 'string' ? { textContent: { ...label.textContent!, value: text } } : {}) }
  })
  const identity: SvgSemanticIdentity = {
    id: fields.identity?.id ?? fields.id,
    role: fields.role,
    ...(fields.identity?.classNames ? { classNames: fields.identity.classNames } : {}),
    ...(fields.identity?.from ?? endpoints.from ? { from: fields.identity?.from ?? endpoints.from } : {}),
    ...(fields.identity?.to ?? endpoints.to ? { to: fields.identity?.to ?? endpoints.to } : {}),
  }
  const firstLabel = labels[0]
  const accessibleLabel = firstLabel?.visual?.kind === 'inline'
    ? connectorInlineLabelText(firstLabel).lineBlocks.map(line => line.runs.map(run => run.text).join('')).join('\n')
    : firstLabel ? displayText(resolveLabelContent(firstLabel.text, firstLabel.textContent), firstLabel.display ?? 'literal') : undefined
  const accessibility = relationAccessibility(identity, accessibleLabel)
  const projectedMarkers = projectConnectorMarkerReferences(fields.id, crisp, {
    ...(markerStart ? { start: markerStart.id } : {}),
    ...(midMarkerId ? { mid: midMarkerId } : {}),
    ...(markerEnd ? { end: markerEnd.id } : {}),
  })
  const projectedRelationship = ensureConnectorRelationshipProjection(projectedMarkers, relationship)
  const projectedCrisp = ensureConnectorTransformProjection(projectedRelationship, fields.transform)
  let decorated = ensureSvgAccessibility(ensureSvgIdentity(projectedCrisp, identity), accessibility)
  const inlineLabels = labels
    .map((label, index) => connectorInlineLabelSvg(fields.id, label, index, fields.transform))
    .filter((label): label is string => label !== undefined)
  if (inlineLabels.length > 0) decorated = [decorated, ...inlineLabels].join('\n')

  const width = fields.stroke?.width ?? fields.paint.strokeWidth ?? '1'
  const dash = fields.stroke?.dash
    ?? (fields.paint.strokeDasharray ? {
      array: fields.paint.strokeDasharray,
      ...(fields.paint.strokeDashoffset !== undefined ? { offset: fields.paint.strokeDashoffset } : {}),
    } : undefined)
  const opacity = fields.stroke?.opacity ?? fields.paint.opacity
  const paintOrder = fields.stroke?.paintOrder ?? fields.paint.paintOrder
  const mixBlendMode = fields.stroke?.mixBlendMode
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
    ...(mixBlendMode !== undefined ? { mixBlendMode } : {}),
    nonScaling: fields.stroke?.nonScaling ?? fields.paint.vectorEffect === 'non-scaling-stroke',
    ...(fields.stroke?.encodesValue ? { encodesValue: true } : {}),
  }
  const derivedContours = connectorContourSemantics(fields.geometry, routeClosed)
  const suppliedContours = fields.route?.contours
  if (suppliedContours && (suppliedContours.length !== derivedContours.length || suppliedContours.some((contour, index) => {
    const derived = derivedContours[index]
    return !derived
      || contour.start.x !== derived.start.x || contour.start.y !== derived.start.y
      || contour.end.x !== derived.end.x || contour.end.y !== derived.end.y
      || contour.closed !== derived.closed
  }))) {
    throw new TypeError(`Connector "${fields.id}" route contours disagree with typed subpath endpoint topology`)
  }
  const linearGeometry = !connectorGeometryHasCurves(fields.geometry)
  if (linearGeometry && suppliedContours) {
    for (const [index, supplied] of suppliedContours.entries()) {
      const derived = derivedContours[index]!
      for (const field of ['startTangent', 'endTangent'] as const) {
        const actual = supplied[field]
        const expected = derived[field]
        if (actual && (!expected || !sameConnectorPoint(actual, expected, 1e-9))) {
          throw new TypeError(`Connector "${fields.id}" route.contours[${index}].${field} disagrees with linear route geometry`)
        }
      }
    }
  }
  // Fill omitted tangent fields from geometry. Curved projections retain any
  // exact derivative supplied by their lowering over the flattened chord.
  const contours: ConnectorContourSemantics[] = derivedContours.map((derived, index) => {
    const supplied = suppliedContours?.[index]
    const startTangent = supplied?.startTangent ?? derived.startTangent
    const endTangent = supplied?.endTangent ?? derived.endTangent
    return {
      start: { ...derived.start },
      end: { ...derived.end },
      closed: derived.closed,
      ...(startTangent ? { startTangent } : {}),
      ...(endTangent ? { endTangent } : {}),
    }
  })
  for (const contour of contours) {
    for (const tangent of [contour.startTangent, contour.endTangent]) {
      if (!tangent) continue
      const length = Math.hypot(tangent.x, tangent.y)
      if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-9) {
        throw new TypeError(`Connector "${fields.id}" contour tangents must be finite unit vectors`)
      }
    }
  }
  for (const tangent of [fields.route?.startTangent, fields.route?.endTangent]) {
    if (!tangent) continue
    const length = Math.hypot(tangent.x, tangent.y)
    if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-9) {
      throw new TypeError(`Connector "${fields.id}" route tangents must be finite unit vectors`)
    }
  }
  for (const [field, supplied, derived] of [
    ['startTangent', fields.route?.startTangent, contours[0]?.startTangent],
    ['endTangent', fields.route?.endTangent, contours.at(-1)?.endTangent],
  ] as const) {
    if (supplied && derived && !sameConnectorPoint(supplied, derived, 1e-9)) {
      throw new TypeError(`Connector "${fields.id}" route.${field} disagrees with its contour tangent authority`)
    }
  }
  const route: ConnectorRoute = {
    geometry: fields.geometry,
    ownership: fields.route?.ownership ?? 'family',
    closed: routeClosed,
    bendRadius: fields.route?.bendRadius ?? 0,
    contours,
    ...(() => {
      const derived = {
        start: contours[0]?.startTangent,
        end: contours.at(-1)?.endTangent,
      }
      return {
        ...(fields.route?.startTangent ?? derived.start ? { startTangent: fields.route?.startTangent ?? derived.start } : {}),
        ...(fields.route?.endTangent ?? derived.end ? { endTangent: fields.route?.endTangent ?? derived.end } : {}),
      }
    })(),
    labelAnchors: fields.route?.labelAnchors ?? labels.flatMap(label => label.anchor ? [label.anchor] : []),
  }
  if (fields.hit?.closed !== undefined && fields.hit.closed !== routeClosed) {
    throw new TypeError(`Connector "${fields.id}" hit.closed must match route.closed topology`)
  }
  const hit: ConnectorHitGeometry = {
    geometry: fields.hit?.geometry ?? fields.geometry,
    closed: fields.hit?.closed ?? routeClosed,
    strokeWidth: fields.hit?.strokeWidth ?? Math.max(6, numericStrokeWidth(width)),
    pointerEvents: fields.hit?.pointerEvents ?? (fields.lineStyle === 'invisible' ? 'none' : 'stroke'),
  }
  const terminalProjection = deriveConnectorTerminalProjection({
    geometry: fields.geometry,
    lineStyle: fields.lineStyle,
    endpoints,
    relationship,
    route,
    stroke,
    markers: { ...(markerStart ? { start: markerStart } : {}), mid: midMarkers, ...(markerEnd ? { end: markerEnd } : {}) },
    labels,
    hit,
    ...(fields.transform ? { transform: fields.transform } : {}),
    additionalDiagnostics: fields.terminalProjection?.diagnostics,
  })

  const result: ConnectorMark = {
    kind: 'connector',
    id: fields.id,
    role: fields.role,
    lineStyle: fields.lineStyle,
    endpoints,
    relationship,
    route,
    stroke,
    markers: { ...(markerStart ? { start: markerStart } : {}), mid: midMarkers, ...(markerEnd ? { end: markerEnd } : {}) },
    labels,
    hit,
    terminalProjection,
    identity,
    ...(fields.owner ? { owner: fields.owner } : {}),
    ...(fields.visibility ? { visibility: fields.visibility } : {}),
    ...(accessibility ? { accessibility } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    ...(fields.transform ? { transform: fields.transform } : {}),
  }
  return attachSceneNodeSerialization(result, decorated)
}

export function text(fields: {
  id: string
  role: SceneRole
  /** Optional public DOM identity when the bounded Scene key is internal. */
  identity?: Omit<SvgSemanticIdentity, 'role'>
  owner?: SceneOwner
  visibility?: 'conditional'
  text: string
  x: number
  y: number
  fontSize: number
  fontWeight?: number
  letterSpacing?: number
  display?: LabelDisplay
  block?: PixelTextBlock
  anchor: TextMark['anchor']
  paint: MarkPaint
  pageFill?: string
  channels?: SemanticChannels
  transform?: SceneTransform
}, crisp: string): TextMark {
  const { block, ...semantic } = fields
  const open = crisp.match(/<text\b[^>]*>/)?.[0] ?? ''
  const weight = fields.fontWeight ?? block?.fontWeight ?? Number(open.match(/\bfont-weight="(\d+)"/)?.[1] ?? 400)
  const spacing = fields.letterSpacing ?? block?.letterSpacing ?? Number(open.match(/\bletter-spacing="(-?[\d.]+)"/)?.[1] ?? 0)
  const display = fields.display ?? block?.prepared.display ?? (open.includes('data-literal-text="true"') ? 'literal' : 'formatted')
  const measured = block ?? preparePixelText(fields.text, { display, fontSize: fields.fontSize, fontWeight: weight, letterSpacing: spacing })
  const firstDy = open.match(/\bdy="([^"]*)"/)?.[1] ?? crisp.match(/<tspan\b[^>]*\bdy="([^"]*)"/)?.[1] ?? '0'
  const firstY = block ? crisp.match(/<tspan\b[^>]*\by="([^"]*)"/)?.[1] : undefined
  const dy = firstY !== undefined ? Number.parseFloat(firstY) - fields.y : Number.parseFloat(firstDy) * (firstDy.endsWith('em') ? fields.fontSize : 1)
  const offsetY = dy + (measured.lines.length - 1) * measured.lineHeight / 2 - fields.fontSize * 0.35
  const identity: SvgSemanticIdentity = fields.identity
    ? { ...fields.identity, role: fields.role }
    : semanticIdentityForSvg(crisp, fields)
  const accessibility = fields.identity
    ? relationAccessibility(identity)
    : relationAccessibilityForSvg(crisp, identity)
  const decorated = ensureSvgAccessibility(ensureSvgIdentity(crisp, identity), accessibility)
  return attachSceneNodeSerialization({ kind: 'text', ...semantic, identity, accessibility, block: measured, measurement: block ? 'prepared' : 'fallback', ...(block ? { prepared: true, preparedLines: block.lineBlocks.map(line => line.runs) } : {}), fontWeight: weight, letterSpacing: spacing, display, textLayout: { width: measured.width, height: measured.height, lineHeight: measured.lineHeight, offsetY } }, decorated)
}

export function documentContent(fields: {
  id: string
  role: SceneRole
  nonPaint?: DocumentMark['nonPaint']
  channels?: SemanticChannels
}, svg: string): DocumentMark {
  return attachSceneNodeSerialization({ kind: 'document', element: 'content', ...fields }, svg)
}

export function documentText(fields: {
  id: string
  element: 'title' | 'description'
  text: string
  domId?: string
}): DocumentMark {
  const tag = fields.element === 'title' ? 'title' : 'desc'
  const idAttr = fields.domId ? ` id="${escapeAttr(fields.domId)}"` : ''
  return attachSceneNodeSerialization(
    { kind: 'document', role: 'chrome', ...fields },
    `<${tag}${idAttr}>${escapeXml(fields.text)}</${tag}>`,
  )
}

export function definitions(
  fields: {
    id: string
    markerResources?: readonly MarkerDescriptor[]
    gradientResources?: readonly LinearGradientDescriptor[]
  },
  crisp: string,
): DocumentMark {
  return attachSceneNodeSerialization({ kind: 'document', role: 'defs', element: 'definitions', ...fields }, crisp)
}

export function documentClose(): DocumentMark {
  return attachSceneNodeSerialization({ kind: 'document', id: 'svg-close', role: 'chrome', element: 'close' }, '</svg>')
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
  owner?: SceneOwner
  visibility?: 'conditional'
  transform?: SceneTransform
  open: string
  close: string
  children: Array<{ node: SceneNode; indent: number }>
  join?: string
  channels?: SemanticChannels
}): GroupMark {
  const join = fields.join ?? '\n'
  const identity = semanticIdentityForSvg(fields.open, fields)
  const owner = fields.owner ?? { id: identity.id, role: identity.role }
  // A mark can participate in more than one document. Ownership belongs to
  // this composition, so never mutate a caller's reusable child in place.
  const children = fields.children.map(child => ({
    ...child,
    node: child.node.owner || child.node.kind === 'document' || child.node.kind === 'group'
      ? child.node
      : attachSceneNodeSerialization({ ...child.node, owner }, sceneNodeSerialization(child.node)),
  }))
  // Relation accessibility belongs to the typed ConnectorMark. Composite
  // wrappers may carry grouping metadata, but must not create a second ARIA
  // relation beside the connector authority.
  const open = canonicalizeSceneNodeSerialization(ensureSvgIdentity(fields.open, identity))
  const segments: string[] = [open]
  for (const child of children) {
    segments.push(indentLines(sceneNodeSerialization(child.node), child.indent))
  }
  segments.push(fields.close)
  return attachSceneNodeSerialization({
    kind: 'group',
    id: fields.id,
    role: fields.role,
    open,
    close: fields.close,
    children,
    join,
    channels: fields.channels,
    identity,
    owner,
    ...(fields.visibility ? { visibility: fields.visibility } : {}),
    ...(fields.transform ? { transform: fields.transform } : {}),
  }, segments.join(join))
}

export function documentOpen(fields: {
  id: string
  width: number
  height: number
  colors: DiagramColors
  transparent: boolean
  font: string
  hasMonoFont: boolean
  extraCss?: string
}, svg: string): DocumentMark {
  return attachSceneNodeSerialization({
    kind: 'document',
    element: 'open',
    id: fields.id,
    role: 'prelude',
  }, svg)
}
