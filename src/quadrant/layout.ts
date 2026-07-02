import type {
  QuadrantChart,
  PositionedQuadrantChart,
  PositionedQuadrantRegion,
  PositionedQuadrantPoint,
  PositionedQuadrantAxisLabel,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { resolveRenderStyle } from '../styles.ts'

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
  options: RenderOptions = {},
): PositionedQuadrantChart {
  const style = resolveRenderStyle(options)
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
  // Label placement is collision-aware (2026-07 overlap audit: 89% of fuzzed
  // quadrant charts had point labels colliding with each other, the quadrant
  // labels, or the canvas edge). Candidates are tried right → left → below →
  // above of the point; the first whose box clears every already-placed label
  // box, every point circle, every quadrant label, and the canvas bounds wins.
  // When nothing clears, the label keeps the right-hand slot clamped into the
  // canvas (best effort, surfaced by eval/overlap-audit rather than hidden).
  const fs = style.nodeLabelFontSize
  const fw = style.nodeLabelFontWeight
  const lineGap = 4
  interface Box { x0: number; y0: number; x1: number; y1: number }
  const intersects = (a: Box, b: Box): boolean =>
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5
  const placedBoxes: Box[] = regions
    .filter(r => r.label)
    .map(r => {
      const w = measureTextWidth(r.label!, Q.quadrantFontSize, 600)
      return { x0: r.labelX - w / 2, y0: r.labelY - Q.quadrantFontSize * 0.75, x1: r.labelX + w / 2, y1: r.labelY + Q.quadrantFontSize * 0.75 }
    })
  const pointBoxes: Box[] = chart.points.map(p => {
    const cx = plotX + p.x * size, cy = plotY + (1 - p.y) * size, r = Q.pointRadius + 1
    return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }
  })
  const canvas: Box = { x0: 2, y0: 2, x1: width - 2, y1: height - 2 }
  const points: PositionedQuadrantPoint[] = chart.points.map(p => {
    const cx = round(plotX + p.x * size)
    const cy = round(plotY + (1 - p.y) * size)
    const w = measureTextWidth(p.label, fs, fw)
    const h = fs * 1.1
    const gap = Q.pointRadius + lineGap
    const candidates: Array<{ x: number; y: number; anchor: 'start' | 'end' | 'middle'; box: Box }> = [
      { x: cx + gap, y: cy, anchor: 'start', box: { x0: cx + gap, y0: cy - h / 2, x1: cx + gap + w, y1: cy + h / 2 } },
      { x: cx - gap, y: cy, anchor: 'end', box: { x0: cx - gap - w, y0: cy - h / 2, x1: cx - gap, y1: cy + h / 2 } },
      { x: cx, y: cy + gap + h / 2, anchor: 'middle', box: { x0: cx - w / 2, y0: cy + gap, x1: cx + w / 2, y1: cy + gap + h } },
      { x: cx, y: cy - gap - h / 2, anchor: 'middle', box: { x0: cx - w / 2, y0: cy - gap - h, x1: cx + w / 2, y1: cy - gap } },
    ]
    const clear = (b: Box): boolean =>
      b.x0 >= canvas.x0 && b.y0 >= canvas.y0 && b.x1 <= canvas.x1 && b.y1 <= canvas.y1 &&
      !placedBoxes.some(o => intersects(b, o)) && !pointBoxes.some(o => intersects(b, o))
    let chosen = candidates.find(c => clear(c.box))
    if (!chosen) {
      // Best effort: right-hand slot clamped into the canvas.
      const c0 = candidates[0]!
      const dx = Math.min(0, canvas.x1 - c0.box.x1)
      chosen = { ...c0, x: c0.x + dx, box: { ...c0.box, x0: c0.box.x0 + dx, x1: c0.box.x1 + dx } }
    }
    placedBoxes.push(chosen.box)
    return {
      label: p.label,
      nx: p.x,
      ny: p.y,
      cx,
      cy,
      radius: Q.pointRadius,
      labelX: round(chosen.x),
      labelY: round(chosen.y),
      labelAnchor: chosen.anchor,
    }
  })

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
