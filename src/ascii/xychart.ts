import { terminalArtifact, serializeTerminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
// ============================================================================
// ASCII renderer — XY Chart
//
// Renders xychart / xychart-beta diagrams to ASCII/Unicode text art.
// Uses the parsed XYChart type directly (not PositionedXYChart) since
// pixel coordinates don't map to character grids.
//
// Bar charts: █ (Unicode) or # (ASCII) block characters.
// Line charts: continuous staircase routing with rounded corners (╭╮╰╯│─).
//
// Multi-series support: each series gets a distinct color from a palette.
// ============================================================================

import { applyResolvedXYChartConfig, applyXYChartFrontmatterConfig, parseXYChart } from '../xychart/parser.ts'
import type { XYChart, XYChartConfig, XYChartTheme } from '../xychart/types.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import type { AsciiConfig, AsciiTheme, ColorMode, CharRole } from './types.ts'
import { measuredText, TerminalDocument, type MeasuredTerminalText, type TerminalOwner } from './terminal-document.ts'
import { CHART_ACCENT_FALLBACK } from '../xychart/colors.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { isLegendWorthy, legendEntries } from '../xychart/legend.ts'
import { barBaselineValue, getDataCount, getCategoryLabels, formatTickValue, linearTicks } from '../xychart/axis-utils.ts'
import { graphemes } from '../shared/graphemes.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { AsciiWidthError } from './width-error.ts'
import { quantizedScale } from './quantized-scale.ts'

// ============================================================================
// Constants
// ============================================================================

const PLOT_WIDTH = 60
const PLOT_HEIGHT = 20

// Decorative glyphs; connected geometry lowers logical ports centrally.
const UNI = { ascii: false, hLine: '─', bar: '█', grid: '·' } as const
const ASC = { ascii: true, hLine: '-', bar: '#', grid: '.' } as const

/** Numeric labels own foreground cells before the plot's background paint. */
function valueLabelReservations() {
  const plans = new Map<string, { x: number; y: number; text: MeasuredTerminalText; color: string; owner: TerminalOwner }>()
  const rows = new Map<number, Set<number>>()
  return {
    reserve(x: number, y: number, text: MeasuredTerminalText, color: string, owner: TerminalOwner) {
      plans.set(owner.id, { x, y, text, color, owner })
      for (const [row, clusters] of text.lines.entries()) {
        const columns = rows.get(y + row) ?? new Set<number>()
        rows.set(y + row, columns)
        for (const cluster of clusters) for (let offset = 0; offset < cluster.width; offset++) columns.add(x + cluster.x + offset)
      }
    },
    has(x: number, y: number) { return rows.get(y)?.has(x) ?? false },
    paint(canvas: TerminalDocument, id: string) {
      const plan = plans.get(id)
      if (plan) canvas.textBlock(plan.x, plan.y, plan.text, { role: 'text', color: plan.color, owner: plan.owner, textGroup: plan.owner.id })
    },
  }
}

// ============================================================================
// Multi-series color support
// ============================================================================

/** Preserve authored CSS palette entries; colorizeText resolves concrete
 * paints for ANSI and retains safe CSS values for HTML output. Without a
 * palette, the series take the palette SVG draws, so one series gets the same
 * repair as several (an accent that vanishes into the background is moved off
 * it in both outputs). */
function getSeriesColors(total: number, theme: AsciiTheme, palette?: string[]): string[] {
  if (palette && palette.length > 0) {
    return Array.from({ length: total }, (_, i) => palette[i % palette.length]!)
  }
  return categoricalPalette(Math.max(1, total), { accent: theme.accent ?? CHART_ACCENT_FALLBACK, bg: theme.bg })
}

// ============================================================================
// Public API
// ============================================================================

export function renderXYChartTerminal(
  text: string,
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
  frontmatter: MermaidFrontmatterMap = {},
  targetWidth?: number,
  resolved?: { config: XYChartConfig; theme: XYChartTheme },
): TerminalArtifact {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  const parsed = parseXYChart(lines)
  const chart = resolved
    ? applyResolvedXYChartConfig(parsed, resolved.config, resolved.theme)
    : applyXYChartFrontmatterConfig(parsed, frontmatter)
  chart.title ??= config.title
  const ch = config.useAscii ? ASC : UNI
  const widthBudget = targetWidth ?? config.maxWidth

  const rendered = getDataCount(chart) === 0
    ? chartHeader(chart, ch, [], Math.max(1, widthBudget ?? visualWidth(chart.title ?? '')), !!chart.title && chart.config.showTitle !== false, false)
    : chart.horizontal
      ? renderHorizontal(chart, ch, theme, widthBudget, targetWidth)
      : renderVertical(chart, ch, theme, widthBudget)
  // The axis parallel to the numeric values owns the conventional bottom
  // title. Preserve the other authored title as an explicit annotation.
  const secondaryAxis = chart.horizontal ? chart.xAxis : chart.yAxis
  const secondaryConfig = chart.horizontal ? chart.config.xAxis : chart.config.yAxis
  const secondaryId = chart.horizontal ? 'x-axis' : 'y-axis'
  if (secondaryAxis.title && secondaryConfig?.showTitle !== false) {
    const prefix = `${secondaryId}: `
    const lines = wrapText(secondaryAxis.title, widthBudget === undefined ? undefined : Math.max(1, widthBudget - visualWidth(prefix)))
    lines.forEach((text, index) => rendered.line([
      { text: index === 0 ? prefix : ' '.repeat(visualWidth(prefix)), role: 'border', kind: index === 0 ? 'text' : 'surface', owner: { id: `${secondaryId}:prefix`, kind: 'label', parent: { id: secondaryId, kind: 'label' } } },
      { text, role: 'text', textGroup: secondaryId, owner: { id: secondaryId, kind: 'label' } },
    ]))
  }
  chart.series.forEach((series, seriesIndex) => {
    series.pointLabels?.forEach((label, pointIndex) => {
      if (label === undefined) return
      const text = `line ${seriesIndex + 1}.${pointIndex + 1}: ${label}`
      for (const line of wrapText(text, widthBudget)) rendered.line([{ text: line, role: 'text', textGroup: 'point-label', owner: { id: `series-${seriesIndex}:point-${pointIndex}:label`, kind: 'label', parent: { id: `series-${seriesIndex}`, kind: 'node' } } }])
    })
  })
  reportXYChartProjections(rendered, chart)
  rendered.titleHandled = true
  return terminalArtifact(rendered, { colorMode, theme, trimEnd: true })
}

/** Graphical sizing and typography remain authored configuration; terminal
 * layout uses measured cells and the caller's independent width policy. */
function reportXYChartProjections(document: TerminalDocument, chart: XYChart): void {
  const project = (feature: string, value: unknown, representation: string): void => document.report({
    code: 'TERMINAL_FAMILY_PROJECTION', feature,
    message: `${feature}=${JSON.stringify(value)} is represented by ${representation}; source configuration is retained.`,
  })
  const hasTitle = !!chart.title && chart.config.showTitle !== false
  const hasLegend = chart.config.showLegend !== false && isLegendWorthy(chart.series)
  const hasDataLabels = chart.config.showDataLabel && chart.series.some(series => series.type === 'bar')
  for (const field of ['width', 'height', 'useWidth', 'plotReservedSpacePercent'] as const) {
    if (chart.config[field] !== undefined) project(`xyChart.${field}`, chart.config[field], 'measured terminal plot cells and the terminal targetWidth/maxWidth policy rather than a pixel chart box')
  }
  if (chart.config.useMaxWidth === true) document.report({
    code: 'TERMINAL_RENDER_OPTION_NOT_APPLICABLE', feature: 'xyChart.useMaxWidth',
    message: 'xyChart.useMaxWidth=true controls responsive SVG sizing; terminal output uses measured cell width and the terminal width policy.',
  })
  if (hasTitle) {
    for (const field of ['titleFontSize', 'titlePadding'] as const) {
      if (chart.config[field] !== undefined) project(`xyChart.${field}`, chart.config[field], 'the terminal font cell size and wrapped title rows')
    }
  }
  if (hasLegend) {
    for (const field of ['legendFontSize', 'legendPadding'] as const) {
      if (chart.config[field] !== undefined) project(`xyChart.${field}`, chart.config[field], 'single-cell series markers and complete wrapped legend labels')
    }
  }
  for (const name of ['xAxis', 'yAxis'] as const) {
    const axis = chart.config[name]
    if (!axis) continue
    for (const [visible, fields] of [
      [axis.showLabel !== false, ['labelFontSize', 'labelPadding']],
      [!!chart[name].title && axis.showTitle !== false, ['titleFontSize', 'titlePadding']],
      [axis.showTick !== false, ['tickLength', 'tickWidth']],
      [axis.showAxisLine !== false, ['axisLineWidth']],
    ] as const) {
      if (!visible) continue
      for (const field of fields) if (axis[field] !== undefined) {
        project(`xyChart.${name}.${field}`, axis[field], 'single-cell axis/tick glyphs and complete wrapped labels rather than pixel font, padding or stroke dimensions')
      }
    }
  }
  if (hasDataLabels && chart.config.showDataLabelOutsideBar !== true) {
    project('xyChart.showDataLabelOutsideBar', false, 'numeric labels beside bar endpoints; inside-bar text placement is unavailable')
  }
  for (const [field, value] of Object.entries(chart.theme)) {
    if (value === undefined || field === 'plotColorPalette') continue
    if ((field === 'titleColor' && !hasTitle) || (field === 'legendTextColor' && !hasLegend) || (field === 'dataLabelColor' && !hasDataLabels)) continue
    const axisPaint = /^([xy])Axis(Label|Tick|Line|Title)Color$/.exec(field)
    if (axisPaint) {
      const name = axisPaint[1] === 'x' ? 'xAxis' : 'yAxis', axis = chart.config[name]
      const visible = axisPaint[2] === 'Label' ? axis?.showLabel !== false
        : axisPaint[2] === 'Tick' ? axis?.showTick !== false
        : axisPaint[2] === 'Line' ? axis?.showAxisLine !== false
        : !!chart[name].title && axis?.showTitle !== false
      if (!visible) continue
    }
    project(field === 'themeCss' ? 'themeCSS' : `themeVariables.xyChart.${field}`, value, 'the shared terminal theme palette; SVG background, per-axis paints and CSS are not applied')
  }
}

// ============================================================================
// Vertical chart layout + rendering
// ============================================================================

function renderVertical(
  chart: XYChart,
  ch: typeof UNI | typeof ASC,
  theme: AsciiTheme,
  targetWidth?: number,
): TerminalDocument {
  const dataCount = getDataCount(chart)
  if (dataCount === 0) return new TerminalDocument()

  const yRange = chart.yAxis.range!
  const yTicks = valueProjection(yRange, PLOT_HEIGHT, ch.ascii).ticks(linearTicks(yRange.min, yRange.max, 6))
  const yLabels = yTicks.map(v => formatTickValue(v))
  const showYLabels = chart.config.yAxis?.showLabel !== false
  const showXLabels = chart.config.xAxis?.showLabel !== false
  const yGutter = showYLabels ? Math.max(...yLabels.map(visualWidth)) + 1 : 0

  const barEntries = chart.series.flatMap((series, globalIdx) => series.type === 'bar' ? [{ data: series.data, globalIdx, labels: chart.config.showDataLabel ? series.data.map(value => measuredText(formatTickValue(value))) : [] }] : [])
  const valueLabelWidth = barEntries.reduce((maximum, entry) => entry.labels.reduce((width, label) => Math.max(width, label.width), maximum), 0)
  const naturalPlotW = Math.max(PLOT_WIDTH, dataCount * 6)
  const availablePlotW = targetWidth === undefined ? naturalPlotW : targetWidth - yGutter - 3
  const barSeriesCount = barEntries.length
  const minimumBandW = Math.max(2, barSeriesCount * Math.max(1, valueLabelWidth) + Math.max(0, barSeriesCount - 1) + 2)
  const plotW = Math.max(dataCount * minimumBandW, Math.min(naturalPlotW, availablePlotW))
  const plotH = PLOT_HEIGHT
  const bandW = Math.floor(plotW / dataCount)
  const catLabels = getCategoryLabels(chart, dataCount)

  // Canvas dimensions
  const hasTitle = !!chart.title && chart.config.showTitle !== false
  const hasXTitle = !!chart.xAxis.title && chart.config.xAxis?.showTitle !== false
  const hasLegend = chart.config.showLegend !== false && isLegendWorthy(chart.series)
  const plotLeft = yGutter + 1
  const totalW = plotLeft + bandW * dataCount + 2
  const seriesColors = getSeriesColors(chart.series.length, theme, chart.theme.plotColorPalette)
  const header = chartHeader(chart, ch, seriesColors, totalW, hasTitle, hasLegend)
  const plotTop = header.height
  const categoryLines = catLabels.map(label => wrapText(label, Math.max(1, bandW - 1)))
  const categoryRows = showXLabels ? Math.max(1, ...categoryLines.map(lines => lines.length)) : 0
  const xTitleLines = hasXTitle ? wrapText(chart.xAxis.title!, totalW) : []
  const xAxisRow = plotTop + plotH
  const xLabelRow = xAxisRow + 1
  const xTitleRow = xLabelRow + categoryRows
  const totalH = xAxisRow + 1 + categoryRows + xTitleLines.length

  // Create canvas
  const canvas = new TerminalDocument(totalW, totalH)
  canvas.region({ id: 'plot', kind: 'plot' }, { x: plotLeft, y: plotTop, width: bandW * dataCount, height: plotH + 1 })
  return canvas.scope({ id: 'plot', kind: 'plot' }, () => {

  canvas.overlay(header)

  // Scales
  const projection = valueProjection(yRange, plotH, ch.ascii)
  const valueToRow = projection.position
  const bandCenter = (i: number): number => plotLeft + Math.floor(bandW * (i + 0.5))
  const barWidth = Math.max(1, Math.min(Math.floor((Math.max(1, bandW - 2) - Math.max(0, barSeriesCount - 1)) / Math.max(1, barSeriesCount)), 8))
  const barSlotWidth = Math.max(barWidth, valueLabelWidth)
  const barGroupWidth = barSlotWidth * barSeriesCount + Math.max(0, barSeriesCount - 1)
  const barX = (category: number, series: number) => bandCenter(category) - Math.floor(barGroupWidth / 2) + series * (barSlotWidth + 1) + Math.floor((barSlotWidth - barWidth) / 2)

  // 3. Y-axis line + ticks + labels
  for (let row = 0; chart.config.yAxis?.showAxisLine !== false && row <= plotH; row++) {
    const displayRow = plotTop + plotH - row
    stroke(canvas, displayRow, plotLeft - 1, 5, ch, 'border')
  }
  // Origin
  if (chart.config.xAxis?.showAxisLine !== false || chart.config.yAxis?.showAxisLine !== false) stroke(canvas, xAxisRow, plotLeft - 1, 15, ch, 'border')

  for (const tick of yTicks) {
    const row = valueToRow(tick)
    if (row < 0 || row > plotH) continue
    const displayRow = plotTop + plotH - row
    const label = formatTickValue(tick)
    // Tick mark on axis
    if (chart.config.yAxis?.showTick !== false) stroke(canvas, displayRow, plotLeft - 1, row === 0 ? 15 : 13, ch, 'border')
    // Label
    if (showYLabels) {
      const labelStart = yGutter - visualWidth(label)
      writeText(canvas, displayRow, Math.max(0, labelStart), label, 'text', { id: `y-tick-${tick}`, kind: 'label' })
    }
  }

  // 4. X-axis line + ticks + labels
  for (let c = plotLeft; chart.config.xAxis?.showAxisLine !== false && c < plotLeft + bandW * dataCount; c++) {
    stroke(canvas, xAxisRow, c, 10, ch, 'border')
  }
  for (let i = 0; i < dataCount; i++) {
    const cx = bandCenter(i)
    if (chart.config.xAxis?.showTick !== false) stroke(canvas, xAxisRow, cx, 14, ch, 'border')
    if (showXLabels && xLabelRow >= 0) {
      categoryLines[i]!.forEach((label, row) => {
        const labelStart = cx - Math.floor(visualWidth(label) / 2)
        writeText(canvas, xLabelRow + row, Math.max(0, labelStart), label, 'text', { id: `x-category-${i}`, kind: 'node' })
      })
    }
  }

  xTitleLines.forEach((title, row) => {
    writeText(canvas, xTitleRow + row, Math.max(0, Math.floor((totalW - visualWidth(title)) / 2)), title, 'text', { id: 'x-axis', kind: 'label' })
  })

  const dataLabels = valueLabelReservations()
  if (chart.config.showDataLabel) for (const [barIndex, entry] of barEntries.entries()) {
    const baselineEdge = projection.edge(barBaselineValue(yRange))
    for (const [index, value] of entry.data.entries()) {
      const label = entry.labels[index]!, valueEdge = projection.edge(value)
      const top = plotTop + plotH - Math.ceil(Math.max(baselineEdge, valueEdge))
      const bottom = plotTop + plotH - Math.floor(Math.min(baselineEdge, valueEdge))
      const row = value >= 0 ? Math.max(plotTop, top - 1) : Math.min(xAxisRow - 1, bottom + 1)
      const column = Math.max(plotLeft, barX(index, barIndex) + Math.floor(barWidth / 2) - Math.floor(label.width / 2))
      dataLabels.reserve(column, row, label, seriesColors[entry.globalIdx]!, { id: `series-${entry.globalIdx}:value-${index}`, kind: 'label', parent: { id: `series-${entry.globalIdx}`, kind: 'node' } })
    }
  }

  // 6. Grid lines (subtle horizontal dots at y-tick positions)
  for (const tick of yTicks) {
    const row = valueToRow(tick)
    if (row < 0 || row > plotH) continue
    const displayRow = plotTop + plotH - row
    for (let c = plotLeft; c < plotLeft + bandW * dataCount; c++) {
      if (!dataLabels.has(c, displayRow) && get(canvas, displayRow, c) === ' ') {
        set(canvas, displayRow, c, ch.grid, 'line')
      }
    }
  }

  // 7. Bars — track global series index for per-series colors
  if (barEntries.length > 0) {
    const baseline = barBaselineValue(yRange)

    for (let bIdx = 0; bIdx < barEntries.length; bIdx++) {
      const entry = barEntries[bIdx]!
      const hexColor = seriesColors[entry.globalIdx]!
      for (let i = 0; i < entry.data.length; i++) {
        const bx = barX(i, bIdx)
        const value = entry.data[i]!
        canvas.scope({ id: `series-${entry.globalIdx}`, kind: 'node' }, () => {
          for (const { cell, coverage } of projection.coverage(baseline, value)) {
            const displayRow = plotTop + plotH - 1 - cell
            for (let c = bx; c < bx + barWidth; c++) canvas.numericMark(c, displayRow, { axis: 'vertical', coverage, ascii: ch.ascii }, { role: 'arrow', color: hexColor })
          }
        })
        if (chart.config.showDataLabel) dataLabels.paint(canvas, `series-${entry.globalIdx}:value-${i}`)
      }
    }
  }

  // 8. Lines (staircase routing with rounded corners)
  const lineEntries: { data: number[]; globalIdx: number }[] = []
  for (let si = 0; si < chart.series.length; si++) {
    if (chart.series[si]!.type === 'line') lineEntries.push({ data: chart.series[si]!.data, globalIdx: si })
  }

  for (let lineIdx = 0; lineIdx < lineEntries.length; lineIdx++) {
    const entry = lineEntries[lineIdx]!
    if (entry.data.length === 0) continue
    const hexColor = seriesColors[entry.globalIdx]!
    canvas.scope({ id: `series-${entry.globalIdx}`, kind: 'node' }, () => {
      drawStaircaseLine(canvas, entry.data, bandCenter, valueToRow, plotTop, plotH, plotLeft, bandW * dataCount, ch, hexColor, dataLabels.has)
    })
  }

  return canvas
  })
}

// ============================================================================
// Horizontal chart layout + rendering
// ============================================================================

function renderHorizontal(
  chart: XYChart,
  ch: typeof UNI | typeof ASC,
  theme: AsciiTheme,
  targetWidth?: number,
  hardWidth?: number,
): TerminalDocument {
  const dataCount = getDataCount(chart)
  if (dataCount === 0) return new TerminalDocument()

  const yRange = chart.yAxis.range!
  const catLabels = getCategoryLabels(chart, dataCount)
  const showCategoryLabels = chart.config.xAxis?.showLabel !== false
  const showValueLabels = chart.config.yAxis?.showLabel !== false
  const categoryBudget = targetWidth === undefined ? undefined : Math.max(1, Math.floor(targetWidth / 3))
  const categoryLines = catLabels.map(label => wrapText(label, categoryBudget))
  const catGutter = showCategoryLabels ? Math.max(...categoryLines.flat().map(visualWidth)) + 1 : 0
  const hasTitle = !!chart.title && chart.config.showTitle !== false
  const hasYTitle = !!chart.yAxis.title && chart.config.yAxis?.showTitle !== false

  // Horizontal charts spend one band per category vertically. Category count
  // must not also widen the value axis: that made both canvas dimensions O(n)
  // and allocated three O(n^2) matrices before the shared targetWidth check.
  // Reject an actually impossible fixed-width frame before deriving its height
  // or allocating any canvases.
  const plotLeft = catGutter + 1
  const dataLabelPad = chart.config.showDataLabel ? 12 : 2
  const endpointWidth = [yRange.min, yRange.max].reduce((sum, value) => sum + visualWidth(formatTickValue(value)), 1)
  const minimumPlotW = Math.max(1, showValueLabels ? endpointWidth - plotLeft - dataLabelPad : 1)
  const minimumRequiredWidth = plotLeft + minimumPlotW
  if (hardWidth !== undefined && minimumRequiredWidth > hardWidth) {
    const visibleText = [
      ...(hasTitle ? [chart.title] : []),
      ...(hasYTitle ? [chart.yAxis.title] : []),
      ...(showCategoryLabels ? catLabels : []),
    ].filter(
      (value): value is string => value !== undefined,
    )
    const hasTooWideGrapheme = visibleText.some(value =>
      graphemes(value).some(cluster => visualWidth(cluster) > hardWidth),
    )
    throw new AsciiWidthError(
      hardWidth,
      minimumRequiredWidth,
      'xychart',
      hasTooWideGrapheme ? 'UNBREAKABLE_GRAPHEME' : 'MINIMUM_GEOMETRY',
    )
  }

  const naturalPlotW = Math.max(PLOT_WIDTH, 40)
  const availablePlotW = targetWidth === undefined ? naturalPlotW : targetWidth - catGutter - 2 - dataLabelPad
  const plotW = Math.max(minimumPlotW, Math.min(naturalPlotW, availablePlotW))
  const barSeriesCount = chart.series.filter(series => series.type === 'bar').length
  const bandH = Math.max(2, barSeriesCount * 2, ...categoryLines.map(lines => lines.length), Math.floor(PLOT_HEIGHT / dataCount))
  const plotH = bandH * dataCount

  const hasLegend = chart.config.showLegend !== false && isLegendWorthy(chart.series)
  const totalW = plotLeft + plotW + dataLabelPad
  const seriesColors = getSeriesColors(chart.series.length, theme, chart.theme.plotColorPalette)
  const header = chartHeader(chart, ch, seriesColors, totalW, hasTitle, hasLegend)
  const plotTop = header.height
  const yTitleLines = hasYTitle ? wrapText(chart.yAxis.title!, totalW) : []
  const totalH = plotTop + plotH + 1 + (showValueLabels ? 1 : 0) + yTitleLines.length
  const xAxisRow = plotTop + plotH

  const canvas = new TerminalDocument(totalW, totalH)
  canvas.region({ id: 'plot', kind: 'plot' }, { x: plotLeft, y: plotTop, width: plotW, height: plotH })
  return canvas.scope({ id: 'plot', kind: 'plot' }, () => {

  canvas.overlay(header)

  // Value scale (horizontal)
  const projection = valueProjection(yRange, plotW, ch.ascii)
  const valueTicks = projection.ticks(linearTicks(yRange.min, yRange.max, 6))
  const valueToCol = (value: number): number => plotLeft + projection.position(value)
  const bandMid = (i: number): number => plotTop + Math.floor(bandH * (i + 0.5))

  // Y-axis (category axis on left)
  for (let r = plotTop; chart.config.xAxis?.showAxisLine !== false && r < plotTop + plotH; r++) {
    stroke(canvas, r, plotLeft - 1, 5, ch, 'border')
  }
  if (chart.config.xAxis?.showAxisLine !== false || chart.config.yAxis?.showAxisLine !== false) stroke(canvas, xAxisRow, plotLeft - 1, 15, ch, 'border')

  for (let i = 0; i < dataCount; i++) {
    const my = bandMid(i)
    if (showCategoryLabels) categoryLines[i]!.forEach((label, row) => {
      const labelStart = catGutter - visualWidth(label)
      const top = my - Math.floor((categoryLines[i]!.length - 1) / 2)
      writeText(canvas, top + row, Math.max(0, labelStart), label, 'text', { id: `x-category-${i}`, kind: 'node' })
    })
  }

  // X-axis (value axis on bottom)
  for (let c = plotLeft; chart.config.yAxis?.showAxisLine !== false && c < plotLeft + plotW; c++) {
    stroke(canvas, xAxisRow, c, 10, ch, 'border')
  }
  const tickLabelStarts = new Map<number, number>()
  // Endpoints describe the authored domain. Admit interior labels only when
  // they leave a separating cell on the same numeric lattice.
  for (const tick of [yRange.min, yRange.max, ...valueTicks]) {
    if (tickLabelStarts.has(tick)) continue
    const labelWidth = visualWidth(formatTickValue(tick))
    const start = Math.max(0, Math.min(totalW - labelWidth, valueToCol(tick) - Math.floor(labelWidth / 2)))
    if ([...tickLabelStarts].every(([other, x]) => start > x + visualWidth(formatTickValue(other)) || start + labelWidth < x)) tickLabelStarts.set(tick, start)
  }
  for (const tick of valueTicks) {
    const cx = valueToCol(tick)
    if (cx < plotLeft || cx > plotLeft + plotW) continue
    if (chart.config.yAxis?.showTick !== false) stroke(canvas, xAxisRow, cx, 14, ch, 'border')
    if (showValueLabels && tickLabelStarts.has(tick)) {
      const label = formatTickValue(tick)
      writeText(canvas, xAxisRow + 1, tickLabelStarts.get(tick)!, label, 'text', { id: `y-tick-${tick}`, kind: 'label' })
    }
  }

  yTitleLines.forEach((title, row) => {
    writeText(canvas, totalH - yTitleLines.length + row, Math.max(0, Math.floor((totalW - visualWidth(title)) / 2)), title, 'text', { id: 'y-axis', kind: 'label' })
  })

  const barEntries = chart.series.flatMap((series, globalIdx) => series.type === 'bar' ? [{ data: series.data, globalIdx, labels: chart.config.showDataLabel ? series.data.map(value => measuredText(formatTickValue(value))) : [] }] : [])
  const singleBarH = 1
  const groupH = singleBarH * barEntries.length + (barEntries.length - 1)
  const dataLabels = valueLabelReservations()
  if (chart.config.showDataLabel) for (const [barIndex, entry] of barEntries.entries()) {
    const baselineEdge = plotLeft + projection.edge(barBaselineValue(yRange))
    for (const [index, value] of entry.data.entries()) {
      const label = entry.labels[index]!, valueEdge = plotLeft + projection.edge(value)
      const column = value >= 0
        ? Math.min(totalW - label.width, Math.ceil(Math.max(baselineEdge, valueEdge)) + 2)
        : Math.max(plotLeft, Math.floor(Math.min(baselineEdge, valueEdge)) - label.width - 1)
      const row = bandMid(index) - Math.floor(groupH / 2) + barIndex * (singleBarH + 1)
      dataLabels.reserve(column, row, label, seriesColors[entry.globalIdx]!, { id: `series-${entry.globalIdx}:value-${index}`, kind: 'label', parent: { id: `series-${entry.globalIdx}`, kind: 'node' } })
    }
  }

  // Grid lines (vertical at value tick positions)
  for (const tick of valueTicks) {
    const cx = valueToCol(tick)
    if (cx < plotLeft || cx > plotLeft + plotW) continue
    for (let r = plotTop; r < plotTop + plotH; r++) {
      if (!dataLabels.has(cx, r) && get(canvas, r, cx) === ' ') {
        set(canvas, r, cx, ch.grid, 'line')
      }
    }
  }

  // Bars (horizontal) — with per-series colors
  if (barEntries.length > 0) {
    const baseline = barBaselineValue(yRange)

    for (let bIdx = 0; bIdx < barEntries.length; bIdx++) {
      const entry = barEntries[bIdx]!
      const hexColor = seriesColors[entry.globalIdx]!
      for (let i = 0; i < entry.data.length; i++) {
        const my = bandMid(i)
        const groupTop = my - Math.floor(groupH / 2)
        const by = groupTop + bIdx * (singleBarH + 1)
        const value = entry.data[i]!
        canvas.scope({ id: `series-${entry.globalIdx}`, kind: 'node' }, () => {
          for (let r = by; r < by + singleBarH; r++) {
            for (const { cell, coverage } of projection.coverage(baseline, value)) canvas.numericMark(plotLeft + cell, r, { axis: 'horizontal', coverage, ascii: ch.ascii }, { role: 'arrow', color: hexColor })
          }
        })
        if (chart.config.showDataLabel) dataLabels.paint(canvas, `series-${entry.globalIdx}:value-${i}`)
      }
    }
  }

  // Lines (horizontal staircase: value on x, category on y) — with per-series colors
  const lineEntries: { data: number[]; globalIdx: number }[] = []
  for (let si = 0; si < chart.series.length; si++) {
    if (chart.series[si]!.type === 'line') lineEntries.push({ data: chart.series[si]!.data, globalIdx: si })
  }

  for (let lineIdx = 0; lineIdx < lineEntries.length; lineIdx++) {
    const entry = lineEntries[lineIdx]!
    if (entry.data.length === 0) continue
    const hexColor = seriesColors[entry.globalIdx]!
    canvas.scope({ id: `series-${entry.globalIdx}`, kind: 'node' }, () => {
      drawHorizontalStaircaseLine(canvas, entry.data, bandMid, valueToCol, plotTop, plotH, plotLeft, plotW, ch, hexColor, dataLabels.has)
    })
  }

  return canvas
  })
}

// ============================================================================
// Staircase line drawing — vertical charts
//
// Connects data points with flat segments (─) at each value's row,
// vertical segments (│) between rows, and rounded corners (╭╮╰╯)
// at transitions. The vertical step happens at the midpoint column
// between adjacent data points.
// ============================================================================

function drawStaircaseLine(
  canvas: TerminalDocument,
  data: number[],
  bandCenter: (i: number) => number,
  valueToRow: (v: number) => number,
  plotTop: number,
  plotH: number,
  plotLeft: number,
  plotTotalW: number,
  ch: typeof UNI | typeof ASC,
  hexColor?: string | null,
  reserved?: (x: number, y: number) => boolean,
): void {
  if (data.length === 0) return

  const points = data.map((v, i) => ({
    col: bandCenter(i),
    row: valueToRow(v),
  }))

  // Helper to draw on the canvas (row 0 = bottom, displayed inverted)
  const drawAt = (col: number, row: number, ports: number) => {
    const displayRow = plotTop + plotH - row
    if (displayRow >= 0 && col >= plotLeft && col < plotLeft + plotTotalW && !reserved?.(col, displayRow)) {
      stroke(canvas, displayRow, col, ports, ch, 'arrow', hexColor, true)
    }
  }

  // Single point: just draw a flat segment
  if (points.length === 1) {
    drawAt(points[0]!.col, points[0]!.row, 10)
    return
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!
    const p2 = points[i + 1]!

    if (p1.row === p2.row) {
      // Flat: draw ─ across
      for (let c = p1.col; c <= p2.col; c++) {
        drawAt(c, p1.row, 10)
      }
      continue
    }

    const midCol = Math.round((p1.col + p2.col) / 2)
    const goingUp = p2.row > p1.row

    // 1. Flat at p1's row from p1.col to midCol-1
    for (let c = p1.col; c < midCol; c++) {
      drawAt(c, p1.row, 10)
    }

    // 2. Corner at (midCol, p1.row)
    //    goingUp:   ─ from LEFT, │ going UP   → LEFT+TOP  = ╯ (cornerBR)
    //    goingDown: ─ from LEFT, │ going DOWN  → LEFT+BOT  = ╮ (cornerTR)
    if (goingUp) {
      drawAt(midCol, p1.row, 9) // ╯
    } else {
      drawAt(midCol, p1.row, 12) // ╮
    }

    // 3. Vertical from p1.row to p2.row (exclusive of endpoints)
    const minRow = Math.min(p1.row, p2.row)
    const maxRow = Math.max(p1.row, p2.row)
    for (let row = minRow + 1; row < maxRow; row++) {
      drawAt(midCol, row, 5)
    }

    // 4. Corner at (midCol, p2.row)
    //    goingUp:   │ from BOTTOM, ─ going RIGHT → BOT+RIGHT = ╭ (cornerTL)
    //    goingDown: │ from TOP, ─ going RIGHT     → TOP+RIGHT = ╰ (cornerBL)
    if (goingUp) {
      drawAt(midCol, p2.row, 6) // ╭
    } else {
      drawAt(midCol, p2.row, 3) // ╰
    }

    // 5. Flat at p2's row from midCol+1 to p2.col
    for (let c = midCol + 1; c <= p2.col; c++) {
      drawAt(c, p2.row, 10)
    }

    // Leading flat for first segment (before p1.col)
    if (i === 0) {
      const leadStart = Math.max(plotLeft, p1.col - Math.floor((p2.col - p1.col) / 4))
      for (let c = leadStart; c < p1.col; c++) {
        drawAt(c, p1.row, 10)
      }
    }

    // Trailing flat for last segment (after p2.col)
    if (i === points.length - 2) {
      const trailEnd = Math.min(plotLeft + plotTotalW - 1, p2.col + Math.floor((p2.col - p1.col) / 4))
      for (let c = p2.col + 1; c <= trailEnd; c++) {
        drawAt(c, p2.row, 10)
      }
    }
  }
}

// ============================================================================
// Staircase line drawing — horizontal charts
//
// Same staircase approach but with axes swapped:
// data values map to columns (horizontal position) and categories map to
// rows (vertical position). Flat segments are vertical (│), transitions
// are horizontal (─), with the same rounded corners.
// ============================================================================

function drawHorizontalStaircaseLine(
  canvas: TerminalDocument,
  data: number[],
  bandMid: (i: number) => number,
  valueToCol: (v: number) => number,
  plotTop: number,
  plotH: number,
  plotLeft: number,
  plotW: number,
  ch: typeof UNI | typeof ASC,
  hexColor?: string | null,
  reserved?: (x: number, y: number) => boolean,
): void {
  if (data.length === 0) return

  const points = data.map((v, i) => ({
    row: bandMid(i),
    col: valueToCol(v),
  }))

  const drawAt = (row: number, col: number, ports: number) => {
    if (row >= plotTop && row < plotTop + plotH && col >= plotLeft && col <= plotLeft + plotW && !reserved?.(col, row)) {
      stroke(canvas, row, col, ports, ch, 'arrow', hexColor, true)
    }
  }

  if (points.length === 1) {
    drawAt(points[0]!.row, points[0]!.col, 5)
    return
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!
    const p2 = points[i + 1]!

    if (p1.col === p2.col) {
      // Same value: draw │ down
      for (let r = p1.row; r <= p2.row; r++) {
        drawAt(r, p1.col, 5)
      }
      continue
    }

    const midRow = Math.round((p1.row + p2.row) / 2)
    const goingRight = p2.col > p1.col

    // 1. Vertical at p1's col from p1.row to midRow-1
    for (let r = p1.row; r < midRow; r++) {
      drawAt(r, p1.col, 5)
    }

    // 2. Corner at (midRow, p1.col)
    //    goingRight: │ from TOP, ─ going RIGHT → TOP+RIGHT = ╰ (cornerBL)
    //    goingLeft:  │ from TOP, ─ going LEFT  → TOP+LEFT  = ╯ (cornerBR)
    if (goingRight) {
      drawAt(midRow, p1.col, 3) // ╰
    } else {
      drawAt(midRow, p1.col, 9) // ╯
    }

    // 3. Horizontal from p1.col to p2.col (exclusive)
    const minCol = Math.min(p1.col, p2.col)
    const maxCol = Math.max(p1.col, p2.col)
    for (let c = minCol + 1; c < maxCol; c++) {
      drawAt(midRow, c, 10)
    }

    // 4. Corner at (midRow, p2.col)
    //    goingRight: ─ from LEFT, │ going DOWN  → LEFT+BOT  = ╮ (cornerTR)
    //    goingLeft:  ─ from RIGHT, │ going DOWN → RIGHT+BOT = ╭ (cornerTL)
    if (goingRight) {
      drawAt(midRow, p2.col, 12) // ╮
    } else {
      drawAt(midRow, p2.col, 6) // ╭
    }

    // 5. Vertical at p2's col from midRow+1 to p2.row
    for (let r = midRow + 1; r <= p2.row; r++) {
      drawAt(r, p2.col, 5)
    }
  }
}

// ============================================================================
// Legend — shows series symbols with per-series colors
// ============================================================================

function chartHeader(chart: XYChart, ch: typeof UNI | typeof ASC, colors: string[], width: number, hasTitle: boolean, hasLegend: boolean): TerminalDocument {
  const document = new TerminalDocument()
  if (hasTitle) {
    for (const text of wrapText(chart.title!, width)) {
      const row = document.height
      document.textBlock(Math.max(0, Math.floor((width - visualWidth(text)) / 2)), row, text, { role: 'text', textGroup: 'title', owner: { id: 'title', kind: 'label' } })
    }
  }
  if (hasLegend) {
    let runs: import('./terminal-document.ts').TerminalRun[] = []
    let used = 0
    const flush = () => {
      if (runs.length > 0) { document.line([{ text: ' '.repeat(Math.max(0, Math.floor((width - used) / 2))), kind: 'surface' }, ...runs]); runs = []; used = 0 }
    }
    for (const entry of legendEntries(chart.series)) {
      const symbol = entry.type === 'bar' ? ch.bar : ch.hLine
      const owner = { id: `series-${entry.colorIndex}`, kind: 'node' as const }
      const lines = wrapText(entry.label, Math.max(1, width - 2))
      lines.forEach((text, index) => {
        const size = 2 + visualWidth(text)
        if (runs.length > 0 && (index > 0 || used + 2 + size > width)) flush()
        if (runs.length > 0) { runs.push({ text: '  ', kind: 'surface' }); used += 2 }
        runs.push({ text: symbol, role: 'arrow', kind: 'marker', color: colors[entry.colorIndex]!, owner }, { text: ' ', kind: 'surface' }, { text, role: 'text', textGroup: 'legend', owner })
        used += size
      })
    }
    flush()
  }
  if (hasTitle) document.line()
  return document
}

// ============================================================================
// Canvas utilities
// ============================================================================

function stroke(canvas: TerminalDocument, row: number, col: number, ports: number, ch: typeof UNI | typeof ASC, role: CharRole, color?: string | null, rounded = false): void {
  if (col >= 0 && col < canvas.width && row >= 0 && row < canvas.height) {
    canvas.stroke(col, row, ports, { ascii: ch.ascii, rounded, role, ...(color ? { color } : {}) })
  }
}

/** Grid dots are decorative samples, rather than composable route ink. */
function set(canvas: TerminalDocument, row: number, col: number, glyph: string, role: CharRole): void {
  if (col >= 0 && col < canvas.width && row >= 0 && row < canvas.height) canvas.put(col, row, glyph, { role, kind: 'stroke' })
}

function get(canvas: TerminalDocument, row: number, col: number): string {
  return canvas.get(col, row)
}

function writeText(canvas: TerminalDocument, row: number, col: number, text: string, role: CharRole, owner?: TerminalOwner): void {
  if (col >= 0 && row >= 0) canvas.textBlock(col, row, text, { role, owner, textGroup: owner?.id })
}


/** One affine domain projection. Ticks/lines round to the nearest cell boundary
 * (error <= 1/2 cell); Unicode bar boundaries round to half cells (<= 1/4),
 * ASCII bar boundaries to whole cells (<= 1/2). The authored domain is unchanged.
 * Bars cover the interval between baseline and value, so zero paints no cell. */
function valueProjection(range: { min: number; max: number }, extent: number, ascii: boolean) {
  const scale = quantizedScale(range, extent)
  return {
    edge: (value: number): number => scale.position(value, ascii ? 1 : 2),
    position: scale.position,
    ticks: scale.ticks,
    coverage(start: number, end: number): Array<{ cell: number; coverage: 1 | 2 | 3 }> {
      return scale.interval(start, end, ascii ? 1 : 2).map(({ index, coverage }) => ({ cell: index, coverage: coverage as 1 | 2 | 3 }))
    },
  }
}

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderXYChartAscii(...args: Parameters<typeof renderXYChartTerminal>): string {
  return serializeTerminalArtifact(renderXYChartTerminal(...args))
}
