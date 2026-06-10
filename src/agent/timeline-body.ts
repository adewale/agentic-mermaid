// ============================================================================
// Timeline structured body: parse / serialize / mutate (FamilyPlugin hooks).
//
// Structured-or-null parse, same pattern as sequence: any unmodeled line
// makes the caller fall back to a lossless opaque body.
// ============================================================================

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

/**
 * Parse the body lines of a timeline diagram. Returns a structured body only
 * if EVERY non-blank, non-comment line is one of: title, section, period
 * (`<label> : <event>` and `: <event>` continuations), or a multi-event line
 * with extra `:` separators. Otherwise returns null so caller falls back to
 * a lossless opaque body.
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

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const tm = line.match(TL_TITLE_RE)
    if (tm) {
      const title = normalizeTimelineText(tm[1]!)
      if (!validTimelineText(title, { allowColon: true })) return null
      body.title = title
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
  const lines: string[] = ['timeline']
  if (body.title) lines.push(`  title ${body.title}`)
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
    title: b.title,
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

export function mutateTimeline(input: TimelineBody, op: TimelineMutationOp): Result<TimelineBody, MutationError> {
  const body = cloneTimeline(input)
  const nextTimelineId = makeTimelineIdAllocator(body)

  const getSection = (i: number): TimelineSection | undefined => body.sections[i]
  const getPeriod = (si: number, pi: number): TimelinePeriod | undefined => getSection(si)?.periods[pi]

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
    case 'add_section': {
      const label = normalizeTimelineOpText(op.label, { field: 'section label' })
      if (!label.ok) return label
      body.sections.push({ id: nextTimelineId('section'), label: label.value, periods: [] })
      break
    }
    case 'remove_section': {
      if (!getSection(op.index)) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.index}` })
      body.sections.splice(op.index, 1)
      break
    }
    case 'set_section_label': {
      const s = getSection(op.index)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.index}` })
      const label = normalizeTimelineOpText(op.label, { field: 'section label' })
      if (!label.ok) return label
      s.label = label.value
      break
    }
    case 'add_period': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      const label = normalizeTimelineOpText(op.label, { field: 'period label', allowColon: false })
      if (!label.ok) return label
      const events: TimelinePeriod['events'] = []
      for (const raw of op.events ?? []) {
        const text = normalizeTimelineOpText(raw, { field: 'event text', allowColon: false })
        if (!text.ok) return text
        events.push({ id: nextTimelineId('event'), text: text.value })
      }
      const period: TimelinePeriod = {
        id: nextTimelineId('period'),
        label: label.value,
        events,
      }
      s.periods.push(period)
      break
    }
    case 'remove_period': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      if (!s.periods[op.periodIndex]) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at index ${op.periodIndex}` })
      s.periods.splice(op.periodIndex, 1)
      if (s.label === undefined && s.periods.length === 0) body.sections.splice(op.sectionIndex, 1)
      break
    }
    case 'set_period_label': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at (${op.sectionIndex},${op.periodIndex})` })
      const label = normalizeTimelineOpText(op.label, { field: 'period label', allowColon: false })
      if (!label.ok) return label
      p.label = label.value
      break
    }
    case 'add_event': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at (${op.sectionIndex},${op.periodIndex})` })
      const text = normalizeTimelineOpText(op.text, { field: 'event text', allowColon: false })
      if (!text.ok) return text
      p.events.push({ id: nextTimelineId('event'), text: text.value })
      break
    }
    case 'remove_event': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at (${op.sectionIndex},${op.periodIndex})` })
      if (!p.events[op.eventIndex]) return err({ code: 'EVENT_NOT_FOUND', message: `No event at index ${op.eventIndex}` })
      p.events.splice(op.eventIndex, 1)
      const section = getSection(op.sectionIndex)
      if (section && section.label === undefined && section.periods.length === 0) body.sections.splice(op.sectionIndex, 1)
      break
    }
    case 'set_event_text': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at (${op.sectionIndex},${op.periodIndex})` })
      const e = p.events[op.eventIndex]
      if (!e) return err({ code: 'EVENT_NOT_FOUND', message: `No event at index ${op.eventIndex}` })
      const text = normalizeTimelineOpText(op.text, { field: 'event text', allowColon: false })
      if (!text.ok) return text
      e.text = text.value
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_x)}` })
    }
  }
  return ok(body)
}
