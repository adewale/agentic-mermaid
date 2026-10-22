import { layoutTooltip } from '../shared/tooltip-layout.ts'
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
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'
import { resolveRenderStyle, STROKE_WIDTHS } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
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

/** Half-axis labels retain every prepared line; the gutter grows to fit. */
function budgetAxisLabel(text: string, maxWidth: number, fontSize: number, fontWeight: number, letterSpacing: number, transform: import('../types.ts').TextTransform | undefined): PixelTextBlock {
  return preparePixelText(text, { display: 'formatted', transform, maxWidth, fontSize, fontWeight, letterSpacing })
}

/** Density-scaled default plot side: 380px up to 8 points, then +20px per
 *  extra point, capped at 720px. Pure in the point count. */
function densityPlotSize(pointCount: number): number {
  if (pointCount <= 8) return Q.plotSize
  return Math.min(720, Q.plotSize + (pointCount - 8) * 20)
}

interface Box { x0: number; y0: number; x1: number; y1: number }

/** Request-local broad phase; exact family predicates remain authoritative. */
class CollisionIndex<T> {
  private cells = new Map<string, number[]>()
  private values: T[] = []
  private wide: number[] = []
  private visited: number[] = []
  private query = 0
  private cellsOf(box: Box): [number, number, number, number] | undefined {
    const x0 = Math.floor(box.x0 / 64), x1 = Math.floor(box.x1 / 64)
    const y0 = Math.floor(box.y0 / 64), y1 = Math.floor(box.y1 / 64)
    if (![x0, x1, y0, y1].every(Number.isSafeInteger) || x1 < x0 || y1 < y0 || (x1 - x0 + 1) * (y1 - y0 + 1) > 256) return undefined
    return [x0, x1, y0, y1]
  }
  add(box: Box, value: T): void {
    const id = this.values.length
    this.values.push(value)
    const cells = this.cellsOf(box)
    if (!cells) { this.wide.push(id); return }
    const [x0, x1, y0, y1] = cells
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = `${x},${y}`, ids = this.cells.get(key)
      if (ids) ids.push(id)
      else this.cells.set(key, [id])
    }
  }
  some(box: Box, predicate: (value: T) => boolean): boolean {
    const cells = this.cellsOf(box)
    if (!cells) return this.values.some(predicate)
    const query = ++this.query
    const hit = (id: number): boolean => {
      if (this.visited[id] === query) return false
      this.visited[id] = query
      return predicate(this.values[id]!)
    }
    for (const id of this.wide) if (hit(id)) return true
    const [x0, x1, y0, y1] = cells
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      for (const id of this.cells.get(`${x},${y}`) ?? []) if (hit(id)) return true
    }
    return false
  }
}

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
const SPIRAL_DIRECTIONS = SPIRAL_ANGLES.map(angle => {
  const cos = Math.cos(angle)
  return { cos, sin: Math.sin(angle), anchor: (cos > 0.38 ? 'start' : cos < -0.38 ? 'end' : 'middle') as Anchor }
})

/**
 * Candidate label slots for one point, in deterministic preference order.
 * Ring 0 is byte-identical to the historical right/left/below/above slots so
 * sparse charts do not move; the outward spiral only engages when a chart is
 * dense enough that no near slot clears.
 */
function* labelCandidates(cx: number, cy: number, gap: number, w: number, h: number): Generator<LabelCandidate> {
  yield { x: cx + gap, y: cy, anchor: 'start', far: false, box: { x0: cx + gap, y0: cy - h / 2, x1: cx + gap + w, y1: cy + h / 2 } }
  yield { x: cx - gap, y: cy, anchor: 'end', far: false, box: { x0: cx - gap - w, y0: cy - h / 2, x1: cx - gap, y1: cy + h / 2 } }
  yield { x: cx, y: cy + gap + h / 2, anchor: 'middle', far: false, box: { x0: cx - w / 2, y0: cy + gap, x1: cx + w / 2, y1: cy + gap + h } }
  yield { x: cx, y: cy - gap - h / 2, anchor: 'middle', far: false, box: { x0: cx - w / 2, y0: cy - gap - h, x1: cx + w / 2, y1: cy - gap } }
  for (let ring = 1; ring <= SPIRAL_RINGS; ring++) {
    const dist = gap + ring * (h + 6)
    for (const { cos, sin, anchor } of SPIRAL_DIRECTIONS) {
      const px = cx + cos * dist
      const py = cy + sin * dist
      const x0 = anchor === 'start' ? px : anchor === 'end' ? px - w : px - w / 2
      yield {
        x: px, y: py, anchor, far: true,
        box: { x0, y0: py - h / 2, x1: x0 + w, y1: py + h / 2 },
      }
    }
  }
}

/** Leader line from the circle edge to the label edge for a far slot. */
interface LeaderSegment { x1: number; y1: number; x2: number; y2: number }

function leaderFor(
  cx: number, cy: number, radius: number, c: LabelCandidate,
): LeaderSegment {
  const dx = c.x - cx
  const dy = c.y - cy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const x2 = c.anchor === 'start' ? c.box.x0 - 2 : c.anchor === 'end' ? c.box.x1 + 2 : c.x
  const y2 = c.anchor === 'middle' ? (c.y > cy ? c.box.y0 - 1 : c.box.y1 + 1) : c.y
  return { x1: round(cx + ux * radius), y1: round(cy + uy * radius), x2: round(x2), y2: round(y2) }
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function pointSegmentDistance(px: number, py: number, line: LeaderSegment): number {
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1
  const denom = dx * dx + dy * dy
  const t = denom === 0 ? 0 : Math.max(0, Math.min(1, ((px - line.x1) * dx + (py - line.y1) * dy) / denom))
  return Math.hypot(px - (line.x1 + t * dx), py - (line.y1 + t * dy))
}

/** Inclusive intersection plus visual clearance. Proper-crossing-only tests
 * miss T-junctions and collinear contacts, both of which read as one leader
 * terminating on another. Leaders from the same plotted point may fan out. */
function segmentsConflict(a: LeaderSegment, b: LeaderSegment): boolean {
  if (Math.hypot(a.x1 - b.x1, a.y1 - b.y1) <= 0.5) return false
  const epsilon = 0.01
  const onSegment = (line: LeaderSegment, x: number, y: number): boolean =>
    Math.abs(orient(line.x1, line.y1, line.x2, line.y2, x, y)) <= epsilon
    && x >= Math.min(line.x1, line.x2) - epsilon && x <= Math.max(line.x1, line.x2) + epsilon
    && y >= Math.min(line.y1, line.y2) - epsilon && y <= Math.max(line.y1, line.y2) + epsilon
  const o1 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1)
  const o2 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2)
  const o3 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1)
  const o4 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2)
  if ((o1 * o2 < -epsilon && o3 * o4 < -epsilon)
    || onSegment(a, b.x1, b.y1) || onSegment(a, b.x2, b.y2)
    || onSegment(b, a.x1, a.y1) || onSegment(b, a.x2, a.y2)) return true
  return Math.min(
    pointSegmentDistance(a.x1, a.y1, b), pointSegmentDistance(a.x2, a.y2, b),
    pointSegmentDistance(b.x1, b.y1, a), pointSegmentDistance(b.x2, b.y2, a),
  ) < 3
}

function leaderCrossesBox(line: LeaderSegment, box: Box): boolean {
  const expanded = { x0: box.x0 - 2, y0: box.y0 - 2, x1: box.x1 + 2, y1: box.y1 + 2 }
  if (Math.max(line.x1, line.x2) < expanded.x0 || Math.min(line.x1, line.x2) > expanded.x1 ||
      Math.max(line.y1, line.y2) < expanded.y0 || Math.min(line.y1, line.y2) > expanded.y1) return false
  const inside = (x: number, y: number) => x >= expanded.x0 && x <= expanded.x1 && y >= expanded.y0 && y <= expanded.y1
  if (inside(line.x1, line.y1) || inside(line.x2, line.y2)) return true
  const edges: LeaderSegment[] = [
    { x1: expanded.x0, y1: expanded.y0, x2: expanded.x1, y2: expanded.y0 },
    { x1: expanded.x1, y1: expanded.y0, x2: expanded.x1, y2: expanded.y1 },
    { x1: expanded.x1, y1: expanded.y1, x2: expanded.x0, y2: expanded.y1 },
    { x1: expanded.x0, y1: expanded.y1, x2: expanded.x0, y2: expanded.y0 },
  ]
  return edges.some(edge => segmentsConflict(line, edge))
}

/**
 * Lay out a parsed quadrant chart into pixel space.
 */
export function layoutQuadrantChart(
  chart: QuadrantChart,
  options: RenderOptions = {},
  visual: QuadrantVisualConfig = {},
  styleFace?: Readonly<InternalStyleFace>,
): PositionedQuadrantChart {
  const style = resolveRenderStyle(options, quadrantStyleDefaults(visual), styleFace)
  const paddingX = visual.quadrantPadding ?? Q.paddingX
  const paddingY = visual.quadrantPadding ?? Q.paddingY
  const titleFontSize = visual.titleFontSize ?? Q.titleFontSize
  const titleGap = visual.titlePadding ?? Q.titleGap
  const titleWeight = Math.max(style.groupHeaderFontWeight, 600)
  // The title is centered over the plot, so it wraps to the plot's width
  // rather than running past the canvas edges (a configured chartWidth stays).
  let titleBlock = chart.title ? preparePixelText(chart.title, { display: 'formatted', transform: style.groupTextTransform, fontSize: titleFontSize, fontWeight: titleWeight, letterSpacing: style.groupLetterSpacing }) : undefined
  let titleText = titleBlock?.text
  let titleHeight = chart.title ? titleFontSize + titleGap : 0

  // Per-axis text metrics (wired config wins per axis; the shared edge-label
  // style slot is the fallback for both).
  const axisFontX = visual.xAxisLabelFontSize ?? style.edgeLabelFontSize
  const axisFontY = visual.yAxisLabelFontSize ?? style.edgeLabelFontSize
  const axisPadX = visual.xAxisLabelPadding ?? Q.axisLabelPadding
  const axisPadY = visual.yAxisLabelPadding ?? Q.axisLabelPadding
  // Axis labels own one half-plot each. Compute their complete prepared blocks
  // and enlarge only the appropriate gutter; sparse/default labels therefore
  // keep their historical bytes. Explicit canvas dimensions are solved twice
  // because a wrapped gutter slightly reduces the available square plot.
  const baseXAxisGutter = axisFontX + axisPadX * 2 + 7
  const baseYAxisGutter = axisFontY + axisPadY * 2 + 7
  let xAxisGutter = baseXAxisGutter
  let yAxisGutter = baseYAxisGutter
  let size = densityPlotSize(chart.points.length)
  let budgetedX: { near: PixelTextBlock; far?: PixelTextBlock } | undefined
  let budgetedY: { near: PixelTextBlock; far?: PixelTextBlock } | undefined
  for (let pass = 0; pass < 2; pass++) {
    if (visual.chartWidth !== undefined || visual.chartHeight !== undefined) {
      const chromeW = paddingX * 2 + yAxisGutter
      const chromeH = paddingY * 2 + titleHeight + xAxisGutter
      const fromW = visual.chartWidth !== undefined ? visual.chartWidth - chromeW : Number.POSITIVE_INFINITY
      const fromH = visual.chartHeight !== undefined ? visual.chartHeight - chromeH : Number.POSITIVE_INFINITY
      size = Math.max(60, Math.min(fromW, fromH))
    }
    const halfBudget = Math.max(24, size / 2 - 12)
    budgetedX = chart.xAxis ? {
      near: budgetAxisLabel(chart.xAxis.near, halfBudget, axisFontX, style.edgeLabelFontWeight, style.edgeLetterSpacing, style.edgeTextTransform),
      ...(chart.xAxis.far ? { far: budgetAxisLabel(chart.xAxis.far, halfBudget, axisFontX, style.edgeLabelFontWeight, style.edgeLetterSpacing, style.edgeTextTransform) } : {}),
    } : undefined
    budgetedY = chart.yAxis ? {
      near: budgetAxisLabel(chart.yAxis.near, halfBudget, axisFontY, style.edgeLabelFontWeight, style.edgeLetterSpacing, style.edgeTextTransform),
      ...(chart.yAxis.far ? { far: budgetAxisLabel(chart.yAxis.far, halfBudget, axisFontY, style.edgeLabelFontWeight, style.edgeLetterSpacing, style.edgeTextTransform) } : {}),
    } : undefined
    if (chart.title) {
      titleBlock = preparePixelText(chart.title, { display: 'formatted', transform: style.groupTextTransform, fontSize: titleFontSize, fontWeight: titleWeight, letterSpacing: style.groupLetterSpacing, maxWidth: size })
      titleText = titleBlock.text
      titleHeight = titleBlock.height - (titleBlock.lineHeight - titleBlock.fontSize) + titleGap
    }
    const xHeight = Math.max(axisFontX * LINE_HEIGHT_RATIO, ...[budgetedX?.near, budgetedX?.far].map(block => block?.height ?? 0))
    const yHeight = Math.max(axisFontY * LINE_HEIGHT_RATIO, ...[budgetedY?.near, budgetedY?.far].map(block => block?.height ?? 0))
    xAxisGutter = baseXAxisGutter + xHeight - axisFontX * LINE_HEIGHT_RATIO
    yAxisGutter = baseYAxisGutter + yHeight - axisFontY * LINE_HEIGHT_RATIO
  }

  const plotX = paddingX + yAxisGutter
  const plotY = paddingY + titleHeight
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
      labelBlock: chart.quadrants[number - 1] === undefined ? undefined : preparePixelText(chart.quadrants[number - 1]!, { display: 'formatted', transform: style.groupTextTransform, fontSize: style.groupHeaderFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing }),
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
      const w = r.labelBlock!.width
      return { x0: r.labelX - w / 2, y0: r.labelY - r.labelBlock!.height / 2, x1: r.labelX + w / 2, y1: r.labelY + r.labelBlock!.height / 2 }
    })
  const defaultRadius = visual.pointRadius ?? Q.pointRadius
  const resolved = chart.points.map(p => resolvePointVisual(p, chart.classDefs, { radius: defaultRadius }))
  const pointBoxes: Box[] = chart.points.map((p, i) => {
    const cx = plotX + p.x * size, cy = plotY + (1 - p.y) * size, r = resolved[i]!.radius + 1
    return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }
  })
  const canvas: Box = { x0: 2, y0: 2, x1: width - 2, y1: height - 2 }
  const routedLeaders: LeaderSegment[] = []
  const indexed = chart.points.length >= 128
  const labelIndex = indexed ? new CollisionIndex<Box>() : undefined
  const pointIndex = indexed ? new CollisionIndex<Box>() : undefined
  const leaderIndex = indexed ? new CollisionIndex<LeaderSegment>() : undefined
  if (labelIndex && pointIndex) {
    for (const box of placedBoxes) labelIndex.add(box, box)
    for (const box of pointBoxes) pointIndex.add(box, box)
  }
  const points: PositionedQuadrantPoint[] = chart.points.map((p, i) => {
    const vis = resolved[i]!
    const cx = round(plotX + p.x * size)
    const cy = round(plotY + (1 - p.y) * size)
    const labelBlock = preparePixelText(p.label, { display: 'formatted', transform: style.nodeTextTransform, fontSize: fs, fontWeight: fw, letterSpacing: style.nodeLetterSpacing })
    const label = labelBlock.text
    const w = labelBlock.width
    const h = labelBlock.height
    const gap = vis.radius + lineGap
    const clear = (candidate: LabelCandidate): boolean => {
      const b = candidate.box
      if (!(b.x0 >= canvas.x0 && b.y0 >= canvas.y0 && b.x1 <= canvas.x1 && b.y1 <= canvas.y1) ||
          (labelIndex ? labelIndex.some(b, o => intersects(b, o)) : placedBoxes.some(o => intersects(b, o))) ||
          (pointIndex ? pointIndex.some(b, o => intersects(b, o)) : pointBoxes.some(o => intersects(b, o)))) return false
      if (!candidate.far) return true
      const leader = leaderFor(cx, cy, vis.radius, candidate)
      if (!labelIndex || !leaderIndex) return !placedBoxes.some(box => leaderCrossesBox(leader, box)) && !routedLeaders.some(existing => segmentsConflict(leader, existing))
      const bounds = { x0: Math.min(leader.x1, leader.x2), y0: Math.min(leader.y1, leader.y2), x1: Math.max(leader.x1, leader.x2), y1: Math.max(leader.y1, leader.y2) }
      const labelQuery = { x0: bounds.x0 - 2, y0: bounds.y0 - 2, x1: bounds.x1 + 2, y1: bounds.y1 + 2 }
      const leaderQuery = { x0: bounds.x0 - 3, y0: bounds.y0 - 3, x1: bounds.x1 + 3, y1: bounds.y1 + 3 }
      return !labelIndex.some(labelQuery, box => leaderCrossesBox(leader, box)) && !leaderIndex.some(leaderQuery, existing => segmentsConflict(leader, existing))
    }
    let first: LabelCandidate | undefined
    let chosen: LabelCandidate | undefined
    for (const candidate of labelCandidates(cx, cy, gap, w, h)) {
      first ??= candidate
      if (clear(candidate)) { chosen = candidate; break }
    }

    const positioned: PositionedQuadrantPoint = {
      label,
      labelBlock,
      nx: p.x,
      ny: p.y,
      cx,
      cy,
      radius: vis.radius,
      labelX: round((chosen ?? first!).x),
      labelY: round((chosen ?? first!).y),
      labelAnchor: (chosen ?? first!).anchor,
    }
    positioned.tooltip = layoutTooltip(cx, cy - vis.radius, `${label}: [${p.x}, ${p.y}]`)
    if (vis.fill !== undefined) positioned.fill = vis.fill
    if (vis.stroke !== undefined) positioned.stroke = vis.stroke
    if (vis.strokeWidth !== undefined) positioned.strokeWidth = vis.strokeWidth
    if (p.className !== undefined) positioned.className = p.className

    if (chosen) {
      placedBoxes.push(chosen.box)
      labelIndex?.add(chosen.box, chosen.box)
      const labelBox: QuadrantLabelBox = {
        x0: round(chosen.box.x0), y0: round(chosen.box.y0),
        x1: round(chosen.box.x1), y1: round(chosen.box.y1),
      }
      positioned.labelBox = labelBox
      if (chosen.far) {
        positioned.leader = leaderFor(cx, cy, vis.radius, chosen)
        routedLeaders.push(positioned.leader)
        const line = positioned.leader
        leaderIndex?.add({ x0: Math.min(line.x1, line.x2), y0: Math.min(line.y1, line.y2), x1: Math.max(line.x1, line.x2), y1: Math.max(line.y1, line.y2) }, line)
      }
    } else {
      // Priority-based hiding: source order wins; the hidden label stays on
      // the model (data-label, tooltips, legends) — it is only not drawn.
      positioned.labelHidden = true
    }
    return positioned
  })

  // Axis labels.
  const axisLabels: PositionedQuadrantAxisLabel[] = []
  const axisBaseline = (block: PixelTextBlock): number => plotY + size + Math.max(axisFontX, block.lineHeight / 2) + axisPadX
  if (budgetedX) {
    // Left label under the left half; right label under the right half.
    axisLabels.push({ text: budgetedX.near.text, block: budgetedX.near, x: round(plotX + 4), y: round(axisBaseline(budgetedX.near)), anchor: 'start', fontSize: axisFontX })
    if (budgetedX.far) {
      axisLabels.push({ text: budgetedX.far.text, block: budgetedX.far, x: round(plotX + size - 4), y: round(axisBaseline(budgetedX.far)), anchor: 'end', fontSize: axisFontX })
    }
  }
  if (budgetedY) {
    // Rotated labels along the left gutter: bottom label low, top label high.
    const yAxisX = (block: PixelTextBlock): number => paddingX + Math.max(axisFontY, block.lineHeight / 2)
    axisLabels.push({ text: budgetedY.near.text, block: budgetedY.near, x: round(yAxisX(budgetedY.near)), y: round(plotY + size - 4), anchor: 'start', fontSize: axisFontY })
    if (budgetedY.far) {
      axisLabels.push({ text: budgetedY.far.text, block: budgetedY.far, x: round(yAxisX(budgetedY.far)), y: round(plotY + 4), anchor: 'end', fontSize: axisFontY })
    }
  }

  return {
    width: round(width),
    height: round(height),
    title: titleText !== undefined
      ? { text: titleText, block: titleBlock, x: round(plotX + size / 2), y: round(paddingY + (titleHeight - titleGap) / 2), fontSize: titleFontSize }
      : undefined,
    accessibility: chart.accessibility ? { ...chart.accessibility } : undefined,
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
