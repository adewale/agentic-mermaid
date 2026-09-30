import type { AsciiContext, FamilyDescriptor, FamilyPositionedProjectionContext, FamilyPositionedView } from './agent/families.ts'
import {
  projectArchitecturePositioned,
  projectClassPositioned,
  projectErPositioned,
  projectGanttPositioned,
  projectGitGraphPositioned,
  projectGraphPositioned,
  projectJourneyPositioned,
  projectMindmapPositioned,
  projectPiePositioned,
  projectQuadrantPositioned,
  projectRadarPositioned,
  projectSankeyPositioned,
  projectSequencePositioned,
  projectTimelinePositioned,
  projectXyChartPositioned,
} from './agent/family-layouts.ts'
import type { DiagramKind } from './agent/types.ts'
import { renderArchitectureAscii } from './ascii/architecture.ts'
import { canvasToString, flipCanvasVertically, flipRoleCanvasVertically } from './ascii/canvas.ts'
import { renderClassAscii } from './ascii/class-diagram.ts'
import { convertToAsciiGraph } from './ascii/converter.ts'
import { drawGraph } from './ascii/draw.ts'
import { renderErAscii } from './ascii/er-diagram.ts'
import { renderGanttAscii } from './ascii/gantt.ts'
import { renderGitGraphAscii } from './ascii/gitgraph.ts'
import { createMapping } from './ascii/grid.ts'
import { renderJourneyAscii } from './ascii/journey.ts'
import { renderMindmapAscii } from './ascii/mindmap.ts'
import { renderPieAscii } from './ascii/pie.ts'
import { renderQuadrantAscii } from './ascii/quadrant.ts'
import { renderRadarAscii } from './ascii/radar.ts'
import { renderSankeyAscii } from './ascii/sankey.ts'
import { renderSequenceAscii } from './ascii/sequence.ts'
import { renderStateAscii } from './ascii/state.ts'
import { renderTimelineAscii } from './ascii/timeline.ts'
import { renderXYChartAscii } from './ascii/xychart.ts'
import { normalizeMermaidSource, withFrontmatterTitle } from './mermaid-source.ts'
import { resolveGanttFrontmatterConfig } from './gantt/parser.ts'
import { parseGitGraph } from './gitgraph/parser.ts'
import { resolveGitGraphPositionConfig } from './gitgraph/position.ts'
import { parseMindmap } from './mindmap/parser.ts'
import { parseMermaid } from './parser.ts'
import { resolvePieVisualConfig } from './pie/config.ts'
import { resolveSankeyVisualConfig } from './sankey/config.ts'
import { resolveSequenceConfig } from './sequence/config.ts'
import { withAccessibilityFields } from './shared/accessibility-directives.ts'
import { checkAllGraphAuthoredStyles } from './shared/style-props.ts'
import type { PositionedDiagram } from './types.ts'
import { resolveXYChartConfig, resolveXYChartTheme } from './xychart/parser.ts'
import { layoutResult, scene } from './browser-lazy/family.ts'
import { ARCHITECTURE_SVG_HOOKS } from './svg-family-hooks/architecture.ts'
import { CLASS_SVG_HOOKS } from './svg-family-hooks/class.ts'
import { ER_SVG_HOOKS } from './svg-family-hooks/er.ts'
import { FLOWCHART_SVG_HOOKS } from './svg-family-hooks/flowchart.ts'
import { GANTT_SVG_HOOKS } from './svg-family-hooks/gantt.ts'
import { GITGRAPH_SVG_HOOKS } from './svg-family-hooks/gitgraph.ts'
import { JOURNEY_SVG_HOOKS } from './svg-family-hooks/journey.ts'
import { MINDMAP_SVG_HOOKS } from './svg-family-hooks/mindmap.ts'
import { PIE_SVG_HOOKS } from './svg-family-hooks/pie.ts'
import { QUADRANT_SVG_HOOKS } from './svg-family-hooks/quadrant.ts'
import { RADAR_SVG_HOOKS } from './svg-family-hooks/radar.ts'
import { SANKEY_SVG_HOOKS } from './svg-family-hooks/sankey.ts'
import { SEQUENCE_SVG_HOOKS } from './svg-family-hooks/sequence.ts'
import { STATE_SVG_HOOKS } from './svg-family-hooks/state.ts'
import { TIMELINE_SVG_HOOKS } from './svg-family-hooks/timeline.ts'
import { XYCHART_SVG_HOOKS } from './svg-family-hooks/xychart.ts'

type PositionedProjector<TPositioned extends PositionedDiagram> = (ctx: FamilyPositionedProjectionContext<TPositioned>) => FamilyPositionedView

function positionedView<TPositioned extends PositionedDiagram>(projector: PositionedProjector<TPositioned>): FamilyDescriptor['projectPositioned'] {
  return ctx => projector(ctx as FamilyPositionedProjectionContext<TPositioned>)
}

type BuiltinRenderHooks = Pick<FamilyDescriptor, 'normalizeRequest' | 'layout' | 'projectPositioned' | 'renderAscii' | 'lowerScene'>



function renderFlowchartAscii(ctx: AsciiContext): string {
  const parsed = parseMermaid(ctx.source.familyText)
  checkAllGraphAuthoredStyles(parsed)
  const config = { ...ctx.config }

  if (parsed.direction === 'LR' || parsed.direction === 'RL') {
    config.graphDirection = 'LR'
    config.reverseDirection = parsed.direction === 'RL'
  } else {
    config.graphDirection = 'TD'
  }

  const graph = convertToAsciiGraph(parsed, config)
  createMapping(graph)
  drawGraph(graph)

  if (parsed.direction === 'BT') {
    flipCanvasVertically(graph.canvas)
    flipRoleCanvasVertically(graph.roleCanvas)
  }

  return canvasToString(graph.canvas, {
    roleCanvas: graph.roleCanvas,
    colorMode: ctx.colorMode,
    theme: ctx.theme,
  })
}

function renderStateAsciiWithContext(ctx: AsciiContext): string {
  const parsed = parseMermaid(ctx.source.familyText)
  checkAllGraphAuthoredStyles(parsed)
  const config = { ...ctx.config }
  config.graphDirection = parsed.direction === 'LR' || parsed.direction === 'RL' ? 'LR' : 'TD'
  config.reverseDirection = parsed.direction === 'RL'
  return renderStateAscii(parsed, config, ctx.colorMode, ctx.theme, ctx.options.targetWidth)
}


function renderArchitectureAsciiWithContext(ctx: AsciiContext): string {
  // The shared appearance resolver has already applied the documented
  // precedence (explicit RenderOptions > source config > defaults) and the
  // terminal projector has sanitized it. Re-reading raw themeVariables here
  // created a second, unsafe color authority unique to Architecture.
  return renderArchitectureAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options)
}

const FLOWCHART_RENDER_HOOKS = {
  ...FLOWCHART_SVG_HOOKS,
  projectPositioned: positionedView(projectGraphPositioned),
  renderAscii: renderFlowchartAscii,
} satisfies BuiltinRenderHooks

const STATE_RENDER_HOOKS = {
  ...STATE_SVG_HOOKS,
  projectPositioned: positionedView(projectGraphPositioned),
  renderAscii: renderStateAsciiWithContext,
} satisfies BuiltinRenderHooks

const ARCHITECTURE_RENDER_HOOKS = {
  ...ARCHITECTURE_SVG_HOOKS,
  projectPositioned: positionedView(projectArchitecturePositioned),
  renderAscii: renderArchitectureAsciiWithContext,
} satisfies BuiltinRenderHooks

const SEQUENCE_RENDER_HOOKS = {
  ...SEQUENCE_SVG_HOOKS,
  projectPositioned: positionedView(projectSequencePositioned),
  renderAscii: ctx => renderSequenceAscii(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, (ctx.familyConfig as { sequence?: ReturnType<typeof resolveSequenceConfig> } | undefined)?.sequence ?? {}, ctx.options.targetWidth),
} satisfies BuiltinRenderHooks

const CLASS_RENDER_HOOKS = {
  ...CLASS_SVG_HOOKS,
  projectPositioned: positionedView(projectClassPositioned),
  renderAscii: ctx => renderClassAscii(
    ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth,
    normalizeMermaidSource(ctx.source.originalText).familyText,
  ),
} satisfies BuiltinRenderHooks

const ER_RENDER_HOOKS = {
  ...ER_SVG_HOOKS,
  projectPositioned: positionedView(projectErPositioned),
  renderAscii: ctx => renderErAscii(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth),
} satisfies BuiltinRenderHooks

const TIMELINE_RENDER_HOOKS = {
  ...TIMELINE_SVG_HOOKS,
  projectPositioned: positionedView(projectTimelinePositioned),
  renderAscii: ctx => renderTimelineAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth),
} satisfies BuiltinRenderHooks

const JOURNEY_RENDER_HOOKS = {
  ...JOURNEY_SVG_HOOKS,
  projectPositioned: positionedView(projectJourneyPositioned),
  renderAscii: ctx => renderJourneyAscii(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth, ctx.styleFace),
} satisfies BuiltinRenderHooks

const XYCHART_RENDER_HOOKS = {
  ...XYCHART_SVG_HOOKS,
  projectPositioned: positionedView(projectXyChartPositioned),
  renderAscii: ctx => {
    const config = (ctx.familyConfig as { config?: ReturnType<typeof resolveXYChartConfig> } | undefined)?.config
    const theme = (ctx.familyAppearance as { theme?: ReturnType<typeof resolveXYChartTheme> } | undefined)?.theme
    return renderXYChartAscii(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, {}, ctx.options.targetWidth, config && theme ? { config, theme } : undefined)
  },
} satisfies BuiltinRenderHooks

const PIE_RENDER_HOOKS = {
  ...PIE_SVG_HOOKS,
  projectPositioned: positionedView(projectPiePositioned),
  renderAscii: ctx => renderPieAscii(ctx.source.authoredPieFamilyLines ?? ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, {}, ctx.options.targetWidth, (ctx.familyConfig as { visual?: ReturnType<typeof resolvePieVisualConfig> } | undefined)?.visual, ctx.styleFace),
} satisfies BuiltinRenderHooks

const QUADRANT_RENDER_HOOKS = {
  ...QUADRANT_SVG_HOOKS,
  projectPositioned: positionedView(projectQuadrantPositioned),
  renderAscii: ctx => renderQuadrantAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth),
} satisfies BuiltinRenderHooks

const RADAR_RENDER_HOOKS = {
  ...RADAR_SVG_HOOKS,
  projectPositioned: positionedView(projectRadarPositioned),
  renderAscii: ctx => renderRadarAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth, ctx.styleFace),
} satisfies BuiltinRenderHooks

const SANKEY_RENDER_HOOKS = {
  ...SANKEY_SVG_HOOKS,
  projectPositioned: positionedView(projectSankeyPositioned),
  renderAscii: ctx => renderSankeyAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth, (ctx.familyConfig as { visual?: ReturnType<typeof resolveSankeyVisualConfig> } | undefined)?.visual),
} satisfies BuiltinRenderHooks

const GANTT_RENDER_HOOKS = {
  ...GANTT_SVG_HOOKS,
  projectPositioned: positionedView(projectGanttPositioned),
  renderAscii: ctx =>
    renderGanttAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, undefined, {
      maxWidth: ctx.options.maxWidth,
      today: ctx.options.ganttToday,
      resolvedConfig: (
        ctx.familyConfig as
          | {
              config?: ReturnType<typeof resolveGanttFrontmatterConfig>
            }
          | undefined
      )?.config,
      styleFace: ctx.styleFace,
    }),
} satisfies BuiltinRenderHooks

const MINDMAP_RENDER_HOOKS = {
  ...MINDMAP_SVG_HOOKS,
  projectPositioned: positionedView(projectMindmapPositioned),
  renderAscii: ctx => renderMindmapAscii(parseMindmap(ctx.source.familyBody), ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth),
} satisfies BuiltinRenderHooks

const GITGRAPH_RENDER_HOOKS = {
  ...GITGRAPH_SVG_HOOKS,
  projectPositioned: positionedView(projectGitGraphPositioned),
  renderAscii: ctx => {
    const familyConfig = ctx.familyConfig as
      | {
          position?: ReturnType<typeof resolveGitGraphPositionConfig>
          title?: string
        }
      | undefined
    return renderGitGraphAscii(
      parseGitGraph(ctx.source.familyBody, {
        mainBranchName: familyConfig?.position?.mainBranchName,
        mainBranchOrder: familyConfig?.position?.mainBranchOrder,
        title: familyConfig?.title,
      }),
      ctx.config,
      ctx.colorMode,
      ctx.theme,
      ctx.options.targetWidth,
      (ctx.familyAppearance as { themeVariables?: Record<string, unknown> } | undefined)?.themeVariables,
    )
  },
} satisfies BuiltinRenderHooks

export const BUILTIN_RENDER_HOOKS = Object.freeze({
  flowchart: FLOWCHART_RENDER_HOOKS,
  state: STATE_RENDER_HOOKS,
  sequence: SEQUENCE_RENDER_HOOKS,
  timeline: TIMELINE_RENDER_HOOKS,
  class: CLASS_RENDER_HOOKS,
  er: ER_RENDER_HOOKS,
  journey: JOURNEY_RENDER_HOOKS,
  xychart: XYCHART_RENDER_HOOKS,
  architecture: ARCHITECTURE_RENDER_HOOKS,
  pie: PIE_RENDER_HOOKS,
  quadrant: QUADRANT_RENDER_HOOKS,
  radar: RADAR_RENDER_HOOKS,
  sankey: SANKEY_RENDER_HOOKS,
  gantt: GANTT_RENDER_HOOKS,
  mindmap: MINDMAP_RENDER_HOOKS,
  gitgraph: GITGRAPH_RENDER_HOOKS,
}) satisfies Readonly<Record<DiagramKind, BuiltinRenderHooks>>
