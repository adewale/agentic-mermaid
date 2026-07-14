// Canonical resolved-request -> positioned-artifact seam.
//
// Public adapters resolve source, config, appearance and shared options once.
// Family layout hooks are invoked only through this helper so graphical SVG,
// layout JSON, verification, certificates and quality projections cannot
// silently reconstruct a smaller option object.

import type { FamilyId } from './agent/types.ts'
import type { FamilyLayoutResult } from './agent/families.ts'
import type { NormalizedMermaidSource } from './mermaid-source.ts'
import type { PositionedDiagram } from './types.ts'
import {
  resolvedFamilyRenderContextOf,
  resolvedRenderExecutionPlanOf,
  type ResolvedRenderRequest,
} from './render-contract.ts'

export function normalizeFamilyLayoutResult(
  result: FamilyLayoutResult | PositionedDiagram,
): FamilyLayoutResult {
  return 'positioned' in result ? result : { positioned: result }
}

export function positionResolvedFamily(
  familyId: FamilyId,
  request: ResolvedRenderRequest,
  source: Readonly<NormalizedMermaidSource> = request.source,
): FamilyLayoutResult {
  const descriptor = resolvedRenderExecutionPlanOf(request).family
  if (descriptor.id !== familyId) {
    throw new Error(`Resolved request planned family ${descriptor.id}, not ${familyId}`)
  }
  if (!descriptor.layout) throw new Error(`No layout registered for Mermaid family ${familyId}`)
  const resolved = resolvedFamilyRenderContextOf(request)
  return normalizeFamilyLayoutResult(descriptor.layout({
    source,
    renderOptions: resolved.renderOptions,
    ...(resolved.styleFace ? { styleFace: resolved.styleFace } : {}),
    ...(resolved.familyConfig ? { familyConfig: resolved.familyConfig } : {}),
    ...(resolved.familyAppearance ? { familyAppearance: resolved.familyAppearance } : {}),
  }))
}
