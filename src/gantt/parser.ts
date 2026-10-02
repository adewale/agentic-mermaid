// ============================================================================
// Gantt syntax parser — Mermaid-compatible `gantt` source → GanttModel.
//
// Renderer-grade parser with error semantics (docs/design/families/gantt.md §Parser
// rules): never silently drop a line; duplicate task ids are errors; invalid
// directives/tasks are errors with line numbers. The agent-grade structured-
// or-opaque parser lives in src/agent/gantt-body.ts and shares the task-line
// statement reader exported here. Render and editable models project separately.
//
// Input is the normalized line list from mermaid-source.ts (trimmed, comments
// stripped, header first). Frontmatter-derived config (displayMode, barHeight)
// is merged by the caller via applyGanttFrontmatterConfig.
// ============================================================================

import type {
  GanttModel, GanttModelTask, GanttTaskTag,
  GanttCalendarToken, GanttWeekday, GanttStartExpr, GanttEndExpr, GanttTickUnit,
} from './types.ts'
import { GanttError } from './types.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterMap, getFrontmatterScalar } from '../mermaid-source.ts'
import { parseAccessibilityDirective, type ParsedAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { stripTrailingComment, trailingCommentStart } from '../shared/trailing-comment.ts'

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
} as const

type GanttSyntax =
  | { kind: 'comment' | 'blank' }
  | { kind: 'accessibility'; directive: ParsedAccessibilityDirective }
  | { kind: 'title' | 'section'; value: string }
  | { kind: 'directive'; name: Exclude<keyof typeof DIRECTIVE_RES, 'title' | 'section' | 'click'> | 'inclusiveEndDates' | 'topAxis'; value: string }
  | { kind: 'click'; taskId: string; action: 'href' | 'call'; rest: string }
  | { kind: 'task'; label: string; meta: ParsedTaskMeta }
  | { kind: 'invalid'; code: 'GANTT_BAD_DIRECTIVE' | 'GANTT_BAD_TASK'; message: string; structural?: boolean }

export type GanttSourceStatement = GanttSyntax & {
  /** Physical source lines, including indentation and comments. */
  raw: string[]
  startLine: number
  endLine: number
  valueColumn?: number
}

/** One statement authority; render and edit projections choose their own
 * treatment of unsupported statements without reclassifying their syntax. */
export function readGanttStatements(lines: readonly string[]): GanttSourceStatement[] {
  const statements: GanttSourceStatement[] = []
  for (let index = 0; index < lines.length; index++) {
    const start = index
    const rawLine = lines[index]!
    const line = rawLine.trim()
    const append = (syntax: GanttSyntax, raw = [rawLine]): void => {
      const valueColumn = syntax.kind === 'section' || syntax.kind === 'title'
        ? rawLine.indexOf(syntax.value, rawLine.search(/\S/) + syntax.kind.length) + 1
        : undefined
      statements.push({ ...syntax, raw, startLine: start + 1, endLine: index + 1, valueColumn })
    }
    if (!line || line.startsWith('%%')) {
      append({ kind: line ? 'comment' : 'blank' })
      continue
    }
    const accessibility = parseAccessibilityDirective(lines, index)
    if (accessibility === undefined) {
      const raw = lines.slice(index)
      index = lines.length - 1
      append({ kind: 'invalid', code: 'GANTT_BAD_DIRECTIVE', message: 'Unclosed accDescr block', structural: true }, raw)
      break
    }
    if (accessibility !== null) {
      index = accessibility.endIndex
      const raw = lines.slice(start, index + 1)
      if (accessibility.suffixLine) raw[raw.length - 1] = raw.at(-1)!.slice(0, raw.at(-1)!.indexOf('}') + 1)
      append({ kind: 'accessibility', directive: accessibility }, raw)
      if (accessibility.suffixLine) {
        const closingLine = lines[index]!
        const offset = closingLine.indexOf('}') + 1
        const suffix = readGanttStatements([closingLine.slice(offset)])
        statements.push(...suffix.map(statement => ({ ...statement, startLine: index + 1, endLine: index + 1,
          valueColumn: statement.valueColumn === undefined ? undefined : statement.valueColumn + offset })))
      }
      continue
    }
    let matched = false
    for (const [name, pattern] of Object.entries(DIRECTIVE_RES)) {
      const source = name === 'weekday' || name === 'weekend' ? stripTrailingComment(line) : line
      const match = source.match(pattern)
      if (!match) continue
      matched = true
      const value = match[1]!.trim()
      if (name === 'title' || name === 'section') append({ kind: name, value })
      else if (name === 'click') append({ kind: 'click', taskId: value, action: match[2]!.toLowerCase() as 'href' | 'call', rest: match[3]!.trim() })
      else if (name === 'weekday' && !(WEEKDAYS as readonly string[]).includes(value.toLowerCase())) {
        append({ kind: 'invalid', code: 'GANTT_BAD_DIRECTIVE', message: `Invalid weekday "${value}"` })
      } else if (name === 'weekend' && !['friday', 'saturday'].includes(value.toLowerCase())) {
        append({ kind: 'invalid', code: 'GANTT_BAD_DIRECTIVE', message: `Invalid weekend "${value}" (friday or saturday)` })
      } else append({ kind: 'directive', name: name as Extract<GanttSyntax, { kind: 'directive' }>['name'], value })
      break
    }
    if (matched) continue
    const keyword = stripTrailingComment(line)
    if (/^(inclusiveEndDates|topAxis)\s*$/i.test(keyword)) {
      append({ kind: 'directive', name: /^topAxis/i.test(keyword) ? 'topAxis' : 'inclusiveEndDates', value: '' })
      continue
    }
    // Reserved directives must never be misclassified as tasks because their
    // malformed payload happens to contain a colon.
    const colon = line.indexOf(':')
    if (!/^(dateFormat|axisFormat|tickInterval|inclusiveEndDates|topAxis|excludes|includes|todayMarker|weekday|weekend|click)\b/i.test(line)
      && colon > 0 && colon < line.length - 1) {
      const label = line.slice(0, colon).trim()
      const rawColon = rawLine.indexOf(':')
      const commentInMeta = trailingCommentStart(rawLine.slice(rawColon + 1))
      const commentOffset = commentInMeta < 0 ? -1 : rawColon + 1 + commentInMeta
      const rawMeta = stripTrailingComment(line.slice(colon + 1)).trim()
      const meta = parseGanttTaskMeta(rawMeta)
      if (meta) {
        append({ kind: 'task', label, meta }, [commentOffset < 0 ? rawLine : rawLine.slice(0, commentOffset)])
        if (commentOffset >= 0) append({ kind: 'comment' }, [rawLine.slice(commentOffset)])
      } else append({ kind: 'invalid', code: 'GANTT_BAD_TASK', message: `Invalid task metadata "${rawMeta}"` })
    } else append({ kind: 'invalid', code: 'GANTT_BAD_DIRECTIVE', message: `Unrecognized gantt line "${line}"` })
  }
  return statements
}

/**
 * Parse normalized Mermaid gantt lines (header included) into a GanttModel.
 * Throws GanttError with a code and 1-based line number on the first invalid
 * construct. Lines is the normalized list, so `lineNo` refers to it.
 */
export function parseGanttModel(lines: string[]): GanttModel {
  const header = stripTrailingComment((lines[0] ?? '').trim())
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

  for (const statement of readGanttStatements(lines.slice(1))) {
    const lineNo = statement.startLine + 1
    if (statement.kind === 'invalid') throw new GanttError(statement.code, statement.message, lineNo)
    if (statement.kind === 'accessibility') {
      if (statement.directive.title) model.accTitle = statement.directive.value
      else model.accDescr = statement.directive.value.replace(/\s*\n\s*/g, ' ')
    } else if (statement.kind === 'title') model.title = statement.value
    else if (statement.kind === 'directive') {
      const value = statement.value
      switch (statement.name) {
        case 'dateFormat': model.dateFormat = value; break
        case 'axisFormat': model.axisFormat = value; break
        case 'tickInterval': {
          const tm = value.match(TICK_INTERVAL_RE)
          if (tm) model.tickInterval = { count: Number(tm[1]), unit: tm[2] as GanttTickUnit }
          break
        }
        case 'inclusiveEndDates': model.inclusiveEndDates = true; break
        case 'topAxis': model.topAxis = true; break
        case 'excludes': model.excludes.push(...parseCalendarTokens(value)); break
        case 'includes': model.includes.push(...parseCalendarTokens(value)); break
        case 'todayMarker': model.todayMarker = value.toLowerCase() === 'off' ? { off: true } : { off: false, style: value }; break
        case 'weekday': model.weekStart = value.toLowerCase() as GanttWeekday; break
        case 'weekend': model.weekendStart = value.toLowerCase() as 'friday' | 'saturday'; break
      }
    } else if (statement.kind === 'click') {
      model.clicks.push({ taskId: statement.taskId, action: statement.action, rest: statement.rest, line: lineNo })
    } else if (statement.kind === 'section') {
      model.sections.push({ label: statement.value, taskIndexes: [], line: lineNo })
      currentSection = model.sections.length - 1
    } else if (statement.kind === 'task') {
      const { label, meta } = statement
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
    }
  }

  return model
}

/**
 * Merge frontmatter/init config into the model: Mermaid accepts
 * `displayMode: compact` at the top level and `gantt: { displayMode,
 * barHeight, topAxis }` under config. mermaid-source.ts already folds the
 * `config:` root into the top-level map.
 */
export function applyGanttFrontmatterConfig(model: GanttModel, frontmatter: MermaidFrontmatterMap | undefined): GanttModel {
  return applyResolvedGanttFrontmatterConfig(model, resolveGanttFrontmatterConfig(frontmatter))
}

/** Serializable Gantt config compiled once at the render-request boundary. */
export interface ResolvedGanttFrontmatterConfig {
  /** Frontmatter `title:`; a `title` statement in the body wins. */
  title?: string
  displayMode?: 'compact'
  barHeight?: number
  topAxis?: true
  axisFormat?: string
  tickInterval?: { count: number; unit: GanttTickUnit }
}

export function resolveGanttFrontmatterConfig(
  frontmatter: MermaidFrontmatterMap | undefined,
): ResolvedGanttFrontmatterConfig {
  if (!frontmatter) return {}
  const resolved: ResolvedGanttFrontmatterConfig = {}
  const title = getFrontmatterScalar<string>(frontmatter, ['title'])
  if (typeof title === 'string' && title.trim() !== '') resolved.title = title
  const topLevelMode = getFrontmatterScalar<string>(frontmatter, ['displayMode'])
  const ganttMap = getFrontmatterMap(frontmatter, ['gantt'])
  const ganttMode = ganttMap ? getFrontmatterScalar<string>(frontmatter, ['gantt', 'displayMode']) : undefined
  const mode = ganttMode ?? topLevelMode
  if (typeof mode === 'string' && mode.toLowerCase() === 'compact') resolved.displayMode = 'compact'
  const barHeight = getFrontmatterScalar<number>(frontmatter, ['gantt', 'barHeight'])
  if (typeof barHeight === 'number' && Number.isFinite(barHeight) && barHeight > 0) resolved.barHeight = barHeight
  const topAxis = getFrontmatterScalar<boolean>(frontmatter, ['gantt', 'topAxis'])
  if (topAxis === true) resolved.topAxis = true
  const axisFormat = getFrontmatterScalar<string>(frontmatter, ['gantt', 'axisFormat'])
  if (typeof axisFormat === 'string') resolved.axisFormat = axisFormat
  const tickInterval = getFrontmatterScalar<string>(frontmatter, ['gantt', 'tickInterval'])
  if (typeof tickInterval === 'string') {
    const tm = tickInterval.match(TICK_INTERVAL_RE)
    if (tm) resolved.tickInterval = { count: Number(tm[1]), unit: tm[2] as GanttTickUnit }
  }
  return resolved
}

export function applyResolvedGanttFrontmatterConfig(
  model: GanttModel,
  resolved: ResolvedGanttFrontmatterConfig,
): GanttModel {
  if (resolved.title !== undefined && model.title === undefined) model.title = resolved.title
  if (resolved.displayMode) model.displayMode = resolved.displayMode
  if (resolved.barHeight !== undefined) model.barHeight = resolved.barHeight
  if (resolved.topAxis) model.topAxis = true
  if (resolved.axisFormat !== undefined && model.axisFormat === undefined) model.axisFormat = resolved.axisFormat
  if (resolved.tickInterval !== undefined && model.tickInterval === undefined) model.tickInterval = resolved.tickInterval
  return model
}
