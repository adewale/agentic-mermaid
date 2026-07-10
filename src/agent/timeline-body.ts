// ============================================================================
// Timeline structured body: parse / serialize / mutate (FamilyPlugin hooks).
//
// Structured-or-null parse, same pattern as sequence: any unmodeled line
// makes the caller fall back to a lossless opaque body.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  TimelineBody, TimelineSection, TimelinePeriod, TimelineEvent,
  TimelineMutationOp, MutationError, Result,
} from './types.ts'
import { ok, err } from './types.ts'

// ---- Parser -----------------------------------------------------------------

const TL_TITLE_RE = /^title\s+(.+)$/i
const TL_SECTION_RE = /^section\s+(.+)$/i
const TL_PERIOD_RE = /^([^:]+?)\s*:\s*(.*)$/
const TL_CONT_RE = /^:\s*(.+)$/  // continuation of previous period
// Accessibility directives — the SAME regexes the renderer parser matches
// (src/timeline/parser.ts), so `accTitle: x` is a directive on both surfaces
// instead of splitting into a phantom "accTitle" period here.
const TL_ACC_TITLE_RE = /^accTitle\s*:\s*(.+)$/i
const TL_ACC_DESCR_RE = /^accDescr\s*:\s*(.+)$/i
const TL_ACC_DESCR_BLOCK_RE = /^accDescr\s*\{\s*$/i

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
  return value.split(/\r?\n/).map(part => part.trim()).filter(Boolean).join(' ')
}

function validTimelineText(value: string, opts: { allowColon: boolean }): boolean {
  return value.length > 0 && (opts.allowColon || !value.includes(':'))
}

function parseTimelineEventSegments(raw: string): string[] | null {
  if (raw.trim().length === 0) return []
  const segments = raw.split(':').map(normalizeTimelineText)
  if (segments.some(segment => !validTimelineText(segment, { allowColon: false }))) return null
  return segments
}

export function parseTimelineBody(lines: string[]): TimelineBody | null {
  const body: TimelineBody = { kind: 'timeline', sections: [] }
  let currentSection: TimelineSection | undefined
  let currentPeriod: TimelinePeriod | undefined
  let sIdx = 0, pIdx = 0, eIdx = 0

  const implicitSection = (): TimelineSection => {
    if (!currentSection) {
      currentSection = { id: `section-${sIdx++}`, periods: [] }
      body.sections.push(currentSection)
    }
    return currentSection
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const tm = line.match(TL_TITLE_RE)
    if (tm) {
      const title = normalizeTimelineText(tm[1]!)
      if (!validTimelineText(title, { allowColon: true })) return null
      body.title = title
      continue
    }

    const at = line.match(TL_ACC_TITLE_RE)
    if (at) {
      body.accessibilityTitle = normalizeTimelineText(at[1]!)
      continue
    }

    const ad = line.match(TL_ACC_DESCR_RE)
    if (ad) {
      body.accessibilityDescription = normalizeTimelineText(ad[1]!)
      continue
    }

    // `accDescr { … }` block form — collected exactly like the renderer parser
    // (lines until a bare `}`); an unclosed block is unmodeled → opaque.
    if (TL_ACC_DESCR_BLOCK_RE.test(line)) {
      const descriptionLines: string[] = []
      let closed = false
      while (++i < lines.length) {
        const blockLine = lines[i]!.trim()
        if (blockLine === '}') { closed = true; break }
        descriptionLines.push(blockLine)
      }
      if (!closed) return null
      body.accessibilityDescription = descriptionLines.join('\n').trim()
      continue
    }

    const sm = line.match(TL_SECTION_RE)
    if (sm) {
      const label = normalizeTimelineText(sm[1]!)
      if (!validTimelineText(label, { allowColon: true })) return null
      currentSection = { id: `section-${sIdx++}`, label, periods: [] }
      body.sections.push(currentSection)
      currentPeriod = undefined
      continue
    }

    // `: <continuation>` — extra event on the previous period.
    const cont = line.match(TL_CONT_RE)
    if (cont && !line.match(TL_PERIOD_RE)) {
      if (!currentPeriod) return null
      const text = normalizeTimelineText(cont[1]!)
      if (!validTimelineText(text, { allowColon: false })) return null
      currentPeriod.events.push({ id: `event-${eIdx++}`, text })
      continue
    }

    // `<label> : <event> [ : <event2> : <event3> …]`
    const pm = line.match(TL_PERIOD_RE)
    if (pm) {
      const label = normalizeTimelineText(pm[1]!)
      if (!validTimelineText(label, { allowColon: false })) return null
      const restRaw = pm[2]!
      // Multi-event lines allow `: extra` segments to add more events to the same period.
      const eventTexts = parseTimelineEventSegments(restRaw)
      if (!eventTexts) return null
      const events: TimelineEvent[] = eventTexts.map(text => ({
        id: `event-${eIdx++}`, text,
      }))
      const period: TimelinePeriod = { id: `period-${pIdx++}`, label, events }
      implicitSection().periods.push(period)
      currentPeriod = period
      continue
    }

    // Unmodeled line → opaque fallback.
    return null
  }

  return body
}

// ---- Serializer -------------------------------------------------------------

export function renderTimeline(body: TimelineBody): string {
  const lines: string[] = [body.direction ? `timeline ${body.direction}` : 'timeline']
  if (body.title) lines.push(`  title ${body.title}`)
  if (body.accessibilityTitle) lines.push(`  accTitle: ${body.accessibilityTitle}`)
  if (body.accessibilityDescription) {
    if (body.accessibilityDescription.includes('\n')) {
      lines.push('  accDescr {')
      for (const line of body.accessibilityDescription.split(/\r?\n/)) {
        lines.push(`    ${line.trim()}`)
      }
      lines.push('  }')
    } else {
      lines.push(`  accDescr: ${body.accessibilityDescription}`)
    }
  }
  for (const section of body.sections) {
    if (section.label !== undefined) lines.push(`  section ${section.label}`)
    for (const period of section.periods) {
      // First event on the same line as the period label; extra events on
      // continuation lines (`: text`). Matches Mermaid timeline syntax.
      if (period.events.length === 0) {
        lines.push(`  ${period.label} :`)
        continue
      }
      lines.push(`  ${period.label} : ${period.events[0]!.text}`)
      for (const e of period.events.slice(1)) lines.push(`       : ${e.text}`)
    }
  }
  return lines.join('\n') + '\n'
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
  const seen = new Set<string>()
  for (const s of body.sections) {
    seen.add(s.id)
    for (const p of s.periods) { seen.add(p.id); for (const e of p.events) seen.add(e.id) }
  }
  return prefix => {
    let n = 0
    while (seen.has(`${prefix}-${n}`)) n++
    const id = `${prefix}-${n}`
    seen.add(id)
    return id
  }
}

function normalizeTimelineOpText(value: string, opts: { field: string; allowColon?: boolean }): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Timeline ${opts.field} must be a string` })
  const normalized = normalizeTimelineText(value)
  if (!validTimelineText(normalized, { allowColon: opts.allowColon ?? true })) {
    return err({ code: 'INVALID_OP', message: `Timeline ${opts.field} must be non-empty${opts.allowColon === false ? ' and must not contain :' : ''}` })
  }
  return ok(normalized)
}

/** Accessibility text is line-oriented free text, but `{`/`}` delimit the
 *  accDescr block form and `;` is a statement separator in wrapper contexts —
 *  text carrying them would not survive serialize → re-parse. null clears.
 *  (Journey normalizeAccessibilityOpText convention.) */
function normalizeTimelineAccessibilityText(
  value: string | null,
  field: string,
): Result<string | undefined, MutationError> {
  if (value === null) return ok(undefined)
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Timeline ${field} must be a string or null` })
  const normalized = value.split(/\r?\n/).map(part => part.trim()).filter(Boolean).join('\n')
  if (!normalized || /[;{}]/.test(normalized)) {
    return err({ code: 'INVALID_OP', message: `Timeline ${field} must be non-empty and must not contain ;, {, or }` })
  }
  return ok(normalized)
}

/** Prescriptive insert-position resolution (journey resolveInsertIndex
 *  convention): omitted = append; otherwise 0..length inclusive. */
function resolveTimelineInsertIndex(index: number | undefined, length: number): Result<number, MutationError> {
  if (index === undefined) return ok(length)
  if (!Number.isInteger(index) || index < 0 || index > length) {
    return err({ code: 'INVALID_OP', message: `Timeline insert index ${index} out of range (0..${length})` })
  }
  return ok(index)
}

/** "(valid: 0..N-1)" suffix for not-found errors, so a wrong index teaches the
 *  legal range instead of forcing a re-read of the whole diagram. */
function indexRangeHint(count: number): string {
  return count === 0 ? '(none exist)' : `(valid: 0..${count - 1})`
}

export function mutateTimeline(input: TimelineBody, op: TimelineMutationOp): Result<TimelineBody, MutationError> {
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
      if (op.title === null) delete body.title
      else {
        const title = normalizeTimelineOpText(op.title, { field: 'title' })
        if (!title.ok) return title
        body.title = title.value
      }
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
      const label = normalizeTimelineOpText(op.label, { field: 'section label' })
      if (!label.ok) return label
      const index = resolveTimelineInsertIndex(op.index, body.sections.length)
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
      const label = normalizeTimelineOpText(op.label, { field: 'section label' })
      if (!label.ok) return label
      s.label = label.value
      break
    }
    case 'add_period': {
      const s = getSection(op.sectionIndex)
      if (!s) return sectionNotFound(op.sectionIndex)
      const label = normalizeTimelineOpText(op.label, { field: 'period label', allowColon: false })
      if (!label.ok) return label
      const events: TimelinePeriod['events'] = []
      for (const raw of op.events ?? []) {
        const text = normalizeTimelineOpText(raw, { field: 'event text', allowColon: false })
        if (!text.ok) return text
        events.push({ id: nextTimelineId('event'), text: text.value })
      }
      const index = resolveTimelineInsertIndex(op.index, s.periods.length)
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
      const label = normalizeTimelineOpText(op.label, { field: 'period label', allowColon: false })
      if (!label.ok) return label
      p.label = label.value
      break
    }
    case 'add_event': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return periodNotFound(op.sectionIndex, op.periodIndex)
      const text = normalizeTimelineOpText(op.text, { field: 'event text', allowColon: false })
      if (!text.ok) return text
      const index = resolveTimelineInsertIndex(op.index, p.events.length)
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
      const text = normalizeTimelineOpText(op.text, { field: 'event text', allowColon: false })
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
  return ok(body)
}
