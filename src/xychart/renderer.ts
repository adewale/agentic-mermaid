import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { PositionedBar, PositionedXYChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { TEXT_BASELINE_SHIFT, applyTextTransform, estimateTextWidth, STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { LEGEND_SWATCH_GAP, LEGEND_SWATCH_SIZE, XY_DOT_RADIUS, XY_STYLE_DEFAULTS } from './layout.ts'
import { escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK } from './colors.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { contrastTextColor } from '../color-resolver.ts'
import { toHex, tryParseCssColor } from '../shared/color-math.ts'
import { formatBarValue } from './axis-utils.ts'
import type { MarkPaint } from '../scene/ir.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { drawTooltipArtwork, tooltipCss } from '../shared/svg-tooltip.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'

// ============================================================================
// XY Chart SVG renderer
//
// Rendered output now tracks Mermaid's own xychart structure more closely:
// fixed chart dimensions, explicit axis lines/ticks, simple grid lines,
// straight line segments, and in-bar data labels for bar plots.
//
// The chart is lowered to the SceneGraph IR (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id). renderXYChartSvg() uses DefaultBackend serialization of that scene. Interaction-only
// chrome (hover targets, tooltip groups) stays raw in this phase.
// ============================================================================

/** Halo behind bar value labels, in the surface they sit on. */
const DATA_LABEL_HALO_WIDTH = 3

const CHART_FONT = {
  titleWeight: 500,
  axisTitleWeight: 400,
  labelWeight: 400,
  dotRadius: XY_DOT_RADIUS,
  lineWidth: 3,
} as const

// Tooltip metrics/markup/CSS live in the shared primitive (also consumed by
// the quadrant renderer); prefix "xychart" reproduces the historical strings
// byte-for-byte.

export function renderXYChartSvg(
  ctx: RenderContext<PositionedXYChart>,
): string {
  return DefaultBackend.render(lowerXYChartScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned XY chart to the SceneGraph IR in canonical mark order.
 */
export function lowerXYChartDrawing<T>(
  marks: DrawingFactory<T>,
  ctx: RenderContext<PositionedXYChart>,
): DrawingDocument<T> {
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const parts: T[] = []
  const style = resolveRenderStyle(options, XY_STYLE_DEFAULTS, resolved.styleFace)
  const chartColors = resolveChartColors(chart, style)
  const hasAuthoredSeriesPalette = Boolean(chart.theme.plotColorPalette?.length)

  const maxColorIdx = Math.max(0, ...chart.bars.map(bar => bar.colorIndex), ...chart.lines.map(line => line.colorIndex))
  const svgMeta = buildSvgMetadata(chart)
  const svgTag = svgOpenTag(chart.width, chart.height, colors, transparent, svgMeta.openTag)
    .replace('<svg ', `<svg data-xychart-colors="${maxColorIdx}" `)

  const { style: chartStyle, defs } = chartStyles(chart, interactive, colors.accent, colors.bg)
  parts.push(marks.documentOpen(
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
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(marks.definitions({ id: 'shadow-defs' }, `<defs>${shadowDefs}</defs>`))
  if (defs) parts.push(marks.definitions({ id: 'defs' }, defs))
  if (svgMeta.title) parts.push(marks.documentContent({ id: 'acc-title', role: 'chrome', nonPaint: 'accessibility' }, svgMeta.title))
  if (svgMeta.description) parts.push(marks.documentContent({ id: 'acc-desc', role: 'chrome', nonPaint: 'accessibility' }, svgMeta.description))

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
      attributes: { className: 'xychart-grid' },
    }))
  })

  lowerAxis(marks, parts, chart.xAxis, 'x', chartColors.xAxisLineColor, chartColors.xAxisTickColor)
  lowerAxis(marks, parts, chart.yAxis, 'y', chartColors.yAxisLineColor, chartColors.yAxisTickColor)

  // Normalization basis for the `value` channel: the largest absolute data
  // value across every series (cheap, deterministic).
  const maxAbsValue = Math.max(
    0,
    ...chart.bars.map(bar => Math.abs(bar.value)),
    ...chart.lines.flatMap(line => line.points.map(point => Math.abs(point.value))),
  )
  const normalized = (value: number): number | undefined =>
    maxAbsValue > 0 ? value / maxAbsValue : undefined

  const barOverlay: T[] = []
  const barSeriesCount = new Map<number, number>()
  const seriesPalette = resolveSeriesPalette(chart, colors.accent, colors.bg)
  const barFills = new Map<PositionedBar, string>()
  const seriesPaints = new Map<string, string>()
  for (const bar of chart.bars) {
    const catIndex = barSeriesCount.get(bar.seriesIndex) ?? 0
    barSeriesCount.set(bar.seriesIndex, catIndex + 1)
    const barId = `bar:${bar.seriesIndex}:${bar.label ?? catIndex}`
    const channels = { category: `bar-${bar.seriesIndex}`, value: normalized(bar.value) }
    const roleStyle = resolveRoleStyle(resolved.styleFace, 'bar', channels, { includeFallback: false })
    const paletteFill = `var(--xychart-color-${bar.colorIndex})`
    const fill = hasAuthoredSeriesPalette ? paletteFill : roleStyle?.fillColor ?? paletteFill
    seriesPaints.set(channels.category, fill)
    barFills.set(bar, hasAuthoredSeriesPalette ? seriesPalette.concrete(bar.colorIndex) : roleStyle?.fillColor ?? seriesPalette.concrete(bar.colorIndex))
    const stroke = roleStyle?.strokeColor ?? roleStyle?.borderColor
    const strokeWidth = roleStyle?.lineWidth
    parts.push(marks.shape({
      id: barId,
      role: 'bar',
      geometry: { kind: 'rect', x: rn(bar.x), y: rn(bar.y), width: rn(bar.width), height: rn(bar.height) },
      paint: {
        fill,
        stroke: stroke ?? 'none',
        ...(strokeWidth !== undefined ? { strokeWidth: String(strokeWidth) } : {}),
      },
      channels,
      attributes: {
        className: `xychart-bar xychart-color-${bar.colorIndex}`,
        data: { value: String(bar.value), ...(bar.label ? { label: bar.label } : {}) },
      },
    }))

    if (interactive) {
      const tipText = formatBarValue(bar.value)
      const tipTitle = bar.label ? `${bar.label}: ${tipText}` : tipText
      const owner = { id: barId, role: 'bar' as const }
      barOverlay.push(marks.group({ id: `tooltip:${barId}`, role: 'chrome', owner,
        open: '<g class="xychart-bar-group">', close: '</g>', join: '', children: [
          { indent: 0, node: marks.shape({ id: `${barId}:hit`, role: 'chrome', owner,
            geometry: { kind: 'rect', x: rn(bar.x), y: rn(bar.y), width: rn(bar.width), height: rn(bar.height) }, paint: { fill: 'transparent' },
          }) },
          { indent: 0, node: marks.documentContent({ id: `${barId}:title`, role: 'chrome', nonPaint: 'interaction-metadata' }, `<title>${escapeXml(tipTitle)}</title>`) },
          { indent: 0, node: drawTooltipArtwork(marks, 'xychart', bar.tooltip, `${barId}:tooltip`, owner) },
        ],
      }))
    }
  }

  for (const line of chart.lines) {
    const channels = { category: `line-${line.seriesIndex}` }
    const roleStyle = resolveRoleStyle(resolved.styleFace, 'series', channels, { includeFallback: false })
    const paletteStroke = `var(--xychart-color-${line.colorIndex})`
    const stroke = hasAuthoredSeriesPalette ? paletteStroke : roleStyle?.strokeColor ?? roleStyle?.borderColor ?? paletteStroke
    seriesPaints.set(channels.category, stroke)
    // A single sample has no relationship to route, but its markers and key
    // still need the effective series paint.
    if (line.points.length < 2) continue
    const d = polylinePath(line.points)
    const strokeWidth = roleStyle?.lineWidth ?? style.lineWidth
    parts.push(marks.connector({
      id: `series:line-${line.seriesIndex}`,
      role: 'series',
      geometry: { kind: 'path', d, points: line.points },
      lineStyle: 'solid',
      paint: { stroke, strokeWidth: String(strokeWidth), strokeLinecap: 'round', strokeLinejoin: 'round' },
      channels,
      attributes: { className: `xychart-line xychart-color-${line.colorIndex}` },
    }))
  }

  const pointPaint = (seriesIndex: number, colorIndex: number, value: number): MarkPaint => {
    const category = `line-${seriesIndex}`
    const pointRole = resolveRoleStyle(resolved.styleFace, 'point', { category, value: normalized(value) }, { includeFallback: false })
    const paletteFill = `var(--xychart-color-${colorIndex})`
    return {
      fill: hasAuthoredSeriesPalette ? paletteFill : pointRole?.fillColor ?? seriesPaints.get(category) ?? paletteFill,
      stroke: pointRole?.strokeColor ?? pointRole?.borderColor ?? 'var(--bg)',
      strokeWidth: String(pointRole?.lineWidth ?? 2),
    }
  }

  // Mermaid 11.16 line-point labels are semantic chart content, not hover
  // chrome. A label therefore forces a visible point mark even when the
  // interactive tooltip layer is disabled.
  for (const line of chart.lines) {
    line.points.forEach((point, pointIndex) => {
      if (point.textLabel === undefined) return
      const at = point.textPosition
      const position = at?.placement ?? (chart.horizontal ? 'right' : 'above')
      const x = at?.x ?? point.x + (chart.horizontal ? 8 : 0)
      const y = at?.y ?? point.y + (chart.horizontal ? 4 : -8)
      const anchor = at?.anchor ?? (chart.horizontal ? 'start' : 'middle')
      parts.push(marks.shape({
        id: `point-label-dot:${line.seriesIndex}:${pointIndex}`, role: 'point',
        geometry: { kind: 'circle', cx: rn(point.x), cy: rn(point.y), r: CHART_FONT.dotRadius },
        paint: pointPaint(line.seriesIndex, line.colorIndex, point.value),
        channels: { category: `line-${line.seriesIndex}`, value: normalized(point.value) },
        attributes: { className: `xychart-dot xychart-color-${line.colorIndex}`, data: { value: String(point.value) } },
      }))
      parts.push(marks.text({
        id: `point-label:${line.seriesIndex}:${pointIndex}`, role: 'label', text: point.textBlock?.text ?? point.textLabel, block: point.textBlock,
        x: rn(x), y: rn(y), fontSize: 12, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing,
        display: 'literal', anchor, baselineShift: at ? 0.35 : 0,
        paint: { fill: seriesPaints.get(`line-${line.seriesIndex}`) ?? `var(--xychart-color-${line.colorIndex})` },
        channels: { category: `line-${line.seriesIndex}`, value: normalized(point.value) },
        attributes: { className: `xychart-point-label xychart-color-${line.colorIndex}`, data: { 'label-position': position } },
      }))
    })
  }

  const dotOverlay: T[] = []
  if (interactive) {
    for (const line of chart.lines) {
      line.points.forEach((point, pointIndex) => {
        const pointId = `point:line-${line.seriesIndex}:${point.label ?? pointIndex}`
        const tipText = formatBarValue(point.value)
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
              node: marks.shape({ id: `hit:${pointId}`, role: 'chrome', owner: { id: pointId, role: 'point' },
                geometry: { kind: 'circle', cx: rn(point.x), cy: rn(point.y), r: CHART_FONT.dotRadius * 3 }, paint: { fill: 'transparent' },
                attributes: { className: 'xychart-hit' },
              }),
              indent: 0,
            },
            {
              node: marks.shape({
                id: pointId,
                role: 'point',
                geometry: { kind: 'circle', cx: rn(point.x), cy: rn(point.y), r: CHART_FONT.dotRadius },
                paint: pointPaint(line.seriesIndex, line.colorIndex, point.value),
                channels: { category: `line-${line.seriesIndex}`, value: normalized(point.value) },
                attributes: {
                  className: `xychart-dot xychart-color-${line.colorIndex}`,
                  data: { value: String(point.value), ...(point.label ? { label: point.label } : {}) },
                },
              }),
              indent: 0,
            },
            {
              node: marks.documentContent({ id: `title:${pointId}`, role: 'chrome', nonPaint: 'interaction-metadata' }, `<title>${escapeXml(tipTitle)}</title>`),
              indent: 0,
            },
            {
              node: drawTooltipArtwork(marks, 'xychart', point.tooltip, `tooltip:${pointId}`, { id: pointId, role: 'point' }),
              indent: 0,
            },
          ],
        }))
      })
    }
  }

  const labelSeriesCount = new Map<number, number>()
  for (const label of chart.dataLabels) {
    const text = label.block?.text ?? applyTextTransform(label.text, style.nodeTextTransform)
    const catIndex = labelSeriesCount.get(label.bar.seriesIndex) ?? 0
    labelSeriesCount.set(label.bar.seriesIndex, catIndex + 1)
    // Outside labels sit on the page, whose text contrast the palette contract
    // certifies. Inside labels sit on the bar, so their ink is chosen against
    // that bar's own fill.
    const onBar = chart.theme.dataLabelColor === undefined && label.placement === 'inside'
      ? inkOnFill(barFills.get(label.bar))
      : undefined
    const fill = chart.theme.dataLabelColor ?? onBar ?? chartColors.labelColor
    // A line series can cross a value label; a halo in the label's own surface
    // (its bar inside, the page outside) knocks the line out behind the glyphs.
    const halo = label.placement === 'inside' ? barFills.get(label.bar) ?? 'var(--bg)' : 'var(--bg)'
    parts.push(marks.text({
      id: `label:bar:${label.bar.seriesIndex}:${label.bar.label ?? catIndex}`,
      role: 'label',
      text,
      block: label.block,
      x: rn(label.x),
      y: rn(label.y),
      fontSize: label.fontSize,
      fontWeight: style.nodeLabelFontWeight,
      letterSpacing: style.nodeLetterSpacing,
      display: 'literal',
      anchor: label.anchor,
      ...(label.dominantBaseline ? { dominantBaseline: label.dominantBaseline } : {}),
      baselineShift: 0,
      paint: { fill, stroke: halo, strokeWidth: String(DATA_LABEL_HALO_WIDTH), strokeLinejoin: 'round', paintOrder: 'stroke' },
      // Sketch looks halo text with the page color over hatched or washed
      // bars, so an ink chosen against the bar would sit on the page instead.
      ...(onBar ? { pageFill: chartColors.labelColor } : {}),
      channels: { category: `bar-${label.bar.seriesIndex}`, value: normalized(label.bar.value) },
      attributes: { className: 'xychart-data-label', data: { 'literal-text': 'true' } },
    }))
  }

  lowerAxisLabels(marks, parts, chart.xAxis.ticks, chart.xAxis.config.labelFontSize, 'x', style, chartColors.xAxisLabelColor)
  lowerAxisLabels(marks, parts, chart.yAxis.ticks, chart.yAxis.config.labelFontSize, 'y', style, chartColors.yAxisLabelColor)

  if (chart.xAxis.title) {
    const title = chart.xAxis.title
    const text = title.block?.text ?? applyTextTransform(title.text, style.edgeTextTransform)
    const rotation = title.rotate ? { kind: 'rotate' as const, angle: title.rotate, cx: title.x, cy: title.y } : undefined
    parts.push(marks.text({
      id: 'axis:x:title',
      role: 'axis',
      text,
      block: title.block,
      x: title.x,
      y: title.y,
      fontSize: chart.xAxis.config.titleFontSize,
      fontWeight: style.edgeLabelFontWeight,
      letterSpacing: style.edgeLetterSpacing,
      display: 'literal',
      anchor: 'middle',
      paint: { fill: chartColors.xAxisTitleColor },
      transform: rotation,
      attributes: { className: 'xychart-axis-title xychart-x-axis-title' },
    }))
  }

  if (chart.yAxis.title) {
    const title = chart.yAxis.title
    const text = title.block?.text ?? applyTextTransform(title.text, style.edgeTextTransform)
    const rotation = title.rotate ? { kind: 'rotate' as const, angle: title.rotate, cx: title.x, cy: title.y } : undefined
    parts.push(marks.text({
      id: 'axis:y:title',
      role: 'axis',
      text,
      block: title.block,
      x: title.x,
      y: title.y,
      fontSize: chart.yAxis.config.titleFontSize,
      fontWeight: style.edgeLabelFontWeight,
      letterSpacing: style.edgeLetterSpacing,
      display: 'literal',
      anchor: 'middle',
      paint: { fill: chartColors.yAxisTitleColor },
      transform: rotation,
      attributes: { className: 'xychart-axis-title xychart-y-axis-title' },
    }))
  }

  if (chart.title) {
    const title = chart.title.text
    parts.push(marks.text({
      id: 'title',
      role: 'title',
      text: title,
      block: chart.title.block,
      x: chart.title.x,
      y: chart.title.y,
      fontSize: chart.config.titleFontSize,
      fontWeight: style.groupHeaderFontWeight,
      letterSpacing: style.groupLetterSpacing,
      display: 'literal',
      anchor: 'middle',
      paint: { fill: chartColors.titleColor },
      attributes: { className: 'xychart-title' },
    }))
  }

  // Right-side legend (layout has already reserved its space inside the
  // canvas; an empty legend array means the chart is not legend-worthy, the
  // config hides it, or the column was dropped rather than clipped).
  if (chart.legend.length > 0) {
    const legendChildren: Array<{ node: T; indent: number }> = []
    for (const item of chart.legend) {
      const cy = item.y + Math.max(LEGEND_SWATCH_SIZE, item.block?.height ?? 0) / 2
      if (item.type === 'bar') {
        legendChildren.push({
          node: marks.shape({
            id: `legend:swatch:${item.colorIndex}`,
            role: 'legend',
            geometry: { kind: 'rect', x: rn(item.x), y: rn(item.y), width: LEGEND_SWATCH_SIZE, height: LEGEND_SWATCH_SIZE, rx: 2, ry: 2 },
            paint: { fill: seriesPaints.get(`bar-${item.seriesIndex}`) ?? `var(--xychart-color-${item.colorIndex})` },
            channels: { category: `bar-${item.seriesIndex}` },
            attributes: { className: 'xychart-legend-swatch' },
          }),
          indent: 2,
        })
      } else {
        // Line swatch: a stroke sample plus its center dot (the LegendItem
        // contract: rect for bar, line+dot for line).
        legendChildren.push({
          node: marks.shape({
            id: `legend:swatch:${item.colorIndex}`,
            role: 'legend',
            geometry: { kind: 'line', x1: rn(item.x), y1: rn(cy), x2: rn(item.x + LEGEND_SWATCH_SIZE), y2: rn(cy) },
            paint: { stroke: seriesPaints.get(`line-${item.seriesIndex}`) ?? `var(--xychart-color-${item.colorIndex})`, strokeWidth: String(CHART_FONT.lineWidth), strokeLinecap: 'round' },
            channels: { category: `line-${item.seriesIndex}` },
            attributes: { className: 'xychart-legend-swatch' },
          }),
          indent: 2,
        })
        legendChildren.push({
          node: marks.shape({
            id: `legend:dot:${item.colorIndex}`,
            role: 'legend',
            geometry: { kind: 'circle', cx: rn(item.x + LEGEND_SWATCH_SIZE / 2), cy: rn(cy), r: 2.5 },
            paint: { fill: seriesPaints.get(`line-${item.seriesIndex}`) ?? `var(--xychart-color-${item.colorIndex})`, stroke: 'var(--bg)', strokeWidth: '1' },
            channels: { category: `line-${item.seriesIndex}` },
            attributes: { className: 'xychart-legend-dot' },
          }),
          indent: 2,
        })
      }
      const label = item.block?.text ?? applyTextTransform(item.label, style.nodeTextTransform)
      const labelX = item.x + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_GAP
      legendChildren.push({
        node: marks.text({
          id: `legend:label:${item.colorIndex}`,
          role: 'legend',
          text: label,
          block: item.block,
          x: rn(labelX),
          y: rn(cy),
          fontSize: chart.config.legendFontSize,
          fontWeight: style.nodeLabelFontWeight,
          letterSpacing: style.nodeLetterSpacing,
          display: 'literal',
          anchor: 'start',
          dominantBaseline: 'middle',
          baselineShift: 0,
          paint: { fill: chartColors.legendTextColor },
          attributes: { className: 'xychart-legend-label' },
        }),
        indent: 2,
      })
    }
    parts.push(marks.group({
      id: 'legend',
      role: 'legend',
      open: '<g class="xychart-legend">',
      close: '</g>',
      children: legendChildren,
    }))
  }

  for (const group of barOverlay) parts.push(group)
  for (const group of dotOverlay) parts.push(group)

  parts.push(marks.documentClose())

  return { family: 'xychart', width: chart.width, height: chart.height, colors, transparent, parts }
}

function lowerAxis<T>(
  marks: DrawingFactory<T>,
  parts: T[],
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
      attributes: { className: `xychart-axis-line xychart-${axisName}-axis-line` },
    }))
  }

  if (!axis.config.showTick) return
  for (const tick of axis.ticks) {
    parts.push(marks.shape({
      id: `axis:${axisName}:tick:${tick.label}`,
      role: 'axis',
      geometry: { kind: 'line', x1: rn(tick.x), y1: rn(tick.y), x2: rn(tick.tx), y2: rn(tick.ty) },
      paint: { stroke: tickColor, strokeWidth: String(axis.config.tickWidth) },
      attributes: { className: `xychart-tick xychart-${axisName}-tick` },
    }))
  }
}

function lowerAxisLabels<T>(
  marks: DrawingFactory<T>,
  parts: T[],
  ticks: PositionedXYChart['xAxis']['ticks'],
  fontSize: number,
  axisName: 'x' | 'y',
  style: ReturnType<typeof resolveRenderStyle>,
  fill: string,
): void {
  for (const tick of ticks) {
    const label = tick.block?.text ?? applyTextTransform(tick.label, style.edgeTextTransform)
    // End-anchored labels sit beside a vertical axis, centered on their tick.
    const middle = tick.textAnchor === 'end'
    parts.push(marks.text({
      id: `axis:${axisName}:label:${tick.label}`,
      role: 'axis',
      text: label,
      block: tick.block,
      x: tick.labelX,
      y: tick.labelY,
      fontSize,
      fontWeight: style.nodeLabelFontWeight,
      letterSpacing: style.nodeLetterSpacing,
      display: 'literal',
      anchor: tick.textAnchor,
      ...(middle ? { dominantBaseline: 'middle' as const, baselineShift: 0 } : {}),
      paint: { fill },
      attributes: { className: `xychart-label xychart-${axisName}-label` },
    }))
  }
}

/** Theme/renderStyle color cascade for the mark paints. */
interface ResolvedChartColors {
  gridStroke: string
  titleColor: string
  labelColor: string
  xAxisLabelColor: string
  yAxisLabelColor: string
  xAxisTickColor: string
  yAxisTickColor: string
  xAxisLineColor: string
  yAxisLineColor: string
  xAxisTitleColor: string
  yAxisTitleColor: string
  legendTextColor: string
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
    xAxisLabelColor: themeOverrides.xAxisLabelColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    yAxisLabelColor: themeOverrides.yAxisLabelColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    xAxisTickColor: themeOverrides.xAxisTickColor ?? renderStyle.groupTextColor ?? 'var(--_text-sec)',
    yAxisTickColor: themeOverrides.yAxisTickColor ?? renderStyle.groupTextColor ?? 'var(--_text-sec)',
    xAxisLineColor: themeOverrides.xAxisLineColor ?? renderStyle.edgeStrokeColor ?? 'var(--_text-sec)',
    yAxisLineColor: themeOverrides.yAxisLineColor ?? renderStyle.edgeStrokeColor ?? 'var(--_text-sec)',
    xAxisTitleColor: themeOverrides.xAxisTitleColor ?? renderStyle.edgeTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    yAxisTitleColor: themeOverrides.yAxisTitleColor ?? renderStyle.edgeTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    legendTextColor: themeOverrides.legendTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
  }
}

/** Series colors by color index: the CSS value each `--xychart-color-N`
 * carries, and the concrete color it resolves to. A small palette keeps
 * `var(--accent)` in slot zero so consumers can retint it, unless the palette
 * contract had to repair the accent (for example, an accent that vanishes
 * against the background). */
function resolveSeriesPalette(
  chart: PositionedXYChart,
  themeAccent: string | undefined,
  bgColor: string | undefined,
): { css: (index: number) => string; concrete: (index: number) => string } {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const explicitPalette = chart.theme.plotColorPalette
  const maxIndex = Math.max(0, ...chart.bars.map(bar => bar.colorIndex), ...chart.lines.map(line => line.colorIndex))
  const derivedPalette = categoricalPalette(maxIndex + 1, { accent: accentHex, bg: bgColor })
  const concrete = (index: number): string => explicitPalette && explicitPalette.length > 0
    ? explicitPalette[index % explicitPalette.length]!
    : derivedPalette[index]!
  return {
    concrete,
    css: index => !(explicitPalette && explicitPalette.length > 0) && index === 0 && derivedPalette.length <= 6 && derivedPalette[0] === accentHex
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : concrete(index),
  }
}

/** Black or white, whichever reads better on a concrete fill; undefined when
 * the fill cannot be resolved to sRGB. */
function inkOnFill(fill: string | undefined): string | undefined {
  const rgba = fill === undefined ? null : tryParseCssColor(fill)
  return rgba && rgba[3] === 1 ? contrastTextColor(toHex(rgba[0], rgba[1], rgba[2])) : undefined
}

function chartStyles(
  chart: PositionedXYChart,
  interactive: boolean,
  themeAccent?: string,
  bgColor?: string,
): { style: string; defs: string } {
  const colorIndices = new Set<number>()
  for (const bar of chart.bars) colorIndices.add(bar.colorIndex)
  for (const line of chart.lines) colorIndices.add(line.colorIndex)

  const colorVarDefs: string[] = []
  const seriesPalette = resolveSeriesPalette(chart, themeAccent, bgColor)
  for (const index of [...colorIndices].sort((a, b) => a - b)) {
    colorVarDefs.push(`    --xychart-color-${index}: ${seriesPalette.css(index)};`)
  }

  const tipRules = interactive ? tooltipCss('xychart', ['xychart-bar-group', 'xychart-dot-group']) : ''

  const colorVarsBlock = colorVarDefs.length > 0 ? `\n  svg {\n${colorVarDefs.join('\n')}\n  }` : ''

  const extraThemeCss = chart.theme.themeCss ? `\n${chart.theme.themeCss}\n` : ''
  // Marks are painted from their typed fields; the stylesheet keeps the
  // series color variables, interaction rules and authored theme CSS.
  const style = `<style>
  .xychart-data-label { pointer-events: none; }${colorVarsBlock}${tipRules}${extraThemeCss}
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

/** Round to the same 2-decimal grid the crisp serializer uses, so semantic
 *  geometry numbers String()-equal their crisp attributes. */
function rn(value: number): number {
  return Math.round(value * 100) / 100
}

function r(value: number): string {
  return rn(value).toString()
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

export const lowerXYChartScene = sceneLowering<PositionedXYChart>(lowerXYChartDrawing)
