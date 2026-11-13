import { familyDetectionDiagnosticFromPreservedBody, MermaidFamilyDetectionError } from '../family-detection.ts'
import { getFamily } from './families.ts'
import { sameExtensionIdentity } from '../shared/extension-identity.ts'
import { serializeMermaid, wrapperPrefix } from './serialize.ts'
import type { ParsedDiagram } from './types.ts'
import type { RenderExecutionResolutionOptions } from '../render-contract.ts'
import { ownedParsedRenderBody, prepareParsedModelHandoff } from './owned-render-model.ts'

/**
 * Prepared form of a public source-or-parsed render input.
 *
 * Parsed diagrams retain an identity assertion alongside their serialized
 * source. The canonical request waist verifies that assertion after entity
 * decoding and family detection, so serialization can never silently turn a
 * parsed diagram into another family. Preserved unknown/upstream envelopes
 * are deliberately non-executable and fail before serialization.
 */
export interface PreparedRenderInput {
  readonly source: string
  readonly resolutionOptions: Pick<RenderExecutionResolutionOptions, 'expectedFamilyId' | 'parsedModelHandoff'>
}

/** Every render transport consults the owning descriptor once. Source-sensitive
 * families preserve canonical order; body-owned families publish typed edits.
 * Opaque whitespace/wrapper exceptions live with their family operations. */
export function renderSourceForParsedDiagram(input: ParsedDiagram): string {
  return parsedDiagramRenderSource(input, getFamily(input.kind))
}

function parsedDiagramRenderSource(input: ParsedDiagram, family: ReturnType<typeof getFamily>): string {
  // A replaced registration must not inspect data owned by its predecessor.
  const current = input.body.kind !== 'extension' || ('descriptorIdentity' in input && sameExtensionIdentity(input.descriptorIdentity, family?.identity))
  const policy = current ? family?.renderSource : undefined
  const source = policy ? policy(input.body) : (input.body.kind === 'extension' ? 'serialized' : 'canonical')
  if (source !== 'canonical' && source !== 'serialized') throw new TypeError(`Family ${input.kind} returned an invalid render source policy`)
  if (source === 'serialized') return serializeMermaid(input)
  // A parsed body has no config envelope; a mutated one is serialized with
  // it. Render either under the wrapper serialization emits (frontmatter title
  // and config, init directives), so a parsed diagram draws what its saved
  // source draws.
  const body = ownedParsedRenderBody(input) ?? input.canonicalSource
  const wrapper = wrapperPrefix(input.meta, 'verbatim', body, input.kind)
  return body.startsWith(wrapper) ? body : wrapper + body
}

export function prepareRenderInput(input: ParsedDiagram | string): PreparedRenderInput {
  if (typeof input === 'string') return { source: input, resolutionOptions: {} }
  if (input.body.kind === 'preserved') {
    throw new MermaidFamilyDetectionError(familyDetectionDiagnosticFromPreservedBody(input.body))
  }
  const family = getFamily(input.kind)
  const source = parsedDiagramRenderSource(input, family)
  const parsedModelHandoff = prepareParsedModelHandoff(input, family, source)
  return { source, resolutionOptions: { expectedFamilyId: input.kind, ...(parsedModelHandoff ? { parsedModelHandoff } : {}) } }
}
