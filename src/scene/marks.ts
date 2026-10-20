import { sanitizeDisplayLines } from '../shared/text-controls.ts'
import { hasMarkerCss } from '../output-security.ts'
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
import { ensureSvgAccessibility, relationAccessibility, relationAccessibilityForSvg } from './accessibility.ts'
import { displayText, escapeAttr, renderMultilineText } from '../multiline-utils.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import type { LabelDisplay } from '../multiline-utils.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'
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
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'
import { parseSvgTransform, serializeTransform, transformMatrix } from './transforms.ts'
import {
  admitWritableSceneNode,
  attachSceneNodeSerialization,
  attachSceneNodeEmission, attachGroupEmissionViews, transferSceneNodeSerialization,
  canonicalizeSceneNodeSerialization,
  hasSceneNodeSerialization,
} from './serialization.ts'
import { MARK_CLASS_TOKENS, MARK_DATA_KEY, WRITER_OWNED_DATA_KEYS } from './svg-writer.ts'

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

const GROUP_HOOK = /^(?:class|data-[a-z][a-z0-9-]*|role|aria-[a-z]+|tabindex|pointer-events|transform|style)$/
const GROUP_OPEN = /^\s*<g\b[^>]*>(?:<title>[^<]*<\/title>)?$/
/** Custom properties only: values a family scopes to the group for its marks' var() paints. */
const CUSTOM_PROPERTIES = /^\s*(?:--[A-Za-z0-9_-]+\s*:[^;]*(?:;\s*|$))*$/

/** A group's open tag carries hooks, and the transform its typed field
 * declares; paint belongs to the marks inside it, which the writer paints. */
function assertInertGroupOpen(id: string, open: string, transform: SceneTransform | undefined): void {
  const tag = GROUP_OPEN.test(open) ? scanSvgStartTags(open)[0] : undefined
  if (!tag || tag.name !== 'g') throw new TypeError(`Group "${id}" open must be one <g> tag with an optional <title>`)
  const names = new Set<string>()
  for (const attribute of tag.attributes) {
    if (names.has(attribute.name)) throw new TypeError(`Group "${id}" open has a duplicate "${attribute.name}"`)
    names.add(attribute.name)
    if (!GROUP_HOOK.test(attribute.name)) throw new TypeError(`Group "${id}" open sets "${attribute.name}"; paint and geometry belong to typed marks`)
    if (attribute.name === 'style' && !CUSTOM_PROPERTIES.test(decodedSvgAttributeValue(tag, 'style') ?? '')) {
      throw new TypeError(`Group "${id}" open style may only set custom properties; paint belongs to typed marks`)
    }
  }
  const written = decodedSvgAttributeValue(tag, 'transform')
  const matrix = written === undefined ? undefined : parseSvgTransform(written)
  const typed = transform ? transformMatrix(transform) : undefined
  if (written !== undefined && !matrix) throw new TypeError(`Group "${id}" open has an unsupported transform`)
  if (!!matrix !== !!typed || matrix && typed && matrix.some((value, index) => Math.abs(value - typed[index]!) > 1e-9 * Math.max(1, Math.abs(value)))) {
    throw new TypeError(`Group "${id}" open transform disagrees with its typed transform`)
  }
}

/** Typed identity: the explicit public identity, or the mark id with its
 * class tokens, which is what the writer emits as data-id and class. */
function typedIdentity(fields: { id: string; role: SceneRole; identity?: Omit<SvgSemanticIdentity, 'role'> | false; attributes?: MarkAttributes }): SvgSemanticIdentity {
  if (fields.identity) return { ...fields.identity, role: fields.role }
  const classNames = fields.attributes?.className?.split(' ')
  return { id: fields.id, role: fields.role, ...(classNames ? { classNames } : {}) }
}

import { attachSvgGroupMetadata, snapshotSvgGroupMetadata, projectSvgCoordinate, snapshotSvgEmissionRecipe, SVG_EMISSION_METADATA_LIMITS, type SvgEmissionRecipe, type SvgGroupEmission, type SvgGroupMetadata } from './svg-emission.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { decorateEmission, emissionAttribute, emissionIdentity, firstEmission } from './svg-mark-emission.ts'
import { classConstructionOpeningLimit, originalConstructionNode } from './construction-operands.ts'
import { publicConstructionOperandsRequired } from './lowering-invocation.ts'
import { SvgWriter } from './svg-writer.ts'
import { writeSvgGroupOpen } from './svg-emission.ts'

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
}, crisp?: string | SvgEmissionRecipe): ShapeMark {
  if (crisp === undefined) return nativeShape(fields)
  if (typeof crisp !== 'string') crisp = snapshotSvgEmissionRecipe(crisp)
  const identity: SvgSemanticIdentity = fields.identity
    ? { ...fields.identity, role: fields.role }
    : typeof crisp === 'string' ? semanticIdentityForSvg(crisp, fields) : emissionIdentity(crisp, fields)
  const accessibility = fields.identity
    ? relationAccessibility(identity)
    : typeof crisp === 'string' ? relationAccessibilityForSvg(crisp, identity) : relationAccessibility(identity, emissionAttribute(crisp, 'data-label', { kind: 'shape', ...fields, identity }))
  const decorated = typeof crisp === 'string' ? ensureSvgAccessibility(ensureSvgIdentity(crisp, identity), accessibility) : undefined
  const result: ShapeMark = {
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
    ...(fields.attributes ? { attributes: fields.attributes } : {}),
    ...(fields.conditionalPaint ? { conditionalPaint: fields.conditionalPaint } : {}),
    ...(fields.surfaceFragment !== undefined ? { surfaceFragment: fields.surfaceFragment } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    ...(fields.transform ? { transform: fields.transform } : {}),
  }
  return typeof crisp === 'string' ? attachSceneNodeSerialization(result, decorated!) : attachSceneNodeEmission(result, decorateEmission(crisp, result))
}

function nativeShape(fields: {
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
  if (transform) attrs.push(`transform="${serializeTransform(transform)}"`)
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

export function connector(fields: ConnectorFields, crisp?: string | SvgEmissionRecipe): ConnectorMark {
  if (crisp !== undefined && typeof crisp !== 'string') crisp = snapshotSvgEmissionRecipe(crisp)
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
  // Copy the caller's endpoint owner and point, as the terminal projection
  // does: admission freezes a built-in Scene in place, and must not freeze an
  // object its caller still holds.
  const ownEndpoint = (endpoint: ConnectorEndpointAnchor | undefined) => endpoint && {
    ...endpoint,
    ...(endpoint.owner ? { owner: { ...endpoint.owner } } : {}),
    ...(endpoint.point ? { point: { ...endpoint.point } } : {}),
  }
  const endpoints: ConnectorEndpoints = {
    ...(fields.endpoints ?? {}),
    start: { ...geometryEndpoints.start, ...ownEndpoint(fields.endpoints?.start) },
    end: { ...geometryEndpoints.end, ...ownEndpoint(fields.endpoints?.end) },
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
  let decorated: string | undefined
  if (typeof crisp === 'string') {
    const projectedMarkers = projectConnectorMarkerReferences(fields.id, crisp, {
      ...(markerStart ? { start: markerStart.id } : {}),
      ...(midMarkerId ? { mid: midMarkerId } : {}),
      ...(markerEnd ? { end: markerEnd.id } : {}),
    })
    const projectedRelationship = ensureConnectorRelationshipProjection(projectedMarkers, relationship)
    const projectedCrisp = ensureConnectorTransformProjection(projectedRelationship, fields.transform)
    decorated = ensureSvgAccessibility(ensureSvgIdentity(projectedCrisp, identity), accessibility)
    const inlineLabels = labels
      .map((label, index) => connectorInlineLabelSvg(fields.id, label, index, fields.transform))
      .filter((label): label is string => label !== undefined)
    if (inlineLabels.length > 0) decorated = [decorated, ...inlineLabels].join('\n')
  }

  if (crisp === undefined) for (const [index, label] of labels.entries()) {
    if (label.visual?.kind === 'inline' && (!label.anchor || !label.paint || label.fontSize === undefined || label.textAnchor === undefined)) {
      throw new TypeError(`Connector "${fields.id}" inline label ${index + 1} requires anchor, paint, fontSize, and textAnchor`)
    }
  }
  assertMarkAttributes(fields.id, fields.attributes)
  if (accessibility && fields.attributes?.ariaLabel !== undefined) throw new TypeError(`Connector "${fields.id}" takes its aria-label from typed relation accessibility`)
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
  if (crisp === undefined) return admitWritableSceneNode(result)
  if (typeof crisp === 'string') return attachSceneNodeSerialization(result, decorated!)
  const carrier = decorateEmission(crisp, result, true)
  for (const [index, label] of labels.entries()) {
    if (label.visual?.kind === 'inline' && (!label.anchor || !label.paint || label.fontSize === undefined || label.textAnchor === undefined)) throw new TypeError(`Connector "${fields.id}" inline label ${index + 1} requires anchor, paint, fontSize, and textAnchor`)
  }
  return attachSceneNodeEmission(result, labels.some(label => label.visual?.kind === 'inline')
    ? { kind: 'sequence', children: [carrier, { kind: 'connectorLabels' }], join: '' } : carrier)
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
}, crisp?: string | SvgEmissionRecipe): TextMark {
  if (crisp === undefined) return nativeText(fields)
  if (typeof crisp !== 'string') crisp = snapshotSvgEmissionRecipe(crisp)
  const { block, ...semantic } = fields
  if (block) {
    for (const field of ['fontSize', 'fontWeight', 'letterSpacing'] as const) {
      if (fields[field] !== undefined && fields[field] !== block[field]) throw new TypeError(`Text "${fields.id}" ${field} differs from its retained prepared block`)
    }
  }
  if (typeof crisp !== 'string') {
    const first = firstEmission(crisp)
    if (first.kind !== 'text') throw new TypeError('Text mark requires a typed text emission')
    const temporary = { kind: 'text', ...fields } as TextMark
    const weight = fields.fontWeight ?? block?.fontWeight ?? Number(emissionAttribute(crisp, 'font-weight', temporary) ?? 400)
    const spacing = fields.letterSpacing ?? block?.letterSpacing ?? Number(emissionAttribute(crisp, 'letter-spacing', temporary) ?? 0)
    const display = fields.display ?? block?.prepared.display ?? (emissionAttribute(crisp, 'data-literal-text', temporary) === 'true' ? 'literal' : 'formatted')
    const measured = block ?? preparePixelText(fields.text, { display, fontSize: fields.fontSize, fontWeight: weight, letterSpacing: spacing })
    const dy = first.dy ?? emissionAttribute(crisp, 'dy', temporary) ?? '0'
    const displacement = typeof dy === 'number' ? dy : Number.parseFloat(dy) * (dy.endsWith('em') ? fields.fontSize : 1)
    let renderedDy = displacement
    if (first.layout === 'multiline') {
      const count = (block?.lines ?? fields.text.split('\n')).length
      const lineHeight = block?.lineHeight ?? fields.fontSize * LINE_HEIGHT_RATIO
      const firstDy = (count === 1 ? 0 : -((count - 1) / 2) * lineHeight) + fields.fontSize * (first.baselineShift ?? 0.35)
      const native = block && /[^\x20-\x7e]/u.test(block.lineBlocks.map(line => line.runs.map(run => run.text).join('')).join(''))
      renderedDy = native ? (projectSvgCoordinate(fields.y, first.positionFormat) + firstDy) - fields.y : firstDy
    }
    const firstLineCentre = fields.dominantBaseline === 'hanging' ? measured.lineHeight / 2
      : fields.dominantBaseline === 'middle' || fields.dominantBaseline === 'central' ? 0 : -fields.fontSize * 0.35
    const offsetY = renderedDy + (measured.lines.length - 1) * measured.lineHeight / 2 + firstLineCentre
    const identity = fields.identity ? { ...fields.identity, role: fields.role } : emissionIdentity(crisp, fields)
    const accessibility = relationAccessibility(identity, emissionAttribute(crisp, 'data-label', temporary))
    const result: TextMark = { kind: 'text', ...semantic, identity, accessibility, block: measured,
      measurement: block ? 'prepared' : 'fallback', ...(block ? { prepared: true, preparedLines: block.lineBlocks.map(line => line.runs) } : {}),
      fontWeight: weight, letterSpacing: spacing, display,
      textLayout: { width: measured.width, height: measured.height, lineHeight: measured.lineHeight, offsetY } }
    return attachSceneNodeEmission(result, decorateEmission(crisp, result))
  }
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
    : typeof crisp === 'string' ? semanticIdentityForSvg(crisp, fields) : emissionIdentity(crisp, fields)
  const accessibility = fields.identity
    ? relationAccessibility(identity)
    : relationAccessibilityForSvg(crisp, identity)
  const decorated = ensureSvgAccessibility(ensureSvgIdentity(crisp, identity), accessibility)
  return attachSceneNodeSerialization({ kind: 'text', ...semantic, identity, accessibility, block: measured, measurement: block ? 'prepared' : 'fallback', ...(block ? { prepared: true, preparedLines: block.lineBlocks.map(line => line.runs) } : {}), fontWeight: weight, letterSpacing: spacing, display, textLayout: { width: measured.width, height: measured.height, lineHeight: measured.lineHeight, offsetY } }, decorated)
}

function nativeText(fields: {
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
}, svg: string | SvgEmissionRecipe): DocumentMark {
  const node: DocumentMark = { kind: 'document', element: 'content', ...fields }
  return typeof svg === 'string' ? attachSceneNodeSerialization(node, svg) : attachSceneNodeEmission(node, svg)
}

export function documentText(fields: {
  id: string
  element: 'title' | 'description'
  text: string
  domId?: string
}): DocumentMark {
  const tag = fields.element === 'title' ? 'title' : 'desc'
  return attachSceneNodeEmission({ kind: 'document', role: 'chrome', ...fields }, { kind: 'documentText', element: tag })
}

export function definitions(
  fields: {
    id: string
    markerResources?: readonly MarkerDescriptor[]
    gradientResources?: readonly LinearGradientDescriptor[]
  },
  crisp: string | SvgEmissionRecipe,
): DocumentMark {
  const node: DocumentMark = { kind: 'document', role: 'defs', element: 'definitions', ...fields }
  return typeof crisp === 'string' ? attachSceneNodeSerialization(node, crisp) : attachSceneNodeEmission(node, crisp)
}

export function documentClose(): DocumentMark {
  return attachSceneNodeEmission({ kind: 'document', id: 'svg-close', role: 'chrome', element: 'close' }, { kind: 'close' })
}

export { indentLines } from './serialization.ts'

/** The optional typed identity is copied without retaining caller arrays or
 * reading accessors. Other group paths keep their existing identity source. */
// Match the enclosing Scene's existing per-array ceiling without importing
// the admission/validation modules back into their mark-construction owner.
const MAX_GROUP_IDENTITY_CLASSES = 100_000

function copyGroupIdentity(input: Omit<SvgSemanticIdentity, 'role'>, role: SceneRole): SvgSemanticIdentity {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Group identity must be plain data')
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Group identity must be plain data')
  const result: SvgSemanticIdentity = { id: '', role }
  let sawId = false
  let textBytes = 0
  const consumeText = (value: string): void => {
    const remaining = SVG_EMISSION_METADATA_LIMITS.maxTextBytes - textBytes
    const bytes = boundedUtf8ByteLength(value, remaining)
    if (bytes > remaining) throw new RangeError('Group identity exceeds the UTF-8 text budget')
    textBytes += bytes
  }
  const keys = Reflect.ownKeys(input)
  if (keys.length > 4) throw new RangeError('Group identity contains too many properties')
  // The closed keys are ASCII and at most10 bytes; arbitrary names never
  // reach descriptor reads or retained copied properties.
  for (const key of keys) {
    if (typeof key !== 'string' || !['id', 'from', 'to', 'classNames'].includes(key)) throw new TypeError('Unknown group identity field')
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new TypeError('Group identity requires enumerable data properties')
    const value: unknown = descriptor.value
    if (value === undefined && key !== 'id') continue
    if (key !== 'classNames') {
      if (typeof value !== 'string') throw new TypeError('Group identity fields must be strings')
      consumeText(value)
      result[key as 'id' | 'from' | 'to'] = value
      if (key === 'id') sawId = true
      continue
    }
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('Group identity classes must be a plain array')
    const length = Object.getOwnPropertyDescriptor(value, 'length')
    if (!length || !('value' in length) || !Number.isSafeInteger(length.value) || length.value < 0) throw new TypeError('Group identity classes must have a bounded length')
    // Preflight before ownKeys and per-element descriptors, as external Scene
    // snapshot admission does. A sparse huge array needs no enumeration.
    if (length.value > MAX_GROUP_IDENTITY_CLASSES) throw new RangeError('Group identity contains too many classes')
    const classKeys = Reflect.ownKeys(value)
    if (classKeys.length !== length.value + 1 || !classKeys.includes('length')) throw new TypeError('Group identity classes must be dense data')
    const maxIndexLength = String(Math.max(0, length.value - 1)).length
    for (const key of classKeys) {
      if (key === 'length') continue
      if (typeof key !== 'string' || key.length > maxIndexLength || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length.value) throw new TypeError('Group identity classes must be dense data')
    }
    const classes: string[] = []
    for (let index = 0; index < length.value; index++) {
      const item = Object.getOwnPropertyDescriptor(value, String(index))
      if (!item || !('value' in item) || !item.enumerable || typeof item.value !== 'string') throw new TypeError('Group identity classes must contain strings')
      consumeText(item.value)
      classes.push(item.value)
    }
    result.classNames = classes
  }
  if (!sawId) throw new TypeError('Group identity requires an id')
  return result
}

export function group(fields: {
  id: string
  role: SceneRole
  owner?: SceneOwner
  visibility?: 'conditional'
  transform?: SceneTransform
  open?: string
  close?: string
  emission?: SvgGroupEmission
  identity?: Omit<SvgSemanticIdentity, 'role'>
  emissionMetadata?: SvgGroupMetadata
  children: Array<{ node: SceneNode; indent: number }>
  join?: string
  channels?: SemanticChannels
  paint?: GroupMark['paint']
}): GroupMark {
  if (fields.emission) {
    const recipe = snapshotSvgEmissionRecipe(fields.emission) as SvgGroupEmission
    const openingLimit = publicConstructionOperandsRequired() ? classConstructionOpeningLimit(fields.emission, recipe, fields.id) : undefined
    const metadataDescriptor = Object.getOwnPropertyDescriptor(fields, 'emissionMetadata')
    const identityDescriptor = Object.getOwnPropertyDescriptor(fields, 'identity')
    if (metadataDescriptor && !('value' in metadataDescriptor) || identityDescriptor && !('value' in identityDescriptor)) throw new TypeError('Typed group inputs require data properties')
    const metadata = metadataDescriptor?.value === undefined ? undefined : snapshotSvgGroupMetadata(metadataDescriptor!.value)
    const identity = identityDescriptor?.value === undefined ? emissionIdentity(recipe, fields) : copyGroupIdentity(identityDescriptor!.value, fields.role)
    const owner = fields.owner ?? { id: identity.id, role: identity.role }
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
    const node: GroupMark = { kind: 'group', id: fields.id, role: fields.role, open: '', close: '',
      children, join: fields.join ?? '\n', identity, owner,
      ...(fields.channels ? { channels: fields.channels } : {}),
      ...(fields.visibility ? { visibility: fields.visibility } : {}), ...(fields.transform ? { transform: fields.transform } : {}) }
    if (metadata) attachSvgGroupMetadata(node, metadata)
    const decorated = decorateEmission(recipe, node) as SvgGroupEmission
    attachSceneNodeEmission(node, decorated)
    if (openingLimit !== undefined) {
      const writer = new SvgWriter({ maxBytes: openingLimit })
      writeSvgGroupOpen(originalConstructionNode(node), decorated, writer)
      const open = writer.finish()
      node.open = open
      node.close = '</g>'
      return node
    }
    return attachGroupEmissionViews(node, decorated)
  }
  if (Object.hasOwn(fields, 'identity') || Object.hasOwn(fields, 'emissionMetadata')) throw new TypeError('Group identity and emission metadata require a typed program')
  if (typeof fields.open !== 'string' || typeof fields.close !== 'string') throw new TypeError('Group requires open/close strings or typed emission')
  assertInertGroupOpen(fields.id, fields.open, fields.transform)
  const join = fields.join ?? '\n'
  const identity = semanticIdentityForSvg(fields.open, fields)
  const cascade = fields.paint && [
    ...(fields.paint.opacity !== undefined ? [`opacity="${escapeAttr(fields.paint.opacity)}"`] : []),
    ...(fields.paint.fill !== undefined ? [`fill="${escapeAttr(fields.paint.fill)}"`] : []),
  ].join(' ')
  const painted = cascade ? fields.open.replace(/^<g\b/, `<g ${cascade}`) : fields.open
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
  return admitWritableSceneNode({
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
    ...(fields.paint ? { paint: fields.paint } : {}),
  })
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
}, svg: string | SvgEmissionRecipe): DocumentMark {
  const node: DocumentMark = {
    kind: 'document',
    element: 'open',
    id: fields.id,
    role: 'prelude',
  }
  return typeof svg === 'string' ? attachSceneNodeSerialization(node, svg) : attachSceneNodeEmission(node, svg)
}

/** Lower bounded, source-owned icon paths without recovering geometry from SVG.
 * Each path carries the paint; the group's open tag carries hooks and the
 * transform only. */
export function pathArtwork(fields: {
  id: string
  paths: readonly string[]
  open: string
  paint: MarkPaint
  transform?: SceneTransform
  owner?: SceneOwner
  channels?: SemanticChannels
  join?: string
  indent?: number
}): GroupMark {
  return group({
    id: fields.id, role: 'icon', open: fields.open, close: '</g>',
    ...(fields.transform ? { transform: fields.transform } : {}),
    ...(fields.owner ? { owner: fields.owner } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    join: fields.join ?? '',
    children: fields.paths.map((path, index) => ({
      indent: fields.indent ?? 0,
      node: shape({ id: semanticChildId(fields.id, 'path', index), role: 'icon',
        geometry: { kind: 'path', d: path }, paint: fields.paint,
        ...(fields.owner ? { owner: fields.owner } : {}),
      }),
    })),
  })
}
