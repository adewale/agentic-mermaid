import type { PositionedPieChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { formatPieValue, formatPiePercent, PIE_SLICE_LABEL_FONT_WEIGHT } from './layout.ts'
import type { PieVisualConfig } from './config.ts'
import { pieSliceColors } from './palette.ts'
import { contrastTextColor } from '../color-resolver.ts'
import { tooltipMarkup, tooltipCss } from '../shared/svg-tooltip.ts'
import { STROKE_WIDTHS, applyTextTransform, resolveRenderStyle } from '../styles.ts'
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
//   - circle of clockwise slices (SVG <path> wedges; annular in donut mode)
//     with fills from the shared pie palette (pie1..pie12 theme variables in
//     source order, else the accent-derived / hue-spread palette)
//   - on-slice percentage labels placed by the layout's collision policy
//   - a legend column (position from `pie.legendPosition`): color swatch +
//     label, with percentage and, when `showData`, the raw numeric value
//   - optional title centered above the chart
//   - optional outer circle + slice stroke/opacity from pie theme variables
//   - optional hover tooltips (`interactive`, shared machinery with xychart)
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
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const style = resolveRenderStyle(options, PIE_STYLE_DEFAULTS, resolved.styleFace)
  const visual = chart.visual
  const parts: SceneNode[] = []

  // One palette for wedges, legend swatches, and the ASCII renderer (shared
  // module) — surfaces can never disagree about slice identity.
  const fills = pieSliceColors(chart.slices.length, {
    accent: colors.accent,
    bg: colors.bg,
    overrides: visual.paletteOverrides,
  })

  // Document shell: custom pie <svg> open tag + shared style block + optional
  // shadow defs + pie <style>, in the exact pushed order. Every piece is
  // derivable from the prelude fields (shadow defs from colors, pie CSS via
  // extraCss), so styled backends can re-derive the shell without parsing.
  const headParts: string[] = []
  headParts.push(openPieSvgTag(chart, colors, transparent))
  headParts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) headParts.push(`<defs>${shadowDefs}</defs>`)
  const pieCss = pieStyles(style, visual, interactive)
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

  // Outer circle — only when the pieOuterStroke* theme variables ask for one
  // (upstream draws it at radius + strokeWidth/2; the crisp default has none).
  if (visual.outerStrokeWidth !== undefined || visual.outerStrokeColor !== undefined) {
    const outerWidth = visual.outerStrokeWidth ?? 2
    const r = rnd(chart.radius + outerWidth / 2)
    parts.push(marks.shape(
      {
        id: 'outer-circle',
        role: 'chrome',
        geometry: { kind: 'circle', cx: chart.cx, cy: chart.cy, r },
        paint: {
          fill: 'none',
          stroke: outerStrokeColor(visual, style),
          strokeWidth: String(outerWidth),
        },
      },
      `<circle class="pie-outer-circle" cx="${chart.cx}" cy="${chart.cy}" r="${r}" fill="none" />`,
    ))
  }

  // Slices. Duplicate labels get occurrence suffixes so scene ids stay
  // unique (the §8 seed contract keys substreams on them).
  const labelOccurrence = new Map<string, number>()
  const occurrenceId = (prefix: string, label: string) => {
    const key = `${prefix}:${label}`
    const k = labelOccurrence.get(key) ?? 0
    labelOccurrence.set(key, k + 1)
    return k === 0 ? key : `${key}#${k}`
  }
  const sliceStroke = visual.strokeColor ?? style.nodeBorderColor ?? 'var(--bg)'
  const sliceStrokeWidth = visual.strokeWidth ?? style.nodeLineWidth
  for (let index = 0; index < chart.slices.length; index++) {
    const slice = chart.slices[index]!
    const pct = formatPiePercent(slice.fraction)
    const fill = fills[index]!
    const highlighted = visual.highlightSlice === slice.label
    const hoverHighlight = visual.highlightSlice === 'hover'
    const sliceClass = `pie-slice${highlighted ? ' highlighted' : ''}${hoverHighlight ? ' highlighted-on-hover' : ''}`
    parts.push(marks.shape(
      {
        id: occurrenceId('slice', slice.label),
        role: 'pie-slice',
        geometry: { kind: 'path', d: slice.path },
        // Stroke comes from the .pie-slice rule in pieStyles().
        paint: {
          fill,
          stroke: sliceStroke,
          strokeWidth: String(sliceStrokeWidth),
          ...(visual.opacity !== undefined ? { opacity: String(visual.opacity) } : {}),
        },
        channels: { category: slice.label, value: slice.fraction },
      },
      `<path class="${sliceClass}" d="${slice.path}" fill="${escapeXml(fill)}" ` +
        `data-label="${escapeXml(slice.label)}" data-value="${slice.value}" data-percent="${pct}"${highlighted ? ' data-highlighted="true"' : ''} />`,
    ))
  }

  // On-slice percentage labels (layout's collision policy decides presence).
  for (let index = 0; index < chart.slices.length; index++) {
    const slice = chart.slices[index]!
    const label = slice.pctLabel
    if (!label) continue
    const fill = visual.sectionTextColor ?? contrastTextColor(fills[index]!) ?? 'var(--_text)'
    parts.push(marks.text(
      {
        id: occurrenceId('slice-label', slice.label),
        role: 'label',
        text: label.text,
        x: label.x,
        y: label.y,
        fontSize: label.fontSize,
        anchor: 'middle',
        paint: { fill },
        channels: { category: slice.label, value: slice.fraction },
      },
      renderMultilineText(
        label.text,
        label.x,
        label.y,
        label.fontSize,
        `class="pie-slice-label" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${label.fontSize}" font-weight="${PIE_SLICE_LABEL_FONT_WEIGHT}" fill="${escapeXml(fill)}"`,
      ),
    ))
  }

  // Legend.
  for (let index = 0; index < chart.legend.length; index++) {
    const item = chart.legend[index]!
    const fill = fills[index]!
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
      `<rect class="pie-legend-swatch" x="${item.x}" y="${item.y}" width="${item.swatchSize}" height="${item.swatchSize}" rx="2" ry="2" fill="${escapeXml(fill)}" />`,
    ))
    // Display lines are composed (and measured) by the layout; multiline
    // labels carry the value/percent suffix on their last line.
    const text = applyTextTransform(item.lines.join('\n'), style.nodeTextTransform)
    parts.push(marks.text(
      {
        id: occurrenceId('legend-label', item.label),
        role: 'legend',
        text,
        x: item.textX,
        y: item.textY,
        fontSize: visual.legendTextSize ?? style.nodeLabelFontSize,
        anchor: 'start',
        // Fill comes from the .pie-legend-text rule in pieStyles().
        paint: { fill: visual.legendTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
        channels: { category: item.label, value: item.fraction },
      },
      renderMultilineText(
        text,
        item.textX,
        item.textY,
        visual.legendTextSize ?? style.nodeLabelFontSize,
        `class="pie-legend-text" text-anchor="start" dominant-baseline="middle" font-size="${visual.legendTextSize ?? style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
      ),
    ))
  }

  // Title.
  if (chart.title) {
    const title = applyTextTransform(chart.title.text, style.groupTextTransform)
    parts.push(marks.text(
      {
        id: 'title',
        role: 'title',
        text: title,
        x: chart.title.x,
        y: chart.title.y,
        fontSize: visual.titleTextSize ?? style.groupHeaderFontSize,
        anchor: 'middle',
        // Fill comes from the .pie-title rule in pieStyles().
        paint: { fill: visual.titleTextColor ?? style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
      },
      renderMultilineText(
        title,
        chart.title.x,
        chart.title.y,
        visual.titleTextSize ?? style.groupHeaderFontSize,
        `class="pie-title" text-anchor="middle" dominant-baseline="middle" font-size="${visual.titleTextSize ?? style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)}`,
      ),
    ))
  }

  // Hover tooltips — pure interaction chrome, shared machinery with xychart
  // (src/shared/svg-tooltip.ts). One hover group per slice: an invisible copy
  // of the wedge as the hit target, a native <title>, and the styled tip
  // anchored at the slice's label point.
  if (interactive) {
    const labelRadius = chart.radius * visual.textPosition
    for (const slice of chart.slices) {
      const mid = (slice.startAngle + slice.endAngle) / 2
      const anchorX = rnd(chart.cx + labelRadius * Math.sin(mid))
      const anchorY = rnd(chart.cy - labelRadius * Math.cos(mid))
      const tipText = `${slice.label.replace(/\n/g, ' ')}: ${formatPieValue(slice.value)} (${formatPiePercent(slice.fraction)})`
      parts.push(marks.raw(
        { id: occurrenceId('tooltip:slice', slice.label), role: 'chrome' },
        `<g class="pie-slice-group">` +
          `<path d="${slice.path}" fill="transparent"/>` +
          `<title>${escapeXml(tipText)}</title>` +
          tooltipMarkup('pie', anchorX, anchorY, tipText) +
          `</g>`,
      ))
    }
  }

  parts.push(marks.documentClose())

  return { family: 'pie', width: chart.width, height: chart.height, colors, parts }
}

function outerStrokeColor(visual: PieVisualConfig, style: ResolvedRenderStyle): string {
  return visual.outerStrokeColor ?? style.nodeBorderColor ?? 'var(--_node-stroke)'
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

function pieStyles(style: ResolvedRenderStyle, visual: PieVisualConfig, interactive: boolean): string {
  const sliceStroke = visual.strokeColor ?? style.nodeBorderColor ?? 'var(--bg)'
  const sliceStrokeWidth = visual.strokeWidth ?? style.nodeLineWidth
  const sliceOpacity = visual.opacity !== undefined ? ` opacity: ${visual.opacity};` : ''
  const outerRule = visual.outerStrokeWidth !== undefined || visual.outerStrokeColor !== undefined
    ? `\n  .pie-outer-circle { stroke: ${outerStrokeColor(visual, style)}; stroke-width: ${visual.outerStrokeWidth ?? 2}; }`
    : ''
  const tipRules = interactive ? tooltipCss('pie', ['pie-slice-group']) : ''
  return `<style>
  .pie-slice { stroke: ${sliceStroke}; stroke-width: ${sliceStrokeWidth};${sliceOpacity} transform-box: fill-box; transform-origin: center; }
  .pie-slice.highlighted { transform: scale(1.05); opacity: 1; }
  .pie-slice.highlighted-on-hover:hover { transform: scale(1.05); opacity: 1; }${outerRule}
  .pie-legend-swatch { stroke: ${style.nodeBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${style.nodeBorderColor ? Math.max(1, style.nodeLineWidth) : 1}; }
  .pie-legend-text { fill: ${visual.legendTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }
  .pie-title { fill: ${visual.titleTextColor ?? style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }${tipRules}
</style>`
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}

/** Round to the crisp 2-decimal grid. */
function rnd(value: number): number {
  return Math.round(value * 100) / 100
}
