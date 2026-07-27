import descriptorData from '../generated/descriptors/timeline.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { layoutTimelineDiagram } from '../../timeline/layout.ts'
import { parseTimelineDiagram } from '../../timeline/parser.ts'
import { lowerTimelineScene, resolveTimelineRequestAppearance } from '../../timeline/renderer.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    appearance: { family: { ...resolveTimelineRequestAppearance(ctx.renderOptions) } },
  }),
  layout: ctx => layoutResult(layoutTimelineDiagram(
    parseTimelineDiagram(ctx.source.familyLines, ctx.source.accessibility),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  lowerScene: scene(lowerTimelineScene),
})
