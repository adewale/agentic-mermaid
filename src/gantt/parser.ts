// ============================================================================
// Gantt syntax parser — Mermaid-compatible `gantt` source → GanttModel.
//
// Renderer-grade parser with error semantics (docs/design/families/gantt.md §Parser
// rules): never silently drop a line; duplicate task ids are errors; invalid
// directives/tasks are errors with line numbers. The agent-grade structured-
// or-opaque parser lives in src/agent/gantt-body.ts and shares the task-line
// helpers exported here so the two cannot drift.
//
// Input is the normalized line list from mermaid-source.ts (trimmed, comments
// stripped, header first). Frontmatter-derived config (displayMode, barHeight)
// is merged by the caller via applyGanttFrontmatterConfig.
// ============================================================================

import type {
  GanttModel, GanttModelTask, GanttModelSection, GanttTaskTag,
  GanttCalendarToken, GanttWeekday, GanttStartExpr, GanttEndExpr, GanttTickUnit,
} from './types.ts'
import { GanttError } from './types.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterMap, getFrontmatterScalar } from '../mermaid-source.ts'

export const GANTT_TASK_TAGS: readonly GanttTaskTag[] = ['active', 'done', 'crit', 'milestone', 'vert']

const WEEKDAYS: readonly GanttWeekday[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]

export const GANTT_DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|M|y)$/
const TICK_INTERVAL_RE = /^([1-9][0-9]*)(millisecond|second|minute|hour|day|week|month)$/

export interface ParsedTaskMeta {
  tags: GanttTaskTag[]
  id?: string
  start?: GanttStartExpr
  end: GanttEndExpr
}

/**
 * Parse the metadata half of a task line (after the `:`), following Mermaid's
 * comma-split convention: leading items are status tags; the remainder is
 * `[id,] [start,] end`. One item = end only (start inherited from the previous
 * task); two = start + end; three = id + start + end. Returns null with no
 * side effects when the shape is invalid — callers decide error vs opaque.
 */
export function parseGanttTaskMeta(rawMeta: string): ParsedTaskMeta | null {
  const items = rawMeta.split(',').map(s => s.trim())
  if (items.some(s => s.length === 0)) return null
  const tags: GanttTaskTag[] = []
  let i = 0
  while (i < items.length && (GANTT_TASK_TAGS as readonly string[]).includes(items[i]!)) {
    const tag = items[i]! as GanttTaskTag
    if (tags.includes(tag)) return null // repeated tag is malformed
    tags.push(tag)
    i++
  }
  const rest = items.slice(i)
  if (rest.length === 0 || rest.length > 3) return null

  const classifyStart = (raw: string): GanttStartExpr => {
    const after = raw.match(/^after\s+(.+)$/)
    if (after) return { kind: 'after', refs: after[1]!.split(/\s+/).filter(Boolean) }
    return { kind: 'date', raw }
  }
  const classifyEnd = (raw: string): GanttEndExpr => {
    const until = raw.match(/^until\s+(.+)$/)
    if (until) return { kind: 'until', refs: until[1]!.split(/\s+/).filter(Boolean) }
    if (GANTT_DURATION_RE.test(raw)) return { kind: 'duration', raw }
    return { kind: 'date', raw }
  }

  if (rest.length === 1) return { tags, end: classifyEnd(rest[0]!) }
  if (rest.length === 2) return { tags, start: classifyStart(rest[0]!), end: classifyEnd(rest[1]!) }
  // Three items: Mermaid treats the first as the task id unconditionally.
  const id = rest[0]!
  if (!/^[\w-]+$/.test(id)) return null
  return { tags, id, start: classifyStart(rest[1]!), end: classifyEnd(rest[2]!) }
}

/** Canonical re-emission of a parsed task metadata (used by the agent body
 *  serializer and the parser↔body differential tests). */
export function renderGanttTaskMeta(meta: ParsedTaskMeta): string {
  const parts: string[] = [...meta.tags]
  if (meta.id !== undefined) parts.push(meta.id)
  if (meta.start) parts.push(meta.start.kind === 'after' ? `after ${meta.start.refs.join(' ')}` : meta.start.raw)
  parts.push(meta.end.kind === 'until' ? `until ${meta.end.refs.join(' ')}` : meta.end.raw)
  return parts.join(', ')
}

function parseCalendarTokens(raw: string): GanttCalendarToken[] {
  // Mermaid accepts comma- or whitespace-separated entries.
  return raw.split(/[,\s]+/).filter(Boolean).map((tok): GanttCalendarToken => {
    const lower = tok.toLowerCase()
    if (lower === 'weekends') return { kind: 'weekends' }
    if ((WEEKDAYS as readonly string[]).includes(lower)) return { kind: 'weekday', day: lower as GanttWeekday }
    return { kind: 'date', raw: tok }
  })
}

const DIRECTIVE_RES = {
  title: /^title\s+(.+)$/i,
  dateFormat: /^dateFormat\s+(.+)$/i,
  axisFormat: /^axisFormat\s+(.+)$/i,
  tickInterval: /^tickInterval\s+(.+)$/i,
  excludes: /^excludes\s+(.+)$/i,
  includes: /^includes\s+(.+)$/i,
  todayMarker: /^todayMarker\s+(.+)$/i,
  weekday: /^weekday\s+(.+)$/i,
  weekend: /^weekend\s+(.+)$/i,
  section: /^section\s+(.+)$/i,
  click: /^click\s+([\w-]+)\s+(href|call)\s+(.+)$/i,
  accTitle: /^accTitle\s*:\s*(.+)$/i,
  accDescrInline: /^accDescr\s*:\s*(.+)$/i,
  accDescrBlock: /^accDescr\s*\{\s*$/i,
} as const

/**
 * Parse normalized Mermaid gantt lines (header included) into a GanttModel.
 * Throws GanttError with a code and 1-based line number on the first invalid
 * construct. Lines is the normalized list, so `lineNo` refers to it.
 */
export function parseGanttModel(lines: string[]): GanttModel {
  const header = (lines[0] ?? '').trim()
  if (!/^gantt\s*$/i.test(header)) {
    throw new GanttError('GANTT_BAD_DIRECTIVE', `Expected "gantt" header, got "${header}"`, 1)
  }

  const model: GanttModel = {
    dateFormat: 'YYYY-MM-DD',
    inclusiveEndDates: false,
    topAxis: false,
    excludes: [],
    includes: [],
    weekendStart: 'saturday',
    weekStart: 'sunday',
    sections: [{ taskIndexes: [] }],
    tasks: [],
    clicks: [],
  }
  const seenIds = new Set<string>()
  let currentSection = 0
  let inAccDescr = false
  const accDescrBuf: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    const lineNo = i + 1
    if (!line || line.startsWith('%%')) continue

    if (inAccDescr) {
      if (/^\}\s*$/.test(line)) {
        model.accDescr = accDescrBuf.join(' ').trim()
        inAccDescr = false
      } else {
        accDescrBuf.push(line)
      }
      continue
    }

    let m: RegExpMatchArray | null

    if ((m = line.match(DIRECTIVE_RES.title))) { model.title = m[1]!.trim(); continue }
    if ((m = line.match(DIRECTIVE_RES.dateFormat))) { model.dateFormat = m[1]!.trim(); continue }
    if ((m = line.match(DIRECTIVE_RES.axisFormat))) { model.axisFormat = m[1]!.trim(); continue }
    if ((m = line.match(DIRECTIVE_RES.tickInterval))) {
      // Lenient like Mermaid: values outside the documented
      // `count(millisecond|second|minute|hour|day|week|month)` shape are
      // ignored and the axis falls back to auto ticks — mermaid's own docs
      // contain `tickInterval 1decade`. The PR #7197 safety property lives in
      // bounded tick GENERATION (layout.ts), not in rejecting the directive.
      const tm = m[1]!.trim().match(TICK_INTERVAL_RE)
      if (tm) model.tickInterval = { count: Number(tm[1]), unit: tm[2] as GanttTickUnit }
      continue
    }
    if (/^inclusiveEndDates\s*$/i.test(line)) { model.inclusiveEndDates = true; continue }
    if (/^topAxis\s*$/i.test(line)) { model.topAxis = true; continue }
    if ((m = line.match(DIRECTIVE_RES.excludes))) {
      // Multiple excludes lines accumulate (mermaid PR #7772).
      model.excludes.push(...parseCalendarTokens(m[1]!.trim()))
      continue
    }
    if ((m = line.match(DIRECTIVE_RES.includes))) {
      model.includes.push(...parseCalendarTokens(m[1]!.trim()))
      continue
    }
    if ((m = line.match(DIRECTIVE_RES.todayMarker))) {
      const v = m[1]!.trim()
      model.todayMarker = v.toLowerCase() === 'off' ? { off: true } : { off: false, style: v }
      continue
    }
    if ((m = line.match(DIRECTIVE_RES.weekday))) {
      const day = m[1]!.trim().toLowerCase()
      if (!(WEEKDAYS as readonly string[]).includes(day)) {
        throw new GanttError('GANTT_BAD_DIRECTIVE', `Invalid weekday "${m[1]!.trim()}"`, lineNo)
      }
      model.weekStart = day as GanttWeekday
      continue
    }
    if ((m = line.match(DIRECTIVE_RES.weekend))) {
      const day = m[1]!.trim().toLowerCase()
      if (day !== 'friday' && day !== 'saturday') {
        throw new GanttError('GANTT_BAD_DIRECTIVE', `Invalid weekend "${m[1]!.trim()}" (friday or saturday)`, lineNo)
      }
      model.weekendStart = day
      continue
    }
    if ((m = line.match(DIRECTIVE_RES.click))) {
      model.clicks.push({ taskId: m[1]!, action: m[2]!.toLowerCase() as 'href' | 'call', rest: m[3]!.trim(), line: lineNo })
      continue
    }
    if ((m = line.match(DIRECTIVE_RES.accTitle))) { model.accTitle = m[1]!.trim(); continue }
    if (DIRECTIVE_RES.accDescrBlock.test(line)) { inAccDescr = true; continue }
    if ((m = line.match(DIRECTIVE_RES.accDescrInline))) { model.accDescr = m[1]!.trim(); continue }
    if ((m = line.match(DIRECTIVE_RES.section))) {
      model.sections.push({ label: m[1]!.trim(), taskIndexes: [], line: lineNo })
      currentSection = model.sections.length - 1
      continue
    }

    // Task line: `<label> : <metadata>` — label is everything before the LAST
    // colon-separated metadata block. Mermaid's grammar splits on the first
    // colon (labels cannot contain `:`); `#`/`;` are allowed in labels since
    // mermaid PR #5095 (our comment stripping only removes `%%` lines).
    const colon = line.indexOf(':')
    if (colon > 0 && colon < line.length - 1) {
      const label = line.slice(0, colon).trim()
      const rawMeta = line.slice(colon + 1).trim()
      const meta = parseGanttTaskMeta(rawMeta)
      if (!meta) throw new GanttError('GANTT_BAD_TASK', `Invalid task metadata "${rawMeta}"`, lineNo)
      if (!label) throw new GanttError('GANTT_BAD_TASK', 'Task label is empty', lineNo)
      if (meta.id !== undefined) {
        if (seenIds.has(meta.id)) throw new GanttError('GANTT_DUPLICATE_TASK_ID', `Duplicate task id "${meta.id}"`, lineNo)
        seenIds.add(meta.id)
      }
      const task: GanttModelTask = {
        index: model.tasks.length,
        id: meta.id,
        label,
        tags: meta.tags,
        start: meta.start,
        end: meta.end,
        sectionIndex: currentSection,
        line: lineNo,
      }
      model.tasks.push(task)
      model.sections[currentSection]!.taskIndexes.push(task.index)
      continue
    }

    throw new GanttError('GANTT_BAD_DIRECTIVE', `Unrecognized gantt line "${line}"`, lineNo)
  }

  if (inAccDescr) throw new GanttError('GANTT_BAD_DIRECTIVE', 'Unclosed accDescr block')
  return model
}

/**
 * Merge frontmatter/init config into the model: Mermaid accepts
 * `displayMode: compact` at the top level and `gantt: { displayMode,
 * barHeight, topAxis }` under config. mermaid-source.ts already folds the
 * `config:` root into the top-level map.
 */
export function applyGanttFrontmatterConfig(model: GanttModel, frontmatter: MermaidFrontmatterMap | undefined): GanttModel {
  if (!frontmatter) return model
  const topLevelMode = getFrontmatterScalar<string>(frontmatter, ['displayMode'])
  const ganttMap = getFrontmatterMap(frontmatter, ['gantt'])
  const ganttMode = ganttMap ? getFrontmatterScalar<string>(frontmatter, ['gantt', 'displayMode']) : undefined
  const mode = ganttMode ?? topLevelMode
  if (typeof mode === 'string' && mode.toLowerCase() === 'compact') model.displayMode = 'compact'
  const barHeight = getFrontmatterScalar<number>(frontmatter, ['gantt', 'barHeight'])
  if (typeof barHeight === 'number' && Number.isFinite(barHeight) && barHeight > 0) model.barHeight = barHeight
  const topAxis = getFrontmatterScalar<boolean>(frontmatter, ['gantt', 'topAxis'])
  if (topAxis === true) model.topAxis = true
  const axisFormat = getFrontmatterScalar<string>(frontmatter, ['gantt', 'axisFormat'])
  if (typeof axisFormat === 'string' && model.axisFormat === undefined) model.axisFormat = axisFormat
  const tickInterval = getFrontmatterScalar<string>(frontmatter, ['gantt', 'tickInterval'])
  if (typeof tickInterval === 'string' && model.tickInterval === undefined) {
    const tm = tickInterval.match(TICK_INTERVAL_RE)
    if (tm) model.tickInterval = { count: Number(tm[1]), unit: tm[2] as GanttTickUnit }
  }
  return model
}
