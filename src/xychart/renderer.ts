import type { PositionedBar, PositionedXYChart } from './types.ts'
import type { RenderContext, RenderOptions } from '../types.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { TEXT_BASELINE_SHIFT, estimateTextWidth, STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { XY_STYLE_DEFAULTS } from './layout.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK } from './colors.ts'
import type { MarkPaint, SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'

// ============================================================================
// XY Chart SVG renderer
//
// Rendered output now tracks Mermaid's own xychart structure more closely:
// fixed chart dimensions, explicit axis lines/ticks, simple grid lines,
// straight line segments, and in-bar data labels for bar plots.
//
// The chart is lowered to the SceneGraph IR (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id) plus its exact crisp serialization, built here from
// the same inputs. renderXYChartSvg() is DefaultBackend serialization of that
// scene, so the default path stays byte-identical to the historical string
// renderer (corpus-gated by svg-equivalence.test.ts). Interaction-only
// chrome (hover targets, tooltip groups) stays raw in this phase.
// ============================================================================

const CHART_FONT = {
  titleWeight: 500,
  axisTitleWeight: 400,
  labelWeight: 400,
  dotRadius: 4,
  lineWidth: 3,
} as const

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
  ctx: RenderContext<PositionedXYChart>,
): string {
  return DefaultBackend.render(lowerXYChartScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned XY chart to the SceneGraph IR. Mark order matches the
 * historical parts[] order exactly; DefaultBackend joins crisps with '\n'.
 */
export function lowerXYChartScene(
  ctx: RenderContext<PositionedXYChart>,
): SceneDoc {
  const { positioned: chart, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const parts: SceneNode[] = []
  const style = resolveRenderStyle(options, XY_STYLE_DEFAULTS)
  const chartColors = resolveChartColors(chart, style)

  const maxColorIdx = Math.max(0, ...chart.bars.map(bar => bar.colorIndex), ...chart.lines.map(line => line.colorIndex))
  const svgMeta = buildSvgMetadata(chart)
  const svgTag = svgOpenTag(chart.width, chart.height, colors, transparent, svgMeta.openTag)
    .replace('<svg ', `<svg data-xychart-colors="${maxColorIdx}" `)

  const { style: chartStyle, defs } = chartStyles(chart, interactive, colors.accent, colors.bg, options)
  parts.push(marks.prelude(
    {
      id: 'prelude',
      width: chart.width,
      height: chart.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
      extraCss: chartStyle,
    },
    svgTag + '\n' +
    buildStyleBlock(font, false, colors.shadow, colors.embedFontImport) + '\n' +
    chartStyle,
  ))
  if (defs) parts.push(marks.raw({ id: 'defs', role: 'defs' }, defs))
  if (svgMeta.title) parts.push(marks.raw({ id: 'acc-title', role: 'chrome' }, svgMeta.title))
  if (svgMeta.description) parts.push(marks.raw({ id: 'acc-desc', role: 'chrome' }, svgMeta.description))

  // Grid lines are always derived from the value (y) axis tick values, in
  // both orientations; the tick value itself is not carried through layout,
  // so the stable id falls back to the tick index.
  const gridPaint: MarkPaint = {
    stroke: chartColors.gridStroke,
    strokeWidth: '1',
    ...(style.edgeStrokeColor ? { opacity: '0.25' } : {}),
  }
  chart.gridLines.forEach((gridLine, index) => {
    parts.push(marks.shape({
      id: `grid:y:${index}`,
      role: 'grid',
      geometry: { kind: 'line', x1: rn(gridLine.x1), y1: rn(gridLine.y1), x2: rn(gridLine.x2), y2: rn(gridLine.y2) },
      paint: gridPaint,
    },
      `<line x1="${r(gridLine.x1)}" y1="${r(gridLine.y1)}" x2="${r(gridLine.x2)}" y2="${r(gridLine.y2)}" class="xychart-grid"/>`,
    ))
  })

  lowerAxis(parts, chart.xAxis, 'x', chartColors.xAxisLineColor, chartColors.xAxisTickColor)
  lowerAxis(parts, chart.yAxis, 'y', chartColors.yAxisLineColor, chartColors.yAxisTickColor)

  // Normalization basis for the `value` channel: the largest absolute data
  // value across every series (cheap, deterministic).
  const maxAbsValue = Math.max(
    0,
    ...chart.bars.map(bar => Math.abs(bar.value)),
    ...chart.lines.flatMap(line => line.points.map(point => Math.abs(point.value))),
  )
  const normalized = (value: number): number | undefined =>
    maxAbsValue > 0 ? value / maxAbsValue : undefined

  const barOverlay: SceneNode[] = []
  const barSeriesCount = new Map<number, number>()
  for (const bar of chart.bars) {
    const catIndex = barSeriesCount.get(bar.seriesIndex) ?? 0
    barSeriesCount.set(bar.seriesIndex, catIndex + 1)
    const barId = `bar:${bar.seriesIndex}:${bar.label ?? catIndex}`
    const dataAttrs = ` data-value="${bar.value}"${bar.label ? ` data-label="${escapeXml(bar.label)}"` : ''}`
    parts.push(marks.shape({
      id: barId,
      role: 'bar',
      geometry: { kind: 'rect', x: rn(bar.x), y: rn(bar.y), width: rn(bar.width), height: rn(bar.height) },
      paint: { fill: `var(--xychart-color-${bar.colorIndex})` },
      channels: { category: `bar-${bar.seriesIndex}`, value: normalized(bar.value) },
    },
      `<rect x="${r(bar.x)}" y="${r(bar.y)}" width="${r(bar.width)}" height="${r(bar.height)}" ` +
      `class="xychart-bar xychart-color-${bar.colorIndex}"${dataAttrs}/>`,
    ))

    if (interactive) {
      const tipText = formatTipValue(bar.value)
      const tipTitle = bar.label ? `${bar.label}: ${tipText}` : tipText
      const tipAnchorX = chart.horizontal ? bar.x + bar.width : bar.x + bar.width / 2
      const tipAnchorY = chart.horizontal ? bar.y + bar.height / 2 : bar.y
      // Pure interaction chrome (invisible hover rect + tooltip) — stays raw.
      barOverlay.push(marks.raw({ id: `tooltip:${barId}`, role: 'chrome' },
        `<g class="xychart-bar-group">` +
        `<rect x="${r(bar.x)}" y="${r(bar.y)}" width="${r(bar.width)}" height="${r(bar.height)}" fill="transparent"/>` +
        `<title>${escapeXml(tipTitle)}</title>` +
        tooltipAbove(tipAnchorX, tipAnchorY, tipText) +
        `</g>`,
      ))
    }
  }

  for (const line of chart.lines) {
    if (line.points.length === 0) continue
    const d = polylinePath(line.points)
    parts.push(marks.connector({
      id: `series:line-${line.seriesIndex}`,
      role: 'series',
      geometry: { kind: 'path', d, points: line.points },
      lineStyle: 'solid',
      paint: { stroke: `var(--xychart-color-${line.colorIndex})`, strokeWidth: String(style.lineWidth) },
      channels: { category: `line-${line.seriesIndex}` },
    },
      `<path d="${d}" class="xychart-line xychart-color-${line.colorIndex}"/>`,
    ))
  }

  const dotOverlay: SceneNode[] = []
  if (interactive) {
    for (const line of chart.lines) {
      line.points.forEach((point, pointIndex) => {
        const pointId = `point:line-${line.seriesIndex}:${point.label ?? pointIndex}`
        const dataAttrs = ` data-value="${point.value}"${point.label ? ` data-label="${escapeXml(point.label)}"` : ''}`
        const tipText = formatTipValue(point.value)
        const tipTitle = point.label ? `${point.label}: ${tipText}` : tipText
        // The visible dot is a semantic point mark; the enlarged hit circle
        // and the tooltip block are interaction chrome and stay raw.
        dotOverlay.push(marks.group({
          id: `point-group:line-${line.seriesIndex}:${point.label ?? pointIndex}`,
          role: 'chrome',
          open: `<g class="xychart-dot-group">`,
          close: `</g>`,
          join: '',
          children: [
            {
              node: marks.raw({ id: `hit:${pointId}`, role: 'chrome' },
                `<circle cx="${r(point.x)}" cy="${r(point.y)}" r="${CHART_FONT.dotRadius * 3}" fill="transparent" class="xychart-hit"/>`),
              indent: 0,
            },
            {
              node: marks.shape({
                id: pointId,
                role: 'point',
                geometry: { kind: 'circle', cx: rn(point.x), cy: rn(point.y), r: CHART_FONT.dotRadius },
                paint: { fill: `var(--xychart-color-${line.colorIndex})`, stroke: 'var(--bg)', strokeWidth: '2' },
                channels: { category: `line-${line.seriesIndex}`, value: normalized(point.value) },
              },
                `<circle cx="${r(point.x)}" cy="${r(point.y)}" r="${CHART_FONT.dotRadius}" class="xychart-dot xychart-color-${line.colorIndex}"${dataAttrs}/>`),
              indent: 0,
            },
            {
              node: marks.raw({ id: `tooltip:${pointId}`, role: 'chrome' },
                `<title>${escapeXml(tipTitle)}</title>` +
                tooltipAbove(point.x, point.y - CHART_FONT.dotRadius, tipText)),
              indent: 0,
            },
          ],
        }))
      })
    }
  }

  if (chart.config.showDataLabel) {
    const labelSeriesCount = new Map<number, number>()
    for (const label of buildBarDataLabels(chart.bars, chart.horizontal ?? false)) {
      const catIndex = labelSeriesCount.get(label.bar.seriesIndex) ?? 0
      labelSeriesCount.set(label.bar.seriesIndex, catIndex + 1)
      parts.push(marks.text({
        id: `label:bar:${label.bar.seriesIndex}:${label.bar.label ?? catIndex}`,
        role: 'label',
        text: label.text,
        x: label.x,
        y: label.y,
        fontSize: label.fontSize,
        anchor: label.anchor,
        paint: { fill: chartColors.labelColor },
        channels: { category: `bar-${label.bar.seriesIndex}`, value: normalized(label.bar.value) },
      },
        `<text x="${r(label.x)}" y="${r(label.y)}" text-anchor="${label.anchor}" ` +
        `${label.dominantBaseline ? `dominant-baseline="${label.dominantBaseline}" ` : ''}` +
        `font-size="${label.fontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)} class="xychart-data-label">${escapeXml(label.text)}</text>`,
      ))
    }
  }

  lowerAxisLabels(parts, chart.xAxis.ticks, chart.xAxis.config.labelFontSize, 'x', style, chartColors.xAxisLabelColor)
  lowerAxisLabels(parts, chart.yAxis.ticks, chart.yAxis.config.labelFontSize, 'y', style, chartColors.yAxisLabelColor)

  if (chart.xAxis.title) {
    const title = chart.xAxis.title
    const transform = title.rotate ? ` transform="rotate(${title.rotate},${title.x},${title.y})"` : ''
    parts.push(marks.text({
      id: 'axis:x:title',
      role: 'axis',
      text: title.text,
      x: title.x,
      y: title.y,
      fontSize: chart.xAxis.config.titleFontSize,
      anchor: 'middle',
      paint: { fill: chartColors.xAxisTitleColor },
    },
      `<text x="${title.x}" y="${title.y}" text-anchor="middle"${transform} ` +
      `font-size="${chart.xAxis.config.titleFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="xychart-axis-title xychart-x-axis-title">${escapeXml(title.text)}</text>`,
    ))
  }

  if (chart.yAxis.title) {
    const title = chart.yAxis.title
    const transform = title.rotate ? ` transform="rotate(${title.rotate},${title.x},${title.y})"` : ''
    parts.push(marks.text({
      id: 'axis:y:title',
      role: 'axis',
      text: title.text,
      x: title.x,
      y: title.y,
      fontSize: chart.yAxis.config.titleFontSize,
      anchor: 'middle',
      paint: { fill: chartColors.yAxisTitleColor },
    },
      `<text x="${title.x}" y="${title.y}" text-anchor="middle"${transform} ` +
      `font-size="${chart.yAxis.config.titleFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="xychart-axis-title xychart-y-axis-title">${escapeXml(title.text)}</text>`,
    ))
  }

  if (chart.title) {
    parts.push(marks.text({
      id: 'title',
      role: 'title',
      text: chart.title.text,
      x: chart.title.x,
      y: chart.title.y,
      fontSize: chart.config.titleFontSize,
      anchor: 'middle',
      paint: { fill: chartColors.titleColor },
    },
      `<text x="${chart.title.x}" y="${chart.title.y}" text-anchor="middle" ` +
      `font-size="${chart.config.titleFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)} ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="xychart-title">${escapeXml(chart.title.text)}</text>`,
    ))
  }

  for (const group of barOverlay) parts.push(group)
  for (const group of dotOverlay) parts.push(group)

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'xychart', width: chart.width, height: chart.height, colors, parts }
}

function lowerAxis(
  parts: SceneNode[],
  axis: PositionedXYChart['xAxis'],
  axisName: 'x' | 'y',
  lineColor: string,
  tickColor: string,
): void {
  if (axis.config.showAxisLine) {
    parts.push(marks.shape({
      id: `axis:${axisName}:line`,
      role: 'axis',
      geometry: { kind: 'line', x1: rn(axis.line.x1), y1: rn(axis.line.y1), x2: rn(axis.line.x2), y2: rn(axis.line.y2) },
      paint: { stroke: lineColor, strokeWidth: String(axis.config.axisLineWidth) },
    },
      `<line x1="${r(axis.line.x1)}" y1="${r(axis.line.y1)}" x2="${r(axis.line.x2)}" y2="${r(axis.line.y2)}" ` +
      `class="xychart-axis-line xychart-${axisName}-axis-line" stroke-width="${axis.config.axisLineWidth}"/>`,
    ))
  }

  if (!axis.config.showTick) return
  for (const tick of axis.ticks) {
    parts.push(marks.shape({
      id: `axis:${axisName}:tick:${tick.label}`,
      role: 'axis',
      geometry: { kind: 'line', x1: rn(tick.x), y1: rn(tick.y), x2: rn(tick.tx), y2: rn(tick.ty) },
      paint: { stroke: tickColor, strokeWidth: String(axis.config.tickWidth) },
    },
      `<line x1="${r(tick.x)}" y1="${r(tick.y)}" x2="${r(tick.tx)}" y2="${r(tick.ty)}" ` +
      `class="xychart-tick xychart-${axisName}-tick" stroke-width="${axis.config.tickWidth}"/>`,
    ))
  }
}

function lowerAxisLabels(
  parts: SceneNode[],
  ticks: PositionedXYChart['xAxis']['ticks'],
  fontSize: number,
  axisName: 'x' | 'y',
  style: ReturnType<typeof resolveRenderStyle>,
  fill: string,
): void {
  for (const tick of ticks) {
    const middleBaseline = tick.textAnchor === 'end' ? ' dominant-baseline="middle"' : ''
    const dy = tick.textAnchor === 'end' ? '' : ` dy="${TEXT_BASELINE_SHIFT}"`
    parts.push(marks.text({
      id: `axis:${axisName}:label:${tick.label}`,
      role: 'axis',
      text: tick.label,
      x: tick.labelX,
      y: tick.labelY,
      fontSize,
      anchor: tick.textAnchor,
      paint: { fill },
    },
      `<text x="${tick.labelX}" y="${tick.labelY}" text-anchor="${tick.textAnchor}"${middleBaseline} ` +
      `font-size="${fontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}${dy} class="xychart-label xychart-${axisName}-label">` +
      `${escapeXml(tick.label)}</text>`,
    ))
  }
}

/** Theme/renderStyle color cascade shared by the style block and mark paints. */
interface ResolvedChartColors {
  gridStroke: string
  titleColor: string
  labelColor: string
  axisTitleColor: string
  xAxisLabelColor: string
  yAxisLabelColor: string
  xAxisTickColor: string
  yAxisTickColor: string
  xAxisLineColor: string
  yAxisLineColor: string
  xAxisTitleColor: string
  yAxisTitleColor: string
}

function resolveChartColors(
  chart: PositionedXYChart,
  renderStyle: ReturnType<typeof resolveRenderStyle>,
): ResolvedChartColors {
  const themeOverrides = chart.theme
  return {
    gridStroke: renderStyle.edgeStrokeColor ?? 'color-mix(in srgb, var(--fg) 14%, transparent)',
    titleColor: themeOverrides.titleColor ?? renderStyle.groupTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    labelColor: renderStyle.nodeTextColor ?? 'var(--_text)',
    axisTitleColor: renderStyle.edgeTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    xAxisLabelColor: themeOverrides.xAxisLabelColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    yAxisLabelColor: themeOverrides.yAxisLabelColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    xAxisTickColor: themeOverrides.xAxisTickColor ?? renderStyle.groupTextColor ?? 'var(--_text-sec)',
    yAxisTickColor: themeOverrides.yAxisTickColor ?? renderStyle.groupTextColor ?? 'var(--_text-sec)',
    xAxisLineColor: themeOverrides.xAxisLineColor ?? renderStyle.edgeStrokeColor ?? 'var(--_text-sec)',
    yAxisLineColor: themeOverrides.yAxisLineColor ?? renderStyle.edgeStrokeColor ?? 'var(--_text-sec)',
    xAxisTitleColor: themeOverrides.xAxisTitleColor ?? renderStyle.edgeTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    yAxisTitleColor: themeOverrides.yAxisTitleColor ?? renderStyle.edgeTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
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
  const cc = resolveChartColors(chart, renderStyle)
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

  const colorVarsBlock = colorVarDefs.length > 0 ? `\n  svg {\n${colorVarDefs.join('\n')}\n  }` : ''

  const extraThemeCss = chart.theme.themeCss ? `\n${chart.theme.themeCss}\n` : ''
  const style = `<style>
  .xychart-grid { stroke: ${cc.gridStroke}; stroke-width: 1${renderStyle.edgeStrokeColor ? '; opacity: 0.25' : ''}; }
  .xychart-axis-line { fill: none; }
  .xychart-tick { fill: none; }
  .xychart-x-axis-line { stroke: ${cc.xAxisLineColor}; }
  .xychart-y-axis-line { stroke: ${cc.yAxisLineColor}; }
  .xychart-x-tick { stroke: ${cc.xAxisTickColor}; }
  .xychart-y-tick { stroke: ${cc.yAxisTickColor}; }
  .xychart-bar { stroke: none; }
  .xychart-line { fill: none; stroke-width: ${renderStyle.lineWidth}; stroke-linecap: round; stroke-linejoin: round; }
  .xychart-dot { stroke: var(--bg); stroke-width: 2; }
  .xychart-label { fill: ${cc.labelColor}; }
  .xychart-x-label { fill: ${cc.xAxisLabelColor}; }
  .xychart-y-label { fill: ${cc.yAxisLabelColor}; }
  .xychart-axis-title { fill: ${cc.axisTitleColor}; }
  .xychart-x-axis-title { fill: ${cc.xAxisTitleColor}; }
  .xychart-y-axis-title { fill: ${cc.yAxisTitleColor}; }
  .xychart-title { fill: ${cc.titleColor}; }
  .xychart-data-label { fill: ${cc.labelColor}; pointer-events: none; }${colorVarsBlock}
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
  bar: PositionedBar
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
      bar,
      x: bar.x + bar.width - 8,
      y: bar.y + bar.height / 2,
      text: texts[index]!,
      anchor: 'end',
      fontSize,
      dominantBaseline: 'middle',
    }
    : {
      bar,
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

/** Round to the same 2-decimal grid the crisp serializer uses, so semantic
 *  geometry numbers String()-equal their crisp attributes. */
function rn(value: number): number {
  return Math.round(value * 100) / 100
}

function r(value: number): string {
  return rn(value).toString()
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
