import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { applyGanttFrontmatterConfig, parseGanttModel } from './parser.ts'
import { resolveGanttSchedule } from './schedule.ts'
import { layoutGantt, type GanttLayoutOptions } from './layout.ts'
import type { GanttClock, GanttLayoutResult, GanttModel, GanttSchedule } from './types.ts'

export interface GanttRenderPipelineOptions {
  clock?: GanttClock
  layout?: Omit<GanttLayoutOptions, 'today'>
}

export interface GanttRenderPipeline {
  model: GanttModel
  schedule: GanttSchedule
  positioned: GanttLayoutResult
}

export function buildGanttRenderPipeline(
  lines: string[],
  frontmatter: MermaidFrontmatterMap | undefined,
  options: GanttRenderPipelineOptions = {},
): GanttRenderPipeline {
  const model = applyGanttFrontmatterConfig(parseGanttModel(lines), frontmatter)
  const schedule = resolveGanttSchedule(model, options.clock)
  const positioned = layoutGantt(model, schedule, { ...options.layout, today: schedule.today })
  return { model, schedule, positioned }
}
