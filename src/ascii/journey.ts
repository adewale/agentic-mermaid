// ============================================================================
// ASCII renderer — journey diagrams
//
// Renders Mermaid user journeys as compact scored task lists with optional
// section headings and actor annotations.
// ============================================================================

import { parseJourneyDiagram } from '../journey/parser.ts'
import type { JourneyDiagram } from '../journey/types.ts'
import { preprocessMermaidLines } from '../mermaid-source.ts'
import { stripFormattingTags } from '../multiline-utils.ts'
import { colorizeLine, DEFAULT_ASCII_THEME } from './ansi.ts'
import type { AsciiConfig, AsciiTheme, CharRole, ColorMode } from './types.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'

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

function renderScoreSegments(score: number, useAscii: boolean): StyledSegment[] {
  const filled = useAscii ? '#' : '●'
  const empty = useAscii ? '.' : '○'

  const segments: StyledSegment[] = [
    { text: filled.repeat(score), role: 'arrow' },
    { text: empty.repeat(5 - score), role: 'border' },
  ]
  return segments.filter(segment => segment.text.length > 0)
}

/** Block glyphs for scores 1..5 — five distinct heights, lowest to full. */
const SCORE_BLOCKS = ['▁', '▂', '▄', '▆', '█'] as const

/**
 * Score trajectory strip — one glyph per task in source order, a single
 * space between sections. Mirrors the SVG renderer's experience curve so
 * terminal output conveys the trajectory too. ASCII mode uses the score
 * digits themselves. Scores are parser-validated to the 1..5 range.
 */
function renderScoreStrip(diagram: JourneyDiagram, useAscii: boolean): string {
  return diagram.sections
    .map(section => section.tasks
      .map(task => useAscii ? String(task.score) : SCORE_BLOCKS[task.score - 1]!)
      .join(''))
    .filter(group => group.length > 0)
    .join(' ')
}

/**
 * Render a Mermaid journey diagram to ASCII/Unicode text.
 */
export function renderJourneyAscii(
  text: string,
  config: AsciiConfig,
  colorMode: ColorMode = 'none',
  theme: AsciiTheme = DEFAULT_ASCII_THEME,
  maxWidth?: number,
  styleFace?: InternalStyleFace,
): string {
  const lines = preprocessMermaidLines(text)
  const diagram = parseJourneyDiagram(lines)
  const useAscii = config.useAscii
  const out: string[] = []
  const pushLine = (segments: StyledSegment[] = []): void => {
    out.push(segments.length === 0 ? '' : renderStyledLine(segments, colorMode, theme))
  }

  if (diagram.title) {
    for (const line of wrapText(stripFormattingTags(diagram.title), maxWidth)) {
      pushLine([{ text: line, role: 'text' }])
    }
    pushLine()
  }

  const scoreStrip = renderScoreStrip(diagram, useAscii)
  if (scoreStrip) {
    const stripPrefix = 'scores: '
    const stripLines = wrapText(scoreStrip, maxWidth ? Math.max(1, maxWidth - stripPrefix.length) : undefined, { hyphenate: false })
    stripLines.forEach((line, index) => {
      pushLine([
        index === 0
          ? { text: stripPrefix, role: 'border' }
          : { text: ' '.repeat(stripPrefix.length), role: null },
        { text: line, role: 'arrow' },
      ])
    })
    pushLine()
  }

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!

    if (section.label) {
      // Bracket only the first line of a wrapped label — bracketing every
      // line would read as one section per line. Continuations indent by
      // one cell to align inside the opening bracket.
      const roleStyle = resolveRoleStyle(styleFace, 'group-header', { category: section.label }, { includeFallback: false })
      const cue = roleStyle?.cue ?? 'none'
      const cueMarker = cue === 'outline' ? (useAscii ? '* ' : '◇ ')
        : cue === 'double-line' ? (useAscii ? '= ' : '║ ')
        : cue === 'pattern' ? (useAscii ? '# ' : '░ ')
        : ''
      const labelLines = wrapText(stripFormattingTags(section.label).replace(/\n/g, ' / '), maxWidth ? Math.max(1, maxWidth - 2 - cueMarker.length) : undefined)
      labelLines.forEach((line, index) => {
        const segments: StyledSegment[] = [
          { text: index === 0 ? cueMarker : ' '.repeat(cueMarker.length), role: cueMarker ? 'arrow' : null },
          index === 0
            ? { text: '[', role: 'border' }
            : { text: ' ', role: null },
          { text: line, role: 'text' },
        ]
        if (index === labelLines.length - 1) segments.push({ text: ']', role: 'border' })
        pushLine(segments)
      })
    }

    for (let taskIndex = 0; taskIndex < section.tasks.length; taskIndex++) {
      const task = section.tasks[taskIndex]!
      const scoreSegments = renderScoreSegments(task.score, useAscii)
      const scoreWidth = 5
      const taskPrefixWidth = scoreWidth + 1
      const taskLines = wrapText(stripFormattingTags(task.text), maxWidth ? Math.max(1, maxWidth - taskPrefixWidth) : undefined)

      pushLine([
        ...scoreSegments,
        { text: ' ', role: null },
        { text: taskLines[0] ?? '', role: 'text' },
      ])
      for (const line of taskLines.slice(1)) {
        pushLine([
          { text: ' '.repeat(taskPrefixWidth), role: null },
          { text: line, role: 'text' },
        ])
      }

      if (task.actors.length > 0) {
        const actorPrefix = '  by '
        const actorLines = wrapText(task.actors.map(stripFormattingTags).join(', '), maxWidth ? Math.max(1, maxWidth - visualWidth(actorPrefix)) : undefined)
        actorLines.forEach((line, index) => {
          pushLine([
            { text: index === 0 ? '  ' : ' '.repeat(visualWidth(actorPrefix)), role: null },
            ...(index === 0 ? [
              { text: 'by', role: 'border' as const },
              { text: ' ', role: null },
            ] : []),
            { text: line, role: 'text' },
          ])
        })
      }

      const moreTasks = taskIndex < section.tasks.length - 1
      const moreSections = sectionIndex < diagram.sections.length - 1
      if (moreTasks || moreSections) pushLine()
    }
  }

  return out.join('\n').trimEnd()
}
