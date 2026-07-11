import type { TimelineDiagram, TimelineSection, TimelinePeriod, TimelineEvent } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import {
  TIMELINE_ACCESSIBILITY_DESCRIPTION_BLOCK_RE,
  TIMELINE_ACCESSIBILITY_DESCRIPTION_RE,
  TIMELINE_ACCESSIBILITY_TITLE_RE,
  TIMELINE_CONTINUATION_RE,
  TIMELINE_HEADER_DIRECTION_RE,
  TIMELINE_PERIOD_RE,
  TIMELINE_SECTION_RE,
  TIMELINE_TITLE_RE,
  splitTimelineEvents,
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
// upstream lexer only knows LR/TD; the tb/bt/rl tokens the router tolerates
// remain accepted-and-ignored (horizontal) so existing sources are unchanged.
// ============================================================================

/**
 * Parse a Mermaid timeline diagram.
 * Expects the first line to be "timeline".
 */
export function parseTimelineDiagram(lines: string[]): TimelineDiagram {
  const diagram: TimelineDiagram = { sections: [] }

  const headerDirection = lines[0]?.trim().match(TIMELINE_HEADER_DIRECTION_RE)
  if (headerDirection) {
    diagram.direction = headerDirection[1]!.toUpperCase() as TimelineDiagram['direction']
  }

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
      const normalized = normalizeBrTags(rawEvent.trim())
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
    if (/^#/.test(line)) continue

    const titleMatch = line.match(TIMELINE_TITLE_RE)
    if (titleMatch) {
      diagram.title = normalizeBrTags(titleMatch[1]!.trim())
      continue
    }

    const accTitleMatch = line.match(TIMELINE_ACCESSIBILITY_TITLE_RE)
    if (accTitleMatch) {
      diagram.accessibilityTitle = normalizeBrTags(accTitleMatch[1]!.trim())
      continue
    }

    const accDescrMatch = line.match(TIMELINE_ACCESSIBILITY_DESCRIPTION_RE)
    if (accDescrMatch) {
      diagram.accessibilityDescription = normalizeBrTags(accDescrMatch[1]!.trim())
      continue
    }

    if (TIMELINE_ACCESSIBILITY_DESCRIPTION_BLOCK_RE.test(line)) {
      const descriptionLines: string[] = []
      let foundClosingBrace = false

      while (++i < lines.length) {
        const blockLine = lines[i]!
        if (blockLine === '}') {
          foundClosingBrace = true
          break
        }
        descriptionLines.push(blockLine)
      }

      if (!foundClosingBrace) {
        throw new Error('Timeline accDescr block was not closed with "}"')
      }

      diagram.accessibilityDescription = normalizeBrTags(descriptionLines.join('\n').trim())
      continue
    }

    const sectionMatch = line.match(TIMELINE_SECTION_RE)
    if (sectionMatch) {
      currentSection = {
        id: `section-${sectionIndex++}`,
        label: normalizeBrTags(sectionMatch[1]!.trim()),
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
      const periodLabel = normalizeBrTags(periodMatch[1]!.trim())
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
        label: normalizeBrTags(line.trim()),
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

  // Upstream parity: a timeline with a title or sections but no periods still
  // renders (as its header/section furniture). Only a timeline with NOTHING
  // is unrenderable.
  if (diagram.sections.length === 0 && !diagram.title && !diagram.accessibilityTitle && !diagram.accessibilityDescription) {
    throw new Error('Timeline diagram must include at least one period, section, or title')
  }

  return diagram
}
