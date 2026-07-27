import descriptorData from '../generated/descriptors/quadrant.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { resolveQuadrantVisualConfig } from '../../quadrant/config.ts'
import { layoutQuadrantChart } from '../../quadrant/layout.ts'
import { parseQuadrantChart } from '../../quadrant/parser.ts'
import { lowerQuadrantScene } from '../../quadrant/renderer.ts'
import { withAccessibilityObject } from '../../shared/accessibility-directives.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    familyConfig: { visual: resolveQuadrantVisualConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => layoutResult(layoutQuadrantChart(
    withAccessibilityObject(parseQuadrantChart(ctx.source.familyLines), ctx.source.accessibility),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolveQuadrantVisualConfig> } | undefined)?.visual
      ?? resolveQuadrantVisualConfig(),
    ctx.styleFace,
  )),
  lowerScene: scene(lowerQuadrantScene),
})
