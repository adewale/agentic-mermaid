import type {
  AsciiContext, FamilyDescriptor, FamilyLayoutContext, FamilyLayoutResult,
  FamilyPositionedProjectionContext, FamilyPositionedView,
} from './agent/families.ts'
import type { DiagramKind } from './agent/types.ts'
import type { PositionedDiagram, RenderContext } from './types.ts'

import { parseMermaid } from './parser.ts'
import { layoutGraphSync } from './layout-engine.ts'
import { resolveFlowchartRenderOptions, applyFlowchartLabelWrapping } from './flowchart-config.ts'
import { resolveStateRenderOptions, type ResolvedStateVisualConfig } from './state/config.ts'
import { lowerGraphScene } from './renderer.ts'
import type { SceneDoc } from './scene/ir.ts'

import { parseSequenceDiagram } from './sequence/parser.ts'
import { layoutSequenceDiagram } from './sequence/layout.ts'
import { resolveSequenceConfig } from './sequence/config.ts'
import { lowerSequenceScene } from './sequence/renderer.ts'
import { parseClassDiagram } from './class/parser.ts'
import { layoutClassDiagram, resolveClassRenderOptions } from './class/layout.ts'
import { lowerClassScene } from './class/renderer.ts'
import { parseErDiagram } from './er/parser.ts'
import { layoutErDiagram, applyErFrontmatterDirection, resolveErRenderOptions } from './er/layout.ts'
import { lowerErScene } from './er/renderer.ts'
import { parseTimelineDiagram } from './timeline/parser.ts'
import { layoutTimelineDiagram } from './timeline/layout.ts'
import { lowerTimelineScene, resolveTimelineRequestAppearance } from './timeline/renderer.ts'
import { parseJourneyDiagram } from './journey/parser.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from './journey/layout.ts'
import { lowerJourneyScene } from './journey/renderer.ts'
import {
  applyResolvedXYChartConfig,
  parseXYChart,
  resolveXYChartConfig,
  resolveXYChartTheme,
} from './xychart/parser.ts'
import { layoutXYChart } from './xychart/layout.ts'
import { lowerXYChartScene } from './xychart/renderer.ts'
import { parsePieChart } from './pie/parser.ts'
import { layoutPieChart } from './pie/layout.ts'
import { resolvePieVisualConfig } from './pie/config.ts'
import { lowerPieScene } from './pie/renderer.ts'
import { parseQuadrantChart } from './quadrant/parser.ts'
import { layoutQuadrantChart } from './quadrant/layout.ts'
import { resolveQuadrantVisualConfig } from './quadrant/config.ts'
import { lowerQuadrantScene } from './quadrant/renderer.ts'
import { parseRadarChart } from './radar/parser.ts'
import { layoutRadarChart } from './radar/layout.ts'
import { resolveRadarVisualConfig } from './radar/config.ts'
import { lowerRadarScene } from './radar/renderer.ts'
import { buildGanttRenderPipelineFromConfig } from './gantt/pipeline.ts'
import { resolveGanttFrontmatterConfig } from './gantt/parser.ts'
import { lowerGanttScene } from './gantt/renderer.ts'
import { parseMindmap } from './mindmap/parser.ts'
import { positionMindmap, resolveMindmapPositionConfig } from './mindmap/position.ts'
import { lowerMindmapScene } from './mindmap/renderer.ts'
import { parseGitGraph } from './gitgraph/parser.ts'
import { positionGitGraph, resolveGitGraphPositionConfig } from './gitgraph/position.ts'
import { lowerGitGraphScene, resolveGitGraphThemeProjection } from './gitgraph/renderer.ts'
import { parseArchitectureDiagram } from './architecture/parser.ts'
import { layoutArchitectureDiagram } from './architecture/layout.ts'
import { lowerArchitectureScene } from './architecture/renderer.ts'
import { resolveArchitectureVisualConfig } from './architecture/config.ts'
import { withAccessibilityFields, withAccessibilityObject } from './shared/accessibility-directives.ts'

import { convertToAsciiGraph } from './ascii/converter.ts'
import { createMapping } from './ascii/grid.ts'
import { drawGraph } from './ascii/draw.ts'
import { canvasToString, flipCanvasVertically, flipRoleCanvasVertically } from './ascii/canvas.ts'
import { renderSequenceAscii } from './ascii/sequence.ts'
import { renderStateAscii } from './ascii/state.ts'
import { renderClassAscii } from './ascii/class-diagram.ts'
import { renderErAscii } from './ascii/er-diagram.ts'
import { renderTimelineAscii } from './ascii/timeline.ts'
import { renderGanttAscii } from './ascii/gantt.ts'
import { renderJourneyAscii } from './ascii/journey.ts'
import { renderXYChartAscii } from './ascii/xychart.ts'
import { renderPieAscii } from './ascii/pie.ts'
import { renderQuadrantAscii } from './ascii/quadrant.ts'
import { renderRadarAscii } from './ascii/radar.ts'
import { renderArchitectureAscii } from './ascii/architecture.ts'
import { renderMindmapAscii } from './ascii/mindmap.ts'
import { renderGitGraphAscii } from './ascii/gitgraph.ts'
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
  projectSequencePositioned,
  projectTimelinePositioned,
  projectXyChartPositioned,
} from './agent/family-layouts.ts'

type SceneLowerer<TPositioned extends PositionedDiagram> = (ctx: RenderContext<TPositioned>) => SceneDoc
type PositionedProjector<TPositioned extends PositionedDiagram> =
  (ctx: FamilyPositionedProjectionContext<TPositioned>) => FamilyPositionedView

function scene<TPositioned extends PositionedDiagram>(lowerer: SceneLowerer<TPositioned>): FamilyDescriptor['lowerScene'] {
  return (ctx) => lowerer(ctx as RenderContext<TPositioned>)
}

function positionedView<TPositioned extends PositionedDiagram>(
  projector: PositionedProjector<TPositioned>,
): FamilyDescriptor['projectPositioned'] {
  return ctx => projector(ctx as FamilyPositionedProjectionContext<TPositioned>)
}

function layoutResult<TPositioned extends PositionedDiagram>(
  positioned: TPositioned,
  extra: Omit<FamilyLayoutResult<TPositioned>, 'positioned'> = {},
): FamilyLayoutResult<TPositioned> {
  return { positioned, ...extra }
}

type BuiltinRenderHooks = Pick<
  FamilyDescriptor,
  'normalizeRequest' | 'layout' | 'projectPositioned' | 'renderAscii' | 'lowerScene'
>

function layoutStateWithConfig(ctx: FamilyLayoutContext): FamilyLayoutResult {
  const stateVisual = (ctx.familyAppearance as {
    visual?: ResolvedStateVisualConfig
  } | undefined)?.visual
  return layoutResult(layoutGraphSync(parseMermaid(ctx.source.familyText), {
    ...ctx.renderOptions,
    ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}),
    ...(stateVisual ? { stateVisual } : {}),
  }))
}

// Flowchart proper (not state) additionally wires the typed `flowchart`
// frontmatter config section (nodeSpacing/rankSpacing/wrappingWidth —
// explicit RenderOptions win; unwired keys are named by verify's
// INEFFECTIVE_CONFIG lint) and applies measured-width label wrapping before
// ELK sizing so layout, renderer, and SVG see the same lines.
function layoutFlowchartWithConfig(ctx: FamilyLayoutContext): FamilyLayoutResult {
  const graph = parseMermaid(ctx.source.familyText)
  applyFlowchartLabelWrapping(graph, ctx.renderOptions, ctx.styleFace)
  return layoutResult(layoutGraphSync(graph, {
    ...ctx.renderOptions,
    ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}),
  }))
}

function renderFlowchartAscii(ctx: AsciiContext): string {
  const parsed = parseMermaid(ctx.source.familyText)
  const config = { ...ctx.config }

  if (parsed.direction === 'LR' || parsed.direction === 'RL') {
    config.graphDirection = 'LR'
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
  const config = { ...ctx.config }
  config.graphDirection = parsed.direction === 'LR' || parsed.direction === 'RL' ? 'LR' : 'TD'
  return renderStateAscii(parsed, config, ctx.colorMode, ctx.theme, ctx.options.targetWidth)
}

function layoutArchitecture(ctx: FamilyLayoutContext): FamilyLayoutResult {
  const familyConfig = ctx.familyConfig as {
    layout: ReturnType<typeof resolveArchitectureVisualConfig>['layout']
  } | undefined
  const diagram = withAccessibilityFields(
    parseArchitectureDiagram(ctx.source.familyLines),
    ctx.source.accessibility,
  )
  return layoutResult(layoutArchitectureDiagram(diagram, ctx.renderOptions, familyConfig?.layout), {
    injectAccessibility: false,
  })
}

function renderArchitectureAsciiWithContext(ctx: AsciiContext): string {
  // The shared appearance resolver has already applied the documented
  // precedence (explicit RenderOptions > source config > defaults) and the
  // terminal projector has sanitized it. Re-reading raw themeVariables here
  // created a second, unsafe color authority unique to Architecture.
  return renderArchitectureAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options)
}

const FLOWCHART_RENDER_HOOKS = {
  normalizeRequest: ctx => ({
    renderOptions: resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  layout: layoutFlowchartWithConfig,
  projectPositioned: positionedView(projectGraphPositioned),
  lowerScene: scene(lowerGraphScene),
  renderAscii: renderFlowchartAscii,
} satisfies BuiltinRenderHooks

const STATE_RENDER_HOOKS = {
  normalizeRequest: ctx => {
    const resolved = resolveStateRenderOptions(ctx.source.frontmatter, ctx.renderOptions)
    const { stateVisual, ...renderOptions } = resolved
    return {
      renderOptions,
      ...(stateVisual ? { appearance: { family: { visual: stateVisual } } } : {}),
    }
  },
  layout: layoutStateWithConfig,
  projectPositioned: positionedView(projectGraphPositioned),
  lowerScene: scene(lowerGraphScene),
  renderAscii: renderStateAsciiWithContext,
} satisfies BuiltinRenderHooks

const ARCHITECTURE_RENDER_HOOKS = {
  normalizeRequest: ctx => {
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
  },
  layout: layoutArchitecture,
  projectPositioned: positionedView(projectArchitecturePositioned),
  lowerScene: scene(lowerArchitectureScene),
  renderAscii: renderArchitectureAsciiWithContext,
} satisfies BuiltinRenderHooks

const SEQUENCE_RENDER_HOOKS = {
  // Wire-or-warn config threading (src/sequence/config.ts): the typed
  // `sequence` frontmatter/init section's wired keys reach the parser
  // (showSequenceNumbers) and layout (margins/sizes); unwired keys are named
  // by verify's INEFFECTIVE_CONFIG lint. Absent config resolves to {} and
  // keeps default geometry byte-identical.
  normalizeRequest: ctx => ({
    familyConfig: { sequence: resolveSequenceConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => {
    const seqConfig = (ctx.familyConfig as {
      sequence?: ReturnType<typeof resolveSequenceConfig>
    } | undefined)?.sequence ?? {}
    const diagram = withAccessibilityFields(
      parseSequenceDiagram(ctx.source.familyLines, seqConfig),
      ctx.source.accessibility,
    )
    return layoutResult(layoutSequenceDiagram(diagram, ctx.renderOptions, seqConfig, ctx.styleFace))
  },
  projectPositioned: positionedView(projectSequencePositioned),
  lowerScene: scene(lowerSequenceScene),
  renderAscii: ctx => renderSequenceAscii(
    ctx.source.familyText,
    ctx.config,
    ctx.colorMode,
    ctx.theme,
    (ctx.familyConfig as { sequence?: ReturnType<typeof resolveSequenceConfig> } | undefined)?.sequence ?? {},
    ctx.options.targetWidth,
  ),
} satisfies BuiltinRenderHooks

const CLASS_RENDER_HOOKS = {
  normalizeRequest: ctx => ({
    renderOptions: resolveClassRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  // Wire-or-warn config threading: the typed `class` frontmatter section's
  // nodeSpacing/rankSpacing fold into RenderOptions (explicit options win).
  layout: ctx => layoutResult(layoutClassDiagram(
    withAccessibilityFields(parseClassDiagram(ctx.source.familyLines), ctx.source.accessibility),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  projectPositioned: positionedView(projectClassPositioned),
  lowerScene: scene(lowerClassScene),
  renderAscii: ctx => renderClassAscii(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth),
} satisfies BuiltinRenderHooks

const ER_RENDER_HOOKS = {
  normalizeRequest: ctx => ({
    renderOptions: resolveErRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  // Wire-or-warn config threading: er.layoutDirection + nodeSpacing/
  // rankSpacing fold into the parsed diagram/options (statement + explicit
  // options win over frontmatter).
  layout: ctx => {
    const diagram = applyErFrontmatterDirection(
      withAccessibilityFields(parseErDiagram(ctx.source.familyLines), ctx.source.accessibility),
      ctx.source.frontmatter,
    )
    return layoutResult(layoutErDiagram(diagram, ctx.renderOptions, ctx.styleFace))
  },
  projectPositioned: positionedView(projectErPositioned),
  lowerScene: scene(lowerErScene),
  renderAscii: ctx => renderErAscii(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth),
} satisfies BuiltinRenderHooks

const TIMELINE_RENDER_HOOKS = {
  normalizeRequest: ctx => ({
    appearance: { family: { ...resolveTimelineRequestAppearance(ctx.renderOptions) } },
  }),
  layout: ctx => layoutResult(layoutTimelineDiagram(
    parseTimelineDiagram(ctx.source.familyLines, ctx.source.accessibility),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  projectPositioned: positionedView(projectTimelinePositioned),
  lowerScene: scene(lowerTimelineScene),
  renderAscii: ctx => renderTimelineAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth),
} satisfies BuiltinRenderHooks

const JOURNEY_RENDER_HOOKS = {
  normalizeRequest: ctx => ({
    appearance: { family: resolveJourneyRequestAppearance(ctx.renderOptions) as unknown as Record<string, unknown> },
  }),
  layout: ctx => layoutResult(layoutJourneyDiagram(
    parseJourneyDiagram(ctx.source.familyLines, ctx.source.accessibility),
    (ctx.familyAppearance as ReturnType<typeof resolveJourneyRequestAppearance> | undefined)
      ?? resolveJourneyRequestAppearance(ctx.renderOptions),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  projectPositioned: positionedView(projectJourneyPositioned),
  lowerScene: scene(lowerJourneyScene),
  renderAscii: ctx => renderJourneyAscii(ctx.source.familyText, ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth, ctx.styleFace),
} satisfies BuiltinRenderHooks

const XYCHART_RENDER_HOOKS = {
  normalizeRequest: ctx => {
    const config = resolveXYChartConfig(ctx.source.frontmatter)
    const theme = resolveXYChartTheme(ctx.source.frontmatter)
    return {
      familyConfig: { config },
      appearance: {
        ...(ctx.renderOptions.bg === undefined && theme.backgroundColor
          ? { colors: { bg: theme.backgroundColor } }
          : {}),
        family: { theme },
      },
    }
  },
  layout: ctx => {
    const familyConfig = ctx.familyConfig as {
      config: ReturnType<typeof resolveXYChartConfig>
    } | undefined
    const familyAppearance = ctx.familyAppearance as {
      theme: ReturnType<typeof resolveXYChartTheme>
    } | undefined
    const chart = applyResolvedXYChartConfig(
      withAccessibilityObject(parseXYChart(ctx.source.familyLines), ctx.source.accessibility),
      familyConfig?.config ?? resolveXYChartConfig({}),
      familyAppearance?.theme ?? resolveXYChartTheme({}),
    )
    return layoutResult(layoutXYChart(chart, ctx.renderOptions, ctx.styleFace), { injectAccessibility: false })
  },
  projectPositioned: positionedView(projectXyChartPositioned),
  lowerScene: scene(lowerXYChartScene),
  renderAscii: ctx => {
    const config = (ctx.familyConfig as { config?: ReturnType<typeof resolveXYChartConfig> } | undefined)?.config
    const theme = (ctx.familyAppearance as { theme?: ReturnType<typeof resolveXYChartTheme> } | undefined)?.theme
    return renderXYChartAscii(
      ctx.source.familyText,
      ctx.config,
      ctx.colorMode,
      ctx.theme,
      {},
      ctx.options.targetWidth,
      config && theme ? { config, theme } : undefined,
    )
  },
} satisfies BuiltinRenderHooks

const PIE_RENDER_HOOKS = {
  normalizeRequest: ctx => ({
    familyConfig: { visual: resolvePieVisualConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => layoutResult(layoutPieChart(
    parsePieChart(ctx.source.familyLines),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolvePieVisualConfig> } | undefined)?.visual
      ?? resolvePieVisualConfig(),
    ctx.styleFace,
  )),
  projectPositioned: positionedView(projectPiePositioned),
  lowerScene: scene(lowerPieScene),
  renderAscii: ctx => renderPieAscii(
    ctx.source.familyLines,
    ctx.config,
    ctx.colorMode,
    ctx.theme,
    {},
    ctx.options.targetWidth,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolvePieVisualConfig> } | undefined)?.visual,
    ctx.styleFace,
  ),
} satisfies BuiltinRenderHooks

const QUADRANT_RENDER_HOOKS = {
  normalizeRequest: ctx => ({
    familyConfig: { visual: resolveQuadrantVisualConfig(ctx.source.frontmatter) },
  }),
  // The wired quadrantChart config section (chart size, fonts, point radius,
  // border widths, useMaxWidth) resolves from frontmatter/init directives and
  // rides on the positioned chart so layout and renderer read the SAME values.
  layout: ctx => layoutResult(layoutQuadrantChart(
    withAccessibilityObject(parseQuadrantChart(ctx.source.familyLines), ctx.source.accessibility),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolveQuadrantVisualConfig> } | undefined)?.visual
      ?? resolveQuadrantVisualConfig(),
    ctx.styleFace,
  )),
  projectPositioned: positionedView(projectQuadrantPositioned),
  lowerScene: scene(lowerQuadrantScene),
  renderAscii: ctx => renderQuadrantAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth),
} satisfies BuiltinRenderHooks

const RADAR_RENDER_HOOKS = {
  // The wired radar config section (frame size, margins, axisScaleFactor,
  // axisLabelFactor, curveTension, tickLabels, safe radar theme variables, and
  // cScale overrides) resolves from frontmatter/init directives once and rides
  // on the positioned chart so layout and renderer read the SAME values.
  normalizeRequest: ctx => ({
    familyConfig: { visual: resolveRadarVisualConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => layoutResult(layoutRadarChart(
    parseRadarChart(ctx.source.lines, {
      title: typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined,
    }),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolveRadarVisualConfig> } | undefined)?.visual
      ?? resolveRadarVisualConfig(ctx.source.frontmatter),
    ctx.styleFace,
  ), { injectAccessibility: false }),
  projectPositioned: positionedView(projectRadarPositioned),
  lowerScene: scene(lowerRadarScene),
  renderAscii: ctx => renderRadarAscii(ctx.source.lines, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, ctx.options.targetWidth, ctx.styleFace),
} satisfies BuiltinRenderHooks

const GANTT_RENDER_HOOKS = {
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
  projectPositioned: positionedView(projectGanttPositioned),
  lowerScene: scene(lowerGanttScene),
  renderAscii: ctx => renderGanttAscii(ctx.source.familyLines, ctx.config, ctx.colorMode, ctx.theme, undefined, {
    maxWidth: ctx.options.maxWidth,
    today: ctx.options.ganttToday,
    resolvedConfig: (ctx.familyConfig as {
      config?: ReturnType<typeof resolveGanttFrontmatterConfig>
    } | undefined)?.config,
    styleFace: ctx.styleFace,
  }),
} satisfies BuiltinRenderHooks

const MINDMAP_RENDER_HOOKS = {
  normalizeRequest: ctx => ({
    familyConfig: {
      position: resolveMindmapPositionConfig(ctx.source.config.mindmap, ctx.source.config.layout),
    },
  }),
  layout: ctx => layoutResult(positionMindmap(
    withAccessibilityFields(parseMindmap(ctx.source.familyBody), ctx.source.accessibility),
    (ctx.familyConfig as { position?: ReturnType<typeof resolveMindmapPositionConfig> } | undefined)?.position
      ?? resolveMindmapPositionConfig(undefined, undefined),
  ), { injectAccessibility: false }),
  projectPositioned: positionedView(projectMindmapPositioned),
  lowerScene: scene(lowerMindmapScene),
  renderAscii: ctx => renderMindmapAscii(parseMindmap(ctx.source.familyBody), ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth),
} satisfies BuiltinRenderHooks

const GITGRAPH_RENDER_HOOKS = {
  normalizeRequest: ctx => ({
    familyConfig: {
      position: resolveGitGraphPositionConfig(ctx.source.config.gitGraph, ctx.source.config.themeVariables),
      ...(typeof ctx.source.frontmatter.title === 'string' ? { title: ctx.source.frontmatter.title } : {}),
    },
    appearance: {
      family: {
        themeVariables: resolveGitGraphThemeProjection(ctx.source.config.themeVariables),
      },
    },
  }),
  layout: ctx => {
    const familyConfig = ctx.familyConfig as {
      position: ReturnType<typeof resolveGitGraphPositionConfig>
      title?: string
    } | undefined
    const config = familyConfig?.position ?? resolveGitGraphPositionConfig(undefined)
    const diagram = withAccessibilityFields(parseGitGraph(ctx.source.familyBody, {
      mainBranchName: config.mainBranchName,
      mainBranchOrder: config.mainBranchOrder,
      title: familyConfig?.title,
    }), ctx.source.accessibility)
    return layoutResult(positionGitGraph(diagram, config), { injectAccessibility: false })
  },
  projectPositioned: positionedView(projectGitGraphPositioned),
  lowerScene: scene(lowerGitGraphScene),
  renderAscii: ctx => {
    const familyConfig = ctx.familyConfig as {
      position?: ReturnType<typeof resolveGitGraphPositionConfig>
      title?: string
    } | undefined
    return renderGitGraphAscii(parseGitGraph(ctx.source.familyBody, {
      mainBranchName: familyConfig?.position?.mainBranchName,
      mainBranchOrder: familyConfig?.position?.mainBranchOrder,
      title: familyConfig?.title,
    }), ctx.config, ctx.colorMode, ctx.theme, ctx.options.targetWidth,
    (ctx.familyAppearance as { themeVariables?: Record<string, unknown> } | undefined)?.themeVariables)
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
  gantt: GANTT_RENDER_HOOKS,
  mindmap: MINDMAP_RENDER_HOOKS,
  gitgraph: GITGRAPH_RENDER_HOOKS,
}) satisfies Readonly<Record<DiagramKind, BuiltinRenderHooks>>
