import { assertBackendConformance, isBuiltinDefaultBackend, isOriginalEnrolledDefaultBackend } from './backend.ts'
import { nativeDrawingOf, originalNativeDrawingOf, type DrawingProducer } from './drawing.ts'
import { drawNative, type NativeDrawing } from './native-drawing.ts'
import type { FamilyLayoutResult } from '../agent/families.ts'
import type { ResolvedRenderRequest } from '../render-contract.ts'
import { resolvedFamilyRenderContextOf, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionFamilyForNativeRender, positionedForNativeProducer, retainedFamilyProjection } from '../positioning.ts'
import { hasOriginalOwnedFamilyHooks } from '../experimental/owned-family.ts'
import { measureRenderStage } from '../render-stages.ts'
import { withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { admitFamilyScene } from './admission.ts'
import { sceneAssertionsEnabled } from './assertions.ts'
import { withDeferredTerminalProjections } from './deferred-terminal-projection.ts'
import type { SceneDoc } from './ir.ts'
import { certifyNativePaint, certifyScenePaint, type PaintLayoutCertification } from './paint-certification.ts'
import { observeCache, observeFallback } from '../performance-observations.ts'

interface PositionedScene { scene: SceneDoc; crossChecks: boolean; certification?: PaintLayoutCertification }
interface PositionedNative { drawing: NativeDrawing; certification?: PaintLayoutCertification }
const native = new WeakMap<FamilyLayoutResult, WeakMap<ResolvedRenderRequest, PositionedNative>>()
const retained = new WeakMap<FamilyLayoutResult, WeakMap<ResolvedRenderRequest, PositionedScene>>()

interface PrivateSequenceOperation {
  readonly request: ResolvedRenderRequest
  readonly layout: FamilyLayoutResult
  readonly producer: DrawingProducer
}
const sequenceOperations = new WeakMap<ResolvedRenderRequest, PrivateSequenceOperation>()
const sequenceContexts = new WeakMap<object, PrivateSequenceOperation>()

function originalSequenceProducer(request: ResolvedRenderRequest): DrawingProducer | undefined {
  const plan = resolvedRenderExecutionPlanOf(request)
  if (!hasOriginalOwnedFamilyHooks(plan.family, 'sequence') || request.output !== 'svg'
    || plan.mode !== 'scene' || !plan.executionDecision || plan.textMeasurement
    || request.appearance.styled || request.appearance.face
    || plan.backend?.inputName !== 'default' || !isOriginalEnrolledDefaultBackend(plan.backend.backend)) return undefined
  const lower = plan.family.lowerScene
  const producer = nativeDrawingOf(lower)
  return producer && producer === originalNativeDrawingOf(lower) ? producer : undefined
}

/** Only the closed positioning/consumption entry below can establish this
 * association. Public positioned values and factories have no grant surface. */
export function isPrivateSequenceNativeOperation(context: object, producer: object): boolean {
  const operation = sequenceContexts.get(context)
  return !!operation && operation.producer === producer
    && sequenceOperations.get(operation.request) === operation
    && !sceneAssertionsEnabled(operation.request)
    && originalSequenceProducer(operation.request) === producer
}

export interface PreparedNativePositionedRender {
  readonly layout: FamilyLayoutResult
  /** Presence means the original drawing stage already ran, even on bypass. */
  readonly native?: { readonly drawing: NativeDrawing | undefined }
}

/** Position and consume before any positioned value leaves this operation.
 * There is deliberately no caller-supplied continuation or persistent brand.
 * Layout and drawing observations retain their original sibling boundaries. */
export function prepareNativePositionedForRender(request: ResolvedRenderRequest): PreparedNativePositionedRender {
  const layout = measureRenderStage('layout', () => positionFamilyForNativeRender(request))
  const producer = originalSequenceProducer(request)
  if (!producer) return { layout }
  const operation: PrivateSequenceOperation = { request, layout, producer }
  const previous = sequenceOperations.get(request)
  sequenceOperations.set(request, operation)
  try {
    return { layout, native: { drawing: measureRenderStage('drawing', () => retainedNativeDrawing(request, layout)) } }
  } finally {
    if (previous) sequenceOperations.set(request, previous)
    else sequenceOperations.delete(request)
  }
}

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
  observeCache('native-drawing', 'miss')
  // Reading conformance proves the same default writer capability as render().
  if (plan.backend) assertBackendConformance(plan.backend.conformance, plan.backend.inputName)
  const colors = request.output === 'png' && request.appearance.colors.embedFontImport !== false
    ? { ...request.appearance.colors, embedFontImport: false } : request.appearance.colors
  const context = { positioned: positionedForNativeProducer(layout, producer!), colors, resolved: resolvedFamilyRenderContextOf(request) }
  const operation = sequenceOperations.get(request)
  if (operation?.layout === layout && operation.producer === producer) sequenceContexts.set(context, operation)
  let drawing: NativeDrawing
  try {
    drawing = withTextMeasurementExecution(plan.textMeasurement, () => drawNative(producer!,
      context, plan.family.id, request.appearance.styled ? request.appearance.style : undefined))
  } finally {
    sequenceContexts.delete(context)
  }
  requests.set(request, { drawing })
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
