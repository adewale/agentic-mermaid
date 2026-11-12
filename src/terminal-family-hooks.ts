import { flowchartStatementEnds } from './flowchart-lexer.ts'
import { AGENTFLOW_NORMALIZE_REQUEST, FLOWCHART_NORMALIZE_REQUEST, SWIMLANE_NORMALIZE_REQUEST } from './flowchart-config.ts'
import { ARCHITECTURE_NORMALIZE_REQUEST } from './architecture/config.ts'
import { C4_NORMALIZE_REQUEST } from './c4/parser.ts'
import { CLASS_NORMALIZE_REQUEST } from './class/layout.ts'
import { ER_NORMALIZE_REQUEST } from './er/layout.ts'
import { EVENTMODELING_NORMALIZE_REQUEST } from './eventmodeling/layout.ts'
import { GANTT_NORMALIZE_REQUEST } from './gantt/parser.ts'
import { GITGRAPH_NORMALIZE_REQUEST } from './gitgraph/renderer.ts'
import { JOURNEY_NORMALIZE_REQUEST } from './journey/layout.ts'
import { KANBAN_NORMALIZE_REQUEST } from './kanban/config.ts'
import { MINDMAP_NORMALIZE_REQUEST } from './mindmap/position.ts'
import { PACKET_NORMALIZE_REQUEST } from './packet/config.ts'
import { PIE_NORMALIZE_REQUEST } from './pie/config.ts'
import { QUADRANT_NORMALIZE_REQUEST } from './quadrant/config.ts'
import { RADAR_NORMALIZE_REQUEST } from './radar/config.ts'
import { SANKEY_NORMALIZE_REQUEST } from './sankey/config.ts'
import { SEQUENCE_NORMALIZE_REQUEST } from './sequence/config.ts'
import { STATE_NORMALIZE_REQUEST } from './state/config.ts'
import { TIMELINE_NORMALIZE_REQUEST } from './timeline/renderer.ts'
import { TREEMAP_NORMALIZE_REQUEST } from './treemap/layout.ts'
import { XYCHART_NORMALIZE_REQUEST } from './xychart/parser.ts'
import { diagnoseArchitectureConfig } from './architecture/config-diagnostics.ts'
import { architectureStatementEnds } from './architecture/parser.ts'
import { diagnoseBlockConfig } from './block/config-diagnostics.ts'
import { diagnoseC4Config } from './c4/config-diagnostics.ts'
import { diagnoseClassConfig } from './class/config-diagnostics.ts'
import { classStatementEnds } from './class/parser.ts'
import { diagnoseErConfig } from './er/config-diagnostics.ts'
import { eventModelingStatementEnds } from './eventmodeling/parser.ts'
import { diagnoseFlowchartConfig } from './flowchart/config-diagnostics.ts'
import { diagnoseGanttConfig } from './gantt/config-diagnostics.ts'
import { diagnoseGitGraphConfig } from './gitgraph/config-diagnostics.ts'
import { gitGraphStatementEnds } from './gitgraph/parser.ts'
import { diagnoseIshikawaConfig } from './ishikawa/config-diagnostics.ts'
import { diagnoseJourneyConfig } from './journey/config-diagnostics.ts'
import { kanbanStatementEnds } from './kanban/parser.ts'
import { diagnoseKanbanConfig } from './kanban/config-diagnostics.ts'
import { diagnoseMindmapConfig } from './mindmap/config-diagnostics.ts'
import { mindmapStatementEnds } from './mindmap/parser.ts'
import { diagnosePacketConfig } from './packet/config-diagnostics.ts'
import { diagnosePieConfig } from './pie/config-diagnostics.ts'
import { pieStatementEnds } from './pie/parser.ts'
import { diagnoseQuadrantConfig } from './quadrant/config-diagnostics.ts'
import { quadrantStatementEnds } from './quadrant/parser.ts'
import { diagnoseRadarConfig } from './radar/config-diagnostics.ts'
import { radarStatementEnds } from './radar/parser.ts'
import { diagnoseRequirementConfig } from './requirement/config-diagnostics.ts'
import { requirementStatementEnds } from './requirement/lexer.ts'
import { diagnoseSankeyConfig } from './sankey/config-diagnostics.ts'
import { diagnoseSequenceConfig } from './sequence/config-diagnostics.ts'
import { diagnoseStateConfig } from './state/config-diagnostics.ts'
import { stateStatementEnds } from './state/parse-core.ts'
import { diagnoseTimelineConfig } from './timeline/config-diagnostics.ts'
import { diagnoseTreemapConfig } from './treemap/config-diagnostics.ts'
import { usecaseStatementEnds } from './usecase/parser.ts'
import { vennStatementEnds } from './venn/parser.ts'
import { diagnoseXyChartConfig } from './xychart/config-diagnostics.ts'
import { xychartStatementEnds } from './xychart/parser.ts'
import { zenUMLStatementEnds } from './zenuml/native-parser.ts'

import { renderRailroadTerminal } from './ascii/railroad.ts'

import { renderCynefinTerminal } from './ascii/cynefin.ts'

import { renderVennTerminal } from './ascii/venn.ts'

import { renderWardleyTerminal } from './ascii/wardley.ts'

import { renderUsecaseTerminal } from './ascii/usecase.ts'

import { renderAgentflowTerminal } from './ascii/agentflow.ts'

import { renderSwimlaneTerminal } from './ascii/swimlane.ts'

import { renderTreeviewTerminal } from './ascii/treeview.ts'

import { expandInlineNamespaceStatement } from './class/parser.ts'

import { withParserSource } from './shared/parser-source.ts'

import { renderZenUMLTerminal } from './ascii/zenuml.ts'

import { renderEventModelingTerminal } from './ascii/eventmodeling.ts'

import { preservedMermaidFamilyText } from './mermaid-source.ts'

import { renderPacketTerminal } from './ascii/packet.ts'

import { renderKanbanTerminal } from './ascii/kanban.ts'

import { renderRequirementTerminal } from './ascii/requirement.ts'

import { renderTreemapTerminal } from './ascii/treemap.ts'

import { renderIshikawaTerminal } from './ascii/ishikawa.ts'

import { renderBlockTerminal } from './ascii/block.ts'

import { renderC4Terminal } from './ascii/c4.ts'

import type { C4Body } from './c4/types.ts'

import { terminalInputModel } from './ascii/terminal-model.ts'

import type { AsciiContext, FamilyDescriptor } from './agent/families.ts'

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

import { authoredSequenceColumn, authoredSequenceLine } from './sequence/parser.ts'

import { checkAllGraphAuthoredStyles } from './shared/style-props.ts'

import { resolveXYChartConfig, resolveXYChartTheme } from './xychart/parser.ts'

export const ZENUML_TERMINAL_HOOKS = {
  statementEnds: zenUMLStatementEnds,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderZenUMLTerminal(ctx.source.authoredFamilyBody ?? ctx.source.familyBody, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth)),
} satisfies BuiltinTerminalHooks

export const EVENTMODELING_TERMINAL_HOOKS = {
  normalizeRequest: EVENTMODELING_NORMALIZE_REQUEST,
  statementEnds: eventModelingStatementEnds,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderEventModelingTerminal(ctx.source.authoredFamilyBody ?? ctx.source.familyBody, ctx.config, ctx.colorMode, ctx.theme)),
} satisfies BuiltinTerminalHooks

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

export const FLOWCHART_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseFlowchartConfig,
  statementEnds: flowchartStatementEnds,
  normalizeRequest: FLOWCHART_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderFlowchartTerminal),
} satisfies BuiltinTerminalHooks

export const STATE_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseStateConfig,
  statementEnds: stateStatementEnds,
  normalizeRequest: STATE_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderStateTerminalWithContext),
} satisfies BuiltinTerminalHooks

export const ARCHITECTURE_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseArchitectureConfig,
  statementEnds: architectureStatementEnds,
  normalizeRequest: ARCHITECTURE_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderArchitectureTerminalWithContext),
} satisfies BuiltinTerminalHooks

export const SEQUENCE_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseSequenceConfig,
  normalizeRequest: SEQUENCE_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => {
    const family = sequenceFamilySource(ctx.source, 'decoded')
    const coordinates = family === ctx.source ? family : { ...ctx.source, familyLines: family.familyLines }
    return renderSequenceTerminal(family.familyText, ctx.config, ctx.colorMode, ctx.theme, (ctx.familyConfig as { sequence?: ReturnType<typeof resolveSequenceConfig> } | undefined)?.sequence ?? {}, ctx.options.targetWidth, authoredSequenceLine(coordinates), authoredSequenceColumn(coordinates))
  }),
} satisfies BuiltinTerminalHooks

export const CLASS_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseClassConfig,
  statementEnds: classStatementEnds,
  normalizeRequest: CLASS_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx =>
    withParserSource(
      ctx.source,
      () => ctx.source.familyLines.flatMap(expandInlineNamespaceStatement),
      () => renderClassTerminal(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth, (ctx.source.authoredFamilyLines ?? ctx.source.familyLines).join('\n')),
    ),
  ),
} satisfies BuiltinTerminalHooks

export const ER_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseErConfig,
  normalizeRequest: ER_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx =>
    withParserSource(
      ctx.source,
      () => ctx.source.familyLines,
      () => renderErTerminal(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth),
    ),
  ),
} satisfies BuiltinTerminalHooks

export const TIMELINE_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseTimelineConfig,
  normalizeRequest: TIMELINE_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderTimelineTerminal(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth)),
} satisfies BuiltinTerminalHooks

export const JOURNEY_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseJourneyConfig,
  normalizeRequest: JOURNEY_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderJourneyTerminal((ctx.source.authoredFamilyLines ?? ctx.source.familyLines).join('\n'), ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth, ctx.styleFace)),
} satisfies BuiltinTerminalHooks

export const XYCHART_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseXyChartConfig,
  statementEnds: xychartStatementEnds,
  normalizeRequest: XYCHART_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => {
    const config = (ctx.familyConfig as { config?: ReturnType<typeof resolveXYChartConfig> } | undefined)?.config
    const theme = (ctx.familyAppearance as { theme?: ReturnType<typeof resolveXYChartTheme> } | undefined)?.theme
    return renderXYChartTerminal(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, {}, ctx.options.targetWidth, config && theme ? { config, theme } : undefined)
  }),
} satisfies BuiltinTerminalHooks

export const PIE_TERMINAL_HOOKS = {
  configDiagnostics: diagnosePieConfig,
  statementEnds: pieStatementEnds,
  normalizeRequest: PIE_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderPieTerminal(pieFamilyLines(ctx.source), ctx.config, ctx.colorMode, ctx.theme, {}, ctx.options.targetWidth, (ctx.familyConfig as { visual?: ReturnType<typeof resolvePieVisualConfig> } | undefined)?.visual, ctx.styleFace)),
} satisfies BuiltinTerminalHooks

export const QUADRANT_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseQuadrantConfig,
  statementEnds: quadrantStatementEnds,
  normalizeRequest: QUADRANT_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderQuadrantTerminal(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth)),
} satisfies BuiltinTerminalHooks

export const RADAR_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseRadarConfig,
  statementEnds: radarStatementEnds,
  normalizeRequest: RADAR_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderRadarTerminal(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth, ctx.styleFace)),
} satisfies BuiltinTerminalHooks

export const SANKEY_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseSankeyConfig,
  normalizeRequest: SANKEY_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderSankeyTerminal(sankeyFamilyLines(ctx.source), ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth, (ctx.familyConfig as { visual?: ReturnType<typeof resolveSankeyVisualConfig> } | undefined)?.visual)),
} satisfies BuiltinTerminalHooks

export const GANTT_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseGanttConfig,
  normalizeRequest: GANTT_NORMALIZE_REQUEST,
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
} satisfies BuiltinTerminalHooks

export const MINDMAP_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseMindmapConfig,
  statementEnds: mindmapStatementEnds,
  normalizeRequest: MINDMAP_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx =>
    renderMindmapTerminal(
      withParserSource(
        ctx.source,
        () => (ctx.source.authoredFamilyBody ?? ctx.source.familyBody).split('\n'),
        () => parseMindmap(ctx.source.authoredFamilyBody ?? ctx.source.familyBody),
      ),
      ctx.config,
      ctx.colorMode,
      ctx.theme,
      ctx.options.targetWidth,
    ),
  ),
} satisfies BuiltinTerminalHooks

export const GITGRAPH_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseGitGraphConfig,
  statementEnds: gitGraphStatementEnds,
  normalizeRequest: GITGRAPH_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => {
    const familyConfig = ctx.familyConfig as
      | {
          position?: ReturnType<typeof resolveGitGraphPositionConfig>
          title?: string
        }
      | undefined
    return renderGitGraphTerminal(
      withParserSource(
        ctx.source,
        () => ctx.source.familyBody.split('\n'),
        () =>
          parseGitGraph(ctx.source.familyBody, {
            mainBranchName: familyConfig?.position?.mainBranchName,
            mainBranchOrder: familyConfig?.position?.mainBranchOrder,
            title: familyConfig?.title,
          }),
      ),
      ctx.config,
      ctx.colorMode,
      ctx.theme,
      ctx.options.targetWidth,
      (ctx.familyAppearance as { themeVariables?: Record<string, unknown> } | undefined)?.themeVariables,
    )
  }),
} satisfies BuiltinTerminalHooks

export const C4_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseC4Config,
  normalizeRequest: C4_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => {
    const config = ctx.familyConfig as { model: C4Body; c4: Record<string, unknown> }
    return renderC4Terminal(config.model, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth, config.c4)
  }),
} satisfies BuiltinTerminalHooks

export const PACKET_TERMINAL_HOOKS = {
  configDiagnostics: diagnosePacketConfig,
  normalizeRequest: PACKET_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderPacketTerminal(ctx)),
} satisfies BuiltinTerminalHooks

export const KANBAN_TERMINAL_HOOKS = {
  statementEnds: kanbanStatementEnds,
  configDiagnostics: diagnoseKanbanConfig,
  normalizeRequest: KANBAN_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderKanbanTerminal(ctx)),
} satisfies BuiltinTerminalHooks

export const REQUIREMENT_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseRequirementConfig,
  statementEnds: requirementStatementEnds,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderRequirementTerminal(preservedMermaidFamilyText(ctx.source), ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth)),
} satisfies BuiltinTerminalHooks

export const TREEMAP_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseTreemapConfig,
  normalizeRequest: TREEMAP_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderTreemapTerminal(ctx)),
} satisfies BuiltinTerminalHooks

export const ISHIKAWA_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseIshikawaConfig,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderIshikawaTerminal(ctx)),
} satisfies BuiltinTerminalHooks

export const BLOCK_TERMINAL_HOOKS = {
  configDiagnostics: diagnoseBlockConfig,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(ctx => renderBlockTerminal(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth)),
} satisfies BuiltinTerminalHooks

export const CYNEFIN_TERMINAL_HOOKS = {
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderCynefinTerminal),
} satisfies BuiltinTerminalHooks

export const VENN_TERMINAL_HOOKS = {
  statementEnds: vennStatementEnds,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderVennTerminal),
} satisfies BuiltinTerminalHooks

export const WARDLEY_TERMINAL_HOOKS = {
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderWardleyTerminal),
} satisfies BuiltinTerminalHooks

export const USECASE_TERMINAL_HOOKS = {
  statementEnds: usecaseStatementEnds,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderUsecaseTerminal),
} satisfies BuiltinTerminalHooks

export const AGENTFLOW_TERMINAL_HOOKS = {
  statementEnds: flowchartStatementEnds,
  normalizeRequest: AGENTFLOW_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderAgentflowTerminal),
} satisfies BuiltinTerminalHooks

export const SWIMLANE_TERMINAL_HOOKS = {
  statementEnds: flowchartStatementEnds,
  normalizeRequest: SWIMLANE_NORMALIZE_REQUEST,
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderSwimlaneTerminal),
} satisfies BuiltinTerminalHooks

export const TREEVIEW_TERMINAL_HOOKS = {
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderTreeviewTerminal),
} satisfies BuiltinTerminalHooks

export const RAILROAD_TERMINAL_HOOKS = {
  renderAscii: /* @__PURE__ */ nativeTerminalRenderer(renderRailroadTerminal),
} satisfies BuiltinTerminalHooks

type BuiltinTerminalHooks = Pick<FamilyDescriptor, 'normalizeRequest' | 'configDiagnostics' | 'statementEnds'> & Required<Pick<FamilyDescriptor, 'renderAscii'>>
