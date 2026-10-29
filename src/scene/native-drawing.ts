import { pageRectFor } from './backend.ts'
import type { StyleSpec } from './style-registry.ts'
import type { DrawingDocument, DrawingFactory, DrawingProducer } from './drawing.ts'
import type { PositionedDiagram, RenderContext } from '../types.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
import * as marks from './marks.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { indentLines } from './serialization.ts'
import { composeMatrices, IDENTITY_MATRIX, transformMatrix } from './transforms.ts'
import { createOwnedNativePaintRecorder, multiplySceneOpacity, nativePaintAncestors, sceneGroupOpacity, type NativePaintEntry, type PaintInspectionHeader, type ScenePaintGeometryInspection } from './inspection.ts'
import { createNativeSceneValidator, SceneValidationError, SCENE_VALIDATION_LIMITS, assertFinalSvgByteBudget } from './scene-validation-core.ts'
import { withDeferredTerminalProjections } from './deferred-terminal-projection.ts'
import { createNativePaintEmission, MAX_OCCLUSION_OPERATIONS } from './native-paint-emission.ts'

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
type Fragment = (FragmentData & { readonly kind: 'leaf'; readonly node: LeafNode; readonly conditional: boolean }) | GroupFragment
export interface NativeDrawing {
  readonly svg: string
  readonly paint: ScenePaintGeometryInspection
  readonly preparedText: boolean
  readonly header: Omit<SceneDoc, 'parts'>
}

/** Feed each emitted occurrence to inspection without copying its descendants
 * every time a group wraps them. Reused fragments keep distinct occurrence keys. */
function inspectPaint(header: PaintInspectionHeader, parts: readonly Fragment[], observe: (node: LeafNode, svg: string) => boolean): ScenePaintGeometryInspection {
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
        const bound = !fragment.conditional && observe(fragment.node, fragment.svg)
        recorder.leaf(fragment.node, key, occurrence.parentMatrix, occurrence.ancestors, occurrence.conditional || !bound, occurrence.groupOpacity, fragment.node.owner ?? occurrence.owner)
      } else {
        const bound = !fragment.conditional && observe(fragment.node, fragment.svg)
        recorder.leaf(fragment.node, key, undefined, undefined, !bound)
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
  const emission = createNativePaintEmission(MAX_OCCLUSION_OPERATIONS)
  if (family.startsWith('family:')) emission.uncertain()
  let emittedHeader = emission.snapshot(header)
  const validator = createNativeSceneValidator(header)
  const ownedFragments = new WeakSet<object>()
  const ownFragment = <T extends Fragment>(fragment: T): T => { if (emission.retainFragment()) ownedFragments.add(fragment); return Object.freeze(fragment) }
  const leaf = (node: LeafNode): Fragment => {
    const captured = emission.leaf(node, (captured, sink) => validator.node(captured, 0, sink))
    const svg = captured.svg
    return ownFragment({ kind: 'leaf', node: captured.paintNode, svg, conditional: captured.conditional, nodeCount: 1, depth: 0,
      prepared: node.kind === 'document' ? !/<\s*text/i.test(svg)
        : node.kind !== 'text' || node.measurement === 'prepared' && node.block !== undefined })
  }
  const factory: DrawingFactory<Fragment> = {
    shape: fields => leaf(marks.shape(fields)),
    text: fields => leaf(marks.text(fields)),
    connector: fields => leaf(marks.connector(fields)),
    documentOpen: (fields, svg) => {
      const captured = emission.snapshot(fields)
      if (captured) {
        emittedHeader = Object.freeze({ family, width: captured.width, height: captured.height, colors: captured.colors, transparent: captured.transparent })
        emittedHeader = emission.header(emittedHeader, svg)
      }
      else emission.uncertain()
      return leaf(marks.documentOpen(fields, svg))
    },
    documentContent: (fields, svg) => leaf(marks.documentContent(fields, svg)),
    documentText: fields => leaf(marks.documentText(fields)),
    definitions: (fields, svg) => leaf(marks.definitions(fields, svg)),
    documentClose: () => leaf(marks.documentClose()),
    group(fields) {
      const submittedChildren = Object.getOwnPropertyDescriptor(fields, 'children')
      if (!submittedChildren || !('value' in submittedChildren)) emission.uncertain()
      const { children: inputChildren, ...shellFields } = fields
      const submitted = emission.parts(inputChildren, SCENE_VALIDATION_LIMITS.maxNodes)
      const childParts: Array<{ readonly node: Fragment; readonly indent: number }> = []
      let nodeCount = 1, characters = 0, depth = 1, prepared = true
      const children: Fragment[] = []
      for (const child of submitted) {
        // Read each caller wrapper only once. The same owned node+indent pair
        // supplies both retained ancestry and actual SVG composition.
        const nodeField = Object.getOwnPropertyDescriptor(child, 'node'), indentField = Object.getOwnPropertyDescriptor(child, 'indent')
        if (!nodeField || !('value' in nodeField) || !indentField || !('value' in indentField)) emission.uncertain()
        const entry = Object.freeze({ node: child.node, indent: child.indent })
        childParts.push(entry)
        if (!ownedFragments.has(entry.node)) emission.uncertain()
        children.push(entry.node)
        nodeCount += entry.node.nodeCount
        characters += entry.node.svg.length
        depth = Math.max(depth, 1 + entry.node.depth)
        prepared = prepared && entry.node.prepared
      }
      if (nodeCount > SCENE_VALIDATION_LIMITS.maxNodes) throw new RangeError('Native drawing contains too many emitted nodes')
      if (characters > SCENE_VALIDATION_LIMITS.maxSerializationBytesPerNode) throw new RangeError('Native group has an oversized SVG serialization')
      const shell = marks.group({ ...shellFields, children: [] })
      validator.node(shell)
      validator.depth(depth)
      const capturedShell = emission.snapshot(shell)
      if (!capturedShell) emission.uncertain()
      const matrix = capturedShell ? emission.group(capturedShell) : undefined
      const own = capturedShell?.identity ?? { id: shell.id, role: shell.role }
      for (const child of children) {
        if (child.kind === 'leaf' && child.node.kind === 'shape' && !child.node.identity) validator.enclosure(child.node.id, capturedShell?.identity ?? shell.identity ?? own)
      }
      const fragments = [shell.open]
      for (const child of childParts) fragments.push(indentLines(child.node.svg, child.indent))
      fragments.push(shell.close)
      const svg = fragments.join(shell.join)
      validator.serialization(svg)
      return ownFragment({ kind: 'group', svg, children: Object.freeze(children), matrix, own, owner: capturedShell?.owner,
        conditional: !capturedShell || shell.visibility === 'conditional', opacity: sceneGroupOpacity(capturedShell?.paint?.opacity),
        nodeCount, depth, prepared: !/<\s*text/i.test(shell.open + shell.close) && prepared })
    },
    pathArtwork: fields => marks.drawPathArtwork(factory, fields),
  }
  const document: DrawingDocument<Fragment> = withDeferredTerminalProjections(() => producer(factory, context))
  // One actual occurrence roster owns BOTH byte composition and inspection.
  // Late getters cannot substitute a different document after serialization.
  for (const field of ['parts', 'family', 'width', 'height', 'colors', 'transparent'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(document, field)
    if (!descriptor || !('value' in descriptor)) emission.uncertain()
  }
  const parts = emission.parts(document.parts, SCENE_VALIDATION_LIMITS.maxNodes)
  for (const part of parts) if (!ownedFragments.has(part)) emission.uncertain()
  const result = validator.finish()
  if (!result.valid) throw new SceneValidationError(result.diagnostics)
  let nodeCount = 0, characters = -1, preparedText = true
  for (const part of parts) {
    nodeCount += part.nodeCount
    characters += part.svg.length + 1
    preparedText = preparedText && part.prepared
  }
  if (nodeCount > SCENE_VALIDATION_LIMITS.maxNodes) throw new RangeError('Native drawing contains too many emitted nodes')
  if (characters > SCENE_VALIDATION_LIMITS.maxFinalSvgBytes) throw new RangeError('Native drawing exceeds the final SVG limit')
  const backdrop = pageRectFor(document, { seed: 0, ...(style ? { style } : {}) })
  const svg = parts.map((part, index) => index === 0 && backdrop ? `${part.svg}\n${backdrop}` : part.svg).join('\n')
  assertFinalSvgByteBudget(svg, 'native drawing output')
  // The document shell was already emitted. Late aliases cannot rewrite the
  // palette or viewport used by inspection and by later public certification.
  const capturedHeader = emittedHeader ?? Object.freeze({ ...header, colors: Object.freeze({ bg: 'none', fg: 'none' }) })
  const finalHeader = emission.snapshot({ family: document.family, width: document.width, height: document.height, colors: document.colors, transparent: document.transparent })
  const paintHeader = Object.freeze({ ...capturedHeader, family: finalHeader?.family ?? family })
  if (!finalHeader || !emission.same({ ...finalHeader, width: Number(formatSvgNumber(finalHeader.width)), height: Number(formatSvgNumber(finalHeader.height)) }, paintHeader)) emission.uncertain()
  const paint = inspectPaint(paintHeader, parts, emission.observe)
  // The styled backdrop is emitted outside the recorder's primitive roster.
  // It excludes only new proofs requiring a closed marker-paint context.
  emission.finish(paint, paintHeader, svg, backdrop !== '')
  return Object.freeze({ svg, header: paintHeader, preparedText, paint })
}
