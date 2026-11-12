// Source request normalization shared by graphical and terminal family hooks.
// Output adapters own layout; these projections only resolve authored options.
import type { FamilyDescriptor } from './agent/family-registry.ts'
import { resolveFlowchartRenderOptions } from './flowchart-config.ts'
import { resolveArchitectureVisualConfig } from './architecture/config.ts'
import { parseC4Diagram } from './c4/parser.ts'
import { frontmatterTitle } from './mermaid-source.ts'
import { resolveClassRenderOptions } from './class/layout.ts'
import { resolveErRenderOptions } from './er/layout.ts'
import { resolveGanttFrontmatterConfig } from './gantt/parser.ts'
import { resolveGitGraphPositionConfig } from './gitgraph/position.ts'
import { resolveGitGraphThemeProjection } from './gitgraph/renderer.ts'
import { resolveJourneyRequestAppearance } from './journey/layout.ts'
import { resolveKanbanConfig } from './kanban/config.ts'
import { resolveMindmapPositionConfig } from './mindmap/position.ts'
import { resolvePacketConfig } from './packet/config.ts'
import { resolvePieVisualConfig } from './pie/config.ts'
import { resolveQuadrantVisualConfig } from './quadrant/config.ts'
import { resolveRadarVisualConfig } from './radar/config.ts'
import { resolveSankeyVisualConfig } from './sankey/config.ts'
import { resolveSequenceConfig } from './sequence/config.ts'
import { resolveStateRenderOptions } from './state/config.ts'
import { resolveTimelineRequestAppearance } from './timeline/renderer.ts'
import { resolveTreemapConfig } from './treemap/layout.ts'
import { resolveXYChartConfig, resolveXYChartTheme } from './xychart/parser.ts'

export const AGENTFLOW_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({ renderOptions: resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.renderOptions) })

export const ARCHITECTURE_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => {
  const resolved = resolveArchitectureVisualConfig(ctx.source.frontmatter, ctx.colors, ctx.renderOptions, ctx.styleFace)
  const renderOptions = {
    ...ctx.renderOptions,
    padding: ctx.renderOptions.padding ?? resolved.padding,
    nodeSpacing: ctx.renderOptions.nodeSpacing ?? resolved.nodeSpacing,
    layerSpacing: ctx.renderOptions.layerSpacing ?? resolved.layerSpacing,
  }
  return {
    renderOptions,
    familyConfig: { layout: resolved.layout },
    appearance: { family: { visual: resolved.visual } },
  }
}

export const C4_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => {
  const wrapperLength = ctx.source.authoredWrapperLength ?? ctx.source.wrapperSource?.length ?? 0
  const wrapper = ctx.source.originalText.slice(0, wrapperLength)
  const body = parseC4Diagram(ctx.source.originalText.slice(wrapperLength))
  const lineOffset = wrapper.split(/\r\n?|\n/).length - 1
  for (const statement of body.statements) {
    statement.span.start += wrapper.length
    statement.span.end += wrapper.length
    statement.span.line += lineOffset
  }
  const title = frontmatterTitle(ctx.source.frontmatter)
  if (body.title === undefined && title !== undefined) body.title = title
  if (ctx.source.accessibility.title !== undefined) body.accessibilityTitle = ctx.source.accessibility.title
  if (ctx.source.accessibility.descr !== undefined) body.accessibilityDescription = ctx.source.accessibility.descr
  return {
    familyConfig: {
      model: body,
      c4: ctx.source.config.c4 ?? {},
      themeVariables: ctx.source.config.themeVariables ?? {},
    },
  }
}

export const CLASS_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  renderOptions: resolveClassRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
})

export const ER_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  renderOptions: resolveErRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
})

export const EVENTMODELING_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => {
  const config = ctx.source.config.eventmodeling as Record<string, unknown> | undefined
  const padding = config?.padding
  const rowHeight = config?.rowHeight
  return {
    renderOptions: { ...ctx.renderOptions, ...(ctx.renderOptions.padding === undefined && typeof padding === 'number' && Number.isFinite(padding) && padding >= 0 ? { padding } : {}) },
    familyConfig: { rowHeight: typeof rowHeight === 'number' && Number.isFinite(rowHeight) && rowHeight >= 0 ? rowHeight : 0 },
    appearance: { family: { palette: ctx.colors } },
  }
}

export const FLOWCHART_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  renderOptions: resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
})

export const GANTT_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  familyConfig: { config: resolveGanttFrontmatterConfig(ctx.source.frontmatter) },
})

export const GITGRAPH_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  familyConfig: {
    position: resolveGitGraphPositionConfig(ctx.source.config.gitGraph, ctx.source.config.themeVariables),
    ...(typeof ctx.source.frontmatter.title === 'string' ? { title: ctx.source.frontmatter.title } : {}),
  },
  appearance: {
    family: {
      themeVariables: resolveGitGraphThemeProjection(ctx.source.config.themeVariables),
    },
  },
})

export const JOURNEY_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  appearance: { family: resolveJourneyRequestAppearance(ctx.renderOptions) as unknown as Record<string, unknown> },
})

export const KANBAN_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({ familyConfig: { visual: resolveKanbanConfig(ctx.source.frontmatter) } })

export const MINDMAP_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  familyConfig: {
    position: resolveMindmapPositionConfig(ctx.source.config.mindmap, ctx.source.config.layout),
  },
})

export const PACKET_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({ familyConfig: { visual: resolvePacketConfig(ctx.source.frontmatter) } })

export const PIE_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  familyConfig: { visual: resolvePieVisualConfig(ctx.source.frontmatter) },
})

export const QUADRANT_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  familyConfig: { visual: resolveQuadrantVisualConfig(ctx.source.frontmatter) },
})

export const RADAR_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  familyConfig: { visual: resolveRadarVisualConfig(ctx.source.frontmatter) },
})

export const SANKEY_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  familyConfig: { visual: resolveSankeyVisualConfig(ctx.source.frontmatter) },
})

export const SEQUENCE_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  familyConfig: { sequence: resolveSequenceConfig(ctx.source.frontmatter) },
})

export const STATE_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => {
  const resolved = resolveStateRenderOptions(ctx.source.frontmatter, ctx.renderOptions)
  const { stateVisual, ...renderOptions } = resolved
  return {
    renderOptions,
    ...(stateVisual ? { appearance: { family: { visual: stateVisual } } } : {}),
  }
}

export const SWIMLANE_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({ renderOptions: resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.renderOptions) })

export const TIMELINE_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({
  appearance: { family: { ...resolveTimelineRequestAppearance(ctx.renderOptions) } },
})

export const TREEMAP_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => ({ familyConfig: { treemap: resolveTreemapConfig(ctx.source.config.treemap as Record<string, unknown> | undefined) } })

export const XYCHART_NORMALIZE_REQUEST: NonNullable<FamilyDescriptor['normalizeRequest']> = ctx => {
  const config = resolveXYChartConfig(ctx.source.frontmatter)
  const theme = resolveXYChartTheme(ctx.source.frontmatter)
  return {
    familyConfig: { config },
    appearance: {
      ...(ctx.renderOptions.bg === undefined && theme.backgroundColor ? { colors: { bg: theme.backgroundColor } } : {}),
      family: { theme },
    },
  }
}
