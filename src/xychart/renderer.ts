import type { PositionedBar, PositionedXYChart } from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { TEXT_BASELINE_SHIFT, estimateTextWidth, STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK } from './colors.ts'

// ============================================================================
// XY Chart SVG renderer
//
// Rendered output now tracks Mermaid's own xychart structure more closely:
// fixed chart dimensions, explicit axis lines/ticks, simple grid lines,
// straight line segments, and in-bar data labels for bar plots.
// ============================================================================

const CHART_FONT = {
  titleWeight: 500,
  axisTitleWeight: 400,
  labelWeight: 400,
  dotRadius: 4,
  lineWidth: 3,
} as const

const XY_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: 14,
  edgeLabelFontSize: 16,
  groupHeaderFontSize: 20,
  nodeLabelFontWeight: CHART_FONT.labelWeight,
  edgeLabelFontWeight: CHART_FONT.axisTitleWeight,
  groupHeaderFontWeight: CHART_FONT.titleWeight,
  nodePaddingX: 0,
  nodePaddingY: 0,
  nodeLineWidth: 0,
  edgeLineWidth: CHART_FONT.lineWidth,
  groupCornerRadius: 0,
  groupPaddingX: 0,
  groupPaddingY: 0,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

const TIP = {
  fontSize: 15,
  fontWeight: 500,
  height: 32,
  padX: 14,
  offsetY: 12,
  rx: 8,
  minY: 4,
  pointerSize: 6,
} as const

export function renderXYChartSvg(
  chart: PositionedXYChart,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  interactive: boolean = false,
  options: RenderOptions = {},
): string {
  const parts: string[] = []
  const style = resolveRenderStyle(options, XY_STYLE_DEFAULTS)

  const maxColorIdx = Math.max(0, ...chart.bars.map(bar => bar.colorIndex), ...chart.lines.map(line => line.colorIndex))
  const svgMeta = buildSvgMetadata(chart)
  const svgTag = svgOpenTag(chart.width, chart.height, colors, transparent, svgMeta.openTag)
    .replace('<svg ', `<svg data-xychart-colors="${maxColorIdx}" `)
  parts.push(svgTag)
  parts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))

  const { style: chartStyle, defs } = chartStyles(chart, interactive, colors.accent, colors.bg, options)
  parts.push(chartStyle)
  if (defs) parts.push(defs)
  if (svgMeta.title) parts.push(svgMeta.title)
  if (svgMeta.description) parts.push(svgMeta.description)

  for (const gridLine of chart.gridLines) {
    parts.push(
      `<line x1="${r(gridLine.x1)}" y1="${r(gridLine.y1)}" x2="${r(gridLine.x2)}" y2="${r(gridLine.y2)}" class="xychart-grid"/>`
    )
  }

  renderAxis(parts, chart.xAxis, 'x')
  renderAxis(parts, chart.yAxis, 'y')

  const barOverlay: string[] = []
  for (const bar of chart.bars) {
    const dataAttrs = ` data-value="${bar.value}"${bar.label ? ` data-label="${escapeXml(bar.label)}"` : ''}`
    parts.push(
      `<rect x="${r(bar.x)}" y="${r(bar.y)}" width="${r(bar.width)}" height="${r(bar.height)}" ` +
      `class="xychart-bar xychart-color-${bar.colorIndex}"${dataAttrs}/>`
    )

    if (interactive) {
      const tipText = formatTipValue(bar.value)
      const tipTitle = bar.label ? `${bar.label}: ${tipText}` : tipText
      const tipAnchorX = chart.horizontal ? bar.x + bar.width : bar.x + bar.width / 2
      const tipAnchorY = chart.horizontal ? bar.y + bar.height / 2 : bar.y
      barOverlay.push(
        `<g class="xychart-bar-group">` +
        `<rect x="${r(bar.x)}" y="${r(bar.y)}" width="${r(bar.width)}" height="${r(bar.height)}" fill="transparent"/>` +
        `<title>${escapeXml(tipTitle)}</title>` +
        tooltipAbove(tipAnchorX, tipAnchorY, tipText) +
        `</g>`
      )
    }
  }

  for (const line of chart.lines) {
    if (line.points.length === 0) continue
    parts.push(`<path d="${polylinePath(line.points)}" class="xychart-line xychart-color-${line.colorIndex}"/>`)
  }

  const dotOverlay: string[] = []
  if (interactive) {
    for (const line of chart.lines) {
      for (const point of line.points) {
        const dataAttrs = ` data-value="${point.value}"${point.label ? ` data-label="${escapeXml(point.label)}"` : ''}`
        const tipText = formatTipValue(point.value)
        const tipTitle = point.label ? `${point.label}: ${tipText}` : tipText
        dotOverlay.push(
          `<g class="xychart-dot-group">` +
          `<circle cx="${r(point.x)}" cy="${r(point.y)}" r="${CHART_FONT.dotRadius * 3}" fill="transparent" class="xychart-hit"/>` +
          `<circle cx="${r(point.x)}" cy="${r(point.y)}" r="${CHART_FONT.dotRadius}" class="xychart-dot xychart-color-${line.colorIndex}"${dataAttrs}/>` +
          `<title>${escapeXml(tipTitle)}</title>` +
          tooltipAbove(point.x, point.y - CHART_FONT.dotRadius, tipText) +
          `</g>`
        )
      }
    }
  }

  if (chart.config.showDataLabel) {
    for (const label of buildBarDataLabels(chart.bars, chart.horizontal ?? false)) {
      parts.push(
        `<text x="${r(label.x)}" y="${r(label.y)}" text-anchor="${label.anchor}" ` +
        `${label.dominantBaseline ? `dominant-baseline="${label.dominantBaseline}" ` : ''}` +
        `font-size="${label.fontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)} class="xychart-data-label">${escapeXml(label.text)}</text>`
      )
    }
  }

  renderAxisLabels(parts, chart.xAxis.ticks, chart.xAxis.config.labelFontSize, 'x', style)
  renderAxisLabels(parts, chart.yAxis.ticks, chart.yAxis.config.labelFontSize, 'y', style)

  if (chart.xAxis.title) {
    const title = chart.xAxis.title
    const transform = title.rotate ? ` transform="rotate(${title.rotate},${title.x},${title.y})"` : ''
    parts.push(
      `<text x="${title.x}" y="${title.y}" text-anchor="middle"${transform} ` +
      `font-size="${chart.xAxis.config.titleFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="xychart-axis-title xychart-x-axis-title">${escapeXml(title.text)}</text>`
    )
  }

  if (chart.yAxis.title) {
    const title = chart.yAxis.title
    const transform = title.rotate ? ` transform="rotate(${title.rotate},${title.x},${title.y})"` : ''
    parts.push(
      `<text x="${title.x}" y="${title.y}" text-anchor="middle"${transform} ` +
      `font-size="${chart.yAxis.config.titleFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="xychart-axis-title xychart-y-axis-title">${escapeXml(title.text)}</text>`
    )
  }

  if (chart.title) {
    parts.push(
      `<text x="${chart.title.x}" y="${chart.title.y}" text-anchor="middle" ` +
      `font-size="${chart.config.titleFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)} ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="xychart-title">${escapeXml(chart.title.text)}</text>`
    )
  }

  for (const group of barOverlay) parts.push(group)
  for (const group of dotOverlay) parts.push(group)

  parts.push('</svg>')
  return parts.join('\n')
}

function renderAxis(parts: string[], axis: PositionedXYChart['xAxis'], axisName: 'x' | 'y'): void {
  if (axis.config.showAxisLine) {
    parts.push(
      `<line x1="${r(axis.line.x1)}" y1="${r(axis.line.y1)}" x2="${r(axis.line.x2)}" y2="${r(axis.line.y2)}" ` +
      `class="xychart-axis-line xychart-${axisName}-axis-line" stroke-width="${axis.config.axisLineWidth}"/>`
    )
  }

  if (!axis.config.showTick) return
  for (const tick of axis.ticks) {
    parts.push(
      `<line x1="${r(tick.x)}" y1="${r(tick.y)}" x2="${r(tick.tx)}" y2="${r(tick.ty)}" ` +
      `class="xychart-tick xychart-${axisName}-tick" stroke-width="${axis.config.tickWidth}"/>`
    )
  }
}

function renderAxisLabels(
  parts: string[],
  ticks: PositionedXYChart['xAxis']['ticks'],
  fontSize: number,
  axisName: 'x' | 'y',
  style: ReturnType<typeof resolveRenderStyle>,
): void {
  for (const tick of ticks) {
    const middleBaseline = tick.textAnchor === 'end' ? ' dominant-baseline="middle"' : ''
    const dy = tick.textAnchor === 'end' ? '' : ` dy="${TEXT_BASELINE_SHIFT}"`
    parts.push(
      `<text x="${tick.labelX}" y="${tick.labelY}" text-anchor="${tick.textAnchor}"${middleBaseline} ` +
      `font-size="${fontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}${dy} class="xychart-label xychart-${axisName}-label">` +
      `${escapeXml(tick.label)}</text>`
    )
  }
}

function chartStyles(
  chart: PositionedXYChart,
  interactive: boolean,
  themeAccent?: string,
  bgColor?: string,
  options: RenderOptions = {},
): { style: string; defs: string } {
  const renderStyle = resolveRenderStyle(options, XY_STYLE_DEFAULTS)
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const themeOverrides = chart.theme
  const colorIndices = new Set<number>()
  for (const bar of chart.bars) colorIndices.add(bar.colorIndex)
  for (const line of chart.lines) colorIndices.add(line.colorIndex)

  const colorVarDefs: string[] = []
  const explicitPalette = themeOverrides.plotColorPalette
  for (const index of [...colorIndices].sort((a, b) => a - b)) {
    const value = explicitPalette && explicitPalette.length > 0
      ? explicitPalette[index % explicitPalette.length]!
      : (index === 0 ? `var(--accent, ${CHART_ACCENT_FALLBACK})` : getSeriesColor(index, accentHex, bgColor))
    colorVarDefs.push(`    --xychart-color-${index}: ${value};`)
  }

  const seriesRules: string[] = []
  for (const index of [...colorIndices].sort((a, b) => a - b)) {
    const color = `var(--xychart-color-${index})`
    seriesRules.push(`  .xychart-bar.xychart-color-${index} { fill: ${color}; }`)
    seriesRules.push(`  path.xychart-color-${index}, line.xychart-color-${index} { stroke: ${color}; }`)
    seriesRules.push(`  circle.xychart-color-${index} { fill: ${color}; }`)
  }

  const tipRules = interactive ? `
  .xychart-tip { opacity: 0; pointer-events: none; }
  .xychart-tip-bg { fill: var(--_text); }
  .xychart-tip-text { fill: var(--bg); font-size: ${TIP.fontSize}px; font-weight: ${TIP.fontWeight}; }
  .xychart-tip-ptr { fill: var(--_text); }
  .xychart-bar-group:hover .xychart-tip,
  .xychart-dot-group:hover .xychart-tip { opacity: 1; }` : ''

  const titleColor = themeOverrides.titleColor ?? 'var(--_text)'
  const xAxisLabelColor = themeOverrides.xAxisLabelColor ?? 'var(--_text)'
  const yAxisLabelColor = themeOverrides.yAxisLabelColor ?? 'var(--_text)'
  const xAxisTickColor = themeOverrides.xAxisTickColor ?? 'var(--_text-sec)'
  const yAxisTickColor = themeOverrides.yAxisTickColor ?? 'var(--_text-sec)'
  const xAxisLineColor = themeOverrides.xAxisLineColor ?? 'var(--_text-sec)'
  const yAxisLineColor = themeOverrides.yAxisLineColor ?? 'var(--_text-sec)'
  const xAxisTitleColor = themeOverrides.xAxisTitleColor ?? 'var(--_text)'
  const yAxisTitleColor = themeOverrides.yAxisTitleColor ?? 'var(--_text)'
  const colorVarsBlock = colorVarDefs.length > 0 ? `\n  svg {\n${colorVarDefs.join('\n')}\n  }` : ''

  const extraThemeCss = chart.theme.themeCss ? `\n${chart.theme.themeCss}\n` : ''
  const style = `<style>
  .xychart-grid { stroke: color-mix(in srgb, var(--fg) 14%, transparent); stroke-width: 1; }
  .xychart-axis-line { fill: none; }
  .xychart-tick { fill: none; }
  .xychart-x-axis-line { stroke: ${xAxisLineColor}; }
  .xychart-y-axis-line { stroke: ${yAxisLineColor}; }
  .xychart-x-tick { stroke: ${xAxisTickColor}; }
  .xychart-y-tick { stroke: ${yAxisTickColor}; }
  .xychart-bar { stroke: none; }
  .xychart-line { fill: none; stroke-width: ${renderStyle.lineWidth}; stroke-linecap: round; stroke-linejoin: round; }
  .xychart-dot { stroke: var(--bg); stroke-width: 2; }
  .xychart-label { fill: var(--_text); }
  .xychart-x-label { fill: ${xAxisLabelColor}; }
  .xychart-y-label { fill: ${yAxisLabelColor}; }
  .xychart-axis-title { fill: var(--_text); }
  .xychart-x-axis-title { fill: ${xAxisTitleColor}; }
  .xychart-y-axis-title { fill: ${yAxisTitleColor}; }
  .xychart-title { fill: ${titleColor}; }
  .xychart-data-label { fill: var(--_text); pointer-events: none; }${colorVarsBlock}
${seriesRules.join('\n')}${tipRules}${extraThemeCss}
</style>`

  return { style, defs: '' }
}

function polylinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  let path = `M${r(points[0]!.x)},${r(points[0]!.y)}`
  for (let i = 1; i < points.length; i++) {
    path += ` L${r(points[i]!.x)},${r(points[i]!.y)}`
  }
  return path
}

function buildBarDataLabels(
  bars: PositionedBar[],
  horizontal: boolean,
): Array<{
  x: number
  y: number
  text: string
  anchor: 'middle' | 'end'
  fontSize: number
  dominantBaseline?: 'middle' | 'hanging'
}> {
  const visibleBars = bars.filter(bar => bar.width > 0 && bar.height > 0)
  if (visibleBars.length === 0) return []

  const texts = visibleBars.map(bar => formatTipValue(bar.value))
  const candidates = visibleBars.map((bar, index) => {
    const text = texts[index]!
    if (horizontal) {
      const widthFit = Math.max(0, (bar.width - 12) / Math.max(1, text.length * 0.62))
      return Math.min(bar.height * 0.72, widthFit)
    }
    const widthFit = Math.max(0, (bar.width - 8) / Math.max(1, text.length * 0.62))
    const heightFit = Math.max(0, bar.height - 10)
    return Math.min(widthFit, heightFit)
  })

  const rawFontSize = Math.floor(Math.min(...candidates))
  if (!Number.isFinite(rawFontSize) || rawFontSize < 8) return []
  const fontSize = Math.min(16, rawFontSize)

  return visibleBars.map((bar, index) => horizontal
    ? {
      x: bar.x + bar.width - 8,
      y: bar.y + bar.height / 2,
      text: texts[index]!,
      anchor: 'end',
      fontSize,
      dominantBaseline: 'middle',
    }
    : {
      x: bar.x + bar.width / 2,
      y: bar.y + 8,
      text: texts[index]!,
      anchor: 'middle',
      fontSize,
      dominantBaseline: 'hanging',
    })
}

function tooltipAbove(cx: number, topY: number, text: string): string {
  const textW = estimateTextWidth(text, TIP.fontSize, TIP.fontWeight)
  const bgW = textW + TIP.padX * 2
  const bgX = cx - bgW / 2
  let bgY = topY - TIP.offsetY - TIP.height
  let ptrY = bgY + TIP.height

  if (bgY < TIP.minY) {
    bgY = TIP.minY
    ptrY = bgY + TIP.height
  }

  const textX = cx
  const textY = bgY + TIP.height / 2
  const p = TIP.pointerSize
  const ptrPath = `M${r(cx - p)},${r(ptrY)} L${r(cx + p)},${r(ptrY)} L${r(cx)},${r(ptrY + p)} Z`

  return (
    `<g class="xychart-tip">` +
    `<rect x="${r(bgX)}" y="${r(bgY)}" width="${r(bgW)}" height="${TIP.height}" rx="${TIP.rx}" class="xychart-tip xychart-tip-bg"/>` +
    `<path d="${ptrPath}" class="xychart-tip xychart-tip-ptr"/>` +
    `<text x="${r(textX)}" y="${r(textY)}" text-anchor="middle" dy="${TEXT_BASELINE_SHIFT}" class="xychart-tip xychart-tip-text">${escapeXml(text)}</text>` +
    `</g>`
  )
}

function formatTipValue(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(Math.abs(value) < 10 ? 1 : 0)
}

function r(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildSvgMetadata(chart: PositionedXYChart): {
  openTag: Parameters<typeof svgOpenTag>[4]
  title?: string
  description?: string
} {
  const svgId = `mermaid-${hashChart(chart)}`
  const accTitleId = chart.accessibility?.title ? `chart-title-${svgId}` : undefined
  const accDescId = chart.accessibility?.description ? `chart-desc-${svgId}` : undefined
  const responsiveWidth = chart.config.useWidth ?? chart.width
  const width = chart.config.useMaxWidth ? '100%' : String(responsiveWidth)
  const height = chart.config.useMaxWidth
    ? '100%'
    : String(Math.round(chart.height * (responsiveWidth / Math.max(1, chart.width))))
  const style = chart.config.useMaxWidth ? `max-width:${responsiveWidth}px` : undefined

  return {
    openTag: {
      width,
      height,
      style,
      attrs: {
        id: svgId,
        class: 'xychart',
        role: (accTitleId || accDescId) ? 'img' : undefined,
        'aria-roledescription': 'xychart',
        'aria-labelledby': accTitleId,
        'aria-describedby': accDescId,
      },
    },
    title: chart.accessibility?.title
      ? `<title id="${accTitleId}">${escapeXml(chart.accessibility.title)}</title>`
      : undefined,
    description: chart.accessibility?.description
      ? `<desc id="${accDescId}">${escapeXml(chart.accessibility.description)}</desc>`
      : undefined,
  }
}

function hashChart(chart: PositionedXYChart): string {
  const text = [
    chart.width,
    chart.height,
    chart.title?.text ?? '',
    chart.accessibility?.title ?? '',
    chart.accessibility?.description ?? '',
    chart.bars.length,
    chart.lines.length,
  ].join('|')
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i)
  }
  return Math.abs(hash >>> 0).toString(36)
}
