import { pageRectFor } from './backend.ts'
import type { StyleSpec } from './style-registry.ts'
import type { DrawingDocument, DrawingFactory, DrawingProducer } from './drawing.ts'
import type { PositionedDiagram, RenderContext } from '../types.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
import * as marks from './marks.ts'
import { composeMatrices, IDENTITY_MATRIX, transformMatrix } from './transforms.ts'
import { inspectNativePaintGeometry, type NativePaintEntry, type ScenePaintGeometryInspection } from './inspection.ts'
import { createNativeSceneValidator, SceneValidationError, SCENE_VALIDATION_LIMITS, assertFinalSvgByteBudget } from './scene-validation.ts'
import { withDeferredTerminalProjections } from './deferred-terminal-projection.ts'

interface FragmentData {
  readonly output: SvgSpan
  readonly nodeCount: number
  readonly depth: number
  readonly prepared: boolean
}

interface SvgSummary {
  readonly length: number
  readonly bytes: number
  readonly newlines: number
  readonly first: number
  readonly last: number
}
type SvgSpan = SvgSummary & (
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'concat'; readonly parts: readonly SvgSpan[] }
  | { readonly kind: 'indent'; readonly child: SvgSpan; readonly pad: string }
)
const highSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
const lowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

function svgLiteral(value: string): SvgSpan {
  let bytes = 0, newlines = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 10) newlines++
    if (code < 0x80) bytes++
    else if (code < 0x800) bytes += 2
    else if (highSurrogate(code) && lowSurrogate(value.charCodeAt(index + 1))) { bytes += 4; index++ }
    else bytes += 3
  }
  return { kind: 'literal', value, length: value.length, bytes, newlines, first: value.charCodeAt(0), last: value.charCodeAt(value.length - 1) }
}

function joinSvg(parts: readonly SvgSpan[], separator: string): SvgSpan {
  const join = svgLiteral(separator)
  const spans: SvgSpan[] = []
  let length = 0, bytes = 0, newlines = 0, first = Number.NaN, last = Number.NaN
  const append = (span: SvgSpan): void => {
    spans.push(span)
    if (span.length === 0) return
    if (length === 0) first = span.first
    bytes += span.bytes - (highSurrogate(last) && lowSurrogate(span.first) ? 2 : 0)
    length += span.length
    newlines += span.newlines
    last = span.last
  }
  parts.forEach((part, index) => { if (index > 0) append(join); append(part) })
  return { kind: 'concat', parts: spans, length, bytes, newlines, first, last }
}

function indentSvg(child: SvgSpan, indent: number): SvgSpan {
  if (child.length === 0 || indent <= 0) return child
  const pad = ' '.repeat(indent)
  if (pad.length === 0) return child
  const added = pad.length * (child.newlines + 1)
  return { kind: 'indent', child, pad, length: child.length + added, bytes: child.bytes + added,
    newlines: child.newlines, first: 32, last: child.last === 10 ? 32 : child.last }
}

/** Emit indentation at its entry and after each LF, including a trailing LF.
 * Nested wrappers add their pads without flattening any intermediate group. */
function writeSvg(span: SvgSpan): string {
  const chunks: string[] = []
  const emit = (current: SvgSpan, pad: string): void => {
    if (current.kind === 'concat') {
      for (const part of current.parts) emit(part, pad)
    } else if (current.kind === 'indent') {
      chunks.push(current.pad)
      emit(current.child, pad + current.pad)
    } else if (pad === '' || current.newlines === 0) {
      chunks.push(current.value)
    } else {
      let start = 0
      for (let end = current.value.indexOf('\n'); end >= 0; end = current.value.indexOf('\n', start)) {
        chunks.push(current.value.slice(start, end + 1), pad)
        start = end + 1
      }
      chunks.push(current.value.slice(start))
    }
  }
  emit(span, '')
  return chunks.join('')
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
          ancestors: groups.map(group => group.own), ...(owner ? { owner } : {}),
          conditional, groupOpacity }
      }
    }
  }
  yield* visit(parts, 'scene')
}

/** Retain shallow group handles and write their SVG once after admission. */
export function drawNative(
  producer: DrawingProducer,
  context: RenderContext<PositionedDiagram>,
  family: string,
  style?: StyleSpec,
): NativeDrawing {
  const header = { family, width: context.positioned.width, height: context.positioned.height, colors: context.colors, transparent: context.resolved.renderOptions.transparent ?? false }
  const validator = createNativeSceneValidator(header)
  const checked = (): void => {
    const result = validator.finish()
    if (!result.valid) throw new SceneValidationError(result.diagnostics)
  }
  const leaf = (node: LeafNode): Fragment => {
    const svg = validator.node(node)
    return { kind: 'leaf', node, output: svgLiteral(svg), nodeCount: 1, depth: 0,
      prepared: node.kind === 'document' ? !/<\s*text/i.test(svg)
        : node.kind !== 'text' || node.measurement === 'prepared' && node.block !== undefined }
  }
  const count = (fragments: readonly Fragment[], group = 0): number => {
    const total = fragments.reduce((sum, fragment) => sum + fragment.nodeCount, group)
    if (total > SCENE_VALIDATION_LIMITS.maxNodes) throw new RangeError('Native drawing contains too many emitted nodes')
    return total
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
        childLength += child.node.output.length
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
      const output = joinSvg([svgLiteral(shell.open), ...fields.children.map(child => indentSvg(child.node.output, child.indent)), svgLiteral(shell.close)], shell.join)
      validator.serializationBytes(output.bytes)
      return { kind: 'group', output, children, matrix, own, owner: shell.owner,
        conditional: shell.visibility === 'conditional', opacity: Number(shell.paint?.opacity ?? 1),
        nodeCount, depth, prepared: !/<\s*text/i.test(shell.open + shell.close) && children.every(child => child.prepared) }
    },
    pathArtwork: fields => marks.drawPathArtwork(factory, fields),
  }
  const document: DrawingDocument<Fragment> = withDeferredTerminalProjections(() => producer(factory, context))
  checked()
  count(document.parts)
  if (document.parts.reduce((sum, part) => sum + part.output.length + 1, -1) > SCENE_VALIDATION_LIMITS.maxFinalSvgBytes) throw new RangeError('Native drawing exceeds the final SVG limit')
  const backdrop = pageRectFor(document, { seed: 0, ...(style ? { style } : {}) })
  const svg = writeSvg(joinSvg(document.parts.map((part, index) => index === 0 && backdrop ? joinSvg([part.output, svgLiteral(backdrop)], '\n') : part.output), '\n'))
  assertFinalSvgByteBudget(svg, 'native drawing output')
  return Object.freeze({ svg, header: { family: document.family, width: document.width, height: document.height, colors: document.colors, transparent: document.transparent }, preparedText: document.parts.every(part => part.prepared), paint: inspectNativePaintGeometry(document, paintEntries(document.parts)) })
}
