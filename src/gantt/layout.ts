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
  GanttSectionBand, GanttVertLayout, GanttTick, GanttTickUnit, EpochMs,
} from './types.ts'
import { DAY_MS, dayOfWeek, WEEKDAY_INDEX, formatGanttInstant, startOfDay } from './schedule.ts'
import { applyTextTransform, estimateTextWidth, resolveRenderStyle, STROKE_WIDTHS } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'

export const GANTT_MAX_TICKS = 120

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

export function layoutGantt(model: GanttModel, schedule: GanttSchedule, options: GanttLayoutOptions = {}): GanttLayoutResult {
  const style = resolveGanttRenderStyle(options.renderOptions)
  const compact = options.compact ?? (model.displayMode === 'compact')
  const barHeight = options.barHeight ?? model.barHeight ?? GL.barHeight
  const rowH = ganttRowHeight(style, barHeight)

  const vertTasks = schedule.tasks.filter(t => t.tags.includes('vert'))
  const rowTasks = schedule.tasks.filter(t => !t.tags.includes('vert'))

  // ---- label column ---------------------------------------------------------
  let labelColumnWidth = 0
  for (const t of rowTasks) {
    const label = applyTextTransform(t.label, style.nodeTextTransform)
    labelColumnWidth = Math.max(labelColumnWidth, ganttMeasureTextWidth(label, style.nodeLabelFontSize, style.nodeLabelFontWeight, style.nodeLetterSpacing))
  }
  for (const s of model.sections) {
    if (s.label) {
      const label = applyTextTransform(s.label, style.groupTextTransform)
      labelColumnWidth = Math.max(labelColumnWidth, ganttMeasureTextWidth(label, style.groupHeaderFontSize, style.groupHeaderFontWeight, style.groupLetterSpacing))
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

  for (let si = 0; si < model.sections.length; si++) {
    const section = model.sections[si]!
    const sectionTasks = rowTasks.filter(t => t.sectionIndex === si)
    if (sectionTasks.length === 0 && section.label === undefined) continue
    // Bars/rows reference the BAND index in the emitted sections array (empty
    // implicit sections are skipped, so it can differ from the model index).
    const bandIndex = sections.length
    const bandStartY = y
    const rowStart = rows.length
    if (section.label !== undefined) y += rowH // the section header row

    const lanes = compact ? packCompactLanes(sectionTasks) : sectionTasks.map((_, i) => i)
    const laneCount = sectionTasks.length === 0 ? 0 : Math.max(...lanes) + 1
    const laneRows: GanttRowLayout[] = []
    for (let li = 0; li < laneCount; li++) {
      laneRows.push({ barIndexes: [], sectionIndex: bandIndex, y: y + li * rowH, h: barHeight })
    }
    sectionTasks.forEach((t, i) => {
      const lane = lanes[i]!
      const row = laneRows[lane]!
      const x = xOf(t.start)
      const w = Math.max(t.end > t.start ? 2 : 0, xOf(t.end) - x)
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
      bars.push({
        taskIndex: t.index, id: t.id, label: t.label, tags: t.tags, sectionIndex: bandIndex,
        x, y: row.y, w, h: barHeight,
        milestoneX,
        rowIndex: rowStart + (section.label !== undefined ? 1 : 0) + lane,
        start: t.start, end: t.end,
      })
      row.barIndexes.push(bars.length - 1)
    })
    rows.push(...laneRows)
    y += laneCount * rowH
    sections.push({
      label: section.label, y: bandStartY, h: y - bandStartY,
      rowStart, rowEnd: rows.length,
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
    x: xOf(t.start + (t.end - t.start) / 2), time: t.start,
  }))

  const todayX = options.today !== undefined && options.today >= schedule.timeMin && options.today <= schedule.timeMax
    ? xOf(options.today)
    : undefined

  return {
    title: model.title,
    width, height,
    plot: { x: plotX, y: plotY, w: plotW, h: plotH },
    labelColumnWidth,
    rows, sections, bars, verts, ticks,
    topAxis: model.topAxis,
    todayX,
    timeMin: schedule.timeMin, timeMax: schedule.timeMax,
    dateOnly: schedule.dateOnly,
    compact, barHeight,
  }
}
