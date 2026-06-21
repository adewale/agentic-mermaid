import type { PositionedPieChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { formatPieValue, formatPiePercent } from './layout.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK, isValidHex } from '../xychart/colors.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'

// ============================================================================
// Pie chart SVG renderer
//
// Visual language:
//   - circle of clockwise slices (SVG <path> wedges) with a theme-derived,
//     same-family palette (reuses the xychart getSeriesColor utility)
//   - a vertical legend: color swatch + label, with percentage and, when
//     `showData`, the raw numeric value
//   - optional title centered above the chart
//
// Deterministic: no Math.random / Date.now. Slice colors come from RenderContext.
// ============================================================================

const PIE = {
  titleFontSize: 18,
  titleFontWeight: 600,
  legendFontSize: 13,
  legendFontWeight: 500,
  sliceStrokeWidth: 1.5,
} as const

const PIE_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: PIE.legendFontSize,
  edgeLabelFontSize: PIE.legendFontSize,
  groupHeaderFontSize: PIE.titleFontSize,
  nodeLabelFontWeight: PIE.legendFontWeight,
  edgeLabelFontWeight: PIE.legendFontWeight,
  groupHeaderFontWeight: PIE.titleFontWeight,
  nodePaddingX: 0,
  nodePaddingY: 0,
  nodeLineWidth: PIE.sliceStrokeWidth,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: 0,
  groupPaddingY: 0,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

/**
 * Render a positioned pie chart as an SVG string.
 */
export function renderPieSvg(
  ctx: RenderContext<PositionedPieChart>,
): string {
  const { positioned: chart, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const style = resolveRenderStyle(options, PIE_STYLE_DEFAULTS)
  const parts: string[] = []

  parts.push(openPieSvgTag(chart, colors, transparent))
  parts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(`<defs>${shadowDefs}</defs>`)
  parts.push(pieStyles(style))

  // Slices.
  for (let index = 0; index < chart.slices.length; index++) {
    const slice = chart.slices[index]!
    const pct = formatPiePercent(slice.fraction)
    parts.push(
      `<path class="pie-slice" d="${slice.path}" fill="${sliceColor(index, colors)}" ` +
        `data-label="${escapeXml(slice.label)}" data-value="${slice.value}" data-percent="${pct}" />`,
    )
  }

  // Legend.
  for (let index = 0; index < chart.legend.length; index++) {
    const item = chart.legend[index]!
    const valuePart = chart.showData ? ` [${formatPieValue(item.value)}]` : ''
    const text = `${item.label}${valuePart} (${formatPiePercent(item.fraction)})`
    parts.push(
      `<rect class="pie-legend-swatch" x="${item.x}" y="${item.y}" width="${item.swatchSize}" height="${item.swatchSize}" rx="2" ry="2" fill="${sliceColor(index, colors)}" />`,
    )
    parts.push(
      renderMultilineText(
        text,
        item.textX,
        item.textY,
        style.nodeLabelFontSize,
        `class="pie-legend-text" text-anchor="start" dominant-baseline="middle" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
      ),
    )
  }

  // Title.
  if (chart.title) {
    parts.push(
      renderMultilineText(
        chart.title.text,
        chart.title.x,
        chart.title.y,
        style.groupHeaderFontSize,
        `class="pie-title" text-anchor="middle" dominant-baseline="middle" font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)}`,
      ),
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

function sliceColor(index: number, colors: DiagramColors): string {
  const safeAccent = colors.accent && isValidHex(colors.accent) ? colors.accent : CHART_ACCENT_FALLBACK
  const safeBg = colors.bg && isValidHex(colors.bg) ? colors.bg : undefined
  return getSeriesColor(index, safeAccent, safeBg)
}

function openPieSvgTag(
  chart: PositionedPieChart,
  colors: DiagramColors,
  transparent: boolean,
): string {
  const attrs = ['role="img"', 'aria-roledescription="pie chart"']
  return svgOpenTag(chart.width, chart.height, colors, transparent).replace('>', ` ${attrs.join(' ')}>`)
}

function pieStyles(style: ResolvedRenderStyle): string {
  return `<style>
  .pie-slice { stroke: ${style.nodeBorderColor ?? 'var(--bg)'}; stroke-width: ${style.nodeLineWidth}; }
  .pie-legend-swatch { stroke: ${style.nodeBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${style.nodeBorderColor ? Math.max(1, style.nodeLineWidth) : 1}; }
  .pie-legend-text { fill: ${style.nodeTextColor ?? 'var(--_text)'}; }
  .pie-title { fill: ${style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }
</style>`
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}
