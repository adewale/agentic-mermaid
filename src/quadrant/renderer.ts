import type { PositionedQuadrantChart } from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { QUADRANT_METRICS } from './layout.ts'

// ============================================================================
// Quadrant chart SVG renderer
//
// Visual language:
//   - a square plot area split into four quadrant background rectangles with
//     subtle theme-derived fills (color-mix from --accent + --bg)
//   - quadrant labels centered in each region
//   - x-axis labels on the bottom edge, y-axis labels (rotated) on the left
//   - points as accent circles with labels
//   - an optional title centered above the plot
//
// Deterministic: no Math.random / Date.now. All geometry comes from layout.
// ============================================================================

const STROKE = {
  externalWidth: 2,
  internalWidth: 1,
} as const

/**
 * Render a positioned quadrant chart as an SVG string.
 */
export function renderQuadrantSvg(
  chart: PositionedQuadrantChart,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  _options: RenderOptions = {},
): string {
  const parts: string[] = []

  parts.push(openQuadrantSvgTag(chart, colors, transparent))
  parts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(`<defs>${shadowDefs}</defs>`)
  parts.push(quadrantStyles())

  const { plot } = chart
  const half = plot.size / 2

  // Quadrant background rectangles.
  for (const region of chart.regions) {
    parts.push(
      `<rect class="quadrant-region" x="${region.x}" y="${region.y}" ` +
        `width="${region.width}" height="${region.height}" fill="${region.fill}" ` +
        `data-quadrant="${region.number}" />`,
    )
  }

  // Internal divider lines.
  const midX = plot.x + half
  const midY = plot.y + half
  parts.push(
    `<line class="quadrant-divider" x1="${midX}" y1="${plot.y}" x2="${midX}" y2="${plot.y + plot.size}" />`,
  )
  parts.push(
    `<line class="quadrant-divider" x1="${plot.x}" y1="${midY}" x2="${plot.x + plot.size}" y2="${midY}" />`,
  )

  // External border.
  parts.push(
    `<rect class="quadrant-border" x="${plot.x}" y="${plot.y}" width="${plot.size}" height="${plot.size}" fill="none" />`,
  )

  // Quadrant labels.
  for (const region of chart.regions) {
    if (!region.label) continue
    parts.push(
      renderMultilineText(
        region.label,
        region.labelX,
        region.labelY,
        QUADRANT_METRICS.quadrantFontSize,
        `class="quadrant-label" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${QUADRANT_METRICS.quadrantFontSize}" font-weight="600"`,
      ),
    )
  }

  // Points.
  for (const point of chart.points) {
    parts.push(
      `<circle class="quadrant-point" cx="${point.cx}" cy="${point.cy}" r="${point.radius}" ` +
        `data-label="${escapeXml(point.label)}" data-x="${point.nx}" data-y="${point.ny}" />`,
    )
    parts.push(
      renderMultilineText(
        point.label,
        point.cx + point.radius + 4,
        point.cy,
        QUADRANT_METRICS.pointFontSize,
        `class="quadrant-point-label" text-anchor="start" dominant-baseline="middle" ` +
          `font-size="${QUADRANT_METRICS.pointFontSize}" font-weight="500"`,
      ),
    )
  }

  // Axis labels.
  for (const axis of chart.axisLabels) {
    // y-axis labels sit in the left gutter and are rotated upright.
    const isYAxis = axis.x < plot.x
    const transform = isYAxis ? ` transform="rotate(-90 ${axis.x} ${axis.y})"` : ''
    parts.push(
      `<text class="quadrant-axis-label" x="${axis.x}" y="${axis.y}" ` +
        `text-anchor="${axis.anchor}" font-size="${QUADRANT_METRICS.axisFontSize}" font-weight="500"${transform}>` +
        `${escapeXml(axis.text)}</text>`,
    )
  }

  // Title.
  if (chart.title) {
    parts.push(
      renderMultilineText(
        chart.title.text,
        chart.title.x,
        chart.title.y,
        QUADRANT_METRICS.titleFontSize,
        `class="quadrant-title" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${QUADRANT_METRICS.titleFontSize}" font-weight="600"`,
      ),
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

function openQuadrantSvgTag(
  chart: PositionedQuadrantChart,
  colors: DiagramColors,
  transparent: boolean,
): string {
  const attrs = ['role="img"', 'aria-roledescription="quadrant chart"']
  return svgOpenTag(chart.width, chart.height, colors, transparent).replace('>', ` ${attrs.join(' ')}>`)
}

function quadrantStyles(): string {
  return `<style>
  .quadrant-region { stroke: none; }
  .quadrant-divider { stroke: var(--_line); stroke-width: ${STROKE.internalWidth}; }
  .quadrant-border { stroke: var(--_node-stroke); stroke-width: ${STROKE.externalWidth}; }
  .quadrant-label { fill: var(--_text-sec); }
  .quadrant-point { fill: var(--accent, var(--_arrow)); stroke: var(--bg); stroke-width: 1; }
  .quadrant-point-label { fill: var(--_text); }
  .quadrant-axis-label { fill: var(--_text-muted); }
  .quadrant-title { fill: var(--_text); }
</style>`
}
