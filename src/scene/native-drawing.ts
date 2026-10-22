import { pageRectFor } from './backend.ts'
import type { StyleSpec } from './style-registry.ts'
import type { DrawingDocument, DrawingFactory, DrawingProducer } from './drawing.ts'
import type { PositionedDiagram, RenderContext } from '../types.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
import * as marks from './marks.ts'
import { indentLines } from './serialization.ts'
import { composeMatrices, IDENTITY_MATRIX, transformMatrix } from './transforms.ts'
import { inspectNativePaintGeometry, type NativePaintEntry, type ScenePaintGeometryInspection } from './inspection.ts'
import { createNativeSceneValidator, SceneValidationError, SCENE_VALIDATION_LIMITS, assertFinalSvgByteBudget } from './scene-validation.ts'
import { withDeferredTerminalProjections } from './deferred-terminal-projection.ts'

interface Fragment {
  readonly svg: string
  readonly entries: readonly NativePaintEntry[]
  readonly nodeCount: number
  readonly depth: number
  readonly prepared: boolean
}
export interface NativeDrawing {
  readonly svg: string
  readonly paint: ScenePaintGeometryInspection
  readonly preparedText: boolean
  readonly header: Omit<SceneDoc, 'parts'>
}

/** Compose SVG immediately. Group children never become a retained mark tree. */
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
  const leaf = (node: Exclude<SceneNode, { kind: 'group' }>): Fragment => {
    const svg = validator.node(node)
    return { svg, entries: [{ node }], nodeCount: 1, depth: 0,
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
      let nodeCount = 1, characters = 0, depth = 1, prepared = true
      for (const child of fields.children) {
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
      const matrix = transformMatrix(shell.transform)
      const own = shell.identity ?? { id: shell.id, role: shell.role }
      const entries: NativePaintEntry[] = []
      const conditional = shell.visibility === 'conditional'
      const groupOpacity = Number(shell.paint?.opacity ?? 1)
      for (let index = 0; index < fields.children.length; index++) {
        for (const entry of fields.children[index]!.node.entries) {
          const ancestors = entry.ancestors
          const ancestorCount = ancestors?.length ?? 0
          const owner = entry.owner ?? entry.node.owner ?? (ancestorCount ? undefined : shell.owner)
          if (entry.node.kind === 'shape' && !entry.node.identity && ancestorCount === 0) validator.enclosure(entry.node.id, own)
          // An absent transform on both levels already means the identity.
          // Other matrices retain the same composition and numeric behavior.
          const parentMatrix = !shell.transform && entry.parentMatrix === undefined ? undefined
            : composeMatrices(matrix, entry.parentMatrix ?? IDENTITY_MATRIX)
          entries.push({ ...entry, key: `${index}${entry.key ? `.${entry.key}` : ''}`,
            ...(parentMatrix ? { parentMatrix } : {}),
            ancestors: ancestors ? [own, ...ancestors] : [own], ...(owner ? { owner } : {}),
            conditional: conditional || entry.conditional,
            groupOpacity: groupOpacity * (entry.groupOpacity ?? 1),
          })
        }
      }
      const fragments = [shell.open]
      for (const child of fields.children) fragments.push(indentLines(child.node.svg, child.indent))
      fragments.push(shell.close)
      const svg = fragments.join(shell.join)
      validator.serialization(svg)
      return { svg, entries, nodeCount, depth, prepared: !/<\s*text/i.test(shell.open + shell.close) && prepared }
    },
    pathArtwork: fields => marks.drawPathArtwork(factory, fields),
  }
  const document: DrawingDocument<Fragment> = withDeferredTerminalProjections(() => producer(factory, context))
  checked()
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
  const entries: NativePaintEntry[] = []
  for (let index = 0; index < document.parts.length; index++) {
    for (const entry of document.parts[index]!.entries) entries.push({ ...entry, key: `scene.${index}${entry.key ? `.${entry.key}` : ''}` })
  }
  return Object.freeze({ svg, header: { family: document.family, width: document.width, height: document.height, colors: document.colors, transparent: document.transparent }, preparedText, paint: inspectNativePaintGeometry(document, entries) })
}
