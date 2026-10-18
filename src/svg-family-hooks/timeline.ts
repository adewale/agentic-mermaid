import { diagnoseTimelineConfig } from '../timeline/config-diagnostics.ts'
import { projectTimelinePositioned } from '../positioned-views/timeline.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { layoutTimelineDiagram } from '../timeline/layout.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { lowerTimelineScene, resolveTimelineRequestAppearance } from '../timeline/renderer.ts'

/** The timeline SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const TIMELINE_SVG_HOOKS = {
  configDiagnostics: diagnoseTimelineConfig,
  normalizeRequest: ctx => ({
    appearance: { family: { ...resolveTimelineRequestAppearance(ctx.renderOptions) } },
  }),
  layout: ctx => layoutResult(layoutTimelineDiagram(
    withFrontmatterTitle(parseTimelineDiagram(ctx.source.familyLines, ctx.source.accessibility), ctx.source.frontmatter),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  projectPositioned: positionedView(projectTimelinePositioned),
  lowerScene: scene(lowerTimelineScene),
} satisfies BrowserSvgFamilyHooks
