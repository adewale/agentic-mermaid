import { tryParseCssColor } from '../shared/color-math.ts'
import type { MarkPaint, SceneDoc, SceneNode, SceneOwner, SceneRole, SceneTransform, ShapeMark } from './ir.ts'
import { connectorInlineLabelVisualBounds, nodePaintBounds, transformedBounds } from './bounds.ts'
import { composeMatrices, IDENTITY_MATRIX, transformMatrix, type AffineMatrix } from './transforms.ts'
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

const sources = new WeakMap<ScenePaintGeometry, SceneNode>()
const worldMatrices = new WeakMap<ScenePaintGeometry, AffineMatrix>()
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
export function shapeSurfacePaint(node: ShapeMark): MarkPaint {
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

function inspectScene(scene: SceneDoc, retainText?: TextDetails): ScenePaintGeometryInspection {
  const primitives: ScenePaintGeometry[] = []
  const coverage = { measured: 0, unmeasured: 0, nonPainting: 0, preparedText: 0, fallbackText: 0 }
  const walk = (nodes: readonly SceneNode[], prefix: string, parent: AffineMatrix, ancestors: readonly SceneOwner[], conditional = false, groupOpacity = 1): void => {
    nodes.forEach((node, index) => {
      const key = `${prefix}.${index}`
      const owner = node.owner ?? (ancestors.at(-1) || node.identity || { id: node.id, role: node.role })
      if (node.kind === 'group') {
        const own = node.identity ?? { id: node.id, role: node.role }
        walk(node.children.map(child => child.node), key, composeMatrices(parent, transformMatrix(node.transform)), Object.freeze([...ancestors, Object.freeze({ id: own.id, role: own.role })]), conditional || node.visibility === 'conditional', groupOpacity * Number(node.paint?.opacity ?? 1))
        return
      }
      const hidden = groupOpacity === 0 || nonPainting(node)
      const [a, b, c, d, e, f] = parent
      const parentTransform: SceneTransform = { kind: 'matrix', a, b, c, d, e, f }
      const bounds = hidden ? undefined : nodePaintBounds(node, parentTransform)
      const measured = !!bounds && finite(bounds)
      const status = hidden ? 'non-painting' : measured ? 'measured' : 'unmeasured'
      const primitive: ScenePaintGeometry = Object.freeze({
        key, id: node.id, kind: node.kind, role: node.role,
        owner: Object.freeze({ id: owner.id, role: owner.role }),
        ancestors,
        order: primitives.length, coverage: status,
        ...(conditional || node.visibility === 'conditional' ? { visibility: 'conditional' as const } : {}),
        ...(groupOpacity < 1 ? { groupOpacity } : {}),
        ...(measured ? { bounds: Object.freeze(bounds!) } : {}),
        ...(!hidden && !measured ? { reason: node.kind === 'document' ? 'opaque-visible-content' : 'missing-paint-geometry' } : {}),
        ...(node.kind === 'text' ? { text: Object.freeze({ measurement: node.measurement ?? 'unavailable', ...retainText?.(node.text, node.block, true) }) } : {}),
      })
      sources.set(primitive, node)
      worldMatrices.set(primitive, composeMatrices(parent, transformMatrix(node.transform)))
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
        const [la, lb, lc, ld, le, lf] = composeMatrices(parent, transformMatrix(node.transform))
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
        sources.set(inline, node)
        worldMatrices.set(inline, composeMatrices(parent, transformMatrix(node.transform)))
        primitives.push(inline)
        if (hidden) coverage.nonPainting++
        else {
          if (measured) coverage.measured++
          else coverage.unmeasured++
          if (label.block) coverage.preparedText++
          else coverage.fallbackText++
        }
      })
    })
  }
  walk(scene.parts, 'scene', IDENTITY_MATRIX, Object.freeze([]))
  return Object.freeze({ version: 1, family: scene.family, bounds: Object.freeze({ width: scene.width, height: scene.height }), primitives: Object.freeze(primitives), coverage: Object.freeze(coverage) })
}
