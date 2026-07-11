// ============================================================================
// Gantt layout — schedule → deterministic geometry (docs/design/families/gantt.md §4).
//
// One layout model feeds both renderers: the SVG renderer consumes the pixel
// geometry directly; the ASCII renderer reuses tick *selection* (the resolved
// tick instants) and the row model with its own column math. Bars never
// leave the plot area; `vert` markers consume no task row; compact mode packs
// non-overlapping tasks of a section into shared rows deterministically
// (first-fit by source order).
// ============================================================================

import type {
  GanttModel, GanttSchedule, GanttLayoutResult, GanttBarLayout, GanttRowLayout,
  GanttSectionBand, GanttVertLayout, GanttTick, GanttTickUnit, GanttDependencyLayout,
  GanttExcludedBand, EpochMs,
} from './types.ts'
import { DAY_MS, dayOfWeek, WEEKDAY_INDEX, formatGanttInstant, ganttDependencyEdges, startOfDay } from './schedule.ts'
import { applyTextTransform, estimateTextWidth, resolveRenderStyle, STROKE_WIDTHS } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { wrapLabelToWidth } from '../shared/label-wrap.ts'
import type { RenderOptions } from '../types.ts'

export const GANTT_MAX_TICKS = 120

/**
 * Width budget (px of text) for the left label column (family-elevation-plan
 * §Gantt item 5; upstream #6946/#2886). Labels measuring wider wrap via the
 * SHARED measured-pixel machinery (src/shared/label-wrap.ts — the journey
 * extraction, no fourth wrap fork); labels at or under the budget render
 * byte-identically to previous releases. 220px holds every mermaid-docs
 * corpus gantt label (max ≈ 201px) on one line.
 */
export const GANTT_LABEL_WRAP_BUDGET = 220

/** Excluded-day shading walks at most this many days; absurd ranges skip
 *  shading entirely rather than emit thousands of rects (same order as the
 *  scheduler's MAX_CALENDAR_STEPS bound). */
const GANTT_MAX_SHADED_DAYS = 10_000

export interface GanttLayoutOptions {
  /** Total drawing width; the plot shrinks to fit. */
  width?: number
  compact?: boolean
  barHeight?: number
  /** Resolved clock instant (schedule.today). */
  today?: EpochMs
  /** Render options whose style roles affect label and axis geometry. */
  renderOptions?: RenderOptions
}

const GL = {
  plotWidth: 600,
  padding: 16,
  titleHeight: 34,
  axisHeight: 24,
  rowGap: 8,
  sectionGap: 6,
  barHeight: 22,
  labelGap: 12,
  labelFontSize: 13,
  sectionFontSize: 13,
} as const

export const GANTT_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: GL.labelFontSize,
  edgeLabelFontSize: 11,
  groupHeaderFontSize: GL.sectionFontSize,
  nodeLabelFontWeight: 500,
  edgeLabelFontWeight: 500,
  groupHeaderFontWeight: 600,
  nodePaddingX: 0,
  nodePaddingY: 0,
  nodeLineWidth: STROKE_WIDTHS.innerBox,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: 0,
  groupPaddingY: 0,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

const TICK_UNIT_MS: Record<GanttTickUnit, number> = {
  millisecond: 1,
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS, // month ticks step by calendar months; this is the sizing estimate
}

// Auto-tick candidates: (stepMs, defaultFormat) pairs from minutes to years.
const AUTO_TICKS: Array<{ unit: GanttTickUnit; count: number; format: string }> = [
  { unit: 'minute', count: 1, format: '%H:%M' },
  { unit: 'minute', count: 15, format: '%H:%M' },
  { unit: 'hour', count: 1, format: '%H:%M' },
  { unit: 'hour', count: 6, format: '%H:%M' },
  { unit: 'day', count: 1, format: '%m-%d' },
  { unit: 'week', count: 1, format: '%m-%d' },
  { unit: 'week', count: 2, format: '%m-%d' },
  { unit: 'month', count: 1, format: '%b %Y' },
  { unit: 'month', count: 3, format: '%b %Y' },
  { unit: 'month', count: 12, format: '%Y' },
]

interface TickPlan {
  unit: GanttTickUnit
  count: number
  format: string
}

const INLINE_FORMAT_TAG = /<\/?(?:b|strong|i|em|u|s|del)\s*>/gi

export function resolveGanttRenderStyle(options: RenderOptions = {}): ResolvedRenderStyle {
  return resolveRenderStyle(options, GANTT_STYLE_DEFAULTS)
}

export function ganttTitleFontSize(style: ResolvedRenderStyle): number {
  return Math.max(17, style.groupHeaderFontSize)
}

export function ganttTitleY(style: ResolvedRenderStyle): number {
  const titleHeight = ganttTitleHeight(style)
  return titleHeight === GL.titleHeight ? 18 : titleHeight / 2
}

export function ganttAxisLabelOffset(style: ResolvedRenderStyle): number {
  return Math.max(10, style.edgeLabelFontSize * 0.75)
}

export function ganttMeasureTextWidth(
  text: string,
  fontSize: number,
  fontWeight: number,
  letterSpacing = 0,
): number {
  const plain = text.replace(INLINE_FORMAT_TAG, '')
  const codepoints = [...plain].length
  const tracking = Math.max(0, codepoints - 1) * letterSpacing
  return Math.max(0, estimateTextWidth(plain, fontSize, fontWeight) + tracking)
}

function ganttTitleHeight(style: ResolvedRenderStyle): number {
  return Math.max(GL.titleHeight, Math.ceil(ganttTitleFontSize(style) * 1.3) + 8)
}

function ganttAxisHeight(style: ResolvedRenderStyle): number {
  return Math.max(GL.axisHeight, Math.ceil(ganttAxisLabelOffset(style) + style.edgeLabelFontSize * 0.65 + 4))
}

function ganttRowHeight(style: ResolvedRenderStyle, barHeight: number): number {
  const labelLineHeight = Math.max(style.nodeLabelFontSize, style.groupHeaderFontSize) * 1.3
  return Math.ceil(Math.max(barHeight, labelLineHeight)) + GL.rowGap
}

/**
 * Pick the tick plan: the explicit `tickInterval` when it stays under the
 * GANTT_MAX_TICKS bound (mermaid PR #7197 regression: tiny intervals must not
 * generate unbounded ticks), otherwise the smallest auto candidate that fits.
 */
export function planTicks(schedule: GanttSchedule, model: GanttModel, targetTicks = 8): TickPlan {
  const span = schedule.timeMax - schedule.timeMin
  if (model.tickInterval) {
    const step = TICK_UNIT_MS[model.tickInterval.unit] * model.tickInterval.count
    if (span / step <= GANTT_MAX_TICKS) {
      return { ...model.tickInterval, format: model.axisFormat ?? defaultFormatFor(model.tickInterval.unit) }
    }
  }
  for (const cand of AUTO_TICKS) {
    const step = TICK_UNIT_MS[cand.unit] * cand.count
    if (span / step <= targetTicks) {
      return { unit: cand.unit, count: cand.count, format: model.axisFormat ?? cand.format }
    }
  }
  const last = AUTO_TICKS[AUTO_TICKS.length - 1]!
  // Beyond the largest candidate: scale year ticks up until bounded.
  let count = last.count
  while ((span / (TICK_UNIT_MS.month * count)) > GANTT_MAX_TICKS) count *= 2
  return { unit: 'month', count, format: model.axisFormat ?? last.format }
}

function defaultFormatFor(unit: GanttTickUnit): string {
  switch (unit) {
    case 'millisecond': case 'second': return '%H:%M:%S'
    case 'minute': case 'hour': return '%H:%M'
    case 'day': case 'week': return '%m-%d'
    case 'month': return '%b %Y'
  }
}

/** First tick instant at or before timeMin, aligned to the unit (weeks align
 *  to the model's weekStart; months to the 1st; days to midnight UTC). */
function alignTickStart(timeMin: EpochMs, plan: TickPlan, weekStart: number): EpochMs {
  if (plan.unit === 'week') {
    let t = startOfDay(timeMin)
    let steps = 0
    while (dayOfWeek(t) !== weekStart && steps++ < 7) t -= DAY_MS
    return t
  }
  if (plan.unit === 'month') {
    const d = new Date(timeMin)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  }
  if (plan.unit === 'day') return startOfDay(timeMin)
  const step = TICK_UNIT_MS[plan.unit] * plan.count
  return Math.floor(timeMin / step) * step
}

function nextTick(t: EpochMs, plan: TickPlan): EpochMs {
  if (plan.unit === 'month') {
    const d = new Date(t)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + plan.count, 1)
  }
  return t + TICK_UNIT_MS[plan.unit] * plan.count
}

/**
 * Resolve the tick instants for a schedule (shared by SVG and ASCII).
 * Bounded by GANTT_MAX_TICKS regardless of inputs.
 */
export function resolveTicks(schedule: GanttSchedule, model: GanttModel, targetTicks = 8): Array<{ time: EpochMs; label: string }> {
  const plan = planTicks(schedule, model, targetTicks)
  const weekStart = WEEKDAY_INDEX[model.weekStart]
  const out: Array<{ time: EpochMs; label: string }> = []
  let t = alignTickStart(schedule.timeMin, plan, weekStart)
  let guard = 0
  while (t <= schedule.timeMax && guard++ <= GANTT_MAX_TICKS) {
    if (t >= schedule.timeMin) out.push({ time: t, label: formatGanttInstant(t, plan.format) })
    t = nextTick(t, plan)
  }
  // A coarse explicit interval over a short span (e.g. `tickInterval 1month`
  // on a 2-day chart) can leave zero in-range ticks; an axis must never be
  // empty, so fall back to a single tick at the range start.
  if (out.length === 0) {
    out.push({ time: schedule.timeMin, label: formatGanttInstant(schedule.timeMin, plan.format) })
  }
  return out
}

/**
 * Compact-mode lane packing: within one section, tasks (source order) go to
 * the first lane whose latest end is <= the task's start. Deterministic and
 * overlap-free by construction.
 */
export function packCompactLanes(tasks: Array<{ start: EpochMs; end: EpochMs }>): number[] {
  const laneEnds: EpochMs[] = []
  const laneOf: number[] = []
  for (const t of tasks) {
    let lane = laneEnds.findIndex(end => end <= t.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(t.end)
    } else {
      laneEnds[lane] = t.end
    }
    laneOf.push(lane)
  }
  return laneOf
}

// ---- Dependency connector routing (family-elevation-plan §Gantt item 1) ------
//
// Deterministic orthogonal elbow routes from each predecessor bar's end to its
// successor bar's start, computed here (never in the renderer) so both the SVG
// overlay and the invariant tests consume the same geometry. Correctness by
// construction: horizontal runs happen only in row gutters (which contain no
// bars) or as short stubs beside the two anchored bars; vertical runs cross a
// row band only at an x proven clear of every bar interior — when the straight
// column is blocked, the route jogs inside the gutter (the corridor just left
// of the plot, x = plot.x - GANTT_DEP_STUB, is always clear because bars never
// start left of plot.x, and the label column keeps a labelGap > stub margin).
// A route that would still cross a bar interior is never emitted.

/** Stub length for connector exits/entries, and the escape-corridor inset. */
export const GANTT_DEP_STUB = 8

const DEP_EPS = 0.01

interface DepPoint { x: number; y: number }
interface DepRect { x: number; y: number; w: number; h: number }
interface DepBand { y: number; h: number }
interface DepPlot { x: number; y: number; w: number; h: number }
interface DepAnchor {
  rect: DepRect
  /** Milestone diamond center — top/bottom exits/entries aim at the tip. */
  tipX?: number
}

function depBarRect(bar: GanttBarLayout): DepRect {
  if (bar.milestoneX !== undefined) return { x: bar.milestoneX - bar.h / 2, y: bar.y, w: bar.h, h: bar.h }
  return { x: bar.x, y: bar.y, w: bar.w, h: bar.h }
}

/** Horizontal segment at `y` spanning [x1,x2] crosses the OPEN interior of r. */
function hBlocked(y: number, x1: number, x2: number, r: DepRect): boolean {
  const [a, b] = x1 <= x2 ? [x1, x2] : [x2, x1]
  return y > r.y + DEP_EPS && y < r.y + r.h - DEP_EPS && b > r.x + DEP_EPS && a < r.x + r.w - DEP_EPS
}

/** Vertical segment at `x` spanning [y1,y2] crosses the OPEN interior of r. */
function vBlocked(x: number, y1: number, y2: number, r: DepRect): boolean {
  const [a, b] = y1 <= y2 ? [y1, y2] : [y2, y1]
  return x > r.x + DEP_EPS && x < r.x + r.w - DEP_EPS && b > r.y + DEP_EPS && a < r.y + r.h - DEP_EPS
}

function segBlocked(a: DepPoint, b: DepPoint, obstacles: DepRect[]): boolean {
  if (Math.abs(a.x - b.x) <= DEP_EPS) return obstacles.some(r => vBlocked(a.x, a.y, b.y, r))
  return obstacles.some(r => hBlocked(a.y, a.x, b.x, r))
}

/** Row bands in top-to-bottom order. Section headers, section gaps, and row
 *  gaps are all gutter space between bands — free of bars by construction. */
function depBands(rows: GanttRowLayout[]): DepBand[] {
  return rows.map(r => ({ y: r.y, h: r.h })).sort((a, b) => a.y - b.y)
}

function depBandIndexAt(bands: DepBand[], y: number): number {
  return bands.findIndex(b => y >= b.y - DEP_EPS && y <= b.y + b.h + DEP_EPS)
}

/** Midline of the gutter below band i (below the last band: down to the plot
 *  edge, which the trailing section gap keeps strictly below the band). */
function gutterBelow(bands: DepBand[], i: number, plot: DepPlot): number {
  const bottom = bands[i]!.y + bands[i]!.h
  const next = i + 1 < bands.length ? bands[i + 1]!.y : plot.y + plot.h
  return (bottom + next) / 2
}

function gutterAbove(bands: DepBand[], i: number, plot: DepPlot): number {
  const top = bands[i]!.y
  const prev = i > 0 ? bands[i - 1]!.y + bands[i - 1]!.h : plot.y
  return (prev + top) / 2
}

/** A crossing column for `band` clear of every bar interior: nearest candidate
 *  to targetX among obstacle flanks and the always-clear escape corridor. */
function clearCrossingX(band: DepBand, obstacles: DepRect[], plot: DepPlot, targetX: number): number {
  const S = GANTT_DEP_STUB
  const lo = plot.x - S
  const hi = plot.x + plot.w + S
  const inBand = obstacles.filter(r => r.y < band.y + band.h - DEP_EPS && r.y + r.h > band.y + DEP_EPS)
  const cands = new Set<number>([lo])
  for (const r of inBand) {
    cands.add(Math.max(lo, Math.min(hi, r.x - S)))
    cands.add(Math.max(lo, Math.min(hi, r.x + r.w + S)))
  }
  let best = lo
  let bestScore = Infinity
  for (const x of cands) {
    if (inBand.some(r => vBlocked(x, band.y - 1, band.y + band.h + 1, r))) continue
    const score = Math.abs(x - targetX)
    if (score < bestScore - DEP_EPS || (Math.abs(score - bestScore) <= DEP_EPS && x < best)) {
      best = x
      bestScore = score
    }
  }
  return best
}

/** Drop duplicate points and merge collinear runs (the emitted polyline is
 *  exactly what the final blocked-validation checks). */
function compactDepPoints(points: DepPoint[]): DepPoint[] {
  const out: DepPoint[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) <= DEP_EPS && Math.abs(last.y - p.y) <= DEP_EPS) continue
    out.push({ x: p.x, y: p.y })
    const n = out.length
    if (n >= 3) {
      const a = out[n - 3]!
      const b = out[n - 2]!
      const c = out[n - 1]!
      if ((Math.abs(a.x - b.x) <= DEP_EPS && Math.abs(b.x - c.x) <= DEP_EPS)
        || (Math.abs(a.y - b.y) <= DEP_EPS && Math.abs(b.y - c.y) <= DEP_EPS)) {
        out.splice(n - 2, 1)
      }
    }
  }
  return out
}

function routeDependency(
  from: DepAnchor,
  to: DepAnchor,
  obstacles: DepRect[],
  bands: DepBand[],
  plot: DepPlot,
): { points: DepPoint[]; arrowDir: 'right' | 'down' | 'up' } | null {
  const S = GANTT_DEP_STUB
  const fr = from.rect
  const tr = to.rect
  const sy = fr.y + fr.h / 2
  const ey = tr.y + tr.h / 2
  const fromBand = depBandIndexAt(bands, sy)
  const toBand = depBandIndexAt(bands, ey)
  if (fromBand === -1 || toBand === -1) return null

  const sameBand = fromBand === toBand
  const down = sameBand || toBand > fromBand // same-band routes dip through the gutter below
  const exitGutterY = down ? gutterBelow(bands, fromBand, plot) : gutterAbove(bands, fromBand, plot)
  const entryGutterY = sameBand
    ? exitGutterY
    : down ? gutterAbove(bands, toBand, plot) : gutterBelow(bands, toBand, plot)

  const points: DepPoint[] = []

  // Exit: side stub off the bar end at row center; if a compact lane-mate
  // blocks it, drop straight from the bar's own top/bottom edge instead
  // (the bar's own footprint cannot be blocked).
  const sxRight = fr.x + fr.w
  const sideExit: DepPoint[] = [
    { x: sxRight, y: sy },
    { x: sxRight + S, y: sy },
    { x: sxRight + S, y: exitGutterY },
  ]
  if (!segBlocked(sideExit[0]!, sideExit[1]!, obstacles) && !segBlocked(sideExit[1]!, sideExit[2]!, obstacles)) {
    points.push(...sideExit)
  } else {
    const exitX = from.tipX ?? (fr.w >= 2 * S ? sxRight - S : fr.x + fr.w / 2)
    points.push({ x: exitX, y: down ? fr.y + fr.h : fr.y }, { x: exitX, y: exitGutterY })
  }

  // Traverse: cross each band between the two gutters, jogging inside the
  // preceding gutter to a proven-clear column when the current one is blocked.
  let curX = points[points.length - 1]!.x
  const targetX = tr.x - S
  if (!sameBand) {
    const step = down ? 1 : -1
    for (let b = fromBand + step; b !== toBand; b += step) {
      const band = bands[b]!
      if (obstacles.some(r => vBlocked(curX, band.y - 1, band.y + band.h + 1, r))) {
        const gutterBeforeY = down ? gutterAbove(bands, b, plot) : gutterBelow(bands, b, plot)
        const newX = clearCrossingX(band, obstacles, plot, targetX)
        points.push({ x: curX, y: gutterBeforeY }, { x: newX, y: gutterBeforeY })
        curX = newX
      }
    }
  }

  // Entry: horizontal arrow into the successor's start at row center; if the
  // approach column is blocked (flush chains, compact lane-mates), enter the
  // successor's own top/bottom edge instead — its footprint cannot be blocked.
  const entryX = tr.x - S
  const sideEntry: DepPoint[] = [
    { x: entryX, y: entryGutterY },
    { x: entryX, y: ey },
    { x: tr.x, y: ey },
  ]
  let arrowDir: 'right' | 'down' | 'up'
  let entryPts: DepPoint[]
  if (!segBlocked(sideEntry[0]!, sideEntry[1]!, obstacles) && !segBlocked(sideEntry[1]!, sideEntry[2]!, obstacles)) {
    entryPts = sideEntry
    arrowDir = 'right'
  } else {
    const enterX = to.tipX ?? (tr.w >= 2 * S ? tr.x + S : tr.x + tr.w / 2)
    const fromAbove = entryGutterY < tr.y
    entryPts = [{ x: enterX, y: entryGutterY }, { x: enterX, y: fromAbove ? tr.y : tr.y + tr.h }]
    arrowDir = fromAbove ? 'down' : 'up'
  }
  points.push({ x: curX, y: entryGutterY }, ...entryPts)

  const compacted = compactDepPoints(points)
  // Belt-and-braces: a route crossing any bar interior is unrepresentable in
  // the output — skip the connector rather than draw the violation.
  for (let i = 1; i < compacted.length; i++) {
    if (segBlocked(compacted[i - 1]!, compacted[i]!, obstacles)) return null
  }
  return { points: compacted, arrowDir }
}

function routeGanttDependencies(
  model: GanttModel,
  schedule: GanttSchedule,
  bars: GanttBarLayout[],
  rows: GanttRowLayout[],
  plot: DepPlot,
): GanttDependencyLayout[] {
  const edges = ganttDependencyEdges(model)
  if (edges.length === 0) return []
  const barByTask = new Map(bars.map(b => [b.taskIndex, b]))
  const obstacles = bars.map(depBarRect)
  const bands = depBands(rows)
  const critIds = new Set(schedule.analysis?.criticalPathTaskIds ?? [])
  const out: GanttDependencyLayout[] = []
  for (const edge of edges) {
    const fb = barByTask.get(edge.from)
    const tb = barByTask.get(edge.to)
    if (!fb || !tb) continue // vert tasks render as markers, not bars — nothing to anchor
    const route = routeDependency(
      { rect: depBarRect(fb), tipX: fb.milestoneX },
      { rect: depBarRect(tb), tipX: tb.milestoneX },
      obstacles, bands, plot,
    )
    if (!route) continue
    const fromTask = schedule.tasks[edge.from]!
    const toTask = schedule.tasks[edge.to]!
    // A connector is critical when it is a BINDING after-edge between two
    // critical-path tasks: the successor starts exactly at this predecessor's
    // end (with several `after` refs only the latest end binds).
    const critical = edge.kind === 'after'
      && fromTask.id !== undefined && toTask.id !== undefined
      && critIds.has(fromTask.id) && critIds.has(toTask.id)
      && fromTask.end === toTask.start
    out.push({
      fromTaskIndex: edge.from, toTaskIndex: edge.to, kind: edge.kind,
      critical, points: route.points, arrowDir: route.arrowDir,
    })
  }
  return out
}

/** A column label wrapped to the budget: transformed display lines plus the
 *  widest measured line. Single-line results keep `lines.length === 1` and the
 *  exact pre-wrap measurement, so unwrapped charts stay byte-identical. */
interface WrappedColumnLabel { lines: string[]; width: number }

function wrapColumnLabel(
  raw: string,
  transform: ResolvedRenderStyle['nodeTextTransform'],
  fontSize: number,
  fontWeight: number,
  letterSpacing: number,
): WrappedColumnLabel {
  const label = applyTextTransform(raw, transform)
  const width = ganttMeasureTextWidth(label, fontSize, fontWeight, letterSpacing)
  if (width <= GANTT_LABEL_WRAP_BUDGET) return { lines: [label], width }
  // Shared wrap machinery (measured pixels, grapheme-safe CJK breaks). It
  // measures without letter-spacing; non-zero tracking can overshoot the
  // budget by a few px, which the labelGap margin absorbs.
  const lines = wrapLabelToWidth(label, GANTT_LABEL_WRAP_BUDGET, fontSize, fontWeight).split('\n')
  return {
    lines,
    width: Math.max(...lines.map(l => ganttMeasureTextWidth(l, fontSize, fontWeight, letterSpacing))),
  }
}

export function layoutGantt(model: GanttModel, schedule: GanttSchedule, options: GanttLayoutOptions = {}): GanttLayoutResult {
  const style = resolveGanttRenderStyle(options.renderOptions)
  const compact = options.compact ?? (model.displayMode === 'compact')
  const barHeight = options.barHeight ?? model.barHeight ?? GL.barHeight
  const rowH = ganttRowHeight(style, barHeight)

  const vertTasks = schedule.tasks.filter(t => t.tags.includes('vert'))
  const rowTasks = schedule.tasks.filter(t => !t.tags.includes('vert'))

  // ---- label column ---------------------------------------------------------
  // Standard mode wraps task labels to the column budget (item 5); compact
  // mode keeps single-line labels because they sit BESIDE bars in the plot,
  // not in the column. Section headers live in the column in both modes.
  const taskWraps = new Map<number, WrappedColumnLabel>()
  const sectionWraps = new Map<number, WrappedColumnLabel>()
  let labelColumnWidth = 0
  for (const t of rowTasks) {
    if (compact) {
      const label = applyTextTransform(t.label, style.nodeTextTransform)
      labelColumnWidth = Math.max(labelColumnWidth, ganttMeasureTextWidth(label, style.nodeLabelFontSize, style.nodeLabelFontWeight, style.nodeLetterSpacing))
    } else {
      const wrapped = wrapColumnLabel(t.label, style.nodeTextTransform, style.nodeLabelFontSize, style.nodeLabelFontWeight, style.nodeLetterSpacing)
      taskWraps.set(t.index, wrapped)
      labelColumnWidth = Math.max(labelColumnWidth, wrapped.width)
    }
  }
  for (let si = 0; si < model.sections.length; si++) {
    const s = model.sections[si]!
    if (s.label) {
      const wrapped = wrapColumnLabel(s.label, style.groupTextTransform, style.groupHeaderFontSize, style.groupHeaderFontWeight, style.groupLetterSpacing)
      sectionWraps.set(si, wrapped)
      labelColumnWidth = Math.max(labelColumnWidth, wrapped.width)
    }
  }
  labelColumnWidth = Math.ceil(labelColumnWidth) + GL.labelGap

  const width = options.width ?? (GL.padding * 2 + labelColumnWidth + GL.plotWidth)
  const plotX = GL.padding + labelColumnWidth
  const plotW = Math.max(120, width - plotX - GL.padding)

  const titleH = model.title ? ganttTitleHeight(style) : 0
  const axisH = ganttAxisHeight(style)
  const topAxisH = model.topAxis ? axisH : 0
  const plotY = GL.padding + titleH + topAxisH

  const span = schedule.timeMax - schedule.timeMin
  const xOf = (t: EpochMs): number => plotX + ((t - schedule.timeMin) / span) * plotW

  // ---- rows + bars (vert tasks never consume a row) --------------------------
  const bars: GanttBarLayout[] = []
  const rows: GanttRowLayout[] = []
  const sections: GanttSectionBand[] = []
  let y = plotY

  // Label-aware row advance (item 5): a wrapped label draws its first line at
  // the bar's vertical center and the rest below, so the row must advance far
  // enough for the block to clear the next row. Single-line rows keep the
  // uniform rowH by construction (bh/2 + lh/2 <= max(bh, lh) always).
  const rowAdvance = (lineCount: number, lineHeight: number): number =>
    lineCount <= 1 ? rowH : Math.max(rowH, Math.ceil(barHeight / 2 + (lineCount - 0.5) * lineHeight) + GL.rowGap)
  const taskLineHeight = style.nodeLabelFontSize * 1.3
  const sectionLineHeight = style.groupHeaderFontSize * 1.3

  for (let si = 0; si < model.sections.length; si++) {
    const section = model.sections[si]!
    const sectionTasks = rowTasks.filter(t => t.sectionIndex === si)
    if (sectionTasks.length === 0 && section.label === undefined) continue
    // Bars/rows reference the BAND index in the emitted sections array (empty
    // implicit sections are skipped, so it can differ from the model index).
    const bandIndex = sections.length
    const bandStartY = y
    const rowStart = rows.length
    const sectionLines = sectionWraps.get(si)?.lines
    if (section.label !== undefined) y += rowAdvance(sectionLines?.length ?? 1, sectionLineHeight)

    const lanes = compact ? packCompactLanes(sectionTasks) : sectionTasks.map((_, i) => i)
    const laneCount = sectionTasks.length === 0 ? 0 : Math.max(...lanes) + 1
    const laneRows: GanttRowLayout[] = []
    if (compact) {
      for (let li = 0; li < laneCount; li++) {
        laneRows.push({ barIndexes: [], sectionIndex: bandIndex, y: y + li * rowH, h: barHeight })
      }
    } else {
      // Standard mode: one row per task, advanced by its wrapped label height.
      let rowY = y
      for (const t of sectionTasks) {
        laneRows.push({ barIndexes: [], sectionIndex: bandIndex, y: rowY, h: barHeight })
        rowY += rowAdvance(taskWraps.get(t.index)?.lines.length ?? 1, taskLineHeight)
      }
    }
    sectionTasks.forEach((t, i) => {
      const lane = lanes[i]!
      const row = laneRows[lane]!
      const x = xOf(t.start)
      // Bars draw to renderEnd (the upstream renderEndTime split): trailing
      // excluded days belong to the chain, not the bar.
      const w = Math.max(t.renderEnd > t.start ? 2 : 0, xOf(t.renderEnd) - x)
      const isMilestone = t.tags.includes('milestone')
      // Milestone diamonds extend ±barHeight/2 around their center; clamp the
      // center so a milestone at the range edge stays inside the plot band
      // (the ASCII renderer clamps its grid column the same way — issue #26:
      // shared geometry, not per-renderer patch-ups).
      let milestoneX: number | undefined
      if (isMilestone) {
        const r = barHeight / 2
        const lo = plotX + r
        const hi = Math.max(lo, plotX + plotW - r)
        milestoneX = Math.min(hi, Math.max(lo, x + w / 2))
      }
      const taskLines = taskWraps.get(t.index)?.lines
      bars.push({
        taskIndex: t.index, id: t.id, label: t.label, tags: t.tags, sectionIndex: bandIndex,
        x, y: row.y, w, h: barHeight,
        milestoneX,
        rowIndex: rowStart + (section.label !== undefined ? 1 : 0) + lane,
        start: t.start, end: t.renderEnd,
        ...(taskLines && taskLines.length > 1 ? { labelLines: taskLines } : {}),
      })
      row.barIndexes.push(bars.length - 1)
    })
    rows.push(...laneRows)
    if (compact) {
      y += laneCount * rowH
    } else {
      for (const t of sectionTasks) y += rowAdvance(taskWraps.get(t.index)?.lines.length ?? 1, taskLineHeight)
    }
    sections.push({
      label: section.label, y: bandStartY, h: y - bandStartY,
      rowStart, rowEnd: rows.length,
      ...(sectionLines && sectionLines.length > 1 ? { labelLines: sectionLines } : {}),
    })
    y += GL.sectionGap
  }

  const plotH = Math.max(rowH, y - plotY)
  const height = plotY + plotH + axisH + GL.padding

  // ---- ticks / markers --------------------------------------------------------
  const ticks: GanttTick[] = resolveTicks(schedule, model).map(t => ({
    time: t.time, x: xOf(t.time), label: t.label,
  }))

  const verts: GanttVertLayout[] = vertTasks.map(t => ({
    taskIndex: t.index, label: t.label,
    x: xOf(t.start + (t.renderEnd - t.start) / 2), time: t.start,
  }))

  const todayX = options.today !== undefined && options.today >= schedule.timeMin && options.today <= schedule.timeMax
    ? xOf(options.today)
    : undefined

  // ---- excluded-day shading bands (item 2; default-on, upstream parity) -----
  // One calendar, two consumers: the SAME isExcludedDay predicate that drives
  // the scheduler's duration walk paints the plot. Day shading only has
  // meaning on date-only charts; consecutive excluded days merge into one
  // band, clipped to the visible range.
  const excludedBands: GanttExcludedBand[] = []
  if (model.excludes.length > 0 && schedule.dateOnly
    && (schedule.timeMax - startOfDay(schedule.timeMin)) / DAY_MS <= GANTT_MAX_SHADED_DAYS) {
    let runStart: EpochMs | undefined
    const flush = (runEnd: EpochMs): void => {
      if (runStart === undefined) return
      const s = Math.max(runStart, schedule.timeMin)
      const e = Math.min(runEnd, schedule.timeMax)
      if (e > s) excludedBands.push({ x: xOf(s), w: xOf(e) - xOf(s), start: s, end: e })
      runStart = undefined
    }
    for (let day = startOfDay(schedule.timeMin); day < schedule.timeMax; day += DAY_MS) {
      if (schedule.isExcludedDay(day)) {
        if (runStart === undefined) runStart = day
      } else {
        flush(day)
      }
    }
    flush(schedule.timeMax)
  }

  const critIds = new Set(schedule.analysis?.criticalPathTaskIds ?? [])
  const criticalTaskIndexes = schedule.tasks
    .filter(t => t.id !== undefined && critIds.has(t.id))
    .map(t => t.index)
  const dependencies = routeGanttDependencies(model, schedule, bars, rows, { x: plotX, y: plotY, w: plotW, h: plotH })

  return {
    title: model.title,
    width, height,
    plot: { x: plotX, y: plotY, w: plotW, h: plotH },
    labelColumnWidth,
    rows, sections, bars, verts, ticks,
    dependencies, criticalTaskIndexes,
    excludedBands,
    topAxis: model.topAxis,
    todayX,
    ...(model.todayMarker?.style !== undefined ? { todayMarkerStyle: model.todayMarker.style } : {}),
    timeMin: schedule.timeMin, timeMax: schedule.timeMax,
    dateOnly: schedule.dateOnly,
    compact, barHeight,
  }
}
