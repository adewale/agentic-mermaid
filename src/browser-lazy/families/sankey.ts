import descriptorData from '../generated/descriptors/sankey.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { resolveSankeyVisualConfig } from '../../sankey/config.ts'
import { layoutSankeyDiagram } from '../../sankey/layout.ts'
import { parseSankeyDiagram } from '../../sankey/parser.ts'
import { lowerSankeyScene } from '../../sankey/renderer.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    familyConfig: { visual: resolveSankeyVisualConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => layoutResult(layoutSankeyDiagram(
    parseSankeyDiagram(ctx.source.familyLines, {
      title: typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined,
    }),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolveSankeyVisualConfig> } | undefined)?.visual
      ?? resolveSankeyVisualConfig(ctx.source.frontmatter),
    ctx.styleFace,
  )),
  lowerScene: scene(lowerSankeyScene),
})
