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

  walkJourneyLines(lines, 1, {
    title: text => { diagram.title = text },
    accTitle: text => { diagram.accessibilityTitle = text },
    accDescr: text => { diagram.accessibilityDescription = text },
    section: label => {
      currentSection = {
        id: `section-${sectionIndex++}`,
        label,
        tasks: [],
      }
      diagram.sections.push(currentSection)
    },
    task: (text, score, actors) => {
      const task: JourneyTask = {
        id: `task-${taskIndex++}`,
        text,
        score,
        actors,
      }
      ensureSection().tasks.push(task)
    },
    issue: issue => { throw journeyIssueError(issue) },
  })

  // Upstream parity: a journey with a title/acc metadata but no tasks still
  // renders (as its header furniture). Only a journey with NOTHING — no
  // sections, no tasks, no title — is unrenderable.
  if (diagram.sections.length === 0 && !diagram.title && diagram.sections.every(section => section.tasks.length === 0) && !diagram.accessibilityTitle && !diagram.accessibilityDescription) {
    throw new Error('Journey diagram must include at least one scored task, a section, or a title')
  }

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
    case 'empty_journey':
      return new Error(`Invalid user journey line: "${issue.statement}". Expected title, section, accessibility metadata, or "Task name: 3: Actor"`)
  }
}
