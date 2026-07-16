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
  Geometry, MarkPaint, MarkerDescriptor,
  SceneNode, SceneRole, SceneTransform, SemanticChannels, ShapeMark, TextMark,
} from './ir.ts'
import type { DiagramColors } from '../theme.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import { ensureSvgIdentity, semanticIdentityForSvg } from './identity.ts'
import { ensureSvgAccessibility, relationAccessibility, relationAccessibilityForSvg } from './accessibility.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import {
  connectorContourSemantics,
  connectorGeometryHasCurves,
  connectorMidpoints,
  connectorSubpaths,
  pathMoveCount,
  sameConnectorPoint,
} from './connector-geometry.ts'
import { deriveConnectorTerminalProjection } from './connector-terminal.ts'
import {
  attachSceneNodeSerialization,
  canonicalizeSceneNodeSerialization,
  sceneNodeSerialization,
} from './serialization.ts'

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
  return attachSceneNodeSerialization({ kind: 'shape', identity, accessibility, ...fields }, decorated)
}

export interface ConnectorFields {
  id: string
  role: SceneRole
  geometry: ConnectorGeometry
  lineStyle: ConnectorMark['lineStyle']
  paint: MarkPaint
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
  channels?: SemanticChannels
  transform?: SceneTransform
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

/** Add a missing typed marker attachment to a connector serialization so typed
 * markers cannot survive bounds/terminal projection while disappearing graphically. */
function ensureConnectorMarkerProjection(
  crisp: string,
  markerIds: Readonly<{ start?: string; mid?: string; end?: string }>,
): string {
  if (crisp === '') return crisp
  let projected = crisp
  for (const [position, markerId] of Object.entries(markerIds)) {
    if (!markerId) continue
    const attribute = `marker-${position}`
    const opening = projected.match(/^\s*<(?:line|polyline|path)\b[^>]*>/)?.[0]
    if (!opening || new RegExp(`\\s${attribute}=`).test(opening)) continue
    projected = projected.replace(opening, opening.replace(/\s*\/?>$/, ending => ` ${attribute}="url(#${escapeAttr(markerId)})"${ending}`))
  }
  return projected
}

function ensureConnectorTransformProjection(crisp: string, transform: SceneTransform | undefined): string {
  if (crisp === '' || !transform) return crisp
  const opening = crisp.match(/^\s*<(?:line|polyline|path)\b[^>]*>/)?.[0]
  if (!opening || /\stransform=/.test(opening)) return crisp
  const value = `rotate(${transform.angle} ${transform.cx} ${transform.cy})`
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
  const attrs: string[] = [
    `data-id="${escapeAttr(label.id ?? `${connectorId}-label-${index + 1}`)}"`,
    'data-role="label"',
    `data-connector-label-for="${escapeAttr(connectorId)}"`,
    `x="${label.anchor.x}"`,
    `y="${label.anchor.y - Math.max(0, label.clearance ?? 0)}"`,
    `font-size="${label.fontSize}"`,
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
  return `<text ${attrs.join(' ')}>${escapeXml(label.text)}</text>`
}

export function connector(fields: ConnectorFields, crisp: string): ConnectorMark {
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
  const labels = fields.labels ?? []
  const identity: SvgSemanticIdentity = {
    id: fields.identity?.id ?? fields.id,
    role: fields.role,
    ...(fields.identity?.classNames ? { classNames: fields.identity.classNames } : {}),
    ...(fields.identity?.from ?? endpoints.from ? { from: fields.identity?.from ?? endpoints.from } : {}),
    ...(fields.identity?.to ?? endpoints.to ? { to: fields.identity?.to ?? endpoints.to } : {}),
  }
  const accessibility = relationAccessibility(identity, labels[0]?.text)
  const projectedMarkers = ensureConnectorMarkerProjection(crisp, {
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
    ...(accessibility ? { accessibility } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    ...(fields.transform ? { transform: fields.transform } : {}),
  }
  return attachSceneNodeSerialization(result, decorated)
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
  return attachSceneNodeSerialization({ kind: 'text', identity, accessibility, ...fields }, decorated)
}

export function documentContent(fields: {
  id: string
  role: SceneRole
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
  fields: { id: string; markerResources?: readonly MarkerDescriptor[] },
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
  open: string
  close: string
  children: Array<{ node: SceneNode; indent: number }>
  join?: string
  channels?: SemanticChannels
}): GroupMark {
  const join = fields.join ?? '\n'
  const identity = semanticIdentityForSvg(fields.open, fields)
  // Relation accessibility belongs to the typed ConnectorMark. Composite
  // wrappers may carry grouping metadata, but must not create a second ARIA
  // relation beside the connector authority.
  const open = canonicalizeSceneNodeSerialization(ensureSvgIdentity(fields.open, identity))
  const segments: string[] = [open]
  for (const child of fields.children) {
    segments.push(indentLines(sceneNodeSerialization(child.node), child.indent))
  }
  segments.push(fields.close)
  return attachSceneNodeSerialization({
    kind: 'group',
    id: fields.id,
    role: fields.role,
    open,
    close: fields.close,
    children: fields.children,
    join,
    channels: fields.channels,
    identity,
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
