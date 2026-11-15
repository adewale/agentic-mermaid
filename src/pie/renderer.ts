import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { PositionedPieChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs, resolvedColorValue } from '../theme.ts'
import { isHexColor, legibleInk, mixHex } from '../shared/color-math.ts'
import { escapeXml } from '../multiline-utils.ts'
import {
  formatPieValue,
  formatPiePercent,
  PIE_LEGEND_HIGHLIGHT_FONT_WEIGHT,
  PIE_SLICE_LABEL_FONT_WEIGHT,
  PIE_STYLE_DEFAULTS,
} from './layout.ts'
import type { PieVisualConfig } from './config.ts'
import { pieSliceColors } from './palette.ts'
import { contrastTextColor } from '../color-resolver.ts'
import { drawTooltipArtwork, tooltipCss } from '../shared/svg-tooltip.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { SceneNode } from '../scene/ir.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'

// ============================================================================
// Pie chart SVG renderer
//
// The chart is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id). renderPieSvg() uses DefaultBackend serialization of that scene.
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
  /** Option D: non-highlighted graphical marks dim to this fraction. */
  dimOpacity: 0.4,
} as const

// The deterministic SVG font pass must not re-interpret an already-literal
// Pie text node as formatting. Plain entity display needs no extra marker.
const needsLiteralFontMetrics = (text: string): boolean => /[<>*~]/.test(text)

/**
 * Render a positioned pie chart as an SVG string.
 */
export function renderPieSvg(
  ctx: RenderContext<PositionedPieChart>,
): string {
  return DefaultBackend.render(lowerPieScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned pie chart to the SceneGraph IR in canonical mark order.
 */
export function lowerPieDrawing<T>(
  marks: DrawingFactory<T>,
  ctx: RenderContext<PositionedPieChart>,
): DrawingDocument<T> {
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const style = resolveRenderStyle(options, PIE_STYLE_DEFAULTS, resolved.styleFace)
  const baseSliceRole = resolveRoleStyle(resolved.styleFace, 'pie-slice', {}, { includeFallback: false })
  const visual = chart.visual
  const parts: T[] = []

  // One palette for wedges, legend swatches, and the ASCII renderer (shared
  // module) — surfaces can never disagree about slice identity.
  const fills = pieSliceColors(chart.slices.length, {
    accent: colors.accent,
    bg: colors.bg,
    overrides: visual.paletteOverrides,
  })

  // Option D emphasis (research-backed): highlight a slice WITHOUT changing its
  // geometry. The target keeps full opacity and gains a heavier foreground
  // border (a shape/weight cue — satisfies WCAG 1.4.1's "not colour alone");
  // every other slice/legend swatch dims while text remains full-contrast. No
  // radius or scale change, so arc length and area — the cues people actually
  // read (Skau & Kosara 2016) — stay exact, honouring the faithfulness contract.
  // `highlightSlice: hover` is a reserved interaction mode, never a static label
  // match, and never dims siblings.
  const hoverHighlight = visual.highlightSlice === 'hover'
  const anyHighlighted = !hoverHighlight && chart.slices.some(s => visual.highlightSlice === s.label)

  // Document shell: custom pie <svg> open tag + shared style block + optional
  // shadow defs + pie <style>, in the exact pushed order. Every piece is
  // derivable from the prelude fields (shadow defs from colors, pie CSS via
  // extraCss), so styled backends can re-derive the shell without parsing.
  const headParts: string[] = []
  headParts.push(openPieSvgTag(chart, colors, transparent))
  headParts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) headParts.push(`<defs>${shadowDefs}</defs>`)
  const pieCss = pieStyles(style, visual, interactive, baseSliceRole)
  headParts.push(pieCss)
  parts.push(marks.documentOpen(
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
        attributes: { className: 'pie-outer-circle' },
      },
    ))
  }

  // Slices. Duplicate labels get occurrence suffixes so scene ids stay
  // unique (the §8 seed contract keys substreams on them).
  const labelOccurrence = new Map<string, number>()
  const sliceIds: string[] = []
  const occurrenceId = (prefix: string, label: string) => {
    const key = `${prefix}:${label}`
    const k = labelOccurrence.get(key) ?? 0
    labelOccurrence.set(key, k + 1)
    return k === 0 ? key : `${key}#${k}`
  }
  const hoverEmphasisStrokeWidth = pieEmphasisStrokeWidth(
    visual.strokeWidth ?? baseSliceRole?.lineWidth ?? style.nodeLineWidth,
  )
  for (let index = 0; index < chart.slices.length; index++) {
    const slice = chart.slices[index]!
    const pct = formatPiePercent(slice.fraction)
    const channels = { category: slice.label, value: slice.fraction }
    const sliceRole = resolveRoleStyle(resolved.styleFace, 'pie-slice', channels, { includeFallback: false })
    // An indexed Mermaid `pieN` theme variable is authored concrete paint;
    // role/binding paint is a default beneath it, never a repaint authority.
    const fill = visual.paletteOverrides[index] ?? sliceRole?.fillColor ?? fills[index]!
    // Labels and legend keys describe this effective paint, including semantic
    // role overrides, rather than the unmodified generated palette.
    fills[index] = fill
    const sliceStroke = visual.strokeColor ?? sliceRole?.strokeColor ?? sliceRole?.borderColor ?? style.nodeBorderColor ?? 'var(--bg)'
    const sliceStrokeWidth = visual.strokeWidth ?? sliceRole?.lineWidth ?? style.nodeLineWidth
    const cue = sliceRole?.cue ?? 'none'
    const cueStrokeWidth = cue === 'outline'
      ? sliceStrokeWidth + 1
      : cue === 'double-line' ? sliceStrokeWidth + 2 : sliceStrokeWidth
    const cueDash = cue === 'pattern' ? '3 2' : cue === 'double-line' ? '8 2 2 2' : undefined
    const emphasisStrokeWidth = pieEmphasisStrokeWidth(cueStrokeWidth)
    const highlighted = anyHighlighted && visual.highlightSlice === slice.label
    const dimmed = anyHighlighted && !highlighted
    const sliceClass = `pie-slice${highlighted ? ' highlighted' : ''}` +
      `${hoverHighlight ? ' highlighted-on-hover' : ''}${dimmed ? ' pie-dim' : ''}`
    // Dimmed slices fade to a fraction of the base opacity, others keep the
    // base; hover emphasis stays a stylesheet rule over these attributes.
    const sliceOpacity = highlighted
      ? 1
      : dimmed
        ? rnd((visual.opacity ?? 1) * PIE.dimOpacity)
        : visual.opacity
    const sliceId = occurrenceId('slice', slice.label)
    sliceIds[index] = sliceId
    parts.push(marks.shape(
      {
        id: sliceId,
        role: 'pie-slice',
        geometry: { kind: 'path', d: slice.path },
        // Static emphasis is drawn from the paint, so styled backends preserve
        // it instead of redrawing the base border and opacity.
        paint: {
          fill,
          stroke: highlighted ? 'var(--fg)' : sliceStroke,
          strokeWidth: String(highlighted ? emphasisStrokeWidth : cueStrokeWidth),
          ...(cueDash ? { strokeDasharray: cueDash } : {}),
          ...(sliceOpacity !== undefined ? { opacity: String(sliceOpacity) } : {}),
        },
        channels: { ...channels, ...(highlighted ? { emphasis: true } : {}) },
        attributes: {
          className: sliceClass,
          data: {
            label: slice.label,
            value: String(slice.value),
            percent: pct,
            ...(cue !== 'none' ? { 'brand-cue': cue } : {}),
            ...(highlighted ? { highlighted: 'true' } : {}),
          },
        },
      },
    ))
  }

  // On-slice percentage labels (layout's collision policy decides presence).
  for (let index = 0; index < chart.slices.length; index++) {
    const slice = chart.slices[index]!
    const label = slice.pctLabel
    if (!label) continue
    const dimmed = anyHighlighted && visual.highlightSlice !== slice.label
    // The label sits on the wedge as drawn: its fill at the wedge's opacity
    // over the page. A dimmed wedge keeps foreground ink where that ink reads.
    const opacity = anyHighlighted && !dimmed ? 1 : dimmed ? (visual.opacity ?? 1) * PIE.dimOpacity : visual.opacity ?? 1
    const surface = drawnWedge(fills[index]!, opacity, colors)
    const pageInk = style.nodeTextColor ?? colors.fg
    const fill = visual.sectionTextColor ?? (surface === undefined
      ? dimmed ? pageInk : contrastTextColor(fills[index]!) ?? pageInk
      : dimmed ? legibleInk(resolvedColorValue(pageInk, colors) ?? pageInk, surface) : contrastTextColor(surface) ?? pageInk)
    parts.push(marks.text(
      {
        id: occurrenceId('slice-label', slice.label),
        role: 'label',
        text: label.text,
        x: label.x,
        y: label.y,
        fontSize: label.fontSize,
        fontWeight: PIE_SLICE_LABEL_FONT_WEIGHT,
        block: label.block,
        anchor: 'middle',
        dominantBaseline: 'middle',
        // Percentage labels are data, not decoration. A dimmed wedge is
        // composited toward the page, so use foreground ink by default rather
        // than the contrast color chosen for its original opaque fill.
        paint: { fill },
        channels: { category: slice.label, value: slice.fraction },
        attributes: { className: 'pie-slice-label' },
      },
    ))
  }

  // Legend.
  for (let index = 0; index < chart.legend.length; index++) {
    const item = chart.legend[index]!
    const fill = fills[index]!
    const legHighlighted = anyHighlighted && visual.highlightSlice === item.label
    const legDimmed = anyHighlighted && !legHighlighted
    const legWeight = legHighlighted ? PIE_LEGEND_HIGHLIGHT_FONT_WEIGHT : style.nodeLabelFontWeight
    parts.push(marks.shape(
      {
        id: occurrenceId('legend', item.label),
        role: 'legend',
        geometry: { kind: 'rect', x: item.x, y: item.y, width: item.swatchSize, height: item.swatchSize, rx: 2, ry: 2 },
        paint: {
          fill,
          stroke: style.nodeBorderColor ?? 'var(--_node-stroke)',
          strokeWidth: String(style.nodeBorderColor ? Math.max(1, style.nodeLineWidth) : 1),
          ...(legDimmed ? { opacity: String(PIE.dimOpacity) } : {}),
        },
        channels: { category: item.label, value: item.fraction },
        attributes: { className: `pie-legend-swatch${legDimmed ? ' pie-dim' : ''}` },
      },
    ))
    // Display lines are composed (and measured) by the layout; multiline
    // labels carry the value/percent suffix on their last line.
    const text = item.lines.join('\n')
    parts.push(marks.text(
      {
        id: occurrenceId('legend-label', item.label),
        role: 'legend',
        text,
        x: item.textX,
        y: item.textY,
        fontSize: visual.legendTextSize ?? style.nodeLabelFontSize,
        fontWeight: legWeight,
        letterSpacing: style.nodeLetterSpacing,
        block: item.block,
        ...(item.literalText === true ? { display: 'literal' as const } : {}),
        anchor: 'start',
        dominantBaseline: 'middle',
        // Legend text is meaningful chart data and stays full-opacity; the
        // selected row is reinforced by weight, and non-selected swatches dim.
        paint: {
          fill: visual.legendTextColor ?? style.nodeTextColor ?? 'var(--_text)',
        },
        channels: { category: item.label, value: item.fraction },
        attributes: { className: 'pie-legend-text', ...literalTextData(item.literalText === true, text) },
      },
    ))
  }

  // Title.
  if (chart.title) {
    const title = chart.title.text
    parts.push(marks.text(
      {
        id: 'title',
        role: 'title',
        text: title,
        x: chart.title.x,
        y: chart.title.y,
        fontSize: visual.titleTextSize ?? style.groupHeaderFontSize,
        fontWeight: style.groupHeaderFontWeight,
        letterSpacing: style.groupLetterSpacing,
        block: chart.title.block,
        ...(chart.title.literalText === true ? { display: 'literal' as const } : {}),
        anchor: 'middle',
        dominantBaseline: 'middle',
        paint: { fill: visual.titleTextColor ?? style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
        attributes: { className: 'pie-title', ...literalTextData(chart.title.literalText === true, title) },
      },
    ))
  }

  // Hover overlays — interaction chrome that stays outside the semantic wedge
  // mark, so styled backends cannot redraw the visible hover border away. In
  // hover-highlight mode the overlay exists even when tooltips are disabled;
  // <title> and the styled tip remain conditional on `interactive`.
  if (interactive || hoverHighlight) {
    for (const [index, slice] of chart.slices.entries()) {
      const tipText = `${(slice.displayLabel ?? slice.label).replace(/\n/g, ' ')}: ${formatPieValue(slice.value)} (${formatPiePercent(slice.fraction)})`
      const id = occurrenceId('tooltip:slice', slice.label)
      const owner = { id: sliceIds[index]!, role: 'pie-slice' as const }
      parts.push(marks.group({ id, role: 'chrome', owner,
        open: '<g class="pie-slice-group">', close: '</g>', join: '', children: [
          { indent: 0, node: marks.shape({ id: `${id}:hit`, role: 'chrome', owner,
            ...(hoverHighlight ? { visibility: 'conditional' as const, conditionalPaint: { fill: 'transparent', stroke: 'var(--fg)', strokeWidth: String(hoverEmphasisStrokeWidth) } } : {}),
            geometry: { kind: 'path', d: slice.path },
            paint: { fill: 'transparent', ...(hoverHighlight ? { stroke: 'transparent', strokeWidth: String(hoverEmphasisStrokeWidth) } : {}) },
            ...(hoverHighlight ? { attributes: { className: 'pie-slice-hover-target' } } : {}),
          }) },
          ...(interactive ? [
            { indent: 0, node: marks.documentContent({ id: `${id}:title`, role: 'chrome', nonPaint: 'interaction-metadata' }, `<title>${escapeXml(tipText)}</title>`) },
            { indent: 0, node: drawTooltipArtwork(marks, 'pie', slice.tooltip, `${id}:body`, owner) },
          ] : []),
        ],
      }))
    }
  }

  parts.push(marks.documentClose())

  return { family: 'pie', width: chart.width, height: chart.height, colors, transparent, parts }
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

function pieStyles(
  style: ResolvedRenderStyle,
  visual: PieVisualConfig,
  interactive: boolean,
  sliceRole?: Readonly<import('../scene/style-spec.ts').RoleStyleSpec>,
): string {
  const sliceStrokeWidth = visual.strokeWidth ?? sliceRole?.lineWidth ?? style.nodeLineWidth
  // Option D: emphasise the highlighted slice with a heavier foreground border
  // (a shape/weight cue, so it reads even without colour) and fade the rest
  // (each mark's own opacity). No `transform` — the wedge geometry is left
  // exact, which fixes the old scale()-about-fill-box displacement and keeps
  // arc length/area true. Static paint is written on each mark; only the
  // hover emphasis and tooltips remain stylesheet rules.
  const emphasisStrokeWidth = pieEmphasisStrokeWidth(sliceStrokeWidth)
  const tipRules = interactive ? tooltipCss('pie', ['pie-slice-group']) : ''
  const interactiveHoverSelector = visual.highlightSlice === 'hover'
    ? ',\n  .pie-slice-group:hover > .pie-slice-hover-target'
    : ''
  return `<style>
  .pie-slice.highlighted-on-hover:hover${interactiveHoverSelector} { stroke: var(--fg); stroke-width: ${emphasisStrokeWidth}; opacity: 1; }${tipRules}
</style>`
}

function pieEmphasisStrokeWidth(sliceStrokeWidth: number): number {
  return Math.max(sliceStrokeWidth + 1, 2.5)
}

/** Marks a literal Pie label whose characters the deterministic SVG font
 *  pass must not re-interpret as formatting. */
function literalTextData(literal: boolean, text: string): { data?: Record<string, string> } {
  return literal && needsLiteralFontMetrics(text) ? { data: { 'literal-text': 'true' } } : {}
}

/** Round to the crisp 2-decimal grid. */
function rnd(value: number): number {
  return Math.round(value * 100) / 100
}

/** A wedge's color as drawn: its fill composited over the page at its opacity. */
function drawnWedge(fill: string, opacity: number, colors: DiagramColors): string | undefined {
  const page = resolvedColorValue('var(--bg)', colors)
  if (page === undefined || !isHexColor(fill)) return undefined
  return opacity >= 1 ? fill : mixHex(fill, page, opacity * 100)
}

export const lowerPieScene = sceneLowering<PositionedPieChart>(lowerPieDrawing)
