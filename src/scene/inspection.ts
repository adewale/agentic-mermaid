import { tryParseCssColor } from '../shared/color-math.ts'
import type { ConnectorMark, MarkPaint, SceneDoc, SceneNode, SceneOwner, SceneRole, SceneTransform, ShapeMark, TextMark } from './ir.ts'
import { connectorInlineLabelVisualBounds, nodePaintBounds, transformedBounds, type ConnectorMarkerPaintRegion } from './bounds.ts'
import { composeMatrices, IDENTITY_MATRIX, transformMatrix, type AffineMatrix } from './transforms.ts'
import type { CheckedSequenceLine } from './sequence-line-command.ts'
import { sceneNodeSerialization } from './serialization.ts'
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
interface NativeSequenceLinePaintSource {
  readonly kind: 'sequence-line'
  readonly from: string
  readonly to: string
  readonly regions: readonly ConnectorMarkerPaintRegion[]
}
export type NativePaintSource = Pick<ShapeMark, 'kind' | 'geometry' | 'paint' | 'childPaints'>
  | NativeConnectorPaintSource | NativeSequenceLinePaintSource | Pick<TextMark, 'kind' | 'paint'> | { readonly kind: 'document' }
const nativeSources = new WeakMap<ScenePaintGeometry, NativePaintSource>()
export function paintPrimitiveSource(primitive: ScenePaintGeometry): NativePaintSource | undefined {
  return nativeSources.get(primitive) ?? sources.get(primitive)
}

const worldMatrices = new WeakMap<ScenePaintGeometry, AffineMatrix>()
const IDENTITY_PAINT_MATRIX: AffineMatrix = Object.freeze([1, 0, 0, 1, 0, 0])
export function scenePrimitiveMatrix(primitive: ScenePaintGeometry): AffineMatrix | undefined { return worldMatrices.get(primitive) }

export function scenePrimitiveSource(primitive: ScenePaintGeometry): SceneNode | undefined {
  return sources.get(primitive)
}

function finite(box: AxisAlignedBox): boolean {
  return [box.x0, box.x1, box.y0, box.y1].every(Number.isFinite) && box.x0 <= box.x1 && box.y0 <= box.y1
}

function absentPaint(value: string | undefined): boolean {
  return value === 'none' || value === 'transparent' || !!value && tryParseCssColor(value)?.[3] === 0
}
function textPaints(hasText: boolean, paint: MarkPaint): boolean {
  return hasText && Number(paint.opacity ?? 1) !== 0 && (!absentPaint(paint.fill) || paint.stroke !== undefined && !absentPaint(paint.stroke) && Number.parseFloat(paint.strokeWidth ?? '1') !== 0)
}

/** The paint a shape's surface shows: a compound shape with per-piece paints
 * fills wherever any piece fills, so the first filled piece stands for it. */
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

export function inspectScenePaintGeometry(scene: SceneDoc): ScenePaintGeometryInspection {
  return inspectScene(scene)
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
    sequenceLine(command: CheckedSequenceLine, key: string, ancestors: readonly SceneOwner[] = emptyAncestors, owner?: SceneOwner) {
      if (!ownedAncestors.has(ancestors)) throw new TypeError('Native paint ancestors must be owned snapshots')
      recorder.sequenceLine(command, key, ancestors, owner)
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
    case 'shape': return Object.freeze({ kind: node.kind, geometry: node.geometry, paint: node.paint, ...(node.childPaints ? { childPaints: node.childPaints } : {}) })
    case 'connector': return Object.freeze({ kind: node.kind, lineStyle: node.lineStyle, endpoints: node.endpoints, route: node.route, stroke: node.stroke, markers: node.markers, ...(node.transform ? { transform: node.transform } : {}) })
    case 'text': return Object.freeze({ kind: node.kind, paint: node.paint })
    case 'document': return Object.freeze({ kind: node.kind })
  }
}

function createPaintRecorder(header: PaintInspectionHeader, retainText?: TextDetails, native = false) {
  const primitives: ScenePaintGeometry[] = []
  const coverage = { measured: 0, unmeasured: 0, nonPainting: 0, preparedText: 0, fallbackText: 0 }
  const append = (primitive: ScenePaintGeometry, matrix: AffineMatrix, hidden: boolean, measured: boolean, source: NativePaintSource | undefined, node?: Exclude<SceneNode, { kind: 'group' }>): void => {
    if (source) nativeSources.set(primitive, source)
    else if (node) sources.set(primitive, node)
    worldMatrices.set(primitive, matrix)
    primitives.push(primitive)
    if (hidden) coverage.nonPainting++
    else if (measured) coverage.measured++
    else coverage.unmeasured++
  }
  const leaf = (node: Exclude<SceneNode, { kind: 'group' }>, key: string, parent: AffineMatrix | undefined, ancestors: readonly SceneOwner[], conditional: boolean, groupOpacity: number, explicitOwner?: SceneOwner): void => {
    const owner = explicitOwner ?? node.owner ?? ancestors.at(-1) ?? node.identity ?? { id: node.id, role: node.role }
    const source = native ? nativePaintSource(node) : undefined
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
      ...(conditional || node.visibility === 'conditional' ? { visibility: 'conditional' as const } : {}),
      ...(groupOpacity < 1 ? { groupOpacity } : {}),
      ...(measured ? { bounds: Object.freeze(bounds!) } : {}),
      ...(!hidden && !measured ? { reason: node.kind === 'document' ? 'opaque-visible-content' : 'missing-paint-geometry' } : {}),
      ...(node.kind === 'text' ? { text: Object.freeze({ measurement: node.measurement ?? 'unavailable', ...retainText?.(node.text, node.block, true) }) } : {}),
    })
    append(primitive, matrix, hidden, measured, source, node)
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
      else sources.set(inline, node)
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
    sequenceLine(command: CheckedSequenceLine, key: string, ancestors: readonly SceneOwner[], explicitOwner?: SceneOwner): void {
      const owner = explicitOwner ?? ancestors.at(-1) ?? { id: command.id, role: 'message' as const }
      const measured = !!command.bounds && finite(command.bounds)
      const primitive: ScenePaintGeometry = Object.freeze({ key, id: command.id, kind: 'connector', role: 'message',
        owner: ancestors.includes(owner) ? owner : ownerSnapshot(owner), ancestors,
        order: primitives.length, coverage: measured ? 'measured' : 'unmeasured',
        ...(measured ? { bounds: command.bounds } : { reason: 'missing-paint-geometry' }),
      })
      append(primitive, IDENTITY_PAINT_MATRIX, false, measured, command)
    },
    finish: (): ScenePaintGeometryInspection => Object.freeze({ version: 1, family: header.family, bounds: Object.freeze({ width: header.width, height: header.height }), primitives: Object.freeze(primitives), coverage: Object.freeze(coverage) }),
  }
}

function inspectScene(scene: SceneDoc, retainText?: TextDetails): ScenePaintGeometryInspection {
  const recorder = createPaintRecorder(scene, retainText)
  const walk = (nodes: readonly SceneNode[], prefix: string, parent: AffineMatrix, ancestors: readonly SceneOwner[], conditional = false, groupOpacity = 1): void => {
    nodes.forEach((node, index) => {
      const key = `${prefix}.${index}`
      if (node.kind === 'group') {
        const own = node.identity ?? { id: node.id, role: node.role }
        walk(node.children.map(child => child.node), key, composeMatrices(parent, transformMatrix(node.transform)), Object.freeze([...ancestors, ownerSnapshot(own)]), conditional || node.visibility === 'conditional', groupOpacity * Number(node.paint?.opacity ?? 1))
      } else recorder.leaf(node, key, parent, ancestors, conditional, groupOpacity)
    })
  }
  walk(scene.parts, 'scene', IDENTITY_MATRIX, Object.freeze([]))
  return recorder.finish()
}
