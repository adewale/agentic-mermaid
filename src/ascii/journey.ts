// ============================================================================
// ASCII renderer — journey diagrams
//
// Renders Mermaid user journeys as compact scored task lists with optional
// section headings and actor annotations.
// ============================================================================

import { parseJourneyDiagram } from '../journey/parser.ts'
import { preprocessMermaidLines } from '../mermaid-source.ts'
import { colorizeLine, DEFAULT_ASCII_THEME } from './ansi.ts'
import type { AsciiConfig, AsciiTheme, CharRole, ColorMode } from './types.ts'
import { visualWidth } from './width.ts'

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

/**
 * Render a Mermaid journey diagram to ASCII/Unicode text.
 */
export function renderJourneyAscii(
  text: string,
  config: AsciiConfig,
  colorMode: ColorMode = 'none',
  theme: AsciiTheme = DEFAULT_ASCII_THEME,
  maxWidth?: number,
): string {
  const lines = preprocessMermaidLines(text)
  const diagram = parseJourneyDiagram(lines)
  const useAscii = config.useAscii
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
      for (const line of wrapText(section.label.replace(/\n/g, ' / '), maxWidth ? Math.max(1, maxWidth - 2) : undefined)) {
        pushLine([
          { text: '[', role: 'border' },
          { text: line, role: 'text' },
          { text: ']', role: 'border' },
        ])
      }
    }

    for (let taskIndex = 0; taskIndex < section.tasks.length; taskIndex++) {
      const task = section.tasks[taskIndex]!
      const scoreSegments = renderScoreSegments(task.score, useAscii)
      const scoreWidth = 5
      const taskPrefixWidth = scoreWidth + 1
      const taskLines = wrapText(task.text, maxWidth ? Math.max(1, maxWidth - taskPrefixWidth) : undefined)

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
        const actorLines = wrapText(task.actors.join(', '), maxWidth ? Math.max(1, maxWidth - visualWidth(actorPrefix)) : undefined)
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

function wrapText(text: string, maxWidth: number | undefined): string[] {
  if (!maxWidth || !Number.isFinite(maxWidth) || maxWidth <= 0) return text.split('\n')
  const limit = Math.max(1, Math.floor(maxWidth))
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    lines.push(...wrapParagraph(paragraph, limit))
  }
  return lines.length > 0 ? lines : ['']
}

function wrapParagraph(text: string, maxWidth: number): string[] {
  if (visualWidth(text) <= maxWidth) return [text]
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) {
      const chunks = breakWord(word, maxWidth)
      lines.push(...chunks.slice(0, -1))
      current = chunks[chunks.length - 1] ?? ''
      continue
    }

    const candidate = `${current} ${word}`
    if (visualWidth(candidate) <= maxWidth) {
      current = candidate
      continue
    }

    lines.push(current)
    const chunks = breakWord(word, maxWidth)
    lines.push(...chunks.slice(0, -1))
    current = chunks[chunks.length - 1] ?? ''
  }
  if (current) lines.push(current)
  return lines
}

function breakWord(word: string, maxWidth: number): string[] {
  if (visualWidth(word) <= maxWidth) return [word]
  const lines: string[] = []
  let current = ''
  let width = 0

  for (const char of word) {
    const charWidth = visualWidth(char)
    if (current && width + charWidth > maxWidth) {
      lines.push(current)
      current = char
      width = charWidth
    } else {
      current += char
      width += charWidth
    }
  }

  if (current) lines.push(current)
  return lines
}
