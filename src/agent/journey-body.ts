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

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  JourneyBody, JourneySection, JourneyTask, JourneyMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { indexedIdAllocator, labelOverflowCollector, resolveInsertIndex, setOptionalField } from './body-utils.ts'
import { encodeMermaidEntities, toEntityMarkers } from '../shared/mermaid-entities.ts'
import { readAuthoredGrammarAccessibility, writeGrammarText } from '../shared/grammar-text.ts'
import { prepareDisplayText, resolveLabelContent, writeDisplayText, type LabelContent } from '../shared/display-text.ts'
import {
  walkJourneyLines, normalizeJourneyText, normalizeJourneyActor,
  isValidJourneyScore, journeyActorKey, JOURNEY_ACTOR_COLOR_LIMIT, type JourneyParseIssue,
} from '../journey/parse-core.ts'

// ---- Parser -----------------------------------------------------------------

export type JourneyBodyParse =
  | { ok: true; body: JourneyBody }
  | { ok: false; issue: JourneyParseIssue }

function formatJourneyInline(value: string): string {
  return writeGrammarText(value.split(/\r?\n/).map(part => part.trim()).join('<br>'), ':;,%{}\\')
}

function serializeJourneyLabel(value: string, content?: LabelContent): string {
  const prepared = prepareDisplayText(resolveLabelContent(value, content))
  const source = writeDisplayText(prepared, text => encodeMermaidEntities(text, ';&#:,%<*~').replace(/\\(?=n)/g, '#92;')
    .replace(/^\s+|\s+$/g, spaces => encodeMermaidEntities(spaces, spaces)))
  // A task label can otherwise be read as a title/section/accessibility line.
  return /^(?:journey|title|section|accTitle|accDescr)\b/i.test(source)
    ? `#${source.codePointAt(0)!};${source.slice(1)}` : source
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
    title: (text, _line, content) => {
      body.title = text
      if (content) body.titleContent = content
      else delete body.titleContent
    },
    accTitle: text => { body.accessibilityTitle = text },
    accDescr: text => { body.accessibilityDescription = text },
    section: (label, _line, content) => {
      currentSection = { id: `section-${sIdx++}`, label, ...(content ? { labelContent: content } : {}), tasks: [] }
      body.sections.push(currentSection)
    },
    task: (text, score, actors, _line, content, actorContents) => {
      implicitSection().tasks.push({ id: `task-${tIdx++}`, text, ...(content ? { textContent: content } : {}), score, actors, ...(actorContents ? { actorContents } : {}) })
    },
    issue: issue => {
      firstIssue = issue
      return 'stop'
    },
  })

  if (firstIssue) return { ok: false, issue: firstIssue }

  return { ok: true, body }
}

// ---- Serializer -------------------------------------------------------------

export function renderJourney(body: JourneyBody): string {
  const lines: string[] = ['journey']
  if (body.title) lines.push(`  title ${serializeJourneyLabel(body.title, body.titleContent)}`)
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
    if (section.label !== undefined) lines.push(`  section ${serializeJourneyLabel(section.label, section.labelContent)}`)
    for (const task of section.tasks) {
      const actors = task.actors.length > 0 ? `: ${task.actors.map((actor, index) => serializeJourneyLabel(actor, task.actorContents?.[index])).join(', ')}` : ''
      lines.push(`    ${serializeJourneyLabel(task.text, task.textContent)}: ${task.score}${actors}`)
    }
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneJourney(b: JourneyBody): JourneyBody {
  return {
    ...b,
    sections: b.sections.map(s => ({
      ...s,
      tasks: s.tasks.map(t => ({ ...t, actors: [...t.actors] })),
    })),
  }
}

function makeIdAllocator(body: JourneyBody): (prefix: 'section' | 'task') => string {
  const ids = body.sections.flatMap(section => [section.id, ...section.tasks.map(task => task.id)])
  const section = indexedIdAllocator(ids, 'section')
  const task = indexedIdAllocator(ids, 'task')
  return prefix => prefix === 'section' ? section() : task()
}

function normalizeOpText(value: string, field: string, previous?: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Journey ${field} must be a string` })
  const normalized = value === previous ? value : normalizeJourneyText(value)
  if (!normalized) {
    return err({
      code: 'INVALID_OP',
      message: `Journey ${field} must be non-empty`,
    })
  }
  return ok(normalized)
}

/** Accessibility values are logical text. Their writer owns statement and
 * block delimiters; callers do not pre-escape punctuation. null clears. */
function normalizeAccessibilityOpText(
  value: string | null,
  field: string,
): Result<string | undefined, MutationError> {
  if (value === null) return ok(undefined)
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Journey ${field} must be a string or null` })
  const normalized = normalizeJourneyText(value)
  if (!normalized) return err({ code: 'INVALID_OP', message: `Journey ${field} must be non-empty` })
  return ok(normalized)
}

function normalizeActors(actors: string[] | undefined, previous: readonly string[] = []): Result<string[], MutationError> {
  const out: string[] = []
  for (const raw of actors ?? []) {
    if (typeof raw !== 'string') return err({ code: 'INVALID_OP', message: 'Journey actor must be a string' })
    const normalized = previous.includes(raw) ? raw : normalizeJourneyActor(raw)
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
      const previous = next.title
      const title = setOptionalField(next, 'title', op.title, value => normalizeOpText(value, 'title', previous))
      if (!title.ok) return title
      if (next.title !== previous) delete next.titleContent
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
      const label = normalizeOpText(op.label, 'section label', s.label)
      if (!label.ok) return label
      if (s.label !== label.value) delete s.labelContent
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
      const text = normalizeOpText(op.text, 'task text', t.text)
      if (!text.ok) return text
      if (t.text !== text.value) delete t.textContent
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
      const actors = normalizeActors(op.actors, t.actors)
      if (!actors.ok) return actors
      if (t.actorContents) {
        // A string-only replacement cannot identify reordered equal strings
        // with different formatting. Keep unchanged positions first, then
        // retain unmatched occurrences in their original order.
        const unchanged = new Set(actors.value.flatMap((actor, index) => actor === t.actors[index] ? [index] : []))
        const previous = new Map<string, Array<LabelContent | undefined>>()
        const meanings = new Map<string, { key: string; content?: LabelContent; ambiguous: boolean }>()
        t.actors.forEach((actor, index) => {
          const content = t.actorContents?.[index]
          const key = journeyActorKey(actor, content)
          const meaning = meanings.get(actor)
          meanings.set(actor, { key, content, ambiguous: meaning !== undefined && (meaning.ambiguous || meaning.key !== key) })
          if (unchanged.has(index)) return
          const contents = previous.get(actor) ?? []
          contents.push(content)
          previous.set(actor, contents)
        })
        let ambiguous = false
        t.actorContents = actors.value.map((actor, index) => {
          if (unchanged.has(index)) return t.actorContents?.[index]
          const contents = previous.get(actor)
          if (contents?.length) return contents.shift()
          const meaning = meanings.get(actor)
          if (meaning?.ambiguous) ambiguous = true
          return meaning?.content
        })
        if (ambiguous) return err({ code: 'INVALID_OP', message: 'Journey actor has multiple existing text interpretations; a new copy needs a distinct label' })
      }
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
      const existing = next.sections.flatMap(section => section.tasks.flatMap(task => task.actors))
      const fromActors = normalizeActors([op.from], existing)
      if (!fromActors.ok) return fromActors
      const toActors = normalizeActors([op.to], existing)
      if (!toActors.ok) return toActors
      const from = fromActors.value[0]!
      const to = toActors.value[0]!
      let found = false
      for (const s of next.sections) {
        for (const t of s.tasks) {
          t.actors = t.actors.map((a, index) => {
            if (a === from) {
              found = true
              if (t.actorContents && from !== to) t.actorContents = t.actorContents.map((content, contentIndex) => contentIndex === index ? undefined : content)
              return to
            }
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
  const label = (value: string | undefined, content?: LabelContent): unknown => value === undefined ? undefined : {
    value,
    runs: prepareDisplayText(resolveLabelContent(value, content)).lines.map(line => line.map(({ text, bold, italic, underline, strikethrough }) => ({ text, bold, italic, underline, strikethrough }))),
  }
  return {
    title: label(body.title, body.titleContent),
    accessibilityTitle: body.accessibilityTitle,
    accessibilityDescription: body.accessibilityDescription,
    sections: body.sections.map(section => ({
      label: label(section.label, section.labelContent),
      tasks: section.tasks.map(task => ({ text: label(task.text, task.textContent), score: task.score, actors: task.actors.map((actor, index) => label(actor, task.actorContents?.[index])) })),
    })),
  }
}

// ---- Verifier (FamilyDescriptor.verify hook) --------------------------------

export function journeyUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  const lines = canonicalSource.split(/\r?\n/)
  const header = lines.findIndex(line => /^\s*journey\b/i.test(line))
  if (header < 0) return []
  const affectedLines = new Set<number>()
  const statementLines = new Set<number>()
  walkJourneyLines(lines, header + 1, {
    entitySemicolon: index => affectedLines.add(index + 1),
    statementDelimiter: index => statementLines.add(index + 1),
  })
  const warnings = (indices: Set<number>, syntax: string, message: string): LayoutWarning[] => [...indices].map(line => ({
    code: 'UNSUPPORTED_SYNTAX', syntax, line, message,
  }))
  const fieldWarnings: LayoutWarning[] = []
  walkJourneyLines(lines, header + 1, {
    task: (_text, _score, _actors, index) => {
      const token = toEntityMarkers(lines[index] ?? '').split(':', 1)[0]!.trim()
      if (token.includes('#') || /^journey\b/i.test(token)) fieldWarnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'journey_nonportable_text', line: index + 1, message: 'Journey task text requires grammar escapes to preserve its literal hash or keyword prefix in pinned Mermaid.' })
    },
    section: (label, index) => {
      if (/^\s*section\s+[^\n]*:/i.test(toEntityMarkers(lines[index] ?? ''))) fieldWarnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'journey_section_colon', line: index + 1, message: `Journey section ${JSON.stringify(label)} contains a colon read as label text; the writer protects it for pinned Mermaid.` })
    },
  })
  return [
    ...fieldWarnings,
    ...warnings(statementLines, 'journey_semicolon_statement_extension', 'Semicolon-separated Journey statements are an Agentic Mermaid extension; pinned Mermaid rejects this source. Put each statement on its own line for upstream portability.'),
    ...warnings(affectedLines, 'journey_entity_semicolon', 'Pinned Mermaid does not read these as HTML references in Journey labels or actors: it rejects named-reference semicolons and reads numeric references differently. The writer preserves their text with Mermaid entity escapes.'),
  ]
}

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
    labelOverflowCollector(warnings, opts, Math.max(cap, 80))('title', resolveLabelContent(body.title, body.titleContent))
  }
  const actors = new Set(body.sections.flatMap(section => section.tasks.flatMap(task => task.actors.map((actor, index) => journeyActorKey(actor, task.actorContents?.[index])))))
  if (actors.size > JOURNEY_ACTOR_COLOR_LIMIT) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'journey_actor_palette_limit',
      message: `Journey guarantees unique derived actor colors through ${JOURNEY_ACTOR_COLOR_LIMIT} actors; this diagram has ${actors.size}, so colors repeat deterministically above that bound.`,
    })
  }
  for (const s of body.sections) {
    if (s.label !== undefined) overflow(s.id, resolveLabelContent(s.label, s.labelContent))
    for (const t of s.tasks) {
      overflow(t.id, resolveLabelContent(t.text, t.textContent))
      t.actors.forEach((actor, index) => overflow(t.id, resolveLabelContent(actor, t.actorContents?.[index])))
    }
  }
  return warnings
}
