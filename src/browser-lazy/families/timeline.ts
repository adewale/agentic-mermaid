import descriptorData from '../generated/descriptors/timeline.ts'
import { withFrontmatterTitle } from '../../mermaid-source.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { layoutTimelineDiagram } from '../../timeline/layout.ts'
import { parseTimelineDiagram } from '../../timeline/parser.ts'
import { lowerTimelineScene, resolveTimelineRequestAppearance } from '../../timeline/renderer.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    appearance: { family: { ...resolveTimelineRequestAppearance(ctx.renderOptions) } },
  }),
  layout: ctx => layoutResult(layoutTimelineDiagram(
    withFrontmatterTitle(parseTimelineDiagram(ctx.source.familyLines, ctx.source.accessibility), ctx.source.frontmatter),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  lowerScene: scene(lowerTimelineScene),
})
