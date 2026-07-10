import './agent/families-builtin.ts'
import { getFamily, registerFamily, knownFamilies } from './agent/families.ts'
import type { AsciiContext, FamilyLayoutContext, FamilyLayoutResult, FamilyPlugin } from './agent/families.ts'
import type { DiagramKind } from './agent/types.ts'
import type { PositionedDiagram, RenderContext } from './types.ts'
import type { DiagramColors } from './theme.ts'

import { parseMermaid } from './parser.ts'
import { layoutGraphSync } from './layout-engine.ts'
import { resolveFlowchartRenderOptions, applyFlowchartLabelWrapping } from './flowchart-config.ts'
import { renderSvg, lowerGraphScene } from './renderer.ts'
import type { SceneDoc } from './scene/ir.ts'

import { parseSequenceDiagram } from './sequence/parser.ts'
import { layoutSequenceDiagram } from './sequence/layout.ts'
import { resolveSequenceConfig } from './sequence/config.ts'
import { renderSequenceSvg, lowerSequenceScene } from './sequence/renderer.ts'
import { parseClassDiagram } from './class/parser.ts'
import { layoutClassDiagram, resolveClassRenderOptions } from './class/layout.ts'
import { renderClassSvg, lowerClassScene } from './class/renderer.ts'
import { parseErDiagram } from './er/parser.ts'
import { layoutErDiagram, applyErFrontmatterConfig } from './er/layout.ts'
import { renderErSvg, lowerErScene } from './er/renderer.ts'
import { parseTimelineDiagram } from './timeline/parser.ts'
import { layoutTimelineDiagram } from './timeline/layout.ts'
import { renderTimelineSvg, lowerTimelineScene } from './timeline/renderer.ts'
import { parseJourneyDiagram } from './journey/parser.ts'
import { layoutJourneyDiagram } from './journey/layout.ts'
import { renderJourneySvg, lowerJourneyScene } from './journey/renderer.ts'
import { applyXYChartFrontmatterConfig, parseXYChart } from './xychart/parser.ts'
import { layoutXYChart } from './xychart/layout.ts'
import { renderXYChartSvg, lowerXYChartScene } from './xychart/renderer.ts'
import { parsePieChart } from './pie/parser.ts'
import { layoutPieChart } from './pie/layout.ts'
import { resolvePieVisualConfig } from './pie/config.ts'
import { renderPieSvg, lowerPieScene } from './pie/renderer.ts'
import { parseQuadrantChart } from './quadrant/parser.ts'
import { layoutQuadrantChart } from './quadrant/layout.ts'
import { resolveQuadrantVisualConfig } from './quadrant/config.ts'
import { renderQuadrantSvg, lowerQuadrantScene } from './quadrant/renderer.ts'
import { buildGanttRenderPipeline } from './gantt/pipeline.ts'
import { renderGanttSvg, lowerGanttScene } from './gantt/renderer.ts'
import { parseArchitectureDiagram } from './architecture/parser.ts'
import { layoutArchitectureDiagram } from './architecture/layout.ts'
import { renderArchitectureSvg, lowerArchitectureScene } from './architecture/renderer.ts'
import { resolveArchitectureVisualConfig, resolveArchitectureRenderOptions } from './architecture/config.ts'

import { convertToAsciiGraph } from './ascii/converter.ts'
import { createMapping } from './ascii/grid.ts'
import { drawGraph } from './ascii/draw.ts'
import { canvasToString, flipCanvasVertically, flipRoleCanvasVertically } from './ascii/canvas.ts'
import { renderSequenceAscii } from './ascii/sequence.ts'
import { renderClassAscii } from './ascii/class-diagram.ts'
import { renderErAscii } from './ascii/er-diagram.ts'
import { renderTimelineAscii } from './ascii/timeline.ts'
import { renderGanttAscii } from './ascii/gantt.ts'
import { renderJourneyAscii } from './ascii/journey.ts'
import { renderXYChartAscii } from './ascii/xychart.ts'
import { renderPieAscii } from './ascii/pie.ts'
import { renderQuadrantAscii } from './ascii/quadrant.ts'
import { renderArchitectureAscii } from './ascii/architecture.ts'
import { diagramColorsToAsciiTheme } from './ascii/ansi.ts'

type SvgRenderer<TPositioned extends PositionedDiagram> = (ctx: RenderContext<TPositioned>) => string
type SceneLowerer<TPositioned extends PositionedDiagram> = (ctx: RenderContext<TPositioned>) => SceneDoc

function svg<TPositioned extends PositionedDiagram>(renderer: SvgRenderer<TPositioned>): FamilyPlugin['renderSvg'] {
  return (ctx) => renderer(ctx as RenderContext<TPositioned>)
}

function scene<TPositioned extends PositionedDiagram>(lowerer: SceneLowerer<TPositioned>): FamilyPlugin['lowerScene'] {
  return (ctx) => lowerer(ctx as RenderContext<TPositioned>)
}

function layoutResult<TPositioned extends PositionedDiagram>(
  positioned: TPositioned,
  extra: Omit<FamilyLayoutResult<TPositioned>, 'positioned'> = {},
): FamilyLayoutResult<TPositioned> {
  return { positioned, ...extra }
}

function registerRenderHooks(
  id: DiagramKind,
  hooks: Pick<FamilyPlugin, 'layout' | 'renderSvg' | 'renderAscii' | 'lowerScene'>,
): void {
  const base = getFamily(id)
  if (!base) throw new Error(`Cannot register render hooks for unknown family ${id}`)
  registerFamily({ ...base, ...hooks })
}

function layoutFlowchart(ctx: FamilyLayoutContext): FamilyLayoutResult {
  return layoutResult(layoutGraphSync(parseMermaid(ctx.source.text), ctx.options))
}

// Flowchart proper (not state) additionally wires the typed `flowchart`
// frontmatter config section (nodeSpacing/rankSpacing/wrappingWidth —
// explicit RenderOptions win; unwired keys are named by verify's
// INEFFECTIVE_CONFIG lint) and applies measured-width label wrapping before
// ELK sizing so layout, renderer, and SVG see the same lines.
function layoutFlowchartWithConfig(ctx: FamilyLayoutContext): FamilyLayoutResult {
  const options = resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.options)
  const graph = parseMermaid(ctx.source.text)
  applyFlowchartLabelWrapping(graph, options)
  return layoutResult(layoutGraphSync(graph, options))
}

function renderFlowchartAscii(ctx: AsciiContext): string {
  const parsed = parseMermaid(ctx.source.text)
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

function layoutArchitecture(ctx: FamilyLayoutContext): FamilyLayoutResult {
  const archVisual = resolveArchitectureVisualConfig(ctx.source.frontmatter, ctx.colors, ctx.options)
  // Wire-or-warn (X7): fold the wired architecture.* keys (padding,
  // nodeSeparation, idealEdgeLengthMultiplier) into RenderOptions — explicit
  // RenderOptions win. The unwired fcose keys are named by verify's
  // INEFFECTIVE_CONFIG lint (src/architecture/config.ts).
  const archOptions = resolveArchitectureRenderOptions(ctx.source.frontmatter, ctx.options)
  const diagram = parseArchitectureDiagram(ctx.source.lines)
  return layoutResult(layoutArchitectureDiagram(diagram, archOptions, archVisual.layout), {
    options: {
      ...ctx.renderOptions,
      architecture: { ...ctx.renderOptions.architecture, visual: archVisual.visual },
    },
    injectAccessibility: false,
  })
}

function renderArchitectureAsciiWithContext(ctx: AsciiContext): string {
  const vars = ctx.source.config.themeVariables
  const archColors: DiagramColors = {
    bg: (vars?.background as string) ?? '#ffffff',
    fg: (vars?.primaryTextColor as string) ?? (vars?.textColor as string) ?? '#27272A',
    line: vars?.lineColor as string | undefined,
    accent: vars?.primaryColor as string | undefined,
  }
  const archTheme = { ...ctx.theme, ...diagramColorsToAsciiTheme(archColors) }
  return renderArchitectureAscii(ctx.source.lines, ctx.config, ctx.colorMode, archTheme)
}

registerRenderHooks('flowchart', {
  layout: layoutFlowchartWithConfig,
  renderSvg: svg(renderSvg),
  lowerScene: scene(lowerGraphScene),
  renderAscii: renderFlowchartAscii,
})

registerRenderHooks('state', {
  layout: layoutFlowchart,
  renderSvg: svg(renderSvg),
  lowerScene: scene(lowerGraphScene),
  renderAscii: renderFlowchartAscii,
})

registerRenderHooks('architecture', {
  layout: layoutArchitecture,
  renderSvg: svg(renderArchitectureSvg),
  lowerScene: scene(lowerArchitectureScene),
  renderAscii: renderArchitectureAsciiWithContext,
})

registerRenderHooks('sequence', {
  // Wire-or-warn config threading (src/sequence/config.ts): the typed
  // `sequence` frontmatter/init section's wired keys reach the parser
  // (showSequenceNumbers) and layout (margins/sizes); unwired keys are named
  // by verify's INEFFECTIVE_CONFIG lint. Absent config resolves to {} and
  // keeps default geometry byte-identical.
  layout: ctx => {
    const seqConfig = resolveSequenceConfig(ctx.source.frontmatter)
    return layoutResult(layoutSequenceDiagram(parseSequenceDiagram(ctx.source.lines, seqConfig), ctx.options, seqConfig))
  },
  renderSvg: svg(renderSequenceSvg),
  lowerScene: scene(lowerSequenceScene),
  renderAscii: ctx => renderSequenceAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme, resolveSequenceConfig(ctx.source.frontmatter)),
})

registerRenderHooks('class', {
  // Wire-or-warn config threading: the typed `class` frontmatter section's
  // nodeSpacing/rankSpacing fold into RenderOptions (explicit options win).
  layout: ctx => layoutResult(layoutClassDiagram(
    parseClassDiagram(ctx.source.lines),
    resolveClassRenderOptions(ctx.source.frontmatter, ctx.options),
  )),
  renderSvg: svg(renderClassSvg),
  lowerScene: scene(lowerClassScene),
  renderAscii: ctx => renderClassAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme),
})

registerRenderHooks('er', {
  // Wire-or-warn config threading: er.layoutDirection + nodeSpacing/
  // rankSpacing fold into the parsed diagram/options (statement + explicit
  // options win over frontmatter).
  layout: ctx => {
    const configured = applyErFrontmatterConfig(parseErDiagram(ctx.source.lines), ctx.source.frontmatter, ctx.options)
    return layoutResult(layoutErDiagram(configured.diagram, configured.options))
  },
  renderSvg: svg(renderErSvg),
  lowerScene: scene(lowerErScene),
  renderAscii: ctx => renderErAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme),
})

registerRenderHooks('timeline', {
  layout: ctx => layoutResult(layoutTimelineDiagram(parseTimelineDiagram(ctx.source.lines), ctx.options)),
  renderSvg: svg(renderTimelineSvg),
  lowerScene: scene(lowerTimelineScene),
  renderAscii: ctx => renderTimelineAscii(ctx.source.lines, ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth),
})

registerRenderHooks('journey', {
  layout: ctx => layoutResult(layoutJourneyDiagram(parseJourneyDiagram(ctx.source.lines), ctx.renderOptions)),
  renderSvg: svg(renderJourneySvg),
  lowerScene: scene(lowerJourneyScene),
  renderAscii: ctx => renderJourneyAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme, ctx.options.maxWidth),
})

registerRenderHooks('xychart', {
  layout: ctx => {
    const chart = applyXYChartFrontmatterConfig(parseXYChart(ctx.source.lines), ctx.source.frontmatter)
    const positioned = layoutXYChart(chart, ctx.options)
    const colors = !ctx.options.bg && chart.theme.backgroundColor
      ? { ...ctx.colors, bg: chart.theme.backgroundColor }
      : ctx.colors
    return layoutResult(positioned, { colors, injectAccessibility: false })
  },
  renderSvg: svg(renderXYChartSvg),
  lowerScene: scene(lowerXYChartScene),
  renderAscii: ctx => renderXYChartAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter),
})

registerRenderHooks('pie', {
  layout: ctx => layoutResult(layoutPieChart(
    parsePieChart(ctx.source.lines),
    ctx.options,
    resolvePieVisualConfig(ctx.source.frontmatter),
  )),
  renderSvg: svg(renderPieSvg),
  lowerScene: scene(lowerPieScene),
  renderAscii: ctx => renderPieAscii(ctx.source.lines, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter),
})

registerRenderHooks('quadrant', {
  // The wired quadrantChart config section (chart size, fonts, point radius,
  // border widths, useMaxWidth) resolves from frontmatter/init directives and
  // rides on the positioned chart so layout and renderer read the SAME values.
  layout: ctx => layoutResult(layoutQuadrantChart(
    parseQuadrantChart(ctx.source.lines),
    ctx.options,
    resolveQuadrantVisualConfig(ctx.source.frontmatter),
  )),
  renderSvg: svg(renderQuadrantSvg),
  lowerScene: scene(lowerQuadrantScene),
  renderAscii: ctx => renderQuadrantAscii(ctx.source.lines, ctx.config, ctx.colorMode, ctx.theme),
})

registerRenderHooks('gantt', {
  layout: ctx => {
    const pipeline = buildGanttRenderPipeline(ctx.source.lines, ctx.source.frontmatter, {
      clock: { today: ctx.options.ganttToday },
      layout: { renderOptions: ctx.options },
    })
    return layoutResult(pipeline.positioned)
  },
  renderSvg: svg(renderGanttSvg),
  lowerScene: scene(lowerGanttScene),
  renderAscii: ctx => renderGanttAscii(ctx.source.lines, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, {
    maxWidth: ctx.options.maxWidth,
    today: ctx.options.ganttToday,
  }),
})

export { getFamily, knownFamilies }
