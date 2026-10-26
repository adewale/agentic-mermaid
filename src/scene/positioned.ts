import { assertBackendConformance, isBuiltinDefaultBackend } from './backend.ts'
import { nativeDrawingOf, originalNativeDrawingOf } from './drawing.ts'
import { drawNative, type NativeDrawing } from './native-drawing.ts'
import type { FamilyLayoutResult } from '../agent/families.ts'
import type { ResolvedRenderRequest } from '../render-contract.ts'
import { resolvedFamilyRenderContextOf, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionedForNativeProducer, retainedFamilyProjection } from '../positioning.ts'
import { withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { admitFamilyScene } from './admission.ts'
import { sceneAssertionsEnabled } from './assertions.ts'
import { withDeferredTerminalProjections } from './deferred-terminal-projection.ts'
import type { SceneDoc } from './ir.ts'
import { certifyNativePaint, certifyScenePaint, type PaintLayoutCertification } from './paint-certification.ts'
import { observeCache, observeFallback } from '../performance-observations.ts'
import { cachedNativeDrawing, retainNativeDrawing } from '../experimental/position-cache.ts'
import { paintPrimitiveSource, scenePrimitiveMatrix } from './inspection.ts'

interface PositionedScene { scene: SceneDoc; crossChecks: boolean; certification?: PaintLayoutCertification }
interface PositionedNative { drawing: NativeDrawing; certification?: PaintLayoutCertification }
const native = new WeakMap<FamilyLayoutResult, WeakMap<ResolvedRenderRequest, PositionedNative>>()
const retained = new WeakMap<FamilyLayoutResult, WeakMap<ResolvedRenderRequest, PositionedScene>>()

/** Lower once from the actual positioned artifact, shared by SVG, layout,
 * verification and receipt consumers. No source parse or layout is repeated. */
export function retainedPositionedScene(request: ResolvedRenderRequest, layout: FamilyLayoutResult): SceneDoc {
  let requests = retained.get(layout)
  if (!requests) { requests = new WeakMap(); retained.set(layout, requests) }
  const prior = requests.get(request)
  if (prior) {
    observeCache('positioned-scene', 'hit')
    if (sceneAssertionsEnabled(request) && !prior.crossChecks) {
      admitFamilyScene(resolvedRenderExecutionPlanOf(request).family, prior.scene, true)
      prior.crossChecks = true
    }
    return prior.scene
  }
  observeCache('positioned-scene', 'miss')
  const plan = resolvedRenderExecutionPlanOf(request)
  if (!plan.family.lowerScene) throw new Error(`Resolved ${request.output} family has no Scene lowering`)
  const colors = request.output === 'png' && request.appearance.colors.embedFontImport !== false
    ? { ...request.appearance.colors, embedFontImport: false } : request.appearance.colors
  const assertions = sceneAssertionsEnabled(request)
  const lower = () => plan.family.lowerScene!({ positioned: layout.positioned, colors, resolved: resolvedFamilyRenderContextOf(request) })
  const scene = withTextMeasurementExecution(plan.textMeasurement, () => admitFamilyScene(plan.family,
    !assertions && !plan.family.id.startsWith('family:') ? withDeferredTerminalProjections(lower) : lower(), assertions))
  requests.set(request, { scene, crossChecks: assertions })
  return scene
}

/** Native crisp work has no Scene document/group tree. Strong evidence and
 * alternate backends deliberately retain the extension-facing Scene adapter. */
export function retainedNativeDrawing(request: ResolvedRenderRequest, layout: FamilyLayoutResult): NativeDrawing | undefined {
  const plan = resolvedRenderExecutionPlanOf(request)
  let bypass = sceneAssertionsEnabled(request) ? 'scene-assertions' : plan.family.id.startsWith('family:') ? 'external-family'
    : plan.backend && !isBuiltinDefaultBackend(plan.backend.backend) ? 'alternate-backend'
      : !(plan.mode === 'layout' ? request.appearance.inferredBackend === 'default' : plan.mode === 'scene' && plan.backend?.inputName === 'default') ? 'unsupported-mode' : undefined
  const producer = bypass ? undefined : nativeDrawingOf(plan.family.lowerScene)
  if (!producer) bypass ??= 'no-native-producer'
  if (bypass) {
    observeCache('native-drawing', 'bypass', bypass)
    observeFallback('native-drawing', bypass)
    return undefined
  }
  let requests = native.get(layout)
  if (!requests) { requests = new WeakMap(); native.set(layout, requests) }
  const prior = requests.get(request)
  if (prior) { observeCache('native-drawing', 'hit'); return prior.drawing }
  // Reading conformance proves the same default writer capability as render().
  if (plan.backend) assertBackendConformance(plan.backend.conformance, plan.backend.inputName)
  // Positioning's ownership proof must still hold after layout observers run.
  // A changed producer executes on its detached graph and cannot publish a
  // drawing under the original producer's private cache entry.
  const cached = cachedNativeDrawing(request, layout, producer === originalNativeDrawingOf(plan.family.lowerScene))
  if (cached) {
    observeCache('native-drawing', 'hit', undefined, 'positioned-owner')
    requests.set(request, { drawing: cached })
    return cached
  }
  observeCache('native-drawing', 'miss')
  const colors = request.output === 'png' && request.appearance.colors.embedFontImport !== false
    ? { ...request.appearance.colors, embedFontImport: false } : request.appearance.colors
  const drawing = withTextMeasurementExecution(plan.textMeasurement, () => drawNative(producer!,
    { positioned: positionedForNativeProducer(layout, producer!), colors, resolved: resolvedFamilyRenderContextOf(request) }, plan.family.id, request.appearance.styled ? request.appearance.style : undefined))
  requests.set(request, { drawing })
  retainNativeDrawing(request, layout, drawing, () => drawing.paint.primitives.map(primitive => [paintPrimitiveSource(primitive), scenePrimitiveMatrix(primitive)]))
  return drawing
}

export function positionedPaintCertification(request: ResolvedRenderRequest, layout: FamilyLayoutResult): PaintLayoutCertification {
  const drawing = retainedNativeDrawing(request, layout)
  if (drawing) {
    const entry = native.get(layout)!.get(request)!
    observeCache('paint-certification', entry.certification ? 'hit' : 'miss', undefined, 'native')
    return entry.certification ??= certifyNativePaint(drawing.header, drawing.paint, retainedFamilyProjection(layout), { outputSupported: !request.appearance.colors.shadow })
  }
  const scene = retainedPositionedScene(request, layout)
  const entry = retained.get(layout)!.get(request)!
  observeCache('paint-certification', entry.certification ? 'hit' : 'miss', undefined, 'scene')
  if (entry.certification) return entry.certification
  const plan = resolvedRenderExecutionPlanOf(request)
  const supported = !request.appearance.colors.shadow && (plan.mode === 'layout' ? request.appearance.inferredBackend === 'default' : plan.mode === 'scene' && plan.backend?.inputName === 'default')
  return entry.certification = certifyScenePaint(scene, retainedFamilyProjection(layout), { outputSupported: supported })
}
