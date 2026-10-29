import { ZENUML_SVG_HOOKS } from './svg-family-hooks/zenuml.ts'
import { renderZenUMLTerminal } from './ascii/zenuml.ts'
import { EVENTMODELING_SVG_HOOKS } from './svg-family-hooks/eventmodeling.ts'
import { renderEventModelingTerminal } from './ascii/eventmodeling.ts'
import { PACKET_SVG_HOOKS } from './svg-family-hooks/packet.ts'
import { preservedMermaidFamilyText } from './mermaid-source.ts'
import { renderPacketTerminal } from './ascii/packet.ts'
import { KANBAN_SVG_HOOKS } from './svg-family-hooks/kanban.ts'
import { renderKanbanTerminal } from './ascii/kanban.ts'
import { REQUIREMENT_SVG_HOOKS } from './svg-family-hooks/requirement.ts'
import { renderRequirementTerminal } from './ascii/requirement.ts'
import { TREEMAP_SVG_HOOKS } from './svg-family-hooks/treemap.ts'
import { renderTreemapTerminal } from './ascii/treemap.ts'
import { ISHIKAWA_SVG_HOOKS } from './svg-family-hooks/ishikawa.ts'
import { renderIshikawaTerminal } from './ascii/ishikawa.ts'
import { BLOCK_SVG_HOOKS } from './svg-family-hooks/block.ts'
import { renderBlockTerminal } from './ascii/block.ts'
import { C4_SVG_HOOKS } from './svg-family-hooks/c4.ts'
import { renderC4Terminal } from './ascii/c4.ts'
import type { C4Body } from './c4/types.ts'
import { terminalInputModel } from './ascii/terminal-model.ts'
import type { AsciiContext, FamilyDescriptor } from './agent/families.ts'
import type { DiagramKind } from './agent/types.ts'
import { renderArchitectureTerminal } from './ascii/architecture.ts'
import { architectureSourceLines } from './architecture/parser.ts'
import { flipCanvasVertically } from './ascii/canvas.ts'
import { nativeTerminalRenderer, terminalArtifact, type TerminalArtifact } from './ascii/terminal-artifact.ts'
import { renderClassTerminal } from './ascii/class-diagram.ts'
import { convertToAsciiGraph } from './ascii/converter.ts'
import { drawGraph } from './ascii/draw.ts'
import { renderErTerminal } from './ascii/er-diagram.ts'
import { renderGanttTerminal } from './ascii/gantt.ts'
import { renderGitGraphTerminal } from './ascii/gitgraph.ts'
import { createMapping } from './ascii/grid.ts'
import { renderJourneyTerminal } from './ascii/journey.ts'
import { renderMindmapTerminal } from './ascii/mindmap.ts'
import { renderPieTerminal } from './ascii/pie.ts'
import { renderQuadrantTerminal } from './ascii/quadrant.ts'
import { renderRadarTerminal } from './ascii/radar.ts'
import { renderSankeyTerminal } from './ascii/sankey.ts'
import { renderSequenceTerminal } from './ascii/sequence.ts'
import { renderStateTerminal } from './ascii/state.ts'
import { renderTimelineTerminal } from './ascii/timeline.ts'
import { renderXYChartTerminal } from './ascii/xychart.ts'
import { resolveGanttFrontmatterConfig } from './gantt/parser.ts'
import { parseGitGraph } from './gitgraph/parser.ts'
import { resolveGitGraphPositionConfig } from './gitgraph/position.ts'
import { parseMindmap } from './mindmap/parser.ts'
import { parseMermaid } from './parser.ts'
import { resolvePieVisualConfig } from './pie/config.ts'
import { pieFamilyLines } from './pie/source-title.ts'
import { resolveSankeyVisualConfig } from './sankey/config.ts'
import { sankeyFamilyLines } from './sankey/source.ts'
import { resolveSequenceConfig } from './sequence/config.ts'
import { sequenceFamilySource } from './sequence/family-source.ts'
import { authoredSequenceLine } from './sequence/parser.ts'
import { withAccessibilityFields } from './shared/accessibility-directives.ts'
import { checkAllGraphAuthoredStyles } from './shared/style-props.ts'
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

export const ZENUML_RENDER_HOOKS = { ...ZENUML_SVG_HOOKS, renderAscii: nativeTerminalRenderer(ctx => renderZenUMLTerminal(ctx.source.authoredFamilyBody ?? ctx.source.familyBody, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth)) }

export const EVENTMODELING_RENDER_HOOKS = { ...EVENTMODELING_SVG_HOOKS, renderAscii: nativeTerminalRenderer(ctx => renderEventModelingTerminal(ctx.source.authoredFamilyBody ?? ctx.source.familyBody, ctx.config, ctx.colorMode, ctx.theme)) }

type BuiltinRenderHooks = Pick<FamilyDescriptor, 'normalizeRequest' | 'layout' | 'projectPositioned' | 'renderAscii' | 'lowerScene'>

function renderFlowchartTerminal(ctx: AsciiContext, model = terminalInputModel(ctx.source.originalText, ctx.source.familyBody)): TerminalArtifact {
  const parsed = model.graph()
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
  }

  return terminalArtifact(graph.canvas, {
    colorMode: ctx.colorMode,
    theme: ctx.theme,
  })
}

function renderStateTerminalWithContext(ctx: AsciiContext): TerminalArtifact {
  const parsed = parseMermaid(ctx.source.familyText)
  checkAllGraphAuthoredStyles(parsed)
  const config = { ...ctx.config }
  config.graphDirection = parsed.direction === 'LR' || parsed.direction === 'RL' ? 'LR' : 'TD'
  config.reverseDirection = parsed.direction === 'RL'
  return renderStateTerminal(parsed, config, ctx.colorMode, ctx.theme, ctx.options.targetWidth)
}

function renderArchitectureTerminalWithContext(ctx: AsciiContext): TerminalArtifact {
  // The shared appearance resolver has already applied the documented
  // precedence (explicit RenderOptions > source config > defaults) and the
  // terminal projector has sanitized it. Re-reading raw themeVariables here
  // created a second, unsafe color authority unique to Architecture.
  return renderArchitectureTerminal(architectureSourceLines(ctx.source), ctx.config, ctx.colorMode, ctx.theme, { ...ctx.options, graphLayout: ctx.renderOptions.graphLayout })
}

export const FLOWCHART_RENDER_HOOKS = {
  ...FLOWCHART_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderFlowchartTerminal),
} satisfies BuiltinRenderHooks

export const STATE_RENDER_HOOKS = {
  ...STATE_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderStateTerminalWithContext),
} satisfies BuiltinRenderHooks

export const ARCHITECTURE_RENDER_HOOKS = {
  ...ARCHITECTURE_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderArchitectureTerminalWithContext),
} satisfies BuiltinRenderHooks

export const SEQUENCE_RENDER_HOOKS = {
  ...SEQUENCE_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => {
    const family = sequenceFamilySource(ctx.source, 'decoded')
    return renderSequenceTerminal(family.familyText, ctx.config, ctx.colorMode, ctx.theme, (ctx.familyConfig as { sequence?: ReturnType<typeof resolveSequenceConfig> } | undefined)?.sequence ?? {}, ctx.options.targetWidth, authoredSequenceLine(family))
  }),
} satisfies BuiltinRenderHooks

export const CLASS_RENDER_HOOKS = {
  ...CLASS_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderClassTerminal(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth, (ctx.source.authoredFamilyLines ?? ctx.source.familyLines).join('\n'))),
} satisfies BuiltinRenderHooks

export const ER_RENDER_HOOKS = {
  ...ER_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderErTerminal(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth)),
} satisfies BuiltinRenderHooks

export const TIMELINE_RENDER_HOOKS = {
  ...TIMELINE_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderTimelineTerminal(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth)),
} satisfies BuiltinRenderHooks

export const JOURNEY_RENDER_HOOKS = {
  ...JOURNEY_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderJourneyTerminal((ctx.source.authoredFamilyLines ?? ctx.source.familyLines).join('\n'), ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth, ctx.styleFace)),
} satisfies BuiltinRenderHooks

export const XYCHART_RENDER_HOOKS = {
  ...XYCHART_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => {
    const config = (ctx.familyConfig as { config?: ReturnType<typeof resolveXYChartConfig> } | undefined)?.config
    const theme = (ctx.familyAppearance as { theme?: ReturnType<typeof resolveXYChartTheme> } | undefined)?.theme
    return renderXYChartTerminal(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, {}, ctx.options.targetWidth, config && theme ? { config, theme } : undefined)
  }),
} satisfies BuiltinRenderHooks

export const PIE_RENDER_HOOKS = {
  ...PIE_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderPieTerminal(pieFamilyLines(ctx.source), ctx.config, ctx.colorMode, ctx.theme, {}, ctx.options.targetWidth, (ctx.familyConfig as { visual?: ReturnType<typeof resolvePieVisualConfig> } | undefined)?.visual, ctx.styleFace)),
} satisfies BuiltinRenderHooks

export const QUADRANT_RENDER_HOOKS = {
  ...QUADRANT_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderQuadrantTerminal(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth)),
} satisfies BuiltinRenderHooks

export const RADAR_RENDER_HOOKS = {
  ...RADAR_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderRadarTerminal(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth, ctx.styleFace)),
} satisfies BuiltinRenderHooks

export const SANKEY_RENDER_HOOKS = {
  ...SANKEY_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderSankeyTerminal(sankeyFamilyLines(ctx.source), ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth, (ctx.familyConfig as { visual?: ReturnType<typeof resolveSankeyVisualConfig> } | undefined)?.visual)),
} satisfies BuiltinRenderHooks

export const GANTT_RENDER_HOOKS = {
  ...GANTT_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx =>
    renderGanttTerminal(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, undefined, {
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
  ),
} satisfies BuiltinRenderHooks

export const MINDMAP_RENDER_HOOKS = {
  ...MINDMAP_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderMindmapTerminal(parseMindmap(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth)),
} satisfies BuiltinRenderHooks

export const GITGRAPH_RENDER_HOOKS = {
  ...GITGRAPH_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => {
    const familyConfig = ctx.familyConfig as
      | {
          position?: ReturnType<typeof resolveGitGraphPositionConfig>
          title?: string
        }
      | undefined
    return renderGitGraphTerminal(
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
  }),
} satisfies BuiltinRenderHooks

export const C4_RENDER_HOOKS = {
  ...C4_SVG_HOOKS,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => {
    const config = ctx.familyConfig as { model: C4Body; c4: Record<string, unknown> }
    return renderC4Terminal(config.model, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth, config.c4)
  }),
} satisfies BuiltinRenderHooks

export const PACKET_RENDER_HOOKS = /* @__PURE__ */ { ...PACKET_SVG_HOOKS, renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderPacketTerminal(ctx)) }

export const KANBAN_RENDER_HOOKS = /* @__PURE__ */ { ...KANBAN_SVG_HOOKS, renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderKanbanTerminal(ctx)) }

export const REQUIREMENT_RENDER_HOOKS = /* @__PURE__ */ { ...REQUIREMENT_SVG_HOOKS, renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderRequirementTerminal(preservedMermaidFamilyText(ctx.source), ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth)) }

export const TREEMAP_RENDER_HOOKS = /* @__PURE__ */ { ...TREEMAP_SVG_HOOKS, renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderTreemapTerminal(ctx)) }

export const ISHIKAWA_RENDER_HOOKS = /* @__PURE__ */ { ...ISHIKAWA_SVG_HOOKS, renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderIshikawaTerminal(ctx)) }

export const BLOCK_RENDER_HOOKS = /* @__PURE__ */ { ...BLOCK_SVG_HOOKS, renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderBlockTerminal(ctx.source.familyBody, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth)) }

export const BUILTIN_RENDER_HOOKS = /* @__PURE__ */ Object.freeze({
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
  c4: C4_RENDER_HOOKS,
  packet: PACKET_RENDER_HOOKS,
  kanban: KANBAN_RENDER_HOOKS,
  requirement: REQUIREMENT_RENDER_HOOKS,
  treemap: TREEMAP_RENDER_HOOKS,
  ishikawa: ISHIKAWA_RENDER_HOOKS,
  block: BLOCK_RENDER_HOOKS,

  gantt: GANTT_RENDER_HOOKS,
  mindmap: MINDMAP_RENDER_HOOKS,
  gitgraph: GITGRAPH_RENDER_HOOKS,
  zenuml: ZENUML_RENDER_HOOKS,
  eventmodeling: EVENTMODELING_RENDER_HOOKS,
}) satisfies Readonly<Record<DiagramKind, BuiltinRenderHooks>>
