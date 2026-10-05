import type { TimelineDiagram, TimelineSection, TimelinePeriod, TimelineEvent } from './types.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import type { MermaidSourceAccessibility } from '../mermaid-source.ts'
import {
  accessibilityFields,
  requireClosedAccessibility,
  scanAccessibilityDirectives,
} from '../shared/accessibility-directives.ts'
import {
  TIMELINE_CONTINUATION_RE,
  TIMELINE_PERIOD_RE,
  TIMELINE_SECTION_RE,
  TIMELINE_TITLE_RE,
  isTimelineCommentLine,
  normalizeTimelineBreaks,
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
  const scanned = scanAccessibilityDirectives(lines)
  requireClosedAccessibility(scanned)
  lines = scanned.familyLines
  const diagram: TimelineDiagram = {
    sections: [],
    ...accessibilityFields({ ...accessibility, ...scanned.accessibility }),
  }

  const header = parseTimelineHeader(lines[0] ?? '')
  if (header?.kind === 'unsupported') throw unsupportedTimelineHeaderError(header.suffix)
  if (header?.direction) diagram.direction = header.direction

  let currentSection: TimelineSection | undefined
  let currentPeriod: TimelinePeriod | undefined
  let sectionIndex = 0
  let periodIndex = 0
  let eventIndex = 0

  const ensureSection = (): TimelineSection => {
    if (currentSection) return currentSection
    currentSection = {
      id: `section-${sectionIndex++}`,
      periods: [],
    }
    diagram.sections.push(currentSection)
    return currentSection
  }

  const pushEvents = (period: TimelinePeriod, rawEvents: string[]): void => {
    for (const rawEvent of rawEvents) {
      const normalized = normalizeTimelineBreaks(rawEvent.trim())
      if (!normalized) continue

      const event: TimelineEvent = {
        id: `event-${eventIndex++}`,
        text: normalized,
      }
      period.events.push(event)
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!

    if (/^timeline\b/i.test(line)) continue
    if (isTimelineCommentLine(line)) continue

    const titleMatch = line.match(TIMELINE_TITLE_RE)
    if (titleMatch) {
      // Pinned Mermaid draws Timeline titles as raw text; unlike node labels,
      // exact <br> is visible text rather than a line break here.
      diagram.title = titleMatch[1]!.trim()
      continue
    }

    const sectionMatch = line.match(TIMELINE_SECTION_RE)
    if (sectionMatch) {
      currentSection = {
        id: `section-${sectionIndex++}`,
        label: normalizeTimelineBreaks(sectionMatch[1]!.trim()),
        periods: [],
      }
      diagram.sections.push(currentSection)
      currentPeriod = undefined
      continue
    }

    const continuationMatch = line.match(TIMELINE_CONTINUATION_RE)
    if (continuationMatch) {
      if (!currentPeriod) {
        throw new Error('Timeline continuation found before any period was declared')
      }
      pushEvents(currentPeriod, splitTimelineEvents(`: ${continuationMatch[1]!}`))
      continue
    }

    const periodMatch = line.match(TIMELINE_PERIOD_RE)
    if (periodMatch) {
      const periodLabel = normalizeTimelineBreaks(periodMatch[1]!.trim())
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
      currentPeriod = period
      continue
    }

    // Upstream parity: a bare line (no colon) is a period with no events —
    // mermaid renders these, and the upstream suite's two-task sections rely
    // on it. Malformed colon lines still fall through to the loud throw.
    if (!line.includes(':') && line.trim().length > 0) {
      const period: TimelinePeriod = {
        id: `period-${periodIndex++}`,
        label: normalizeTimelineBreaks(line.trim()),
        events: [],
      }
      ensureSection().periods.push(period)
      currentPeriod = period
      continue
    }

    throw syntaxError({
      what: `Unsupported timeline syntax: "${line}"`,
      expectedForm: 'a title, a section, or a period (Period : Event…)',
      example: '2025 : Launch',
    })
  }

  return diagram
}
