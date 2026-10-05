import { withFrontmatterTitle } from '../mermaid-source.ts'
import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { layoutTimelineDiagram } from '../timeline/layout.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { lowerTimelineScene, resolveTimelineRequestAppearance } from '../timeline/renderer.ts'

/** The timeline SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const TIMELINE_SVG_HOOKS = {
  normalizeRequest: ctx => ({
    appearance: { family: { ...resolveTimelineRequestAppearance(ctx.renderOptions) } },
  }),
  layout: ctx => layoutResult(layoutTimelineDiagram(
    withFrontmatterTitle(parseTimelineDiagram(ctx.source.familyLines, ctx.source.accessibility), ctx.source.frontmatter),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  lowerScene: scene(lowerTimelineScene),
} satisfies BrowserSvgFamilyHooks
