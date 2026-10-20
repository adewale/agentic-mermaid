import { isOwnedFamily } from './experimental/owned-family.ts'
import { DefaultBackend } from './scene/backend.ts'
import { nativeDrawingOf } from './scene/drawing.ts'
import { sceneAssertionsEnabled } from './scene/assertions.ts'
import { PERFORMANCE_EXPERIMENTS, performanceExperimentEnabled } from './experimental-performance.ts'
import { borrowedPositioned, cachedPositioned, retainOwnedSequencePositioned, retainPositioned } from './experimental/position-cache.ts'
// Canonical resolved-request -> positioned-artifact seam.
//
// Public adapters resolve source, config, appearance and shared options once.
// Family layout hooks are invoked only through this helper so graphical SVG,
// layout JSON, verification, certificates and quality projections cannot
// silently reconstruct a smaller option object.

import type { FamilyLayoutResult, FamilyPositionedProjectionOptions, FamilyPositionedView } from './agent/families.ts'
import type { FamilyId } from './agent/types.ts'
import { assessRenderedLayoutHardViolations } from './family-rubric.ts'
import { LayoutCertificationError } from './layout/certification-error.ts'
import { graphLayoutDecisionsOf, retainGraphLayoutDecision, withGraphLayoutDecisionObserver, type GraphLayoutDecision } from './layout/backend.ts'
import type { NormalizedMermaidSource } from './mermaid-source.ts'
import { type ResolvedRenderRequest, resolvedFamilyRenderContextOf, resolvedRenderExecutionPlanOf } from './render-contract.ts'
import { withTextMeasurementExecution } from './text-measurement-profile.ts'
import type { PositionedDiagram } from './types.ts'

// A certification and its consumers use one projection of the same final
// artifact. Keep this internal evidence outside descriptor-owned return data.
const retainedProjections = new WeakMap<FamilyLayoutResult, FamilyPositionedView>()
const reportedFallbacks = new WeakSet<ResolvedRenderRequest>()

/** Pixel dependencies in terminal renderers use the same evidence boundary. */
export function retainRequestGraphLayoutDecision(request: ResolvedRenderRequest, decision: GraphLayoutDecision, role: 'primary' | 'companion'): void {
  retainGraphLayoutDecision(request, { ...decision, role })
  if (decision.requested !== 'agentic' || decision.selected !== 'elk' || reportedFallbacks.has(request)) return
  reportedFallbacks.add(request)
  const diagnostic = {
    code: 'INEFFECTIVE_CONFIG' as const,
    field: 'graphLayout.backend',
    message: `Agentic graph layout declined this input; using the requested ELK fallback: ${decision.reason ?? 'candidate rejected'}`,
  }
  const report = resolvedRenderExecutionPlanOf(request).onConfigDiagnostic ?? ((value: typeof diagnostic) => console.warn(value.message))
  report(diagnostic)
}

export function retainedFamilyProjection(result: FamilyLayoutResult): FamilyPositionedView | undefined {
  return retainedProjections.get(result)
}

export function normalizeFamilyLayoutResult(result: FamilyLayoutResult | PositionedDiagram): FamilyLayoutResult {
  return 'positioned' in result ? result : { positioned: result }
}

export function positionResolvedFamily(familyId: FamilyId, request: ResolvedRenderRequest, source: Readonly<NormalizedMermaidSource> = request.source, projectionOptions: FamilyPositionedProjectionOptions = {}): FamilyLayoutResult {
  return positionFamily(familyId, request, source, projectionOptions, false)
}

/** Private render adapter: borrowed geometry never crosses a public boundary. */
export function positionFamilyForNativeRender(request: ResolvedRenderRequest): FamilyLayoutResult {
  const plan = resolvedRenderExecutionPlanOf(request)
  const borrow = plan.mode === 'scene' && plan.backend?.backend === DefaultBackend
    && isOwnedFamily(plan.family) && !!nativeDrawingOf(plan.family.lowerScene) && !sceneAssertionsEnabled(request)
  return positionFamily(plan.family.id, request, request.source, {}, borrow)
}

function positionFamily(familyId: FamilyId, request: ResolvedRenderRequest, source: Readonly<NormalizedMermaidSource>, projectionOptions: FamilyPositionedProjectionOptions, borrow: boolean): FamilyLayoutResult {
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
  const environment = (globalThis as { process?: { env?: Record<string, string | undefined> }; AGENTIC_MERMAID_ELK_CACHE?: unknown }).process?.env
  const cacheEnabled = performanceExperimentEnabled('position-cache') && certifyFinal && familyId !== 'gantt' && !executionPlan.textMeasurement
    && (environment?.AGENTIC_MERMAID_ELK_CACHE ?? (globalThis as { AGENTIC_MERMAID_ELK_CACHE?: unknown }).AGENTIC_MERMAID_ELK_CACHE) !== '0'
  // Admitted cleanup provenance is derived entirely from originalText. Keep
  // every authoritative field; explicit source overrides retain the full key.
  const cacheSource = cacheEnabled && source === request.source ? { ...source, cleanup: undefined } : source
  const cacheKey = cacheEnabled ? JSON.stringify([cacheSource, request.renderOptions, request.appearance, request.familyConfig, projectionOptions,
    Object.entries(environment ?? {}).filter(([key]) => key.startsWith('APL_')).sort(), PERFORMANCE_EXPERIMENTS.map(performanceExperimentEnabled)]) : undefined
  const boundedKey = cacheKey !== undefined && cacheKey.length <= 65536 ? cacheKey : undefined
  return withTextMeasurementExecution(executionPlan.textMeasurement, () => {
    const role = request.output === 'ascii' || request.output === 'unicode' || request.output === 'html' ? 'companion' : 'primary'
    if (borrow && boundedKey !== undefined) {
      const snapshot = borrowedPositioned(descriptor, boundedKey)
      if (snapshot?.projection) {
        for (const decision of graphLayoutDecisionsOf(snapshot.result)) retainRequestGraphLayoutDecision(request, decision, role)
        retainedProjections.set(snapshot.result, snapshot.projection)
        return snapshot.result
      }
    }
    const hit = boundedKey === undefined ? undefined : cachedPositioned(descriptor, boundedKey)
    const produced: GraphLayoutDecision[] = []
    const result = hit ?? normalizeFamilyLayoutResult(
      withGraphLayoutDecisionObserver(decision => {
        produced.push(decision)
        retainRequestGraphLayoutDecision(request, decision, role)
      }, () => descriptor.layout!({
        source,
        renderOptions: resolved.renderOptions,
        ...(resolved.styleFace ? { styleFace: resolved.styleFace } : {}),
        ...(resolved.familyConfig ? { familyConfig: resolved.familyConfig } : {}),
        ...(resolved.familyAppearance ? { familyAppearance: resolved.familyAppearance } : {}),
      })),
    )
    if (hit) for (const decision of graphLayoutDecisionsOf(hit)) retainRequestGraphLayoutDecision(request, decision, role)
    else for (const decision of produced) retainGraphLayoutDecision(result, decision)
    if (certifyFinal) {
      // Specialized native layouters have one deterministic candidate; do not
      // rerun identical work as a pretend fallback. Graph families already ran
      // their bounded stronger route certification before reaching this seam.
      try {
        const view = descriptor.projectPositioned!({ positioned: result.positioned, options: projectionOptions })
        const violations = assessRenderedLayoutHardViolations({ ...view, kind: familyId })
        if (violations.length) throw new LayoutCertificationError([{ strategy, violations: violations.map(value => `${value.metric}: ${value.detail}`) }])
        retainedProjections.set(result, view)
      } catch (error) {
        if (error instanceof LayoutCertificationError) throw error
        throw new LayoutCertificationError([{ strategy, violations: [error instanceof Error ? error.message : String(error)] }])
      }
    }
    if (!hit && boundedKey !== undefined) {
      // The original Sequence hook parses a fresh private diagram. Native SVG
      // consumes its geometry without exposing it; shared prepared text is frozen.
      const retain = borrow && familyId === 'sequence' && request.output === 'svg'
        ? retainOwnedSequencePositioned : retainPositioned
      retain(descriptor, boundedKey, result, retainedProjections.get(result))
    }
    return result
  })
}
