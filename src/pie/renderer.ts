import type { PositionedPieChart } from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { formatPieValue, formatPiePercent } from './layout.ts'

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
// Deterministic: no Math.random / Date.now. Slice colors come from the layout.
// ============================================================================

const PIE = {
  titleFontSize: 18,
  titleFontWeight: 600,
  legendFontSize: 13,
  legendFontWeight: 500,
  sliceStrokeWidth: 1.5,
} as const

/**
 * Render a positioned pie chart as an SVG string.
 */
export function renderPieSvg(
  chart: PositionedPieChart,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  _options: RenderOptions = {},
): string {
  const parts: string[] = []

  parts.push(openPieSvgTag(chart, colors, transparent))
  parts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(`<defs>${shadowDefs}</defs>`)
  parts.push(pieStyles())

  // Slices.
  for (const slice of chart.slices) {
    const pct = formatPiePercent(slice.fraction)
    parts.push(
      `<path class="pie-slice" d="${slice.path}" fill="${slice.color}" ` +
        `data-label="${escapeXml(slice.label)}" data-value="${slice.value}" data-percent="${pct}" />`,
    )
  }

  // Legend.
  for (const item of chart.legend) {
    const valuePart = chart.showData ? ` [${formatPieValue(item.value)}]` : ''
    const text = `${item.label}${valuePart} (${formatPiePercent(item.fraction)})`
    parts.push(
      `<rect class="pie-legend-swatch" x="${item.x}" y="${item.y}" width="${item.swatchSize}" height="${item.swatchSize}" rx="2" ry="2" fill="${item.color}" />`,
    )
    parts.push(
      renderMultilineText(
        text,
        item.textX,
        item.textY,
        PIE.legendFontSize,
        `class="pie-legend-text" text-anchor="start" dominant-baseline="middle" font-size="${PIE.legendFontSize}" font-weight="${PIE.legendFontWeight}"`,
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
        PIE.titleFontSize,
        `class="pie-title" text-anchor="middle" dominant-baseline="middle" font-size="${PIE.titleFontSize}" font-weight="${PIE.titleFontWeight}"`,
      ),
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

function openPieSvgTag(
  chart: PositionedPieChart,
  colors: DiagramColors,
  transparent: boolean,
): string {
  const attrs = ['role="img"', 'aria-roledescription="pie chart"']
  return svgOpenTag(chart.width, chart.height, colors, transparent).replace('>', ` ${attrs.join(' ')}>`)
}

function pieStyles(): string {
  return `<style>
  .pie-slice { stroke: var(--bg); stroke-width: ${PIE.sliceStrokeWidth}; }
  .pie-legend-swatch { stroke: var(--_node-stroke); stroke-width: 1; }
  .pie-legend-text { fill: var(--_text); }
  .pie-title { fill: var(--_text); }
</style>`
}
