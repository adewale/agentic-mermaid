// ============================================================================
// Gantt structured body: parse / serialize / mutate / verify (FamilyPlugin
// hooks) — docs/design/families/gantt.md §"First-release syntax matrix".
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

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  GanttBody, GanttBodySection, GanttBodyTask, GanttBodyTaskTag,
  GanttStatement, GanttMutationOp, MutationError, Result, VerifyOptions, LayoutWarning,
} from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { parseGanttTaskMeta, renderGanttTaskMeta, GANTT_TASK_TAGS, type ParsedTaskMeta } from '../gantt/parser.ts'
import { appendOpaqueSegment } from './opaque-segments.ts'

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
      if (line.startsWith('%%')) appendOpaqueSegment(statements, [rawLine], ganttOpaqueBlock)
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
      appendOpaqueSegment(statements, blockLines, ganttOpaqueBlock)
      continue
    }

    if (DIRECTIVE_LINE_RE.test(line)) {
      appendOpaqueSegment(statements, [rawLine], ganttOpaqueBlock)
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
    appendOpaqueSegment(statements, [rawLine], ganttOpaqueBlock)
    i++
  }

  return body
}

function canonicalTags(tags: GanttBodyTaskTag[]): GanttBodyTaskTag[] {
  return GANTT_TASK_TAGS.filter(t => tags.includes(t)) as GanttBodyTaskTag[]
}

const ganttOpaqueBlock = (lines: string[]): GanttStatement => ({ kind: 'opaque-block', lines })


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

function resolveInsertIndex(index: number | undefined, length: number): Result<number, MutationError> {
  if (index === undefined) return ok(length)
  if (!Number.isInteger(index) || index < 0 || index > length) {
    return err({ code: 'INVALID_OP', message: `Gantt insert index ${index} out of range (0..${length})` })
  }
  return ok(index)
}

/** Tasks in flat serialization order — statement order IS source order, and
 *  source order IS gantt scheduling semantics (implicit starts chain from the
 *  previous task in this order, across section boundaries). */
function flatTasks(body: GanttBody): GanttBodyTask[] {
  const out: GanttBodyTask[] = []
  for (const st of body.statements ?? []) {
    if (st.kind !== 'task') continue
    const t = body.sections[st.section]?.tasks[st.ref]
    if (t) out.push(t)
  }
  return out
}

/**
 * The implicit-start guard for ordering ops: a task without a start begins
 * when the PREVIOUS task ends, so any reorder that changes an implicit-start
 * task's predecessor silently reschedules it. Ordering ops reject with the
 * fix in the message instead of guessing (the caller materializes an explicit
 * start first). add_task with an insert index is the deliberate exception:
 * re-chaining the follower onto the inserted task is the point of a mid-chain
 * insert, and the new task is visible in the diff.
 */
function implicitChainError(opKind: string, before: GanttBodyTask[], after: GanttBodyTask[]): MutationError | null {
  const disturbed: string[] = []
  for (let i = 0; i < after.length; i++) {
    const task = after[i]!
    if (task.start !== undefined) continue
    const prevBefore = before[before.indexOf(task) - 1]
    if (prevBefore !== after[i - 1]) disturbed.push(task.label)
  }
  if (disturbed.length === 0) return null
  const names = disturbed.map(l => `"${l}"`).join(', ')
  return {
    code: 'INVALID_OP',
    message: `${opKind} would silently change the schedule: task(s) ${names} have an implicit start `
      + `(they begin when the previous task in source order ends) and this move changes their predecessor. `
      + `Materialize an explicit start first — set_task_dates with the resolved start date (read it from `
      + `describe/analyze) or an "after <taskId>" dependency — then retry the move.`,
  }
}

// ---- set_task_id reference scanning/rewriting --------------------------------

const REF_EXPR_RE = /\b(?:after|until)\s+([^,:#]+)/gi

/** Structured tasks whose after/until expressions reference `id`. */
function tasksReferencing(body: GanttBody, id: string): GanttBodyTask[] {
  const out: GanttBodyTask[] = []
  for (const s of body.sections) {
    for (const t of s.tasks) {
      for (const expr of [t.start, t.end]) {
        const m = expr?.match(AFTER_OR_UNTIL_RE)
        if (m && m[1]!.split(/\s+/).includes(id)) {
          out.push(t)
          break
        }
      }
    }
  }
  return out
}

/** Opaque lines where `id` acts as a task reference: click targets and
 *  after/until token lists inside unmodeled task-shaped lines. Ids match
 *  [\w-]+ (TASK_ID_RE), so interpolating them into a regex needs no escaping. */
function opaqueLinesReferencing(body: GanttBody, id: string): string[] {
  const clickRe = new RegExp(`^click\\s+${id}(?:\\s|$)`, 'i')
  const out: string[] = []
  for (const st of body.statements ?? []) {
    if (st.kind !== 'opaque-block') continue
    for (const raw of st.lines) {
      const line = raw.trim()
      if (!line || line.startsWith('%%')) continue
      if (clickRe.test(line)) { out.push(line); continue }
      for (const m of line.matchAll(REF_EXPR_RE)) {
        if (m[1]!.trim().split(/\s+/).includes(id)) { out.push(line); break }
      }
    }
  }
  return out
}

/** Rewrite `oldId` → `newId` inside an `after …`/`until …` expression. */
function rewriteRefExpr(expr: string, keyword: 'after' | 'until', oldId: string, newId: string): string {
  if (!expr.startsWith(`${keyword} `)) return expr
  const refs = expr.slice(keyword.length + 1).split(/\s+/).filter(Boolean)
  if (!refs.includes(oldId)) return expr
  return `${keyword} ${refs.map(ref => (ref === oldId ? newId : ref)).join(' ')}`
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
      const index = resolveInsertIndex(op.index, s.tasks.length)
      if (!index.ok) return index
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
      s.tasks.splice(index.value, 0, task)
      insertTaskStatement(statements, op.sectionIndex, index.value)
      break
    }
    case 'remove_task': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      if (!s.tasks[op.taskIndex]) return err({ code: 'TASK_NOT_FOUND', message: `No task at index ${op.taskIndex}` })
      s.tasks.splice(op.taskIndex, 1)
      removeTaskStatement(statements, op.sectionIndex, op.taskIndex)
      break
    }
    case 'move_task': {
      const from = getSection(op.fromSection)
      if (!from) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.fromSection}` })
      const task = from.tasks[op.fromIndex]
      if (!task) return err({ code: 'TASK_NOT_FOUND', message: `No task at index ${op.fromIndex}` })
      const to = getSection(op.toSection)
      if (!to) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.toSection}` })
      const before = flatTasks(body)
      from.tasks.splice(op.fromIndex, 1)
      removeTaskStatement(statements, op.fromSection, op.fromIndex)
      if (!Number.isInteger(op.toIndex) || op.toIndex < 0 || op.toIndex > to.tasks.length) {
        return err({ code: 'TASK_NOT_FOUND', message: `No insert position ${op.toIndex} in section ${op.toSection} (0..${to.tasks.length})` })
      }
      to.tasks.splice(op.toIndex, 0, task)
      insertTaskStatement(statements, op.toSection, op.toIndex)
      const chain = implicitChainError('move_task', before, flatTasks(body))
      if (chain) return err(chain)
      break
    }
    case 'move_section': {
      const section = getSection(op.from)
      if (!section) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.from}` })
      if (!Number.isInteger(op.to) || op.to < 0 || op.to >= body.sections.length) {
        return err({ code: 'SECTION_NOT_FOUND', message: `No section position ${op.to} (0..${body.sections.length - 1})` })
      }
      if (section.label === undefined) {
        return err({
          code: 'INVALID_OP',
          message: 'Cannot move the implicit (unlabeled) section: its tasks precede the first "section" line by construction. Move the labeled sections around it instead.',
        })
      }
      if (body.sections[0]?.label === undefined && op.to === 0) {
        return err({
          code: 'INVALID_OP',
          message: 'Position 0 is held by the implicit (unlabeled) section — tasks before the first "section" line. The earliest position for a labeled section is 1.',
        })
      }
      if (op.to === op.from) break
      const before = flatTasks(body)
      const { preamble, spans } = sectionSpans(statements)
      const spanByOld = new Map(spans.map(sp => [sp.sectionIndex, sp]))
      for (let i = 0; i < body.sections.length; i++) {
        if (body.sections[i]!.label !== undefined && !spanByOld.has(i)) {
          return err({ code: 'INVALID_OP', message: `move_section: section ${i} has no section statement to move` })
        }
      }
      // oldIndexes[newIndex] = oldIndex — the reorder applied to index space.
      const oldIndexes = body.sections.map((_, i) => i)
      oldIndexes.splice(op.from, 1)
      oldIndexes.splice(op.to, 0, op.from)
      const newIndexOf = new Array<number>(body.sections.length)
      oldIndexes.forEach((old, nw) => { newIndexOf[old] = nw })

      const [moved] = body.sections.splice(op.from, 1)
      body.sections.splice(op.to, 0, moved!)

      // Whole statement SPANS travel: a section's header, tasks, and any
      // interleaved opaque lines move as one block; the preamble (title,
      // directives, implicit-section tasks) never moves.
      statements.length = 0
      statements.push(...preamble, ...oldIndexes.filter(old => spanByOld.has(old)).flatMap(old => spanByOld.get(old)!.statements))
      for (const st of statements) {
        if (st.kind === 'section') st.ref = newIndexOf[st.ref]!
        else if (st.kind === 'task') st.section = newIndexOf[st.section]!
      }
      const chain = implicitChainError('move_section', before, flatTasks(body))
      if (chain) return err(chain)
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
    case 'set_task_flags': {
      const t = getTask(op.sectionIndex, op.taskIndex)
      if (!t) return err({ code: 'TASK_NOT_FOUND', message: `No task at (${op.sectionIndex},${op.taskIndex})` })
      const tags = new Set<GanttBodyTaskTag>(t.tags)
      if (op.milestone !== undefined) { if (op.milestone) tags.add('milestone'); else tags.delete('milestone') }
      if (op.vert !== undefined) { if (op.vert) tags.add('vert'); else tags.delete('vert') }
      const candidate = { ...t, tags: canonicalTags([...tags]) }
      const bad = validateTask(candidate)
      if (bad) return err(bad)
      t.tags = candidate.tags
      break
    }
    case 'set_task_id': {
      // Reference-coherence contract (documented in docs/design/families/
      // gantt.md): renames REWRITE structured after/until references so the
      // dependency graph never dangles; opaque references (click lines,
      // unmodeled task lines) REJECT the rename because typed ops never edit
      // opaque source; clearing (null) REJECTS while any reference exists —
      // there is nothing to retarget the referents to.
      const t = getTask(op.sectionIndex, op.taskIndex)
      if (!t) return err({ code: 'TASK_NOT_FOUND', message: `No task at (${op.sectionIndex},${op.taskIndex})` })
      const oldId = t.taskId
      if (op.taskId === null) {
        if (oldId === undefined) break
        const structuredRefs = tasksReferencing(body, oldId).filter(rt => rt !== t)
        const opaqueRefs = opaqueLinesReferencing(body, oldId)
        if (structuredRefs.length > 0 || opaqueRefs.length > 0) {
          const referents = [
            ...structuredRefs.map(rt => `task "${rt.label}"`),
            ...opaqueRefs.map(l => `opaque line "${l}"`),
          ].join(', ')
          return err({
            code: 'INVALID_OP',
            message: `Cannot clear task id "${oldId}": it is referenced by ${referents}. `
              + `Retarget or remove those references first (set_task_dates on the referencing tasks; opaque lines are edited at the source level).`,
          })
        }
        const cleared = { ...t, taskId: undefined }
        const bad = validateTask(cleared)
        if (bad) return err(bad)
        t.taskId = undefined
        break
      }
      const newId = op.taskId.trim()
      if (!TASK_ID_RE.test(newId)) {
        return err({ code: 'INVALID_OP', message: `Gantt task id "${newId}" must match ${TASK_ID_RE}` })
      }
      if (newId === oldId) break
      if (allTaskIds(body).has(newId)) {
        return err({ code: 'DUPLICATE_TASK', message: `Task id "${newId}" already exists` })
      }
      if (oldId !== undefined) {
        const opaqueRefs = opaqueLinesReferencing(body, oldId)
        if (opaqueRefs.length > 0) {
          return err({
            code: 'INVALID_OP',
            message: `Cannot rename task id "${oldId}": it is referenced from opaque segment(s) ${opaqueRefs.map(l => `"${l}"`).join(', ')} `
              + `— typed ops never rewrite opaque lines (click/comments/unmodeled syntax). Edit those lines at the source level first.`,
          })
        }
      }
      const candidate = { ...t, taskId: newId }
      const bad = validateTask(candidate)
      if (bad) return err(bad)
      t.taskId = newId
      if (oldId !== undefined) {
        for (const s of body.sections) {
          for (const rt of s.tasks) {
            if (rt.start !== undefined) rt.start = rewriteRefExpr(rt.start, 'after', oldId, newId)
            rt.end = rewriteRefExpr(rt.end, 'until', oldId, newId)
          }
        }
      }
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('gantt', _x) })
    }
  }
  return ok(body)
}

function removeAll(statements: GanttStatement[], pred: (s: GanttStatement) => boolean): void {
  for (let i = statements.length - 1; i >= 0; i--) if (pred(statements[i]!)) statements.splice(i, 1)
}

// Insert a task statement so it serializes at position `taskRef` within its
// section: later same-section refs shift up, and the statement lands right
// before the task it displaced — or after the section's last statement (the
// header or its last task) when appending, so serialization keeps tasks under
// the right `section` line even with directives interleaved.
function insertTaskStatement(statements: GanttStatement[], sectionIndex: number, taskRef: number): void {
  for (const st of statements) {
    if (st.kind === 'task' && st.section === sectionIndex && st.ref >= taskRef) st.ref++
  }
  let insertAt = -1
  let lastOfSection = -1
  for (let i = 0; i < statements.length; i++) {
    const st = statements[i]!
    if (st.kind === 'section' && st.ref === sectionIndex) lastOfSection = i
    if (st.kind === 'task' && st.section === sectionIndex) {
      if (st.ref > taskRef && insertAt === -1) insertAt = i
      lastOfSection = i
    }
  }
  const st: GanttStatement = { kind: 'task', section: sectionIndex, ref: taskRef }
  if (insertAt >= 0) statements.splice(insertAt, 0, st)
  else if (lastOfSection >= 0) statements.splice(lastOfSection + 1, 0, st)
  else statements.push(st)
}

/** Remove a task's statement and close the ref gap it leaves. */
function removeTaskStatement(statements: GanttStatement[], sectionIndex: number, taskRef: number): void {
  removeAll(statements, st => st.kind === 'task' && st.section === sectionIndex && st.ref === taskRef)
  for (const st of statements) {
    if (st.kind === 'task' && st.section === sectionIndex && st.ref > taskRef) st.ref--
  }
}

/**
 * Partition the statement stream into the preamble (everything before the
 * first `section` statement: title, directives, implicit-section tasks) and
 * one contiguous span per labeled section — the section header plus every
 * following statement up to the next header, opaque lines included. Only task
 * statements of the span's own section can appear inside it (tasks always
 * attach to the current section at parse time, and insertTaskStatement keeps
 * new ones inside their section's span).
 */
function sectionSpans(statements: GanttStatement[]): {
  preamble: GanttStatement[]
  spans: Array<{ sectionIndex: number; statements: GanttStatement[] }>
} {
  const preamble: GanttStatement[] = []
  const spans: Array<{ sectionIndex: number; statements: GanttStatement[] }> = []
  let current: { sectionIndex: number; statements: GanttStatement[] } | null = null
  for (const st of statements) {
    if (st.kind === 'section') {
      current = { sectionIndex: st.ref, statements: [st] }
      spans.push(current)
      continue
    }
    if (current) current.statements.push(st)
    else preamble.push(st)
  }
  return { preamble, spans }
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

  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  if (body.title !== undefined) overflow('title', body.title)
  for (const s of body.sections) {
    if (s.label !== undefined) overflow(s.id, s.label)
    for (const t of s.tasks) overflow(t.id, t.label)
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
