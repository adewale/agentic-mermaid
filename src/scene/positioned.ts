import { assertBackendConformance } from './backend.ts'
import { nativeDrawingOf } from './drawing.ts'
import { drawNative, type NativeDrawing } from './native-drawing.ts'
import type { FamilyLayoutResult } from '../agent/families.ts'
import type { ResolvedRenderRequest } from '../render-contract.ts'
import { resolvedFamilyRenderContextOf, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { retainedFamilyProjection } from '../positioning.ts'
import { withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { admitFamilyScene } from './admission.ts'
import { sceneAssertionsEnabled } from './assertions.ts'
import { withDeferredTerminalProjections } from './deferred-terminal-projection.ts'
import type { SceneDoc } from './ir.ts'
import { certifyNativePaint, certifyScenePaint, type PaintLayoutCertification } from './paint-certification.ts'

interface PositionedScene { scene: SceneDoc; certification?: PaintLayoutCertification }
interface PositionedNative { drawing: NativeDrawing; certification?: PaintLayoutCertification }
const native = new WeakMap<FamilyLayoutResult, WeakMap<ResolvedRenderRequest, PositionedNative>>()
const retained = new WeakMap<FamilyLayoutResult, WeakMap<ResolvedRenderRequest, PositionedScene>>()

/** Lower once from the actual positioned artifact, shared by SVG, layout,
 * verification and receipt consumers. No source parse or layout is repeated. */
export function retainedPositionedScene(request: ResolvedRenderRequest, layout: FamilyLayoutResult): SceneDoc {
  let requests = retained.get(layout)
  if (!requests) { requests = new WeakMap(); retained.set(layout, requests) }
  const prior = requests.get(request)
  if (prior) return prior.scene
  const plan = resolvedRenderExecutionPlanOf(request)
  if (!plan.family.lowerScene) throw new Error(`Resolved ${request.output} family has no Scene lowering`)
  const colors = request.output === 'png' && request.appearance.colors.embedFontImport !== false
    ? { ...request.appearance.colors, embedFontImport: false } : request.appearance.colors
  const assertions = sceneAssertionsEnabled(request)
  const lower = () => plan.family.lowerScene!({ positioned: layout.positioned, colors, resolved: resolvedFamilyRenderContextOf(request) })
  const scene = withTextMeasurementExecution(plan.textMeasurement, () => admitFamilyScene(plan.family,
    !assertions && !plan.family.id.startsWith('family:') ? withDeferredTerminalProjections(lower) : lower(), assertions))
  requests.set(request, { scene })
  return scene
}

/** Native crisp work has no Scene document/group tree. Strong evidence and
 * alternate backends deliberately retain the extension-facing Scene adapter. */
export function retainedNativeDrawing(request: ResolvedRenderRequest, layout: FamilyLayoutResult): NativeDrawing | undefined {
  const plan = resolvedRenderExecutionPlanOf(request)
  if (sceneAssertionsEnabled(request) || request.appearance.styled || plan.family.id.startsWith('family:')
    || !(plan.mode === 'layout' ? request.appearance.inferredBackend === 'default' : plan.mode === 'scene' && plan.backend?.inputName === 'default')) return undefined
  const producer = nativeDrawingOf(plan.family.lowerScene)
  if (!producer) return undefined
  let requests = native.get(layout)
  if (!requests) { requests = new WeakMap(); native.set(layout, requests) }
  const prior = requests.get(request)
  if (prior) return prior.drawing
  // Reading conformance proves the same default writer capability as render().
  if (plan.backend) assertBackendConformance(plan.backend.conformance, plan.backend.inputName)
  const colors = request.output === 'png' && request.appearance.colors.embedFontImport !== false
    ? { ...request.appearance.colors, embedFontImport: false } : request.appearance.colors
  const drawing = withTextMeasurementExecution(plan.textMeasurement, () => drawNative(producer,
    { positioned: layout.positioned, colors, resolved: resolvedFamilyRenderContextOf(request) }, plan.family.id))
  requests.set(request, { drawing })
  return drawing
}

export function positionedPaintCertification(request: ResolvedRenderRequest, layout: FamilyLayoutResult): PaintLayoutCertification {
  const drawing = retainedNativeDrawing(request, layout)
  if (drawing) {
    const entry = native.get(layout)!.get(request)!
    return entry.certification ??= certifyNativePaint(drawing.header, drawing.paint, retainedFamilyProjection(layout), { outputSupported: !request.appearance.colors.shadow })
  }
  const scene = retainedPositionedScene(request, layout)
  const entry = retained.get(layout)!.get(request)!
  if (entry.certification) return entry.certification
  const plan = resolvedRenderExecutionPlanOf(request)
  const supported = !request.appearance.colors.shadow && (plan.mode === 'layout' ? request.appearance.inferredBackend === 'default' : plan.mode === 'scene' && plan.backend?.inputName === 'default')
  return entry.certification = certifyScenePaint(scene, retainedFamilyProjection(layout), { outputSupported: supported })
}
