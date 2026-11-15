import { diagnoseJourneyConfig } from '../journey/config-diagnostics.ts'
import { projectJourneyPositioned } from '../positioned-views/journey.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { lowerJourneyScene } from '../journey/renderer.ts'

/** The journey SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const JOURNEY_SVG_HOOKS = {
  configDiagnostics: diagnoseJourneyConfig,
  normalizeRequest: ctx => ({
    appearance: { family: resolveJourneyRequestAppearance(ctx.renderOptions) as unknown as Record<string, unknown> },
  }),
  layout: ctx => layoutResult(layoutJourneyDiagram(
    withFrontmatterTitle(parseJourneyDiagram(ctx.source.authoredFamilyLines ?? ctx.source.familyLines, ctx.source.accessibility), ctx.source.frontmatter),
    (ctx.familyAppearance as ReturnType<typeof resolveJourneyRequestAppearance> | undefined)
      ?? resolveJourneyRequestAppearance(ctx.renderOptions),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  projectPositioned: positionedView(projectJourneyPositioned),
  lowerScene: scene(lowerJourneyScene),
} satisfies BrowserSvgFamilyHooks
