// ============================================================================
// ASCII renderer — timeline diagrams
//
// Renders Mermaid timeline syntax as a chronological outline with per-period
// markers and indented milestone lists. This keeps the ASCII variant compact
// and readable in terminals while preserving chronology and section grouping.
// ============================================================================

import { parseTimelineDiagram } from '../timeline/parser.ts'
import { colorizeLine, DEFAULT_ASCII_THEME } from './ansi.ts'
import type { AsciiConfig, AsciiTheme, CharRole, ColorMode } from './types.ts'
import { wrapText } from './wrap.ts'

interface StyledSegment {
  text: string
  role: CharRole | null
}

function renderStyledLine(
  segments: StyledSegment[],
  colorMode: ColorMode,
  theme: AsciiTheme,
): string {
  const chars: string[] = []
  const roles: (CharRole | null)[] = []

  for (const segment of segments) {
    for (const char of segment.text) {
      chars.push(char)
      roles.push(segment.role)
    }
  }

  return colorizeLine(chars, roles, theme, colorMode)
}

/**
 * Render a Mermaid timeline diagram to ASCII/Unicode text.
 */
export function renderTimelineAscii(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode = 'none',
  theme: AsciiTheme = DEFAULT_ASCII_THEME,
  maxWidth?: number,
): string {
  const diagram = parseTimelineDiagram(lines)
  const useAscii = config.useAscii

  const marker = useAscii ? 'o' : '○'
  const vertical = useAscii ? '|' : '│'
  const branch = useAscii ? '|' : '├'
  const lastBranch = useAscii ? '`' : '└'
  const horizontal = useAscii ? '-' : '─'
  const periodContinuation = '  '

  const out: string[] = []
  const pushLine = (segments: StyledSegment[] = []): void => {
    out.push(segments.length === 0 ? '' : renderStyledLine(segments, colorMode, theme))
  }

  if (diagram.title) {
    for (const line of wrapText(diagram.title, maxWidth)) {
      pushLine([{ text: line, role: 'text' }])
    }
    pushLine()
  }

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!

    if (section.label) {
      // Bracket only the first line of a wrapped label — bracketing every
      // line would read as one section per line. Continuations indent by
      // one cell to align inside the opening bracket.
      const labelLines = wrapText(section.label.replace(/\n/g, ' / '), maxWidth ? Math.max(1, maxWidth - 2) : undefined)
      labelLines.forEach((line, index) => {
        const segments: StyledSegment[] = [
          index === 0
            ? { text: '[', role: 'border' }
            : { text: ' ', role: null },
          { text: line, role: 'text' },
        ]
        if (index === labelLines.length - 1) segments.push({ text: ']', role: 'border' })
        pushLine(segments)
      })
    }

    for (let periodIndex = 0; periodIndex < section.periods.length; periodIndex++) {
      const period = section.periods[periodIndex]!
      // Continuation lines carry the wider 3-cell prefix, so wrap to that.
      const periodLines = wrapText(period.label, maxWidth ? Math.max(1, maxWidth - 3) : undefined)

      pushLine([
        { text: marker, role: 'junction' },
        { text: ' ', role: null },
        { text: periodLines[0] ?? '', role: 'text' },
      ])
      for (const line of periodLines.slice(1)) {
        pushLine([
          { text: `${periodContinuation} `, role: null },
          { text: line, role: 'text' },
        ])
      }

      for (let eventIndex = 0; eventIndex < period.events.length; eventIndex++) {
        const event = period.events[eventIndex]!
        // First-line prefix ('│  ├─ ') is 6 cells wide.
        const eventLines = wrapText(event.text, maxWidth ? Math.max(1, maxWidth - 6) : undefined)
        const junction = eventIndex === period.events.length - 1 ? lastBranch : branch
        pushLine([
          { text: vertical, role: 'line' },
          { text: '  ', role: null },
          { text: junction, role: eventIndex === period.events.length - 1 ? 'corner' : 'junction' },
          { text: horizontal, role: 'line' },
          { text: ' ', role: null },
          { text: eventLines[0] ?? '', role: 'text' },
        ])

        for (const line of eventLines.slice(1)) {
          pushLine(eventIndex === period.events.length - 1
            ? [
                { text: '    ', role: null },
                { text: line, role: 'text' },
              ]
            : [
                { text: vertical, role: 'line' },
                { text: '   ', role: null },
                { text: line, role: 'text' },
              ])
        }
      }

      const morePeriods = periodIndex < section.periods.length - 1
      const moreSections = sectionIndex < diagram.sections.length - 1
      if (morePeriods || moreSections) pushLine()
    }
  }

  return out.join('\n').trimEnd()
}
