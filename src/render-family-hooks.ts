import './agent/families-builtin.ts'
import { getFamily, registerFamily, knownFamilies } from './agent/families.ts'
import type { AsciiContext, FamilyLayoutContext, FamilyLayoutResult, FamilyPlugin } from './agent/families.ts'
import type { DiagramKind } from './agent/types.ts'
import type { PositionedDiagram, RenderContext } from './types.ts'
import type { DiagramColors } from './theme.ts'

import { parseMermaid } from './parser.ts'
import { layoutGraphSync } from './layout-engine.ts'
import { renderSvg, lowerGraphScene } from './renderer.ts'
import type { SceneDoc } from './scene/ir.ts'

import { parseSequenceDiagram } from './sequence/parser.ts'
import { layoutSequenceDiagram } from './sequence/layout.ts'
import { renderSequenceSvg } from './sequence/renderer.ts'
import { parseClassDiagram } from './class/parser.ts'
import { layoutClassDiagram } from './class/layout.ts'
import { renderClassSvg } from './class/renderer.ts'
import { parseErDiagram } from './er/parser.ts'
import { layoutErDiagram } from './er/layout.ts'
import { renderErSvg } from './er/renderer.ts'
import { parseTimelineDiagram } from './timeline/parser.ts'
import { layoutTimelineDiagram } from './timeline/layout.ts'
import { renderTimelineSvg } from './timeline/renderer.ts'
import { parseJourneyDiagram } from './journey/parser.ts'
import { layoutJourneyDiagram } from './journey/layout.ts'
import { renderJourneySvg } from './journey/renderer.ts'
import { applyXYChartFrontmatterConfig, parseXYChart } from './xychart/parser.ts'
import { layoutXYChart } from './xychart/layout.ts'
import { renderXYChartSvg } from './xychart/renderer.ts'
import { parsePieChart } from './pie/parser.ts'
import { layoutPieChart } from './pie/layout.ts'
import { renderPieSvg } from './pie/renderer.ts'
import { parseQuadrantChart } from './quadrant/parser.ts'
import { layoutQuadrantChart } from './quadrant/layout.ts'
import { renderQuadrantSvg } from './quadrant/renderer.ts'
import { buildGanttRenderPipeline } from './gantt/pipeline.ts'
import { renderGanttSvg } from './gantt/renderer.ts'
import { parseArchitectureDiagram } from './architecture/parser.ts'
import { layoutArchitectureDiagram } from './architecture/layout.ts'
import { renderArchitectureSvg } from './architecture/renderer.ts'
import { resolveArchitectureVisualConfig } from './architecture/config.ts'

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
  const archOptions = archVisual.padding != null
    ? { ...ctx.options, padding: ctx.options.padding ?? archVisual.padding }
    : ctx.options
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
  layout: layoutFlowchart,
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
  renderAscii: renderArchitectureAsciiWithContext,
})

registerRenderHooks('sequence', {
  layout: ctx => layoutResult(layoutSequenceDiagram(parseSequenceDiagram(ctx.source.lines), ctx.options)),
  renderSvg: svg(renderSequenceSvg),
  renderAscii: ctx => renderSequenceAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme),
})

registerRenderHooks('class', {
  layout: ctx => layoutResult(layoutClassDiagram(parseClassDiagram(ctx.source.lines), ctx.options)),
  renderSvg: svg(renderClassSvg),
  renderAscii: ctx => renderClassAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme),
})

registerRenderHooks('er', {
  layout: ctx => layoutResult(layoutErDiagram(parseErDiagram(ctx.source.lines), ctx.options)),
  renderSvg: svg(renderErSvg),
  renderAscii: ctx => renderErAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme),
})

registerRenderHooks('timeline', {
  layout: ctx => layoutResult(layoutTimelineDiagram(parseTimelineDiagram(ctx.source.lines), ctx.options)),
  renderSvg: svg(renderTimelineSvg),
  renderAscii: ctx => renderTimelineAscii(ctx.source.lines, ctx.config, ctx.colorMode, ctx.theme),
})

registerRenderHooks('journey', {
  layout: ctx => layoutResult(layoutJourneyDiagram(parseJourneyDiagram(ctx.source.lines), ctx.options)),
  renderSvg: svg(renderJourneySvg),
  renderAscii: ctx => renderJourneyAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme),
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
  renderAscii: ctx => renderXYChartAscii(ctx.source.text, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter),
})

registerRenderHooks('pie', {
  layout: ctx => layoutResult(layoutPieChart(parsePieChart(ctx.source.lines), ctx.options)),
  renderSvg: svg(renderPieSvg),
  renderAscii: ctx => renderPieAscii(ctx.source.lines, ctx.config, ctx.colorMode, ctx.theme),
})

registerRenderHooks('quadrant', {
  layout: ctx => layoutResult(layoutQuadrantChart(parseQuadrantChart(ctx.source.lines), ctx.options)),
  renderSvg: svg(renderQuadrantSvg),
  renderAscii: ctx => renderQuadrantAscii(ctx.source.lines, ctx.config, ctx.colorMode, ctx.theme),
})

registerRenderHooks('gantt', {
  layout: ctx => {
    const pipeline = buildGanttRenderPipeline(ctx.source.lines, ctx.source.frontmatter, {
      clock: { today: ctx.options.ganttToday },
    })
    return layoutResult(pipeline.positioned)
  },
  renderSvg: svg(renderGanttSvg),
  renderAscii: ctx => renderGanttAscii(ctx.source.lines, ctx.config, ctx.colorMode, ctx.theme, ctx.source.frontmatter, {
    maxWidth: ctx.options.maxWidth,
    today: ctx.options.ganttToday,
  }),
})

export { getFamily, knownFamilies }
