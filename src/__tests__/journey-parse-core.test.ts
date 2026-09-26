// Shared Journey parse core: the renderer parser (src/journey/parser.ts) and
// the structured agent parser (src/agent/journey-body.ts) consume ONE grammar
// (src/journey/parse-core.ts), so the same source text cannot produce
// different labels — or different accept/reject decisions — per surface.
// Also covers the typed opaque outcomes: when the agent parser falls back to
// opaque it now says WHY, and verify maps that reason to a targeted
// journey_* diagnostic instead of the generic journey_opaque.

import { describe, test, expect } from 'bun:test'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { preprocessMermaidLines } from '../mermaid-source.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asJourney } from '../agent/types.ts'
import { hasJourneyStatementDelimiter } from '../journey/parse-core.ts'

function rendererParse(text: string) {
  return parseJourneyDiagram(preprocessMermaidLines(text))
}

function agentBody(text: string) {
  const r = parseMermaid(text)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  return r.value
}

describe('renderer/agent parser convergence', () => {
  test('task text beginning with "journey" is a task, not a skipped header', () => {
    const diagram = rendererParse(`journey
      section S
      journey review: 4: Me
      Other task: 3: Me`)
    expect(diagram.sections[0]!.tasks.map(t => t.text)).toEqual(['journey review', 'Other task'])

    const d = agentBody('journey\n  section S\n  journey review: 4: Me')
    const j = asJourney(d)
    expect(j).not.toBeNull()
    expect(j!.body.sections[0]!.tasks[0]!.text).toBe('journey review')
  })

  test('<br> with surrounding spaces normalizes identically on both surfaces', () => {
    const diagram = rendererParse('journey\n  title Morning <br> Evening\n  Task: 3: Me')
    const d = agentBody('journey\n  title Morning <br> Evening\n  Task: 3: Me')
    const j = asJourney(d)
    expect(j).not.toBeNull()
    expect(diagram.title).toBe('Morning\nEvening')
    expect(j!.body.title).toBe(diagram.title)
  })
})

describe('semicolon statement separation (diagnosed Agentic extension)', () => {
  // The shared splitter retains historical local support. Pinned Mermaid
  // 11.16 rejects this source, so verify diagnoses the extension. Previously
  // both local parsers misparsed two tasks as one task with a bogus actor.
  test('renderer splits semicolon-joined tasks into separate tasks', () => {
    const diagram = rendererParse(`journey
      section S
      Make tea: 5: Me; Go upstairs: 3: Me`)
    const tasks = diagram.sections[0]!.tasks
    expect(tasks.map(t => t.text)).toEqual(['Make tea', 'Go upstairs'])
    expect(tasks.map(t => t.actors)).toEqual([['Me'], ['Me']])
  })

  test('agent parser splits semicolon-joined tasks and round-trips one per line', () => {
    const d = agentBody('journey\n  section S\n  Make tea: 5: Me; Go upstairs: 3: Me')
    const j = asJourney(d)
    expect(j).not.toBeNull()
    expect(j!.body.sections[0]!.tasks.map(t => t.text)).toEqual(['Make tea', 'Go upstairs'])
    expect(serializeMermaid(d)).toBe('journey\n  section S\n    Make tea: 5: Me\n    Go upstairs: 3: Me\n')
  })

  test('HTML entities keep their semicolons through statement splitting', () => {
    const diagram = rendererParse('journey\n  Task A &amp; B: 3: Me; Task C: 4: Me')
    expect(diagram.sections[0]!.tasks.map(t => t.text)).toEqual(['Task A &amp; B', 'Task C'])
  })

  test('trailing semicolon is a statement terminator, not part of the actor', () => {
    const diagram = rendererParse('journey\n  Sit down: 5: Me;')
    expect(diagram.sections[0]!.tasks[0]!.actors).toEqual(['Me'])
    const j = asJourney(agentBody('journey\n  Sit down: 5: Me;'))
    expect(j).not.toBeNull()
    expect(j!.body.sections[0]!.tasks[0]!.actors).toEqual(['Me'])
  })

  test('large semicolon-heavy malformed input stays bounded through the public parser', () => {
    const source = 'journey\nTask: 3: &' + 'a;'.repeat(64_000)
    const started = performance.now()
    expect(() => rendererParse(source)).toThrow()
    expect(performance.now() - started).toBeLessThan(500)
  })

  test('entity semicolons and real delimiters agree with mutation validation', () => {
    expect(hasJourneyStatementDelimiter('Review &amp; revise &#59; sign &#x3B;')).toBe(false)
    expect(hasJourneyStatementDelimiter('Review &amp; revise; next')).toBe(true)
    expect(hasJourneyStatementDelimiter(`Review &${'a'.repeat(32)};`)).toBe(false)
    expect(hasJourneyStatementDelimiter(`Review &${'a'.repeat(33)};`)).toBe(true)
    const parsed = rendererParse('journey\n  A &amp; B &#59; C &#x3B; D: 3: Me; Next: 4: You')
    expect(parsed.sections[0]!.tasks.map(task => task.text)).toEqual([
      'A &amp; B &#59; C &#x3B; D',
      'Next',
    ])
    const agent = asJourney(agentBody('journey\n  A &amp; B &#59; C &#x3B; D: 3: Me; Next: 4: You'))
    expect(agent?.body.sections[0]!.tasks.map(task => task.text)).toEqual(parsed.sections[0]!.tasks.map(task => task.text))
  })
})

describe('accessibility block suffix and colon grammar', () => {
  test('same-line and closing-line suffix statements are classified instead of discarded', () => {
    for (const source of [
      'journey\n  accDescr {summary} Task: 3: Me',
      'journey\n  accDescr {\n    summary\n  } Task: 3: Me',
    ]) {
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('journey')
      if (parsed.value.body.kind === 'journey') expect(parsed.value.body.sections[0]!.tasks[0]!.text).toBe('Task')
    }
  })

  test('task text containing a colon is rejected consistently', () => {
    const parsed = parseMermaid('journey\n  A:B: 3: Me')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.body.kind).toBe('opaque')
  })
})

describe('typed opaque outcomes → targeted verify diagnostics', () => {
  const cases: Array<[string, string, string, number]> = [
    // [name, source, expected syntax tag, expected 1-based line]
    ['section label with colon', 'journey\n  section A:B\n  Task: 3: Me', 'journey_section_colon', 2],
    ['unclosed accDescr block', 'journey\n  accDescr {\n    Accessible\n  Wake: 3: Me', 'journey_unclosed_accdescr', 2],
    ['unrecognized body line', 'journey\n  section S\n  nonsense\n  Task: 3: Me', 'journey_unrecognized_line', 3],
    ['out-of-range score', 'journey\n  Wake: 9: Me', 'journey_invalid_score', 2],
  ]
  for (const [name, src, syntax, line] of cases) {
    test(`${name} carries a reason and verify emits ${syntax}`, () => {
      const d = agentBody(src)
      expect(d.body.kind).toBe('opaque')
      const verify = verifyMermaid(d)
      expect(verify.warnings).toContainEqual(expect.objectContaining({
        code: 'UNSUPPORTED_SYNTAX',
        syntax,
        line,
      }))
      // The generic catch-all must be suppressed when a targeted reason exists.
      expect(verify.warnings).not.toContainEqual(expect.objectContaining({
        syntax: 'journey_opaque',
      }))
      // Opaque still round-trips verbatim.
      expect(serializeMermaid(d).trimEnd()).toBe(src)
    })
  }

  test('targeted diagnostics name the offending construct in the message', () => {
    const verify = verifyMermaid(agentBody('journey\n  section A:B\n  Task: 3: Me'))
    const warning = verify.warnings.find(w => 'syntax' in w && w.syntax === 'journey_section_colon')
    expect(warning).toBeDefined()
    const message = (warning as { message?: string }).message ?? ''
    expect(message).toContain('A:B')
    expect(message).toContain(':')
  })
})

describe('opaque invalid-score scan uses the shared grammar predicates', () => {
  test('commented-out bad scores are not flagged', () => {
    const verify = verifyMermaid(agentBody('journey\n  nonsense\n  # bad: 9: Me\n  %% worse: 7: Me'))
    expect(verify.warnings).not.toContainEqual(expect.objectContaining({
      syntax: 'journey_invalid_score',
    }))
  })

  test('accDescr block interiors are not mistaken for bad task scores', () => {
    const verify = verifyMermaid(agentBody('journey\n  nonsense\n  accDescr {\n  Overall rating: 9 out of 10\n  }\n  Task: 3: Me'))
    expect(verify.warnings).not.toContainEqual(expect.objectContaining({
      syntax: 'journey_invalid_score',
    }))
  })
})
