import type { DrawingDocument, DrawingFactory, DrawingProducer } from './drawing.ts'
import type { PositionedDiagram, RenderContext } from '../types.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
import * as marks from './marks.ts'
import { indentLines } from './serialization.ts'
import { semanticChildId } from './identity.ts'
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
): NativeDrawing {
  const header = { family, width: context.positioned.width, height: context.positioned.height, colors: context.colors, transparent: context.resolved.renderOptions.transparent ?? false }
  const validator = createNativeSceneValidator(header)
  const checked = (): void => {
    const result = validator.finish()
    if (!result.valid) throw new SceneValidationError(result.diagnostics)
  }
  const leaf = (node: Exclude<SceneNode, { kind: 'group' }>): Fragment => {
    const svg = validator.node(node)
    assertFinalSvgByteBudget(svg, 'native drawing fragment')
    return { svg, entries: [{ node }], nodeCount: 1, depth: 0,
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
      const nodeCount = count(fields.children.map(child => child.node), 1)
      if (fields.children.reduce((sum, child) => sum + child.node.svg.length, 0) > SCENE_VALIDATION_LIMITS.maxSerializationBytesPerNode) throw new RangeError('Native group has an oversized SVG serialization')
      const shell = marks.group({ ...fields, children: [] })
      validator.node(shell)
      const depth = 1 + Math.max(0, ...fields.children.map(child => child.node.depth))
      validator.depth(depth)
      const matrix = transformMatrix(shell.transform)
      const own = shell.identity ?? { id: shell.id, role: shell.role }
      const entries = fields.children.flatMap((child, index) => child.node.entries.map(entry => {
        const ancestors = entry.ancestors ?? []
        const owner = entry.owner ?? entry.node.owner ?? (ancestors.length ? undefined : shell.owner)
        if (entry.node.kind === 'shape' && !entry.node.identity && ancestors.length === 0) validator.enclosure(entry.node.id, own)
        return { ...entry, key: `${index}${entry.key ? `.${entry.key}` : ''}`,
          parentMatrix: composeMatrices(matrix, entry.parentMatrix ?? IDENTITY_MATRIX),
          ancestors: [own, ...ancestors], ...(owner ? { owner } : {}),
          conditional: shell.visibility === 'conditional' || entry.conditional,
          groupOpacity: Number(shell.paint?.opacity ?? 1) * (entry.groupOpacity ?? 1),
        }
      }))
      const svg = [shell.open, ...fields.children.map(child => indentLines(child.node.svg, child.indent)), shell.close].join(shell.join)
      validator.serialization(svg)
      assertFinalSvgByteBudget(svg, 'native drawing group')
      return { svg, entries, nodeCount, depth, prepared: !/<\s*text/i.test(shell.open + shell.close) && fields.children.every(child => child.node.prepared) }
    },
    pathArtwork(fields) {
      return factory.group({ id: fields.id, role: 'icon', open: fields.open, close: '</g>',
        ...(fields.transform ? { transform: fields.transform } : {}),
        ...(fields.owner ? { owner: fields.owner } : {}),
        ...(fields.channels ? { channels: fields.channels } : {}), join: fields.join ?? '',
        children: fields.paths.map((path, index) => ({ indent: fields.indent ?? 0,
          node: factory.shape({ id: semanticChildId(fields.id, 'path', index), role: 'icon', geometry: { kind: 'path', d: path }, paint: fields.paint,
            ...(fields.owner ? { owner: fields.owner } : {}) }),
        })),
      })
    },
  }
  const document: DrawingDocument<Fragment> = withDeferredTerminalProjections(() => producer(factory, context))
  checked()
  count(document.parts)
  if (document.parts.reduce((sum, part) => sum + part.svg.length + 1, -1) > SCENE_VALIDATION_LIMITS.maxFinalSvgBytes) throw new RangeError('Native drawing exceeds the final SVG limit')
  const svg = document.parts.map(part => part.svg).join('\n')
  assertFinalSvgByteBudget(svg, 'native drawing output')
  const entries = document.parts.flatMap((part, index) => part.entries.map(entry => ({ ...entry, key: `scene.${index}${entry.key ? `.${entry.key}` : ''}` })))
  return Object.freeze({ svg, header: { family: document.family, width: document.width, height: document.height, colors: document.colors, transparent: document.transparent }, preparedText: document.parts.every(part => part.prepared), paint: inspectNativePaintGeometry(document, entries) })
}
