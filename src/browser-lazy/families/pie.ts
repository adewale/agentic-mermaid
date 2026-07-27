import descriptorData from '../generated/descriptors/pie.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { resolvePieVisualConfig } from '../../pie/config.ts'
import { layoutPieChart } from '../../pie/layout.ts'
import { parsePieChart } from '../../pie/parser.ts'
import { lowerPieScene } from '../../pie/renderer.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    familyConfig: { visual: resolvePieVisualConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => layoutResult(layoutPieChart(
    parsePieChart(ctx.source.familyLines),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolvePieVisualConfig> } | undefined)?.visual
      ?? resolvePieVisualConfig(),
    ctx.styleFace,
  )),
  lowerScene: scene(lowerPieScene),
})
