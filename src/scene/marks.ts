import { sanitizeDisplayLines } from '../shared/text-controls.ts'
// ============================================================================
// Mark constructors — the only way family lowerings build scene nodes.
//
// Shape, text and connector marks are semantic fields only: the backend's
// writer (svg-writer.ts) draws each one from those fields, so what paint
// certification reads is what the SVG shows. Groups keep an inert open tag
// (hooks and their typed transform) and compose their children; document
// marks carry opaque SVG the fields cannot describe (preludes, definitions,
// family document content).
// ============================================================================

import type {
  ConnectorContourSemantics, ConnectorDash, ConnectorEndpointAnchor, ConnectorEndpoints, ConnectorGeometry,
  ConnectorHitGeometry, ConnectorLabelDescriptor, ConnectorMark, ConnectorRelationship,
  ConnectorRoute, ConnectorStroke, ConnectorTerminalProjection, DocumentMark, GroupMark,
  Geometry, LinearGradientDescriptor, MarkAttributes, MarkPaint, MarkerDescriptor,
  SceneNode, SceneOwner, SceneRole, SceneTransform, SemanticChannels, ShapeMark, TextMark,
} from './ir.ts'
import type { DiagramColors } from '../theme.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import { ensureSvgIdentity, semanticChildId, semanticIdentityForSvg } from './identity.ts'
import { relationAccessibility } from './accessibility.ts'
import { displayText, escapeAttr, escapeXml } from '../multiline-utils.ts'
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
import { setConnectorTerminalProjection, copyDeferredTerminalProjection, deferredTerminalProjectionInput } from './deferred-terminal-projection.ts'
import type { parseSvgTransform } from './transforms.ts'
import { assertInertGroup } from './group-emission.ts'
import {
  admitWritableSceneNode,
  attachSceneNodeSerialization,
  canonicalizeSceneNodeSerialization,
  hasSceneNodeSerialization,
  transferSceneNodeSerialization,
} from './serialization.ts'
import { MARK_CLASS_TOKENS, MARK_DATA_KEY, WRITER_OWNED_DATA_KEYS } from './svg-writer.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'

/** Hooks are inert by construction: class tokens and data-* values only, with
 * the keys the writer derives from typed fields reserved. */
function assertMarkAttributes(id: string, attributes: MarkAttributes | undefined): void {
  if (!attributes) return
  for (const key of Object.keys(attributes)) {
    if (key !== 'className' && key !== 'data' && key !== 'ariaHidden' && key !== 'tabIndex' && key !== 'ariaLabel') throw new TypeError(`Mark "${id}" has unknown attribute hook "${key}"`)
  }
  if (attributes.className !== undefined && !MARK_CLASS_TOKENS.test(attributes.className)) throw new TypeError(`Mark "${id}" class must be space-separated CSS tokens`)
  for (const [key, value] of Object.entries(attributes.data ?? {})) {
    if (!MARK_DATA_KEY.test(key)) throw new TypeError(`Mark "${id}" has an invalid data attribute key "${key}"`)
    if (WRITER_OWNED_DATA_KEYS.has(key)) throw new TypeError(`Mark "${id}" data-${key} belongs to its typed fields`)
    if (typeof value !== 'string') throw new TypeError(`Mark "${id}" data-${key} must be a string`)
  }
  if (attributes.ariaHidden !== undefined && attributes.ariaHidden !== true) throw new TypeError(`Mark "${id}" ariaHidden must be true when present`)
  if (attributes.tabIndex !== undefined && attributes.tabIndex !== 0) throw new TypeError(`Mark "${id}" tabIndex must be 0 when present`)
  if (attributes.ariaLabel !== undefined && typeof attributes.ariaLabel !== 'string') throw new TypeError(`Mark "${id}" ariaLabel must be a string`)
}

const groupEmission = new WeakMap<object, { open: string; opacity: string | undefined; style: boolean; matrix: ReturnType<typeof parseSvgTransform> }>()
export function retainedGroupEmission(node: object) { return groupEmission.get(node) }

/** Typed identity: the explicit public identity, or the mark id with its
 * class tokens, which is what the writer emits as data-id and class. */
function typedIdentity(fields: { id: string; role: SceneRole; identity?: Omit<SvgSemanticIdentity, 'role'> | false; attributes?: MarkAttributes }): SvgSemanticIdentity {
  if (fields.identity) return { ...fields.identity, role: fields.role }
  const classNames = fields.attributes?.className?.split(' ')
  return { id: fields.id, role: fields.role, ...(classNames ? { classNames } : {}) }
}

export function shape(fields: {
  id: string
  role: SceneRole
  /** False only for artwork owned by an enclosing semantic group; the group
   * retains the public identity while this shape retains its paint role. */
  identity?: Omit<SvgSemanticIdentity, 'role'> | false
  owner?: SceneOwner
  visibility?: 'conditional'
  geometry: Geometry
  paint: MarkPaint
  conditionalPaint?: MarkPaint
  surfaceFragment?: boolean
  channels?: SemanticChannels
  transform?: SceneTransform
  attributes?: MarkAttributes
  childPaints?: readonly MarkPaint[]
}): ShapeMark {
  assertMarkAttributes(fields.id, fields.attributes)
  if (fields.childPaints && (fields.geometry.kind !== 'compound' || fields.childPaints.length !== fields.geometry.children.length)) {
    throw new TypeError(`Shape "${fields.id}" child paints must match its compound geometry`)
  }
  if (fields.identity === false && fields.owner?.role !== fields.role) throw new TypeError(`Shape "${fields.id}" without DOM identity requires an explicit owner with the same role`)
  const identity = fields.identity === false ? undefined : typedIdentity(fields)
  const accessibility = identity ? relationAccessibility(identity, fields.attributes?.data?.label) : undefined
  if (accessibility && fields.attributes?.ariaLabel !== undefined) throw new TypeError(`Shape "${fields.id}" takes its aria-label from typed relation accessibility`)
  return admitWritableSceneNode({
    kind: 'shape',
    id: fields.id,
    role: fields.role,
    ...(identity ? { identity } : {}),
    ...(fields.owner ? { owner: fields.owner } : {}),
    ...(fields.visibility ? { visibility: fields.visibility } : {}),
    ...(accessibility ? { accessibility } : {}),
    geometry: fields.geometry,
    paint: fields.paint,
    ...(fields.childPaints ? { childPaints: fields.childPaints } : {}),
    ...(fields.conditionalPaint ? { conditionalPaint: fields.conditionalPaint } : {}),
    ...(fields.surfaceFragment !== undefined ? { surfaceFragment: fields.surfaceFragment } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    ...(fields.transform ? { transform: fields.transform } : {}),
    ...(fields.attributes ? { attributes: fields.attributes } : {}),
  })
}

export interface ConnectorFields {
  id: string
  role: SceneRole
  geometry: ConnectorGeometry
  lineStyle: ConnectorMark['lineStyle']
  paint: MarkPaint
  /** Public DOM identity when it differs from the Scene key. */
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
  attributes?: MarkAttributes
}

// Runtime admission is closed too: TypeScript permits extra spread properties.
const CONNECTOR_FIELDS: Record<keyof ConnectorFields, true> = {
  id: true, role: true, geometry: true, lineStyle: true, paint: true,
  identity: true, owner: true, visibility: true, endpoints: true, relationship: true, route: true, stroke: true,
  markers: true, labels: true, hit: true, terminalProjection: true, channels: true, transform: true, attributes: true,
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

/** Geometry endpoints are fresh constructor data. Adopt them when there is no
 * caller override; otherwise merge while copying the caller's owner/point. */
function ownConnectorEndpoint(geometry: ConnectorEndpointAnchor | undefined, endpoint: ConnectorEndpointAnchor | undefined): ConnectorEndpointAnchor {
  return endpoint ? {
    ...geometry,
    ...endpoint,
    ...(endpoint.owner ? { owner: { ...endpoint.owner } } : {}),
    ...(endpoint.point ? { point: { ...endpoint.point } } : {}),
  } : geometry ?? {}
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

export function connector(fields: ConnectorFields): ConnectorMark {
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
    start: ownConnectorEndpoint(geometryEndpoints.start, fields.endpoints?.start),
    end: ownConnectorEndpoint(geometryEndpoints.end, fields.endpoints?.end),
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
  assertMarkAttributes(fields.id, fields.attributes)
  if (accessibility && fields.attributes?.ariaLabel !== undefined) throw new TypeError(`Connector "${fields.id}" takes its aria-label from typed relation accessibility`)
  for (const [index, label] of labels.entries()) {
    if (label.visual?.kind === 'inline' && (!label.anchor || !label.paint || label.fontSize === undefined || label.textAnchor === undefined)) {
      throw new TypeError(`Connector "${fields.id}" inline label ${index + 1} requires anchor, paint, fontSize, and textAnchor`)
    }
  }

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
  // Geometry derivation owns these fresh contour records and endpoint copies.
  // Keep them directly unless caller-supplied tangents need merging.
  const contours: ConnectorContourSemantics[] = suppliedContours ? derivedContours.map((derived, index) => {
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
  }) : derivedContours
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
    ...(fields.route?.startTangent ?? contours[0]?.startTangent ? { startTangent: fields.route?.startTangent ?? contours[0]?.startTangent } : {}),
    ...(fields.route?.endTangent ?? contours.at(-1)?.endTangent ? { endTangent: fields.route?.endTangent ?? contours.at(-1)?.endTangent } : {}),
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
  const terminalInput = {
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
  }

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
    terminalProjection: undefined as unknown as ConnectorTerminalProjection,
    identity,
    ...(fields.owner ? { owner: fields.owner } : {}),
    ...(fields.visibility ? { visibility: fields.visibility } : {}),
    ...(accessibility ? { accessibility } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    ...(fields.transform ? { transform: fields.transform } : {}),
    ...(fields.attributes ? { attributes: fields.attributes } : {}),
  }
  setConnectorTerminalProjection(result, terminalInput)
  return admitWritableSceneNode(result)
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
  attributes?: MarkAttributes
  baselineShift?: number
  dominantBaseline?: TextMark['dominantBaseline']
  fontStyle?: TextMark['fontStyle']
  textDecoration?: TextMark['textDecoration']
  spans?: TextMark['spans']
}): TextMark {
  const { block, ...semantic } = fields
  if (block) {
    for (const field of ['fontSize', 'fontWeight', 'letterSpacing'] as const) {
      if (fields[field] !== undefined && fields[field] !== block[field]) throw new TypeError(`Text "${fields.id}" ${field} differs from its retained prepared block`)
    }
  }
  assertMarkAttributes(fields.id, fields.attributes)
  const weight = fields.fontWeight ?? block?.fontWeight ?? 400
  const spacing = fields.letterSpacing ?? block?.letterSpacing ?? 0
  const display = fields.display ?? block?.prepared.display ?? 'formatted'
  const measured = block ?? preparePixelText(fields.text, { display, fontSize: fields.fontSize, fontWeight: weight, letterSpacing: spacing })
  if (fields.spans && (measured.lines.length !== 1 || fields.spans.map(span => span.text).join('') !== measured.text)) {
    throw new TypeError(`Text "${fields.id}" spans must spell its one displayed line`)
  }
  // The writer's first baseline: shift ems below y, less half the extra
  // lines, as renderMultilineText places it. Unprepared text keeps that
  // writer's nominal line height. An alphabetic line is centred 0.35em above
  // that baseline; a middle or central baseline is the line's centre, and a
  // hanging baseline its top.
  const shift = fields.baselineShift ?? 0.35
  const lines = measured.lines.length
  const writtenLineHeight = block ? block.lineHeight : fields.fontSize * LINE_HEIGHT_RATIO
  const firstDy = (lines === 1 ? 0 : -((lines - 1) / 2) * writtenLineHeight) + fields.fontSize * shift
  const firstLineCentre = fields.dominantBaseline === 'hanging' ? measured.lineHeight / 2
    : fields.dominantBaseline === 'middle' || fields.dominantBaseline === 'central' ? 0
      : -fields.fontSize * 0.35
  const offsetY = firstDy + (lines - 1) * measured.lineHeight / 2 + firstLineCentre
  const identity = typedIdentity(fields)
  const accessibility = relationAccessibility(identity, fields.attributes?.data?.label)
  if (accessibility && fields.attributes?.ariaLabel !== undefined) throw new TypeError(`Text "${fields.id}" takes its aria-label from typed relation accessibility`)
  return admitWritableSceneNode({
    kind: 'text', ...semantic, identity, accessibility, block: measured, measurement: block ? 'prepared' : 'fallback',
    ...(block ? { prepared: true, preparedLines: block.lineBlocks.map(line => line.runs) } : {}),
    fontWeight: weight, letterSpacing: spacing, display,
    textLayout: { width: measured.width, height: measured.height, lineHeight: measured.lineHeight, offsetY },
  })
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

export { indentLines } from './serialization.ts'

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
  paint?: GroupMark['paint']
}): GroupMark {
  const sourceOpen = fields.open, close = fields.close, join = fields.join ?? '\n'
  const emitted = assertInertGroup({ id: fields.id, open: sourceOpen, close, join, transform: fields.transform })
  const identity = semanticIdentityForSvg(sourceOpen, fields)
  const paint = fields.paint, opacity = paint?.opacity, fill = paint?.fill
  const cascade = paint && [
    ...(opacity !== undefined ? [`opacity="${escapeAttr(opacity)}"`] : []),
    ...(fill !== undefined ? [`fill="${escapeAttr(fill)}"`] : []),
  ].join(' ')
  const painted = cascade ? sourceOpen.replace(/^(\s*<g)\b/, `$1 ${cascade}`) : sourceOpen
  const owner = fields.owner ?? { id: identity.id, role: identity.role }
  // A mark can participate in more than one document. Ownership belongs to
  // this composition, so never mutate a caller's reusable child in place.
  const children = fields.children.map(child => {
    if (child.node.owner || child.node.kind === 'document' || child.node.kind === 'group') return child
    let node: SceneNode
    if (deferredTerminalProjectionInput(child.node)) {
      // A spread would materialize the terminal-only payload. Preserve the
      // enumerable property's position and install a getter for this copy.
      const copied: Record<string, unknown> = {}
      for (const key of Object.keys(child.node)) copied[key] = key === 'terminalProjection' ? undefined : (child.node as unknown as Record<string, unknown>)[key]
      copied.owner = owner
      node = copied as unknown as ConnectorMark
      copyDeferredTerminalProjection(child.node, node)
    } else node = { ...child.node, owner }
    if (hasSceneNodeSerialization(child.node)) transferSceneNodeSerialization(child.node, node)
    return { ...child, node }
  })
  // Relation accessibility belongs to the typed ConnectorMark. Composite
  // wrappers may carry grouping metadata, but must not create a second ARIA
  // relation beside the connector authority. The writer serializes a group
  // from its open tag, children and close tag.
  const open = canonicalizeSceneNodeSerialization(ensureSvgIdentity(painted, identity))
  const result = admitWritableSceneNode({
    kind: 'group',
    id: fields.id,
    role: fields.role,
    open,
    close,
    children,
    join,
    channels: fields.channels,
    identity,
    owner,
    ...(fields.visibility ? { visibility: fields.visibility } : {}),
    ...(fields.transform ? { transform: fields.transform } : {}),
    ...(paint ? { paint } : {}),
  })
  groupEmission.set(result, Object.freeze({ open, opacity, ...emitted, style: emitted.style || fill !== undefined }))
  return result
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

/** Lower bounded, source-owned icon paths without recovering geometry from SVG.
 * Each path carries the paint; the group's open tag carries hooks and the
 * transform only. */
export type PathArtworkFields = {
  id: string
  paths: readonly string[]
  open: string
  paint: MarkPaint
  transform?: SceneTransform
  owner?: SceneOwner
  channels?: SemanticChannels
  join?: string
  indent?: number
}

export function pathArtwork(fields: PathArtworkFields): GroupMark {
  return drawPathArtwork({ shape, group }, fields)
}

/** Share icon lowering with the immediate native writer. */
export function drawPathArtwork<T, G>(factory: {
  shape(fields: Parameters<typeof shape>[0]): T
  group(fields: Omit<Parameters<typeof group>[0], 'children'> & { children: Array<{ node: T; indent: number }> }): G
}, fields: PathArtworkFields): G {
  return factory.group({
    id: fields.id, role: 'icon', open: fields.open, close: '</g>',
    ...(fields.transform ? { transform: fields.transform } : {}),
    ...(fields.owner ? { owner: fields.owner } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    join: fields.join ?? '',
    children: fields.paths.map((path, index) => ({
      indent: fields.indent ?? 0,
      node: factory.shape({ id: semanticChildId(fields.id, 'path', index), role: 'icon',
        geometry: { kind: 'path', d: path }, paint: fields.paint,
        ...(fields.owner ? { owner: fields.owner } : {}),
      }),
    })),
  })
}
