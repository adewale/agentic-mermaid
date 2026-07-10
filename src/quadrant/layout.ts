import type {
  QuadrantChart,
  PositionedQuadrantChart,
  PositionedQuadrantRegion,
  PositionedQuadrantPoint,
  PositionedQuadrantAxisLabel,
  QuadrantLabelBox,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { QuadrantVisualConfig } from './config.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { applyTextTransform, resolveRenderStyle, STROKE_WIDTHS } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import { resolvePointVisual } from './point-style.ts'

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
//
// Sizing: the plot side defaults to 380px, grows deterministically with point
// count (density-scaled), and is overridden by the wired quadrantChart config
// (chartWidth/chartHeight give the CANVAS size; the square plot side derives
// after fixed chrome). See src/quadrant/config.ts for the wire-or-warn table.
// ============================================================================

const Q = {
  paddingX: 24,
  paddingY: 24,
  titleFontSize: 18,
  titleGap: 18,
  /** Default square plot side length in pixels (density-scaled beyond 8 points). */
  plotSize: 380,
  axisFontSize: 13,
  /** Gap between the plot edge and axis text baselines. */
  axisLabelPadding: 4,
  quadrantFontSize: 15,
  pointRadius: 6,
  pointFontSize: 12,
  /** Gap between a point circle and its label (upstream pointTextPadding). */
  pointTextPadding: 4,
} as const

/** Style defaults shared by layout AND renderer, so measurement uses the same
 *  font sizes the SVG draws. Wired quadrantChart config feeds the defaults;
 *  explicit RenderOptions style faces still win (resolveRenderStyle order). */
export function quadrantStyleDefaults(visual: QuadrantVisualConfig = {}): RenderStyleDefaults {
  return {
    nodeLabelFontSize: visual.pointLabelFontSize ?? Q.pointFontSize,
    edgeLabelFontSize: visual.xAxisLabelFontSize ?? Q.axisFontSize,
    groupHeaderFontSize: visual.quadrantLabelFontSize ?? Q.quadrantFontSize,
    nodeLabelFontWeight: 500,
    edgeLabelFontWeight: 500,
    groupHeaderFontWeight: 600,
    nodePaddingX: 0,
    nodePaddingY: 0,
    nodeLineWidth: STROKE_WIDTHS.innerBox,
    edgeLineWidth: 1,
    groupCornerRadius: 0,
    groupPaddingX: 0,
    groupPaddingY: 0,
    groupLineWidth: 2,
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Density-scaled default plot side: 380px up to 8 points, then +20px per
 *  extra point, capped at 720px. Pure in the point count. */
function densityPlotSize(pointCount: number): number {
  if (pointCount <= 8) return Q.plotSize
  return Math.min(720, Q.plotSize + (pointCount - 8) * 20)
}

interface Box { x0: number; y0: number; x1: number; y1: number }

const intersects = (a: Box, b: Box): boolean =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5

type Anchor = 'start' | 'end' | 'middle'

interface LabelCandidate {
  x: number
  y: number
  anchor: Anchor
  box: Box
  /** True for spiral slots that need a leader line back to the point. */
  far: boolean
}

/** Deterministic spiral angle order: horizontal slots first (they read best),
 *  then verticals, then diagonals, then the in-between sixteenths. */
const SPIRAL_ANGLES: readonly number[] = [
  0, Math.PI,
  -Math.PI / 2, Math.PI / 2,
  -Math.PI / 4, Math.PI / 4, (-3 * Math.PI) / 4, (3 * Math.PI) / 4,
  -Math.PI / 8, Math.PI / 8, (-3 * Math.PI) / 8, (3 * Math.PI) / 8,
  (-5 * Math.PI) / 8, (5 * Math.PI) / 8, (-7 * Math.PI) / 8, (7 * Math.PI) / 8,
]
const SPIRAL_RINGS = 10

/**
 * Candidate label slots for one point, in deterministic preference order.
 * Ring 0 is byte-identical to the historical right/left/below/above slots so
 * sparse charts do not move; the outward spiral only engages when a chart is
 * dense enough that no near slot clears.
 */
function labelCandidates(cx: number, cy: number, gap: number, w: number, h: number): LabelCandidate[] {
  const near: LabelCandidate[] = [
    { x: cx + gap, y: cy, anchor: 'start', far: false, box: { x0: cx + gap, y0: cy - h / 2, x1: cx + gap + w, y1: cy + h / 2 } },
    { x: cx - gap, y: cy, anchor: 'end', far: false, box: { x0: cx - gap - w, y0: cy - h / 2, x1: cx - gap, y1: cy + h / 2 } },
    { x: cx, y: cy + gap + h / 2, anchor: 'middle', far: false, box: { x0: cx - w / 2, y0: cy + gap, x1: cx + w / 2, y1: cy + gap + h } },
    { x: cx, y: cy - gap - h / 2, anchor: 'middle', far: false, box: { x0: cx - w / 2, y0: cy - gap - h, x1: cx + w / 2, y1: cy - gap } },
  ]
  const spiral: LabelCandidate[] = []
  for (let ring = 1; ring <= SPIRAL_RINGS; ring++) {
    const dist = gap + ring * (h + 6)
    for (const angle of SPIRAL_ANGLES) {
      const px = cx + Math.cos(angle) * dist
      const py = cy + Math.sin(angle) * dist
      const cos = Math.cos(angle)
      const anchor: Anchor = cos > 0.38 ? 'start' : cos < -0.38 ? 'end' : 'middle'
      const x0 = anchor === 'start' ? px : anchor === 'end' ? px - w : px - w / 2
      spiral.push({
        x: px, y: py, anchor, far: true,
        box: { x0, y0: py - h / 2, x1: x0 + w, y1: py + h / 2 },
      })
    }
  }
  return [...near, ...spiral]
}

/** Leader line from the circle edge to the label edge for a far slot. */
function leaderFor(
  cx: number, cy: number, radius: number, c: LabelCandidate,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = c.x - cx
  const dy = c.y - cy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const x2 = c.anchor === 'start' ? c.box.x0 - 2 : c.anchor === 'end' ? c.box.x1 + 2 : c.x
  const y2 = c.anchor === 'middle' ? (c.y > cy ? c.box.y0 - 1 : c.box.y1 + 1) : c.y
  return { x1: round(cx + ux * radius), y1: round(cy + uy * radius), x2: round(x2), y2: round(y2) }
}

/**
 * Lay out a parsed quadrant chart into pixel space.
 */
export function layoutQuadrantChart(
  chart: QuadrantChart,
  options: RenderOptions = {},
  visual: QuadrantVisualConfig = {},
): PositionedQuadrantChart {
  const style = resolveRenderStyle(options, quadrantStyleDefaults(visual))
  const paddingX = visual.quadrantPadding ?? Q.paddingX
  const paddingY = visual.quadrantPadding ?? Q.paddingY
  const titleFontSize = visual.titleFontSize ?? Q.titleFontSize
  const titleGap = visual.titlePadding ?? Q.titleGap
  const titleHeight = chart.title ? titleFontSize + titleGap : 0

  // Per-axis text metrics (wired config wins per axis; the shared edge-label
  // style slot is the fallback for both).
  const axisFontX = visual.xAxisLabelFontSize ?? style.edgeLabelFontSize
  const axisFontY = visual.yAxisLabelFontSize ?? style.edgeLabelFontSize
  const axisPadX = visual.xAxisLabelPadding ?? Q.axisLabelPadding
  const axisPadY = visual.yAxisLabelPadding ?? Q.axisLabelPadding
  // Gutters reserve room for the axis text (+7px breathing space keeps the
  // historical 28px default: 13 + 2*4 + 7).
  const xAxisGutter = axisFontX + axisPadX * 2 + 7
  const yAxisGutter = axisFontY + axisPadY * 2 + 7

  const plotX = paddingX + yAxisGutter
  const plotY = paddingY + titleHeight
  // Plot side: explicit chartWidth/chartHeight (canvas dimensions) win;
  // otherwise the density-scaled default.
  const chromeW = paddingX * 2 + yAxisGutter
  const chromeH = paddingY * 2 + titleHeight + xAxisGutter
  let size: number
  if (visual.chartWidth !== undefined || visual.chartHeight !== undefined) {
    const fromW = visual.chartWidth !== undefined ? visual.chartWidth - chromeW : Number.POSITIVE_INFINITY
    const fromH = visual.chartHeight !== undefined ? visual.chartHeight - chromeH : Number.POSITIVE_INFINITY
    size = Math.max(60, Math.min(fromW, fromH))
  } else {
    size = densityPlotSize(chart.points.length)
  }
  const half = size / 2

  const width = plotX + size + paddingX
  const height = plotY + size + xAxisGutter + paddingY

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
  //
  // Label placement is collision-aware and PURE in the point geometry
  // (2026-07 overlap audit: 89% of fuzzed quadrant charts had point labels
  // colliding). Policy, in deterministic preference order per point (source
  // order = priority):
  //   ring 0  right → left → below → above of the point (the historical
  //           slots, so sparse charts keep their exact geometry);
  //   spiral  10 outward rings × 16 angles, connected by a leader line;
  //   hidden  when nothing clears, the label hides (recorded on the point —
  //           never silently dropped) and earlier source order wins.
  // A slot must clear every already-placed label box, every point circle,
  // every quadrant label, and the canvas bounds.
  const fs = style.nodeLabelFontSize
  const fw = style.nodeLabelFontWeight
  const lineGap = visual.pointTextPadding ?? Q.pointTextPadding
  const placedBoxes: Box[] = regions
    .filter(r => r.label)
    .map(r => {
      const w = measureTextWidth(applyTextTransform(r.label!, style.groupTextTransform), style.groupHeaderFontSize, style.groupHeaderFontWeight)
      return { x0: r.labelX - w / 2, y0: r.labelY - style.groupHeaderFontSize * 0.75, x1: r.labelX + w / 2, y1: r.labelY + style.groupHeaderFontSize * 0.75 }
    })
  const defaultRadius = visual.pointRadius ?? Q.pointRadius
  const resolved = chart.points.map(p => resolvePointVisual(p, chart.classDefs, { radius: defaultRadius }))
  const pointBoxes: Box[] = chart.points.map((p, i) => {
    const cx = plotX + p.x * size, cy = plotY + (1 - p.y) * size, r = resolved[i]!.radius + 1
    return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }
  })
  const canvas: Box = { x0: 2, y0: 2, x1: width - 2, y1: height - 2 }
  const points: PositionedQuadrantPoint[] = chart.points.map((p, i) => {
    const vis = resolved[i]!
    const cx = round(plotX + p.x * size)
    const cy = round(plotY + (1 - p.y) * size)
    const label = applyTextTransform(p.label, style.nodeTextTransform)
    const w = measureTextWidth(label, fs, fw)
    const h = fs * 1.1
    const gap = vis.radius + lineGap
    const clear = (b: Box): boolean =>
      b.x0 >= canvas.x0 && b.y0 >= canvas.y0 && b.x1 <= canvas.x1 && b.y1 <= canvas.y1 &&
      !placedBoxes.some(o => intersects(b, o)) && !pointBoxes.some(o => intersects(b, o))
    const candidates = labelCandidates(cx, cy, gap, w, h)
    const chosen = candidates.find(c => clear(c.box))

    const positioned: PositionedQuadrantPoint = {
      label,
      nx: p.x,
      ny: p.y,
      cx,
      cy,
      radius: vis.radius,
      labelX: round((chosen ?? candidates[0]!).x),
      labelY: round((chosen ?? candidates[0]!).y),
      labelAnchor: (chosen ?? candidates[0]!).anchor,
    }
    if (vis.fill !== undefined) positioned.fill = vis.fill
    if (vis.stroke !== undefined) positioned.stroke = vis.stroke
    if (vis.strokeWidth !== undefined) positioned.strokeWidth = vis.strokeWidth
    if (p.className !== undefined) positioned.className = p.className

    if (chosen) {
      placedBoxes.push(chosen.box)
      const labelBox: QuadrantLabelBox = {
        x0: round(chosen.box.x0), y0: round(chosen.box.y0),
        x1: round(chosen.box.x1), y1: round(chosen.box.y1),
      }
      positioned.labelBox = labelBox
      if (chosen.far) positioned.leader = leaderFor(cx, cy, vis.radius, chosen)
    } else {
      // Priority-based hiding: source order wins; the hidden label stays on
      // the model (data-label, tooltips, legends) — it is only not drawn.
      positioned.labelHidden = true
    }
    return positioned
  })

  // Axis labels.
  const axisLabels: PositionedQuadrantAxisLabel[] = []
  const axisBaseline = plotY + size + axisFontX + axisPadX
  if (chart.xAxis) {
    // Left label under the left half; right label under the right half.
    axisLabels.push({ text: chart.xAxis.near, x: round(plotX + 4), y: round(axisBaseline), anchor: 'start', fontSize: axisFontX })
    if (chart.xAxis.far) {
      axisLabels.push({ text: chart.xAxis.far, x: round(plotX + size - 4), y: round(axisBaseline), anchor: 'end', fontSize: axisFontX })
    }
  }
  if (chart.yAxis) {
    // Rotated labels along the left gutter: bottom label low, top label high.
    const yAxisX = paddingX + axisFontY
    axisLabels.push({ text: chart.yAxis.near, x: round(yAxisX), y: round(plotY + size - 4), anchor: 'start', fontSize: axisFontY })
    if (chart.yAxis.far) {
      axisLabels.push({ text: chart.yAxis.far, x: round(yAxisX), y: round(plotY + 4), anchor: 'end', fontSize: axisFontY })
    }
  }

  return {
    width: round(width),
    height: round(height),
    title: chart.title
      ? { text: chart.title, x: round(plotX + size / 2), y: round(paddingY + titleFontSize / 2), fontSize: titleFontSize }
      : undefined,
    plot: { x: round(plotX), y: round(plotY), size: round(size) },
    regions,
    points,
    axisLabels,
    visual,
  }
}

/** Historical layout constants (defaults; config overrides via
 *  quadrantStyleDefaults / layoutQuadrantChart). Kept exported for tests. */
export const QUADRANT_METRICS = {
  titleFontSize: Q.titleFontSize,
  axisFontSize: Q.axisFontSize,
  quadrantFontSize: Q.quadrantFontSize,
  pointFontSize: Q.pointFontSize,
} as const
