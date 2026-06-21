import type { PositionedQuadrantChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { QUADRANT_METRICS } from './layout.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'

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

const QUADRANT_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: QUADRANT_METRICS.pointFontSize,
  edgeLabelFontSize: QUADRANT_METRICS.axisFontSize,
  groupHeaderFontSize: QUADRANT_METRICS.quadrantFontSize,
  nodeLabelFontWeight: 500,
  edgeLabelFontWeight: 500,
  groupHeaderFontWeight: 600,
  nodePaddingX: 0,
  nodePaddingY: 0,
  nodeLineWidth: STROKE_WIDTHS.innerBox,
  edgeLineWidth: STROKE.internalWidth,
  groupCornerRadius: 0,
  groupPaddingX: 0,
  groupPaddingY: 0,
  groupLineWidth: STROKE.externalWidth,
}

/**
 * Render a positioned quadrant chart as an SVG string.
 */
export function renderQuadrantSvg(
  ctx: RenderContext<PositionedQuadrantChart>,
): string {
  const { positioned: chart, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const style = resolveRenderStyle(options, QUADRANT_STYLE_DEFAULTS)
  const parts: string[] = []

  parts.push(openQuadrantSvgTag(chart, colors, transparent))
  parts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(`<defs>${shadowDefs}</defs>`)
  parts.push(quadrantStyles(style))

  const { plot } = chart
  const half = plot.size / 2

  // Quadrant background rectangles.
  for (const region of chart.regions) {
    parts.push(
      `<rect class="quadrant-region" x="${region.x}" y="${region.y}" ` +
        `width="${region.width}" height="${region.height}" fill="${quadrantFill(region.number, style)}" ` +
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
        style.groupHeaderFontSize,
        `class="quadrant-label" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)}`,
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
        style.nodeLabelFontSize,
        `class="quadrant-point-label" text-anchor="start" dominant-baseline="middle" ` +
          `font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
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
        `text-anchor="${axis.anchor}" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)}${transform}>` +
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
          `font-size="${QUADRANT_METRICS.titleFontSize}" font-weight="${Math.max(style.groupHeaderFontWeight, 600)}"${letterAttr(style.groupLetterSpacing)}`,
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

/**
 * Per-quadrant background fill, derived from render-time theme variables.
 * Quadrants alternate two subtle accent tints so all four regions are visible.
 */
function quadrantFill(number: 1 | 2 | 3 | 4, style: ResolvedRenderStyle): string {
  const accentPct = number === 1 || number === 3 ? 10 : 5
  if (style.groupFillColor) {
    const groupPct = number === 1 || number === 3 ? 88 : 76
    return `color-mix(in srgb, ${style.groupFillColor} ${groupPct}%, var(--bg))`
  }
  return `color-mix(in srgb, var(--accent, var(--_arrow)) ${accentPct}%, var(--bg))`
}

function quadrantStyles(style: ResolvedRenderStyle): string {
  return `<style>
  .quadrant-region { stroke: none; }
  .quadrant-divider { stroke: ${style.edgeStrokeColor ?? 'var(--_line)'}; stroke-width: ${style.lineWidth}; }
  .quadrant-border { stroke: ${style.groupBorderColor ?? style.nodeBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${style.groupLineWidth}; }
  .quadrant-label { fill: ${style.groupTextColor ?? 'var(--_text-sec)'}; }
  .quadrant-point { fill: ${style.nodeFillColor ?? 'var(--accent, var(--_arrow))'}; stroke: ${style.nodeBorderColor ?? 'var(--bg)'}; stroke-width: ${Math.max(1, style.nodeLineWidth)}; }
  .quadrant-point-label { fill: ${style.nodeTextColor ?? 'var(--_text)'}; }
  .quadrant-axis-label { fill: ${style.edgeTextColor ?? 'var(--_text-muted)'}; }
  .quadrant-title { fill: ${style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }
</style>`
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}
