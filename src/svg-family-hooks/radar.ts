import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { resolveRadarVisualConfig } from '../radar/config.ts'
import { layoutRadarChart } from '../radar/layout.ts'
import { parseRadarChart } from '../radar/parser.ts'
import { lowerRadarScene } from '../radar/renderer.ts'

/** The radar SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const RADAR_SVG_HOOKS = {
  normalizeRequest: ctx => ({
    familyConfig: { visual: resolveRadarVisualConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => layoutResult(layoutRadarChart(
    parseRadarChart(ctx.source.lines, {
      title: typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined,
    }),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolveRadarVisualConfig> } | undefined)?.visual
      ?? resolveRadarVisualConfig(ctx.source.frontmatter),
    ctx.styleFace,
  ), { injectAccessibility: false }),
  lowerScene: scene(lowerRadarScene),
} satisfies BrowserSvgFamilyHooks
