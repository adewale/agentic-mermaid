import type {
  QuadrantChart,
  PositionedQuadrantChart,
  PositionedQuadrantRegion,
  PositionedQuadrantPoint,
  PositionedQuadrantAxisLabel,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { measureTextWidth } from '../text-metrics.ts'

// ============================================================================
// Quadrant chart layout engine
//
// Lays out a SQUARE plot area divided into four equal quadrant rectangles.
// Mermaid quadrant numbering (from the upstream reference):
//   1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right
//
// Normalized point coords (x,y) ∈ [0,1]²: x grows right, y grows UP (so the
// pixel y is inverted). All coordinates here are direct pixel positions — the
// renderer never recomputes geometry. Deterministic: no randomness.
// ============================================================================

const Q = {
  paddingX: 24,
  paddingY: 24,
  titleFontSize: 18,
  titleGap: 18,
  /** Square plot side length in pixels. */
  plotSize: 380,
  /** Gutter reserved on the left for the y-axis labels. */
  yAxisGutter: 28,
  /** Gutter reserved at the bottom for the x-axis labels. */
  xAxisGutter: 28,
  axisFontSize: 13,
  quadrantFontSize: 15,
  pointRadius: 6,
  pointFontSize: 12,
} as const

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Lay out a parsed quadrant chart into pixel space.
 */
export function layoutQuadrantChart(
  chart: QuadrantChart,
  _options: RenderOptions = {},
): PositionedQuadrantChart {
  const titleHeight = chart.title ? Q.titleFontSize + Q.titleGap : 0

  const plotX = Q.paddingX + Q.yAxisGutter
  const plotY = Q.paddingY + titleHeight
  const size = Q.plotSize
  const half = size / 2

  const width = plotX + size + Q.paddingX
  const height = plotY + size + Q.xAxisGutter + Q.paddingY

  // Quadrant rectangles. (col, row) where row 0 = top.
  // 1=top-right, 2=top-left, 3=bottom-left, 4=bottom-right.
  const regionMeta: Array<{ number: 1 | 2 | 3 | 4; col: 0 | 1; row: 0 | 1 }> = [
    { number: 2, col: 0, row: 0 },
    { number: 1, col: 1, row: 0 },
    { number: 3, col: 0, row: 1 },
    { number: 4, col: 1, row: 1 },
  ]
  const regions: PositionedQuadrantRegion[] = regionMeta.map(({ number, col, row }) => {
    const x = plotX + col * half
    const y = plotY + row * half
    return {
      number,
      label: chart.quadrants[number - 1],
      x: round(x),
      y: round(y),
      width: round(half),
      height: round(half),
      labelX: round(x + half / 2),
      labelY: round(y + half / 2),
    }
  })

  // Points. y is inverted (ny=1 → top of plot).
  const points: PositionedQuadrantPoint[] = chart.points.map(p => ({
    label: p.label,
    nx: p.x,
    ny: p.y,
    cx: round(plotX + p.x * size),
    cy: round(plotY + (1 - p.y) * size),
    radius: Q.pointRadius,
  }))

  // Axis labels.
  const axisLabels: PositionedQuadrantAxisLabel[] = []
  const axisBaseline = plotY + size + Q.axisFontSize + 4
  if (chart.xAxis) {
    // Left label under the left half; right label under the right half.
    axisLabels.push({ text: chart.xAxis.near, x: round(plotX + 4), y: round(axisBaseline), anchor: 'start' })
    if (chart.xAxis.far) {
      axisLabels.push({ text: chart.xAxis.far, x: round(plotX + size - 4), y: round(axisBaseline), anchor: 'end' })
    }
  }
  if (chart.yAxis) {
    // Rotated labels along the left gutter: bottom label low, top label high.
    const yAxisX = Q.paddingX + Q.axisFontSize
    axisLabels.push({ text: chart.yAxis.near, x: round(yAxisX), y: round(plotY + size - 4), anchor: 'start' })
    if (chart.yAxis.far) {
      axisLabels.push({ text: chart.yAxis.far, x: round(yAxisX), y: round(plotY + 4), anchor: 'end' })
    }
  }

  return {
    width: round(width),
    height: round(height),
    title: chart.title
      ? { text: chart.title, x: round(plotX + size / 2), y: round(Q.paddingY + Q.titleFontSize / 2) }
      : undefined,
    plot: { x: round(plotX), y: round(plotY), size: round(size) },
    regions,
    points,
    axisLabels,
  }
}

/** Layout constants exported for the renderer (font sizes etc.). */
export const QUADRANT_METRICS = {
  titleFontSize: Q.titleFontSize,
  axisFontSize: Q.axisFontSize,
  quadrantFontSize: Q.quadrantFontSize,
  pointFontSize: Q.pointFontSize,
} as const

/** Measure helper retained for potential width-aware layout extensions. */
export function measureQuadrantLabel(text: string): number {
  return measureTextWidth(text, Q.quadrantFontSize, 600)
}
