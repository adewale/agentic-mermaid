import type { FamilyLayoutResult } from '../agent/families.ts'
import type { ResolvedRenderRequest } from '../render-contract.ts'
import { resolvedFamilyRenderContextOf, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { retainedFamilyProjection } from '../positioning.ts'
import { withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { admitFamilyScene } from './admission.ts'
import { sceneAssertionsEnabled } from './assertions.ts'
import { withDeferredTerminalProjections } from './deferred-terminal-projection.ts'
import type { SceneDoc } from './ir.ts'
import { certifyScenePaint, type PaintLayoutCertification } from './paint-certification.ts'

interface PositionedScene { scene: SceneDoc; certification?: PaintLayoutCertification }
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

export function positionedPaintCertification(request: ResolvedRenderRequest, layout: FamilyLayoutResult): PaintLayoutCertification {
  const scene = retainedPositionedScene(request, layout)
  const entry = retained.get(layout)!.get(request)!
  if (entry.certification) return entry.certification
  const plan = resolvedRenderExecutionPlanOf(request)
  const supported = !request.appearance.colors.shadow && (plan.mode === 'layout' ? request.appearance.inferredBackend === 'default' : plan.mode === 'scene' && plan.backend?.inputName === 'default')
  return entry.certification = certifyScenePaint(scene, retainedFamilyProjection(layout), { outputSupported: supported })
}
