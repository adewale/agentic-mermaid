import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { buildGanttRenderPipelineFromConfig } from '../gantt/pipeline.ts'
import { resolveGanttFrontmatterConfig } from '../gantt/parser.ts'
import { lowerGanttScene } from '../gantt/renderer.ts'

/** The gantt SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const GANTT_SVG_HOOKS = {
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
} satisfies BrowserSvgFamilyHooks
