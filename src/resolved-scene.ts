import type { ParsedDiagram } from './agent/types.ts'
import type { RenderOptions } from './types.ts'
import { prepareRenderInput } from './agent/render-input.ts'
import { resolveRenderRequestForExecution, resolvedRenderExecutionPlanOf } from './render-contract.ts'
import { positionFamilyForNativeRender } from './positioning.ts'
import { renderPositionedMermaidSVG } from './graphical-render.ts'
import { emitResolvedConfigDiagnostics } from './render-config-diagnostics.ts'
import { withSvgInspectionCache } from './svg-inspection-cache.ts'
import { createScenePartCapture } from './scene/part-capture.ts'
import { resolveSvgScene } from './scene/resolve-svg.ts'
import type { ResolvedScene } from './scene/resolved-types.ts'
import { scanSvgStartTags } from './svg-structure.ts'

/**
 * Render a diagram as final backend-painted paths and text, in root user
 * space, with no DOM, network, asynchronous work or remaining CSS dependency.
 * Unsupported artwork fails with its owning part id instead of being omitted.
 */
export function renderResolvedScene(text: ParsedDiagram | string, options: RenderOptions = {}): ResolvedScene {
  return withSvgInspectionCache(() => {
    const input = prepareRenderInput(text)
    const request = resolveRenderRequestForExecution(input.source, options, 'svg', undefined, { expectedFamilyId: input.expectedFamilyId })
    const plan = resolvedRenderExecutionPlanOf(request)
    if (plan.mode !== 'scene') throw new Error('Resolved Scene requires a family with Scene lowering')
    emitResolvedConfigDiagnostics(request)
    const layout = positionFamilyForNativeRender(request)
    const capture = createScenePartCapture()
    const { svg, layoutCertification } = renderPositionedMermaidSVG(request, layout, [], capture)
    if (!capture.scene || !capture.owners) throw new Error('Backend did not provide resolved Scene ownership')
    if (scanSvgStartTags(svg).length !== capture.owners.length) throw new Error('Resolved Scene ownership changed during SVG postprocessing')
    // Certification may expand the final SVG viewport around painted strokes.
    // Keep the reported canvas tied to that projection, not its pre-repair Scene.
    const viewport = plan.backend?.inputName === 'default' && layoutCertification?.repairs.length
      ? layoutCertification.viewport : undefined
    const scene = {
      ...capture.scene,
      family: plan.family.id,
      ...(viewport ? { width: viewport.width, height: viewport.height } : {}),
    }
    return resolveSvgScene(svg, scene, capture.owners)
  })
}
