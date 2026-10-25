import { pageRectFor } from './backend.ts'
import type { StyleSpec } from './style-registry.ts'
import type { DrawingDocument, DrawingFactory, DrawingProducer } from './drawing.ts'
import type { PositionedDiagram, RenderContext } from '../types.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
import * as marks from './marks.ts'
import { indentLines } from './serialization.ts'
import { composeMatrices, IDENTITY_MATRIX, transformMatrix } from './transforms.ts'
import { createOwnedNativePaintRecorder, multiplySceneOpacity, nativePaintAncestors, sceneGroupOpacity, type NativePaintEntry, type PaintInspectionHeader, type ScenePaintGeometryInspection } from './inspection.ts'
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
  readonly matrix: ReturnType<typeof transformMatrix> | undefined
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
function inspectPaint(header: PaintInspectionHeader, parts: readonly Fragment[]): ScenePaintGeometryInspection {
  const recorder = createOwnedNativePaintRecorder(header)
  const groups: GroupFragment[] = []
  type Occurrence = Omit<NativePaintEntry, 'node' | 'key'>
  function visit(children: readonly Fragment[], prefix: string, occurrence?: Occurrence): void {
    for (let index = 0; index < children.length; index++) {
      const fragment = children[index]!
      const key = `${prefix}.${index}`
      if (fragment.kind === 'group') {
        groups.push(fragment)
        // Reduce once per occurrence, preserving the original bottom-up
        // floating-point association for both matrices and group opacity.
        let parentMatrix: ReturnType<typeof transformMatrix> | undefined
        let groupOpacity = 1
        let conditional: true | undefined
        for (let depth = groups.length - 1; depth >= 0; depth--) {
          const group = groups[depth]!
          if (group.matrix !== undefined || parentMatrix !== undefined) {
            parentMatrix = composeMatrices(group.matrix ?? IDENTITY_MATRIX, parentMatrix ?? IDENTITY_MATRIX)
          }
          groupOpacity = multiplySceneOpacity(group.opacity, groupOpacity)
          if (group.conditional) conditional = true
        }
        const ancestors = nativePaintAncestors(occurrence?.ancestors, fragment.own)
        const owner = fragment.owner?.id === fragment.own.id && fragment.owner.role === fragment.own.role ? ancestors.at(-1) : fragment.owner
        visit(fragment.children, key, { parentMatrix, ancestors, owner, conditional, groupOpacity })
        groups.pop()
      } else if (occurrence) {
        recorder.leaf(fragment.node, key, occurrence.parentMatrix, occurrence.ancestors, occurrence.conditional, occurrence.groupOpacity, fragment.node.owner ?? occurrence.owner)
      } else {
        recorder.leaf(fragment.node, key)
      }
    }
  }
  visit(parts, 'scene')
  return recorder.finish()
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
    documentOpen: (fields, svg) => leaf(marks.documentOpen(fields, svg)),
    documentContent: (fields, svg) => leaf(marks.documentContent(fields, svg)),
    documentText: fields => leaf(marks.documentText(fields)),
    definitions: (fields, svg) => leaf(marks.definitions(fields, svg)),
    documentClose: () => leaf(marks.documentClose()),
    group(fields) {
      let nodeCount = 1, characters = 0, depth = 1, prepared = true
      const children: Fragment[] = []
      for (const child of fields.children) {
        children.push(child.node)
        nodeCount += child.node.nodeCount
        characters += child.node.svg.length
        depth = Math.max(depth, 1 + child.node.depth)
        prepared = prepared && child.node.prepared
      }
      if (nodeCount > SCENE_VALIDATION_LIMITS.maxNodes) throw new RangeError('Native drawing contains too many emitted nodes')
      if (characters > SCENE_VALIDATION_LIMITS.maxSerializationBytesPerNode) throw new RangeError('Native group has an oversized SVG serialization')
      const shell = marks.group({ ...fields, children: [] })
      validator.node(shell)
      validator.depth(depth)
      const matrix = shell.transform ? transformMatrix(shell.transform) : undefined
      const own = shell.identity ?? { id: shell.id, role: shell.role }
      for (const child of children) {
        if (child.kind === 'leaf' && child.node.kind === 'shape' && !child.node.identity) validator.enclosure(child.node.id, own)
      }
      const fragments = [shell.open]
      for (const child of fields.children) fragments.push(indentLines(child.node.svg, child.indent))
      fragments.push(shell.close)
      const svg = fragments.join(shell.join)
      validator.serialization(svg)
      return { kind: 'group', svg, children, matrix, own, owner: shell.owner,
        conditional: shell.visibility === 'conditional', opacity: sceneGroupOpacity(shell.paint?.opacity),
        nodeCount, depth, prepared: !/<\s*text/i.test(shell.open + shell.close) && prepared }
    },
    pathArtwork: fields => marks.drawPathArtwork(factory, fields),
  }
  const document: DrawingDocument<Fragment> = withDeferredTerminalProjections(() => producer(factory, context))
  const result = validator.finish()
  if (!result.valid) throw new SceneValidationError(result.diagnostics)
  let nodeCount = 0, characters = -1, preparedText = true
  for (const part of document.parts) {
    nodeCount += part.nodeCount
    characters += part.svg.length + 1
    preparedText = preparedText && part.prepared
  }
  if (nodeCount > SCENE_VALIDATION_LIMITS.maxNodes) throw new RangeError('Native drawing contains too many emitted nodes')
  if (characters > SCENE_VALIDATION_LIMITS.maxFinalSvgBytes) throw new RangeError('Native drawing exceeds the final SVG limit')
  const backdrop = pageRectFor(document, { seed: 0, ...(style ? { style } : {}) })
  const svg = document.parts.map((part, index) => index === 0 && backdrop ? `${part.svg}\n${backdrop}` : part.svg).join('\n')
  assertFinalSvgByteBudget(svg, 'native drawing output')
  return Object.freeze({ svg, header: { family: document.family, width: document.width, height: document.height, colors: document.colors, transparent: document.transparent }, preparedText, paint: inspectPaint(document, document.parts) })
}
