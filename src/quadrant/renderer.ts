import type { PositionedQuadrantChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { QUADRANT_METRICS } from './layout.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'

// ============================================================================
// Quadrant chart SVG renderer
//
// The chart is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id) plus its exact crisp serialization, built here from
// the same inputs. renderQuadrantSvg() is DefaultBackend serialization of
// that scene, so the default path stays byte-identical to the historical
// string renderer (corpus-gated by svg-equivalence.test.ts).
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
  return DefaultBackend.render(lowerQuadrantScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned quadrant chart to the SceneGraph IR. Mark order matches
 * the historical parts[] order exactly; DefaultBackend joins crisps with '\n'.
 */
export function lowerQuadrantScene(
  ctx: RenderContext<PositionedQuadrantChart>,
): SceneDoc {
  const { positioned: chart, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const style = resolveRenderStyle(options, QUADRANT_STYLE_DEFAULTS)
  const parts: SceneNode[] = []

  // Document shell: SVG root with CSS variables + shared style block +
  // optional shadow defs + the quadrant CSS, joined exactly as the string
  // renderer pushed them. The shadow filter is derived purely from `colors`
  // (a prelude parameter), so it belongs to the shell a styled backend
  // re-derives rather than a standalone defs mark.
  const extraCss = quadrantStyles(style)
  const preludeSegments = [
    openQuadrantSvgTag(chart, colors, transparent),
    buildStyleBlock(font, false, colors.shadow, colors.embedFontImport),
  ]
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) preludeSegments.push(`<defs>${shadowDefs}</defs>`)
  preludeSegments.push(extraCss)
  parts.push(marks.prelude(
    {
      id: 'prelude',
      width: chart.width,
      height: chart.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
      extraCss,
    },
    preludeSegments.join('\n'),
  ))

  const { plot } = chart
  const half = plot.size / 2

  // Quadrant background rectangles.
  for (const region of chart.regions) {
    const fill = quadrantFill(region.number, style)
    parts.push(marks.shape(
      {
        id: `plate:${region.number}`,
        role: 'plate',
        geometry: { kind: 'rect', x: region.x, y: region.y, width: region.width, height: region.height },
        paint: { fill, stroke: 'none' },
        channels: region.label ? { category: region.label } : undefined,
      },
      `<rect class="quadrant-region" x="${region.x}" y="${region.y}" ` +
        `width="${region.width}" height="${region.height}" fill="${fill}" ` +
        `data-quadrant="${region.number}" />`,
    ))
  }

  // Internal divider lines.
  const midX = plot.x + half
  const midY = plot.y + half
  const dividerPaint = {
    stroke: style.edgeStrokeColor ?? 'var(--_line)',
    strokeWidth: String(style.lineWidth),
  }
  parts.push(marks.shape(
    {
      id: 'divider:v',
      role: 'grid',
      geometry: { kind: 'line', x1: midX, y1: plot.y, x2: midX, y2: plot.y + plot.size },
      paint: dividerPaint,
    },
    `<line class="quadrant-divider" x1="${midX}" y1="${plot.y}" x2="${midX}" y2="${plot.y + plot.size}" />`,
  ))
  parts.push(marks.shape(
    {
      id: 'divider:h',
      role: 'grid',
      geometry: { kind: 'line', x1: plot.x, y1: midY, x2: plot.x + plot.size, y2: midY },
      paint: dividerPaint,
    },
    `<line class="quadrant-divider" x1="${plot.x}" y1="${midY}" x2="${plot.x + plot.size}" y2="${midY}" />`,
  ))

  // External border.
  parts.push(marks.shape(
    {
      id: 'border',
      role: 'chrome',
      geometry: { kind: 'rect', x: plot.x, y: plot.y, width: plot.size, height: plot.size },
      paint: {
        fill: 'none',
        stroke: style.groupBorderColor ?? style.nodeBorderColor ?? 'var(--_node-stroke)',
        strokeWidth: String(style.groupLineWidth),
      },
    },
    `<rect class="quadrant-border" x="${plot.x}" y="${plot.y}" width="${plot.size}" height="${plot.size}" fill="none" />`,
  ))

  // Quadrant labels.
  for (const region of chart.regions) {
    if (!region.label) continue
    parts.push(marks.text(
      {
        id: `quadrant-label:${region.number}`,
        role: 'label',
        text: region.label,
        x: region.labelX,
        y: region.labelY,
        fontSize: style.groupHeaderFontSize,
        anchor: 'middle',
        paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
        channels: { category: region.label },
      },
      renderMultilineText(
        region.label,
        region.labelX,
        region.labelY,
        style.groupHeaderFontSize,
        `class="quadrant-label" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)}`,
      ),
    ))
  }

  // Points.
  for (const point of chart.points) {
    parts.push(marks.shape(
      {
        id: `point:${point.label}`,
        role: 'point',
        geometry: { kind: 'circle', cx: point.cx, cy: point.cy, r: point.radius },
        paint: {
          fill: style.nodeFillColor ?? 'var(--accent, var(--_arrow))',
          stroke: style.nodeBorderColor ?? 'var(--bg)',
          strokeWidth: String(Math.max(1, style.nodeLineWidth)),
        },
      },
      `<circle class="quadrant-point" cx="${point.cx}" cy="${point.cy}" r="${point.radius}" ` +
        `data-label="${escapeXml(point.label)}" data-x="${point.nx}" data-y="${point.ny}" />`,
    ))
    parts.push(marks.text(
      {
        id: `point-label:${point.label}`,
        role: 'label',
        text: point.label,
        x: point.cx + point.radius + 4,
        y: point.cy,
        fontSize: style.nodeLabelFontSize,
        anchor: 'start',
        paint: { fill: style.nodeTextColor ?? 'var(--_text)' },
      },
      renderMultilineText(
        point.label,
        point.labelX,
        point.labelY,
        style.nodeLabelFontSize,
        `class="quadrant-point-label" text-anchor="${point.labelAnchor}" dominant-baseline="middle" ` +
          `font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
      ),
    ))
  }

  // Axis labels.
  for (const axis of chart.axisLabels) {
    // y-axis labels sit in the left gutter and are rotated upright.
    const isYAxis = axis.x < plot.x
    const transform = isYAxis ? ` transform="rotate(-90 ${axis.x} ${axis.y})"` : ''
    parts.push(marks.text(
      {
        id: `axis:${axis.text}`,
        role: 'axis',
        text: axis.text,
        x: axis.x,
        y: axis.y,
        fontSize: style.edgeLabelFontSize,
        anchor: axis.anchor,
        paint: { fill: style.edgeTextColor ?? 'var(--_text-muted)' },
      },
      `<text class="quadrant-axis-label" x="${axis.x}" y="${axis.y}" ` +
        `text-anchor="${axis.anchor}" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)}${transform}>` +
        `${escapeXml(axis.text)}</text>`,
    ))
  }

  // Title.
  if (chart.title) {
    parts.push(marks.text(
      {
        id: 'title',
        role: 'title',
        text: chart.title.text,
        x: chart.title.x,
        y: chart.title.y,
        fontSize: QUADRANT_METRICS.titleFontSize,
        anchor: 'middle',
        paint: { fill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
      },
      renderMultilineText(
        chart.title.text,
        chart.title.x,
        chart.title.y,
        QUADRANT_METRICS.titleFontSize,
        `class="quadrant-title" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${QUADRANT_METRICS.titleFontSize}" font-weight="${Math.max(style.groupHeaderFontWeight, 600)}"${letterAttr(style.groupLetterSpacing)}`,
      ),
    ))
  }

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'quadrant', width: chart.width, height: chart.height, colors, parts }
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
