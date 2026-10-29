import { parserObservationActive, observeParserStatement, observeParserMutation } from '../shared/parser-observation.ts'
import type { JourneyDiagram, JourneySection, JourneyTask } from './types.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { walkJourneyLines, type JourneyParseIssue } from './parse-core.ts'
import type { MermaidSourceAccessibility } from '../mermaid-source.ts'
import { accessibilityFields } from '../shared/accessibility-directives.ts'

// ============================================================================
// Journey diagram parser
//
// Parses Mermaid user journey syntax into a JourneyDiagram structure.
// The grammar itself lives in parse-core.ts and is shared with the structured
// agent parser — this file only maps walk events onto JourneyDiagram and walk
// issues onto renderer errors.
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

/**
 * Parse a Mermaid user journey diagram.
 * Expects the first line to be "journey".
 */
export function parseJourneyDiagram(
  lines: string[],
  accessibility: MermaidSourceAccessibility = {},
): JourneyDiagram {
  const diagram: JourneyDiagram = { sections: [], ...accessibilityFields(accessibility) }
  if (parserObservationActive('journey')) {
    observeParserStatement('journey', 'header', lines[0] ?? '', { line: 1, unit: 'normalized' })
    observeParserMutation('journey', 'initialize', diagram)
  }

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
    if (parserObservationActive('journey')) observeParserMutation('journey', 'addImplicitSection', currentSection)
    return currentSection
  }

  // Walker callbacks retain normalized statement contents and the supplied
  // line index, including multiple statements on one semicolon-joined line.
  walkJourneyLines(lines, 1, {
    title: (text, lineIndex, content) => {
      if (parserObservationActive('journey')) observeParserStatement('journey', 'title', text, { line: lineIndex + 1, unit: 'normalized' })
      diagram.title = text
      if (content) diagram.titleContent = content
      else delete diagram.titleContent
      if (parserObservationActive('journey')) observeParserMutation('journey', 'setTitle', text, { line: lineIndex + 1, unit: 'normalized' })
    },
    accTitle: (text, lineIndex) => {
      if (parserObservationActive('journey')) observeParserStatement('journey', 'accTitle', text, { line: lineIndex + 1, unit: 'normalized' })
      diagram.accessibilityTitle = text
      if (parserObservationActive('journey')) observeParserMutation('journey', 'setAccessibilityTitle', text, { line: lineIndex + 1, unit: 'normalized' })
    },
    accDescr: (text, lineIndex) => {
      if (parserObservationActive('journey')) observeParserStatement('journey', 'accDescr', text, { line: lineIndex + 1, unit: 'normalized' })
      diagram.accessibilityDescription = text
      if (parserObservationActive('journey')) observeParserMutation('journey', 'setAccessibilityDescription', text, { line: lineIndex + 1, unit: 'normalized' })
    },
    section: (label, lineIndex, content) => {
      if (parserObservationActive('journey')) observeParserStatement('journey', 'section', label, { line: lineIndex + 1, unit: 'normalized' })
      currentSection = {
        id: `section-${sectionIndex++}`,
        label,
        ...(content ? { labelContent: content } : {}),
        tasks: [],
      }
      diagram.sections.push(currentSection)
      if (parserObservationActive('journey')) observeParserMutation('journey', 'addSection', currentSection, { line: lineIndex + 1, unit: 'normalized' })
    },
    task: (text, score, actors, lineIndex, content, actorContents) => {
      if (parserObservationActive('journey')) observeParserStatement('journey', 'task', text, { line: lineIndex + 1, unit: 'normalized' })
      const task: JourneyTask = {
        id: `task-${taskIndex++}`,
        text,
        ...(content ? { textContent: content } : {}),
        score,
        actors,
        ...(actorContents ? { actorContents } : {}),
      }
      ensureSection().tasks.push(task)
      if (parserObservationActive('journey')) observeParserMutation('journey', 'addTask', { ...task, sectionId: currentSection!.id }, { line: lineIndex + 1, unit: 'normalized' })
    },
    issue: issue => {
      if (parserObservationActive('journey')) observeParserStatement('journey', `invalid:${issue.code}`, issue.statement, { line: issue.lineIndex + 1, unit: 'normalized' })
      throw journeyIssueError(issue)
    },
  })

  return diagram
}

function journeyIssueError(issue: JourneyParseIssue): Error {
  switch (issue.code) {
    case 'section_colon':
      return syntaxError({
        what: `Invalid user journey section: "${issue.statement}"`,
        expectedForm: 'section Section name',
        example: 'section Go to work',
      })
    case 'empty_task_text':
      return syntaxError({
        what: `Invalid user journey task: "${issue.statement}"`,
        expectedForm: 'Task name: score: Actor[, Actor…]',
        example: 'Pay: 3: Shopper',
      })
    case 'invalid_score':
    case 'unclosed_accdescr':
      return new Error(issue.detail)
    case 'empty_title':
    case 'unrecognized_line':
      return new Error(`Invalid user journey line: "${issue.statement}". Expected title, section, accessibility metadata, or "Task name: 3: Actor"`)
  }
}
