// ============================================================================
// Gantt calendar + dependency resolver (docs/design/families/gantt.md §3).
//
// Pure and deterministic: no DOM, no SVG, no wall clock. All instants are
// integer milliseconds since the Unix epoch, UTC (EpochMs). Date-only
// diagrams operate on midnight-UTC instants, which sidesteps DST/timezone
// bugs (mermaid #7026) because UTC has neither.
//
// Renderers never compute dates: they receive resolved ScheduledGanttTask
// intervals, markers, and a day-exclusion predicate from this module.
//
// Scheduling rules (from the spec):
//   - source order is the tie-breaker; an omitted start means "previous
//     task's end" (first task must have an explicit start — no wall-clock
//     fallback, unlike Mermaid);
//   - `after id1 id2` starts at the latest referenced end;
//   - `until id1 id2` ends at the earliest referenced start;
//   - explicit end dates are respected (excludes never shrink or extend
//     them); working durations extend over excluded days;
//   - `includes` overrides `excludes` for explicit dates;
//   - dependency cycles are structured errors naming the cycle;
//   - iteration counts are bounded (GANTT_SCHEDULE_OVERFLOW), never infinite.
// ============================================================================

import type {
  GanttModel, GanttModelTask, GanttCalendar, GanttClock, GanttSchedule,
  GanttScheduleAnalysis, ScheduledGanttTask, GanttCalendarToken, GanttWeekday,
  EpochMs,
} from './types.ts'
import { GanttError } from './types.ts'
import { GANTT_DURATION_RE } from './parser.ts'

export const DAY_MS = 86_400_000
const MAX_CALENDAR_STEPS = 10_000

// ---- Pure date arithmetic ---------------------------------------------------

/** Days since epoch for the UTC day containing `ms`. */
export function epochDay(ms: EpochMs): number {
  return Math.floor(ms / DAY_MS)
}

/** Midnight UTC of the day containing `ms`. */
export function startOfDay(ms: EpochMs): EpochMs {
  return epochDay(ms) * DAY_MS
}

/** Day-of-week for a UTC instant: 0 = sunday … 6 = saturday. */
export function dayOfWeek(ms: EpochMs): number {
  // 1970-01-01 was a Thursday (= 4).
  return (((epochDay(ms) + 4) % 7) + 7) % 7
}

export const WEEKDAY_INDEX: Record<GanttWeekday, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

function utcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, msec = 0): EpochMs | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
  const t = Date.UTC(year, month - 1, day, hour, minute, second, msec)
  // Reject calendar-invalid dates (e.g. Feb 30) that Date.UTC silently rolls over.
  const d = new Date(t)
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return t
}

interface DateFormatToken { kind: 'field'; field: string }
interface LiteralToken { kind: 'literal'; text: string }

const DATE_FIELD_TOKENS = ['YYYY', 'YY', 'MM', 'M', 'DD', 'D', 'HH', 'H', 'mm', 'm', 'ss', 's', 'SSS', 'X', 'x'] as const
const TIME_FIELDS = new Set(['HH', 'H', 'mm', 'm', 'ss', 's', 'SSS', 'X', 'x'])

function tokenizeDateFormat(format: string): Array<DateFormatToken | LiteralToken> {
  const tokens: Array<DateFormatToken | LiteralToken> = []
  let i = 0
  outer: while (i < format.length) {
    for (const field of DATE_FIELD_TOKENS) {
      if (format.startsWith(field, i)) {
        tokens.push({ kind: 'field', field })
        i += field.length
        continue outer
      }
    }
    tokens.push({ kind: 'literal', text: format[i]! })
    i++
  }
  return tokens
}

/** True when the dateFormat carries no time-of-day fields. */
export function isDateOnlyFormat(format: string): boolean {
  return !tokenizeDateFormat(format).some(t => t.kind === 'field' && TIME_FIELDS.has(t.field))
}

/**
 * Parse a date string against a Mermaid/dayjs-style dateFormat (subset:
 * YYYY YY MM M DD D HH H mm m ss s SSS X x plus literal separators).
 * Returns null when the string does not match or is calendar-invalid.
 */
export function parseGanttDate(raw: string, format: string): EpochMs | null {
  const tokens = tokenizeDateFormat(format)
  let pos = 0
  const fields: Record<string, number> = {}
  const readDigits = (min: number, max: number): number | null => {
    let len = 0
    while (len < max && pos + len < raw.length && raw[pos + len]! >= '0' && raw[pos + len]! <= '9') len++
    if (len < min) return null
    const n = Number(raw.slice(pos, pos + len))
    pos += len
    return n
  }
  for (const t of tokens) {
    if (t.kind === 'literal') {
      if (raw[pos] !== t.text) return null
      pos++
      continue
    }
    switch (t.field) {
      case 'YYYY': { const n = readDigits(4, 4); if (n === null) return null; fields.year = n; break }
      case 'YY': { const n = readDigits(2, 2); if (n === null) return null; fields.year = 2000 + n; break }
      case 'MM': { const n = readDigits(2, 2); if (n === null) return null; fields.month = n; break }
      case 'M': { const n = readDigits(1, 2); if (n === null) return null; fields.month = n; break }
      case 'DD': { const n = readDigits(2, 2); if (n === null) return null; fields.day = n; break }
      case 'D': { const n = readDigits(1, 2); if (n === null) return null; fields.day = n; break }
      case 'HH': { const n = readDigits(2, 2); if (n === null) return null; fields.hour = n; break }
      case 'H': { const n = readDigits(1, 2); if (n === null) return null; fields.hour = n; break }
      case 'mm': { const n = readDigits(2, 2); if (n === null) return null; fields.minute = n; break }
      case 'm': { const n = readDigits(1, 2); if (n === null) return null; fields.minute = n; break }
      case 'ss': { const n = readDigits(2, 2); if (n === null) return null; fields.second = n; break }
      case 's': { const n = readDigits(1, 2); if (n === null) return null; fields.second = n; break }
      case 'SSS': { const n = readDigits(3, 3); if (n === null) return null; fields.msec = n; break }
      case 'X': { const n = readDigits(1, 11); if (n === null) return null; fields.unix = n; break }
      case 'x': { const n = readDigits(1, 14); if (n === null) return null; fields.unixMs = n; break }
    }
  }
  if (pos !== raw.length) return null
  if (fields.unixMs !== undefined) return fields.unixMs
  if (fields.unix !== undefined) return fields.unix * 1000
  // Formats without date components (e.g. `dateFormat HH:mm` in the Mermaid
  // docs milestone example) anchor to the Unix epoch — dayjs would anchor to
  // wall-clock "today", which this pipeline forbids. Deterministic and
  // invisible when the axis format only shows times.
  return utcMs(fields.year ?? 1970, fields.month ?? 1, fields.day ?? 1, fields.hour ?? 0, fields.minute ?? 0, fields.second ?? 0, fields.msec ?? 0)
}

const DURATION_UNIT_MS: Record<string, number> = {
  ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: DAY_MS, w: 7 * DAY_MS,
}

/**
 * Add a Mermaid duration token to an instant. `M` (months) and `y` (years)
 * use real calendar arithmetic (clamped to the target month's last day);
 * everything else is a fixed millisecond span.
 */
export function addGanttDuration(start: EpochMs, raw: string): EpochMs | null {
  const m = raw.match(GANTT_DURATION_RE)
  if (!m) return null
  const count = Number(m[1])
  const unit = m[2]!
  if (!Number.isFinite(count)) return null
  if (unit === 'M' || unit === 'y') {
    const months = unit === 'y' ? count * 12 : count
    const whole = Math.trunc(months)
    const frac = months - whole
    const d = new Date(start)
    const targetMonth = d.getUTCMonth() + whole
    const target = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()))
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
    target.setUTCDate(Math.min(d.getUTCDate(), lastDay))
    let t = target.getTime()
    if (frac > 0) t += Math.round(frac * 30 * DAY_MS) // fractional months: 30-day convention
    return t
  }
  return start + Math.round(count * DURATION_UNIT_MS[unit]!)
}

// ---- Calendar ---------------------------------------------------------------

export function calendarFromModel(model: GanttModel): GanttCalendar {
  return {
    dateFormat: model.dateFormat,
    inclusiveEndDates: model.inclusiveEndDates,
    excludes: model.excludes,
    includes: model.includes,
    weekendStart: model.weekendStart,
    weekStart: model.weekStart,
  }
}

function resolveCalendarDays(tokens: GanttCalendarToken[], calendar: GanttCalendar): { days: Set<number>; weekdays: Set<number>; weekends: boolean } {
  const days = new Set<number>()
  const weekdays = new Set<number>()
  let weekends = false
  for (const tok of tokens) {
    if (tok.kind === 'weekends') { weekends = true; continue }
    if (tok.kind === 'weekday') { weekdays.add(WEEKDAY_INDEX[tok.day]); continue }
    const parsed = parseGanttDate(tok.raw, calendar.dateFormat) ?? parseGanttDate(tok.raw, 'YYYY-MM-DD')
    if (parsed === null) {
      throw new GanttError('GANTT_BAD_DATE', `Invalid calendar date "${tok.raw}" for dateFormat "${calendar.dateFormat}"`)
    }
    days.add(epochDay(parsed))
  }
  return { days, weekdays, weekends }
}

/**
 * Build the day-exclusion predicate: a UTC day is excluded when it matches an
 * `excludes` token and is not explicitly re-included via `includes`.
 */
export function buildExclusionPredicate(calendar: GanttCalendar): (dayStartMs: EpochMs) => boolean {
  const ex = resolveCalendarDays(calendar.excludes, calendar)
  const inc = resolveCalendarDays(calendar.includes, calendar)
  const weekendDays: number[] = calendar.weekendStart === 'friday' ? [5, 6] : [6, 0]
  return (dayStartMs: EpochMs): boolean => {
    const day = epochDay(dayStartMs)
    const dow = dayOfWeek(dayStartMs)
    const included = inc.days.has(day) || inc.weekdays.has(dow) || (inc.weekends && weekendDays.includes(dow))
    if (included) return false
    if (ex.days.has(day)) return true
    if (ex.weekdays.has(dow)) return true
    if (ex.weekends && weekendDays.includes(dow)) return true
    return false
  }
}

/**
 * Extend a duration-derived end over excluded days — upstream-exact mirror of
 * Mermaid's `fixTaskDates` (adopted 2026-07, family-elevation-plan §Gantt
 * item 6, retiring the `exclude-boundary-model` bench ledger entries): the
 * cursor starts one day AFTER the task start and each excluded day it meets
 * in (start, end] pushes the end out one day — a task STARTING on an excluded
 * day gets that day free. `renderEnd` tracks upstream's `renderEndTime`: the
 * end value last observed while the walk was on working days, so a trailing
 * excluded run extends the chain end without stretching the drawn bar.
 * Explicit (manual) end dates never pass through this. Bounded by
 * MAX_CALENDAR_STEPS.
 */
function extendOverExcludedDays(
  start: EpochMs,
  end: EpochMs,
  isExcluded: (d: EpochMs) => boolean,
  line?: number,
): { end: EpochMs; renderEnd: EpochMs } {
  let cursor = start + DAY_MS
  let result = end
  let renderEnd = end
  let invalid = false
  let steps = 0
  while (cursor <= result) {
    if (++steps > MAX_CALENDAR_STEPS) {
      throw new GanttError('GANTT_SCHEDULE_OVERFLOW', `Calendar exclusion walk exceeded ${MAX_CALENDAR_STEPS} days (is every day excluded?)`, line)
    }
    if (!invalid) renderEnd = result
    invalid = isExcluded(cursor)
    if (invalid) result += DAY_MS
    cursor += DAY_MS
  }
  return { end: result, renderEnd }
}

// ---- Resolver ---------------------------------------------------------------

interface DependencyEdge { from: number; to: number }

function dependencyIndexes(task: GanttModelTask, byId: Map<string, GanttModelTask>, prev: GanttModelTask | undefined): number[] {
  const deps: number[] = []
  // Implicit start chains from the previous task's end.
  if (task.start === undefined && prev) deps.push(prev.index)
  if (task.start?.kind === 'after') {
    for (const ref of task.start.refs) {
      const t = byId.get(ref)
      if (!t) throw new GanttError('GANTT_UNKNOWN_TASK_REF', `Task "${task.label}" starts after unknown id "${ref}"`, task.line)
      deps.push(t.index)
    }
  }
  if (task.end.kind === 'until') {
    for (const ref of task.end.refs) {
      const t = byId.get(ref)
      if (!t) throw new GanttError('GANTT_UNKNOWN_TASK_REF', `Task "${task.label}" runs until unknown id "${ref}"`, task.line)
      deps.push(t.index)
    }
  }
  return deps
}

function detectCycle(n: number, depsOf: number[][], labelOf: (i: number) => string): void {
  const state = new Array<0 | 1 | 2>(n).fill(0)
  const stack: number[] = []
  const visit = (i: number): void => {
    state[i] = 1
    stack.push(i)
    for (const d of depsOf[i]!) {
      if (state[d] === 0) visit(d)
      else if (state[d] === 1) {
        const cycleStart = stack.indexOf(d)
        const names = stack.slice(cycleStart).concat(d).map(labelOf)
        throw new GanttError('GANTT_DEPENDENCY_CYCLE', `Dependency cycle: ${names.join(' -> ')}`)
      }
    }
    stack.pop()
    state[i] = 2
  }
  for (let i = 0; i < n; i++) if (state[i] === 0) visit(i)
}

/**
 * Resolve every task interval. Throws GanttError (unknown refs, cycles,
 * invalid dates/durations, missing first start) rather than falling back to
 * wall-clock dates the way Mermaid does.
 */
export function resolveGanttSchedule(model: GanttModel, clock: GanttClock = {}): GanttSchedule {
  const calendar = calendarFromModel(model)
  const isExcludedDay = buildExclusionPredicate(calendar)
  const dateOnly = isDateOnlyFormat(model.dateFormat)

  const byId = new Map<string, GanttModelTask>()
  for (const t of model.tasks) {
    if (t.id !== undefined) byId.set(t.id, t) // duplicates already rejected by the parser
  }

  const depsOf = model.tasks.map((t, i) => dependencyIndexes(t, byId, model.tasks[i - 1]))
  detectCycle(model.tasks.length, depsOf, i => model.tasks[i]!.id ?? model.tasks[i]!.label)

  // Topological resolution. Cycles are gone, so source-order passes terminate;
  // the bound is belt-and-braces against resolver bugs.
  const resolved = new Array<ScheduledGanttTask | undefined>(model.tasks.length)
  const resolveTask = (task: GanttModelTask): ScheduledGanttTask => {
    if (resolved[task.index]) return resolved[task.index]!
    for (const d of depsOf[task.index]!) if (!resolved[d]) resolveTask(model.tasks[d]!)

    // -- start
    let start: EpochMs
    if (task.start === undefined) {
      const prev = task.index > 0 ? resolved[task.index - 1] : undefined
      if (!prev) {
        throw new GanttError('GANTT_NO_START', `Task "${task.label}" has no start date and no previous task to follow`, task.line)
      }
      start = prev.end
    } else if (task.start.kind === 'after') {
      start = Math.max(...task.start.refs.map(r => resolved[byId.get(r)!.index]!.end))
    } else {
      const parsed = parseGanttDate(task.start.raw, model.dateFormat)
      if (parsed === null) {
        throw new GanttError('GANTT_BAD_DATE', `Invalid start date "${task.start.raw}" for dateFormat "${model.dateFormat}"`, task.line)
      }
      start = parsed
    }

    // -- end
    let end: EpochMs
    let manualEnd = false
    if (task.end.kind === 'until') {
      end = Math.min(...task.end.refs.map(r => resolved[byId.get(r)!.index]!.start))
      manualEnd = true
    } else if (task.end.kind === 'duration') {
      const added = addGanttDuration(start, task.end.raw)
      if (added === null) {
        throw new GanttError('GANTT_BAD_DURATION', `Invalid duration "${task.end.raw}"`, task.line)
      }
      end = added
    } else {
      const parsed = parseGanttDate(task.end.raw, model.dateFormat)
      if (parsed === null) {
        throw new GanttError('GANTT_BAD_DATE', `Invalid end date "${task.end.raw}" for dateFormat "${model.dateFormat}"`, task.line)
      }
      end = calendar.inclusiveEndDates && dateOnly ? parsed + DAY_MS : parsed
      manualEnd = true
    }

    let renderEnd = end
    if (!manualEnd && (calendar.excludes.length > 0)) {
      const fixed = extendOverExcludedDays(start, end, isExcludedDay, task.line)
      end = fixed.end
      renderEnd = fixed.renderEnd
    }
    if (end < start) end = start // zero-width is legal (milestones, until == start)
    if (renderEnd < start) renderEnd = start
    if (renderEnd > end) renderEnd = end

    const scheduled: ScheduledGanttTask = {
      index: task.index, id: task.id, label: task.label, tags: task.tags,
      sectionIndex: task.sectionIndex, start, end, renderEnd, manualEnd, line: task.line,
    }
    resolved[task.index] = scheduled
    return scheduled
  }
  for (const t of model.tasks) resolveTask(t)
  const tasks = resolved as ScheduledGanttTask[]

  if (tasks.length === 0) throw new GanttError('GANTT_EMPTY', 'Gantt diagram has no tasks')

  // The axis range covers every DRAWN extent (renderEnd) and every start.
  // A trailing-excluded chain end that nothing starts from would only pad the
  // axis with empty days; any successor's own start re-enters the range.
  let timeMin = Infinity
  let timeMax = -Infinity
  for (const t of tasks) {
    timeMin = Math.min(timeMin, t.start)
    timeMax = Math.max(timeMax, t.renderEnd)
  }
  if (timeMax === timeMin) timeMax = timeMin + (dateOnly ? DAY_MS : 3_600_000)

  let today: EpochMs | undefined
  if (clock.today !== undefined && !(model.todayMarker?.off)) {
    const parsed = parseGanttDate(clock.today, model.dateFormat) ?? parseGanttDate(clock.today, 'YYYY-MM-DD')
    if (parsed === null) {
      throw new GanttError('GANTT_BAD_DATE', `Invalid clock value "${clock.today}" for dateFormat "${model.dateFormat}"`)
    }
    today = parsed
  }

  return {
    tasks, timeMin, timeMax, dateOnly, today,
    analysis: analyzeSchedule(model, tasks, byId),
    isExcludedDay,
  }
}

// ---- Dependency edges (for the dependency-arrow overlay) ---------------------

export interface GanttDependencyEdgeRef {
  /** Model task indexes. */
  from: number
  to: number
  kind: 'after' | 'until'
}

/**
 * Every dependency reference as a directed edge over model task indexes, in
 * source order, deduplicated. `after` edges point ref → task (the task starts
 * from the referenced end); `until` edges point task → ref (the task's end
 * feeds the referenced start). Unknown refs are simply skipped here — the
 * resolver has already rejected them before any consumer runs.
 */
export function ganttDependencyEdges(model: GanttModel): GanttDependencyEdgeRef[] {
  const byId = new Map<string, GanttModelTask>()
  for (const t of model.tasks) if (t.id !== undefined) byId.set(t.id, t)
  const out: GanttDependencyEdgeRef[] = []
  const seen = new Set<string>()
  const push = (from: number, to: number, kind: 'after' | 'until'): void => {
    const key = `${from}>${to}:${kind}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ from, to, kind })
  }
  for (const t of model.tasks) {
    if (t.start?.kind === 'after') {
      for (const ref of t.start.refs) {
        const dep = byId.get(ref)
        if (dep) push(dep.index, t.index, 'after')
      }
    }
    if (t.end.kind === 'until') {
      for (const ref of t.end.refs) {
        const dep = byId.get(ref)
        if (dep) push(t.index, dep.index, 'until')
      }
    }
  }
  return out
}

// ---- Analysis (critical path / slack over `after` edges) --------------------

function analyzeSchedule(
  model: GanttModel,
  tasks: ScheduledGanttTask[],
  byId: Map<string, GanttModelTask>,
): GanttScheduleAnalysis | undefined {
  // Dependency edges considered for CPM: `after` references only. `until`
  // anchors an end to another task's start and has no forward slack
  // semantics; it still affects entry/sink classification below.
  const afterEdges: DependencyEdge[] = []
  const referenced = new Set<number>()
  for (const t of model.tasks) {
    if (t.start?.kind === 'after') {
      for (const ref of t.start.refs) {
        const dep = byId.get(ref)!
        afterEdges.push({ from: dep.index, to: t.index })
        referenced.add(dep.index)
      }
    }
    if (t.end.kind === 'until') for (const ref of t.end.refs) referenced.add(byId.get(ref)!.index)
  }
  if (afterEdges.length === 0) return undefined

  const projectStart = Math.min(...tasks.map(t => t.start))
  const projectEnd = Math.max(...tasks.map(t => t.end))

  // Backward pass: latestFinish(i) = min over successors of latestStart(succ);
  // tasks with no successors finish no later than projectEnd.
  const successors: number[][] = tasks.map(() => [])
  for (const e of afterEdges) successors[e.from]!.push(e.to)
  const latestFinish = new Array<number>(tasks.length).fill(Number.NaN)
  const computeLatest = (i: number): number => {
    if (!Number.isNaN(latestFinish[i]!)) return latestFinish[i]!
    const succ = successors[i]!
    let lf = projectEnd
    for (const s of succ) {
      const duration = tasks[s]!.end - tasks[s]!.start
      lf = Math.min(lf, computeLatest(s) - duration)
    }
    latestFinish[i] = lf
    return lf
  }
  for (let i = 0; i < tasks.length; i++) computeLatest(i)

  const slackByTaskId: Record<string, number> = {}
  const onAfterGraph = new Set<number>()
  for (const e of afterEdges) { onAfterGraph.add(e.from); onAfterGraph.add(e.to) }
  const criticalPathTaskIds: string[] = []
  for (const t of tasks) {
    const slack = latestFinish[t.index]! - t.end
    if (t.id !== undefined) slackByTaskId[t.id] = slack
    if (onAfterGraph.has(t.index) && slack === 0 && t.id !== undefined) criticalPathTaskIds.push(t.id)
  }

  const hasAfterDep = new Set(afterEdges.map(e => e.to))
  const entryTaskIds = tasks.filter(t => t.id !== undefined && !hasAfterDep.has(t.index)).map(t => t.id!)
  const sinkTaskIds = tasks.filter(t => t.id !== undefined && !referenced.has(t.index)).map(t => t.id!)

  return { criticalPathTaskIds, slackByTaskId, projectStart, projectEnd, entryTaskIds, sinkTaskIds }
}

// ---- Axis formatting ----------------------------------------------------------

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Format an instant with a d3-time-format subset (%Y %y %m %d %e %b %B %a %A
 * %H %I %M %S %L %p %j %W %U %%). Unknown specifiers pass through verbatim.
 * SVG and ASCII both format ticks through this, so the two outputs always
 * agree on the resolved tick instants.
 */
export function formatGanttInstant(ms: EpochMs, format: string): string {
  const d = new Date(ms)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const dayOfYear = (): number => {
    const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1)
    return Math.floor((ms - startOfYear) / DAY_MS) + 1
  }
  const weekOfYear = (firstDow: number): number => {
    const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1)
    const jan1Dow = dayOfWeek(jan1)
    const offset = (7 + jan1Dow - firstDow) % 7
    return Math.floor((dayOfYear() - 1 + offset) / 7)
  }
  let out = ''
  for (let i = 0; i < format.length; i++) {
    const ch = format[i]!
    if (ch !== '%') { out += ch; continue }
    const spec = format[++i]
    switch (spec) {
      case 'Y': out += String(d.getUTCFullYear()); break
      case 'y': out += pad(d.getUTCFullYear() % 100); break
      case 'm': out += pad(d.getUTCMonth() + 1); break
      case 'd': out += pad(d.getUTCDate()); break
      case 'e': out += String(d.getUTCDate()).padStart(2, ' '); break
      case 'b': out += MONTHS_SHORT[d.getUTCMonth()]!; break
      case 'B': out += MONTHS_LONG[d.getUTCMonth()]!; break
      case 'a': out += DAYS_SHORT[dayOfWeek(ms)]!; break
      case 'A': out += DAYS_LONG[dayOfWeek(ms)]!; break
      case 'H': out += pad(d.getUTCHours()); break
      case 'I': out += pad(((d.getUTCHours() + 11) % 12) + 1); break
      case 'M': out += pad(d.getUTCMinutes()); break
      case 'S': out += pad(d.getUTCSeconds()); break
      case 'L': out += pad(d.getUTCMilliseconds(), 3); break
      case 'p': out += d.getUTCHours() < 12 ? 'AM' : 'PM'; break
      case 'j': out += pad(dayOfYear(), 3); break
      case 'U': out += pad(weekOfYear(0)); break
      case 'W': out += pad(weekOfYear(1)); break
      case '%': out += '%'; break
      default: out += spec === undefined ? '%' : `%${spec}`
    }
  }
  return out
}
