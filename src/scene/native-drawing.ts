import { pageRectFor } from './backend.ts'
import type { StyleSpec } from './style-registry.ts'
import type { DrawingDocument, DrawingFactory, DrawingProducer } from './drawing.ts'
import type { PositionedDiagram, RenderContext } from '../types.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
import * as marks from './marks.ts'
import { indentLines } from './serialization.ts'
import { composeMatrices, IDENTITY_MATRIX, transformMatrix } from './transforms.ts'
import { inspectOwnedNativePaintGeometry, type NativePaintEntry, type ScenePaintGeometryInspection } from './inspection.ts'
import { createNativeSceneValidator, SceneValidationError, SCENE_VALIDATION_LIMITS, assertFinalSvgByteBudget } from './scene-validation.ts'
import { withDeferredTerminalProjections } from './deferred-terminal-projection.ts'

interface FragmentData {
  readonly svg: string
  readonly nodeCount: number
  readonly depth: number
  readonly prepared: boolean
}
type LeafNode = Exclude<SceneNode, { kind: 'group' }>
interface GroupFragment extends FragmentData {
  readonly kind: 'group'
  readonly children: readonly Fragment[]
  readonly matrix: ReturnType<typeof transformMatrix>
  readonly own: NonNullable<NativePaintEntry['ancestors']>[number]
  readonly owner: NativePaintEntry['owner']
  readonly conditional: boolean
  readonly opacity: number
}
type Fragment = (FragmentData & { readonly kind: 'leaf'; readonly node: LeafNode }) | GroupFragment
export interface NativeDrawing {
  readonly svg: string
  readonly paint: ScenePaintGeometryInspection
  readonly preparedText: boolean
  readonly header: Omit<SceneDoc, 'parts'>
}

/** Feed each emitted occurrence to inspection without copying its descendants
 * every time a group wraps them. Reused fragments keep distinct occurrence keys. */
function* paintEntries(parts: readonly Fragment[]): Generator<NativePaintEntry> {
  const groups: GroupFragment[] = []
  function* visit(children: readonly Fragment[], prefix: string): Generator<NativePaintEntry> {
    for (let index = 0; index < children.length; index++) {
      const fragment = children[index]!
      const key = `${prefix}.${index}`
      if (fragment.kind === 'group') {
        groups.push(fragment)
        yield* visit(fragment.children, key)
        groups.pop()
      } else if (groups.length === 0) {
        yield { node: fragment.node, key }
      } else {
        // Preserve the original bottom-up floating-point association, including
        // the innermost identity multiplication, for matrices and opacity.
        let parentMatrix = IDENTITY_MATRIX
        let groupOpacity = 1
        let conditional: true | undefined
        for (let depth = groups.length - 1; depth >= 0; depth--) {
          const group = groups[depth]!
          parentMatrix = composeMatrices(group.matrix, parentMatrix)
          groupOpacity = group.opacity * groupOpacity
          if (group.conditional) conditional = true
        }
        const owner = fragment.node.owner ?? groups[groups.length - 1]!.owner
        yield { node: fragment.node, key, parentMatrix,
          ancestors: groups.map(group => group.own), owner,
          conditional, groupOpacity }
      }
    }
  }
  yield* visit(parts, 'scene')
}

/** Compose SVG immediately and retain shallow group handles until inspection. */
export function drawNative(
  producer: DrawingProducer,
  context: RenderContext<PositionedDiagram>,
  family: string,
  style?: StyleSpec,
): NativeDrawing {
  const header = { family, width: context.positioned.width, height: context.positioned.height, colors: context.colors, transparent: context.resolved.renderOptions.transparent ?? false }
  const validator = createNativeSceneValidator(header)
  const leaf = (node: LeafNode): Fragment => {
    const svg = validator.node(node)
    return { kind: 'leaf', node, svg, nodeCount: 1, depth: 0,
      prepared: node.kind === 'document' ? !/<\s*text/i.test(svg)
        : node.kind !== 'text' || node.measurement === 'prepared' && node.block !== undefined }
  }
  const factory: DrawingFactory<Fragment> = {
    shape: fields => leaf(marks.shape(fields)),
    text: fields => leaf(marks.text(fields)),
    connector: fields => leaf(marks.connector(fields)),
    documentOpen: (...args) => leaf(marks.documentOpen(...args)),
    documentContent: (...args) => leaf(marks.documentContent(...args)),
    documentText: (...args) => leaf(marks.documentText(...args)),
    definitions: (...args) => leaf(marks.definitions(...args)),
    documentClose: () => leaf(marks.documentClose()),
    group(fields) {
      let nodeCount = 1, childLength = 0, childDepth = 0
      const children: Fragment[] = []
      for (const child of fields.children) {
        children.push(child.node)
        nodeCount += child.node.nodeCount
        childLength += child.node.svg.length
        childDepth = Math.max(childDepth, child.node.depth)
      }
      if (nodeCount > SCENE_VALIDATION_LIMITS.maxNodes) throw new RangeError('Native drawing contains too many emitted nodes')
      if (childLength > SCENE_VALIDATION_LIMITS.maxSerializationBytesPerNode) throw new RangeError('Native group has an oversized SVG serialization')
      const shell = marks.group({ ...fields, children: [] })
      validator.node(shell)
      const depth = 1 + childDepth
      validator.depth(depth)
      const matrix = transformMatrix(shell.transform)
      const own = shell.identity ?? { id: shell.id, role: shell.role }
      for (const child of children) {
        if (child.kind === 'leaf' && child.node.kind === 'shape' && !child.node.identity) validator.enclosure(child.node.id, own)
      }
      const svg = [shell.open, ...fields.children.map(child => indentLines(child.node.svg, child.indent)), shell.close].join(shell.join)
      validator.serialization(svg)
      return { kind: 'group', svg, children, matrix, own, owner: shell.owner,
        conditional: shell.visibility === 'conditional', opacity: Number(shell.paint?.opacity ?? 1),
        nodeCount, depth, prepared: !/<\s*text/i.test(shell.open + shell.close) && children.every(child => child.prepared) }
    },
    pathArtwork: fields => marks.drawPathArtwork(factory, fields),
  }
  const document: DrawingDocument<Fragment> = withDeferredTerminalProjections(() => producer(factory, context))
  const result = validator.finish()
  if (!result.valid) throw new SceneValidationError(result.diagnostics)
  const nodeCount = document.parts.reduce((sum, fragment) => sum + fragment.nodeCount, 0)
  if (nodeCount > SCENE_VALIDATION_LIMITS.maxNodes) throw new RangeError('Native drawing contains too many emitted nodes')
  if (document.parts.reduce((sum, part) => sum + part.svg.length + 1, -1) > SCENE_VALIDATION_LIMITS.maxFinalSvgBytes) throw new RangeError('Native drawing exceeds the final SVG limit')
  const backdrop = pageRectFor(document, { seed: 0, ...(style ? { style } : {}) })
  const svg = document.parts.map((part, index) => index === 0 && backdrop ? `${part.svg}\n${backdrop}` : part.svg).join('\n')
  assertFinalSvgByteBudget(svg, 'native drawing output')
  return Object.freeze({ svg, header: { family: document.family, width: document.width, height: document.height, colors: document.colors, transparent: document.transparent }, preparedText: document.parts.every(part => part.prepared), paint: inspectOwnedNativePaintGeometry(document, paintEntries(document.parts)) })
}
