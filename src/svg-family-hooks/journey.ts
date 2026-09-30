import { withFrontmatterTitle } from '../mermaid-source.ts'
import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { lowerJourneyScene } from '../journey/renderer.ts'

/** The journey SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const JOURNEY_SVG_HOOKS = {
  normalizeRequest: ctx => ({
    appearance: { family: resolveJourneyRequestAppearance(ctx.renderOptions) as unknown as Record<string, unknown> },
  }),
  layout: ctx => layoutResult(layoutJourneyDiagram(
    withFrontmatterTitle(parseJourneyDiagram(ctx.source.familyLines, ctx.source.accessibility), ctx.source.frontmatter),
    (ctx.familyAppearance as ReturnType<typeof resolveJourneyRequestAppearance> | undefined)
      ?? resolveJourneyRequestAppearance(ctx.renderOptions),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  lowerScene: scene(lowerJourneyScene),
} satisfies BrowserSvgFamilyHooks
