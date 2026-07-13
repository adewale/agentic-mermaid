/**
 * Safe, declarative Scene construction for external diagram families.
 *
 * The compatibility-only `crisp`, `raw`, and `prelude` fields in SceneDoc are
 * deliberately not inputs here. This compiler owns their SVG projection so
 * extensions cannot smuggle markup, CSS, or fetching references into a
 * backend. The result is the same SceneDoc consumed by built-in backends; this
 * is a construction surface, not a parallel rendering pipeline.
 */

import type { DiagramColors } from '../theme.ts'
import { buildStyleBlock, svgOpenTag } from '../theme.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import { parseExtensionId } from '../shared/extension-identity.ts'
import type {
  ConnectorDirection,
  ConnectorGeometry,
  ConnectorLabelDescriptor,
  Geometry,
  MarkPaint,
  MarkerDescriptor,
  SceneDoc,
  ScenePoint,
  SceneRole,
  SemanticChannels,
} from './ir.ts'
import * as marks from './marks.ts'
import { serializeMarkerResources } from './marker-resources.ts'
import { SCENE_VALIDATION_LIMITS, assertValidSceneDoc } from './scene-validation.ts'

/** Version of the declarative external Scene builder input contract. */
export const EXTERNAL_SCENE_API_VERSION = 1 as const

export type ExternalSceneGeometry = Extract<Geometry, {
  kind: 'rect' | 'circle' | 'ellipse' | 'line' | 'polygon' | 'polyline'
}>

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
  readonly geometry: ConnectorGeometry
  readonly from: string
  readonly to: string
  readonly lineStyle?: 'solid' | 'dotted' | 'dashed' | 'thick' | 'invisible'
  readonly paint?: MarkPaint
  readonly startMarker?: string
  readonly endMarker?: string
  readonly relationship?: {
    readonly kind: string
    readonly direction?: ConnectorDirection
  }
  readonly labels?: readonly ConnectorLabelDescriptor[]
}

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

function number(value: number): string {
  return String(value)
}

function pointList(points: readonly ScenePoint[]): string {
  return points.map(point => `${number(point.x)},${number(point.y)}`).join(' ')
}

function paintAttributes(paint: MarkPaint): string {
  const attributes: string[] = []
  if (paint.fill !== undefined) attributes.push(`fill="${escapeAttr(paint.fill)}"`)
  if (paint.stroke !== undefined) attributes.push(`stroke="${escapeAttr(paint.stroke)}"`)
  if (paint.strokeWidth !== undefined) attributes.push(`stroke-width="${escapeAttr(paint.strokeWidth)}"`)
  if (paint.strokeDasharray !== undefined) attributes.push(`stroke-dasharray="${escapeAttr(paint.strokeDasharray)}"`)
  if (paint.strokeDashoffset !== undefined) attributes.push(`stroke-dashoffset="${escapeAttr(paint.strokeDashoffset)}"`)
  if (paint.strokeLinecap !== undefined) attributes.push(`stroke-linecap="${paint.strokeLinecap}"`)
  if (paint.strokeLinejoin !== undefined) attributes.push(`stroke-linejoin="${paint.strokeLinejoin}"`)
  if (paint.strokeMiterlimit !== undefined) attributes.push(`stroke-miterlimit="${escapeAttr(paint.strokeMiterlimit)}"`)
  if (paint.vectorEffect !== undefined) attributes.push(`vector-effect="${paint.vectorEffect}"`)
  if (paint.paintOrder !== undefined) attributes.push(`paint-order="${escapeAttr(paint.paintOrder)}"`)
  if (paint.opacity !== undefined) attributes.push(`opacity="${escapeAttr(paint.opacity)}"`)
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
}

function shapeSvg(geometry: ExternalSceneGeometry, paint: MarkPaint): string {
  const attributes = paintAttributes(paint)
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
      return `<polygon points="${pointList(geometry.points)}"${attributes} />`
    case 'polyline':
      return `<polyline points="${pointList(geometry.points)}"${attributes} />`
  }
}

function connectorGeometryAttributes(geometry: ConnectorGeometry): string {
  switch (geometry.kind) {
    case 'line':
      return `x1="${number(geometry.x1)}" y1="${number(geometry.y1)}" x2="${number(geometry.x2)}" y2="${number(geometry.y2)}"`
    case 'polyline':
      return `points="${pointList(geometry.points)}"`
    case 'path':
      return `d="${escapeAttr(geometry.d)}"`
  }
}

function connectorPaint(input: ExternalSceneConnector): MarkPaint {
  const lineStyle = input.lineStyle ?? 'solid'
  return {
    fill: 'none',
    stroke: 'var(--_line)',
    strokeWidth: lineStyle === 'thick' ? '3' : '1.5',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...(lineStyle === 'dotted' ? { strokeDasharray: '2 4' } : {}),
    ...(lineStyle === 'dashed' ? { strokeDasharray: '6 4' } : {}),
    ...(input.paint ?? {}),
  }
}

function connectorSvg(
  input: ExternalSceneConnector,
  paint: MarkPaint,
  startMarker: MarkerDescriptor | undefined,
  endMarker: MarkerDescriptor | undefined,
): string {
  if ((input.lineStyle ?? 'solid') === 'invisible') return ''
  const markerAttributes = [
    ...(startMarker ? [`marker-start="url(#${escapeAttr(startMarker.id)})"`] : []),
    ...(endMarker ? [`marker-end="url(#${escapeAttr(endMarker.id)})"`] : []),
  ]
  return `<${input.geometry.kind} ${connectorGeometryAttributes(input.geometry)}${paintAttributes(paint)}${markerAttributes.length ? ` ${markerAttributes.join(' ')}` : ''} />`
}

function compileNode(
  input: ExternalSceneNode,
  markerById: ReadonlyMap<string, MarkerDescriptor>,
  state: { count: number },
  depth: number,
): import('./ir.ts').SceneNode {
  if (depth > SCENE_VALIDATION_LIMITS.maxDepth) {
    throw new Error(`External Scene parts exceed maximum depth ${SCENE_VALIDATION_LIMITS.maxDepth}`)
  }
  if (++state.count > SCENE_VALIDATION_LIMITS.maxNodes) {
    throw new Error(`External Scene parts exceed maximum node count ${SCENE_VALIDATION_LIMITS.maxNodes}`)
  }
  if (input.kind === 'shape' || input.kind === 'data-mark') {
    const paint: MarkPaint = { fill: 'none', stroke: 'var(--_line)', strokeWidth: '1', ...(input.paint ?? {}) }
    return marks.shape({
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
    }, shapeSvg(input.geometry, paint))
  }
  if (input.kind === 'text') {
    const anchor = input.anchor ?? 'start'
    const paint: MarkPaint = { fill: 'var(--_text)', ...(input.paint ?? {}) }
    const crisp = `<text x="${number(input.x)}" y="${number(input.y)}" text-anchor="${anchor}" font-size="${number(input.fontSize)}"${paintAttributes(paint)}>${escapeXml(input.text)}</text>`
    return marks.text({
      id: input.id,
      role: input.role,
      text: input.text,
      x: input.x,
      y: input.y,
      fontSize: input.fontSize,
      anchor,
      paint,
      ...(input.channels ? { channels: input.channels } : {}),
    }, crisp)
  }
  if (input.kind === 'container') {
    return marks.group({
      id: input.id,
      role: input.role,
      open: '<g>',
      close: '</g>',
      children: input.children.map(child => ({ node: compileNode(child, markerById, state, depth + 1), indent: 2 })),
      ...(input.channels ? { channels: input.channels } : {}),
    })
  }
  const startMarker = input.startMarker === undefined ? undefined : markerById.get(input.startMarker)
  const endMarker = input.endMarker === undefined ? undefined : markerById.get(input.endMarker)
  if (input.startMarker !== undefined && !startMarker) throw new Error(`Unknown external Scene marker "${input.startMarker}"`)
  if (input.endMarker !== undefined && !endMarker) throw new Error(`Unknown external Scene marker "${input.endMarker}"`)
  const paint = connectorPaint(input)
  return marks.connector({
    id: input.id,
    role: input.role,
    geometry: input.geometry,
    lineStyle: input.lineStyle ?? 'solid',
    paint,
    endpoints: { from: input.from, to: input.to },
    relationship: input.relationship,
    markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
    labels: input.labels ?? [],
    projectAccessibilityToSvg: true,
    ...(input.channels ? { channels: input.channels } : {}),
  }, connectorSvg(input, paint, startMarker, endMarker))
}

/** Compile declarative external primitives into the one canonical SceneDoc. */
export function buildExternalScene(input: ExternalSceneInput): SceneDoc {
  if (input.version !== EXTERNAL_SCENE_API_VERSION) {
    throw new Error(`Unsupported external Scene API version ${String(input.version)}`)
  }
  const family = parseExtensionId(input.family)
  if (!family || family.kind !== 'family') throw new Error('External Scene family must use a valid "family:" id')

  // Construction happens before whole-Scene validation, so reject cyclic
  // input graphs up front rather than allowing recursive compilation or marker
  // serialization to overflow. This is only a graph-safety guard; the single
  // semantic authority remains assertValidSceneDoc below.
  const active = new WeakSet<object>()
  let inputObjects = 0
  const assertAcyclicInput = (value: unknown, depth: number): void => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return
    if (depth > SCENE_VALIDATION_LIMITS.maxDepth * 4) throw new Error('External Scene input object graph is too deeply nested')
    if (++inputObjects > SCENE_VALIDATION_LIMITS.maxNodes * 4) throw new Error('External Scene input object graph is too large')
    const object = value as object
    if (active.has(object)) throw new Error('External Scene input must be acyclic')
    active.add(object)
    for (const child of Array.isArray(value) ? value : Object.values(value)) assertAcyclicInput(child, depth + 1)
    active.delete(object)
  }
  assertAcyclicInput(input, 0)

  const markerResources = [...(input.markers ?? [])]
  const markerById = new Map(markerResources.map(marker => [marker.id, marker] as const))
  if (markerById.size !== markerResources.length) throw new Error('External Scene marker ids must be unique')

  const titleId = 'external-scene-title'
  const descriptionId = 'external-scene-description'
  const ariaIds = [titleId, ...(input.metadata.description !== undefined ? [descriptionId] : [])].join(' ')
  const colors: DiagramColors = { ...input.colors, embedFontImport: false }
  const font = colors.font ?? 'Inter'
  const root = marks.prelude({
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
  const compileState = { count: 0 }
  parts.push(...input.parts.map(part => compileNode(part, markerById, compileState, 0)), marks.documentClose())

  const scene: SceneDoc = { family: input.family, width: input.width, height: input.height, colors, parts }
  assertValidSceneDoc(scene, { mode: 'external' })
  return scene
}
