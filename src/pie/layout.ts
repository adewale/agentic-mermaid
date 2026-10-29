import { layoutTooltip } from '../shared/tooltip-layout.ts'
import { formatChartValue } from '../shared/chart-value-format.ts'
import { pieTotal } from './semantics.ts'
import type {
  PieChart,
  PositionedPieChart,
  PositionedPieSlice,
  PositionedPieLegendItem,
  PieSliceLabel,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { PieVisualConfig } from './config.ts'
import { DEFAULT_PIE_VISUAL_CONFIG } from './config.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { STROKE_WIDTHS, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { layoutTextColumns } from '../shared/text-rows.ts'
import { fitChartWidth } from '../shared/chart-width.ts'

// ============================================================================
// Pie chart layout engine
//
// Lays out a circle and a legend column arranged by the resolved
// `pie.legendPosition` config (right = the classic layout: circle left,
// legend right). Slice angles run clockwise from 12 o'clock, in source order,
// so the rendered order matches Mermaid. All coordinates are direct pixel
// positions — the renderer never recomputes geometry.
//
// On-slice percentage labels (upstream parity, mermaid#1027) are placed here
// too: at the slice mid-angle, radius * textPosition from the center
// (upstream's zero-thickness label arc centroid), with a deterministic
// small-slice policy — a label is suppressed when it would read "0%", when it
// cannot fit its own wedge's chord at the label radius, or when it would
// overlap an already-placed label (larger slices win; ties resolve to source
// order). The canvas is also sized so the title never overhangs it.
// ============================================================================

const PIE = {
  paddingX: 24,
  paddingY: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleGap: 20,
  radius: 95,
  /** Gap between the circle and a left/right legend column. */
  circleToLegendGap: 32,
  /** Gap between the circle and a top/bottom legend block. */
  circleToLegendStackGap: 24,
  legendFontSize: 13,
  legendFontWeight: 500,
  sliceStrokeWidth: 1.5,
  /** Line advance inside a multiline legend row (matches renderMultilineText). */
  legendLineHeight: 13 * 1.3,
  legendSwatch: 14,
  legendRowGap: 8,
  legendColumnGap: 16,
  legendSwatchToText: 8,
  /** General 700-weight fallback allowance, composed with safe W/M metrics. */
  legendHighlightWidthScale: 1.1,
  sliceLabelFontSize: 12,
  sliceLabelFontWeight: 500,
  /** Horizontal slack a slice label needs inside its wedge chord. */
  sliceLabelFitPad: 4,
} as const

/** On-slice label weight — the renderer must emit what the layout measured. */
export const PIE_SLICE_LABEL_FONT_WEIGHT: number = PIE.sliceLabelFontWeight

/** Selected legend-row weight — shared so layout and rendering cannot drift. */
export const PIE_LEGEND_HIGHLIGHT_FONT_WEIGHT = 700

/** Shared by layout and rendering so role typography reserves the exact canvas
 * that the renderer consumes. */
export const PIE_STYLE_DEFAULTS: RenderStyleDefaults = {
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

/** Format a numeric value compactly (drops trailing `.0`). */
export function formatPieValue(value: number): string {
  return formatChartValue(value)
}

/**
 * Format a fraction in [0,1] as a legend percentage with one decimal.
 * Rounds half-up; nonzero fractions floor at 0.1% so a real slice can never
 * display as "(0.0%)" (the pie-15 probe defect).
 */
export function formatPiePercent(fraction: number): string {
  if (!(fraction > 0)) return '0.0%'
  const pct = Math.max(0.1, Math.round(fraction * 1000) / 10)
  return `${pct.toFixed(1)}%`
}

/**
 * Format a fraction as an on-slice label — upstream's exact contract
 * (pieRenderer.ts): `((value/sum) * 100).toFixed(0) + '%'`.
 */
export function formatPieSlicePercent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`
}

/**
 * Build the SVG `d` for a pie wedge from `startAngle` to `endAngle`
 * (radians, clockwise from 12 o'clock). A full-circle slice (single entry)
 * is emitted as two arcs so it renders as a closed circle. A positive
 * `innerRadius` produces the annular (donut) form: outer arc + inner return
 * arc, or two opposite-winding rings for the full circle.
 */
export function slicePath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  innerRadius: number = 0,
): string {
  const sweep = endAngle - startAngle
  const ir = innerRadius > 0 ? Math.min(innerRadius, r) : 0
  // Full circle: SVG arcs can't draw a 360° arc in one segment.
  if (sweep >= Math.PI * 2 - 1e-9) {
    const x0 = round(cx)
    const top = round(cy - r)
    const bottom = round(cy + r)
    const outer = `M ${x0} ${top} A ${round(r)} ${round(r)} 0 1 1 ${x0} ${bottom} A ${round(r)} ${round(r)} 0 1 1 ${x0} ${top} Z`
    if (ir <= 0) return outer
    // Inner ring wound counter-clockwise so the nonzero fill rule cuts the hole.
    const iTop = round(cy - ir)
    const iBottom = round(cy + ir)
    const inner = `M ${x0} ${iTop} A ${round(ir)} ${round(ir)} 0 1 0 ${x0} ${iBottom} A ${round(ir)} ${round(ir)} 0 1 0 ${x0} ${iTop} Z`
    return `${outer} ${inner}`
  }
  const start = pointOnCircle(cx, cy, r, startAngle)
  const end = pointOnCircle(cx, cy, r, endAngle)
  const largeArc = sweep > Math.PI ? 1 : 0
  if (ir <= 0) {
    return `M ${round(cx)} ${round(cy)} L ${round(start.x)} ${round(start.y)} ` +
      `A ${round(r)} ${round(r)} 0 ${largeArc} 1 ${round(end.x)} ${round(end.y)} Z`
  }
  const innerStart = pointOnCircle(cx, cy, ir, startAngle)
  const innerEnd = pointOnCircle(cx, cy, ir, endAngle)
  return `M ${round(start.x)} ${round(start.y)} ` +
    `A ${round(r)} ${round(r)} 0 ${largeArc} 1 ${round(end.x)} ${round(end.y)} ` +
    `L ${round(innerEnd.x)} ${round(innerEnd.y)} ` +
    `A ${round(ir)} ${round(ir)} 0 ${largeArc} 0 ${round(innerStart.x)} ${round(innerStart.y)} Z`
}

function pointOnCircle(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  // angle 0 = 12 o'clock (straight up); positive = clockwise.
  return {
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

interface LegendRowMetrics {
  block: PixelTextBlock
  lines: string[]
  fraction: number
  textWidth: number
  reservedWidth: number
}

/**
 * Lay out a parsed pie chart. Sorting is intentionally NOT applied — slices
 * follow source order, matching Mermaid's documented clockwise ordering.
 */
export function layoutPieChart(
  chart: PieChart,
  options: RenderOptions = {},
  visual: PieVisualConfig = DEFAULT_PIE_VISUAL_CONFIG,
  styleFace?: Readonly<InternalStyleFace>,
): PositionedPieChart {
  const natural = placePieChart(chart, options, visual, styleFace)
  const maxWidth = options.pie?.maxWidth
  if (maxWidth === undefined) return natural
  return fitChartWidth(natural, maxWidth, attempt => {
    if (attempt !== 1) return undefined
    const legendPosition = visual.legendPositionExplicit || visual.legendPosition !== 'right' ? visual.legendPosition : 'bottom'
    return placePieChart(chart, options, { ...visual, legendPosition }, styleFace, maxWidth)
  })
}

function placePieChart(chart: PieChart, options: RenderOptions, visual: PieVisualConfig, styleFace?: Readonly<InternalStyleFace>, maxWidth?: number): PositionedPieChart {
  const style = resolveRenderStyle(options, PIE_STYLE_DEFAULTS, styleFace)
  const total = pieTotal(chart.entries)

  const radius = PIE.radius
  const diameter = radius * 2
  const innerRadius = visual.donutHole > 0 ? round(visual.donutHole * radius) : 0
  // Wrapping cannot make the circle narrower. An infeasible request should
  // not create a taller legend than this unavoidable canvas needs.
  const wrapWidth = maxWidth === undefined ? undefined : Math.max(maxWidth, diameter + PIE.paddingX * 2)
  const legendOverhead = PIE.paddingX * 2 + PIE.legendSwatch + PIE.legendSwatchToText +
    (visual.legendPosition === 'left' || visual.legendPosition === 'right' ? diameter + PIE.circleToLegendGap : 0)
  const legendWrapWidth = wrapWidth === undefined || wrapWidth <= legendOverhead ? undefined : wrapWidth - legendOverhead

  // Title/legend typography comes from the same resolved config the renderer
  // uses, so larger documented theme sizes reserve geometry by construction.
  const titleFontSize = visual.titleTextSize ?? style.groupHeaderFontSize
  const legendFontSize = visual.legendTextSize ?? style.nodeLabelFontSize
  const legendLineHeight = legendFontSize * 1.3
  let titleBlock = chart.title ? preparePixelText(chart.displayTitle ?? chart.title, {
    display: chart.displayTitle === undefined ? 'formatted' : 'literal', transform: style.groupTextTransform,
    fontSize: titleFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing, safeFont: true,
    ...(wrapWidth === undefined ? {} : { maxWidth: wrapWidth - PIE.paddingX * 2 }),
  }) : undefined
  if (titleBlock && wrapWidth !== undefined && titleBlock.width > wrapWidth - PIE.paddingX * 2 + 0.01) {
    titleBlock = preparePixelText(titleBlock.prepared, titleBlock)
  }
  const renderedTitle = titleBlock?.text
  const titleBlockHeight = titleBlock ? titleBlock.height : 0
  const titleHeight = titleBlock ? titleBlockHeight + PIE.titleGap : 0
  const titleWidth = titleBlock?.width ?? 0
  const staticHighlight = visual.highlightSlice === 'hover' ? undefined : visual.highlightSlice

  // Legend metrics — one row per entry. Only actual newline characters span
  // multiple lines; authored `<br/>` is literal Pie text. The value/percent
  // suffix rides on the last line, and each line is measured independently.
  const rows: LegendRowMetrics[] = chart.entries.map(e => {
    const fraction = total > 0 ? e.value / total : 0
    const valuePart = chart.showData ? ` [${formatPieValue(e.value)}]` : ''
    const suffix = `${valuePart} (${formatPiePercent(fraction)})`
    const labelLines = (e.displayLabel ?? e.label).split('\n')
    const fontWeight = staticHighlight === e.label
      ? PIE_LEGEND_HIGHLIGHT_FONT_WEIGHT
      : style.nodeLabelFontWeight
    const source = labelLines.map((line, k) => k === labelLines.length - 1 ? `${line}${suffix}` : line).join('\n')
    const highlightScale = fontWeight === PIE_LEGEND_HIGHLIGHT_FONT_WEIGHT ? PIE.legendHighlightWidthScale : 1
    const textBudget = visual.legendPosition === 'center' ? undefined : legendWrapWidth === undefined ? undefined : legendWrapWidth / highlightScale
    let block = preparePixelText(source, {
      display: e.displayLabel === undefined ? 'formatted' : 'literal', transform: style.nodeTextTransform,
      fontSize: legendFontSize, fontWeight, letterSpacing: style.nodeLetterSpacing, safeFont: true,
      ...(textBudget === undefined ? {} : { maxWidth: textBudget }),
    })
    // A grapheme wider than the column makes this wrapping request infeasible.
    // Keep its prepared display interpretation and typography without wrapping.
    if (textBudget !== undefined && block.width > textBudget + 0.01) block = preparePixelText(block.prepared, block)
    const lines = block.lines
    const measuredTextWidth = block.width
    const textWidth = fontWeight === PIE_LEGEND_HIGHLIGHT_FONT_WEIGHT
      ? measuredTextWidth * PIE.legendHighlightWidthScale
      : measuredTextWidth
    return { block, lines, fraction, textWidth, reservedWidth: textWidth }
  })
  const legendRowOptions = {
    gap: PIE.legendRowGap, minRowHeight: PIE.legendSwatch,
    leadingWidth: PIE.legendSwatch + PIE.legendSwatchToText, columnGap: PIE.legendColumnGap,
    ...(wrapWidth !== undefined && (visual.legendPosition === 'top' || visual.legendPosition === 'bottom') ? { maxWidth: wrapWidth - PIE.paddingX * 2 } : {}),
  }
  const legendRows = layoutTextColumns(rows, legendRowOptions)
  const legendWidth = legendRows.width
  const legendHeight = legendRows.height

  // Geometry: circle + legend arranged by legendPosition; the canvas always
  // contains both plus the title (a repositioned legend must never clip).
  const contentTop = PIE.paddingY + titleHeight
  const position = visual.legendPosition

  let cx: number
  let cy: number
  let legendX: number
  let legendTop: number
  let width: number
  let height: number

  if (position === 'left' || position === 'right') {
    const contentHeight = Math.max(diameter, legendHeight)
    cy = contentTop + contentHeight / 2
    legendTop = contentTop + (contentHeight - legendHeight) / 2
    if (position === 'right') {
      cx = PIE.paddingX + radius
      legendX = PIE.paddingX + diameter + PIE.circleToLegendGap
      width = legendX + legendWidth + PIE.paddingX
    } else {
      legendX = PIE.paddingX
      cx = PIE.paddingX + legendWidth + PIE.circleToLegendGap + radius
      width = cx + radius + PIE.paddingX
    }
    width = Math.max(width, titleWidth + 2 * PIE.paddingX)
    height = contentTop + contentHeight + PIE.paddingY
  } else {
    // Stacked (top/bottom) and centered layouts share a centered content column.
    const contentWidth = Math.max(diameter, legendWidth)
    width = Math.max(PIE.paddingX * 2 + contentWidth, titleWidth + 2 * PIE.paddingX)
    const contentLeft = (width - contentWidth) / 2
    cx = contentLeft + contentWidth / 2
    legendX = cx - legendWidth / 2
    if (position === 'top') {
      legendTop = contentTop
      cy = contentTop + legendHeight + PIE.circleToLegendStackGap + radius
      height = cy + radius + PIE.paddingY
    } else if (position === 'bottom') {
      cy = contentTop + radius
      legendTop = contentTop + diameter + PIE.circleToLegendStackGap
      height = legendTop + legendHeight + PIE.paddingY
    } else {
      // center: the legend block overlays the circle center (pairs with a
      // donut hole large enough to hold it).
      const contentHeight = Math.max(diameter, legendHeight)
      cy = contentTop + contentHeight / 2
      legendTop = cy - legendHeight / 2
      height = contentTop + contentHeight + PIE.paddingY
    }
  }

  // Slices — clockwise from 12 o'clock, source order.
  const slices: PositionedPieSlice[] = []
  let angle = 0
  chart.entries.forEach(entry => {
    const fraction = total > 0 ? entry.value / total : 0
    const startAngle = angle
    const endAngle = total > 0 ? angle + fraction * Math.PI * 2 : angle
    angle = endAngle
    slices.push({
      label: entry.label,
      ...(entry.displayLabel === undefined ? {} : { displayLabel: entry.displayLabel }),
      value: entry.value,
      fraction,
      startAngle,
      endAngle,
      path: slicePath(cx, cy, radius, startAngle, endAngle, innerRadius),
    })
  })

  for (const slice of slices) {
    const mid = (slice.startAngle + slice.endAngle) / 2
    const labelRadius = radius * visual.textPosition
    const text = `${(slice.displayLabel ?? slice.label).replace(/\n/g, ' ')}: ${formatPieValue(slice.value)} (${formatPiePercent(slice.fraction)})`
    slice.tooltip = layoutTooltip(round(round(cx) + labelRadius * Math.sin(mid)), round(round(cy) - labelRadius * Math.cos(mid)), text)
  }
  placeSliceLabels(slices, cx, cy, radius, visual)
  for (const slice of slices) if (slice.pctLabel) slice.pctLabel.block = preparePixelText(slice.pctLabel.text, { display: 'literal', fontSize: slice.pctLabel.fontSize, fontWeight: PIE.sliceLabelFontWeight })

  // Legend rows.
  const placedLegendRows = layoutTextColumns(rows, { ...legendRowOptions, top: legendTop })
  const legend: PositionedPieLegendItem[] = placedLegendRows.rows.map(({ item: row, x = 0, top, textY }, i) => {
    const entry = chart.entries[i]!
    const item: PositionedPieLegendItem = {
      label: entry.label,
      ...(entry.displayLabel === undefined ? {} : { literalText: true as const }),
      value: entry.value,
      fraction: row.fraction,
      x: round(legendX + x),
      y: round(top),
      swatchSize: PIE.legendSwatch,
      textX: round(legendX + x + PIE.legendSwatch + PIE.legendSwatchToText),
      textY: round(textY),
      lines: row.lines,
      block: row.block,
      textWidth: round(row.textWidth),
    }
    return item
  })

  return {
    width: round(width),
    height: round(height),
    title: chart.title
      ? {
        text: renderedTitle!, block: titleBlock, x: round(width / 2), y: PIE.paddingY + titleBlockHeight / 2,
        ...(chart.displayTitle === undefined ? {} : { literalText: true as const }),
      }
      : undefined,
    cx: round(cx),
    cy: round(cy),
    radius,
    innerRadius,
    slices,
    legend,
    showData: chart.showData,
    total,
    visual,
  }
}

// ---------------------------------------------------------------------------
// On-slice label placement (single home for the small-slice policy)
// ---------------------------------------------------------------------------

/**
 * Place on-slice percentage labels at radius * textPosition along each slice's
 * mid-angle (upstream's label-arc centroid). Deterministic suppression policy:
 *   1. slices under 1% of the total get no label — upstream removes sub-1%
 *      slices from the drawing entirely (pieRenderer.ts `>= 1` filter), so its
 *      labels only ever exist for slices ≥ 1%; we keep the wedge (our
 *      faithfulness contract forbids dropping data) and suppress only the
 *      label. This also covers upstream's explicit "0%"-text filter.
 *   2. remaining candidates are admitted largest-slice-first (ties: source
 *      order); a candidate that would overlap an admitted label is suppressed,
 *      so no two rendered labels can ever collide — the guarantee upstream
 *      lacks for runs of thin slices.
 */
function placeSliceLabels(
  slices: PositionedPieSlice[],
  cx: number,
  cy: number,
  radius: number,
  visual: PieVisualConfig,
): void {
  const labelRadius = radius * visual.textPosition
  const fontSize = visual.sectionTextSize ?? PIE.sliceLabelFontSize
  const boxHeight = fontSize * 1.1

  interface Candidate { index: number; fraction: number; label: PieSliceLabel; halfWidth: number }
  const candidates: Candidate[] = []
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i]!
    if (slice.fraction < 0.01) continue
    const text = formatPieSlicePercent(slice.fraction)
    if (text === '0%') continue
    const sweep = slice.endAngle - slice.startAngle
    if (!(sweep > 0)) continue
    const width = measureTextWidth(text, fontSize, PIE.sliceLabelFontWeight)
    // A label must fit the local wedge chord at its actual radial position.
    // Clamp at π: larger wedges have at least a diameter of usable span and
    // must not shrink again because sine is periodic.
    const availableChord = 2 * labelRadius * Math.sin(Math.min(sweep, Math.PI) / 2)
    if (width + PIE.sliceLabelFitPad > availableChord) continue
    const mid = (slice.startAngle + slice.endAngle) / 2
    candidates.push({
      index: i,
      fraction: slice.fraction,
      halfWidth: width / 2,
      label: {
        text,
        x: round(cx + labelRadius * Math.sin(mid)),
        y: round(cy - labelRadius * Math.cos(mid)),
        fontSize,
      },
    })
  }

  // Largest-first admission; source order breaks ties deterministically.
  candidates.sort((a, b) => (b.fraction - a.fraction) || (a.index - b.index))
  const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  for (const candidate of candidates) {
    const box = {
      x0: candidate.label.x - candidate.halfWidth,
      y0: candidate.label.y - boxHeight / 2,
      x1: candidate.label.x + candidate.halfWidth,
      y1: candidate.label.y + boxHeight / 2,
    }
    const collides = placed.some(other =>
      Math.min(box.x1, other.x1) - Math.max(box.x0, other.x0) > 1 &&
      Math.min(box.y1, other.y1) - Math.max(box.y0, other.y0) > 1)
    if (collides) continue
    placed.push(box)
    slices[candidate.index]!.pctLabel = candidate.label
  }
}
