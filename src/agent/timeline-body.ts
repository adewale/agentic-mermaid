// ============================================================================
// Timeline structured body: parse / serialize / mutate (FamilyDescriptor hooks).
//
// Structured-or-null parse, same pattern as sequence: any unmodeled line
// makes the caller fall back to a lossless opaque body.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  TimelineBody, TimelineSection, TimelinePeriod,
  TimelineMutationOp, MutationError, Result, Accessibility, LayoutWarning,
} from './types.ts'
import { ok, err } from './types.ts'
import {
  TIMELINE_PERIOD_RE,
  TIMELINE_TITLE_RE,
  isTimelineCommentLine,
  normalizeTimelineBreaks,
  parseTimelineHeader,
  readTimelineSection,
} from '../timeline/parse-core.ts'
import { parseTimelineDiagram, readTimelineStatements } from '../timeline/parser.ts'
import { writeTimelineText } from '../timeline/text.ts'
import { indexedIdAllocator, resolveInsertIndex, setOptionalField } from './body-utils.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { sourceLineStarts } from '../shared/source-spans.ts'
import { applySourceEdits, sameSourceMeaning, type SourceEdit } from './source-mutation.ts'

// ---- Parser -----------------------------------------------------------------

/**
 * Parse the body lines of a timeline diagram. Returns a structured body only
 * if EVERY non-blank, non-comment line is one of: title, accTitle/accDescr
 * (line or block form), section, period (`<label> : <event>` and `: <event>`
 * continuations), or a multi-event line with extra `:` separators. Otherwise
 * returns null so caller falls back to a lossless opaque body.
 *
 * Mirrors the legacy parser's accepted syntax (src/timeline/parser.ts).
 */
function normalizeTimelineText(value: string): string {
  // Match the native parser's trim-before-<br> order so authored boundary
  // breaks survive, while canonicalizing mutation CRLF/CR before serialization.
  return normalizeTimelineBreaks(value.trim().replace(/\r\n?/g, '\n'))
}

/** Both projections use the same reader; field writers protect delimiters
 * and keyword contexts without removing the author's typed structure. */
export function parseTimelineBody(lines: string[], accessibility: Accessibility = {}, source?: string): TimelineBody | null {
  try {
    const diagram = parseTimelineDiagram(['timeline', ...lines], accessibility)
    return { kind: 'timeline', ...diagram, ...(source !== undefined ? { source } : {}) }
  } catch {
    return null
  }
}

// ---- Verifier ---------------------------------------------------------------

/** Timeline lines ours reads where pinned Mermaid's lexer reads a keyword,
 * each on its canonical line. Mermaid reads the word `timeline` starting a
 * line as the header, and rejects it there; ours reads a period. */
export function timelineUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  const lines = canonicalSource.split(/\r?\n/)
  const header = lines.findIndex(line => parseTimelineHeader(line) !== null)
  if (header < 0) return []
  const warnings: LayoutWarning[] = []
  for (let index = header + 1; index < lines.length; index++) {
    let line = lines[index]!.trim()
    const directive = parseAccessibilityDirective(lines, index)
    if (directive === undefined) break
    if (directive) {
      index = directive.endIndex
      if (!directive.suffixLine) continue
      line = directive.suffixLine.trim()
    }
    if (isTimelineCommentLine(line) || TIMELINE_TITLE_RE.test(line)) continue
    const period = line.match(TIMELINE_PERIOD_RE)
    const label = period ? period[1]!.trim() : line.includes(':') ? undefined : line
    if (label !== undefined && /^timeline\b/i.test(line)) warnings.push({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'timeline_header_in_body', line: index + 1,
      message: `Pinned Mermaid reads "timeline" starting a line as the diagram header, and rejects it after the header. Ours reads this line as the period ${JSON.stringify(label)}; remove a repeated header, or start the period with another word.`,
    })
  }
  for (const [index, line] of lines.entries()) {
    if (index > header && line.includes('%%{') && !isTimelineCommentLine(line)) warnings.push({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'timeline_text_directive', line: index + 1,
      message: 'Directive-looking text is retained as text. Pinned Mermaid preprocesses this opener; the writer protects its percent signs with entity codes.',
    })
    if (index > header && /^(?:title|section)$/i.test(line.trim()) && lines.slice(index + 1).some(next => next.trim())) warnings.push({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'timeline_cross_line_keyword', line: index + 1,
      message: 'This bare period keyword remains a period. Pinned Mermaid can consume the following line as its argument; the writer protects the keyword with an entity code.',
    })
  }
  return warnings
}

// ---- Serializer -------------------------------------------------------------

function renderTimelineUnchecked(body: TimelineBody): string {
  const lines: string[] = [body.direction ? `timeline ${body.direction}` : 'timeline']
  if (body.title) lines.push(`  title ${writeTimelineText(body.title, 'title')}`)
  if (body.accessibilityTitle) lines.push(`  accTitle: ${writeTimelineText(body.accessibilityTitle, 'accessibility')}`)
  if (body.accessibilityDescription) {
    if (body.accessibilityDescription.includes('\n')) {
      lines.push('  accDescr {')
      for (const line of body.accessibilityDescription.split(/\r?\n/)) {
        lines.push(`    ${writeTimelineText(line.trim(), 'accessibility')}`)
      }
      lines.push('  }')
    } else {
      lines.push(`  accDescr: ${writeTimelineText(body.accessibilityDescription, 'accessibility')}`)
    }
  }
  for (const section of body.sections) {
    if (section.label !== undefined) lines.push(`  section ${writeTimelineText(section.label, 'section')}`)
    for (const period of section.periods) {
      // First event on the same line as the period label; extra events on
      // continuation lines (`: text`). Matches Mermaid timeline syntax.
      if (period.events.length === 0) {
        lines.push(`  ${writeTimelineText(period.label, 'period')}`)
        continue
      }
      lines.push(`  ${writeTimelineText(period.label, 'period')} : ${writeTimelineText(period.events[0]!.text, 'event')}`)
      for (const event of period.events.slice(1)) lines.push(`       : ${writeTimelineText(event.text, 'event')}`)
    }
  }
  return lines.join('\n') + '\n'
}

export function renderTimeline(body: TimelineBody): string {
  return body.source ?? renderTimelineUnchecked(body)
}

// ---- Mutator ----------------------------------------------------------------

function cloneTimeline(b: TimelineBody): TimelineBody {
  return {
    kind: 'timeline',
    direction: b.direction,
    title: b.title,
    accessibilityTitle: b.accessibilityTitle,
    accessibilityDescription: b.accessibilityDescription,
    sections: b.sections.map(s => ({
      id: s.id, label: s.label,
      periods: s.periods.map(p => ({ id: p.id, label: p.label, events: p.events.map(e => ({ id: e.id, text: e.text })) })),
    })),
  }
}

function makeTimelineIdAllocator(body: TimelineBody): (prefix: 'section' | 'period' | 'event') => string {
  const ids = body.sections.flatMap(section => [
    section.id,
    ...section.periods.flatMap(period => [period.id, ...period.events.map(event => event.id)]),
  ])
  const allocators = {
    section: indexedIdAllocator(ids, 'section'),
    period: indexedIdAllocator(ids, 'period'),
    event: indexedIdAllocator(ids, 'event'),
  }
  return prefix => allocators[prefix]()
}

function normalizeTimelineOpText(value: string, opts: { field: string }): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Timeline ${opts.field} must be a string` })
  const normalized = normalizeTimelineText(value)
  if (!normalized.length) {
    return err({ code: 'INVALID_OP', message: `Timeline ${opts.field} must be non-empty` })
  }
  return ok(normalized)
}

function normalizeTimelineSectionText(value: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: 'Timeline section label must be a string' })
  return ok(normalizeTimelineText(value))
}

function normalizeTimelineTitleOpText(value: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: 'Timeline title must be a string' })
  if (/[\r\n\u2028\u2029]/.test(value)) {
    return err({ code: 'INVALID_OP', message: 'Timeline title must be single-line; pinned Mermaid renders <br> literally in titles' })
  }
  const title = value.trim()
  if (!title) {
    return err({ code: 'INVALID_OP', message: 'Timeline title must be non-empty' })
  }
  return ok(title)
}

/** Typed values are text. The event writer owns all separators. */
function normalizeTimelineEventOpText(value: string): Result<string, MutationError> {
  return normalizeTimelineOpText(value, { field: 'event text' })
}

/** Accessibility values keep their line-oriented normalization; the writer
 * protects block delimiters in their text. null clears the field. */
function normalizeTimelineAccessibilityText(
  value: string | null,
  field: string,
): Result<string | undefined, MutationError> {
  if (value === null) return ok(undefined)
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Timeline ${field} must be a string or null` })
  const normalized = value.split(/\r?\n/).map(part => part.trim()).filter(Boolean).join('\n')
  if (!normalized) {
    return err({ code: 'INVALID_OP', message: `Timeline ${field} must be non-empty` })
  }
  return ok(normalized)
}

/** "(valid: 0..N-1)" suffix for not-found errors, so a wrong index teaches the
 *  legal range instead of forcing a re-read of the whole diagram. */
function indexRangeHint(count: number): string {
  return count === 0 ? '(none exist)' : `(valid: 0..${count - 1})`
}

export function mutateTimeline(input: TimelineBody, op: TimelineMutationOp): Result<TimelineBody, MutationError> {
  const result = mutateTimelineBody(input, op)
  if (!result.ok || input.source === undefined) return result
  try {
    const edits = timelineSourceEdits(input, result.value, op)
    const source = applySourceEdits(input.source, edits)
    const actual = parseTimelineDiagram(source.split(/\r?\n/), { title: result.value.accessibilityTitle, descr: result.value.accessibilityDescription })
    if (!sameSourceMeaning(timelineMeaning(actual), timelineMeaning(result.value))) {
      return err({ code: 'INVALID_OP', message: 'Timeline edit would change statement ownership or meaning beyond the requested operation' })
    }
    result.value.source = source
    return result
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}

/** Generated occurrence IDs are parse-local. Compare the complete ordered
 * semantic projection, including accessibility and every event's owner. */
function timelineMeaning(body: Omit<TimelineBody, 'kind'>): unknown {
  return {
    direction: body.direction, title: body.title,
    accessibilityTitle: body.accessibilityTitle, accessibilityDescription: body.accessibilityDescription,
    sections: body.sections.map(section => ({ label: section.label, periods: section.periods.map(period => ({
      label: period.label, events: period.events.map(event => event.text),
    })) })),
  }
}

/** Patch only source owned by the edited occurrence. The native reader gives
 * continuation ownership, including continuations after a section change. */
function timelineSourceEdits(input: TimelineBody, next: TimelineBody, op: TimelineMutationOp): SourceEdit[] {
  const source = input.source!, lines = source.split(/\r?\n/), starts = [...sourceLineStarts(source)]
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const read = readTimelineStatements(lines, { title: input.accessibilityTitle, descr: input.accessibilityDescription })
  if (!sameSourceMeaning(timelineMeaning(read.diagram), timelineMeaning(input))) throw new Error('Timeline source does not match its typed body')
  // Rebase parse-local source IDs to the live body's stable occurrence IDs.
  const sections = new Map<string, string>(), periods = new Map<string, string>()
  read.diagram.sections.forEach((section, si) => {
    const owner = input.sections[si]!
    sections.set(section.id, owner.id)
    section.periods.forEach((period, pi) => periods.set(period.id, owner.periods[pi]!.id))
  })
  const statements = read.statements.map(statement => ({ ...statement,
    sectionId: statement.sectionId ? sections.get(statement.sectionId) : undefined,
    periodId: statement.periodId ? periods.get(statement.periodId) : undefined,
  }))
  const ownedPeriods = new Map<string, typeof statements>(), periodDeclarations = new Map<string, number>(), sectionDeclarations = new Map<string, number>()
  for (const statement of statements) {
    if (statement.periodId) {
      const owned = ownedPeriods.get(statement.periodId) ?? []
      owned.push(statement)
      ownedPeriods.set(statement.periodId, owned)
      if (statement.kind === 'period') periodDeclarations.set(statement.periodId, statement.line)
    }
    if (statement.kind === 'section' && statement.sectionId) sectionDeclarations.set(statement.sectionId, statement.line)
  }
  const replacements = new Map<number, string>(), insertions = new Map<number, string>()
  const rowText = (row: number): string => source.slice(starts[row]!, starts[row + 1] ?? source.length)
  const replace = (row: number, text: string): void => {
    const ending = rowText(row).match(/\r?\n$/)?.[0] ?? ''
    replacements.set(row, text ? text.replace(/\r?\n/g, newline) + ending : '')
  }
  const insert = (row: number, text: string, verbatim = false): void => {
    const prefix = starts[row] === source.length && source.length > 0 && !/[\r\n]$/.test(source) ? newline : ''
    const payload = verbatim ? text + (/[\r\n]$/.test(text) ? '' : newline) : text.replace(/\r?\n/g, newline) + newline
    insertions.set(row, (insertions.get(row) ?? '') + prefix + payload)
  }
  const main = (id: string): number | undefined => periodDeclarations.get(id)
  const sectionRow = (id: string): number | undefined => sectionDeclarations.get(id)
  const periodText = (period: TimelinePeriod): string => {
    const label = `  ${writeTimelineText(period.label, 'period')}`
    return period.events.length ? label + period.events.map(event => ` : ${writeTimelineText(event.text, 'event')}`).join('') : label
  }
  const removePeriod = (id: string): void => {
    for (const statement of ownedPeriods.get(id) ?? []) {
      if (statement.kind === 'section') {
        // Its prefix still declares a different section. Only the event
        // suffix belongs to the edited period.
        const raw = lines[statement.line]!, colon = raw.indexOf(':')
        if (colon < 0) throw new Error('Timeline section continuation has no owned delimiter')
        replace(statement.line, raw.slice(0, colon).trimEnd())
      } else replace(statement.line, '')
    }
  }
  const updatePeriod = (period: TimelinePeriod): void => {
    removePeriod(period.id)
    replace(main(period.id)!, periodText(period))
  }
  const endRow = lines.length - 1
  const destination = (section: TimelineSection, index: number): number => {
    const following = section.periods.slice(index + 1).find(period => main(period.id) !== undefined)
    if (following) return main(following.id)!
    const si = next.sections.indexOf(section)
    for (const later of next.sections.slice(si + 1)) {
      const row = sectionRow(later.id)
      if (row !== undefined) return row
    }
    // A final unterminated row cannot be an insertion boundary before itself.
    return /[\r\n]$/.test(source) ? endRow : lines.length
  }
  const appendAt = (row: number, text: string, verbatim = false): void => {
    if (row === lines.length) {
      // Sentinel addresses EOF independently of the last physical line.
      starts[row] = source.length
      lines[row] = ''
    }
    insert(row, text, verbatim)
  }

  switch (op.kind) {
    case 'set_title': {
      const titles = statements.filter(statement => statement.kind === 'title')
      titles.forEach(statement => replace(statement.line, ''))
      if (next.title !== undefined) {
        if (titles.length) replace(titles.at(-1)!.line, `  title ${writeTimelineText(next.title, 'title')}`)
        else appendAt(1, `  title ${writeTimelineText(next.title, 'title')}`)
      }
      break
    }
    case 'set_accessibility_title':
    case 'set_accessibility_description': {
      const isTitle = op.kind === 'set_accessibility_title'
      let last: number | undefined
      for (let row = 1; row < lines.length; row++) {
        const directive = parseAccessibilityDirective(lines, row)
        if (!directive) continue
        if (directive.title === isTitle) {
          if (directive.suffixLine) throw new Error('Accessibility source shares its closing line with a Timeline statement')
          last = row
          for (let owned = row; owned <= directive.endIndex; owned++) replace(owned, '')
        }
        row = directive.endIndex
      }
      const value = isTitle ? next.accessibilityTitle : next.accessibilityDescription
      if (value !== undefined) {
        const text = isTitle ? `  accTitle: ${writeTimelineText(value, 'accessibility')}`
          : value.includes('\n') ? `  accDescr {\n${value.split('\n').map(line => `    ${writeTimelineText(line, 'accessibility')}`).join('\n')}\n  }` : `  accDescr: ${writeTimelineText(value, 'accessibility')}`
        if (last !== undefined) replace(last, text)
        else appendAt(1, text)
      }
      break
    }
    case 'set_section_label': {
      const section = next.sections[op.index]!, row = sectionRow(section.id)
      if (row === undefined) appendAt(main(section.periods[0]!.id)!, `  section ${writeTimelineText(section.label!, 'section')}`)
      else {
        const raw = lines[row]!, parsed = readTimelineSection(raw.trimStart())!
        replace(row, `  section ${writeTimelineText(section.label!, 'section')}${parsed.eventSource}`)
      }
      break
    }
    case 'set_period_label':
    case 'add_event':
    case 'remove_event':
    case 'set_event_text':
      updatePeriod(next.sections[op.sectionIndex]!.periods[op.periodIndex]!)
      break
    case 'move_event': {
      const from = input.sections[op.fromSection]!.periods[op.fromPeriod]!, to = input.sections[op.toSection]!.periods[op.toPeriod]!
      const touched = new Set([from.id, to.id])
      next.sections.flatMap(section => section.periods).filter(period => touched.has(period.id)).forEach(updatePeriod)
      break
    }
    case 'remove_period':
      removePeriod(input.sections[op.sectionIndex]!.periods[op.periodIndex]!.id)
      break
    case 'add_period':
    case 'move_period': {
      if (op.kind === 'move_period') removePeriod(input.sections[op.fromSection]!.periods[op.fromIndex]!.id)
      const section = next.sections[op.kind === 'add_period' ? op.sectionIndex : next.sections.findIndex(section => section.id === input.sections[op.toSection]!.id)]!
      const period = op.kind === 'move_period' ? section.periods[op.toIndex]! : section.periods.find(period => !periodsHas(input, period.id))!
      appendAt(destination(section, section.periods.indexOf(period)), periodText(period))
      break
    }
    case 'add_section': {
      const section = next.sections.find(section => !input.sections.some(before => before.id === section.id))!, index = next.sections.indexOf(section)
      const following = next.sections[index + 1], row = following ? sectionRow(following.id) : undefined
      appendAt(row ?? (/[\r\n]$/.test(source) ? endRow : lines.length), `  section ${writeTimelineText(section.label!, 'section')}`)
      break
    }
    case 'remove_section': {
      const section = input.sections[op.index]!, row = sectionRow(section.id)
      section.periods.forEach(period => removePeriod(period.id))
      if (row !== undefined) {
        const raw = lines[row]!, continuation = readTimelineSection(raw.trimStart())?.eventSource
        replace(row, continuation?.trim() ? `  ${continuation.trimStart()}` : '')
      }
      break
    }
    case 'move_section': {
      const section = input.sections[op.from]!, row = sectionRow(section.id)
      if (row === undefined) throw new Error('An implicit Timeline section has no movable source declaration')
      const nextRow = input.sections.slice(op.from + 1).map(section => sectionRow(section.id)).find(row => row !== undefined) ?? lines.length
      const block = source.slice(starts[row]!, starts[nextRow] ?? source.length)
      for (let owned = row; owned < nextRow; owned++) replacements.set(owned, '')
      const following = next.sections[op.to + 1], destinationRow = following ? sectionRow(following.id) : undefined
      appendAt(destinationRow ?? (/[\r\n]$/.test(source) ? endRow : lines.length), block, true)
      break
    }
  }
  return [...new Set([...replacements.keys(), ...insertions.keys()])].map(row => ({
    start: starts[row]!, end: starts[row + 1] ?? source.length,
    text: (insertions.get(row) ?? '') + (replacements.get(row) ?? rowText(row)),
  }))
}

function periodsHas(body: TimelineBody, id: string): boolean {
  return body.sections.some(section => section.periods.some(period => period.id === id))
}

function mutateTimelineBody(input: TimelineBody, op: TimelineMutationOp): Result<TimelineBody, MutationError> {
  const body = cloneTimeline(input)
  const nextTimelineId = makeTimelineIdAllocator(body)

  const getSection = (i: number): TimelineSection | undefined => body.sections[i]
  const getPeriod = (si: number, pi: number): TimelinePeriod | undefined => getSection(si)?.periods[pi]
  const sectionNotFound = (index: number): Result<never, MutationError> =>
    err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${index} ${indexRangeHint(body.sections.length)}` })
  const periodNotFound = (sectionIndex: number, periodIndex: number): Result<never, MutationError> =>
    err({ code: 'PERIOD_NOT_FOUND', message: `No period at (${sectionIndex},${periodIndex}) ${indexRangeHint(getSection(sectionIndex)?.periods.length ?? 0)}` })
  // Dropping an emptied implicit (unlabeled) section keeps the serialized
  // source parseable — remove_period established the convention; the move ops
  // reuse it.
  const dropEmptiedImplicitSection = (section: TimelineSection): void => {
    if (section.label === undefined && section.periods.length === 0) {
      body.sections.splice(body.sections.indexOf(section), 1)
    }
  }

  switch (op.kind) {
    case 'set_title': {
      const title = setOptionalField(body, 'title', op.title, value => normalizeTimelineTitleOpText(value))
      if (!title.ok) return title
      break
    }
    case 'set_accessibility_title': {
      const title = normalizeTimelineAccessibilityText(op.title, 'accessibility title')
      if (!title.ok) return title
      if (title.value === undefined) delete body.accessibilityTitle
      else body.accessibilityTitle = title.value.replace(/\n/g, ' ')
      break
    }
    case 'set_accessibility_description': {
      const description = normalizeTimelineAccessibilityText(op.description, 'accessibility description')
      if (!description.ok) return description
      if (description.value === undefined) delete body.accessibilityDescription
      else body.accessibilityDescription = description.value
      break
    }
    case 'add_section': {
      const label = normalizeTimelineSectionText(op.label)
      if (!label.ok) return label
      const index = resolveInsertIndex(op.index, body.sections.length, 'Timeline')
      if (!index.ok) return index
      body.sections.splice(index.value, 0, { id: nextTimelineId('section'), label: label.value, periods: [] })
      break
    }
    case 'remove_section': {
      if (!getSection(op.index)) return sectionNotFound(op.index)
      body.sections.splice(op.index, 1)
      break
    }
    case 'set_section_label': {
      const s = getSection(op.index)
      if (!s) return sectionNotFound(op.index)
      const label = normalizeTimelineSectionText(op.label)
      if (!label.ok) return label
      s.label = label.value
      break
    }
    case 'add_period': {
      const s = getSection(op.sectionIndex)
      if (!s) return sectionNotFound(op.sectionIndex)
      const label = normalizeTimelineOpText(op.label, { field: 'period label' })
      if (!label.ok) return label
      const events: TimelinePeriod['events'] = []
      for (const raw of op.events ?? []) {
        const text = normalizeTimelineEventOpText(raw)
        if (!text.ok) return text
        events.push({ id: nextTimelineId('event'), text: text.value })
      }
      const index = resolveInsertIndex(op.index, s.periods.length, 'Timeline')
      if (!index.ok) return index
      const period: TimelinePeriod = {
        id: nextTimelineId('period'),
        label: label.value,
        events,
      }
      s.periods.splice(index.value, 0, period)
      break
    }
    case 'remove_period': {
      const s = getSection(op.sectionIndex)
      if (!s) return sectionNotFound(op.sectionIndex)
      if (!s.periods[op.periodIndex]) return periodNotFound(op.sectionIndex, op.periodIndex)
      s.periods.splice(op.periodIndex, 1)
      dropEmptiedImplicitSection(s)
      break
    }
    case 'set_period_label': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return periodNotFound(op.sectionIndex, op.periodIndex)
      const label = normalizeTimelineOpText(op.label, { field: 'period label' })
      if (!label.ok) return label
      p.label = label.value
      break
    }
    case 'add_event': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return periodNotFound(op.sectionIndex, op.periodIndex)
      const text = normalizeTimelineEventOpText(op.text)
      if (!text.ok) return text
      const index = resolveInsertIndex(op.index, p.events.length, 'Timeline')
      if (!index.ok) return index
      p.events.splice(index.value, 0, { id: nextTimelineId('event'), text: text.value })
      break
    }
    case 'remove_event': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return periodNotFound(op.sectionIndex, op.periodIndex)
      if (!p.events[op.eventIndex]) return err({ code: 'EVENT_NOT_FOUND', message: `No event at index ${op.eventIndex} ${indexRangeHint(p.events.length)}` })
      p.events.splice(op.eventIndex, 1)
      break
    }
    case 'set_event_text': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return periodNotFound(op.sectionIndex, op.periodIndex)
      const e = p.events[op.eventIndex]
      if (!e) return err({ code: 'EVENT_NOT_FOUND', message: `No event at index ${op.eventIndex} ${indexRangeHint(p.events.length)}` })
      const text = normalizeTimelineEventOpText(op.text)
      if (!text.ok) return text
      e.text = text.value
      break
    }
    case 'move_period': {
      const from = getSection(op.fromSection)
      if (!from) return sectionNotFound(op.fromSection)
      if (!from.periods[op.fromIndex]) return periodNotFound(op.fromSection, op.fromIndex)
      const to = getSection(op.toSection)
      if (!to) return sectionNotFound(op.toSection)
      const [period] = from.periods.splice(op.fromIndex, 1)
      if (!Number.isInteger(op.toIndex) || op.toIndex < 0 || op.toIndex > to.periods.length) {
        return err({ code: 'PERIOD_NOT_FOUND', message: `No insert position ${op.toIndex} in section ${op.toSection} (0..${to.periods.length})` })
      }
      to.periods.splice(op.toIndex, 0, period!)
      if (from !== to) dropEmptiedImplicitSection(from)
      break
    }
    case 'move_event': {
      const from = getPeriod(op.fromSection, op.fromPeriod)
      if (!from) return periodNotFound(op.fromSection, op.fromPeriod)
      if (!from.events[op.fromIndex]) return err({ code: 'EVENT_NOT_FOUND', message: `No event at index ${op.fromIndex} ${indexRangeHint(from.events.length)}` })
      const to = getPeriod(op.toSection, op.toPeriod)
      if (!to) return periodNotFound(op.toSection, op.toPeriod)
      const [event] = from.events.splice(op.fromIndex, 1)
      if (!Number.isInteger(op.toIndex) || op.toIndex < 0 || op.toIndex > to.events.length) {
        return err({ code: 'EVENT_NOT_FOUND', message: `No insert position ${op.toIndex} in period (${op.toSection},${op.toPeriod}) (0..${to.events.length})` })
      }
      to.events.splice(op.toIndex, 0, event!)
      break
    }
    case 'move_section': {
      if (!getSection(op.from)) return sectionNotFound(op.from)
      if (!Number.isInteger(op.to) || op.to < 0 || op.to >= body.sections.length) {
        return err({ code: 'SECTION_NOT_FOUND', message: `No section position ${op.to} (0..${body.sections.length - 1})` })
      }
      const [section] = body.sections.splice(op.from, 1)
      body.sections.splice(op.to, 0, section!)
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('timeline', _x) })
    }
  }
  // A section directive owns every following period until another named
  // section. Moving implicit periods behind one would silently reparent them.
  if (body.sections.some((section, index) => index > 0 && section.label === undefined)) {
    return err({ code: 'INVALID_OP', message: 'Timeline unnamed section must remain first; name it before inserting or moving a named section ahead of it' })
  }
  return ok(body)
}
