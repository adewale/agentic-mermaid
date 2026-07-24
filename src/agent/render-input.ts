import { familyDetectionDiagnosticFromPreservedBody, MermaidFamilyDetectionError } from '../family-detection.ts'
import { serializeMermaid } from './serialize.ts'
import type { FamilyId, ParsedDiagram } from './types.ts'

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
  readonly expectedFamilyId?: FamilyId
}

const BODY_OWNED_RENDER_FAMILIES: ReadonlySet<FamilyId> = new Set(['state', 'sequence', 'quadrant', 'xychart', 'pie', 'gantt', 'mindmap', 'gitgraph', 'radar', 'sankey'])

/** One source authority for every ParsedDiagram render transport. Flowcharts
 * and source-order-sensitive families retain canonical authored order; typed
 * body-owned families serialize so caller-created stale source cannot win. */
export function renderSourceForParsedDiagram(input: ParsedDiagram): string {
  const bodyOwned = input.body.kind === 'extension' || BODY_OWNED_RENDER_FAMILIES.has(input.kind)
  return input.body.kind !== 'opaque' && bodyOwned ? serializeMermaid(input) : input.canonicalSource
}

export function prepareRenderInput(input: ParsedDiagram | string): PreparedRenderInput {
  if (typeof input === 'string') return { source: input }
  if (input.body.kind === 'preserved') {
    throw new MermaidFamilyDetectionError(familyDetectionDiagnosticFromPreservedBody(input.body))
  }
  return {
    source: renderSourceForParsedDiagram(input),
    expectedFamilyId: input.kind,
  }
}
