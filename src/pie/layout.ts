import type {
  PieChart,
  PositionedPieChart,
  PositionedPieSlice,
  PositionedPieLegendItem,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK, isValidHex } from '../xychart/colors.ts'

// ============================================================================
// Pie chart layout engine
//
// Lays out a circle on the left and a vertical legend on the right. Slice
// angles run clockwise from 12 o'clock, in source order, so the rendered
// order matches Mermaid. All coordinates are direct pixel positions — the
// renderer never recomputes geometry.
// ============================================================================

const PIE = {
  paddingX: 24,
  paddingY: 24,
  titleFontSize: 18,
  titleFontWeight: 600,
  titleGap: 20,
  radius: 95,
  /** Gap between the circle and the legend column. */
  circleToLegendGap: 32,
  legendFontSize: 13,
  legendFontWeight: 500,
  legendSwatch: 14,
  legendRowGap: 8,
  legendSwatchToText: 8,
} as const

/**
 * Resolve the palette color for slice index `i` from the theme accent.
 * Index 0 is the accent; later indices are same-family shades (reusing the
 * xychart color utility so pie matches the rest of the chart family).
 */
function sliceColor(index: number, accent: string | undefined, bg: string | undefined): string {
  const safeAccent = accent && isValidHex(accent) ? accent : CHART_ACCENT_FALLBACK
  const safeBg = bg && isValidHex(bg) ? bg : undefined
  return getSeriesColor(index, safeAccent, safeBg)
}

/** Format a numeric value compactly (drops trailing `.0`). */
export function formatPieValue(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 100) / 100)
}

/** Format a fraction in [0,1] as a percentage string with one decimal. */
export function formatPiePercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

/**
 * Build the SVG `d` for a pie wedge from `startAngle` to `endAngle`
 * (radians, clockwise from 12 o'clock). A full-circle slice (single entry)
 * is emitted as two arcs so it renders as a closed circle.
 */
export function slicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle
  // Full circle: SVG arcs can't draw a 360° arc in one segment.
  if (sweep >= Math.PI * 2 - 1e-9) {
    const x0 = round(cx)
    const top = round(cy - r)
    const bottom = round(cy + r)
    return `M ${x0} ${top} A ${round(r)} ${round(r)} 0 1 1 ${x0} ${bottom} A ${round(r)} ${round(r)} 0 1 1 ${x0} ${top} Z`
  }
  const start = pointOnCircle(cx, cy, r, startAngle)
  const end = pointOnCircle(cx, cy, r, endAngle)
  const largeArc = sweep > Math.PI ? 1 : 0
  return `M ${round(cx)} ${round(cy)} L ${round(start.x)} ${round(start.y)} ` +
    `A ${round(r)} ${round(r)} 0 ${largeArc} 1 ${round(end.x)} ${round(end.y)} Z`
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

/**
 * Lay out a parsed pie chart. Sorting is intentionally NOT applied — slices
 * follow source order, matching Mermaid's documented clockwise ordering.
 */
export function layoutPieChart(
  chart: PieChart,
  options: RenderOptions = {},
  colors?: DiagramColors,
): PositionedPieChart {
  const total = chart.entries.reduce((sum, e) => sum + e.value, 0)

  const radius = PIE.radius
  const diameter = radius * 2

  // Title band.
  const titleHeight = chart.title ? PIE.titleFontSize + PIE.titleGap : 0

  // Legend metrics — one row per entry.
  const legendLabels = chart.entries.map((e, i) => {
    const fraction = total > 0 ? e.value / total : 0
    const valuePart = chart.showData ? ` [${formatPieValue(e.value)}]` : ''
    const text = `${e.label}${valuePart} (${formatPiePercent(fraction)})`
    return { text, fraction, entry: e, index: i }
  })
  const legendTextWidth = legendLabels.length > 0
    ? Math.max(...legendLabels.map(l => measureTextWidth(l.text, PIE.legendFontSize, PIE.legendFontWeight)))
    : 0
  const legendWidth = PIE.legendSwatch + PIE.legendSwatchToText + legendTextWidth
  const legendRowHeight = Math.max(PIE.legendSwatch, PIE.legendFontSize) + PIE.legendRowGap
  const legendHeight = legendLabels.length * legendRowHeight - PIE.legendRowGap

  // Geometry: circle on the left, legend column on the right.
  const contentTop = PIE.paddingY + titleHeight
  const contentHeight = Math.max(diameter, legendHeight)
  const cx = PIE.paddingX + radius
  const cy = contentTop + contentHeight / 2

  const legendX = PIE.paddingX + diameter + PIE.circleToLegendGap
  const legendTop = contentTop + (contentHeight - legendHeight) / 2

  const width = legendX + legendWidth + PIE.paddingX
  const height = contentTop + contentHeight + PIE.paddingY

  // Slices — clockwise from 12 o'clock, source order.
  const accent = colors?.accent
  const bg = colors?.bg
  const slices: PositionedPieSlice[] = []
  let angle = 0
  chart.entries.forEach((entry, index) => {
    const fraction = total > 0 ? entry.value / total : 0
    const startAngle = angle
    const endAngle = total > 0 ? angle + fraction * Math.PI * 2 : angle
    angle = endAngle
    const color = sliceColor(index, accent, bg)
    slices.push({
      label: entry.label,
      value: entry.value,
      fraction,
      startAngle,
      endAngle,
      color,
      path: slicePath(cx, cy, radius, startAngle, endAngle),
    })
  })

  // Legend rows.
  const legend: PositionedPieLegendItem[] = legendLabels.map((l, i) => {
    const rowY = legendTop + i * legendRowHeight
    const color = sliceColor(l.index, accent, bg)
    return {
      label: l.entry.label,
      value: l.entry.value,
      fraction: l.fraction,
      color,
      x: legendX,
      y: rowY,
      swatchSize: PIE.legendSwatch,
      textX: legendX + PIE.legendSwatch + PIE.legendSwatchToText,
      textY: rowY + PIE.legendSwatch / 2,
    }
  })

  return {
    width: round(width),
    height: round(height),
    title: chart.title
      ? { text: chart.title, x: round(width / 2), y: PIE.paddingY + PIE.titleFontSize / 2 }
      : undefined,
    cx: round(cx),
    cy: round(cy),
    radius,
    slices,
    legend,
    showData: chart.showData,
    total,
  }
}
