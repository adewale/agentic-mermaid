import { isOwnedFamily } from './experimental/owned-family.ts'
import { isOriginalEnrolledDefaultBackend } from './scene/backend.ts'
import { nativeDrawingOf, originalNativeDrawingOf, type DrawingProducer } from './scene/drawing.ts'
import { sceneAssertionsEnabled } from './scene/assertions.ts'
import { PERFORMANCE_EXPERIMENTS, performanceExperimentEnabled } from './experimental-performance.ts'
import { borrowedPositioned, cachedPositioned, clonePositioned, isRetainedPositionedSnapshot, retainOwnedNativeSvgPositioned, retainPositioned } from './experimental/position-cache.ts'
import { observeCache } from './performance-observations.ts'
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
const borrowedNativeProducers = new WeakMap<FamilyLayoutResult, DrawingProducer>()
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
  // A modified native producer may retain its context. Give it the ordinary
  // independent copy, including on the call that first fills the cache, so a
  // later restored original producer never borrows caller-retained geometry.
  const producer = nativeDrawingOf(plan.family.lowerScene)
  const borrow = plan.mode === 'scene' && isOriginalEnrolledDefaultBackend(plan.backend?.backend)
    && isOwnedFamily(plan.family) && !plan.textMeasurement
    && !!producer && producer === originalNativeDrawingOf(plan.family.lowerScene) && !sceneAssertionsEnabled(request)
  const result = positionFamily(plan.family.id, request, request.source, {}, borrow, true)
  if (borrow && isRetainedPositionedSnapshot(result)) borrowedNativeProducers.set(result, producer!)
  return result
}

/** A stage/cache observer can replace the native capability after positioning.
 * Clone only our known raw cache graph before handing it to a different
 * producer. Public positioned inputs keep their original getter observations. */
export function positionedForNativeProducer(layout: FamilyLayoutResult, producer: DrawingProducer): PositionedDiagram {
  const original = borrowedNativeProducers.get(layout)
  return original && original !== producer ? clonePositioned(layout.positioned, true) : layout.positioned
}

function positionFamily(familyId: FamilyId, request: ResolvedRenderRequest, source: Readonly<NormalizedMermaidSource>, projectionOptions: FamilyPositionedProjectionOptions, borrow: boolean, immutableText = false): FamilyLayoutResult {
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
  const cacheKey = cacheEnabled ? JSON.stringify([cacheSource, request.renderOptions, request.appearance, request.familyConfig, projectionOptions, familyId === 'class' ? resolved.paintBackendId ?? 'backend:default' : undefined,
    Object.entries(environment ?? {}).filter(([key]) => key.startsWith('APL_')).sort(), PERFORMANCE_EXPERIMENTS.map(performanceExperimentEnabled)]) : undefined
  const boundedKey = cacheKey !== undefined && cacheKey.length <= 65536 ? cacheKey : undefined
  if (boundedKey === undefined) observeCache('positioned-layout', 'bypass',
    !performanceExperimentEnabled('position-cache') ? 'disabled' : !certifyFinal ? 'external-family'
      : familyId === 'gantt' ? 'time-dependent-family' : executionPlan.textMeasurement ? 'custom-text-measurement'
        : cacheKey === undefined ? 'elk-cache-disabled' : 'key-limit')
  return withTextMeasurementExecution(executionPlan.textMeasurement, () => {
    const role = request.output === 'ascii' || request.output === 'unicode' || request.output === 'html' ? 'companion' : 'primary'
    if (borrow && boundedKey !== undefined) {
      const snapshot = borrowedPositioned(descriptor, boundedKey, request.output === 'svg' ? request : undefined)
      if (snapshot?.projection) {
        for (const decision of graphLayoutDecisionsOf(snapshot.result)) retainRequestGraphLayoutDecision(request, decision, role)
        retainedProjections.set(snapshot.result, snapshot.projection)
        return snapshot.result
      }
    }
    // The private borrow probe already observed this logical lookup. Retain
    // the public-copy fallback without counting its second probe again.
    const hit = boundedKey === undefined ? undefined : cachedPositioned(descriptor, boundedKey, borrow, immutableText)
    const produced: GraphLayoutDecision[] = []
    const result = hit ?? normalizeFamilyLayoutResult(
      withGraphLayoutDecisionObserver(decision => {
        produced.push(decision)
        retainRequestGraphLayoutDecision(request, decision, role)
      }, () => descriptor.layout!({
        source,
        renderOptions: resolved.renderOptions,
        ...(resolved.styleFace ? { styleFace: resolved.styleFace } : {}),
        ...(resolved.paintBackendId ? { paintBackendId: resolved.paintBackendId } : {}),
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
      // These original hooks parse fresh private diagrams. Native SVG consumes
      // their geometry without exposing it; shared prepared text is frozen.
      const retain = borrow && request.output === 'svg'
        && (familyId === 'sequence' || familyId === 'flowchart' || familyId === 'state')
        ? retainOwnedNativeSvgPositioned : retainPositioned
      retain(descriptor, boundedKey, result, retainedProjections.get(result))
    }
    return result
  })
}
