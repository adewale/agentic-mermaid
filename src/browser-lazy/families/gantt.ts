import descriptorData from '../generated/descriptors/gantt.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { buildGanttRenderPipelineFromConfig } from '../../gantt/pipeline.ts'
import { resolveGanttFrontmatterConfig } from '../../gantt/parser.ts'
import { lowerGanttScene } from '../../gantt/renderer.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    familyConfig: { config: resolveGanttFrontmatterConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => {
    const config = (ctx.familyConfig as {
      config: ReturnType<typeof resolveGanttFrontmatterConfig>
    } | undefined)?.config ?? resolveGanttFrontmatterConfig(undefined)
    const pipeline = buildGanttRenderPipelineFromConfig(ctx.source.familyLines, config, {
      clock: { today: ctx.renderOptions.ganttToday },
      layout: {
        renderOptions: ctx.renderOptions,
        ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}),
      },
    })
    return layoutResult(pipeline.positioned)
  },
  lowerScene: scene(lowerGanttScene),
})
