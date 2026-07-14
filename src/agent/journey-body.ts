// ============================================================================
// Journey structured body (BUILD-15 pilot for promoting source-level families).
//
// The grammar lives in src/journey/parse-core.ts and is shared with the
// renderer parser, so the two surfaces cannot drift on documented syntax:
//   title <text>
//   accTitle: <text>
//   accDescr: <text>
//   accDescr { <multiline text> }
//   section <label>
//   <task text>: <score 1..5>[: <actor>[, <actor>…]]
//
// Structured-or-opaque with a typed reason: any line the grammar rejects
// yields the JourneyParseIssue that triggered opacity, so the caller can fall
// back to a lossless opaque body AND verify can say why. Render support stays
// unchanged — the legacy renderer keeps parsing canonical source.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  JourneyBody, JourneySection, JourneyTask, JourneyMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import {
  walkJourneyLines, normalizeJourneyText, normalizeJourneyActor,
  isValidJourneyScore, hasJourneyStatementDelimiter, JOURNEY_ACTOR_COLOR_LIMIT, type JourneyParseIssue,
} from '../journey/parse-core.ts'

// ---- Parser -----------------------------------------------------------------

export type JourneyBodyParse =
  | { ok: true; body: JourneyBody }
  | { ok: false; issue: JourneyParseIssue }

function formatJourneyInline(value: string): string {
  return value.split(/\r?\n/).map(part => part.trim()).join('<br>')
}

/**
 * Parse journey body lines (header excluded). Returns a structured body only
 * if EVERY non-blank, non-comment statement is modeled grammar with a valid
 * 1..5 integer score. Otherwise returns the first JourneyParseIssue so the
 * opaque fallback can carry its reason.
 */
export function parseJourneyBody(lines: string[], accessibility: import('./types.ts').Accessibility = {}): JourneyBodyParse {
  const body: JourneyBody = {
    kind: 'journey',
    sections: [],
    ...(accessibility.title !== undefined ? { accessibilityTitle: accessibility.title } : {}),
    ...(accessibility.descr !== undefined ? { accessibilityDescription: accessibility.descr } : {}),
  }
  let currentSection: JourneySection | undefined
  let sIdx = 0, tIdx = 0
  let firstIssue: JourneyParseIssue | undefined

  const implicitSection = (): JourneySection => {
    if (!currentSection) {
      currentSection = { id: `section-${sIdx++}`, tasks: [] }
      body.sections.push(currentSection)
    }
    return currentSection
  }

  walkJourneyLines(lines, 0, {
    title: text => { body.title = text },
    accTitle: text => { body.accessibilityTitle = text },
    accDescr: text => { body.accessibilityDescription = text },
    section: label => {
      currentSection = { id: `section-${sIdx++}`, label, tasks: [] }
      body.sections.push(currentSection)
    },
    task: (text, score, actors) => {
      implicitSection().tasks.push({ id: `task-${tIdx++}`, text, score, actors })
    },
    issue: issue => {
      firstIssue = issue
      return 'stop'
    },
  })

  if (firstIssue) return { ok: false, issue: firstIssue }

  // Upstream parity: title/acc metadata-only journeys are renderable header
  // furniture. A truly empty journey still stays opaque for source fidelity.
  if (body.sections.length === 0 && body.sections.every(s => s.tasks.length === 0) && !body.title && !body.accessibilityTitle && !body.accessibilityDescription) {
    return {
      ok: false,
      issue: { code: 'empty_journey', lineIndex: 0, statement: '', detail: 'Journey has no title, sections, or scored tasks' },
    }
  }

  return { ok: true, body }
}

// ---- Serializer -------------------------------------------------------------

export function renderJourney(body: JourneyBody): string {
  const lines: string[] = ['journey']
  if (body.title) lines.push(`  title ${formatJourneyInline(body.title)}`)
  if (body.accessibilityTitle) lines.push(`  accTitle: ${formatJourneyInline(body.accessibilityTitle)}`)
  if (body.accessibilityDescription) {
    if (body.accessibilityDescription.includes('\n')) {
      lines.push('  accDescr {')
      for (const line of body.accessibilityDescription.split(/\r?\n/)) {
        lines.push(`    ${line.trim()}`)
      }
      lines.push('  }')
    } else {
      lines.push(`  accDescr: ${formatJourneyInline(body.accessibilityDescription)}`)
    }
  }
  for (const section of body.sections) {
    if (section.label !== undefined) lines.push(`  section ${formatJourneyInline(section.label)}`)
    for (const task of section.tasks) {
      const actors = task.actors.length > 0 ? `: ${task.actors.join(', ')}` : ''
      lines.push(`    ${formatJourneyInline(task.text)}: ${task.score}${actors}`)
    }
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneJourney(b: JourneyBody): JourneyBody {
  return {
    kind: 'journey',
    title: b.title,
    accessibilityTitle: b.accessibilityTitle,
    accessibilityDescription: b.accessibilityDescription,
    sections: b.sections.map(s => ({
      id: s.id, label: s.label,
      tasks: s.tasks.map(t => ({ id: t.id, text: t.text, score: t.score, actors: [...t.actors] })),
    })),
  }
}

function makeIdAllocator(body: JourneyBody): (prefix: 'section' | 'task') => string {
  const seen = new Set<string>()
  for (const s of body.sections) { seen.add(s.id); for (const t of s.tasks) seen.add(t.id) }
  return prefix => {
    let n = 0
    while (seen.has(`${prefix}-${n}`)) n++
    const id = `${prefix}-${n}`
    seen.add(id)
    return id
  }
}

function normalizeOpText(value: string, field: string, opts: { allowColon?: boolean } = {}): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Journey ${field} must be a string` })
  const normalized = normalizeJourneyText(value)
  if (!normalized || (!opts.allowColon && normalized.includes(':')) || hasJourneyStatementDelimiter(normalized)) {
    return err({
      code: 'INVALID_OP',
      message: `Journey ${field} must be non-empty${opts.allowColon ? '' : ', must not contain :'}, and must not contain statement-delimiter semicolons`,
    })
  }
  return ok(normalized)
}

function resolveInsertIndex(index: number | undefined, length: number): Result<number, MutationError> {
  if (index === undefined) return ok(length)
  if (!Number.isInteger(index) || index < 0 || index > length) {
    return err({ code: 'INVALID_OP', message: `Journey insert index ${index} out of range (0..${length})` })
  }
  return ok(index)
}

/** Accessibility text is line-oriented free text, but `;` terminates a
 * journey statement and `{`/`}` delimit the accDescr block form — text
 * carrying them would not survive serialize → re-parse. null clears. */
function normalizeAccessibilityOpText(
  value: string | null,
  field: string,
): Result<string | undefined, MutationError> {
  if (value === null) return ok(undefined)
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Journey ${field} must be a string or null` })
  const normalized = normalizeJourneyText(value)
  if (!normalized || /[{}]/.test(normalized) || hasJourneyStatementDelimiter(normalized)) {
    return err({ code: 'INVALID_OP', message: `Journey ${field} must be non-empty and must not contain statement-delimiter semicolons, {, or }` })
  }
  return ok(normalized)
}

function normalizeActors(actors: string[] | undefined): Result<string[], MutationError> {
  const out: string[] = []
  for (const raw of actors ?? []) {
    if (typeof raw !== 'string') return err({ code: 'INVALID_OP', message: 'Journey actor must be a string' })
    const normalized = normalizeJourneyActor(raw)
    if (!normalized || normalized.includes(',') || hasJourneyStatementDelimiter(normalized)) {
      return err({ code: 'INVALID_OP', message: 'Journey actor must be non-empty and must not contain commas or statement-delimiter semicolons' })
    }
    out.push(normalized)
  }
  return ok(out)
}

export function mutateJourney(body: JourneyBody, op: JourneyMutationOp): Result<JourneyBody, MutationError> {
  const next = cloneJourney(body)
  const nextId = makeIdAllocator(next)

  const getSection = (i: number): JourneySection | undefined => next.sections[i]
  const getTask = (si: number, ti: number): JourneyTask | undefined => getSection(si)?.tasks[ti]

  switch (op.kind) {
    case 'set_title': {
      if (op.title === null) delete next.title
      else {
        const title = normalizeOpText(op.title, 'title', { allowColon: true })
        if (!title.ok) return title
        next.title = title.value
      }
      break
    }
    case 'add_section': {
      const label = normalizeOpText(op.label, 'section label')
      if (!label.ok) return label
      const index = resolveInsertIndex(op.index, next.sections.length)
      if (!index.ok) return index
      next.sections.splice(index.value, 0, { id: nextId('section'), label: label.value, tasks: [] })
      break
    }
    case 'remove_section': {
      if (!getSection(op.index)) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.index}` })
      next.sections.splice(op.index, 1)
      break
    }
    case 'set_section_label': {
      const s = getSection(op.index)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.index}` })
      const label = normalizeOpText(op.label, 'section label')
      if (!label.ok) return label
      s.label = label.value
      break
    }
    case 'add_task': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      const text = normalizeOpText(op.text, 'task text')
      if (!text.ok) return text
      if (!isValidJourneyScore(op.score)) return err({ code: 'INVALID_OP', message: `Journey score must be an integer 1..5, got ${op.score}` })
      const actors = normalizeActors(op.actors)
      if (!actors.ok) return actors
      const index = resolveInsertIndex(op.index, s.tasks.length)
      if (!index.ok) return index
      s.tasks.splice(index.value, 0, { id: nextId('task'), text: text.value, score: op.score, actors: actors.value })
      break
    }
    case 'remove_task': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      if (!s.tasks[op.taskIndex]) return err({ code: 'TASK_NOT_FOUND', message: `No task at index ${op.taskIndex}` })
      s.tasks.splice(op.taskIndex, 1)
      if (s.label === undefined && s.tasks.length === 0) next.sections.splice(op.sectionIndex, 1)
      break
    }
    case 'set_task_text': {
      const t = getTask(op.sectionIndex, op.taskIndex)
      if (!t) return err({ code: 'TASK_NOT_FOUND', message: `No task at (${op.sectionIndex},${op.taskIndex})` })
      const text = normalizeOpText(op.text, 'task text')
      if (!text.ok) return text
      t.text = text.value
      break
    }
    case 'set_task_score': {
      const t = getTask(op.sectionIndex, op.taskIndex)
      if (!t) return err({ code: 'TASK_NOT_FOUND', message: `No task at (${op.sectionIndex},${op.taskIndex})` })
      if (!isValidJourneyScore(op.score)) return err({ code: 'INVALID_OP', message: `Journey score must be an integer 1..5, got ${op.score}` })
      t.score = op.score
      break
    }
    case 'set_task_actors': {
      const t = getTask(op.sectionIndex, op.taskIndex)
      if (!t) return err({ code: 'TASK_NOT_FOUND', message: `No task at (${op.sectionIndex},${op.taskIndex})` })
      const actors = normalizeActors(op.actors)
      if (!actors.ok) return actors
      t.actors = actors.value
      break
    }
    case 'move_task': {
      const from = getSection(op.fromSection)
      if (!from) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.fromSection}` })
      if (!from.tasks[op.fromIndex]) return err({ code: 'TASK_NOT_FOUND', message: `No task at index ${op.fromIndex}` })
      const to = getSection(op.toSection)
      if (!to) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.toSection}` })
      const [task] = from.tasks.splice(op.fromIndex, 1)
      if (!Number.isInteger(op.toIndex) || op.toIndex < 0 || op.toIndex > to.tasks.length) {
        return err({ code: 'TASK_NOT_FOUND', message: `No insert position ${op.toIndex} in section ${op.toSection} (0..${to.tasks.length})` })
      }
      to.tasks.splice(op.toIndex, 0, task!)
      // remove_task parity: an emptied implicit (unlabeled) section disappears.
      if (from !== to && from.label === undefined && from.tasks.length === 0) {
        next.sections.splice(next.sections.indexOf(from), 1)
      }
      break
    }
    case 'move_section': {
      if (!getSection(op.from)) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.from}` })
      if (!Number.isInteger(op.to) || op.to < 0 || op.to >= next.sections.length) {
        return err({ code: 'SECTION_NOT_FOUND', message: `No section position ${op.to} (0..${next.sections.length - 1})` })
      }
      const [section] = next.sections.splice(op.from, 1)
      next.sections.splice(op.to, 0, section!)
      break
    }
    case 'set_accessibility_title': {
      const title = normalizeAccessibilityOpText(op.title, 'accessibility title')
      if (!title.ok) return title
      if (title.value === undefined) delete next.accessibilityTitle
      else next.accessibilityTitle = title.value
      break
    }
    case 'set_accessibility_description': {
      const description = normalizeAccessibilityOpText(op.description, 'accessibility description')
      if (!description.ok) return description
      if (description.value === undefined) delete next.accessibilityDescription
      else next.accessibilityDescription = description.value
      break
    }
    case 'rename_actor': {
      const fromActors = normalizeActors([op.from])
      if (!fromActors.ok) return fromActors
      const toActors = normalizeActors([op.to])
      if (!toActors.ok) return toActors
      const from = fromActors.value[0]!
      const to = toActors.value[0]!
      let found = false
      for (const s of next.sections) {
        for (const t of s.tasks) {
          t.actors = t.actors.map(a => {
            if (a === from) { found = true; return to }
            return a
          })
        }
      }
      if (!found) return err({ code: 'ACTOR_NOT_FOUND', message: `Actor "${from}" not found` })
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('journey', _x) })
    }
  }

  // Preserve the structured floor: a journey without a scored task cannot
  // render, so refuse mutations that would EMPTY a non-empty journey. A body
  // that starts empty (createMermaid/buildMermaid) may stay empty while ops
  // build it up — title/sections first, tasks after.
  const hadTask = body.sections.some(s => s.tasks.length > 0)
  if (hadTask && next.sections.every(s => s.tasks.length === 0)) {
    return err({ code: 'INVALID_OP', message: 'Journey must keep at least one scored task' })
  }

  // Construction postcondition: every successful edit must survive the exact
  // canonical serializer/parser waist with identical user-visible semantics.
  // Generated IDs are intentionally omitted because reparsing allocates them.
  const reparsed = parseJourneyBody(renderJourney(next).trimEnd().split(/\r?\n/).slice(1))
  if (!reparsed.ok || JSON.stringify(journeySemantics(reparsed.body)) !== JSON.stringify(journeySemantics(next))) {
    return err({ code: 'INVALID_OP', message: 'Journey edit cannot be represented losslessly by Mermaid syntax' })
  }

  return ok(next)
}

function journeySemantics(body: JourneyBody): unknown {
  return {
    title: body.title,
    accessibilityTitle: body.accessibilityTitle,
    accessibilityDescription: body.accessibilityDescription,
    sections: body.sections.map(section => ({
      label: section.label,
      tasks: section.tasks.map(task => ({ text: task.text, score: task.score, actors: task.actors })),
    })),
  }
}

// ---- Verifier (FamilyDescriptor.verify hook) --------------------------------

export function verifyJourney(body: JourneyBody, opts: VerifyOptions): LayoutWarning[] {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  const warnings: LayoutWarning[] = []
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  const hasTask = body.sections.some(s => s.tasks.length > 0)
  const hasHeaderFurniture = body.title !== undefined
    || body.accessibilityTitle !== undefined
    || body.accessibilityDescription !== undefined
    || body.sections.length > 0
  if (!hasTask && !hasHeaderFurniture) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) {
    const w = labelOverflowWarning('title', body.title, Math.max(cap, 80))
    if (w) warnings.push(w)
  }
  const actors = new Set(body.sections.flatMap(section => section.tasks.flatMap(task => task.actors)))
  if (actors.size > JOURNEY_ACTOR_COLOR_LIMIT) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'journey_actor_palette_limit',
      message: `Journey guarantees unique derived actor colors through ${JOURNEY_ACTOR_COLOR_LIMIT} actors; this diagram has ${actors.size}, so colors repeat deterministically above that bound.`,
    })
  }
  for (const s of body.sections) {
    if (s.label !== undefined) overflow(s.id, s.label)
    for (const t of s.tasks) {
      overflow(t.id, t.text)
      for (const a of t.actors) overflow(t.id, a)
    }
  }
  return warnings
}
