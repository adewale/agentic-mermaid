import { terminalArtifact, serializeTerminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
// ============================================================================
// ASCII renderer — journey diagrams
//
// Renders Mermaid user journeys as compact scored task lists with optional
// section headings and actor annotations.
// ============================================================================

import { parseJourneyDiagram } from '../journey/parser.ts'
import type { JourneyDiagram } from '../journey/types.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { displayText } from '../multiline-utils.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { DEFAULT_ASCII_THEME } from './ansi.ts'
import { TerminalDocument, type TerminalOwner, type TerminalRun } from './terminal-document.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'

type StyledSegment = TerminalRun

function renderScoreSegments(score: number, useAscii: boolean): StyledSegment[] {
  const filled = useAscii ? '#' : '●'
  const empty = useAscii ? '.' : '○'
  const whole = Math.floor(score)
  const hasFraction = !Number.isInteger(score)
  const segments: StyledSegment[] = [
    { text: filled.repeat(whole), role: 'arrow', kind: 'mark' },
    ...(hasFraction ? [{ text: useAscii ? '+' : '◐', role: 'arrow' as const, kind: 'mark' as const }] : []),
    { text: empty.repeat(5 - whole - Number(hasFraction)), role: 'border', kind: 'mark' },
  ]
  return segments.filter(segment => segment.text.length > 0)
}

/** Block glyphs for scores 1..5 — five distinct heights, lowest to full. */
const SCORE_BLOCKS = ['▁', '▂', '▄', '▆', '█'] as const

/**
 * Score trajectory strip — one glyph per task in source order, a single
 * space between sections. Mirrors the SVG renderer's experience curve so
 * terminal output conveys the trajectory too. ASCII mode uses the score
 * digits themselves. Fractional scores are separated in ASCII mode to avoid
 * concatenation ambiguity; the per-task label also carries the exact value.
 * Scores are parser-validated to the finite 1..5 range.
 */
function renderScoreStrip(diagram: JourneyDiagram, useAscii: boolean): string {
  return diagram.sections
    .map(section => {
      const hasFraction = section.tasks.some(task => !Number.isInteger(task.score))
      return section.tasks
        .map(task => useAscii ? String(task.score) : SCORE_BLOCKS[Math.round(task.score) - 1]!)
        .join(useAscii && hasFraction ? ' ' : '')
    })
    .filter(group => group.length > 0)
    .join(' ')
}

/**
 * Render a Mermaid journey diagram to ASCII/Unicode text.
 */
export function renderJourneyTerminal(
  text: string,
  config: AsciiConfig,
  colorMode: ColorMode = 'none',
  theme: AsciiTheme = DEFAULT_ASCII_THEME,
  maxWidth?: number,
  styleFace?: InternalStyleFace,
): TerminalArtifact {
  maxWidth ??= config.maxWidth
  const source = normalizeMermaidSource(text)
  const diagram = parseJourneyDiagram(source.familyLines, source.accessibility)
  const useAscii = config.useAscii
  const document = new TerminalDocument()
  if (diagram.sections.some(section => section.tasks.length)) document.report({
    code: 'TERMINAL_FAMILY_PROJECTION', feature: 'journey.axis',
    message: 'Journey uses ordered scored task lists and a score strip rather than a geometric axis arrow; task order, actors and exact scores are retained.',
  })
  let owner: TerminalOwner | undefined
  const pushLine = (segments: StyledSegment[] = []): void => {
    document.line(segments, { owner })
  }

  if (diagram.title) {
    owner = { id: 'title', kind: 'label' }
    for (const line of wrapText(displayText(resolveLabelContent(diagram.title, diagram.titleContent)), maxWidth)) {
      pushLine([{ text: line, role: 'text' }])
    }
    pushLine()
  }

  const scoreStrip = renderScoreStrip(diagram, useAscii)
  if (scoreStrip) {
    owner = { id: 'score-strip', kind: 'label' }
    const stripPrefix = 'scores: '
    const stripLines = wrapText(scoreStrip, maxWidth ? Math.max(1, maxWidth - stripPrefix.length) : undefined, { hyphenate: false })
    stripLines.forEach((line, index) => {
      pushLine([
        index === 0
          ? { text: stripPrefix, role: 'border', kind: 'text' }
          : { text: ' '.repeat(stripPrefix.length), role: null },
        { text: line, role: 'arrow', kind: 'mark' },
      ])
    })
    pushLine()
  }

  for (let sectionIndex = 0; sectionIndex < diagram.sections.length; sectionIndex++) {
    const section = diagram.sections[sectionIndex]!
    const sectionStart = document.height
    // Registered once: every run the section paints names this owner.
    const sectionOwner = document.element({ id: section.id, kind: 'band', members: section.tasks.map(task => task.id) })
    owner = sectionOwner

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
      const labelLines = wrapText(displayText(resolveLabelContent(section.label, section.labelContent)).replace(/\n/g, ' / '), maxWidth ? Math.max(1, maxWidth - 2 - cueMarker.length) : undefined)
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
      owner = { id: task.id, kind: 'node', parent: { id: section.id, kind: 'band' } }
      const scoreSegments = renderScoreSegments(task.score, useAscii)
      const scoreWidth = 5
      const taskPrefixWidth = scoreWidth + 1
      const exactScore = Number.isInteger(task.score) ? '' : ` (score ${task.score})`
      const taskLines = wrapText(displayText(resolveLabelContent(task.text, task.textContent)) + exactScore, maxWidth ? Math.max(1, maxWidth - taskPrefixWidth) : undefined)

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
        owner = { id: `${task.id}:actors`, kind: 'label', parent: { id: task.id, kind: 'node' } }
        const actorPrefix = '  by '
        const actorLines = wrapText(task.actors.map((label, index) => displayText(resolveLabelContent(label, task.actorContents?.[index]))).join(', '), maxWidth ? Math.max(1, maxWidth - visualWidth(actorPrefix)) : undefined)
        actorLines.forEach((line, index) => {
          pushLine([
            { text: index === 0 ? '  ' : ' '.repeat(visualWidth(actorPrefix)), role: null },
            ...(index === 0 ? [
              { text: 'by', role: 'border' as const, kind: 'text' as const },
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
    if (document.height > sectionStart) document.region(sectionOwner, {
      x: 0, y: sectionStart, width: document.width, height: document.height - sectionStart,
    })
  }

  return terminalArtifact(document, { colorMode, theme, trimEnd: true })
}

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderJourneyAscii(...args: Parameters<typeof renderJourneyTerminal>): string {
  return serializeTerminalArtifact(renderJourneyTerminal(...args))
}
