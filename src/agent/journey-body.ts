// ============================================================================
// Journey structured body (BUILD-15 pilot for promoting source-level families).
//
// Modeled grammar (mirrors the legacy renderer parser, src/journey/parser.ts):
//   title <text>
//   section <label>
//   <task text>: <score 1..5>[: <actor>[, <actor>…]]
//
// Structured-or-opaque: any other non-blank, non-comment line (accTitle,
// accDescr, unmodeled syntax, out-of-range scores) returns null so the caller
// falls back to a lossless opaque body. Render support stays unchanged — the
// legacy renderer keeps parsing canonical source.
// ============================================================================

import type {
  JourneyBody, JourneySection, JourneyTask, JourneyMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'

// ---- Parser -----------------------------------------------------------------

const TITLE_RE = /^title\s+(.+)$/i
const SECTION_RE = /^section\s+(.+)$/i
const TASK_RE = /^(.+?)\s*:\s*([0-9]+)\s*(?::\s*(.*))?$/

function normalizeText(value: string): string {
  return value.split(/\r?\n/).map(part => part.trim()).filter(Boolean).join(' ')
}

function validScore(score: number): boolean {
  return Number.isInteger(score) && score >= 1 && score <= 5
}

/**
 * Parse journey body lines (header excluded). Returns a structured body only
 * if EVERY non-blank, non-comment line is a title, section, or task with a
 * valid 1..5 integer score. Otherwise returns null (opaque fallback).
 */
export function parseJourneyBody(lines: string[]): JourneyBody | null {
  const body: JourneyBody = { kind: 'journey', sections: [] }
  let currentSection: JourneySection | undefined
  let sIdx = 0, tIdx = 0

  const implicitSection = (): JourneySection => {
    if (!currentSection) {
      currentSection = { id: `section-${sIdx++}`, tasks: [] }
      body.sections.push(currentSection)
    }
    return currentSection
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const tm = line.match(TITLE_RE)
    if (tm) {
      const title = normalizeText(tm[1]!)
      if (!title || title.includes(':')) return null
      body.title = title
      continue
    }

    const sm = line.match(SECTION_RE)
    if (sm) {
      const label = normalizeText(sm[1]!)
      if (!label) return null
      currentSection = { id: `section-${sIdx++}`, label, tasks: [] }
      body.sections.push(currentSection)
      continue
    }

    const km = line.match(TASK_RE)
    if (km) {
      const text = normalizeText(km[1]!)
      const score = Number.parseInt(km[2]!, 10)
      if (!text || text.includes(':') || !validScore(score)) return null
      const actors = (km[3] ?? '')
        .split(',')
        .map(normalizeText)
        .filter(Boolean)
      if (actors.some(a => a.includes(':'))) return null
      implicitSection().tasks.push({ id: `task-${tIdx++}`, text, score, actors })
      continue
    }

    // Unmodeled line (accTitle/accDescr/anything else) → opaque fallback.
    return null
  }

  // The legacy renderer rejects journeys without a single scored task;
  // model the same floor so structured bodies always render.
  if (body.sections.every(s => s.tasks.length === 0)) return null

  return body
}

// ---- Serializer -------------------------------------------------------------

export function renderJourney(body: JourneyBody): string {
  const lines: string[] = ['journey']
  if (body.title) lines.push(`  title ${body.title}`)
  for (const section of body.sections) {
    if (section.label !== undefined) lines.push(`  section ${section.label}`)
    for (const task of section.tasks) {
      const actors = task.actors.length > 0 ? `: ${task.actors.join(', ')}` : ''
      lines.push(`    ${task.text}: ${task.score}${actors}`)
    }
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneJourney(b: JourneyBody): JourneyBody {
  return {
    kind: 'journey',
    title: b.title,
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
  const normalized = normalizeText(value)
  if (!normalized || (!opts.allowColon && normalized.includes(':'))) {
    return err({ code: 'INVALID_OP', message: `Journey ${field} must be non-empty and must not contain :` })
  }
  return ok(normalized)
}

function normalizeActors(actors: string[] | undefined): Result<string[], MutationError> {
  const out: string[] = []
  for (const raw of actors ?? []) {
    const a = normalizeOpText(raw, 'actor')
    if (!a.ok) return a
    out.push(a.value)
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
        const title = normalizeOpText(op.title, 'title')
        if (!title.ok) return title
        next.title = title.value
      }
      break
    }
    case 'add_section': {
      const label = normalizeOpText(op.label, 'section label', { allowColon: true })
      if (!label.ok) return label
      next.sections.push({ id: nextId('section'), label: label.value, tasks: [] })
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
      const label = normalizeOpText(op.label, 'section label', { allowColon: true })
      if (!label.ok) return label
      s.label = label.value
      break
    }
    case 'add_task': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      const text = normalizeOpText(op.text, 'task text')
      if (!text.ok) return text
      if (!validScore(op.score)) return err({ code: 'INVALID_OP', message: `Journey score must be an integer 1..5, got ${op.score}` })
      const actors = normalizeActors(op.actors)
      if (!actors.ok) return actors
      s.tasks.push({ id: nextId('task'), text: text.value, score: op.score, actors: actors.value })
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
      if (!validScore(op.score)) return err({ code: 'INVALID_OP', message: `Journey score must be an integer 1..5, got ${op.score}` })
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
    case 'rename_actor': {
      const from = normalizeOpText(op.from, 'actor')
      if (!from.ok) return from
      const to = normalizeOpText(op.to, 'actor')
      if (!to.ok) return to
      let found = false
      for (const s of next.sections) {
        for (const t of s.tasks) {
          t.actors = t.actors.map(a => {
            if (a === from.value) { found = true; return to.value }
            return a
          })
        }
      }
      if (!found) return err({ code: 'ACTOR_NOT_FOUND', message: `Actor "${from.value}" not found` })
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_x)}` })
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

  return ok(next)
}

// ---- Verifier (FamilyPlugin.verify hook) ------------------------------------

export function verifyJourney(body: JourneyBody, opts: VerifyOptions): LayoutWarning[] {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  const warnings: LayoutWarning[] = []
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  if (body.sections.every(s => s.tasks.length === 0)) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) overflow('title', body.title)
  for (const s of body.sections) {
    if (s.label !== undefined) overflow(s.id, s.label)
    for (const t of s.tasks) {
      overflow(t.id, t.text)
      for (const a of t.actors) overflow(t.id, a)
    }
  }
  return warnings
}
