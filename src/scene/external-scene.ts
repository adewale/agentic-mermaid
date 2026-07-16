/**
 * Safe, declarative Scene construction for external diagram families.
 *
 * SVG serialization is deliberately not an input here. This compiler owns
 * the backend-private projection so
 * extensions cannot smuggle markup, CSS, or fetching references into a
 * backend. The result is the same SceneDoc consumed by built-in backends; this
 * is a construction surface, not a parallel rendering pipeline.
 */

import type { DiagramColors } from '../theme.ts'
import { buildStyleBlock, svgOpenTag } from '../theme.ts'
import { parseExtensionId } from '../shared/extension-identity.ts'
import type {
  ConnectorDirection,
  ConnectorGeometry,
  ConnectorLabelDescriptor,
  Geometry,
  MarkPaint,
  MarkerDescriptor,
  SceneDoc,
  SceneNode,
  SceneRole,
  SemanticChannels,
} from './ir.ts'
import {
  assertExternalConnectorTopology,
  externalConnectorSvg,
  externalShapeSvg,
  externalTextSvg,
} from './external-projection.ts'
import * as marks from './marks.ts'
import { connectorInlineLabelVisualBounds } from './bounds.ts'
import { assertRenderableMarker, serializeMarkerResources } from './marker-resources.ts'
import {
  SCENE_VALIDATION_LIMITS,
  assertValidSceneDoc,
} from './scene-validation.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { sceneNodeSerialization } from './serialization.ts'
import {
  EXTERNAL_SCENE_INPUT_SNAPSHOT_LIMITS,
  snapshotBoundedExternalData,
} from './external-data-snapshot.ts'

/** Version of the declarative external Scene builder input contract. */
export const EXTERNAL_SCENE_API_VERSION = 1 as const

export type ExternalSceneGeometry = Extract<Geometry, {
  kind: 'rect' | 'circle' | 'ellipse' | 'line' | 'polygon' | 'polyline'
}>

/** External Scene v1 keeps connector paths to one explicitly routed linear
 * M/L[/Z] contour whose vertices exactly equal `points`.
 * Core Scene may carry richer multi-subpath topology, but exposing it here
 * requires a future version whose declarative input can prove `d`/topology
 * agreement rather than creating two geometry authorities. */
export type ExternalSceneConnectorGeometry =
  | Extract<ConnectorGeometry, { kind: 'line' | 'polyline' }>
  | Omit<Extract<ConnectorGeometry, { kind: 'path' }>, 'subpaths' | 'markerMidpoints'>

export interface ExternalSceneNodeBase {
  readonly id: string
  readonly role: SceneRole
  readonly channels?: SemanticChannels
}

export interface ExternalSceneShape extends ExternalSceneNodeBase {
  readonly kind: 'shape'
  readonly geometry: ExternalSceneGeometry
  readonly paint?: MarkPaint
}

/** A quantitative shape. `value` makes the emitted mark claim both the
 * `shape` and `data-mark` primitives in the descriptor ledger. */
export interface ExternalSceneDataMark extends ExternalSceneNodeBase {
  readonly kind: 'data-mark'
  readonly geometry: ExternalSceneGeometry
  readonly value: number
  readonly paint?: MarkPaint
}

export interface ExternalSceneText extends ExternalSceneNodeBase {
  readonly kind: 'text'
  readonly text: string
  readonly x: number
  readonly y: number
  readonly fontSize: number
  readonly anchor?: 'start' | 'middle' | 'end'
  readonly paint?: MarkPaint
}

export interface ExternalSceneContainer extends ExternalSceneNodeBase {
  readonly kind: 'container'
  readonly children: readonly ExternalSceneNode[]
}

export interface ExternalSceneConnector extends ExternalSceneNodeBase {
  readonly kind: 'connector'
  readonly geometry: ExternalSceneConnectorGeometry
  readonly from: string
  readonly to: string
  readonly lineStyle?: 'solid' | 'dotted' | 'dashed' | 'thick' | 'invisible'
  readonly paint?: MarkPaint
  /** Typed topology for the one path contour exposed by external Scene v1. */
  readonly closed?: boolean
  readonly startMarker?: string
  /** One marker resource repeated at every typed interior route point. */
  readonly midMarker?: string
  readonly endMarker?: string
  readonly relationship?: {
    readonly kind: string
    readonly direction?: ConnectorDirection
  }
  readonly labels?: readonly ExternalSceneConnectorLabel[]
}

export type ExternalSceneConnectorLabel = Omit<ConnectorLabelDescriptor, 'visual'>

export type ExternalSceneNode =
  | ExternalSceneShape
  | ExternalSceneDataMark
  | ExternalSceneText
  | ExternalSceneContainer
  | ExternalSceneConnector

/** Typed marker resource. Marker geometry is declarative; SVG is never an
 * extension input. Unlike shape marks, markers may use path/compound geometry
 * because their bounded viewport and reference point remain explicit. */
export type ExternalSceneMarker = MarkerDescriptor & Required<Pick<MarkerDescriptor, 'geometry' | 'size' | 'ref'>>

export interface ExternalSceneDocument {
  readonly title: string
  readonly description?: string
  readonly transparent?: boolean
}

export interface ExternalSceneInput {
  readonly version: typeof EXTERNAL_SCENE_API_VERSION
  /** A registered `family:*` id. Admission later checks exact descriptor ownership. */
  readonly family: string
  readonly width: number
  readonly height: number
  readonly colors: DiagramColors
  readonly metadata: ExternalSceneDocument
  readonly markers?: readonly ExternalSceneMarker[]
  readonly parts: readonly ExternalSceneNode[]
}

type ExactKeyMap<T> = { readonly [Key in keyof Required<T>]: true }
type GeometryOf<Kind extends ExternalSceneGeometry['kind']> = Extract<ExternalSceneGeometry, { kind: Kind }>
type MarkerGeometryOf<Kind extends Geometry['kind']> = Extract<Geometry, { kind: Kind }>
type NodeOf<Kind extends ExternalSceneNode['kind']> = Extract<ExternalSceneNode, { kind: Kind }>

/** One closed authored-input vocabulary for External Scene v1. Each exact map
 * is compile-time complete: widening a reused public type requires an explicit
 * v1 admission decision instead of silently widening runtime input. */
const EXTERNAL_SCENE_V1_ALLOWED_KEYS = Object.freeze({
  input: { version: true, family: true, width: true, height: true, colors: true, metadata: true, markers: true, parts: true } satisfies ExactKeyMap<ExternalSceneInput>,
  colors: { bg: true, fg: true, line: true, accent: true, muted: true, surface: true, border: true, shadow: true, font: true, embedFontImport: true } satisfies ExactKeyMap<DiagramColors>,
  metadata: { title: true, description: true, transparent: true } satisfies ExactKeyMap<ExternalSceneDocument>,
  nodes: {
    shape: { kind: true, id: true, role: true, channels: true, geometry: true, paint: true } satisfies ExactKeyMap<NodeOf<'shape'>>,
    'data-mark': { kind: true, id: true, role: true, channels: true, geometry: true, value: true, paint: true } satisfies ExactKeyMap<NodeOf<'data-mark'>>,
    text: { kind: true, id: true, role: true, channels: true, text: true, x: true, y: true, fontSize: true, anchor: true, paint: true } satisfies ExactKeyMap<NodeOf<'text'>>,
    container: { kind: true, id: true, role: true, channels: true, children: true } satisfies ExactKeyMap<NodeOf<'container'>>,
    connector: { kind: true, id: true, role: true, channels: true, geometry: true, from: true, to: true, lineStyle: true, paint: true, closed: true, startMarker: true, midMarker: true, endMarker: true, relationship: true, labels: true } satisfies ExactKeyMap<NodeOf<'connector'>>,
  },
  geometry: {
    rect: { kind: true, x: true, y: true, width: true, height: true, rx: true, ry: true } satisfies ExactKeyMap<GeometryOf<'rect'>>,
    circle: { kind: true, cx: true, cy: true, r: true } satisfies ExactKeyMap<GeometryOf<'circle'>>,
    ellipse: { kind: true, cx: true, cy: true, rx: true, ry: true } satisfies ExactKeyMap<GeometryOf<'ellipse'>>,
    line: { kind: true, x1: true, y1: true, x2: true, y2: true } satisfies ExactKeyMap<GeometryOf<'line'>>,
    polygon: { kind: true, points: true } satisfies ExactKeyMap<GeometryOf<'polygon'>>,
    polyline: { kind: true, points: true } satisfies ExactKeyMap<GeometryOf<'polyline'>>,
    markerPath: { kind: true, d: true } satisfies ExactKeyMap<MarkerGeometryOf<'path'>>,
    connectorPath: { kind: true, d: true, points: true } satisfies ExactKeyMap<Extract<ExternalSceneConnectorGeometry, { kind: 'path' }>>,
    compound: { kind: true, children: true } satisfies ExactKeyMap<MarkerGeometryOf<'compound'>>,
  },
  point: { x: true, y: true } satisfies ExactKeyMap<{ x: number; y: number }>,
  paint: { fill: true, stroke: true, strokeWidth: true, strokeDasharray: true, strokeDashoffset: true, strokeLinecap: true, strokeLinejoin: true, strokeMiterlimit: true, vectorEffect: true, paintOrder: true, opacity: true } satisfies ExactKeyMap<MarkPaint>,
  channels: { importance: true, value: true, category: true, status: true, progress: true, route: true, emphasis: true } satisfies ExactKeyMap<SemanticChannels>,
  marker: { id: true, shape: true, geometry: true, size: true, viewBox: true, ref: true, bounds: true, units: true, orient: true, overflow: true, paint: true, scale: true } satisfies ExactKeyMap<ExternalSceneMarker>,
  markerSize: { width: true, height: true } satisfies ExactKeyMap<NonNullable<ExternalSceneMarker['size']>>,
  viewBox: { x: true, y: true, width: true, height: true } satisfies ExactKeyMap<NonNullable<ExternalSceneMarker['viewBox']>>,
  bounds: { x0: true, y0: true, x1: true, y1: true } satisfies ExactKeyMap<NonNullable<ExternalSceneMarker['bounds']>>,
  relationship: { kind: true, direction: true } satisfies ExactKeyMap<NonNullable<ExternalSceneConnector['relationship']>>,
  label: { id: true, text: true, anchor: true, bounds: true, halo: true, clearance: true, paint: true, fontSize: true, textAnchor: true } satisfies ExactKeyMap<ExternalSceneConnectorLabel>,
  halo: { color: true, width: true } satisfies ExactKeyMap<NonNullable<ExternalSceneConnectorLabel['halo']>>,
})

/** External Scene is a declarative JSON-like boundary. Admit the complete
 * object graph into a bounded data-property snapshot before any map, spread,
 * iterator, recursive compiler, or marker serializer can run. Compilation
 * must consume this snapshot rather than reading an untrusted Proxy a second
 * time after validation. */
function admitBoundedPlainExternalInput(value: unknown): ExternalSceneInput {
  const snapshot = snapshotBoundedExternalData(
    value,
    EXTERNAL_SCENE_INPUT_SNAPSHOT_LIMITS,
    'input',
  )
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('External Scene input must be a plain object')
  }
  const input = snapshot as Record<string, unknown>
  if (!Array.isArray(input.parts)) throw new TypeError('External Scene parts must be a plain array')
  if (input.markers !== undefined && !Array.isArray(input.markers)) {
    throw new TypeError('External Scene markers must be a plain array')
  }
  assertExternalSceneInputShape(input)
  return snapshot as ExternalSceneInput
}

function externalRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`External Scene ${path} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function rejectExternalUnknownKeys(
  value: Record<string, unknown>,
  allowed: Readonly<Record<string, true>>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(allowed, key)) {
      throw new TypeError(`External Scene ${path}.${key} is not part of the v1 input contract`)
    }
  }
}

function rejectOptionalExternalRecord(
  value: unknown,
  allowed: Readonly<Record<string, true>>,
  path: string,
): void {
  if (value === undefined) return
  rejectExternalUnknownKeys(externalRecord(value, path), allowed, path)
}

function externalArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`External Scene ${path} must be a plain array`)
  return value
}

function externalString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`External Scene ${path} must be a string`)
}

function externalFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`External Scene ${path} must be a finite number`)
  }
}

function assertExternalPoint(value: unknown, path: string): void {
  const point = externalRecord(value, path)
  rejectExternalUnknownKeys(point, EXTERNAL_SCENE_V1_ALLOWED_KEYS.point, path)
  externalFinite(point.x, `${path}.x`)
  externalFinite(point.y, `${path}.y`)
}

function assertExternalGeometry(
  value: unknown,
  path: string,
  allowedKinds: readonly string[],
  connectorPath = false,
): void {
  const geometry = externalRecord(value, path)
  externalString(geometry.kind, `${path}.kind`)
  if (!allowedKinds.includes(geometry.kind)) {
    throw new TypeError(`External Scene ${path}.kind must be one of: ${allowedKinds.join(', ')}`)
  }
  const geometryKeys = geometry.kind === 'path'
    ? (connectorPath ? EXTERNAL_SCENE_V1_ALLOWED_KEYS.geometry.connectorPath : EXTERNAL_SCENE_V1_ALLOWED_KEYS.geometry.markerPath)
    : EXTERNAL_SCENE_V1_ALLOWED_KEYS.geometry[geometry.kind as Exclude<keyof typeof EXTERNAL_SCENE_V1_ALLOWED_KEYS.geometry, 'markerPath' | 'connectorPath'>]
  rejectExternalUnknownKeys(geometry, geometryKeys, path)
  const numbers = (...fields: string[]) => {
    for (const field of fields) externalFinite(geometry[field], `${path}.${field}`)
  }
  switch (geometry.kind) {
    case 'rect':
      numbers('x', 'y', 'width', 'height')
      if (geometry.rx !== undefined) externalFinite(geometry.rx, `${path}.rx`)
      if (geometry.ry !== undefined) externalFinite(geometry.ry, `${path}.ry`)
      return
    case 'circle': numbers('cx', 'cy', 'r'); return
    case 'ellipse': numbers('cx', 'cy', 'rx', 'ry'); return
    case 'line': numbers('x1', 'y1', 'x2', 'y2'); return
    case 'polygon':
    case 'polyline': {
      const points = externalArray(geometry.points, `${path}.points`)
      for (let index = 0; index < points.length; index++) assertExternalPoint(points[index], `${path}.points[${index}]`)
      return
    }
    case 'path': {
      externalString(geometry.d, `${path}.d`)
      if (connectorPath) {
        const points = externalArray(geometry.points, `${path}.points`)
        for (let index = 0; index < points.length; index++) assertExternalPoint(points[index], `${path}.points[${index}]`)
      }
      return
    }
    case 'compound': {
      const children = externalArray(geometry.children, `${path}.children`)
      for (let index = 0; index < children.length; index++) {
        assertExternalGeometry(children[index], `${path}.children[${index}]`, [
          'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'compound',
        ])
      }
    }
  }
}

function assertExternalNode(value: unknown, path: string): void {
  const node = externalRecord(value, path)
  externalString(node.kind, `${path}.kind`)
  externalString(node.id, `${path}.id`)
  externalString(node.role, `${path}.role`)
  if (!['shape', 'data-mark', 'text', 'container', 'connector'].includes(node.kind)) {
    throw new TypeError(`External Scene ${path}.kind must be one of: shape, data-mark, text, container, connector`)
  }
  rejectExternalUnknownKeys(
    node,
    EXTERNAL_SCENE_V1_ALLOWED_KEYS.nodes[node.kind as ExternalSceneNode['kind']],
    path,
  )
  rejectOptionalExternalRecord(node.channels, EXTERNAL_SCENE_V1_ALLOWED_KEYS.channels, `${path}.channels`)
  rejectOptionalExternalRecord(node.paint, EXTERNAL_SCENE_V1_ALLOWED_KEYS.paint, `${path}.paint`)
  if (node.kind === 'shape' || node.kind === 'data-mark') {
    assertExternalGeometry(node.geometry, `${path}.geometry`, [
      'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline',
    ])
    if (node.kind === 'data-mark') externalFinite(node.value, `${path}.value`)
    return
  }
  if (node.kind === 'text') {
    externalString(node.text, `${path}.text`)
    externalFinite(node.x, `${path}.x`)
    externalFinite(node.y, `${path}.y`)
    externalFinite(node.fontSize, `${path}.fontSize`)
    return
  }
  if (node.kind === 'container') {
    const children = externalArray(node.children, `${path}.children`)
    for (let index = 0; index < children.length; index++) assertExternalNode(children[index], `${path}.children[${index}]`)
    return
  }
  assertExternalGeometry(node.geometry, `${path}.geometry`, ['line', 'polyline', 'path'], true)
  rejectOptionalExternalRecord(node.relationship, EXTERNAL_SCENE_V1_ALLOWED_KEYS.relationship, `${path}.relationship`)
  if (typeof node.from !== 'string') {
    throw new TypeError(`External Scene ${path}.from is required for external connectors and must be a string`)
  }
  if (typeof node.to !== 'string') {
    throw new TypeError(`External Scene ${path}.to is required for external connectors and must be a string`)
  }
  if (node.labels !== undefined) {
    const labels = externalArray(node.labels, `${path}.labels`)
    for (let index = 0; index < labels.length; index++) {
      const labelPath = `${path}.labels[${index}]`
      const label = externalRecord(labels[index], labelPath)
      rejectExternalUnknownKeys(label, EXTERNAL_SCENE_V1_ALLOWED_KEYS.label, labelPath)
      externalString(label.text, `${labelPath}.text`)
      if (label.anchor !== undefined) assertExternalPoint(label.anchor, `${labelPath}.anchor`)
      rejectOptionalExternalRecord(label.bounds, EXTERNAL_SCENE_V1_ALLOWED_KEYS.bounds, `${labelPath}.bounds`)
      rejectOptionalExternalRecord(label.halo, EXTERNAL_SCENE_V1_ALLOWED_KEYS.halo, `${labelPath}.halo`)
      rejectOptionalExternalRecord(label.paint, EXTERNAL_SCENE_V1_ALLOWED_KEYS.paint, `${labelPath}.paint`)
    }
  }
}

function assertExternalSceneInputShape(input: Record<string, unknown>): void {
  rejectExternalUnknownKeys(input, EXTERNAL_SCENE_V1_ALLOWED_KEYS.input, 'input')
  externalFinite(input.width, 'input.width')
  externalFinite(input.height, 'input.height')
  externalString(input.family, 'input.family')
  const colors = externalRecord(input.colors, 'input.colors')
  rejectExternalUnknownKeys(colors, EXTERNAL_SCENE_V1_ALLOWED_KEYS.colors, 'input.colors')
  externalString(colors.bg, 'input.colors.bg')
  externalString(colors.fg, 'input.colors.fg')
  const metadata = externalRecord(input.metadata, 'input.metadata')
  rejectExternalUnknownKeys(metadata, EXTERNAL_SCENE_V1_ALLOWED_KEYS.metadata, 'input.metadata')
  externalString(metadata.title, 'input.metadata.title')
  if (metadata.description !== undefined) externalString(metadata.description, 'input.metadata.description')
  if (metadata.transparent !== undefined && typeof metadata.transparent !== 'boolean') {
    throw new TypeError('External Scene input.metadata.transparent must be boolean')
  }
  const parts = externalArray(input.parts, 'input.parts')
  for (let index = 0; index < parts.length; index++) assertExternalNode(parts[index], `input.parts[${index}]`)
  if (input.markers !== undefined) {
    const markers = externalArray(input.markers, 'input.markers')
    for (let index = 0; index < markers.length; index++) {
      const path = `input.markers[${index}]`
      const marker = externalRecord(markers[index], path)
      rejectExternalUnknownKeys(marker, EXTERNAL_SCENE_V1_ALLOWED_KEYS.marker, path)
      externalString(marker.id, `${path}.id`)
      assertExternalGeometry(marker.geometry, `${path}.geometry`, [
        'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'compound',
      ])
      rejectOptionalExternalRecord(marker.size, EXTERNAL_SCENE_V1_ALLOWED_KEYS.markerSize, `${path}.size`)
      rejectOptionalExternalRecord(marker.viewBox, EXTERNAL_SCENE_V1_ALLOWED_KEYS.viewBox, `${path}.viewBox`)
      if (marker.ref !== undefined) assertExternalPoint(marker.ref, `${path}.ref`)
      rejectOptionalExternalRecord(marker.bounds, EXTERNAL_SCENE_V1_ALLOWED_KEYS.bounds, `${path}.bounds`)
      rejectOptionalExternalRecord(marker.paint, EXTERNAL_SCENE_V1_ALLOWED_KEYS.paint, `${path}.paint`)
      assertRenderableMarker(marker as unknown as MarkerDescriptor)
    }
  }
}

function connectorPaint(input: ExternalSceneConnector): MarkPaint {
  const lineStyle = input.lineStyle ?? 'solid'
  const supplied = input.paint ?? {}
  return {
    fill: 'none',
    stroke: supplied.stroke ?? 'var(--_line)',
    strokeWidth: supplied.strokeWidth ?? (lineStyle === 'thick' ? '3' : '1.5'),
    ...(supplied.opacity === undefined ? {} : { opacity: supplied.opacity }),
    ...(supplied.strokeDasharray !== undefined
      ? { strokeDasharray: supplied.strokeDasharray }
      : lineStyle === 'dotted'
        ? { strokeDasharray: '2 4' }
        : lineStyle === 'dashed'
          ? { strokeDasharray: '6 4' }
          : {}),
    ...(supplied.strokeDashoffset === undefined ? {} : { strokeDashoffset: supplied.strokeDashoffset }),
    strokeLinecap: supplied.strokeLinecap ?? 'round',
    strokeLinejoin: supplied.strokeLinejoin ?? 'round',
    strokeMiterlimit: supplied.strokeMiterlimit ?? '4',
    ...(supplied.vectorEffect === undefined ? {} : { vectorEffect: supplied.vectorEffect }),
    ...(supplied.paintOrder === undefined ? {} : { paintOrder: supplied.paintOrder }),
  }
}

interface ExternalCompileState {
  count: number
  serializationBytes: number
}

function accountCompiledNode<T extends SceneNode>(node: T, state: ExternalCompileState): T {
  if (++state.count > SCENE_VALIDATION_LIMITS.maxNodes) {
    throw new Error(`External Scene compilation exceeds maximum node count ${SCENE_VALIDATION_LIMITS.maxNodes}`)
  }
  const remaining = Math.max(0, SCENE_VALIDATION_LIMITS.maxAggregateSerializationBytes - state.serializationBytes)
  const bytes = boundedUtf8ByteLength(sceneNodeSerialization(node), remaining)
  if (bytes > remaining) {
    throw new Error(`External Scene serializations exceed the aggregate ${SCENE_VALIDATION_LIMITS.maxAggregateSerializationBytes}-byte limit`)
  }
  state.serializationBytes += bytes
  return node
}

function compileNode(
  input: ExternalSceneNode,
  markerById: ReadonlyMap<string, MarkerDescriptor>,
  state: ExternalCompileState,
  depth: number,
): readonly import('./ir.ts').SceneNode[] {
  if (depth > SCENE_VALIDATION_LIMITS.maxDepth) {
    throw new Error(`External Scene parts exceed maximum depth ${SCENE_VALIDATION_LIMITS.maxDepth}`)
  }
  if (input.kind === 'shape' || input.kind === 'data-mark') {
    const paint: MarkPaint = { fill: 'none', stroke: 'var(--_line)', strokeWidth: '1', ...(input.paint ?? {}) }
    return [accountCompiledNode(marks.shape({
      id: input.id,
      role: input.role,
      geometry: input.geometry,
      paint,
      ...(() => {
        const channels = input.kind === 'data-mark'
          ? { ...(input.channels ?? {}), value: input.value }
          : input.channels
        return channels ? { channels } : {}
      })(),
    }, externalShapeSvg(input.geometry, paint)), state)]
  }
  if (input.kind === 'text') {
    const anchor = input.anchor ?? 'start'
    const paint: MarkPaint = { fill: 'var(--_text)', ...(input.paint ?? {}) }
    const crisp = externalTextSvg({ ...input, anchor, paint })
    return [accountCompiledNode(marks.text({
      id: input.id,
      role: input.role,
      text: input.text,
      x: input.x,
      y: input.y,
      fontSize: input.fontSize,
      anchor,
      paint,
      ...(input.channels ? { channels: input.channels } : {}),
    }, crisp), state)]
  }
  if (input.kind === 'container') {
    return [accountCompiledNode(marks.group({
      id: input.id,
      role: input.role,
      open: '<g>',
      close: '</g>',
      children: input.children.flatMap(child => compileNode(child, markerById, state, depth + 1).map(node => ({ node, indent: 2 }))),
      ...(input.channels ? { channels: input.channels } : {}),
    }), state)]
  }
  const startMarker = input.startMarker === undefined ? undefined : markerById.get(input.startMarker)
  const midMarker = input.midMarker === undefined ? undefined : markerById.get(input.midMarker)
  const endMarker = input.endMarker === undefined ? undefined : markerById.get(input.endMarker)
  if (input.startMarker !== undefined && !startMarker) throw new Error(`Unknown external Scene marker "${input.startMarker}"`)
  if (input.midMarker !== undefined && !midMarker) throw new Error(`Unknown external Scene marker "${input.midMarker}"`)
  if (input.endMarker !== undefined && !endMarker) throw new Error(`Unknown external Scene marker "${input.endMarker}"`)
  if (input.closed !== undefined && typeof input.closed !== 'boolean') {
    throw new TypeError(`External Scene connector "${input.id}" closed must be boolean`)
  }
  if (input.geometry.kind !== 'path' && input.closed !== undefined) {
    throw new TypeError(`External Scene connector "${input.id}" closed is only valid for path geometry`)
  }
  const closed = input.closed ?? false
  assertExternalConnectorTopology(input.geometry, closed)
  if (midMarker && input.geometry.kind === 'path') {
    throw new TypeError(`External Scene v1 connector "${input.id}" cannot attach marker-mid to path geometry because v1 does not expose exact SVG marker vertices`)
  }
  const paint = connectorPaint(input)
  const routePoints = input.geometry.kind === 'line'
    ? [{ x: input.geometry.x1, y: input.geometry.y1 }, { x: input.geometry.x2, y: input.geometry.y2 }]
    : input.geometry.points
  const first = routePoints[0]
  const last = routePoints.at(-1)
  const defaultAnchor = first && last
    ? { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
    : { x: 0, y: 0 }
  const labels: ConnectorLabelDescriptor[] = (input.labels ?? []).map(label => ({
    ...label,
    anchor: label.anchor ?? defaultAnchor,
    paint: { fill: 'var(--_text)', ...(label.paint ?? {}) },
    fontSize: label.fontSize ?? 12,
    textAnchor: label.textAnchor ?? 'middle',
    visual: { kind: 'inline' },
  }))
  for (const [index, label] of labels.entries()) {
    if (!label.bounds) continue
    const visual = connectorInlineLabelVisualBounds(label)
    if (visual && (
      label.bounds.x0 > visual.x0 || label.bounds.y0 > visual.y0
      || label.bounds.x1 < visual.x1 || label.bounds.y1 < visual.y1
    )) {
      throw new RangeError(`External Scene connector "${input.id}" label ${index + 1} bounds must cover its inline visual geometry`)
    }
  }
  const connectorNode = accountCompiledNode(marks.connector({
    id: input.id,
    role: input.role,
    geometry: input.geometry,
    lineStyle: input.lineStyle ?? 'solid',
    paint,
    endpoints: { from: input.from, to: input.to },
    relationship: input.relationship,
    route: { closed },
    markers: { ...(startMarker ? { start: startMarker } : {}), mid: midMarker ? [midMarker] : [], ...(endMarker ? { end: endMarker } : {}) },
    labels,
    ...(input.channels ? { channels: input.channels } : {}),
  }, externalConnectorSvg({
    geometry: input.geometry,
    lineStyle: input.lineStyle ?? 'solid',
    paint,
  }, startMarker, midMarker, endMarker)), state)

  return [connectorNode]
}

/** Compile declarative external primitives into the one canonical SceneDoc. */
export function buildExternalScene(untrustedInput: ExternalSceneInput): SceneDoc {
  const input = admitBoundedPlainExternalInput(untrustedInput)
  if (input.version !== EXTERNAL_SCENE_API_VERSION) {
    throw new Error(`Unsupported external Scene API version ${String(input.version)}`)
  }
  const family = parseExtensionId(input.family)
  if (!family || family.kind !== 'family') throw new Error('External Scene family must use a valid "family:" id')

  const markerResources: ExternalSceneMarker[] = []
  if (input.markers) {
    for (let index = 0; index < input.markers.length; index++) markerResources.push(input.markers[index]!)
  }
  const markerById = new Map(markerResources.map(marker => [marker.id, marker] as const))
  if (markerById.size !== markerResources.length) throw new Error('External Scene marker ids must be unique')

  const titleId = 'external-scene-title'
  const descriptionId = 'external-scene-description'
  const ariaIds = [titleId, ...(input.metadata.description !== undefined ? [descriptionId] : [])].join(' ')
  const colors: DiagramColors = { ...input.colors, embedFontImport: false }
  const font = colors.font ?? 'Inter'
  const root = marks.documentOpen({
    id: 'external-scene-prelude',
    width: input.width,
    height: input.height,
    colors,
    transparent: input.metadata.transparent ?? false,
    font,
    hasMonoFont: false,
  }, [
    svgOpenTag(input.width, input.height, colors, input.metadata.transparent, {
      attrs: { role: 'img', 'aria-labelledby': ariaIds },
    }),
    buildStyleBlock(font, false, colors.shadow, false),
  ].join('\n'))

  const parts: SceneDoc['parts'] = [
    root,
    marks.documentText({ id: titleId, element: 'title', text: input.metadata.title, domId: titleId }),
  ]
  if (input.metadata.description !== undefined) {
    parts.push(marks.documentText({
      id: descriptionId,
      element: 'description',
      text: input.metadata.description,
      domId: descriptionId,
    }))
  }
  if (markerResources.length > 0) {
    parts.push(marks.definitions(
      { id: 'external-scene-definitions', markerResources },
      `<defs>\n${serializeMarkerResources(markerResources)}\n</defs>`,
    ))
  }
  const compileState: ExternalCompileState = { count: 0, serializationBytes: 0 }
  for (let index = 0; index < input.parts.length; index++) {
    parts.push(...compileNode(input.parts[index]!, markerById, compileState, 0))
  }
  parts.push(marks.documentClose())

  const scene: SceneDoc = {
    family: input.family,
    width: input.width,
    height: input.height,
    colors,
    transparent: input.metadata.transparent ?? false,
    parts,
  }
  assertValidSceneDoc(scene, { mode: 'external' })
  return scene
}
