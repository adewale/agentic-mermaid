import type { JourneyDiagram, JourneySection, JourneyTask } from './types.ts'
import { syntaxError } from '../shared/syntax-error.ts'

// ============================================================================
// Journey diagram parser
//
// Parses Mermaid user journey syntax into a JourneyDiagram structure.
//
// Supported syntax:
//   journey
//   title My working day
//   accTitle: My working day accessibility title
//   accDescr: Short accessibility description
//   accDescr { Multi-line accessibility description }
//   section Go to work
//   Make tea: 5: Me
//   Do work: 1: Me, Cat
// ============================================================================

function normalizeActorLabel(label: string): string {
  return normalizeJourneyLabel(label.trim())
    .split('\n')
    .map(part => part.trim())
    .filter(Boolean)
    .join(' / ')
}

function normalizeJourneyLabel(label: string): string {
  return label
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/<\/?(?:sub|sup|small|mark)\s*>/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<!\*)\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g, '<i>$1</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
}

function isJourneyComment(line: string): boolean {
  return line.startsWith('%%') || line.startsWith('#') || line.startsWith('%')
}

/**
 * Parse a Mermaid user journey diagram.
 * Expects the first line to be "journey".
 */
export function parseJourneyDiagram(lines: string[]): JourneyDiagram {
  const diagram: JourneyDiagram = { sections: [] }

  let currentSection: JourneySection | undefined
  let sectionIndex = 0
  let taskIndex = 0

  const ensureSection = (): JourneySection => {
    if (currentSection) return currentSection
    currentSection = {
      id: `section-${sectionIndex++}`,
      tasks: [],
    }
    diagram.sections.push(currentSection)
    return currentSection
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!

    if (/^journey\b/i.test(line)) continue
    if (isJourneyComment(line)) continue

    const accTitle = parseAccessibilityLine(line, 'accTitle')
    if (accTitle !== undefined) {
      diagram.accessibilityTitle = accTitle
      continue
    }

    const accDescrStart = line.match(/^accDescr\s*:?\s*\{\s*(.*)$/i)
    if (accDescrStart) {
      const initial = accDescrStart[1] ?? ''
      const parsed = collectAccessibilityBlock(initial, lines, i)
      diagram.accessibilityDescription = normalizeJourneyLabel(parsed.text)
      i = parsed.nextIndex
      continue
    }

    const accDescr = parseAccessibilityLine(line, 'accDescr')
    if (accDescr !== undefined) {
      diagram.accessibilityDescription = accDescr
      continue
    }

    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      diagram.title = normalizeJourneyLabel(titleMatch[1]!.trim())
      continue
    }

    const sectionMatch = line.match(/^section\s+(.+)$/i)
    if (sectionMatch) {
      const label = normalizeJourneyLabel(sectionMatch[1]!.trim())
      if (label.includes(':')) {
        throw syntaxError({
          what: `Invalid user journey section: "${line}"`,
          expectedForm: 'section Section name',
          example: 'section Go to work',
        })
      }
      currentSection = {
        id: `section-${sectionIndex++}`,
        label,
        tasks: [],
      }
      diagram.sections.push(currentSection)
      continue
    }

    const taskMatch = line.match(/^(.+?)\s*:\s*([0-9]+)\s*(?::\s*(.*))?$/)
    if (taskMatch) {
      const text = normalizeJourneyLabel(taskMatch[1]!.trim())
      const rawScore = taskMatch[2]!
      const score = Number.parseInt(rawScore, 10)

      if (!text) {
        throw syntaxError({
          what: `Invalid user journey task: "${line}"`,
          expectedForm: 'Task name: score: Actor[, Actor…]',
          example: 'Pay: 3: Shopper',
        })
      }

      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw invalidJourneyScoreError(text, rawScore)
      }

      const actors = (taskMatch[3] ?? '')
        .split(',')
        .map(normalizeActorLabel)
        .filter(Boolean)

      const task: JourneyTask = {
        id: `task-${taskIndex++}`,
        text,
        score,
        actors,
      }

      ensureSection().tasks.push(task)
      continue
    }

    const invalidScore = parseInvalidTaskScore(line)
    if (invalidScore) {
      throw invalidJourneyScoreError(invalidScore.text, invalidScore.rawScore)
    }

    throw new Error(`Invalid user journey line: "${line}". Expected title, section, accessibility metadata, or "Task name: 3: Actor"`)
  }

  // Upstream parity: a journey with a title/acc metadata but no tasks still
  // renders (as its header furniture). Only a journey with NOTHING — no
  // sections, no tasks, no title — is unrenderable.
  if (diagram.sections.length === 0 && !diagram.title && diagram.sections.every(section => section.tasks.length === 0) && !diagram.accessibilityTitle && !diagram.accessibilityDescription) {
    throw new Error('Journey diagram must include at least one scored task, a section, or a title')
  }

  return diagram
}

function parseInvalidTaskScore(line: string): { text: string; rawScore: string } | null {
  const match = line.match(/^(.+?)\s*:\s*([^:]+?)(?:\s*:\s*.*)?$/)
  if (!match) return null
  const text = normalizeJourneyLabel(match[1]!.trim())
  const rawScore = match[2]!.trim()
  if (!text || !rawScore) return null
  return { text, rawScore }
}

function invalidJourneyScoreError(text: string, rawScore: string): Error {
  return new Error(`Journey task "${text}" has invalid score ${rawScore}. Expected an integer from 1 through 5`)
}

function parseAccessibilityLine(
  line: string,
  directive: 'accTitle' | 'accDescr',
): string | undefined {
  const match = line.match(new RegExp(`^${directive}\\s*:[ \\t]*(.+)$`, 'i'))
  return match ? normalizeJourneyLabel(match[1]!.trim()) : undefined
}

function collectAccessibilityBlock(
  initial: string,
  lines: string[],
  startIndex: number,
): { text: string; nextIndex: number } {
  const initialEnd = initial.indexOf('}')
  if (initialEnd !== -1) {
    return {
      text: initial.slice(0, initialEnd).trim(),
      nextIndex: startIndex,
    }
  }

  const parts = [initial.trim()].filter(Boolean)

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]!
    const end = line.indexOf('}')
    if (end !== -1) {
      const beforeBrace = line.slice(0, end).trim()
      if (beforeBrace) parts.push(beforeBrace)
      return {
        text: parts.join('\n'),
        nextIndex: i,
      }
    }
    parts.push(line)
  }

  throw new Error('Journey accDescr block is missing a closing "}"')
}
