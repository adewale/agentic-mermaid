import { withFrontmatterTitle } from '../mermaid-source.ts'
import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { resolveQuadrantVisualConfig } from '../quadrant/config.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { lowerQuadrantScene } from '../quadrant/renderer.ts'
import { withAccessibilityObject } from '../shared/accessibility-directives.ts'

/** The quadrant SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const QUADRANT_SVG_HOOKS = {
  normalizeRequest: ctx => ({
    familyConfig: { visual: resolveQuadrantVisualConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => layoutResult(layoutQuadrantChart(
    withFrontmatterTitle(withAccessibilityObject(parseQuadrantChart(ctx.source.familyLines), ctx.source.accessibility), ctx.source.frontmatter),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolveQuadrantVisualConfig> } | undefined)?.visual
      ?? resolveQuadrantVisualConfig(),
    ctx.styleFace,
  )),
  lowerScene: scene(lowerQuadrantScene),
} satisfies BrowserSvgFamilyHooks
