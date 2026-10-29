/** Full public Scene document admission, including canonical external readback.
 * Incremental/native consumers use the same structural core without retaining
 * the external document producer and reader. */
import { buildStyleBlock, svgOpenTag, type DiagramColors } from '../theme.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { nodeWorldBounds } from './bounds.ts'
import { canonicalExternalNode } from './external-projection.ts'
import { canonicalizeSceneNodeSerialization, sceneNodeSerialization } from './serialization.ts'
import type { SceneDoc, SceneNode, SceneOwner } from './ir.ts'
import {
  add, record, structurallyEqual, SCENE_VALIDATION_LIMITS,
  SceneValidationError, sceneValidationMode, validateSceneDocument,
  type ExternalSceneDocumentChecks, type SceneValidationDiagnostic,
  type SceneValidationOptions, type SceneValidationResult, type ValidationState,
} from './scene-validation-core.ts'
export {
  SCENE_VALIDATION_VERSION,
  SCENE_VALIDATION_LIMITS,
  SceneValidationError,
  assertFinalSvgByteBudget,
  sceneValidationMode,
  createNativeSceneValidator,
} from './scene-validation-core.ts'
export type {
  SceneValidationDiagnosticCode,
  SceneValidationDiagnostic,
  SceneValidationResult,
  SceneValidationOptions,
  NativeSceneValidator,
} from './scene-validation-core.ts'

type MutableDiagnostic = SceneValidationDiagnostic
const MAX_SCENE_NODES = SCENE_VALIDATION_LIMITS.maxNodes
const MAX_FINAL_SVG_BYTES = SCENE_VALIDATION_LIMITS.maxFinalSvgBytes

function validateCanonicalExternalNode(
  node: SceneNode,
  path: string,
  diagnostics: MutableDiagnostic[],
  parent?: SceneOwner,
): void {
  if (node.kind === 'document') return
  let expected: SceneNode
  try {
    expected = canonicalExternalNode(node)
  } catch (error) {
    add(diagnostics, 'SCENE_FIDELITY', path, error instanceof Error ? error.message : String(error))
    return
  }
  const expectedOwner = node.kind === 'group' ? expected.owner : parent
  if (!structurallyEqual(node.owner, expectedOwner)) add(diagnostics, 'SCENE_FIDELITY', `${path}.owner`, 'must equal ownership derived from the external container tree')
  if (sceneNodeSerialization(node) !== sceneNodeSerialization(expected)) {
    add(diagnostics, 'SCENE_FIDELITY', path, 'must equal the canonical serialization generated from the external Scene fields')
  }
  if (!structurallyEqual(node.identity, expected.identity) || !structurallyEqual(node.accessibility, expected.accessibility)) {
    add(diagnostics, 'SCENE_FIDELITY', path, 'typed identity and accessibility must equal the canonical generated projection')
  }
  if (node.kind === 'group' && expected.kind === 'group') {
    if (node.open !== expected.open || node.close !== expected.close || node.join !== expected.join) {
      add(diagnostics, 'SCENE_FIDELITY', path, 'external containers must use the canonical generated wrapper and join')
    }
    node.children.forEach((child, index) => {
      if (child.indent !== 2) add(diagnostics, 'SCENE_FIDELITY', `${path}.children[${index}].indent`, 'external container children must use the canonical two-space indent')
      validateCanonicalExternalNode(child.node, `${path}.children[${index}].node`, diagnostics, { id: node.identity?.id ?? node.id, role: node.role })
    })
  }
  if (node.kind === 'text' && expected.kind === 'text') {
    for (const field of ['fontWeight', 'letterSpacing', 'display', 'textLayout', 'block', 'measurement', 'prepared'] as const) {
      if (!structurallyEqual(node[field], expected[field])) add(diagnostics, 'SCENE_FIDELITY', `${path}.${field}`, 'must equal text geometry derived by the external Scene builder')
    }
  }
  if (node.kind === 'connector' && expected.kind === 'connector') {
    const derivedFields = ['endpoints', 'route', 'stroke', 'hit', 'terminalProjection'] as const
    for (const field of derivedFields) {
      if (!structurallyEqual(node[field], expected[field])) {
        add(diagnostics, 'SCENE_FIDELITY', `${path}.${field}`, 'must equal semantics derived by the external Scene builder')
      }
    }
    if (!structurallyEqual(node.markers, expected.markers)) {
      add(diagnostics, 'SCENE_FIDELITY', `${path}.markers`, 'must equal the canonical external start/mid/end marker projection')
    }
  }
}

function validateCanonicalExternalScene(scene: SceneDoc, diagnostics: MutableDiagnostic[]): void {
  scene.parts.forEach((node, index) => validateCanonicalExternalNode(node, `scene.parts[${index}]`, diagnostics))
}

function boundedExternalSvg(
  parts: readonly unknown[],
  diagnostics: MutableDiagnostic[],
): string | undefined {
  const chunks: string[] = []
  let bytes = Math.max(0, parts.length - 1) // one ASCII newline between chunks
  if (bytes > MAX_FINAL_SVG_BYTES) {
    add(diagnostics, 'SCENE_BOUNDS', 'scene.parts', `serialized SVG exceeds the aggregate ${MAX_FINAL_SVG_BYTES}-byte limit`)
    return undefined
  }
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (!record(part)) return undefined
    let serialized: string
    try { serialized = sceneNodeSerialization(part as unknown as SceneNode) } catch { return undefined }
    const remaining = Math.max(0, MAX_FINAL_SVG_BYTES - bytes)
    const chunkBytes = boundedUtf8ByteLength(serialized, remaining)
    if (chunkBytes > remaining) {
      add(diagnostics, 'SCENE_BOUNDS', 'scene.parts', `serialized SVG exceeds the aggregate ${MAX_FINAL_SVG_BYTES}-byte limit`)
      return undefined
    }
    bytes += chunkBytes
    chunks.push(serialized)
  }
  return chunks.join('\n')
}

function validateExternalDocument(value: Record<string, unknown> & { parts: unknown[] }, state: ValidationState, widthOk: boolean, heightOk: boolean): string | undefined {
  const diagnostics = state.diagnostics
  const externalSvg = (value.parts as readonly unknown[]).length <= MAX_SCENE_NODES
    ? boundedExternalSvg(value.parts as readonly unknown[], diagnostics)
    : undefined
  const indexed: Array<{ part: Record<string, unknown>; index: number }> = []
  for (let index = 0; index < Math.min(value.parts.length, MAX_SCENE_NODES); index++) {
    const part = value.parts[index]
    if (record(part)) indexed.push({ part, index })
  }
  const documents = indexed.filter(entry => entry.part.kind === 'document')
  const opens = documents.filter(entry => entry.part.element === 'open')
  const titles = documents.filter(entry => entry.part.element === 'title')
  const descriptions = documents.filter(entry => entry.part.element === 'description')
  const definitions = documents.filter(entry => entry.part.element === 'definitions')
  const closes = documents.filter(entry => entry.part.element === 'close')
  if (opens.length !== 1 || opens[0]?.index !== 0) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents require exactly one leading open mark')
  if (titles.length !== 1 || titles[0]?.index !== 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents require exactly one title after the open mark')
  if (descriptions.length > 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents allow at most one description')
  if (definitions.length > 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents allow at most one definitions mark')
  if (closes.length !== 1 || closes[0]?.index !== value.parts.length - 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents require exactly one trailing close')

  const furnitureEnd = 1 + titles.length + descriptions.length + definitions.length
  const expectedFurniture = [
    ...titles,
    ...descriptions,
    ...definitions,
  ].map(entry => entry.index)
  if (expectedFurniture.some((index, offset) => index !== offset + 1) || documents.some(entry => !['open', 'close'].includes(String(entry.part.element)) && entry.index > furnitureEnd)) {
    add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'title, description, and typed definitions must be contiguous leading furniture')
  }

  const title = titles[0]?.part
  if (title && (title.id !== 'external-scene-title' || title.domId !== 'external-scene-title')) {
    add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${titles[0]!.index}]`, 'external title must use the canonical generated identity')
  }
  if (title && typeof title.text === 'string') {
    const expected = canonicalizeSceneNodeSerialization(
      `<title id="external-scene-title">${escapeXml(title.text)}</title>`,
    )
    if (sceneNodeSerialization(title as unknown as SceneNode) !== expected) add(diagnostics, 'SCENE_FIDELITY', `scene.parts[${titles[0]!.index}]`, 'external title must use the canonical generated serialization')
  }
  const description = descriptions[0]?.part
  if (description && (description.id !== 'external-scene-description' || description.domId !== 'external-scene-description')) {
    add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${descriptions[0]!.index}]`, 'external description must use the canonical generated identity')
  }
  if (description && typeof description.text === 'string') {
    const expected = canonicalizeSceneNodeSerialization(
      `<desc id="${escapeAttr('external-scene-description')}">${escapeXml(description.text)}</desc>`,
    )
    if (sceneNodeSerialization(description as unknown as SceneNode) !== expected) add(diagnostics, 'SCENE_FIDELITY', `scene.parts[${descriptions[0]!.index}]`, 'external description must use the canonical generated serialization')
  }
  const definition = definitions[0]?.part
  if (definition && (definition.id !== 'external-scene-definitions' || !Array.isArray(definition.markerResources) || definition.markerResources.length === 0)) {
    add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${definitions[0]!.index}]`, 'external definitions must be the canonical non-empty typed marker resource mark')
  }
  const close = closes[0]?.part
  if (close && close.id !== 'svg-close') add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${closes[0]!.index}]`, 'external close must use the canonical generated identity')

  const open = opens[0]?.part
  if (open) {
    if (open.id !== 'external-scene-prelude') add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts[0].id', 'external open mark must use the canonical generated identity')
    try {
      const colors = value.colors as unknown as DiagramColors
      const ariaIds = ['external-scene-title', ...(descriptions.length ? ['external-scene-description'] : [])].join(' ')
      const expected = canonicalizeSceneNodeSerialization([
        svgOpenTag(value.width as number, value.height as number, colors, Boolean(value.transparent), {
          attrs: { role: 'img', 'aria-labelledby': ariaIds },
        }),
        buildStyleBlock(colors.font ?? 'Inter', false, colors.shadow, false),
      ].join('\n'))
      if (sceneNodeSerialization(open as unknown as SceneNode) !== expected) add(diagnostics, 'SCENE_SECURITY', 'scene.parts[0]', 'must be the canonical CSS-free external document serialization')
    } catch (error) {
      add(diagnostics, 'SCENE_SECURITY', 'scene.parts[0]', error instanceof Error ? error.message : String(error))
    }
  }
  for (const reference of state.markerReferences) {
    const resource = state.markerIds.get(reference.id)
    if (!resource) add(diagnostics, 'SCENE_REFERENCE', reference.path, `references undeclared marker "${reference.id}"`)
    else if (resource !== reference.marker) add(diagnostics, 'SCENE_REFERENCE', reference.path, `must reference the exact typed marker resource "${reference.id}"`)
  }
  for (const reference of state.endpointReferences) {
    if (!state.ids.has(reference.id)) add(diagnostics, 'SCENE_REFERENCE', reference.path, `references unknown Scene id "${reference.id}"`)
  }
  if (widthOk && heightOk && diagnostics.length === 0) {
    const docWidth = value.width as number
    const docHeight = value.height as number
    const visitBounds = (node: unknown, path: string): void => {
      if (!record(node)) return
      if (['shape', 'connector', 'text'].includes(String(node.kind))) {
        try {
          const bounds = nodeWorldBounds(node as unknown as SceneNode)
          if (bounds && (bounds.x0 < -1 || bounds.y0 < -1 || bounds.x1 > docWidth + 1 || bounds.y1 > docHeight + 1)) {
            add(diagnostics, 'SCENE_BOUNDS', path, `visual bounds [${bounds.x0}, ${bounds.y0}, ${bounds.x1}, ${bounds.y1}] escape the ${docWidth}x${docHeight} document`)
          }
        } catch (error) {
          add(diagnostics, 'SCENE_BOUNDS', path, error instanceof Error ? error.message : String(error))
        }
      }
      if (node.kind === 'group' && Array.isArray(node.children)) {
        for (let index = 0; index < Math.min(node.children.length, MAX_SCENE_NODES); index++) {
          const child = node.children[index]
          if (record(child)) visitBounds(child.node, `${path}.children[${index}].node`)
        }
      }
    }
    for (let index = 0; index < Math.min(value.parts.length, MAX_SCENE_NODES); index++) {
      visitBounds(value.parts[index], `scene.parts[${index}]`)
    }
  }
  return externalSvg
}

const EXTERNAL_DOCUMENT_CHECKS: ExternalSceneDocumentChecks = {
  document: (value, state, widthOk, heightOk) => validateExternalDocument(value as Record<string, unknown> & { parts: unknown[] }, state, widthOk, heightOk),
  canonical: validateCanonicalExternalScene,
}

/** Validate an unknown value against the current Scene behavioral contract. */
export function validateSceneDoc(value: unknown, options: SceneValidationOptions = {}): SceneValidationResult {
  return validateSceneDocument(value, options, true, EXTERNAL_DOCUMENT_CHECKS)
}

/**
 * Admission of a Scene one of our own families just lowered. Internal Scenes
 * skip the cross-checks between facts our lowering derives twice unless scene
 * assertions are on; every other rule, and every rule for external Scenes,
 * always applies.
 */
export function assertAdmissibleSceneDoc(value: unknown, mode: 'internal' | 'external' | undefined, crossChecks: boolean): asserts value is SceneDoc {
  const result = validateSceneDocument(value, { mode }, crossChecks || sceneValidationMode(value, { mode }) === 'external', EXTERNAL_DOCUMENT_CHECKS)
  if (!result.valid) throw new SceneValidationError(result.diagnostics)
}

export function assertValidSceneDoc(
  value: unknown,
  options: SceneValidationOptions = {},
): asserts value is SceneDoc {
  const result = validateSceneDoc(value, options)
  if (!result.valid) throw new SceneValidationError(result.diagnostics)
}
