import type { PositionedPieChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { formatPieValue, formatPiePercent } from './layout.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK, isValidHex } from '../xychart/colors.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'

// ============================================================================
// Pie chart SVG renderer
//
// The chart is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id) plus its exact crisp serialization, built here from
// the same inputs. renderPieSvg() is DefaultBackend serialization of that
// scene, so the default path stays byte-identical to the historical string
// renderer (corpus-gated by svg-equivalence.test.ts).
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
  return DefaultBackend.render(lowerPieScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned pie chart to the SceneGraph IR. Mark order matches the
 * historical parts[] order exactly; DefaultBackend joins crisps with '\n'.
 */
export function lowerPieScene(
  ctx: RenderContext<PositionedPieChart>,
): SceneDoc {
  const { positioned: chart, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const style = resolveRenderStyle(options, PIE_STYLE_DEFAULTS)
  const parts: SceneNode[] = []

  // Document shell: custom pie <svg> open tag + shared style block + optional
  // shadow defs + pie <style>, in the exact pushed order. Every piece is
  // derivable from the prelude fields (shadow defs from colors, pie CSS via
  // extraCss), so styled backends can re-derive the shell without parsing.
  const headParts: string[] = []
  headParts.push(openPieSvgTag(chart, colors, transparent))
  headParts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) headParts.push(`<defs>${shadowDefs}</defs>`)
  const pieCss = pieStyles(style)
  headParts.push(pieCss)
  parts.push(marks.prelude(
    {
      id: 'prelude',
      width: chart.width,
      height: chart.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
      extraCss: pieCss,
    },
    headParts.join('\n'),
  ))

  // Slices. Duplicate labels get occurrence suffixes so scene ids stay
  // unique (the §8 seed contract keys substreams on them).
  const labelOccurrence = new Map<string, number>()
  const occurrenceId = (prefix: string, label: string) => {
    const key = `${prefix}:${label}`
    const k = labelOccurrence.get(key) ?? 0
    labelOccurrence.set(key, k + 1)
    return k === 0 ? key : `${key}#${k}`
  }
  for (let index = 0; index < chart.slices.length; index++) {
    const slice = chart.slices[index]!
    const pct = formatPiePercent(slice.fraction)
    const fill = sliceColor(index, colors)
    parts.push(marks.shape(
      {
        id: occurrenceId('slice', slice.label),
        role: 'pie-slice',
        geometry: { kind: 'path', d: slice.path },
        // Stroke comes from the .pie-slice rule in pieStyles().
        paint: { fill, stroke: style.nodeBorderColor ?? 'var(--bg)', strokeWidth: String(style.nodeLineWidth) },
        channels: { category: slice.label, value: slice.fraction },
      },
      `<path class="pie-slice" d="${slice.path}" fill="${fill}" ` +
        `data-label="${escapeXml(slice.label)}" data-value="${slice.value}" data-percent="${pct}" />`,
    ))
  }

  // Legend.
  for (let index = 0; index < chart.legend.length; index++) {
    const item = chart.legend[index]!
    const fill = sliceColor(index, colors)
    parts.push(marks.shape(
      {
        id: occurrenceId('legend', item.label),
        role: 'legend',
        geometry: { kind: 'rect', x: item.x, y: item.y, width: item.swatchSize, height: item.swatchSize, rx: 2, ry: 2 },
        // Stroke comes from the .pie-legend-swatch rule in pieStyles().
        paint: {
          fill,
          stroke: style.nodeBorderColor ?? 'var(--_node-stroke)',
          strokeWidth: String(style.nodeBorderColor ? Math.max(1, style.nodeLineWidth) : 1),
        },
        channels: { category: item.label, value: item.fraction },
      },
      `<rect class="pie-legend-swatch" x="${item.x}" y="${item.y}" width="${item.swatchSize}" height="${item.swatchSize}" rx="2" ry="2" fill="${fill}" />`,
    ))
    const valuePart = chart.showData ? ` [${formatPieValue(item.value)}]` : ''
    const text = `${item.label}${valuePart} (${formatPiePercent(item.fraction)})`
    parts.push(marks.text(
      {
        id: occurrenceId('legend-label', item.label),
        role: 'legend',
        text,
        x: item.textX,
        y: item.textY,
        fontSize: style.nodeLabelFontSize,
        anchor: 'start',
        // Fill comes from the .pie-legend-text rule in pieStyles().
        paint: { fill: style.nodeTextColor ?? 'var(--_text)' },
        channels: { category: item.label, value: item.fraction },
      },
      renderMultilineText(
        text,
        item.textX,
        item.textY,
        style.nodeLabelFontSize,
        `class="pie-legend-text" text-anchor="start" dominant-baseline="middle" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
      ),
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
        fontSize: style.groupHeaderFontSize,
        anchor: 'middle',
        // Fill comes from the .pie-title rule in pieStyles().
        paint: { fill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
      },
      renderMultilineText(
        chart.title.text,
        chart.title.x,
        chart.title.y,
        style.groupHeaderFontSize,
        `class="pie-title" text-anchor="middle" dominant-baseline="middle" font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)}`,
      ),
    ))
  }

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'pie', width: chart.width, height: chart.height, colors, parts }
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
  return svgOpenTag(chart.width, chart.height, colors, transparent, {
    attrs: { role: 'img', 'aria-roledescription': 'pie chart' },
  })
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
