import { isAdmittedSceneDocument } from './scene-admission-state.ts'
import { tryParseCssColor } from '../shared/color-math.ts'
import type { ConnectorMark, MarkPaint, SceneDoc, SceneNode, SceneOwner, SceneRole, SceneTransform, ShapeMark, TextMark } from './ir.ts'
import { connectorInlineLabelVisualBounds, nodePaintBounds, transformedBounds } from './bounds.ts'
import { composeMatrices, IDENTITY_MATRIX, transformMatrix, type AffineMatrix } from './transforms.ts'
import { sceneNodeSerialization, beginSceneWriteInspection, type SceneWriteReceipt, type SceneWriteWork } from './serialization.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'

export interface ScenePaintPrimitive {
  readonly key: string
  readonly id: string
  readonly role: SceneRole
  readonly kind: SceneNode['kind']
  readonly owner: SceneOwner
  readonly ancestors: readonly SceneOwner[]
  readonly order: number
  readonly coverage: 'measured' | 'unmeasured' | 'non-painting'
  readonly bounds?: AxisAlignedBox
  readonly reason?: string
  readonly visibility?: 'conditional'
  /** Opacity the enclosing groups composite this primitive with, when below 1. */
  readonly groupOpacity?: number
  readonly text?: {
    readonly source: string
    readonly displayed: string
    readonly measurement: 'prepared' | 'fallback' | 'unavailable'
    readonly fontFamily?: string
  }
}

export interface ScenePaintInspection {
  readonly version: 1
  readonly family: string
  readonly bounds: { readonly width: number; readonly height: number }
  readonly primitives: readonly ScenePaintPrimitive[]
  readonly coverage: {
    readonly measured: number
    readonly unmeasured: number
    readonly nonPainting: number
    readonly preparedText: number
    readonly fallbackText: number
  }
}

/** Geometry needed for mandatory paint safety, without the retained text
 * read-back strings used only by inspection consumers. */
export type ScenePaintGeometry = Omit<ScenePaintPrimitive, 'text'> & {
  readonly text?: Pick<NonNullable<ScenePaintPrimitive['text']>, 'measurement'>
}
export type ScenePaintGeometryInspection = Omit<ScenePaintInspection, 'primitives'> & {
  readonly primitives: readonly ScenePaintGeometry[]
}

const sources = new WeakMap<ScenePaintGeometry, Exclude<SceneNode, { kind: 'group' }>>()
/** Only fields consumed by final paint certification, never a retained Scene tree. */
export type NativeConnectorPaintSource = Pick<ConnectorMark, 'kind' | 'lineStyle' | 'endpoints' | 'route' | 'stroke' | 'markers' | 'transform'>
export type NativePaintSource = Pick<ShapeMark, 'kind' | 'geometry' | 'paint' | 'childPaints' | 'transform'>
  | NativeConnectorPaintSource | Pick<TextMark, 'kind' | 'paint'> | { readonly kind: 'document' }
const nativeSources = new WeakMap<ScenePaintGeometry, NativePaintSource>()
export function paintPrimitiveSource(primitive: ScenePaintGeometry): NativePaintSource | undefined {
  return nativeSources.get(primitive) ?? sources.get(primitive)
}

const scenePathOccurrences = new WeakSet<ScenePaintGeometry>()
const sceneWriteOccurrences = new WeakSet<ScenePaintGeometry>()
export function hasSceneWriteEmissionOccurrence(primitive: ScenePaintGeometry): boolean { return sceneWriteOccurrences.has(primitive) }
const sceneWriteWork = new WeakMap<ScenePaintGeometryInspection, SceneWriteWork>()
export function hasScenePathEmissionOccurrence(primitive: ScenePaintGeometry): boolean { return scenePathOccurrences.has(primitive) }
export function scenePathEmissionWorkOf(inspection: ScenePaintGeometryInspection): SceneWriteWork | undefined { return sceneWriteWork.get(inspection) }

const worldMatrices = new WeakMap<ScenePaintGeometry, AffineMatrix>()
const immutablePaintRosters = new WeakSet<ScenePaintGeometryInspection>()
/** Only the recorder's actual frozen occurrence array may be shared by later
 * same-emission consumers. There is no public issuer for this custody fact. */
export function hasImmutablePaintRoster(inspection: ScenePaintGeometryInspection): boolean { return immutablePaintRosters.has(inspection) }
const untransformedPrimitives = new WeakSet<ScenePaintGeometry>()
const IDENTITY_PAINT_MATRIX: AffineMatrix = Object.freeze([1, 0, 0, 1, 0, 0])
export function scenePrimitiveMatrix(primitive: ScenePaintGeometry): AffineMatrix | undefined { return worldMatrices.get(primitive) }
/** Absence of transforms, rather than cancellation of composed matrices. */
export function scenePrimitiveUntransformed(primitive: ScenePaintGeometry): boolean { return untransformedPrimitives.has(primitive) }

export function scenePrimitiveSource(primitive: ScenePaintGeometry): SceneNode | undefined {
  return sources.get(primitive)
}

function finite(box: AxisAlignedBox): boolean {
  return [box.x0, box.x1, box.y0, box.y1].every(Number.isFinite) && box.x0 <= box.x1 && box.y0 <= box.y1
}

function absentPaint(value: string | undefined): boolean {
  return value === 'none' || value === 'transparent' || !!value && tryParseCssColor(value)?.[3] === 0
}

/** SVG clamps each group's numeric opacity before compositing. Dynamic CSS
 * stays unknown; treating it as the omitted default would invent opaque ink. */
export function sceneGroupOpacity(value: string | undefined): number {
  if (value === undefined) return 1
  const text = value.trim()
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number.NaN
  const opacity = Number(text)
  return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : Number.NaN
}

export function multiplySceneOpacity(left: number, right: number): number {
  return left === 0 || right === 0 ? 0 : left * right
}
function textPaints(hasText: boolean, paint: MarkPaint): boolean {
  return hasText && Number(paint.opacity ?? 1) !== 0 && (!absentPaint(paint.fill) || paint.stroke !== undefined && !absentPaint(paint.stroke) && Number.parseFloat(paint.strokeWidth ?? '1') !== 0)
}

/** A representative paint for inspection display. Compound fill coverage and
 * opacity must be checked per emitted child; this is not their union proof. */
export function shapeSurfacePaint(node: Pick<ShapeMark, 'paint' | 'childPaints'>): MarkPaint {
  return node.childPaints?.find(paint => !absentPaint(paint.fill) && Number(paint.opacity ?? 1) !== 0) ?? node.paint
}

function nonPainting(node: SceneNode): boolean {
  if (node.kind === 'document') return node.element !== 'content' || node.nonPaint !== undefined || sceneNodeSerialization(node).trim() === ''
  if (node.kind === 'text') return !textPaints(hasDisplayedText(node.block, node.text), node.paint)
  if (node.kind === 'connector') return node.lineStyle === 'invisible'
  if (node.kind === 'shape') {
    if (node.conditionalPaint) return false
    return [node.paint, ...node.childPaints ?? []].every(paint =>
      (paint.opacity !== undefined && Number(paint.opacity) === 0)
      || absentPaint(paint.fill) && (paint.stroke === undefined || absentPaint(paint.stroke)))
  }
  return false
}

/** Inspect the actual lowered primitives, retaining paint order and ownership.
 * Bounds are conservative occupied regions, not a claim of pixel-exact ink.
 * Opaque content and missing geometry remain explicit missing evidence.
 */
export function inspectScenePrimitives(scene: SceneDoc): ScenePaintInspection {
  return inspectScene(scene, (text, block, includeFont) => ({
    source: block?.prepared.source ?? text,
    displayed: block ? block.lineBlocks.map(line => line.runs.map(run => run.text).join('')).join('\n') : text,
    ...(includeFont && block?.fontFamily ? { fontFamily: block.fontFamily } : {}),
  })) as ScenePaintInspection
}

export function inspectScenePaintGeometry(scene: SceneDoc, receipt?: SceneWriteReceipt): ScenePaintGeometryInspection {
  const writes = beginSceneWriteInspection(receipt, scene)
  const inspection = inspectScene(scene, undefined, writes, receipt !== undefined ? 'all' : isAdmittedSceneDocument(scene) ? 'marked' : false)
  if (writes) sceneWriteWork.set(inspection, writes.work())
  return inspection
}

function hasDisplayedText(block: Extract<SceneNode, { kind: 'text' }>['block'], text: string): boolean {
  return block ? block.lineBlocks.some(line => line.runs.some(run => run.text.trim() !== '')) : text.trim() !== ''
}

type TextDetails = (text: string, block: Extract<SceneNode, { kind: 'text' }>['block'], includeFont?: true) => Omit<NonNullable<ScenePaintPrimitive['text']>, 'measurement'>

/** A native drawing supplies leaves and the inherited group context explicitly.
 * Leaves must already pass the drawing factory's bounded admission. No group
 * or SceneDoc is built or retained by this API. */
export interface NativePaintEntry {
  readonly node: Exclude<SceneNode, { kind: 'group' }>
  readonly key?: string
  readonly parentMatrix?: AffineMatrix
  readonly ancestors?: readonly SceneOwner[]
  readonly owner?: SceneOwner
  readonly conditional?: boolean
  readonly groupOpacity?: number
}
export type PaintInspectionHeader = Pick<SceneDoc, 'family' | 'width' | 'height'>

const ownedAncestors = new WeakSet<readonly SceneOwner[]>()
const emptyAncestors: readonly SceneOwner[] = Object.freeze([])
ownedAncestors.add(emptyAncestors)

function ownerSnapshot(owner: SceneOwner): SceneOwner {
  return Object.freeze({ id: owner.id, role: owner.role })
}

/** An occurrence owns one inert ancestry snapshot, shared by its leaves. */
export function nativePaintAncestors(parent: readonly SceneOwner[] | undefined, owner: SceneOwner): readonly SceneOwner[] {
  const snapshot = ownerSnapshot(owner)
  const prefix = parent === undefined ? emptyAncestors : ownedAncestors.has(parent) ? parent
    : Array.from(parent, ownerSnapshot)
  const ancestors = Object.freeze([...prefix, snapshot])
  ownedAncestors.add(ancestors)
  return ancestors
}

/** Feed native occurrences directly without allocating intermediate entries. */
export function createOwnedNativePaintRecorder(header: PaintInspectionHeader) {
  const recorder = createPaintRecorder(header, undefined, true)
  return {
    leaf(node: NativePaintEntry['node'], key: string, parentMatrix?: AffineMatrix, ancestors: readonly SceneOwner[] = emptyAncestors, conditional = false, groupOpacity = 1, owner?: SceneOwner) {
      if (!ownedAncestors.has(ancestors)) throw new TypeError('Native paint ancestors must be owned snapshots')
      recorder.leaf(node, key, parentMatrix, ancestors, conditional, groupOpacity, owner)
    },
    finish: recorder.finish,
  }
}

export function inspectNativePaintGeometry(header: PaintInspectionHeader, entries: Iterable<NativePaintEntry>): ScenePaintGeometryInspection {
  const recorder = createPaintRecorder(header, undefined, true)
  let index = 0
  for (const entry of entries) {
    const ancestors = entry.ancestors === undefined ? emptyAncestors : ownedAncestors.has(entry.ancestors) ? entry.ancestors
      : Object.freeze(Array.from(entry.ancestors, ownerSnapshot))
    recorder.leaf(entry.node, entry.key ?? `native.${index}`, entry.parentMatrix, ancestors, entry.conditional ?? false, entry.groupOpacity ?? 1, entry.owner)
    index++
  }
  return recorder.finish()
}

function nativePaintSource(node: Exclude<SceneNode, { kind: 'group' }>): NativePaintSource {
  switch (node.kind) {
    case 'shape': return Object.freeze({ kind: node.kind, geometry: node.geometry, paint: node.paint, ...(node.childPaints ? { childPaints: node.childPaints } : {}), ...(node.transform ? { transform: node.transform } : {}) })
    case 'connector': return Object.freeze({ kind: node.kind, lineStyle: node.lineStyle, endpoints: node.endpoints, route: node.route, stroke: node.stroke, markers: node.markers, ...(node.transform ? { transform: node.transform } : {}) })
    case 'text': return Object.freeze({ kind: node.kind, paint: node.paint })
    case 'document': return Object.freeze({ kind: node.kind })
  }
}

function createPaintRecorder(header: PaintInspectionHeader, retainText?: TextDetails, native = false) {
  const primitives: ScenePaintGeometry[] = []
  const coverage = { measured: 0, unmeasured: 0, nonPainting: 0, preparedText: 0, fallbackText: 0 }
  const leaf = (semanticNode: Exclude<SceneNode, { kind: 'group' }>, key: string, parent: AffineMatrix | undefined, ancestors: readonly SceneOwner[], conditional: boolean, groupOpacity: number, explicitOwner?: SceneOwner, servedNode?: Exclude<SceneNode, { kind: 'group' }>, pathAuthority = false, untransformed = parent === undefined): void => {
    const node = servedNode ?? semanticNode
    const owner = explicitOwner ?? node.owner ?? ancestors.at(-1) ?? node.identity ?? { id: node.id, role: node.role }
    const source = native || servedNode ? nativePaintSource(node) : undefined
    const hidden = groupOpacity === 0 || nonPainting(node)
    const [a, b, c, d, e, f] = parent ?? IDENTITY_MATRIX
    const parentTransform: SceneTransform | undefined = parent || node.transform ? { kind: 'matrix', a, b, c, d, e, f } : undefined
    const matrix = !parent && !node.transform ? IDENTITY_PAINT_MATRIX : Object.freeze(composeMatrices(parent ?? IDENTITY_MATRIX, transformMatrix(node.transform)))
    const bounds = hidden ? undefined : nodePaintBounds(node, parentTransform)
    const measured = !!bounds && finite(bounds)
    const status = hidden ? 'non-painting' : measured ? 'measured' : 'unmeasured'
    const primitive: ScenePaintGeometry = Object.freeze({
      key, id: node.id, kind: node.kind, role: node.role,
      // Native ancestry contains only our frozen snapshots, including when
      // callers supplied mutable ancestor objects. Never share a raw owner.
      owner: native && ancestors.includes(owner) ? owner : ownerSnapshot(owner),
      ancestors,
      order: primitives.length, coverage: status,
      ...(conditional || node.visibility === 'conditional' || !Number.isFinite(groupOpacity) ? { visibility: 'conditional' as const } : {}),
      ...(groupOpacity < 1 ? { groupOpacity } : {}),
      ...(measured ? { bounds: Object.freeze(bounds!) } : {}),
      ...(!hidden && !measured ? { reason: node.kind === 'document' ? 'opaque-visible-content' : 'missing-paint-geometry' } : {}),
      ...(node.kind === 'text' ? { text: Object.freeze({ measurement: node.measurement ?? 'unavailable', ...retainText?.(node.text, node.block, true) }) } : {}),
    })
    if (source) nativeSources.set(primitive, source)
    if (!native) sources.set(primitive, semanticNode)
    if (servedNode && primitive.visibility !== 'conditional') sceneWriteOccurrences.add(primitive)
    if (pathAuthority && primitive.visibility !== 'conditional') scenePathOccurrences.add(primitive)
    worldMatrices.set(primitive, matrix)
    if (untransformed && !node.transform) untransformedPrimitives.add(primitive)
    primitives.push(primitive)
    if (hidden) coverage.nonPainting++
    else if (measured) coverage.measured++
    else coverage.unmeasured++
    if (node.kind === 'text' && !hidden) {
      if (node.measurement === 'prepared') coverage.preparedText++
      else coverage.fallbackText++
    }
    if (node.kind === 'connector') node.labels.forEach((label, labelIndex) => {
      if (label.visual?.kind !== 'inline') return
      const paint = { ...label.paint, ...(label.halo ? { stroke: label.halo.color ?? 'var(--bg)', strokeWidth: String(label.halo.width) } : {}) }
      const hidden = groupOpacity === 0 || !textPaints(hasDisplayedText(label.block, label.text), paint)
      const local = hidden ? undefined : connectorInlineLabelVisualBounds(label)
      const [la, lb, lc, ld, le, lf] = matrix
      const bounds = local && transformedBounds(local, { kind: 'matrix', a: la, b: lb, c: lc, d: ld, e: le, f: lf })
      const measured = !!bounds && finite(bounds)
      const inline: ScenePaintGeometry = Object.freeze({
        key: `${key}.label.${labelIndex}`, id: label.id ?? `${node.id}:label:${labelIndex}`, kind: 'text', role: 'label',
        owner: primitive.owner, ancestors: primitive.ancestors, order: primitives.length,
        coverage: hidden ? 'non-painting' : measured ? 'measured' : 'unmeasured',
        ...(primitive.visibility ? { visibility: primitive.visibility } : {}),
        ...(groupOpacity < 1 ? { groupOpacity } : {}),
        ...(measured ? { bounds: Object.freeze(bounds!) } : !hidden ? { reason: 'missing-inline-label-geometry' } : {}),
        text: Object.freeze({ measurement: label.block ? 'prepared' : 'fallback', ...retainText?.(label.text, label.block) }),
      })
      if (source) nativeSources.set(inline, source)
      if (!native) sources.set(inline, semanticNode)
      worldMatrices.set(inline, matrix)
      primitives.push(inline)
      if (hidden) coverage.nonPainting++
      else {
        if (measured) coverage.measured++
        else coverage.unmeasured++
        if (label.block) coverage.preparedText++
        else coverage.fallbackText++
      }
    })
  }
  return {
    leaf,
    finish: (): ScenePaintGeometryInspection => {
      const inspection = Object.freeze({ version: 1 as const, family: header.family, bounds: Object.freeze({ width: header.width, height: header.height }), primitives: Object.freeze(primitives), coverage: Object.freeze(coverage) })
      immutablePaintRosters.add(inspection)
      return inspection
    },
  }
}

function inspectScene(scene: SceneDoc, retainText?: TextDetails, writes?: ReturnType<typeof beginSceneWriteInspection>, requireWritten: false | 'marked' | 'all' = false): ScenePaintGeometryInspection {
  const recorder = createPaintRecorder(scene, retainText)
  const walk = (nodes: readonly SceneNode[], prefix: string, parent: AffineMatrix, ancestors: readonly SceneOwner[], conditional = false, groupOpacity = 1, untransformed = true): void => {
    nodes.forEach((node, index) => {
      const key = `${prefix}.${index}`
      if (node.kind === 'group') {
        const own = node.identity ?? { id: node.id, role: node.role }
        walk(node.children.map(child => child.node), key, composeMatrices(parent, transformMatrix(node.transform)), Object.freeze([...ancestors, ownerSnapshot(own)]), conditional || node.visibility === 'conditional', multiplySceneOpacity(groupOpacity, sceneGroupOpacity(node.paint?.opacity)), untransformed && !node.transform)
      } else {
        const written = writes?.node(node)
        // Without a receipt, unmarked legacy inspection still owns its inline
        // label diagnostics. Explicit receipts and marked carriers remain strict.
        const missingWrite = requireWritten && node.kind === 'connector' && node.lineStyle !== 'invisible' && !written
          && (requireWritten === 'all' || !!node.markers.start || !!node.markers.end || node.markers.mid.length > 0)
        recorder.leaf(node, key, parent, ancestors, conditional || !!written?.conditional || !!missingWrite, groupOpacity, undefined, written?.served, written?.path, untransformed)
      }
    })
  }
  walk(scene.parts, 'scene', IDENTITY_MATRIX, Object.freeze([]))
  return recorder.finish()
}
