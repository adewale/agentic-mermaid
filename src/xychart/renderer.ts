import type { PositionedBar, PositionedXYChart } from './types.ts'
import type { RenderContext, RenderOptions } from '../types.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { TEXT_BASELINE_SHIFT, applyTextTransform, estimateTextWidth, STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { LEGEND_SWATCH_GAP, LEGEND_SWATCH_SIZE, XY_STYLE_DEFAULTS } from './layout.ts'
import { escapeXml } from '../multiline-utils.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK } from './colors.ts'
import type { MarkPaint, SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { tooltipMarkup, tooltipCss } from '../shared/svg-tooltip.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'

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

// Tooltip metrics/markup/CSS live in the shared primitive (also consumed by
// the quadrant renderer); prefix "xychart" reproduces the historical strings
// byte-for-byte.

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
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const parts: SceneNode[] = []
  const style = resolveRenderStyle(options, XY_STYLE_DEFAULTS, resolved.styleFace)
  const chartColors = resolveChartColors(chart, style)
  const hasAuthoredSeriesPalette = Boolean(chart.theme.plotColorPalette?.length)

  const maxColorIdx = Math.max(0, ...chart.bars.map(bar => bar.colorIndex), ...chart.lines.map(line => line.colorIndex))
  const svgMeta = buildSvgMetadata(chart)
  const svgTag = svgOpenTag(chart.width, chart.height, colors, transparent, svgMeta.openTag)
    .replace('<svg ', `<svg data-xychart-colors="${maxColorIdx}" `)

  const { style: chartStyle, defs } = chartStyles(chart, interactive, colors.accent, colors.bg, options, resolved.styleFace)
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
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(marks.definitions({ id: 'shadow-defs' }, `<defs>${shadowDefs}</defs>`))
  if (defs) parts.push(marks.definitions({ id: 'defs' }, defs))
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
    const channels = { category: `bar-${bar.seriesIndex}`, value: normalized(bar.value) }
    const roleStyle = resolveRoleStyle(resolved.styleFace, 'bar', channels, { includeFallback: false })
    const paletteFill = `var(--xychart-color-${bar.colorIndex})`
    const fill = hasAuthoredSeriesPalette ? paletteFill : roleStyle?.fillColor ?? paletteFill
    const stroke = roleStyle?.strokeColor ?? roleStyle?.borderColor
    const strokeWidth = roleStyle?.lineWidth
    const inlineStyle = roleStyleAttr({
      ...(hasAuthoredSeriesPalette ? {} : { fill: roleStyle?.fillColor }),
      stroke,
      strokeWidth,
    })
    parts.push(marks.shape({
      id: barId,
      role: 'bar',
      geometry: { kind: 'rect', x: rn(bar.x), y: rn(bar.y), width: rn(bar.width), height: rn(bar.height) },
      paint: {
        fill,
        ...(stroke ? { stroke } : {}),
        ...(strokeWidth !== undefined ? { strokeWidth: String(strokeWidth) } : {}),
      },
      channels,
    },
      `<rect x="${r(bar.x)}" y="${r(bar.y)}" width="${r(bar.width)}" height="${r(bar.height)}" ` +
      `class="xychart-bar xychart-color-${bar.colorIndex}"${inlineStyle}${dataAttrs}/>`,
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
        tooltipMarkup('xychart', tipAnchorX, tipAnchorY, tipText) +
        `</g>`,
      ))
    }
  }

  for (const line of chart.lines) {
    // A single sample has no relationship to route.  The graphical SVG has
    // historically treated its one-command path as invisible, while the
    // terminal renderer still draws the sample directly from the semantic
    // series.  Do not manufacture an invalid one-point Scene connector.
    if (line.points.length < 2) continue
    const d = polylinePath(line.points)
    const channels = { category: `line-${line.seriesIndex}` }
    const roleStyle = resolveRoleStyle(resolved.styleFace, 'series', channels, { includeFallback: false })
    const paletteStroke = `var(--xychart-color-${line.colorIndex})`
    const stroke = hasAuthoredSeriesPalette ? paletteStroke : roleStyle?.strokeColor ?? roleStyle?.borderColor ?? paletteStroke
    const strokeWidth = roleStyle?.lineWidth ?? style.lineWidth
    const inlineStyle = roleStyleAttr({
      ...(hasAuthoredSeriesPalette ? {} : { stroke: roleStyle?.strokeColor ?? roleStyle?.borderColor }),
      strokeWidth: roleStyle?.lineWidth,
    })
    parts.push(marks.connector({
      id: `series:line-${line.seriesIndex}`,
      role: 'series',
      geometry: { kind: 'path', d, points: line.points },
      lineStyle: 'solid',
      paint: { stroke, strokeWidth: String(strokeWidth) },
      channels,
    },
      `<path d="${d}" class="xychart-line xychart-color-${line.colorIndex}"${inlineStyle}/>`,
    ))
  }

  // Mermaid 11.16 line-point labels are semantic chart content, not hover
  // chrome. A label therefore forces a visible point mark even when the
  // interactive tooltip layer is disabled.
  for (const line of chart.lines) {
    line.points.forEach((point, pointIndex) => {
      if (point.textLabel === undefined) return
      const position = chart.horizontal ? 'right' : 'above'
      const x = point.x + (chart.horizontal ? 8 : 0)
      const y = point.y + (chart.horizontal ? 4 : -8)
      const anchor = chart.horizontal ? 'start' : 'middle'
      parts.push(marks.shape({
        id: `point-label-dot:${line.seriesIndex}:${pointIndex}`, role: 'point',
        geometry: { kind: 'circle', cx: rn(point.x), cy: rn(point.y), r: CHART_FONT.dotRadius },
        paint: { fill: `var(--xychart-color-${line.colorIndex})`, stroke: 'var(--bg)', strokeWidth: '1' },
        channels: { category: `line-${line.seriesIndex}`, value: normalized(point.value) },
      }, `<circle cx="${r(point.x)}" cy="${r(point.y)}" r="${CHART_FONT.dotRadius}" class="xychart-dot xychart-color-${line.colorIndex}" data-value="${point.value}"/>`))
      parts.push(marks.text({
        id: `point-label:${line.seriesIndex}:${pointIndex}`, role: 'label', text: point.textLabel,
        x, y, fontSize: 12, anchor,
        paint: { fill: `var(--xychart-color-${line.colorIndex})` },
        channels: { category: `line-${line.seriesIndex}`, value: normalized(point.value) },
      }, `<text class="xychart-point-label xychart-color-${line.colorIndex}" data-label-position="${position}" x="${r(x)}" y="${r(y)}" text-anchor="${anchor}" font-size="12" fill="var(--xychart-color-${line.colorIndex})">${escapeXml(point.textLabel)}</text>`))
    })
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
                tooltipMarkup('xychart', point.x, point.y - CHART_FONT.dotRadius, tipText)),
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
      const text = applyTextTransform(label.text, style.nodeTextTransform)
      const catIndex = labelSeriesCount.get(label.bar.seriesIndex) ?? 0
      labelSeriesCount.set(label.bar.seriesIndex, catIndex + 1)
      parts.push(marks.text({
        id: `label:bar:${label.bar.seriesIndex}:${label.bar.label ?? catIndex}`,
        role: 'label',
        text,
        x: label.x,
        y: label.y,
        fontSize: label.fontSize,
        anchor: label.anchor,
        paint: { fill: chartColors.labelColor },
        channels: { category: `bar-${label.bar.seriesIndex}`, value: normalized(label.bar.value) },
      },
        `<text x="${r(label.x)}" y="${r(label.y)}" text-anchor="${label.anchor}" ` +
        `${label.dominantBaseline ? `dominant-baseline="${label.dominantBaseline}" ` : ''}` +
        `font-size="${label.fontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)} class="xychart-data-label">${escapeXml(text)}</text>`,
      ))
    }
  }

  lowerAxisLabels(parts, chart.xAxis.ticks, chart.xAxis.config.labelFontSize, 'x', style, chartColors.xAxisLabelColor)
  lowerAxisLabels(parts, chart.yAxis.ticks, chart.yAxis.config.labelFontSize, 'y', style, chartColors.yAxisLabelColor)

  if (chart.xAxis.title) {
    const title = chart.xAxis.title
    const text = applyTextTransform(title.text, style.edgeTextTransform)
    const rotation = title.rotate ? { kind: 'rotate' as const, angle: title.rotate, cx: title.x, cy: title.y } : undefined
    const transform = rotation ? ` transform="rotate(${rotation.angle},${rotation.cx},${rotation.cy})"` : ''
    parts.push(marks.text({
      id: 'axis:x:title',
      role: 'axis',
      text,
      x: title.x,
      y: title.y,
      fontSize: chart.xAxis.config.titleFontSize,
      anchor: 'middle',
      paint: { fill: chartColors.xAxisTitleColor },
      transform: rotation,
    },
      `<text x="${title.x}" y="${title.y}" text-anchor="middle"${transform} ` +
      `font-size="${chart.xAxis.config.titleFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="xychart-axis-title xychart-x-axis-title">${escapeXml(text)}</text>`,
    ))
  }

  if (chart.yAxis.title) {
    const title = chart.yAxis.title
    const text = applyTextTransform(title.text, style.edgeTextTransform)
    const rotation = title.rotate ? { kind: 'rotate' as const, angle: title.rotate, cx: title.x, cy: title.y } : undefined
    const transform = rotation ? ` transform="rotate(${rotation.angle},${rotation.cx},${rotation.cy})"` : ''
    parts.push(marks.text({
      id: 'axis:y:title',
      role: 'axis',
      text,
      x: title.x,
      y: title.y,
      fontSize: chart.yAxis.config.titleFontSize,
      anchor: 'middle',
      paint: { fill: chartColors.yAxisTitleColor },
      transform: rotation,
    },
      `<text x="${title.x}" y="${title.y}" text-anchor="middle"${transform} ` +
      `font-size="${chart.yAxis.config.titleFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="xychart-axis-title xychart-y-axis-title">${escapeXml(text)}</text>`,
    ))
  }

  if (chart.title) {
    const title = applyTextTransform(chart.title.text, style.groupTextTransform)
    parts.push(marks.text({
      id: 'title',
      role: 'title',
      text: title,
      x: chart.title.x,
      y: chart.title.y,
      fontSize: chart.config.titleFontSize,
      anchor: 'middle',
      paint: { fill: chartColors.titleColor },
    },
      `<text x="${chart.title.x}" y="${chart.title.y}" text-anchor="middle" ` +
      `font-size="${chart.config.titleFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)} ` +
      `dy="${TEXT_BASELINE_SHIFT}" class="xychart-title">${escapeXml(title)}</text>`,
    ))
  }

  // Right-side legend (layout has already reserved its space inside the
  // canvas; an empty legend array means the chart is not legend-worthy, the
  // config hides it, or the column was dropped rather than clipped).
  if (chart.legend.length > 0) {
    const legendChildren: Array<{ node: SceneNode; indent: number }> = []
    for (const item of chart.legend) {
      const cy = item.y + LEGEND_SWATCH_SIZE / 2
      if (item.type === 'bar') {
        legendChildren.push({
          node: marks.shape({
            id: `legend:swatch:${item.colorIndex}`,
            role: 'legend',
            geometry: { kind: 'rect', x: rn(item.x), y: rn(item.y), width: LEGEND_SWATCH_SIZE, height: LEGEND_SWATCH_SIZE, rx: 2, ry: 2 },
            paint: { fill: `var(--xychart-color-${item.colorIndex})` },
            channels: { category: `bar-${item.seriesIndex}` },
          },
            `<rect x="${r(item.x)}" y="${r(item.y)}" width="${LEGEND_SWATCH_SIZE}" height="${LEGEND_SWATCH_SIZE}" rx="2" ry="2" ` +
            `class="xychart-legend-swatch" fill="var(--xychart-color-${item.colorIndex})"/>`),
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
            paint: { stroke: `var(--xychart-color-${item.colorIndex})`, strokeWidth: String(CHART_FONT.lineWidth) },
            channels: { category: `line-${item.seriesIndex}` },
          },
            `<line x1="${r(item.x)}" y1="${r(cy)}" x2="${r(item.x + LEGEND_SWATCH_SIZE)}" y2="${r(cy)}" ` +
            `class="xychart-legend-swatch" stroke="var(--xychart-color-${item.colorIndex})" stroke-width="${CHART_FONT.lineWidth}" stroke-linecap="round"/>`),
          indent: 2,
        })
        legendChildren.push({
          node: marks.shape({
            id: `legend:dot:${item.colorIndex}`,
            role: 'legend',
            geometry: { kind: 'circle', cx: rn(item.x + LEGEND_SWATCH_SIZE / 2), cy: rn(cy), r: 2.5 },
            paint: { fill: `var(--xychart-color-${item.colorIndex})`, stroke: 'var(--bg)', strokeWidth: '1' },
            channels: { category: `line-${item.seriesIndex}` },
          },
            `<circle cx="${r(item.x + LEGEND_SWATCH_SIZE / 2)}" cy="${r(cy)}" r="2.5" ` +
            `class="xychart-legend-dot" fill="var(--xychart-color-${item.colorIndex})" stroke="var(--bg)" stroke-width="1"/>`),
          indent: 2,
        })
      }
      const label = applyTextTransform(item.label, style.nodeTextTransform)
      const labelX = item.x + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_GAP
      legendChildren.push({
        node: marks.text({
          id: `legend:label:${item.colorIndex}`,
          role: 'legend',
          text: label,
          x: rn(labelX),
          y: rn(cy),
          fontSize: chart.config.legendFontSize,
          anchor: 'start',
          paint: { fill: chartColors.legendTextColor },
        },
          `<text x="${r(labelX)}" y="${r(cy)}" text-anchor="start" dominant-baseline="middle" ` +
          `font-size="${chart.config.legendFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)} ` +
          `class="xychart-legend-label">${escapeXml(label)}</text>`),
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
    const label = applyTextTransform(tick.label, style.edgeTextTransform)
    const middleBaseline = tick.textAnchor === 'end' ? ' dominant-baseline="middle"' : ''
    const dy = tick.textAnchor === 'end' ? '' : ` dy="${TEXT_BASELINE_SHIFT}"`
    parts.push(marks.text({
      id: `axis:${axisName}:label:${tick.label}`,
      role: 'axis',
      text: label,
      x: tick.labelX,
      y: tick.labelY,
      fontSize,
      anchor: tick.textAnchor,
      paint: { fill },
    },
      `<text x="${tick.labelX}" y="${tick.labelY}" text-anchor="${tick.textAnchor}"${middleBaseline} ` +
      `font-size="${fontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}${dy} class="xychart-label xychart-${axisName}-label">` +
      `${escapeXml(label)}</text>`,
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
    axisTitleColor: renderStyle.edgeTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
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

function chartStyles(
  chart: PositionedXYChart,
  interactive: boolean,
  themeAccent?: string,
  bgColor?: string,
  options: RenderOptions = {},
  styleFace?: Readonly<InternalStyleFace>,
): { style: string; defs: string } {
  const renderStyle = resolveRenderStyle(options, XY_STYLE_DEFAULTS, styleFace)
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

  const tipRules = interactive ? tooltipCss('xychart', ['xychart-bar-group', 'xychart-dot-group']) : ''

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
  .xychart-data-label { fill: ${cc.labelColor}; pointer-events: none; }${chart.legend.length > 0 ? `\n  .xychart-legend-label { fill: ${cc.legendTextColor}; }` : ''}${colorVarsBlock}
${seriesRules.join('\n')}${tipRules}${extraThemeCss}
</style>`

  return { style, defs: '' }
}

function roleStyleAttr(values: { fill?: string; stroke?: string; strokeWidth?: number }): string {
  const declarations: string[] = []
  if (values.fill !== undefined) declarations.push(`fill:${escapeXml(values.fill)}`)
  if (values.stroke !== undefined) declarations.push(`stroke:${escapeXml(values.stroke)}`)
  if (values.strokeWidth !== undefined) declarations.push(`stroke-width:${values.strokeWidth}`)
  return declarations.length > 0 ? ` style="${declarations.join(';')}"` : ''
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
