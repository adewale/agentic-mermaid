import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { resolveSankeyVisualConfig } from '../sankey/config.ts'
import { layoutSankeyDiagram } from '../sankey/layout.ts'
import { parseSankeyDiagram } from '../sankey/parser.ts'
import { lowerSankeyScene } from '../sankey/renderer.ts'

/** The sankey SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const SANKEY_SVG_HOOKS = {
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
} satisfies BrowserSvgFamilyHooks
