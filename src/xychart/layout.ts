import { styleFaceOf } from '../scene/style-registry.ts'
import type {
  AxisTick,
  GridLine,
  LegendItem,
  PlotArea,
  PositionedBar,
  PositionedLine,
  PositionedXYChart,
  ResolvedXYAxisRenderConfig,
  ResolvedXYChartConfig,
  XYChart,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { estimateTextWidth, STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { resolveXYChartRenderConfig } from './config.ts'
import { formatTickValue, getCategoryLabels, getDataCount, getDataXValues, getPointSpacing, linearTicks } from './axis-utils.ts'
import { legendEntries } from './legend.ts'

// ============================================================================
// XY Chart layout engine
//
// Layout is intentionally closer to Mermaid's own xychart builder:
// total width/height are the chart box, plot space is reserved inside that box,
// and axis/title elements compete for the reserved margin space.
// ============================================================================

const BAR_PADDING_PERCENT = 0.05

/** Legend swatch geometry, shared with the renderer and pinned by tests. */
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

export function layoutXYChart(
  chart: XYChart,
  options: RenderOptions = {},
): PositionedXYChart {
  const style = resolveRenderStyle(options, XY_STYLE_DEFAULTS)
  const config = resolveXYChartRenderConfig(chart.config)
  const face = styleFaceOf(options.style)
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
  if (chart.horizontal) return layoutHorizontal(chart, config)
  return layoutVertical(chart, config)
}

function layoutVertical(chart: XYChart, config: ResolvedXYChartConfig): PositionedXYChart {
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

  const titleHeight = fitChartTitle(chart.title, config, remainingTopBottomBudget)
  remainingTopBottomBudget = Math.max(0, remainingTopBottomBudget - titleHeight)

  const xAxisConfig = fitHorizontalAxisConfig(config.xAxis, chart.xAxis.title, xTickLabels, remainingTopBottomBudget)
  remainingTopBottomBudget = Math.max(0, remainingTopBottomBudget - xAxisConfig.size)

  const yAxisConfig = fitVerticalAxisConfig(config.yAxis, chart.yAxis.title, yTickLabels, remainingLeftBudget)
  remainingLeftBudget = Math.max(0, remainingLeftBudget - yAxisConfig.size)

  const plotHeight = Math.max(0, totalH - titleHeight - xAxisConfig.size)
  const legend = fitLegend(chart, config, remainingLeftBudget, totalW, titleHeight, plotHeight)

  const plotArea: PlotArea = {
    x: yAxisConfig.size,
    y: titleHeight,
    width: Math.max(0, totalW - yAxisConfig.size - legend.size),
    height: plotHeight,
  }

  const xScaleValue = chart.xAxis.range
    ? (value: number) => plotArea.x + ((value - chart.xAxis.range!.min) / (chart.xAxis.range!.max - chart.xAxis.range!.min || 1)) * plotArea.width
    : undefined
  const xPoint = (index: number) => xScaleValue ? xScaleValue(dataXValues[index]!) : plotArea.x + (index + 0.5) * (plotArea.width / dataCount)
  const xPointSpacing = xScaleValue
    ? getPointSpacing(dataXValues, xScaleValue, plotArea.width / Math.max(2, dataCount))
    : plotArea.width / Math.max(1, dataCount)
  const yScale = (value: number) => plotArea.y + plotArea.height - ((value - yRange.min) / (yRange.max - yRange.min || 1)) * plotArea.height

  const xTicks = !xAxisConfig.config.showLabel
    ? []
    : chart.xAxis.range && xTickValues && xScaleValue
      ? buildBottomAxisTicks(xTickValues, xTickLabels, xScaleValue, plotArea, xAxisConfig.config, totalW)
      : buildBottomAxisTicks(
        categoryLabels.map((_, index) => index),
        categoryLabels,
        xPoint,
        plotArea,
        xAxisConfig.config,
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
  const bars = layoutVerticalBars(chart, xPoint, xPointSpacing, yScale, yRange.min, categoryLabels, colorMap)
  const lines = layoutVerticalLines(chart, xPoint, yScale, categoryLabels, colorMap)

  return {
    width: totalW,
    height: totalH,
    accessibility: chart.accessibility,
    title: titleHeight > 0 && chart.title
      ? { text: chart.title, x: totalW / 2, y: config.titlePadding + config.titleFontSize }
      : undefined,
    xAxis: {
      ticks: xTicks,
      line: buildBottomAxisLine(plotArea, xAxisConfig.config),
      title: buildBottomAxisTitle(chart.xAxis.title, plotArea, totalH, xAxisConfig.config),
      config: xAxisConfig.config,
    },
    yAxis: {
      ticks: yTicks,
      line: buildLeftAxisLine(plotArea, yAxisConfig.config),
      title: buildLeftAxisTitle(chart.yAxis.title, plotArea, yAxisConfig.config),
      config: yAxisConfig.config,
    },
    plotArea,
    bars,
    lines,
    gridLines,
    legend: legend.items,
    config,
    theme: chart.theme,
  }
}

function layoutHorizontal(chart: XYChart, config: ResolvedXYChartConfig): PositionedXYChart {
  const totalW = config.width
  const totalH = config.height
  const dataCount = getDataCount(chart)
  const categoryLabels = getCategoryLabels(chart, dataCount)
  const yRange = chart.yAxis.range!
  const valueTickValues = linearTicks(yRange.min, yRange.max)
  const valueTickLabels = valueTickValues.map(formatTickValue)

  let remainingTopBottomBudget = Math.max(0, totalH - Math.floor(totalH * config.plotReservedSpacePercent / 100))
  let remainingLeftBudget = Math.max(0, totalW - Math.floor(totalW * config.plotReservedSpacePercent / 100))

  const titleHeight = fitChartTitle(chart.title, config, remainingTopBottomBudget)
  remainingTopBottomBudget = Math.max(0, remainingTopBottomBudget - titleHeight)

  // Mermaid places the numeric value axis at the top in horizontal mode.
  const topAxisConfig = fitTopAxisConfig(config.yAxis, chart.yAxis.title, valueTickLabels, remainingTopBottomBudget)
  remainingTopBottomBudget = Math.max(0, remainingTopBottomBudget - topAxisConfig.size)

  const leftAxisConfig = fitVerticalAxisConfig(config.xAxis, chart.xAxis.title, categoryLabels, remainingLeftBudget)
  remainingLeftBudget = Math.max(0, remainingLeftBudget - leftAxisConfig.size)

  const plotTop = titleHeight + topAxisConfig.size
  const plotHeight = Math.max(0, totalH - plotTop)
  const legend = fitLegend(chart, config, remainingLeftBudget, totalW, plotTop, plotHeight)

  const plotArea: PlotArea = {
    x: leftAxisConfig.size,
    y: plotTop,
    width: Math.max(0, totalW - leftAxisConfig.size - legend.size),
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
  const bars = layoutHorizontalBars(chart, categoryPoint, categorySpacing, valueScale, yRange.min, categoryLabels, colorMap)
  const lines = layoutHorizontalLines(chart, categoryPoint, valueScale, categoryLabels, colorMap)

  return {
    width: totalW,
    height: totalH,
    accessibility: chart.accessibility,
    horizontal: true,
    title: titleHeight > 0 && chart.title
      ? { text: chart.title, x: totalW / 2, y: config.titlePadding + config.titleFontSize }
      : undefined,
    xAxis: {
      ticks: leftTicks,
      line: buildLeftAxisLine(plotArea, leftAxisConfig.config),
      title: buildLeftAxisTitle(chart.xAxis.title, plotArea, leftAxisConfig.config),
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
): { items: LegendItem[]; size: number } {
  if (!config.showLegend) return { items: [], size: 0 }
  const entries = legendEntries(chart.series)
  if (entries.length === 0) return { items: [], size: 0 }

  const maxLabelWidth = Math.ceil(Math.max(...entries.map(entry => estimateTextWidth(entry.label, config.legendFontSize, 400))))
  const width = config.legendPadding * 2 + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_GAP + maxLabelWidth
  const rowHeight = Math.max(config.legendFontSize, LEGEND_SWATCH_SIZE) + config.legendPadding
  const height = config.legendPadding + entries.length * rowHeight
  if (width > budget || height > plotHeight) return { items: [], size: 0 }

  const swatchX = totalW - width + config.legendPadding
  const items: LegendItem[] = entries.map((entry, index) => ({
    label: entry.label,
    x: swatchX,
    y: plotTop + config.legendPadding + index * rowHeight,
    type: entry.type,
    seriesIndex: entry.seriesIndex,
    colorIndex: entry.colorIndex,
  }))
  return { items, size: width }
}

function fitChartTitle(title: string | undefined, config: ResolvedXYChartConfig, budget: number): number {
  if (!title || !config.showTitle) return 0
  const required = config.titleFontSize + config.titlePadding * 2
  return required <= budget ? required : 0
}

function fitHorizontalAxisConfig(
  config: ResolvedXYAxisRenderConfig,
  title: string | undefined,
  labels: string[],
  budget: number,
): { config: ResolvedXYAxisRenderConfig; size: number } {
  let remaining = budget
  const fitted: ResolvedXYAxisRenderConfig = { ...config, showAxisLine: false, showLabel: false, showTick: false, showTitle: false }

  if (config.showAxisLine && remaining > config.axisLineWidth) {
    fitted.showAxisLine = true
    remaining -= config.axisLineWidth
  }
  if (config.showLabel) {
    const required = config.labelFontSize + config.labelPadding * 2
    if (required <= remaining && labels.length > 0) {
      fitted.showLabel = true
      remaining -= required
    }
  }
  if (config.showTick && remaining >= config.tickLength) {
    fitted.showTick = true
    remaining -= config.tickLength
  }
  if (config.showTitle && title) {
    const required = config.titleFontSize + config.titlePadding * 2
    if (required <= remaining) {
      fitted.showTitle = true
      remaining -= required
    }
  }

  return { config: fitted, size: budget - remaining }
}

function fitTopAxisConfig(
  config: ResolvedXYAxisRenderConfig,
  title: string | undefined,
  labels: string[],
  budget: number,
): { config: ResolvedXYAxisRenderConfig; size: number } {
  return fitHorizontalAxisConfig(config, title, labels, budget)
}

function fitVerticalAxisConfig(
  config: ResolvedXYAxisRenderConfig,
  title: string | undefined,
  labels: string[],
  budget: number,
): { config: ResolvedXYAxisRenderConfig; size: number } {
  let remaining = budget
  const fitted: ResolvedXYAxisRenderConfig = { ...config, showAxisLine: false, showLabel: false, showTick: false, showTitle: false }

  if (config.showAxisLine && remaining > config.axisLineWidth) {
    fitted.showAxisLine = true
    remaining -= config.axisLineWidth
  }
  if (config.showLabel && labels.length > 0) {
    const maxLabelWidth = Math.max(...labels.map(label => estimateTextWidth(label, config.labelFontSize, 400)))
    const required = maxLabelWidth + config.labelPadding * 2
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
    const required = config.titleFontSize + config.titlePadding * 2
    if (required <= remaining) {
      fitted.showTitle = true
      remaining -= required
    }
  }

  return { config: fitted, size: budget - remaining }
}

function buildBottomAxisTicks<T extends string | number>(
  values: T[],
  labels: string[],
  scale: (value: T) => number,
  plotArea: PlotArea,
  config: ResolvedXYAxisRenderConfig,
  totalWidth?: number,
): AxisTick[] {
  const lineOffset = config.showAxisLine ? config.axisLineWidth : 0
  const tickOffset = config.showTick ? config.tickLength : 0
  const labelY = plotArea.y + plotArea.height + lineOffset + tickOffset + config.labelPadding + config.labelFontSize

  // Deterministic tick-label thinning: centered labels garble into each other
  // when the widest label plus a readability gap exceeds the tick spacing
  // (2026-07 overlap audit: 28% of fuzzed charts). Keep every k-th label
  // (tick marks stay); k is measured, not guessed, so short labels never thin.
  const widths = labels.map(label => estimateTextWidth(label, config.labelFontSize, 400))
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
  return {
    text: title,
    x: plotArea.x + plotArea.width / 2,
    y: totalHeight - config.titlePadding,
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
) {
  if (!title || !config.showTitle) return undefined
  return {
    text: title,
    x: config.titlePadding + config.titleFontSize * 0.8,
    y: plotArea.y + plotArea.height / 2,
    rotate: -90,
  }
}

function layoutVerticalBars(
  chart: XYChart,
  xPoint: (index: number) => number,
  pointSpacing: number,
  yScale: (value: number) => number,
  baselineValue: number,
  labels: string[],
  colorMap: number[],
): PositionedBar[] {
  const barSeries = chart.series.filter(series => series.type === 'bar')
  const barCount = barSeries.length
  if (barCount === 0) return []

  const usableWidth = pointSpacing * (1 - BAR_PADDING_PERCENT)
  const barWidth = usableWidth / Math.max(1, barCount)
  const bars: PositionedBar[] = []

  let barSeriesIndex = 0
  let seriesArrayIndex = 0
  const baselineY = yScale(baselineValue)

  for (const series of chart.series) {
    if (series.type !== 'bar') {
      seriesArrayIndex++
      continue
    }
    for (let i = 0; i < series.data.length; i++) {
      const x = xPoint(i) - usableWidth / 2 + barSeriesIndex * barWidth
      const valueY = yScale(series.data[i]!)
      bars.push({
        x,
        y: Math.min(valueY, baselineY),
        width: barWidth,
        height: Math.abs(baselineY - valueY),
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

function layoutHorizontalBars(
  chart: XYChart,
  yPoint: (index: number) => number,
  pointSpacing: number,
  xScale: (value: number) => number,
  baselineValue: number,
  labels: string[],
  colorMap: number[],
): PositionedBar[] {
  const barSeries = chart.series.filter(series => series.type === 'bar')
  const barCount = barSeries.length
  if (barCount === 0) return []

  const usableHeight = pointSpacing * (1 - BAR_PADDING_PERCENT)
  const barHeight = usableHeight / Math.max(1, barCount)
  const bars: PositionedBar[] = []

  let barSeriesIndex = 0
  let seriesArrayIndex = 0
  const baselineX = xScale(baselineValue)

  for (const series of chart.series) {
    if (series.type !== 'bar') {
      seriesArrayIndex++
      continue
    }
    for (let i = 0; i < series.data.length; i++) {
      const y = yPoint(i) - usableHeight / 2 + barSeriesIndex * barHeight
      const valueX = xScale(series.data[i]!)
      bars.push({
        x: Math.min(valueX, baselineX),
        y,
        width: Math.abs(valueX - baselineX),
        height: barHeight,
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

function layoutVerticalLines(
  chart: XYChart,
  xPoint: (index: number) => number,
  yScale: (value: number) => number,
  labels: string[],
  colorMap: number[],
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
      points: series.data.map((value, index) => ({
        x: xPoint(index),
        y: yScale(value),
        value,
        label: labels[index]!,
      })),
      seriesIndex: lineSeriesIndex,
      colorIndex: colorMap[seriesArrayIndex]!,
    })
    lineSeriesIndex++
    seriesArrayIndex++
  }

  return lines
}

function layoutHorizontalLines(
  chart: XYChart,
  yPoint: (index: number) => number,
  xScale: (value: number) => number,
  labels: string[],
  colorMap: number[],
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
      points: series.data.map((value, index) => ({
        x: xScale(value),
        y: yPoint(index),
        value,
        label: labels[index]!,
      })),
      seriesIndex: lineSeriesIndex,
      colorIndex: colorMap[seriesArrayIndex]!,
    })
    lineSeriesIndex++
    seriesArrayIndex++
  }

  return lines
}
