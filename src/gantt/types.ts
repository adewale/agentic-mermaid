// ============================================================================
// Gantt diagram types — semantic model, calendar, schedule, layout.
//
// Implements docs/design/families/gantt.md (PR #24): the parser produces a source-
// faithful GanttModel; src/gantt/schedule.ts resolves dates/dependencies into
// a GanttSchedule; src/gantt/layout.ts turns the schedule into geometry shared
// by the SVG and ASCII renderers. Renderers never compute dates.
//
// Time representation: integer milliseconds since the Unix epoch, UTC, in
// every module ("EpochMs"). Date-only diagrams use midnight UTC. There is no
// wall-clock read anywhere in the pipeline — `today` must be supplied by the
// caller (GanttClock), per the spec's determinism contract.
// ============================================================================

/** Integer milliseconds since the Unix epoch, UTC. */
export type EpochMs = number

export type GanttTaskTag = 'active' | 'done' | 'crit' | 'milestone' | 'vert'

export type GanttWeekday =
  | 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'

export type GanttWeekendStart = 'friday' | 'saturday'

/** A calendar token from `excludes`/`includes`: a weekday name, the word
 *  `weekends`, or an explicit date in the diagram's dateFormat. */
export type GanttCalendarToken =
  | { kind: 'weekends' }
  | { kind: 'weekday'; day: GanttWeekday }
  | { kind: 'date'; raw: string }

export interface GanttCalendar {
  dateFormat: string
  inclusiveEndDates: boolean
  excludes: GanttCalendarToken[]
  includes: GanttCalendarToken[]
  weekendStart: GanttWeekendStart
  weekStart: GanttWeekday
}

/** Explicit clock input. The pipeline never reads wall-clock time; the today
 *  marker draws only when the caller supplies this value. */
export interface GanttClock {
  /** A date string in the diagram's dateFormat (or ISO YYYY-MM-DD fallback). */
  today?: string
}

export type GanttStartExpr =
  | { kind: 'date'; raw: string }
  | { kind: 'after'; refs: string[] }

export type GanttEndExpr =
  | { kind: 'date'; raw: string }
  | { kind: 'duration'; raw: string }
  | { kind: 'until'; refs: string[] }

export interface GanttModelTask {
  /** Position in source order across all sections (0-based). */
  index: number
  /** Mermaid task id (`:id, start, end`) — referenced by after/until/click. */
  id?: string
  label: string
  tags: GanttTaskTag[]
  /** Undefined start = "begins when the previous task ends" (Mermaid default). */
  start?: GanttStartExpr
  end: GanttEndExpr
  sectionIndex: number
  line: number
}

export interface GanttModelSection {
  /** Undefined label = the implicit section before any `section` line. */
  label?: string
  taskIndexes: number[]
  line?: number
}

export interface GanttClick {
  taskId: string
  action: 'href' | 'call'
  /** The remainder of the click line, verbatim (sanitized at render time). */
  rest: string
  line: number
}

export type GanttTickUnit =
  | 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month'

export interface GanttModel {
  title?: string
  dateFormat: string
  axisFormat?: string
  tickInterval?: { count: number; unit: GanttTickUnit }
  inclusiveEndDates: boolean
  topAxis: boolean
  excludes: GanttCalendarToken[]
  includes: GanttCalendarToken[]
  weekendStart: GanttWeekendStart
  weekStart: GanttWeekday
  /** Parsed `todayMarker` directive. `off` disables the marker even with a clock. */
  todayMarker?: { off: boolean; style?: string }
  sections: GanttModelSection[]
  /** Flat task list in source order; sections index into it. */
  tasks: GanttModelTask[]
  clicks: GanttClick[]
  accTitle?: string
  accDescr?: string
  /** From frontmatter/config (`displayMode: compact` or `gantt.displayMode`). */
  displayMode?: 'compact'
  /** From config `gantt.barHeight`. */
  barHeight?: number
}

// ---- Structured errors ------------------------------------------------------

export type GanttErrorCode =
  | 'GANTT_BAD_DIRECTIVE'
  | 'GANTT_BAD_TASK'
  | 'GANTT_BAD_DATE'
  | 'GANTT_BAD_DURATION'
  | 'GANTT_DUPLICATE_TASK_ID'
  | 'GANTT_UNKNOWN_TASK_REF'
  | 'GANTT_DEPENDENCY_CYCLE'
  | 'GANTT_NO_START'
  | 'GANTT_SCHEDULE_OVERFLOW'
  | 'GANTT_EMPTY'

/** Named, structured Gantt failure: every parse/schedule error carries a code
 *  and, where possible, the 1-based source line. */
export class GanttError extends Error {
  readonly code: GanttErrorCode
  readonly line?: number
  constructor(code: GanttErrorCode, message: string, line?: number) {
    super(`${code}: ${message}`)
    this.name = 'GanttError'
    this.code = code
    this.line = line
  }
}

// ---- Schedule ----------------------------------------------------------------

export interface ScheduledGanttTask {
  index: number
  id?: string
  label: string
  tags: GanttTaskTag[]
  sectionIndex: number
  start: EpochMs
  end: EpochMs
  /** True when the end came from an explicit date (calendar excludes never
   *  extend it), false when it came from a duration or until ref. */
  manualEnd: boolean
  line: number
}

/** Optional dependency analysis (critical path over `after` edges only).
 *  Computed when the dependency graph is valid; absent when no `after`
 *  dependencies exist (research doc: do not infer a critical path without
 *  dependencies). */
export interface GanttScheduleAnalysis {
  criticalPathTaskIds: string[]
  /** Slack in milliseconds, keyed by Mermaid task id (tasks with ids only). */
  slackByTaskId: Record<string, number>
  projectStart: EpochMs
  projectEnd: EpochMs
  entryTaskIds: string[]
  sinkTaskIds: string[]
}

export interface GanttSchedule {
  tasks: ScheduledGanttTask[]
  /** Inclusive time range covering every task and vert marker. */
  timeMin: EpochMs
  timeMax: EpochMs
  /** True when dateFormat carries no time-of-day tokens. */
  dateOnly: boolean
  /** Resolved clock instant, when the caller supplied one and todayMarker is not off. */
  today?: EpochMs
  analysis?: GanttScheduleAnalysis
  /** Day predicate for exclude shading; pure function of the calendar. */
  isExcludedDay: (dayStart: EpochMs) => boolean
}

// ---- Layout -------------------------------------------------------------------

export interface GanttTick {
  time: EpochMs
  x: number
  label: string
}

export interface GanttBarLayout {
  taskIndex: number
  id?: string
  label: string
  tags: GanttTaskTag[]
  /** Index into GanttLayoutResult.sections (band index), NOT the model
   *  section index — empty implicit sections are skipped in the layout. */
  sectionIndex: number
  x: number
  y: number
  w: number
  h: number
  /** Diamond center for milestone tasks (start/end midpoint). */
  milestoneX?: number
  rowIndex: number
  start: EpochMs
  end: EpochMs
}

export interface GanttSectionBand {
  label?: string
  y: number
  h: number
  rowStart: number
  rowEnd: number
}

export interface GanttVertLayout {
  taskIndex: number
  label: string
  x: number
  time: EpochMs
}

export interface GanttRowLayout {
  /** Bars stacked in this row (one per task; >1 only in compact mode). */
  barIndexes: number[]
  sectionIndex: number
  y: number
  h: number
}

export interface GanttLayoutResult {
  title?: string
  width: number
  height: number
  plot: { x: number; y: number; w: number; h: number }
  labelColumnWidth: number
  rows: GanttRowLayout[]
  sections: GanttSectionBand[]
  bars: GanttBarLayout[]
  verts: GanttVertLayout[]
  ticks: GanttTick[]
  topAxis: boolean
  todayX?: number
  timeMin: EpochMs
  timeMax: EpochMs
  dateOnly: boolean
  compact: boolean
  barHeight: number
}
