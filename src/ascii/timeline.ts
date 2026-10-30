import { terminalArtifact, serializeTerminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
// ============================================================================
// ASCII renderer — timeline diagrams
//
// Renders Mermaid timeline syntax as a chronological outline with per-period
// markers and indented milestone lists. This keeps the ASCII variant compact
// and readable in terminals while preserving chronology and section grouping.
// ============================================================================

import { parseTimelineDiagram } from '../timeline/parser.ts'
import { DEFAULT_ASCII_THEME } from './ansi.ts'
import { TerminalDocument, type TerminalOwner, type TerminalRun } from './terminal-document.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { wrapText } from './wrap.ts'

type StyledSegment = TerminalRun

/**
 * Render a Mermaid timeline diagram to ASCII/Unicode text.
 */
export function renderTimelineTerminal(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode = 'none',
  theme: AsciiTheme = DEFAULT_ASCII_THEME,
  maxWidth?: number,
): TerminalArtifact {
  maxWidth ??= config.maxWidth
  const diagram = parseTimelineDiagram(lines)
  diagram.title ??= config.title
  const useAscii = config.useAscii

  const marker = useAscii ? 'o' : '○'
  const vertical = useAscii ? '|' : '│'
  const branch = useAscii ? '|' : '├'
  const lastBranch = useAscii ? '`' : '└'
  const horizontal = useAscii ? '-' : '─'
  const periodContinuation = '  '

  const document = new TerminalDocument()
  if (diagram.direction !== undefined) document.report({
    code: 'TERMINAL_FAMILY_PROJECTION', feature: 'timeline.direction',
    message: `timeline ${diagram.direction} is represented by a chronological vertical outline; period order, events and section containment are retained rather than the graphical rail orientation.`,
  })
  let owner: TerminalOwner | undefined
  const pushLine = (segments: StyledSegment[] = []): void => {
    document.line(segments, { owner })
  }

  if (diagram.title) {
    owner = { id: 'title', kind: 'label' }
    for (const line of wrapText(diagram.title, maxWidth)) {
      pushLine([{ text: line, role: 'text' }])
    }
    pushLine()
  }

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const sectionStart = document.height
    // Registered once: every run the section paints names this owner.
    const sectionOwner = document.element({ id: section.id, kind: 'band', members: section.periods.map(period => period.id) })
    owner = sectionOwner

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
      owner = { id: period.id, kind: 'node', parent: { id: section.id, kind: 'band' } }
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
        owner = { id: event.id, kind: 'node', parent: { id: period.id, kind: 'node' } }
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
    if (document.height > sectionStart) document.region(sectionOwner, {
      x: 0, y: sectionStart, width: document.width, height: document.height - sectionStart,
    })
  }

  return terminalArtifact(document, { colorMode, theme, trimEnd: true })
}

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderTimelineAscii(...args: Parameters<typeof renderTimelineTerminal>): string {
  return serializeTerminalArtifact(renderTimelineTerminal(...args))
}
