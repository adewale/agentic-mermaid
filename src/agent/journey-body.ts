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
//   <task text>: <finite score 1..5>[: <actor>[, <actor>…]]
//
// Structured-or-opaque with a typed reason: any line the grammar rejects
// yields the JourneyParseIssue that triggered opacity, so the caller can fall
// back to a lossless opaque body AND verify can say why. Render support stays
// unchanged — the legacy renderer keeps parsing canonical source.
// ============================================================================

import { toEntityMarkers } from '../shared/mermaid-entities.ts'
import { readAuthoredGrammarAccessibility, writeGrammarText } from '../shared/grammar-text.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type {
  JourneyBody, JourneySection, JourneyTask, JourneyMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { indexedIdAllocator, labelOverflowCollector, resolveInsertIndex, setOptionalField } from './body-utils.ts'
import {
  walkJourneyLines, normalizeJourneyText, normalizeJourneyActor,
  isValidJourneyScore, JOURNEY_ACTOR_COLOR_LIMIT, type JourneyParseIssue,
} from '../journey/parse-core.ts'

// ---- Parser -----------------------------------------------------------------

export type JourneyBodyParse =
  | { ok: true; body: JourneyBody }
  | { ok: false; issue: JourneyParseIssue }

type JourneyTextField = 'title' | 'section' | 'task' | 'actor'

function nonportableJourneyText(text: string, field: JourneyTextField): string | undefined {
  if (text.includes(';') || (field === 'task' && (text.includes('#') || /^journey\b/i.test(text)))) {
    return `Journey ${field} text "${text}" needs grammar escapes to preserve its literal text in pinned Mermaid`
  }
  return undefined
}

/** Diagnose authored tokens that require the field codec on export. */
export function journeyUnsupportedSyntaxWarnings(source: string): LayoutWarning[] {
  const lines = source.split(/\r?\n/)
  const header = lines.findIndex(line => /^\s*journey\b/i.test(line))
  const warnings = new Map<number, LayoutWarning>()
  const check = (text: string, field: JourneyTextField, lineIndex: number): void => {
    const lexical = toEntityMarkers(lines[lineIndex] ?? '')
    const problem = nonportableJourneyText(field === 'task' ? lexical.split(':', 1)[0]!.trim() : lexical, field)
    if (field === 'section' && /^\s*section\s+[^\n]*:/i.test(lexical) && !warnings.has(lineIndex)) warnings.set(lineIndex, {
      code: 'UNSUPPORTED_SYNTAX', syntax: 'journey_section_colon', line: lineIndex + 1, message: `Section label ${JSON.stringify(text)} is read literally; the writer escapes its colon for pinned Mermaid.`,
    })
    if (problem && !warnings.has(lineIndex)) warnings.set(lineIndex, {
      code: 'UNSUPPORTED_SYNTAX', syntax: 'journey_nonportable_text', line: lineIndex + 1,
      message: `${problem}. The writer protects this field with entity codes.`,
    })
  }
  walkJourneyLines(lines, header + 1, {
    title: (text, line) => check(text, 'title', line),
    section: (text, line) => check(text, 'section', line),
    task: (text, _score, actors, line) => {
      check(text, 'task', line)
      actors.forEach(actor => check(actor, 'actor', line))
    },
  })
  return [...warnings.values()]
}

function formatJourneyInline(value: string): string {
  return writeGrammarText(value.split(/\r?\n/).map(part => part.trim()).join('<br>'), ':;,%{}\\', /^(?:journey\b|title\s|section\s|accTitle\b|accDescr\b)/i)
}

/**
 * Parse journey body lines (header excluded). Returns a structured body only
 * if EVERY non-blank, non-comment statement is modeled grammar with a valid
 * finite 1..5 score. Otherwise returns the first JourneyParseIssue so the
 * opaque fallback can carry its reason.
 */
export function parseJourneyBody(lines: string[], accessibility: import('./types.ts').Accessibility = {}): JourneyBodyParse {
  accessibility = readAuthoredGrammarAccessibility(accessibility)
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
      firstIssue ??= issue
      return 'stop'
    },
  })

  if (firstIssue) return { ok: false, issue: firstIssue }

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
        lines.push(`    ${formatJourneyInline(line.trim())}`)
      }
      lines.push('  }')
    } else {
      lines.push(`  accDescr: ${formatJourneyInline(body.accessibilityDescription)}`)
    }
  }
  for (const section of body.sections) {
    if (section.label !== undefined) lines.push(`  section ${formatJourneyInline(section.label)}`)
    for (const task of section.tasks) {
      const actors = task.actors.length > 0 ? `: ${task.actors.map(formatJourneyInline).join(', ')}` : ''
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
  const ids = body.sections.flatMap(section => [section.id, ...section.tasks.map(task => task.id)])
  const section = indexedIdAllocator(ids, 'section')
  const task = indexedIdAllocator(ids, 'task')
  return prefix => prefix === 'section' ? section() : task()
}

function normalizeOpText(value: string, field: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Journey ${field} must be a string` })
  const normalized = normalizeJourneyText(value)
  if (!normalized) {
    return err({
      code: 'INVALID_OP',
      message: `Journey ${field} must be non-empty`,
    })
  }
  return ok(normalized)
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
  if (!normalized) {
    return err({ code: 'INVALID_OP', message: `Journey ${field} must be non-empty` })
  }
  return ok(normalized)
}

function normalizeActors(actors: string[] | undefined): Result<string[], MutationError> {
  const out: string[] = []
  for (const raw of actors ?? []) {
    if (typeof raw !== 'string') return err({ code: 'INVALID_OP', message: 'Journey actor must be a string' })
    const normalized = normalizeJourneyActor(raw)
    if (!normalized) {
      return err({ code: 'INVALID_OP', message: 'Journey actor must be non-empty' })
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
      const title = setOptionalField(next, 'title', op.title, value => normalizeOpText(value, 'title'))
      if (!title.ok) return title
      break
    }
    case 'add_section': {
      const label = normalizeOpText(op.label, 'section label')
      if (!label.ok) return label
      const index = resolveInsertIndex(op.index, next.sections.length, 'Journey')
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
      if (!isValidJourneyScore(op.score)) return err({ code: 'INVALID_OP', message: `Journey score must be a finite number 1..5, got ${op.score}` })
      const actors = normalizeActors(op.actors)
      if (!actors.ok) return actors
      const index = resolveInsertIndex(op.index, s.tasks.length, 'Journey')
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
      if (!isValidJourneyScore(op.score)) return err({ code: 'INVALID_OP', message: `Journey score must be a finite number 1..5, got ${op.score}` })
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

  // An implicit section has no source statement once its last task is removed.
  next.sections = next.sections.filter(section => section.label !== undefined || section.tasks.length > 0)

  // Construction postcondition: every successful edit must survive the exact
  // canonical serializer/parser waist with identical user-visible semantics.
  // Generated IDs are intentionally omitted because reparsing allocates them.
  const reparsed = parseJourneyBody(renderJourney(next).trimEnd().split(/\r?\n/).slice(1))
  if (!reparsed.ok || JSON.stringify(journeySemantics(reparsed.body)) !== JSON.stringify(journeySemantics(next))) {
    return err({ code: 'INVALID_OP', message: 'Journey edit cannot be represented losslessly by Mermaid syntax' })
  }

  return ok(reparsed.body)
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
  const overflow = labelOverflowCollector(warnings, opts, cap)
  const hasTask = body.sections.some(s => s.tasks.length > 0)
  const hasHeaderFurniture = body.title !== undefined
    || body.accessibilityTitle !== undefined
    || body.accessibilityDescription !== undefined
    || body.sections.length > 0
  if (!hasTask && !hasHeaderFurniture) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) {
    labelOverflowCollector(warnings, opts, Math.max(cap, 80))('title', body.title)
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
