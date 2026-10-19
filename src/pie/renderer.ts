import type { PositionedPieChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { resolvedColorValue } from '../theme.ts'
import { isHexColor, legibleInk, mixHex } from '../shared/color-math.ts'
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
import { tooltipArtwork, tooltipCss } from '../shared/svg-tooltip.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute } from '../scene/svg-emission.ts'

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

const OUTER_EMISSION = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
  { name: 'class', value: v.meta('pie-outer-circle') },
  ...(['cx', 'cy', 'r'] as const).map(name => ({ name, value: v.geometry(name) })),
  { name: 'fill', value: v.paint('fill') },
] })
const LEGEND_SWATCH_EMISSIONS = [false, true].map(dimmed => snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
  { name: 'class', value: v.meta(`pie-legend-swatch${dimmed ? ' pie-dim' : ''}`) },
  ...(['x', 'y', 'width', 'height', 'rx', 'ry'] as const).map(name => ({ name, value: v.geometry(name) })),
  { name: 'fill', value: v.paint('fill'), escape: 'xml' },
] }))
function textAttributes(className: string): SvgAttribute[] {
  return [
    { name: 'class', value: v.meta(className) }, { name: 'text-anchor', value: v.text('anchor') },
    { name: 'dominant-baseline', value: v.meta('middle') },
    { name: 'font-size', value: v.text('fontSize') }, { name: 'font-weight', value: v.text('fontWeight') },
  ]
}
const SLICE_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  ...textAttributes('pie-slice-label'), { name: 'fill', value: v.paint('fill'), escape: 'xml' },
] })
const LEGEND_TEXT_EMISSIONS = [false, true].map(literal => snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  ...textAttributes('pie-legend-text'), { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
  ...(literal ? [{ name: 'data-literal-text' as const, value: v.meta(true) }] : []),
] }))
const TITLE_EMISSIONS = [false, true].map(literal => snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  ...textAttributes('pie-title'), { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
  ...(literal ? [{ name: 'data-literal-text' as const, value: v.meta(true) }] : []),
] }))
const HOVER_GROUP_EMISSION = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ name: 'class', value: v.meta('pie-slice-group') }] })
const HOVER_EMISSIONS = [false, true].map(highlight => snapshotSvgEmissionRecipe({ kind: 'primitive', close: '/>', attributes: [
  { name: 'd', value: v.geometry('d') }, { name: 'fill', value: v.paint('fill') },
  ...(highlight ? [
    { name: 'class' as const, value: v.meta('pie-slice-hover-target') },
    { name: 'stroke' as const, value: v.paint('stroke') }, { name: 'stroke-width' as const, value: v.paint('strokeWidth') },
  ] : []),
] }))

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
export function lowerPieScene(
  ctx: RenderContext<PositionedPieChart>,
): SceneDoc {
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const style = resolveRenderStyle(options, PIE_STYLE_DEFAULTS, resolved.styleFace)
  const baseSliceRole = resolveRoleStyle(resolved.styleFace, 'pie-slice', {}, { includeFallback: false })
  const visual = chart.visual
  const parts: SceneNode[] = []

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
  const pieCss = pieStyles(style, visual, interactive, baseSliceRole)
  parts.push(marks.documentOpen(
    { id: 'prelude', width: chart.width, height: chart.height, colors, transparent, font, hasMonoFont: false, extraCss: pieCss },
    { kind: 'prelude', width: chart.width, height: chart.height, colors, transparent, font, hasMonoFont: false,
      attributes: [{ name: 'role', value: v.meta('img') }, { name: 'aria-roledescription', value: v.meta('pie chart') }],
      children: [{ kind: 'sharedStyle' }, ...(colors.shadow ? [{ kind: 'shadow' as const, colors, wrap: true }] : []), { kind: 'stylesheet', css: pieCss }],
    },
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
      OUTER_EMISSION,
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
    const channels = { category: slice.label, value: slice.fraction }
    const sliceRole = resolveRoleStyle(resolved.styleFace, 'pie-slice', channels, { includeFallback: false })
    // An indexed Mermaid `pieN` theme variable is authored concrete paint;
    // role/binding paint is a default beneath it, never a repaint authority.
    const fill = visual.paletteOverrides[index] ?? sliceRole?.fillColor ?? fills[index]!
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
    // Opacity (paint metadata; the rendered value comes from the CSS rules):
    // dimmed slices fade to a fraction of the base, others keep the base.
    const sliceOpacity = highlighted
      ? 1
      : dimmed
        ? rnd((visual.opacity ?? 1) * PIE.dimOpacity)
        : visual.opacity
    const hasInlineRoleStroke = sliceRole !== undefined && (
      sliceRole.strokeColor !== undefined || sliceRole.borderColor !== undefined
      || sliceRole.lineWidth !== undefined || cue !== 'none'
    )
    const sliceId = occurrenceId('slice', slice.label)
    sliceIds[index] = sliceId
    parts.push(marks.shape(
      {
        id: sliceId,
        role: 'pie-slice',
        geometry: { kind: 'path', d: slice.path },
        // Semantic paint mirrors the CSS result so styled backends preserve
        // static emphasis instead of redrawing the base border and opacity.
        paint: {
          fill,
          stroke: highlighted ? 'var(--fg)' : sliceStroke,
          strokeWidth: String(highlighted ? emphasisStrokeWidth : cueStrokeWidth),
          ...(cueDash ? { strokeDasharray: cueDash } : {}),
          ...(sliceOpacity !== undefined ? { opacity: String(sliceOpacity) } : {}),
        },
        channels: { ...channels, ...(highlighted ? { emphasis: true } : {}) },
      },
      { kind: 'primitive', attributes: [
        { name: 'class', value: v.meta(sliceClass) }, { name: 'd', value: v.geometry('d') },
        { name: 'fill', value: v.paint('fill'), escape: 'xml' },
        ...(hasInlineRoleStroke ? [
          { name: 'stroke' as const, value: v.paint('stroke'), escape: 'xml' as const },
          { name: 'stroke-width' as const, value: v.paint('strokeWidth') },
          ...(cueDash ? [{ name: 'stroke-dasharray' as const, value: v.paint('strokeDasharray') }] : []),
        ] : []),
        { name: 'data-label', value: v.channel('category'), escape: 'xml' },
        { name: 'data-value', value: v.meta(slice.value) },
        { name: 'data-percent', value: v.channel('value'), format: 'percent1' },
        ...(cue !== 'none' ? [{ name: 'data-brand-cue' as const, value: v.meta(cue) }] : []),
        ...(highlighted ? [{ name: 'data-highlighted' as const, value: v.channel('emphasis') }] : []),
      ] },
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
        // Percentage labels are data, not decoration. A dimmed wedge is
        // composited toward the page, so use foreground ink by default rather
        // than the contrast color chosen for its original opaque fill.
        paint: { fill },
        channels: { category: slice.label, value: slice.fraction },
      },
      SLICE_TEXT_EMISSION,
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
        // Stroke comes from the .pie-legend-swatch rule; opacity from .pie-dim.
        paint: {
          fill,
          stroke: style.nodeBorderColor ?? 'var(--_node-stroke)',
          strokeWidth: String(style.nodeBorderColor ? Math.max(1, style.nodeLineWidth) : 1),
          ...(legDimmed ? { opacity: String(PIE.dimOpacity) } : {}),
        },
        channels: { category: item.label, value: item.fraction },
      },
      LEGEND_SWATCH_EMISSIONS[legDimmed ? 1 : 0]!,
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
        fontWeight: legWeight, letterSpacing: style.nodeLetterSpacing,
        display: item.literalText === true ? 'literal' : 'formatted',
        block: item.block,
        anchor: 'start',
        // Legend text is meaningful chart data and stays full-opacity; the
        // selected row is reinforced by weight, and non-selected swatches dim.
        paint: {
          fill: visual.legendTextColor ?? style.nodeTextColor ?? 'var(--_text)',
        },
        channels: { category: item.label, value: item.fraction },
      },
      LEGEND_TEXT_EMISSIONS[item.literalText === true && needsLiteralFontMetrics(text) ? 1 : 0]!,
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
        fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing,
        display: chart.title.literalText === true ? 'literal' : 'formatted',
        block: chart.title.block,
        anchor: 'middle',
        // Fill comes from the .pie-title rule in pieStyles().
        paint: { fill: visual.titleTextColor ?? style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
      },
      TITLE_EMISSIONS[chart.title.literalText === true && needsLiteralFontMetrics(title) ? 1 : 0]!,
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
        emission: HOVER_GROUP_EMISSION, join: '', children: [
          { indent: 0, node: marks.shape({ id: `${id}:hit`, role: 'chrome', owner,
            ...(hoverHighlight ? { visibility: 'conditional' as const, conditionalPaint: { fill: 'transparent', stroke: 'var(--fg)', strokeWidth: String(hoverEmphasisStrokeWidth) } } : {}),
            geometry: { kind: 'path', d: slice.path },
            paint: { fill: 'transparent', ...(hoverHighlight ? { stroke: 'transparent', strokeWidth: String(hoverEmphasisStrokeWidth) } : {}) },
          }, HOVER_EMISSIONS[hoverHighlight ? 1 : 0]! ) },
          ...(interactive ? [
            { indent: 0, node: marks.documentContent({ id: `${id}:title`, role: 'chrome', nonPaint: 'interaction-metadata' }, { kind: 'documentText', element: 'title', text: tipText }) },
            { indent: 0, node: tooltipArtwork('pie', slice.tooltip, `${id}:body`, owner) },
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

function pieStyles(
  style: ResolvedRenderStyle,
  visual: PieVisualConfig,
  interactive: boolean,
  sliceRole?: Readonly<import('../scene/style-spec.ts').RoleStyleSpec>,
): string {
  const sliceStroke = visual.strokeColor ?? sliceRole?.strokeColor ?? sliceRole?.borderColor ?? style.nodeBorderColor ?? 'var(--bg)'
  const sliceStrokeWidth = visual.strokeWidth ?? sliceRole?.lineWidth ?? style.nodeLineWidth
  const sliceOpacity = visual.opacity !== undefined ? ` opacity: ${visual.opacity};` : ''
  // Option D: emphasise the highlighted slice with a heavier foreground border
  // (a shape/weight cue, so it reads even without colour) and fade the rest via
  // `.pie-dim`. No `transform` — the wedge geometry is left exact, which fixes
  // the old scale()-about-fill-box displacement and keeps arc length/area true.
  const emphasisStrokeWidth = pieEmphasisStrokeWidth(sliceStrokeWidth)
  const dimSliceOpacity = rnd((visual.opacity ?? 1) * PIE.dimOpacity)
  const outerRule = visual.outerStrokeWidth !== undefined || visual.outerStrokeColor !== undefined
    ? `\n  .pie-outer-circle { stroke: ${outerStrokeColor(visual, style)}; stroke-width: ${visual.outerStrokeWidth ?? 2}; }`
    : ''
  const tipRules = interactive ? tooltipCss('pie', ['pie-slice-group']) : ''
  const interactiveHoverSelector = visual.highlightSlice === 'hover'
    ? ',\n  .pie-slice-group:hover > .pie-slice-hover-target'
    : ''
  return `
  .pie-slice { stroke: ${sliceStroke}; stroke-width: ${sliceStrokeWidth};${sliceOpacity} }
  .pie-slice.highlighted { stroke: var(--fg); stroke-width: ${emphasisStrokeWidth}; opacity: 1; }
  .pie-slice.highlighted-on-hover:hover${interactiveHoverSelector} { stroke: var(--fg); stroke-width: ${emphasisStrokeWidth}; opacity: 1; }${outerRule}
  .pie-legend-swatch { stroke: ${style.nodeBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${style.nodeBorderColor ? Math.max(1, style.nodeLineWidth) : 1}; }
  .pie-legend-text { fill: ${visual.legendTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }
  .pie-title { fill: ${visual.titleTextColor ?? style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }
  .pie-slice.pie-dim { opacity: ${dimSliceOpacity}; }
  .pie-legend-swatch.pie-dim { opacity: ${PIE.dimOpacity}; }${tipRules}
`
}

function pieEmphasisStrokeWidth(sliceStrokeWidth: number): number {
  return Math.max(sliceStrokeWidth + 1, 2.5)
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
