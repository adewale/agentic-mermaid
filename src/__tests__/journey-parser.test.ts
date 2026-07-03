/**
 * Tests for the journey diagram parser.
 *
 * Covers: title, sections, implicit sections, actor parsing, <br> handling,
 * comments/directives/frontmatter preprocessing, optional actor lists, and
 * invalid scores.
 */
import { describe, it, expect } from 'bun:test'
import { preprocessMermaidLines } from '../mermaid-source.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'

function parse(text: string) {
  return parseJourneyDiagram(preprocessMermaidLines(text))
}

describe('parseJourneyDiagram', () => {
  it('parses a basic journey with title, section, score, and actors', () => {
    const diagram = parse(`journey
      title My working day
      section Go to work
      Make tea: 5: Me`)

    expect(diagram.title).toBe('My working day')
    expect(diagram.sections).toHaveLength(1)
    expect(diagram.sections[0]!.label).toBe('Go to work')
    expect(diagram.sections[0]!.tasks[0]!.text).toBe('Make tea')
    expect(diagram.sections[0]!.tasks[0]!.score).toBe(5)
    expect(diagram.sections[0]!.tasks[0]!.actors).toEqual(['Me'])
  })

  it('creates an implicit section for tasks before the first section', () => {
    const diagram = parse(`journey
      Wake up: 3: Me
      section Morning
      Make coffee: 5: Me`)

    expect(diagram.sections).toHaveLength(2)
    expect(diagram.sections[0]!.label).toBeUndefined()
    expect(diagram.sections[0]!.tasks[0]!.text).toBe('Wake up')
    expect(diagram.sections[1]!.label).toBe('Morning')
  })

  it('parses and trims multiple actors', () => {
    const diagram = parse(`journey
      section Work
      Ship feature: 4: Me, Design, QA`)

    expect(diagram.sections[0]!.tasks[0]!.actors).toEqual(['Me', 'Design', 'QA'])
  })

  it('normalizes <br> tags in title, sections, tasks, and actors', () => {
    const diagram = parse(`journey
      title Product<br>journey
      section Go<br>to work
      Make<br>tea: 5: Me<br>Team`)

    expect(diagram.title).toBe('Product\njourney')
    expect(diagram.sections[0]!.label).toBe('Go\nto work')
    expect(diagram.sections[0]!.tasks[0]!.text).toBe('Make\ntea')
    expect(diagram.sections[0]!.tasks[0]!.actors).toEqual(['Me / Team'])
  })

  it('parses accessibility title and single-line description', () => {
    const diagram = parse(`journey
      accTitle: Working day accessibility title
      accDescr: A compact summary of the working day journey
      section Go to work
      Make tea: 5: Me`)

    expect(diagram.accessibilityTitle).toBe('Working day accessibility title')
    expect(diagram.accessibilityDescription).toBe('A compact summary of the working day journey')
  })

  it('parses multiline accDescr blocks', () => {
    const diagram = parse(`journey
      accDescr {
        A compact summary
        of the working day journey
      }
      section Go to work
      Make tea: 5: Me`)

    expect(diagram.accessibilityDescription).toBe('A compact summary\nof the working day journey')
  })

  it('normalizes quoted labels the same way Mermaid labels are normalized elsewhere', () => {
    const diagram = parse(`journey
      title "My working day"
      section "Go to work"
      "Make tea": 5: "Me"`)

    expect(diagram.title).toBe('My working day')
    expect(diagram.sections[0]!.label).toBe('Go to work')
    expect(diagram.sections[0]!.tasks[0]!.text).toBe('Make tea')
    expect(diagram.sections[0]!.tasks[0]!.actors).toEqual(['Me'])
  })

  it('ignores Mermaid comments, frontmatter, and init directives before the journey header', () => {
    const diagram = parse(`---
      title: Journey sample
      config:
        theme: dark
      ---
      %%{init: {'theme': 'base'}}%%
      %% comment before header
      journey
      %% comment inside body
      section Go to work
      Make tea: 5: Me`)

    expect(diagram.sections).toHaveLength(1)
    expect(diagram.sections[0]!.label).toBe('Go to work')
    expect(diagram.sections[0]!.tasks[0]!.text).toBe('Make tea')
  })

  it('allows tasks without actor lists', () => {
    const diagram = parse(`journey
      section Solo
      Deep work: 4`)

    expect(diagram.sections[0]!.tasks[0]!.actors).toEqual([])
  })

  it('throws on scores outside the 1..5 range', () => {
    expect(() => parse(`journey
      section Work
      Do work: 6: Me`)).toThrow('invalid score 6')
  })

  it('throws when an accDescr block is not closed', () => {
    expect(() => parse(`journey
      accDescr {
        Missing closing brace
      section Work
      Do work: 3: Me`)).toThrow('missing a closing "}"')
  })

  it('renders title-only diagrams as header furniture (upstream parity)', () => {
    expect(parse(`journey
      title Empty`).title).toBe('Empty')
  })

  it('still throws when the diagram carries nothing at all', () => {
    expect(() => parse(`journey`)).toThrow('Journey diagram must include at least one scored task, a section, or a title')
  })
})
