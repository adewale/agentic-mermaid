import { layoutTooltip } from '../shared/tooltip-layout.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import type {
  AxisTick,
  GridLine,
  LegendItem,
  PlotArea,
  PositionedBar,
  PositionedDataLabel,
  PositionedLine,
  PositionedXYChart,
  ResolvedXYAxisRenderConfig,
  ResolvedXYChartConfig,
  XYChart,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { resolveXYChartRenderConfig } from './config.ts'
import { barBaselineValue, clampToAxisRange, formatBarValue, formatTickValue, getCategoryLabels, getDataCount, getDataXValues, getPointSpacing, linearTicks } from './axis-utils.ts'
import { legendEntries } from './legend.ts'

// ============================================================================
// XY Chart layout engine
//
// Layout is intentionally closer to Mermaid's own xychart builder:
// total width/height are the chart box, plot space is reserved inside that box,
// and axis/title elements compete for the reserved margin space.
// ============================================================================

const BAR_PADDING_PERCENT = 0.05
// X-axis labels use dy="0.35em" to optically center the glyphs. Reserve that
// shift plus a conservative 0.25em descent inside the fixed chart viewport.
const BOTTOM_LABEL_RENDERED_ALLOWANCE_EM = 0.6

/** Legend swatch geometry, shared with the renderer and pinned by tests. */
export const XY_DOT_RADIUS = 4
export const LEGEND_SWATCH_SIZE = 12
export const LEGEND_SWATCH_GAP = 6

/** Shared by layout (sizing) and renderer (drawing) — keep it single-sourced. */
export const XY_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: 14,
  edgeLabelFontSize: 16,
  groupHeaderFontSize: 20,
  nodeLabelFontWeight: 400,
  edgeLabelFontWeight: 400,
  groupHeaderFontWeight: 500,
  nodePaddingX: 0,
  nodePaddingY: 0,
  nodeLineWidth: 0,
  edgeLineWidth: 3, // matches the drawn series stroke (CHART_FONT.lineWidth)
  groupCornerRadius: 0,
  groupPaddingX: 0,
  groupPaddingY: 0,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

/** Measures chart text the way the renderer draws it — the style's case
 * transform, weight and letter spacing for each kind of text — so a styled
 * chart reserves room for the text it actually draws. */
interface XYTextMeasure {
  wrapTitle(title: string, fontSize: number, width: number): PixelTextBlock
  block(role: 'tick' | 'legend' | 'axisTitle' | 'data', source: string, fontSize: number, maxWidth?: number): PixelTextBlock
  /** Axis tick labels: categories and values. */
  tick(label: string, fontSize: number): number
  legend(label: string, fontSize: number): number
}

function xyTextMeasure(style: ResolvedRenderStyle): XYTextMeasure {
  const cache = new Map<string, PixelTextBlock>()
  const block = (role: 'tick' | 'legend' | 'axisTitle' | 'data', source: string, fontSize: number, maxWidth?: number): PixelTextBlock => {
    const key = JSON.stringify([role, source, fontSize, maxWidth])
    let prepared = cache.get(key)
    if (!prepared) {
      const edge = role === 'axisTitle'
      prepared = preparePixelText(source, { display: 'literal', fontSize, fontWeight: edge ? style.edgeLabelFontWeight : style.nodeLabelFontWeight, letterSpacing: edge ? style.edgeLetterSpacing : style.nodeLetterSpacing, transform: role === 'axisTitle' || role === 'tick' ? style.edgeTextTransform : style.nodeTextTransform, maxWidth })
      cache.set(key, prepared)
    }
    return prepared
  }
  return {
    block,
    wrapTitle: (title, fontSize, maxWidth) => preparePixelText(title, { display: 'literal', transform: style.groupTextTransform, fontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing, maxWidth }),
    tick: (label, fontSize) => block('tick', label, fontSize).width,
    legend: (label, fontSize) => block('legend', label, fontSize).width,
  }
}

export function layoutXYChart(
  chart: XYChart,
  options: RenderOptions = {},
  styleFace?: Readonly<InternalStyleFace>,
): PositionedXYChart {
  const style = resolveRenderStyle(options, XY_STYLE_DEFAULTS, styleFace)
  const config = resolveXYChartRenderConfig(chart.config)
  const face = styleFace
  if (face?.group?.fontSize != null || face?.text?.fontSize != null) {
    config.titleFontSize = style.groupHeaderFontSize
  }
  if (face?.node?.fontSize != null || face?.text?.fontSize != null) {
    config.xAxis.labelFontSize = style.nodeLabelFontSize
    config.yAxis.labelFontSize = style.nodeLabelFontSize
  }
  if (face?.edge?.fontSize != null || face?.text?.fontSize != null) {
    config.xAxis.titleFontSize = style.edgeLabelFontSize
    config.yAxis.titleFontSize = style.edgeLabelFontSize
  }
  if (face?.edge?.lineWidth != null) {
    config.xAxis.axisLineWidth = style.lineWidth
    config.yAxis.axisLineWidth = style.lineWidth
    config.xAxis.tickWidth = style.lineWidth
    config.yAxis.tickWidth = style.lineWidth
  }
  const measure = xyTextMeasure(style)
  // How far a line series' ink reaches past its points: half its stroke, or a
  // drawn dot (its radius and half its 2px ring), as the renderer paints them.
  let lineIndex = 0
  const lineReach = Math.max(0, ...chart.series.flatMap(series => {
    if (series.type !== 'line') return []
    const width = resolveRoleStyle(styleFace, 'series', { category: `line-${lineIndex++}` }, { includeFallback: false })?.lineWidth ?? style.lineWidth
    const dots = options.interactive || series.pointLabels?.some(label => label !== undefined)
    return [Math.max(width / 2, dots ? XY_DOT_RADIUS + 1 : 0)]
  }))
  const positioned = chart.horizontal ? layoutHorizontal(chart, config, measure, lineReach) : layoutVertical(chart, config, measure, lineReach)
  for (const axis of [positioned.xAxis, positioned.yAxis]) {
    if (axis.title) {
      const block = axis.title.block ??= measure.block('axisTitle', axis.title.text, axis.config.titleFontSize)
      // Lines are centered on the anchor, so authored line breaks move it into
      // the room the axis reserved for them, away from the canvas edge. So does
      // a line box taller than the nominal one (accents, stacked marks,
      // joining scripts), which the axis reserved too.
      const shift = (block.lines.length - 1) * block.lineHeight / 2 + (block.lineHeight - axis.config.titleFontSize * LINE_HEIGHT_RATIO) / 2
      if (axis.title.rotate) axis.title.x += shift
      else axis.title.y += chart.horizontal ? shift : -shift
    }
    for (const tick of axis.ticks) {
      const block = tick.block = measure.block('tick', tick.label, axis.config.labelFontSize)
      const left = tick.textAnchor === 'start' ? 0 : tick.textAnchor === 'end' ? block.width : block.width / 2
      tick.labelX = Math.max(left, Math.min(positioned.width - block.width + left, tick.labelX))
      tick.labelY = Math.max(block.height / 2, Math.min(positioned.height - block.height / 2, tick.labelY))
    }
  }
  for (const item of positioned.legend) item.block = measure.block('legend', item.label, positioned.config.legendFontSize)
  for (const label of positioned.dataLabels) label.block = measure.block('data', label.text, label.fontSize)
  for (const line of positioned.lines) for (const point of line.points) {
    if (point.textLabel !== undefined) {
      const block = point.textBlock = measure.block('data', point.textLabel, 12, Math.max(1, positioned.width - 8))
      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
      if (positioned.horizontal) {
        const right = point.x + 8 + block.width <= positioned.width - 4
        const anchor = right ? 'start' : 'end'
        point.textPosition = {
          x: right ? clamp(point.x + 8, 4, positioned.width - 4 - block.width) : clamp(point.x - 8, block.width + 4, positioned.width - 4),
          y: clamp(point.y, block.height / 2, positioned.height - block.height / 2),
          anchor, placement: right ? 'right' : 'left',
        }
      } else {
        const above = point.y - 8 - block.height >= positioned.plotArea.y
        point.textPosition = {
          x: clamp(point.x, block.width / 2, positioned.width - block.width / 2),
          y: clamp(point.y + (above ? -1 : 1) * (8 + block.height / 2), block.height / 2, positioned.height - block.height / 2),
          anchor: 'middle', placement: above ? 'above' : 'below',
        }
      }
    }
  }
  {
    for (const bar of positioned.bars) bar.tooltip = layoutTooltip(positioned.horizontal ? bar.x + bar.width : bar.x + bar.width / 2, positioned.horizontal ? bar.y + bar.height / 2 : bar.y, formatBarValue(bar.value))
    for (const line of positioned.lines) for (const point of line.points) point.tooltip = layoutTooltip(point.x, point.y - XY_DOT_RADIUS, formatBarValue(point.value))
  }
  return positioned
}

/** Width of the grid lines the renderer draws at each value tick. */
const GRID_LINE_WIDTH = 1

/**
 * How far marks centered on a plot edge can reach beyond it, along each axis,
 * so a plot that meets the canvas edge leaves that ink on the canvas. A value
 * tick's grid line and tick, and a line series' points (each clamped into the
 * range), sit anywhere up to the plot's value ends; a linear position axis
 * places ticks and points up to its ends. A grid or tick line draws half its
 * width past them; a line series its reach.
 */
function plotEdgeInk(
  chart: XYChart,
  lineReach: number,
  valueAxis: ResolvedXYAxisRenderConfig,
  linearPositionAxis?: ResolvedXYAxisRenderConfig,
): { value: number; position: number } {
  const lines = chart.series.some(series => series.type === 'line') ? lineReach : 0
  const tick = (axis: ResolvedXYAxisRenderConfig): number => axis.showLabel && axis.showTick ? axis.tickWidth / 2 : 0
  return {
    value: Math.max(GRID_LINE_WIDTH / 2, tick(valueAxis), lines),
    position: linearPositionAxis ? Math.max(tick(linearPositionAxis), lines) : 0,
  }
}

/** Half an axis line, which runs along the plot edge it is drawn on. */
function axisLineInk(axis: ResolvedXYAxisRenderConfig): number {
  return axis.showAxisLine ? axis.axisLineWidth / 2 : 0
}

function layoutVertical(chart: XYChart, config: ResolvedXYChartConfig, measure: XYTextMeasure, lineReach: number): PositionedXYChart {
  const totalW = config.width
  const totalH = config.height
  const dataCount = getDataCount(chart)
  const categoryLabels = getCategoryLabels(chart, dataCount)
  const dataXValues = getDataXValues(chart, dataCount)
  const yRange = chart.yAxis.range!
  const yTickValues = linearTicks(yRange.min, yRange.max)
  const yTickLabels = yTickValues.map(formatTickValue)
  const xTickValues = chart.xAxis.range ? linearTicks(chart.xAxis.range.min, chart.xAxis.range.max) : undefined
  const xTickLabels = xTickValues?.map(formatTickValue) ?? categoryLabels

  let remainingTopBottomBudget = Math.max(0, totalH - Math.floor(totalH * config.plotReservedSpacePercent / 100))
  let remainingLeftBudget = Math.max(0, totalW - Math.floor(totalW * config.plotReservedSpacePercent / 100))

  const title = fitChartTitle(chart.title, config, remainingTopBottomBudget, measure)
  const titleHeight = title.height
  remainingTopBottomBudget = Math.max(0, remainingTopBottomBudget - titleHeight)

  const xAxisConfig = fitHorizontalAxisConfig(config.xAxis, chart.xAxis.title, xTickLabels, remainingTopBottomBudget, measure)
  remainingTopBottomBudget = Math.max(0, remainingTopBottomBudget - xAxisConfig.size)

  const yAxisConfig = fitVerticalAxisConfig(config.yAxis, chart.yAxis.title, yTickLabels, remainingLeftBudget, measure, totalH)
  remainingLeftBudget = Math.max(0, remainingLeftBudget - yAxisConfig.size)

  // Value-axis labels are centered on their ticks, so the end ticks' labels
  // reach half a line beyond the plot. Reserve that where no title or x-axis
  // band already does, so an untitled chart keeps its top label on canvas.
  const valueLabelOverhang = yAxisConfig.config.showLabel && yTickLabels.length > 0 ? config.yAxis.labelFontSize / 2 : 0
  // Marks centered on a plot edge draw past it; keep that ink on the canvas.
  const ink = plotEdgeInk(chart, lineReach, yAxisConfig.config, chart.xAxis.range ? xAxisConfig.config : undefined)
  const plotTop = Math.max(titleHeight, valueLabelOverhang, ink.value)
  const plotHeight = Math.max(0, totalH - plotTop - Math.max(xAxisConfig.size, valueLabelOverhang, ink.value, axisLineInk(xAxisConfig.config)))
  const legend = fitLegend(chart, config, remainingLeftBudget, totalW, plotTop, plotHeight, measure)

  const plotX = Math.max(yAxisConfig.size, ink.position, axisLineInk(yAxisConfig.config))
  const plotArea: PlotArea = {
    x: plotX,
    y: plotTop,
    width: Math.max(0, totalW - plotX - Math.max(legend.size, ink.position)),
    height: plotHeight,
  }

  // A bar is a band around its point. On a numeric x-axis Mermaid insets the
  // axis by half a band at each end when the chart has bars, so the end bars
  // stay on the plot; lines on the same axis share the inset.
  const xInset = chart.xAxis.range && chart.series.some(series => series.type === 'bar') ? plotArea.width / Math.max(1, dataCount) / 2 : 0
  const xScaleValue = chart.xAxis.range
    ? (value: number) => plotArea.x + xInset + ((value - chart.xAxis.range!.min) / (chart.xAxis.range!.max - chart.xAxis.range!.min || 1)) * (plotArea.width - 2 * xInset)
    : undefined
  const xPoint = (index: number) => xScaleValue ? xScaleValue(dataXValues[index]!) : plotArea.x + (index + 0.5) * (plotArea.width / dataCount)
  const xPointSpacing = xScaleValue
    ? getPointSpacing(dataXValues, xScaleValue, plotArea.width / Math.max(2, dataCount))
    : plotArea.width / Math.max(1, dataCount)
  const yScale = (value: number) => plotArea.y + plotArea.height - ((value - yRange.min) / (yRange.max - yRange.min || 1)) * plotArea.height

  const xTicks = !xAxisConfig.config.showLabel
    ? []
    : chart.xAxis.range && xTickValues && xScaleValue
      ? buildBottomAxisTicks(xTickValues, xTickLabels, xScaleValue, plotArea, xAxisConfig.config, measure, totalW)
      : buildBottomAxisTicks(
        categoryLabels.map((_, index) => index),
        categoryLabels,
        xPoint,
        plotArea,
        xAxisConfig.config,
        measure,
        totalW,
      )
  const yTicks = yAxisConfig.config.showLabel
    ? buildLeftAxisTicks(
      yTickValues,
      yTickLabels,
      yScale,
      plotArea,
      yAxisConfig.config,
    )
    : []

  const gridLines: GridLine[] = yTickValues.map(value => ({
    x1: plotArea.x,
    y1: yScale(value),
    x2: plotArea.x + plotArea.width,
    y2: yScale(value),
  }))

  const colorMap = chart.series.map((_, index) => index)
  const bars = layoutBars(chart, xPoint, xPointSpacing, yScale, yRange, categoryLabels, colorMap, false)
  const lines = layoutLines(chart, xPoint, yScale, yRange, categoryLabels, colorMap, false)

  return {
    width: totalW,
    height: totalH,
    accessibility: chart.accessibility,
    title: title.title,
    hiddenTitle: chart.title && config.showTitle && !title.title ? chart.title : undefined,
    xAxis: {
      ticks: xTicks,
      line: buildBottomAxisLine(plotArea, xAxisConfig.config),
      title: buildBottomAxisTitle(chart.xAxis.title, plotArea, totalH, xAxisConfig.config),
      config: xAxisConfig.config,
    },
    yAxis: {
      ticks: yTicks,
      line: buildLeftAxisLine(plotArea, yAxisConfig.config),
      title: buildLeftAxisTitle(chart.yAxis.title, plotArea, yAxisConfig.config, totalH, measure),
      config: yAxisConfig.config,
    },
    plotArea,
    bars,
    lines,
    gridLines,
    legend: legend.items,
    hiddenLegendLabels: legend.hiddenLabels,
    hiddenCategoryLabels: hiddenCategoryLabels(chart, config, xAxisConfig.config, xTicks),
    ...planBarDataLabels(bars, false, plotArea, config, measure),
    config,
    theme: chart.theme,
  }
}

function layoutHorizontal(chart: XYChart, config: ResolvedXYChartConfig, measure: XYTextMeasure, lineReach: number): PositionedXYChart {
  const totalW = config.width
  const totalH = config.height
  const dataCount = getDataCount(chart)
  const categoryLabels = getCategoryLabels(chart, dataCount)
  const yRange = chart.yAxis.range!
  const valueTickValues = linearTicks(yRange.min, yRange.max)
  const valueTickLabels = valueTickValues.map(formatTickValue)

  let remainingTopBottomBudget = Math.max(0, totalH - Math.floor(totalH * config.plotReservedSpacePercent / 100))
  let remainingLeftBudget = Math.max(0, totalW - Math.floor(totalW * config.plotReservedSpacePercent / 100))

  const title = fitChartTitle(chart.title, config, remainingTopBottomBudget, measure)
  const titleHeight = title.height
  remainingTopBottomBudget = Math.max(0, remainingTopBottomBudget - titleHeight)

  // Mermaid places the numeric value axis at the top in horizontal mode.
  const topAxisConfig = fitTopAxisConfig(config.yAxis, chart.yAxis.title, valueTickLabels, remainingTopBottomBudget, measure)
  remainingTopBottomBudget = Math.max(0, remainingTopBottomBudget - topAxisConfig.size)

  const leftAxisConfig = fitVerticalAxisConfig(config.xAxis, chart.xAxis.title, categoryLabels, remainingLeftBudget, measure, totalH)
  remainingLeftBudget = Math.max(0, remainingLeftBudget - leftAxisConfig.size)

  // Marks centered on a plot edge draw past it; keep that ink on the canvas.
  const ink = plotEdgeInk(chart, lineReach, topAxisConfig.config)
  const plotTop = Math.max(titleHeight + topAxisConfig.size, axisLineInk(topAxisConfig.config))
  // Category labels are centered on their rows, so when rows are shorter than
  // a label the last label's descenders reach below the plot, which ends at
  // the canvas edge. Reserve just that difference; roomy rows reserve nothing.
  const available = Math.max(0, totalH - plotTop)
  const rows = Math.max(1, dataCount)
  const categoryDescent = leftAxisConfig.config.showLabel ? config.xAxis.labelFontSize * LABEL_BELOW_MIDDLE_EM : 0
  const bottomReserve = Math.min(available, Math.max(0, (categoryDescent - available / (2 * rows)) / (1 - 1 / (2 * rows))))
  const plotHeight = Math.max(0, available - bottomReserve)
  const legend = fitLegend(chart, config, remainingLeftBudget, totalW, plotTop, plotHeight, measure)

  // Value-axis labels are centered on their ticks, so the end ticks' labels
  // reach half their width beyond the plot. Reserve what the category axis or
  // the legend column does not already cover, so no label leaves the canvas.
  const valueLabelOverhang = topAxisConfig.config.showLabel && valueTickLabels.length > 0
    ? Math.max(...[valueTickLabels[0]!, valueTickLabels[valueTickLabels.length - 1]!]
      .map(label => measure.tick(label, config.yAxis.labelFontSize) / 2))
    : 0
  const leftReserve = Math.max(0, Math.max(valueLabelOverhang, ink.value, axisLineInk(leftAxisConfig.config)) - leftAxisConfig.size)
  const rightReserve = Math.max(0, valueLabelOverhang - legend.size, ink.value - legend.size)
  const plotArea: PlotArea = {
    x: leftAxisConfig.size + leftReserve,
    y: plotTop,
    width: Math.max(0, totalW - leftAxisConfig.size - leftReserve - legend.size - rightReserve),
    height: plotHeight,
  }

  const valueScale = (value: number) => plotArea.x + ((value - yRange.min) / (yRange.max - yRange.min || 1)) * plotArea.width
  const categoryPoint = (index: number) => plotArea.y + (index + 0.5) * (plotArea.height / dataCount)
  const categorySpacing = plotArea.height / Math.max(1, dataCount)

  const topTicks = topAxisConfig.config.showLabel
    ? buildTopAxisTicks(valueTickValues, valueTickLabels, valueScale, plotArea, topAxisConfig.config)
    : []
  const leftTicks = leftAxisConfig.config.showLabel
    ? buildLeftAxisTicks(
      categoryLabels.map((_, index) => index),
      categoryLabels,
      categoryPoint,
      plotArea,
      leftAxisConfig.config,
    )
    : []

  const gridLines: GridLine[] = valueTickValues.map(value => ({
    x1: valueScale(value),
    y1: plotArea.y,
    x2: valueScale(value),
    y2: plotArea.y + plotArea.height,
  }))

  const colorMap = chart.series.map((_, index) => index)
  const bars = layoutBars(chart, categoryPoint, categorySpacing, valueScale, yRange, categoryLabels, colorMap, true)
  const lines = layoutLines(chart, categoryPoint, valueScale, yRange, categoryLabels, colorMap, true)

  return {
    width: totalW,
    height: totalH,
    accessibility: chart.accessibility,
    horizontal: true,
    title: title.title,
    hiddenTitle: chart.title && config.showTitle && !title.title ? chart.title : undefined,
    xAxis: {
      ticks: leftTicks,
      line: buildLeftAxisLine(plotArea, leftAxisConfig.config),
      title: buildLeftAxisTitle(chart.xAxis.title, plotArea, leftAxisConfig.config, totalH, measure),
      config: leftAxisConfig.config,
    },
    yAxis: {
      ticks: topTicks,
      line: buildTopAxisLine(plotArea, topAxisConfig.config),
      title: buildTopAxisTitle(chart.yAxis.title, plotArea, titleHeight, topAxisConfig.config),
      config: topAxisConfig.config,
    },
    plotArea,
    bars,
    lines,
    gridLines,
    legend: legend.items,
    hiddenLegendLabels: legend.hiddenLabels,
    hiddenCategoryLabels: hiddenCategoryLabels(chart, config, leftAxisConfig.config, leftTicks),
    ...planBarDataLabels(bars, true, plotArea, config, measure),
    config,
    theme: chart.theme,
  }
}

/**
 * Fit the right-side legend column into the remaining horizontal budget
 * (upstream PR #7724 places the legend on the right, reserving its space
 * before the plot expands into the remaining width). Entries stack top-down,
 * top-aligned with the plot area. Containment by construction: the column is
 * DROPPED — never clipped — when its measured width exceeds the budget or its
 * height exceeds the plot band.
 */
function fitLegend(
  chart: XYChart,
  config: ResolvedXYChartConfig,
  budget: number,
  totalW: number,
  plotTop: number,
  plotHeight: number,
  measure: XYTextMeasure,
): { items: LegendItem[]; size: number; hiddenLabels: string[] } {
  if (!config.showLegend) return { items: [], size: 0, hiddenLabels: [] }
  const entries = legendEntries(chart.series)
  if (entries.length === 0) return { items: [], size: 0, hiddenLabels: [] }

  const maxLabelWidth = Math.ceil(Math.max(...entries.map(entry => measure.legend(entry.label, config.legendFontSize))))
  const width = config.legendPadding * 2 + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_GAP + maxLabelWidth
  const rowHeight = Math.max(...entries.map(entry => measure.block('legend', entry.label, config.legendFontSize).height), LEGEND_SWATCH_SIZE) + config.legendPadding
  const height = config.legendPadding + entries.length * rowHeight
  if (width > budget || height > plotHeight) return { items: [], size: 0, hiddenLabels: entries.map(entry => entry.label) }

  const swatchX = totalW - width + config.legendPadding
  const items: LegendItem[] = entries.map((entry, index) => ({
    label: entry.label,
    x: swatchX,
    y: plotTop + config.legendPadding + index * rowHeight,
    type: entry.type,
    seriesIndex: entry.seriesIndex,
    colorIndex: entry.colorIndex,
  }))
  return { items, size: width, hiddenLabels: [] }
}

function fitChartTitle(title: string | undefined, config: ResolvedXYChartConfig, budget: number, measure: XYTextMeasure): { height: number; title?: PositionedXYChart['title'] } {
  if (!title || !config.showTitle) return { height: 0 }
  const block = measure.wrapTitle(title, config.titleFontSize, Math.max(1, config.width - config.titlePadding * 2))
  const extraHeight = block.height - block.lineHeight
  const required = block.height + config.titlePadding * 2
  if (required > budget) return { height: 0 }
  return {
    height: required,
    title: { text: block.text, block, x: config.width / 2, y: config.titlePadding + block.height / 2 },
  }
}

/** Fit an axis into `budget` greedily — line, labels, ticks, then title —
 * dropping each part that no longer fits. `labelExtent` is the label band's
 * depth across the axis: one line for a horizontal axis, the widest label
 * for a vertical one. */
function fitAxisConfig(
  config: ResolvedXYAxisRenderConfig,
  title: string | undefined,
  labels: string[],
  budget: number,
  labelExtent: () => number,
  titleExtent = config.titleFontSize,
): { config: ResolvedXYAxisRenderConfig; size: number } {
  let remaining = budget
  const fitted: ResolvedXYAxisRenderConfig = { ...config, showAxisLine: false, showLabel: false, showTick: false, showTitle: false }

  if (config.showAxisLine && remaining > config.axisLineWidth) {
    fitted.showAxisLine = true
    remaining -= config.axisLineWidth
  }
  if (config.showLabel && labels.length > 0) {
    const required = labelExtent() + config.labelPadding * 2
    if (required <= remaining) {
      fitted.showLabel = true
      remaining -= required
    }
  }
  if (config.showTick && remaining >= config.tickLength) {
    fitted.showTick = true
    remaining -= config.tickLength
  }
  if (config.showTitle && title) {
    const required = titleExtent + config.titlePadding * 2
    if (required <= remaining) {
      fitted.showTitle = true
      remaining -= required
    }
  }

  return { config: fitted, size: budget - remaining }
}

function fitHorizontalAxisConfig(
  config: ResolvedXYAxisRenderConfig,
  title: string | undefined,
  labels: string[],
  budget: number,
  measure: XYTextMeasure,
): { config: ResolvedXYAxisRenderConfig; size: number } {
  const titleHeight = title ? measure.block('axisTitle', title, config.titleFontSize).height - config.titleFontSize * (LINE_HEIGHT_RATIO - 1) : config.titleFontSize
  return fitAxisConfig(config, title, labels, budget, () => Math.max(config.labelFontSize, ...labels.map(label => measure.block('tick', label, config.labelFontSize).height - config.labelFontSize * (LINE_HEIGHT_RATIO - 1))), titleHeight)
}

function fitTopAxisConfig(
  config: ResolvedXYAxisRenderConfig,
  title: string | undefined,
  labels: string[],
  budget: number,
  measure: XYTextMeasure,
): { config: ResolvedXYAxisRenderConfig; size: number } {
  return fitHorizontalAxisConfig(config, title, labels, budget, measure)
}

function fitVerticalAxisConfig(
  config: ResolvedXYAxisRenderConfig,
  title: string | undefined,
  labels: string[],
  budget: number,
  measure: XYTextMeasure,
  totalHeight: number,
): { config: ResolvedXYAxisRenderConfig; size: number } {
  return fitAxisConfig(config, title, labels, budget, () => Math.max(...labels.map(label => measure.tick(label, config.labelFontSize))), title ? measure.block('axisTitle', title, config.titleFontSize, Math.max(1, totalHeight - 4)).height - config.titleFontSize * (LINE_HEIGHT_RATIO - 1) : config.titleFontSize)
}

function buildBottomAxisTicks<T extends string | number>(
  values: T[],
  labels: string[],
  scale: (value: T) => number,
  plotArea: PlotArea,
  config: ResolvedXYAxisRenderConfig,
  measure: XYTextMeasure,
  totalWidth?: number,
): AxisTick[] {
  const lineOffset = config.showAxisLine ? config.axisLineWidth : 0
  const tickOffset = config.showTick ? config.tickLength : 0
  const labelY = plotArea.y + plotArea.height + lineOffset + tickOffset + config.labelPadding
    + config.labelFontSize * (1 - BOTTOM_LABEL_RENDERED_ALLOWANCE_EM)

  // Deterministic tick-label thinning: centered labels garble into each other
  // when the widest label plus a readability gap exceeds the tick spacing
  // (2026-07 overlap audit: 28% of fuzzed charts). Keep every k-th label
  // (tick marks stay); k is measured, not guessed, so short labels never thin.
  const widths = labels.map(label => measure.tick(label, config.labelFontSize))
  const maxW = widths.length ? Math.max(...widths) : 0
  const xs = values.map(value => scale(value))
  let minSpacing = Infinity
  for (let i = 1; i < xs.length; i++) minSpacing = Math.min(minSpacing, Math.abs(xs[i]! - xs[i - 1]!))
  const keepEvery = Number.isFinite(minSpacing) && minSpacing > 0 ? Math.max(1, Math.ceil((maxW + 6) / minSpacing)) : 1

  return values.map((value, index) => {
    const label = index % keepEvery === 0 ? labels[index]! : ''
    // Clamp the label box inside the canvas: the last tick sits AT the plot's
    // right edge and a centered label pokes past the right padding otherwise.
    let labelX = scale(value)
    if (totalWidth !== undefined && label) {
      const half = widths[index]! / 2
      labelX = Math.max(2 + half, Math.min(totalWidth - 2 - half, labelX))
    }
    return {
      label,
      x: scale(value),
      y: plotArea.y + plotArea.height + lineOffset,
      tx: scale(value),
      ty: plotArea.y + plotArea.height + lineOffset + tickOffset,
      labelX,
      labelY,
      textAnchor: 'middle' as const,
    }
  })
}

function buildTopAxisTicks(
  values: number[],
  labels: string[],
  scale: (value: number) => number,
  plotArea: PlotArea,
  config: ResolvedXYAxisRenderConfig,
): AxisTick[] {
  const lineOffset = config.showAxisLine ? config.axisLineWidth : 0
  const tickOffset = config.showTick ? config.tickLength : 0
  const labelY = plotArea.y - lineOffset - tickOffset - config.labelPadding

  return values.map((value, index) => ({
    label: labels[index]!,
    x: scale(value),
    y: plotArea.y - lineOffset,
    tx: scale(value),
    ty: plotArea.y - lineOffset - tickOffset,
    labelX: scale(value),
    labelY,
    textAnchor: 'middle',
  }))
}

function buildLeftAxisTicks<T extends string | number>(
  values: T[],
  labels: string[],
  scale: (value: T) => number,
  plotArea: PlotArea,
  config: ResolvedXYAxisRenderConfig,
): AxisTick[] {
  const lineOffset = config.showAxisLine ? config.axisLineWidth : 0
  const tickOffset = config.showTick ? config.tickLength : 0
  const labelX = plotArea.x - lineOffset - tickOffset - config.labelPadding

  return values.map((value, index) => ({
    label: labels[index]!,
    x: plotArea.x - lineOffset,
    y: scale(value),
    tx: plotArea.x - lineOffset - tickOffset,
    ty: scale(value),
    labelX,
    labelY: scale(value),
    textAnchor: 'end',
  }))
}

function buildBottomAxisLine(plotArea: PlotArea, config: ResolvedXYAxisRenderConfig) {
  const y = plotArea.y + plotArea.height + (config.showAxisLine ? config.axisLineWidth / 2 : 0)
  return { x1: plotArea.x, y1: y, x2: plotArea.x + plotArea.width, y2: y }
}

function buildTopAxisLine(plotArea: PlotArea, config: ResolvedXYAxisRenderConfig) {
  const y = plotArea.y - (config.showAxisLine ? config.axisLineWidth / 2 : 0)
  return { x1: plotArea.x, y1: y, x2: plotArea.x + plotArea.width, y2: y }
}

function buildLeftAxisLine(plotArea: PlotArea, config: ResolvedXYAxisRenderConfig) {
  const x = plotArea.x - (config.showAxisLine ? config.axisLineWidth / 2 : 0)
  return { x1: x, y1: plotArea.y, x2: x, y2: plotArea.y + plotArea.height }
}

function buildBottomAxisTitle(
  title: string | undefined,
  plotArea: PlotArea,
  totalHeight: number,
  config: ResolvedXYAxisRenderConfig,
) {
  if (!title || !config.showTitle) return undefined
  // The title is drawn centered on y (TEXT_BASELINE_SHIFT), so its line box
  // sits inside the band the axis reserved rather than on the canvas edge.
  return {
    text: title,
    x: plotArea.x + plotArea.width / 2,
    y: totalHeight - config.titlePadding - config.titleFontSize / 2,
  }
}

function buildTopAxisTitle(
  title: string | undefined,
  plotArea: PlotArea,
  titleHeight: number,
  config: ResolvedXYAxisRenderConfig,
) {
  if (!title || !config.showTitle) return undefined
  return {
    text: title,
    x: plotArea.x + plotArea.width / 2,
    y: titleHeight + config.titlePadding + config.titleFontSize,
  }
}

function buildLeftAxisTitle(
  title: string | undefined,
  plotArea: PlotArea,
  config: ResolvedXYAxisRenderConfig,
  totalHeight: number,
  measure: XYTextMeasure,
) {
  if (!title || !config.showTitle) return undefined
  // Rotated, the title runs vertically, centered on the plot. Clamp that run
  // inside the canvas, as the bottom axis clamps its end labels, when the
  // title is longer than the room below or above the plot's center.
  // A rotated title's line width consumes canvas height. Use the same wrapped
  // block for fitting the left gutter, placement and the final text writer.
  const block = measure.block('axisTitle', title, config.titleFontSize, Math.max(1, totalHeight - 4))
  const half = block.width / 2
  const center = plotArea.y + plotArea.height / 2
  return {
    text: title,
    block,
    x: config.titlePadding + config.titleFontSize * 0.8,
    y: 2 * half + 4 >= totalHeight ? totalHeight / 2 : Math.min(totalHeight - 2 - half, Math.max(2 + half, center)),
    rotate: -90,
  }
}

/**
 * Authored category names the fitted category axis does not draw: all of them
 * when the axis could not fit its widest label, otherwise the thinned ticks.
 * Numeric and synthesized index axes are not reported; their tick labels are
 * derived, so thinning them hides nothing the author wrote.
 */
function hiddenCategoryLabels(
  chart: XYChart,
  config: ResolvedXYChartConfig,
  fitted: ResolvedXYAxisRenderConfig,
  ticks: AxisTick[],
): string[] {
  const categories = chart.xAxis.categories
  if (!categories || chart.xAxis.range || !config.xAxis.showLabel) return []
  const authored = (label: string, index: number): boolean => index < categories.length && label !== ''
  const drawn = getCategoryLabels(chart)
  if (!fitted.showLabel) return drawn.filter(authored)
  return drawn.filter((label, index) => authored(label, index) && ticks[index]?.label === '')
}

/** Glyph extent below a label's middle line (dominant-baseline middle): half
 * the x-height plus the descender, about 0.52em in Inter, with room for other
 * faces. */
const LABEL_BELOW_MIDDLE_EM = 0.6

const DATA_LABEL_MIN_FONT = 8
const DATA_LABEL_MAX_FONT = 16
const DATA_LABEL_INSET = 8
const DATA_LABEL_GAP = 4

/**
 * Value labels share one font size, fitted across the bars only (a vertical
 * label must fit the bar width, a horizontal one the bar thickness), so one
 * short bar never shrinks or removes every other label. Each label sits inside
 * its bar's value end when it fits, otherwise just beyond that end while it
 * stays in the plot; `showDataLabelOutsideBar` reverses that preference. A bar
 * whose label fits neither place is reported in `unlabeledBars`.
 */
function planBarDataLabels(
  bars: PositionedBar[],
  horizontal: boolean,
  plotArea: PlotArea,
  config: ResolvedXYChartConfig,
  measure: XYTextMeasure,
): { dataLabels: PositionedDataLabel[]; unlabeledBars: PositionedBar[] } {
  if (!config.showDataLabel || bars.length === 0) return { dataLabels: [], unlabeledBars: [] }
  const texts = bars.map(bar => formatBarValue(bar.value))
  // Tracking is an absolute pixel distance, so scaling a 1px measurement
  // would multiply the tracking too. Fit the finite supported font sizes.
  let fontSize: number = DATA_LABEL_MAX_FONT
  for (; fontSize >= DATA_LABEL_MIN_FONT; fontSize--) {
    if (bars.every((bar, index) => {
      const block = measure.block('data', texts[index]!, fontSize)
      return horizontal ? block.height <= bar.height - 4 : block.width <= bar.width - DATA_LABEL_INSET
    })) break
  }
  if (fontSize < DATA_LABEL_MIN_FONT) return { dataLabels: [], unlabeledBars: [...bars] }

  const dataLabels: PositionedDataLabel[] = []
  const unlabeledBars: PositionedBar[] = []
  bars.forEach((bar, index) => {
    const text = texts[index]!
    const textBlock = measure.block('data', text, fontSize)
    const textWidth = textBlock.width
    const insideFits = horizontal ? bar.width - 12 >= textWidth : bar.height - 10 >= textBlock.height
    const outsideFitsBeyond = (positiveEnd: boolean): boolean => {
      const room = horizontal
        ? (positiveEnd ? plotArea.x + plotArea.width - (bar.x + bar.width) : bar.x - plotArea.x)
        : (positiveEnd ? bar.y - plotArea.y : plotArea.y + plotArea.height - (bar.y + bar.height))
      return room >= (horizontal ? textWidth : textBlock.height) + DATA_LABEL_GAP
    }
    // Bars grow from zero clamped into the axis range, so the value's sign
    // names the end that carries the value. A zero bar has no length and no
    // direction; its label takes whichever side has room, positive first.
    const positive = bar.value > 0 || (bar.value === 0 && (outsideFitsBeyond(true) || !outsideFitsBeyond(false)))
    const outsideFits = outsideFitsBeyond(positive)
    const placement = config.showDataLabelOutsideBar
      ? (outsideFits ? 'outside' : insideFits ? 'inside' : undefined)
      : (insideFits ? 'inside' : outsideFits ? 'outside' : undefined)
    if (!placement) {
      unlabeledBars.push(bar)
      return
    }
    if (horizontal) {
      const outward = (placement === 'outside') === positive
      const edge = positive ? bar.x + bar.width : bar.x
      const offset = placement === 'outside' ? DATA_LABEL_GAP : -DATA_LABEL_INSET
      dataLabels.push({
        bar, text, fontSize, placement,
        x: edge + (positive ? offset : -offset),
        y: bar.y + bar.height / 2,
        anchor: outward ? 'start' : 'end',
        dominantBaseline: 'middle',
      })
      return
    }
    const top = placement === 'inside' ? positive : !positive
    dataLabels.push({
      bar, text, fontSize, placement,
      x: bar.x + bar.width / 2,
      y: placement === 'inside'
        ? (positive ? bar.y + DATA_LABEL_INSET : bar.y + bar.height - DATA_LABEL_INSET)
        : (positive ? bar.y - DATA_LABEL_GAP : bar.y + bar.height + DATA_LABEL_GAP),
      anchor: 'middle',
      ...(top ? { dominantBaseline: 'hanging' as const } : {}),
    })
  })
  return { dataLabels, unlabeledBars }
}

/** Bars along the category axis: each category's band holds one bar per bar
 * series, and a bar spans from the value baseline to its (clamped) value.
 * `horizontal` puts the category axis on y and the value axis on x. */
function layoutBars(
  chart: XYChart,
  categoryPoint: (index: number) => number,
  pointSpacing: number,
  valueScale: (value: number) => number,
  valueRange: { min: number; max: number },
  labels: string[],
  colorMap: number[],
  horizontal: boolean,
): PositionedBar[] {
  const barSeries = chart.series.filter(series => series.type === 'bar')
  const barCount = barSeries.length
  if (barCount === 0) return []

  const usableBand = pointSpacing * (1 - BAR_PADDING_PERCENT)
  const barThickness = usableBand / Math.max(1, barCount)
  const bars: PositionedBar[] = []

  let barSeriesIndex = 0
  let seriesArrayIndex = 0
  // Both ends clamp into the axis range, so a bar never leaves the plot.
  const baseline = valueScale(barBaselineValue(valueRange))

  for (const series of chart.series) {
    if (series.type !== 'bar') {
      seriesArrayIndex++
      continue
    }
    for (let i = 0; i < series.data.length; i++) {
      const bandStart = categoryPoint(i) - usableBand / 2 + barSeriesIndex * barThickness
      const value = valueScale(clampToAxisRange(valueRange, series.data[i]!))
      const valueStart = Math.min(value, baseline)
      const valueLength = Math.abs(baseline - value)
      bars.push({
        x: horizontal ? valueStart : bandStart,
        y: horizontal ? bandStart : valueStart,
        width: horizontal ? valueLength : barThickness,
        height: horizontal ? barThickness : valueLength,
        value: series.data[i]!,
        label: labels[i]!,
        seriesIndex: barSeriesIndex,
        colorIndex: colorMap[seriesArrayIndex]!,
      })
    }
    barSeriesIndex++
    seriesArrayIndex++
  }

  return bars
}

/** One polyline per line series, a point per category at its value.
 * `horizontal` puts the category axis on y and the value axis on x. */
function layoutLines(
  chart: XYChart,
  categoryPoint: (index: number) => number,
  valueScale: (value: number) => number,
  valueRange: { min: number; max: number },
  labels: string[],
  colorMap: number[],
  horizontal: boolean,
): PositionedLine[] {
  const lines: PositionedLine[] = []
  let lineSeriesIndex = 0
  let seriesArrayIndex = 0

  for (const series of chart.series) {
    if (series.type !== 'line') {
      seriesArrayIndex++
      continue
    }
    lines.push({
      // A point clamps into the axis range, as a bar does, so a line never
      // leaves the plot; the point keeps its value.
      points: series.data.map((value, index) => {
        const category = categoryPoint(index)
        const position = valueScale(clampToAxisRange(valueRange, value))
        return {
          x: horizontal ? position : category,
          y: horizontal ? category : position,
          value,
          label: labels[index]!,
          ...(series.pointLabels?.[index] !== undefined ? { textLabel: series.pointLabels[index] } : {}),
        }
      }),
      seriesIndex: lineSeriesIndex,
      colorIndex: colorMap[seriesArrayIndex]!,
    })
    lineSeriesIndex++
    seriesArrayIndex++
  }

  return lines
}
