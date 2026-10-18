import { projectPiePositioned } from '../positioned-views/pie.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { resolvePieVisualConfig } from '../pie/config.ts'
import { layoutPieChart } from '../pie/layout.ts'
import { parsePieChart } from '../pie/parser.ts'
import { lowerPieScene } from '../pie/renderer.ts'

/** The pie SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const PIE_SVG_HOOKS = {
  normalizeRequest: ctx => ({
    familyConfig: { visual: resolvePieVisualConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => layoutResult(layoutPieChart(
    withFrontmatterTitle(parsePieChart(ctx.source.authoredPieFamilyLines ?? ctx.source.familyLines), ctx.source.frontmatter),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolvePieVisualConfig> } | undefined)?.visual
      ?? resolvePieVisualConfig(),
    ctx.styleFace,
  )),
  projectPositioned: positionedView(projectPiePositioned),
  lowerScene: scene(lowerPieScene),
} satisfies BrowserSvgFamilyHooks
