// Canonical resolved-request -> positioned-artifact seam.
//
// Public adapters resolve source, config, appearance and shared options once.
// Family layout hooks are invoked only through this helper so graphical SVG,
// layout JSON, verification, certificates and quality projections cannot
// silently reconstruct a smaller option object.

import type { FamilyLayoutResult, FamilyPositionedProjectionOptions, FamilyPositionedView } from './agent/families.ts'
import type { FamilyId } from './agent/types.ts'
import { assessRenderedLayout, familyHardViolations } from './family-rubric.ts'
import { LayoutCertificationError } from './layout/certification-error.ts'
import type { NormalizedMermaidSource } from './mermaid-source.ts'
import { type ResolvedRenderRequest, resolvedFamilyRenderContextOf, resolvedRenderExecutionPlanOf } from './render-contract.ts'
import { withTextMeasurementExecution } from './text-measurement-profile.ts'
import type { PositionedDiagram } from './types.ts'

// A certification and its consumers use one projection of the same final
// artifact. Keep this internal evidence outside descriptor-owned return data.
const retainedProjections = new WeakMap<FamilyLayoutResult, FamilyPositionedView>()

export function retainedFamilyProjection(result: FamilyLayoutResult): FamilyPositionedView | undefined {
  return retainedProjections.get(result)
}

export function normalizeFamilyLayoutResult(result: FamilyLayoutResult | PositionedDiagram): FamilyLayoutResult {
  return 'positioned' in result ? result : { positioned: result }
}

export function positionResolvedFamily(familyId: FamilyId, request: ResolvedRenderRequest, source: Readonly<NormalizedMermaidSource> = request.source, projectionOptions: FamilyPositionedProjectionOptions = {}): FamilyLayoutResult {
  const executionPlan = resolvedRenderExecutionPlanOf(request)
  const descriptor = executionPlan.family
  if (descriptor.id !== familyId) {
    throw new Error(`Resolved request planned family ${descriptor.id}, not ${familyId}`)
  }
  if (!descriptor.layout) throw new Error(`No layout registered for Mermaid family ${familyId}`)
  // FamilyId reserves the family: namespace for extensions. Keep this seam
  // independent of the complete registry so SVG-only imports stay lazy.
  const certifyFinal = !familyId.startsWith('family:')
  const strategy = `${familyId}:final`
  if (certifyFinal && !descriptor.projectPositioned) {
    throw new LayoutCertificationError([{ strategy, violations: ['missing final geometry projection'] }])
  }
  const resolved = resolvedFamilyRenderContextOf(request)
  return withTextMeasurementExecution(executionPlan.textMeasurement, () => {
    const result = normalizeFamilyLayoutResult(
      descriptor.layout!({
        source,
        renderOptions: resolved.renderOptions,
        ...(resolved.styleFace ? { styleFace: resolved.styleFace } : {}),
        ...(resolved.familyConfig ? { familyConfig: resolved.familyConfig } : {}),
        ...(resolved.familyAppearance ? { familyAppearance: resolved.familyAppearance } : {}),
      }),
    )
    if (certifyFinal) {
      // Specialized native layouters have one deterministic candidate; do not
      // rerun identical work as a pretend fallback. Graph families already ran
      // their bounded stronger route certification before reaching this seam.
      try {
        const view = descriptor.projectPositioned!({ positioned: result.positioned, options: projectionOptions })
        const violations = familyHardViolations(assessRenderedLayout({ ...view, kind: familyId }))
        if (violations.length) throw new LayoutCertificationError([{ strategy, violations: violations.map(value => `${value.metric}: ${value.detail}`) }])
        retainedProjections.set(result, view)
      } catch (error) {
        if (error instanceof LayoutCertificationError) throw error
        throw new LayoutCertificationError([{ strategy, violations: [error instanceof Error ? error.message : String(error)] }])
      }
    }
    return result
  })
}
