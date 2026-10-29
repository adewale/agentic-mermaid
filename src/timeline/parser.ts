import { parserObservationActive, observeParserStatement, observeParserMutation } from '../shared/parser-observation.ts'
import type { TimelineDiagram, TimelineSection, TimelinePeriod, TimelineEvent } from './types.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import type { MermaidSourceAccessibility } from '../mermaid-source.ts'
import { readTimelineText, timelineLexicalLines } from './text.ts'
import { toEntityMarkers } from '../shared/mermaid-entities.ts'
import {
  accessibilityFields,
  requireClosedAccessibility,
  scanAccessibilityDirectives,
} from '../shared/accessibility-directives.ts'
import {
  TIMELINE_CONTINUATION_RE,
  TIMELINE_PERIOD_RE,
  readTimelineSection,
  TIMELINE_TITLE_RE,
  isTimelineCommentLine,
  parseTimelineHeader,
  splitTimelineEvents,
  unsupportedTimelineHeaderError,
} from './parse-core.ts'

// ============================================================================
// Timeline diagram parser
//
// Parses Mermaid timeline syntax into a TimelineDiagram structure.
//
// Supported syntax:
//   timeline [LR|TD]
//   title Timeline Title
//   section Section Label
//   2020 : Event 1
//   2021 : Event 1 : Event 2
//        : Continued event for the previous period
//
// Direction (upstream PR #7270): the token rides the header line — `timeline
// TD` flows top-down, `timeline LR` (or a bare header) stays horizontal. The
// upstream lexer only knows LR/TD as direction tokens. Any other header
// suffix is diagnosed rather than silently rendered as the LR default.
// ============================================================================

/**
 * Parse a Mermaid timeline diagram.
 * Expects the first line to be "timeline".
 */
export function parseTimelineDiagram(
  lines: string[],
  accessibility: MermaidSourceAccessibility = {},
): TimelineDiagram {
  const scanned = scanAccessibilityDirectives(timelineLexicalLines(lines))
  requireClosedAccessibility(scanned)
  lines = scanned.familyLines
  const diagram: TimelineDiagram = {
    sections: [],
    ...accessibilityFields(Object.fromEntries(Object.entries({ ...accessibility, ...scanned.accessibility })
      .map(([key, value]) => [key, readTimelineText(toEntityMarkers(value), 'accessibility')]))),
  }

  const header = parseTimelineHeader(lines[0] ?? '')
  if (header?.kind === 'unsupported') throw unsupportedTimelineHeaderError(header.suffix)
  if (header?.direction) diagram.direction = header.direction
  if (parserObservationActive('timeline')) {
    observeParserStatement('timeline', 'header', lines[0] ?? '', { line: 1, unit: 'normalized' })
    observeParserMutation('timeline', 'initialize', diagram)
  }

  let currentSection: TimelineSection | undefined
  let currentPeriod: TimelinePeriod | undefined
  let sectionIndex = 0
  let periodIndex = 0
  let eventIndex = 0
  let observationLine = 1

  const ensureSection = (): TimelineSection => {
    if (currentSection) return currentSection
    currentSection = {
      id: `section-${sectionIndex++}`,
      periods: [],
    }
    diagram.sections.push(currentSection)
    if (parserObservationActive('timeline')) observeParserMutation('timeline', 'addImplicitSection', currentSection, { line: observationLine, unit: 'normalized' })
    return currentSection
  }

  const pushEvents = (period: TimelinePeriod, rawEvents: string[]): void => {
    for (const rawEvent of rawEvents) {
      const normalized = readTimelineText(rawEvent.trim(), 'event')
      if (!normalized) continue

      const event: TimelineEvent = {
        id: `event-${eventIndex++}`,
        text: normalized,
      }
      period.events.push(event)
      if (parserObservationActive('timeline')) observeParserMutation('timeline', 'addEvent', { ...event, periodId: period.id }, { line: observationLine, unit: 'normalized' })
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    observationLine = i + 1

    if (isTimelineCommentLine(line)) continue

    const titleMatch = line.match(TIMELINE_TITLE_RE)
    if (titleMatch) {
      // Pinned Mermaid draws Timeline titles as raw text; unlike node labels,
      // exact <br> is visible text rather than a line break here.
      if (parserObservationActive('timeline')) observeParserStatement('timeline', 'title', line, { line: i + 1, unit: 'normalized' })
      diagram.title = readTimelineText(titleMatch[1]!.trim(), 'title')
      if (parserObservationActive('timeline')) observeParserMutation('timeline', 'setTitle', diagram.title, { line: i + 1, unit: 'normalized' })
      continue
    }

    const sectionMatch = readTimelineSection(line)
    if (sectionMatch) {
      if (parserObservationActive('timeline')) observeParserStatement('timeline', 'section', line, { line: i + 1, unit: 'normalized' })
      currentSection = {
        id: `section-${sectionIndex++}`,
        label: readTimelineText(sectionMatch.label.trim(), 'section'),
        periods: [],
      }
      diagram.sections.push(currentSection)
      if (parserObservationActive('timeline')) observeParserMutation('timeline', 'addSection', currentSection, { line: i + 1, unit: 'normalized' })
      // A section changes only section ownership for future periods. Same-line
      // events and later continuations retain the latest period in its old scope.
      if (sectionMatch.eventSource) {
        if (!currentPeriod) throw new Error('Timeline continuation found before any period was declared')
        pushEvents(currentPeriod, splitTimelineEvents(sectionMatch.eventSource))
      }
      continue
    }

    const continuationMatch = line.match(TIMELINE_CONTINUATION_RE)
    if (continuationMatch) {
      if (parserObservationActive('timeline')) observeParserStatement('timeline', 'continuation', line, { line: i + 1, unit: 'normalized' })
      if (!currentPeriod) {
        throw new Error('Timeline continuation found before any period was declared')
      }
      pushEvents(currentPeriod, splitTimelineEvents(`: ${continuationMatch[1]!}`))
      continue
    }

    const periodMatch = line.match(TIMELINE_PERIOD_RE)
    if (periodMatch) {
      if (parserObservationActive('timeline')) observeParserStatement('timeline', 'period', line, { line: i + 1, unit: 'normalized' })
      const periodLabel = readTimelineText(periodMatch[1]!.trim(), 'period')
      const events = splitTimelineEvents(periodMatch[2]!)

      if (!periodLabel) {
        throw syntaxError({
          what: `Invalid timeline period: "${line}"`,
          expectedForm: 'Period : Event[ : Event…]',
          example: '2025 : Launch : Beta',
        })
      }

      const period: TimelinePeriod = {
        id: `period-${periodIndex++}`,
        label: periodLabel,
        events: [],
      }

      pushEvents(period, events)

      if (period.events.length === 0) {
        throw new Error(`Timeline period "${periodLabel}" must include at least one event`)
      }

      ensureSection().periods.push(period)
      if (parserObservationActive('timeline')) observeParserMutation('timeline', 'addPeriod', { ...period, sectionId: currentSection!.id }, { line: i + 1, unit: 'normalized' })
      currentPeriod = period
      continue
    }

    // Upstream parity: a bare line (no colon) is a period with no events —
    // mermaid renders these, and the upstream suite's two-task sections rely
    // on it. Malformed colon lines still fall through to the loud throw.
    if (!line.includes(':') && line.trim().length > 0) {
      if (parserObservationActive('timeline')) observeParserStatement('timeline', 'bare-period', line, { line: i + 1, unit: 'normalized' })
      const period: TimelinePeriod = {
        id: `period-${periodIndex++}`,
        label: readTimelineText(line.trim(), 'period'),
        events: [],
      }
      ensureSection().periods.push(period)
      if (parserObservationActive('timeline')) observeParserMutation('timeline', 'addPeriod', { ...period, sectionId: currentSection!.id }, { line: i + 1, unit: 'normalized' })
      currentPeriod = period
      continue
    }

    if (parserObservationActive('timeline')) observeParserStatement('timeline', 'invalid', line, { line: i + 1, unit: 'normalized' })
    throw syntaxError({
      what: `Unsupported timeline syntax: "${line}"`,
      expectedForm: 'a title, a section, or a period (Period : Event…)',
      example: '2025 : Launch',
    })
  }

  return diagram
}
