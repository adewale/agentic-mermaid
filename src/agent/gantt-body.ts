// ============================================================================
// Gantt structured body: parse / serialize / mutate / verify (FamilyPlugin
// hooks) — docs/design/gantt.md §"First-release syntax matrix".
//
// Segment-preserving structured body (the BUILD-18 sequence pattern): typed
// ops cover the modeled statements — title, sections, tasks — while calendar
// directives (dateFormat, axisFormat, excludes, includes, weekend, weekday,
// todayMarker, tickInterval, inclusiveEndDates, topAxis), click lines,
// accTitle/accDescr, and comments ride along VERBATIM as opaque-block
// segments in their original position. Never dropped; edited at the source
// level only. Promoting a directive to a typed op is future work gated on the
// scheduler being able to re-resolve it.
//
// Whole-opaque fallback (return null) only for structure-level failures:
// header suffix, unclosed accDescr block, or duplicate Mermaid task ids
// (identity becomes unsafe to model).
//
// Mutation validation is correctness-by-construction: every value an op
// writes is rendered to its canonical line and re-parsed; the op is rejected
// unless the round-trip reproduces the intended statement exactly. That keeps
// structured bodies serialize-idempotent by construction.
// ============================================================================

import type {
  GanttBody, GanttBodySection, GanttBodyTask, GanttBodyTaskTag,
  GanttStatement, GanttMutationOp, MutationError, Result, VerifyOptions, LayoutWarning,
} from './types.ts'
import { ok, err } from './types.ts'
import { parseGanttTaskMeta, renderGanttTaskMeta, GANTT_TASK_TAGS, type ParsedTaskMeta } from '../gantt/parser.ts'

// Directive openers that are NEVER task lines even though they may contain `:`
// (accTitle:/accDescr:). Everything matched here becomes an opaque segment.
const DIRECTIVE_LINE_RE = /^(dateFormat|axisFormat|tickInterval|inclusiveEndDates|topAxis|excludes|includes|todayMarker|weekday|weekend|click|accTitle|accDescr)\b/i
const ACC_DESCR_BLOCK_OPEN_RE = /^accDescr\s*\{\s*$/i
const TITLE_RE = /^title\s+(.+)$/i
const SECTION_RE = /^section\s+(.+)$/i
const TASK_ID_RE = /^[\w-]+$/

// ---- Parser -----------------------------------------------------------------

/**
 * Parse gantt body lines into a segment-preserving structured body.
 * `trimmedLines` are normalized body lines; `rawLines` keep original
 * indentation for verbatim opaque segments (pass the same array when raw
 * lines are unavailable). Returns null for structure-level failures so the
 * caller falls back to a lossless whole-body opaque body.
 */
export function parseGanttBody(trimmedLines: string[], rawLines?: string[]): GanttBody | null {
  const raw = rawLines ?? trimmedLines
  const body: GanttBody = { kind: 'gantt', sections: [], statements: [] }
  const statements = body.statements!
  const seenTaskIds = new Set<string>()
  let currentSection = -1 // -1 = no section yet; an implicit one is created on demand
  let sIdx = 0
  let tIdx = 0

  const implicitSection = (): number => {
    if (currentSection === -1) {
      body.sections.push({ id: `section-${sIdx++}`, tasks: [] })
      currentSection = body.sections.length - 1
    }
    return currentSection
  }

  let i = 0
  while (i < raw.length) {
    const rawLine = raw[i]!
    const line = rawLine.trim()
    if (!line || line.startsWith('%%')) {
      // Comments are unmodeled lines: preserve them verbatim in position.
      if (line.startsWith('%%')) appendOpaque(statements, [rawLine])
      i++
      continue
    }

    if (ACC_DESCR_BLOCK_OPEN_RE.test(line)) {
      // Capture the whole block verbatim; inner lines may contain `:` and must
      // not be misread as tasks. Unclosed block → whole-opaque fallback.
      const blockLines: string[] = [rawLine]
      i++
      let closed = false
      while (i < raw.length) {
        const inner = raw[i]!
        blockLines.push(inner)
        i++
        if (/^\}\s*$/.test(inner.trim())) { closed = true; break }
      }
      if (!closed) return null
      appendOpaque(statements, blockLines)
      continue
    }

    if (DIRECTIVE_LINE_RE.test(line)) {
      appendOpaque(statements, [rawLine])
      i++
      continue
    }

    let m: RegExpMatchArray | null
    if ((m = line.match(TITLE_RE))) {
      body.title = m[1]!.trim()
      // Re-declared titles keep their statement position (last wins for the value).
      statements.push({ kind: 'title' })
      i++
      continue
    }

    if ((m = line.match(SECTION_RE))) {
      body.sections.push({ id: `section-${sIdx++}`, label: m[1]!.trim(), tasks: [] })
      currentSection = body.sections.length - 1
      statements.push({ kind: 'section', ref: currentSection })
      i++
      continue
    }

    // Task line: `<label> : <metadata>`.
    const colon = line.indexOf(':')
    if (colon > 0 && colon < line.length - 1) {
      const label = line.slice(0, colon).trim()
      const meta = parseGanttTaskMeta(line.slice(colon + 1).trim())
      if (label && meta) {
        if (meta.id !== undefined) {
          if (seenTaskIds.has(meta.id)) return null // duplicate ids → identity unsafe
          seenTaskIds.add(meta.id)
        }
        const section = implicitSection()
        const task: GanttBodyTask = {
          id: `task-${tIdx++}`,
          taskId: meta.id,
          label,
          tags: canonicalTags(meta.tags),
          start: meta.start ? (meta.start.kind === 'after' ? `after ${meta.start.refs.join(' ')}` : meta.start.raw) : undefined,
          end: meta.end.kind === 'until' ? `until ${meta.end.refs.join(' ')}` : meta.end.raw,
        }
        body.sections[section]!.tasks.push(task)
        statements.push({ kind: 'task', section, ref: body.sections[section]!.tasks.length - 1 })
        i++
        continue
      }
    }

    // Any other unmodeled line rides along verbatim.
    appendOpaque(statements, [rawLine])
    i++
  }

  return body
}

function canonicalTags(tags: GanttBodyTaskTag[]): GanttBodyTaskTag[] {
  return GANTT_TASK_TAGS.filter(t => tags.includes(t)) as GanttBodyTaskTag[]
}

function appendOpaque(statements: GanttStatement[], lines: string[]): void {
  const last = statements[statements.length - 1]
  if (last && last.kind === 'opaque-block') last.lines.push(...lines)
  else statements.push({ kind: 'opaque-block', lines: [...lines] })
}

// ---- Serializer ---------------------------------------------------------------

function taskMeta(task: GanttBodyTask): ParsedTaskMeta {
  return {
    tags: canonicalTags(task.tags),
    id: task.taskId,
    start: task.start === undefined
      ? undefined
      : task.start.startsWith('after ')
        ? { kind: 'after', refs: task.start.slice('after '.length).split(/\s+/).filter(Boolean) }
        : { kind: 'date', raw: task.start },
    end: task.end.startsWith('until ')
      ? { kind: 'until', refs: task.end.slice('until '.length).split(/\s+/).filter(Boolean) }
      : { kind: 'date', raw: task.end }, // duration vs date is irrelevant for emission
  }
}

function renderTaskLine(task: GanttBodyTask): string {
  return `  ${task.label} :${renderGanttTaskMeta(taskMeta(task))}`
}

export function renderGantt(body: GanttBody): string {
  const lines: string[] = ['gantt']

  if (body.statements && body.statements.length > 0) {
    for (const st of body.statements) {
      if (st.kind === 'opaque-block') {
        for (const l of st.lines) lines.push(l)
      } else if (st.kind === 'title') {
        if (body.title !== undefined) lines.push(`  title ${body.title}`)
      } else if (st.kind === 'section') {
        const s = body.sections[st.ref]
        if (s && s.label !== undefined) lines.push(`  section ${s.label}`)
      } else {
        const t = body.sections[st.section]?.tasks[st.ref]
        if (t) lines.push(renderTaskLine(t))
      }
    }
    return lines.join('\n') + '\n'
  }

  // Synthesized path (no statements): title, then sections in order.
  if (body.title !== undefined) lines.push(`  title ${body.title}`)
  for (const s of body.sections) {
    if (s.label !== undefined) lines.push(`  section ${s.label}`)
    for (const t of s.tasks) lines.push(renderTaskLine(t))
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator --------------------------------------------------------------------

function cloneBody(b: GanttBody): GanttBody {
  return {
    kind: 'gantt',
    title: b.title,
    sections: b.sections.map(s => ({ id: s.id, label: s.label, tasks: s.tasks.map(t => ({ ...t, tags: [...t.tags] })) })),
    statements: (b.statements ?? deriveStatements(b)).map(cloneStatement),
  }
}

function cloneStatement(s: GanttStatement): GanttStatement {
  return s.kind === 'opaque-block' ? { kind: 'opaque-block', lines: [...s.lines] } : { ...s }
}

function deriveStatements(b: GanttBody): GanttStatement[] {
  const out: GanttStatement[] = []
  if (b.title !== undefined) out.push({ kind: 'title' })
  b.sections.forEach((s, si) => {
    if (s.label !== undefined) out.push({ kind: 'section', ref: si })
    s.tasks.forEach((_, ti) => out.push({ kind: 'task', section: si, ref: ti }))
  })
  return out
}

function makeIdAllocator(body: GanttBody, prefix: 'section' | 'task'): () => string {
  const seen = new Set<string>()
  for (const s of body.sections) { seen.add(s.id); for (const t of s.tasks) seen.add(t.id) }
  return () => {
    let n = 0
    while (seen.has(`${prefix}-${n}`)) n++
    const id = `${prefix}-${n}`
    seen.add(id)
    return id
  }
}

// Correctness by construction: render the candidate task to its canonical
// line and re-parse; reject unless the round-trip reproduces it exactly.
function validateTask(task: GanttBodyTask): MutationError | null {
  if (!task.label || /[:\r\n]/.test(task.label)) {
    return { code: 'INVALID_OP', message: 'Gantt task label must be non-empty and must not contain ":" or newlines' }
  }
  if (task.taskId !== undefined && !TASK_ID_RE.test(task.taskId)) {
    return { code: 'INVALID_OP', message: `Gantt task id "${task.taskId}" must match ${TASK_ID_RE}` }
  }
  for (const field of [task.start, task.end]) {
    if (field !== undefined && /[,:#\r\n]/.test(field)) {
      return { code: 'INVALID_OP', message: 'Gantt task dates must not contain "," ":" "#" or newlines' }
    }
  }
  if (!task.end) return { code: 'INVALID_OP', message: 'Gantt task end (date, duration, or "until id") is required' }
  const line = renderTaskLine(task).trim()
  const colon = line.indexOf(':')
  const label = colon > 0 ? line.slice(0, colon).trim() : ''
  const meta = colon > 0 ? parseGanttTaskMeta(line.slice(colon + 1).trim()) : null
  const reparsesAsDirective = TITLE_RE.test(line) || SECTION_RE.test(line) || DIRECTIVE_LINE_RE.test(line)
  if (!meta || label !== task.label || reparsesAsDirective) {
    return { code: 'INVALID_OP', message: `Gantt task does not round-trip through its canonical line ("${line}")` }
  }
  const renderedBack = renderGanttTaskMeta(meta)
  if (renderedBack !== renderGanttTaskMeta(taskMeta(task))) {
    return { code: 'INVALID_OP', message: `Gantt task metadata is ambiguous ("${renderedBack}")` }
  }
  return null
}

function validateSectionLabel(label: string): MutationError | null {
  if (!label.trim() || /[:\r\n]/.test(label)) {
    return { code: 'INVALID_OP', message: 'Gantt section label must be non-empty and must not contain ":" or newlines' }
  }
  const line = `section ${label.trim()}`
  if (!SECTION_RE.test(line)) return { code: 'INVALID_OP', message: 'Gantt section label does not round-trip' }
  return null
}

function allTaskIds(body: GanttBody): Set<string> {
  const ids = new Set<string>()
  for (const s of body.sections) for (const t of s.tasks) if (t.taskId !== undefined) ids.add(t.taskId)
  return ids
}

export function mutateGantt(input: GanttBody, op: GanttMutationOp): Result<GanttBody, MutationError> {
  const body = cloneBody(input)
  const statements = body.statements!
  const nextSectionId = makeIdAllocator(body, 'section')
  const nextTaskId = makeIdAllocator(body, 'task')

  const getSection = (i: number): GanttBodySection | undefined => body.sections[i]
  const getTask = (si: number, ti: number): GanttBodyTask | undefined => getSection(si)?.tasks[ti]

  switch (op.kind) {
    case 'set_title': {
      if (op.title === null) {
        body.title = undefined
        removeAll(statements, s => s.kind === 'title')
        break
      }
      const title = op.title.trim()
      if (!title || /[\r\n]/.test(title)) return err({ code: 'INVALID_OP', message: 'Gantt title must be a non-empty single line' })
      const hadTitle = body.title !== undefined
      body.title = title
      if (!hadTitle) statements.unshift({ kind: 'title' })
      break
    }
    case 'add_section': {
      const bad = validateSectionLabel(op.label)
      if (bad) return err(bad)
      body.sections.push({ id: nextSectionId(), label: op.label.trim(), tasks: [] })
      statements.push({ kind: 'section', ref: body.sections.length - 1 })
      break
    }
    case 'rename_section': {
      const s = getSection(op.index)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.index}` })
      if (s.label === undefined) return err({ code: 'INVALID_OP', message: 'Cannot rename the implicit (unlabeled) section' })
      const bad = validateSectionLabel(op.label)
      if (bad) return err(bad)
      s.label = op.label.trim()
      break
    }
    case 'remove_section': {
      if (!getSection(op.index)) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.index}` })
      body.sections.splice(op.index, 1)
      removeAll(statements, s =>
        (s.kind === 'section' && s.ref === op.index) || (s.kind === 'task' && s.section === op.index))
      for (const s of statements) {
        if (s.kind === 'section' && s.ref > op.index) s.ref--
        if (s.kind === 'task' && s.section > op.index) s.section--
      }
      break
    }
    case 'add_task': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      if (op.taskId !== undefined && allTaskIds(body).has(op.taskId)) {
        return err({ code: 'DUPLICATE_TASK', message: `Task id "${op.taskId}" already exists` })
      }
      const task: GanttBodyTask = {
        id: nextTaskId(),
        taskId: op.taskId,
        label: op.label?.trim() ?? '',
        tags: canonicalTags(op.tags ?? []),
        start: op.start?.trim() || undefined,
        end: (op.end ?? '').trim(),
      }
      const bad = validateTask(task)
      if (bad) return err(bad)
      s.tasks.push(task)
      insertTaskStatement(statements, op.sectionIndex, s.tasks.length - 1)
      break
    }
    case 'remove_task': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      if (!s.tasks[op.taskIndex]) return err({ code: 'TASK_NOT_FOUND', message: `No task at index ${op.taskIndex}` })
      s.tasks.splice(op.taskIndex, 1)
      removeAll(statements, st => st.kind === 'task' && st.section === op.sectionIndex && st.ref === op.taskIndex)
      for (const st of statements) {
        if (st.kind === 'task' && st.section === op.sectionIndex && st.ref > op.taskIndex) st.ref--
      }
      break
    }
    case 'rename_task': {
      const t = getTask(op.sectionIndex, op.taskIndex)
      if (!t) return err({ code: 'TASK_NOT_FOUND', message: `No task at (${op.sectionIndex},${op.taskIndex})` })
      const candidate = { ...t, label: op.label?.trim() ?? '' }
      const bad = validateTask(candidate)
      if (bad) return err(bad)
      t.label = candidate.label
      break
    }
    case 'set_task_status': {
      const t = getTask(op.sectionIndex, op.taskIndex)
      if (!t) return err({ code: 'TASK_NOT_FOUND', message: `No task at (${op.sectionIndex},${op.taskIndex})` })
      const structural = t.tags.filter(tag => tag === 'milestone' || tag === 'vert')
      const next = op.status === null ? structural : canonicalTags([op.status, ...structural])
      if (op.status !== null && !['active', 'done', 'crit'].includes(op.status)) {
        return err({ code: 'INVALID_OP', message: `Invalid task status "${String(op.status)}"` })
      }
      t.tags = next
      break
    }
    case 'set_task_dates': {
      const t = getTask(op.sectionIndex, op.taskIndex)
      if (!t) return err({ code: 'TASK_NOT_FOUND', message: `No task at (${op.sectionIndex},${op.taskIndex})` })
      const candidate = { ...t, tags: [...t.tags] }
      if (op.start !== undefined) candidate.start = op.start === null ? undefined : op.start.trim()
      if (op.end !== undefined) candidate.end = op.end.trim()
      const bad = validateTask(candidate)
      if (bad) return err(bad)
      t.start = candidate.start
      t.end = candidate.end
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_x)}` })
    }
  }
  return ok(body)
}

function removeAll(statements: GanttStatement[], pred: (s: GanttStatement) => boolean): void {
  for (let i = statements.length - 1; i >= 0; i--) if (pred(statements[i]!)) statements.splice(i, 1)
}

// Insert a new task statement right after the last statement belonging to its
// section (the section header or its last task), so serialization keeps tasks
// under the right `section` line even with directives interleaved.
function insertTaskStatement(statements: GanttStatement[], sectionIndex: number, taskRef: number): void {
  let at = -1
  for (let i = 0; i < statements.length; i++) {
    const s = statements[i]!
    if ((s.kind === 'section' && s.ref === sectionIndex) || (s.kind === 'task' && s.section === sectionIndex)) at = i
  }
  const st: GanttStatement = { kind: 'task', section: sectionIndex, ref: taskRef }
  if (at >= 0) statements.splice(at + 1, 0, st)
  else statements.push(st)
}

// ---- Verify --------------------------------------------------------------------

const AFTER_OR_UNTIL_RE = /^(?:after|until)\s+(.+)$/

/**
 * Source-level structural verification (spec §Verification): EMPTY_DIAGRAM,
 * LABEL_OVERFLOW on title/section/task labels, EDGE_MISANCHORED for
 * after/until references to unknown task ids. Reference checking also scans
 * opaque segments for task-shaped lines so a partially-modeled body does not
 * produce false positives.
 */
export function verifyGantt(body: GanttBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const cap = opts.labelCharCap ?? 40

  const tasks = body.sections.flatMap(s => s.tasks)
  const opaqueLines = (body.statements ?? [])
    .filter((s): s is Extract<GanttStatement, { kind: 'opaque-block' }> => s.kind === 'opaque-block')
    .flatMap(s => s.lines.map(l => l.trim()))
    .filter(l => l.length > 0)

  if (tasks.length === 0 && body.title === undefined && opaqueLines.length === 0) {
    return [{ code: 'EMPTY_DIAGRAM' }]
  }

  if (body.title !== undefined && body.title.length > cap) {
    warnings.push({ code: 'LABEL_OVERFLOW', target: 'title', charCount: body.title.length, limit: cap })
  }
  for (const s of body.sections) {
    if (s.label !== undefined && s.label.length > cap) {
      warnings.push({ code: 'LABEL_OVERFLOW', target: s.id, charCount: s.label.length, limit: cap })
    }
    for (const t of s.tasks) {
      if (t.label.length > cap) warnings.push({ code: 'LABEL_OVERFLOW', target: t.id, charCount: t.label.length, limit: cap })
    }
  }

  // Known ids: structured tasks + task-shaped opaque lines (a malformed task
  // line still "defines" its id for reference purposes — better to miss a
  // warning than to flag a reference that renders fine).
  const known = allTaskIds(body)
  for (const line of opaqueLines) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const items = line.slice(colon + 1).split(',').map(s => s.trim()).filter(Boolean)
    let i = 0
    while (i < items.length && (GANTT_TASK_TAGS as readonly string[]).includes(items[i]!)) i++
    const candidate = items[i]
    if (candidate !== undefined && /^[\w-]+$/.test(candidate)) known.add(candidate)
  }

  for (const t of tasks) {
    for (const expr of [t.start, t.end]) {
      const m = expr?.match(AFTER_OR_UNTIL_RE)
      if (!m) continue
      for (const ref of m[1]!.split(/\s+/).filter(Boolean)) {
        if (!known.has(ref)) {
          warnings.push({ code: 'EDGE_MISANCHORED', edge: `${t.id}:${expr!.split(/\s+/)[0]}->${ref}` })
        }
      }
    }
  }

  return warnings
}
