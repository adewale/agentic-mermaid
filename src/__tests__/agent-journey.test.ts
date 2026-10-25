// BUILD-15: journey structured mutation (the pilot promotion from opaque-only
// fallback semantics). Parse / narrow / mutate / verify / serialize, the
// structured-or-opaque fallback, and round-trip identity.

import { afterAll, beforeAll, describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asJourney } from '../agent/types.ts'
import type { JourneyValidDiagram, JourneyMutationOp } from '../agent/types.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { describeMermaid, describeMermaidTree } from '../agent/describe.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../agent/index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'

const SRC = `journey
  title My working day
  section Go to work
    Make tea: 5: Me
    Go upstairs: 3: Me
    Do work: 1: Me, Cat
  section Go home
    Sit down: 5: Me
`

function journey(src: string = SRC): JourneyValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const j = asJourney(r.value)
  if (!j) throw new Error('not a structured journey: ' + r.value.body.kind)
  return j
}

function apply(d: JourneyValidDiagram, op: JourneyMutationOp): JourneyValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error('mutate: ' + JSON.stringify(r.error))
  return r.value
}

describe('journey structured parse', () => {
  test.each(['<br/>', '<BR >', '<br><br/>'])('retains all-break title, section and task text %s', label => {
    const d = journey(`journey\n  title ${label}\n  section ${label}\n  ${label}: 5: Me`)
    const text = label === '<br><br/>' ? '\n\n' : '\n'
    expect(d.body.title).toBe(text)
    expect(d.body.sections[0]!.label).toBe(text)
    expect(d.body.sections[0]!.tasks[0]!.text).toBe(text)
    const next = apply(d, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 0, score: 4 })
    expect(journey(serializeMermaid(next)).body).toEqual(next.body)
    expect(verifyMermaid(next).ok).toBe(true)
  })

  test('models title, sections, tasks, scores, and actors', () => {
    const d = journey()
    expect(d.kind).toBe('journey')
    expect(d.body.title).toBe('My working day')
    expect(d.body.sections.map(s => s.label)).toEqual(['Go to work', 'Go home'])
    expect(d.body.sections[0]!.tasks.map(t => t.text)).toEqual(['Make tea', 'Go upstairs', 'Do work'])
    expect(d.body.sections[0]!.tasks[2]!.actors).toEqual(['Me', 'Cat'])
    expect(d.body.sections[0]!.tasks[0]!.score).toBe(5)
  })

  test('tasks before any section get an implicit unlabeled section', () => {
    const d = journey('journey\n  Wake up: 4: Me')
    expect(d.body.sections).toHaveLength(1)
    expect(d.body.sections[0]!.label).toBeUndefined()
    expect(d.body.sections[0]!.tasks[0]!.text).toBe('Wake up')
  })

  test('round-trips to canonical source and re-parses identically', () => {
    const d = journey()
    const out = serializeMermaid(d)
    const d2 = journey(out)
    expect(d2.body).toEqual(d.body)
    expect(serializeMermaid(d2)).toBe(out)
  })

  test('models Mermaid accessibility directives without falling back to opaque', () => {
    const d = journey(`journey
      title My working day
      accTitle: Accessible journey
      accDescr {
        A compact summary
        of the working day
      }
      Wake: 3: Me`)
    expect(d.body.accessibilityTitle).toBe('Accessible journey')
    expect(d.body.accessibilityDescription).toBe('A compact summary\nof the working day')
    const out = serializeMermaid(d)
    expect(out).toContain('accTitle: Accessible journey')
    expect(out).toContain('accDescr {')
    expect(journey(out).body).toEqual(d.body)
  })

  test('accepts the universal spaced accessibility form before family parsing', () => {
    const d = journey('journey\n  accTitle Accessible journey\n  accDescr Spaced description\n  Wake: 3: Me')
    expect(d.body.accessibilityTitle).toBe('Accessible journey')
    expect(d.body.accessibilityDescription).toBe('Spaced description')
    expect(serializeMermaid(d)).toContain('accTitle: Accessible journey')
  })

  test('models title-only journeys as renderable header furniture', () => {
    const d = journey('journey\n  title Only a title')
    expect(d.body.title).toBe('Only a title')
    expect(d.body.sections).toEqual([])
  })

  test('preserves Mermaid literal title and accessibility punctuation structurally', () => {
    const d = journey(`journey
      title Book #2: subtitle and notes
      accTitle: Book #2: accessible subtitle
      accDescr: Literal #2: keep &amp; entity text
      Read: 3: Editor`)

    expect(d.body.title).toBe('Book #2: subtitle and notes')
    expect(d.body.accessibilityTitle).toBe('Book #2: accessible subtitle')
    expect(d.body.accessibilityDescription).toBe('Literal #2: keep & entity text')
    expect(journey(serializeMermaid(d)).body).toEqual(d.body)
  })

  test('preserves Journey multiline label semantics through parse and serialize', () => {
    const d = journey(`journey
      title Product<br>journey
      section Go<br>work
      Make<br>tea: 5: Me<br>Team`)

    expect(d.body.title).toBe('Product\njourney')
    expect(d.body.sections[0]!.label).toBe('Go\nwork')
    expect(d.body.sections[0]!.tasks[0]!.text).toBe('Make\ntea')
    expect(d.body.sections[0]!.tasks[0]!.actors).toEqual(['Me / Team'])
    const out = serializeMermaid(d)
    expect(out).toContain('title Product<br>journey')
    expect(out).toContain('section Go<br>work')
    expect(out).toContain('Make<br>tea: 5: Me / Team')
    expect(journey(out).body).toEqual(d.body)
  })

  test('preserves quotes as Journey literal text', () => {
    const d = journey(`journey
      title "My working day"
      section "Go to work"
      "Make tea": 5: "Me"`)

    expect(d.body.title).toBe('"My working day"')
    expect(d.body.sections[0]!.label).toBe('"Go to work"')
    expect(d.body.sections[0]!.tasks[0]!.text).toBe('"Make tea"')
    expect(d.body.sections[0]!.tasks[0]!.actors).toEqual(['"Me"'])
    expect(serializeMermaid(d)).toContain('"Make tea": 5: "Me"')
  })

  test('preserves actor names containing colons after the score separator', () => {
    const d = journey(`journey
      section Support
      Triage ticket: 2: Agent: Tier 1, Escalation: API`)

    expect(d.body.sections[0]!.tasks[0]!.actors).toEqual(['Agent: Tier 1', 'Escalation: API'])
    expect(serializeMermaid(d)).toContain('Triage ticket: 2: Agent#58; Tier 1, Escalation#58; API')
    expect(journey(serializeMermaid(d)).body.sections[0]!.tasks[0]!.actors).toEqual(['Agent: Tier 1', 'Escalation: API'])
    expect(journey(serializeMermaid(d)).body).toEqual(d.body)
  })
})

describe('journey structured-or-opaque fallback', () => {
  const opaqueCases: Array<[string, string]> = [
    ['unclosed accDescr block', 'journey\n  accDescr {\n    Accessible\n  Wake: 3: Me'],
    ['out-of-range score', 'journey\n  Wake: 9: Me'],
    ['non-numeric score line', 'journey\n  Wake: high: Me'],
    ['header suffix', 'journey EXTRA\n  Alpha: 3: Me'],
    ['unknown colonless body line', 'journey\n  section S\n  nonsense\n  Task: 3: Me'],
  ]
  for (const [name, src] of opaqueCases) {
    test(`${name} falls back to opaque and round-trips verbatim`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('opaque')
      expect(asJourney(r.value)).toBeNull()
      expect(serializeMermaid(r.value).trimEnd()).toBe(src)
    })
  }

  test('invalid scores get a Journey-specific unsupported-syntax diagnostic', () => {
    const parsed = parseMermaid('journey\n  Wake: 6: Me')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const verify = verifyMermaid(parsed.value)
    expect(verify.warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'journey_invalid_score',
      line: 2,
    }))
    expect(verify.warnings).not.toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'journey_opaque',
    }))
  })

  test('hash and percent comments do not force opaque fallback', () => {
    const d = journey(`journey
      # hash comment
      % percent comment
      Task: 3: Me`)
    expect(d.body.sections[0]!.tasks[0]!.text).toBe('Task')
    expect(serializeMermaid(d)).toBe('journey\n    Task: 3: Me\n')
  })
})

describe('journey mutation ops', () => {
  test('set_title / clear title', () => {
    expect(apply(journey(), { kind: 'set_title', title: 'New day' }).body.title).toBe('New day')
    expect(apply(journey(), { kind: 'set_title', title: null }).body.title).toBeUndefined()
  })

  test('add_section + add_task extend the journey', () => {
    let d = apply(journey(), { kind: 'add_section', label: 'Evening' })
    expect(d.body.sections).toHaveLength(3)
    d = apply(d, { kind: 'add_task', sectionIndex: 2, text: 'Relax', score: 5, actors: ['Me', 'Cat'] })
    expect(d.body.sections[2]!.tasks[0]).toMatchObject({ text: 'Relax', score: 5, actors: ['Me', 'Cat'] })
    // canonicalSource is rebuilt after mutation — never stale.
    expect(d.canonicalSource).toContain('Relax: 5: Me, Cat')
  })

  test('remove_section / set_section_label', () => {
    const d = apply(journey(), { kind: 'remove_section', index: 1 })
    expect(d.body.sections).toHaveLength(1)
    const e = apply(journey(), { kind: 'set_section_label', index: 0, label: 'Morning' })
    expect(e.body.sections[0]!.label).toBe('Morning')
  })

  test('remove_task / set_task_text / set_task_score / set_task_actors', () => {
    let d = apply(journey(), { kind: 'remove_task', sectionIndex: 0, taskIndex: 1 })
    expect(d.body.sections[0]!.tasks.map(t => t.text)).toEqual(['Make tea', 'Do work'])
    d = apply(d, { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: 'Brew coffee' })
    d = apply(d, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 0, score: 2 })
    d = apply(d, { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: ['Us'] })
    expect(d.body.sections[0]!.tasks[0]).toMatchObject({ text: 'Brew coffee', score: 2, actors: ['Us'] })

    const actors = journey('journey\nTask: 3: &lt;b&gt;Alice&lt;/b&gt;, <b>Alice</b>, Bob')
    const reordered = apply(actors, { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: ['Bob', '<b>Alice</b>', '<b>Alice</b>'] })
    expect(renderMermaidASCII(serializeMermaid(reordered))).toContain('by Bob, Alice, <b>Alice</b>')
    const literal = journey('journey\nTask: 3: &lt;b&gt;Alice&lt;/b&gt;')
    const duplicated = apply(literal, { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: ['<b>Alice</b>', '<b>Alice</b>'] })
    expect(renderMermaidASCII(serializeMermaid(duplicated))).toContain('by <b>Alice</b>, <b>Alice</b>')
    const ambiguous = mutate(actors, { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: ['<b>Alice</b>', '<b>Alice</b>', '<b>Alice</b>'] })
    expect(ambiguous.ok).toBe(false)
    if (!ambiguous.ok) expect(ambiguous.error.code).toBe('INVALID_OP')
  })

  test.each([
    { authored: '&lt;br&gt;', value: '<br>' },
    { authored: '&#42;X&#42;', value: '*X*' },
    { authored: '&#92;n', value: '\\n' },
  ])('setting retrieved $authored values preserves their literal interpretation', ({ authored, value }) => {
    let d = journey(`journey\ntitle ${authored}\nsection ${authored}\n${authored}: 3: ${authored}`)
    expect(d.body).toMatchObject({ title: value, sections: [{ label: value, tasks: [{ text: value, actors: [value] }] }] })
    const before = serializeMermaid(d)
    d = JSON.parse(JSON.stringify(d))
    for (const op of [
      { kind: 'set_title', title: value },
      { kind: 'set_section_label', index: 0, label: value },
      { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: value },
      { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: [value] },
      { kind: 'rename_actor', from: value, to: value },
    ] as JourneyMutationOp[]) d = apply(d, op)
    expect(serializeMermaid(d)).toBe(before)
  })

  test('rename_actor renames across all tasks', () => {
    const d = apply(journey(), { kind: 'rename_actor', from: 'Me', to: 'Sam' })
    for (const s of d.body.sections) {
      for (const t of s.tasks) expect(t.actors).not.toContain('Me')
    }
    expect(d.body.sections[0]!.tasks[2]!.actors).toEqual(['Sam', 'Cat'])
  })

  test('typed edits preserve literal delimiters through the strict writer', () => {
    let d = journey('journey\nsection A&#58;B\nTask: 3: A&#44;B')
    for (const op of [
      { kind: 'set_title', title: 'A; B' },
      { kind: 'set_section_label', index: 0, label: 'A:B; C' },
      { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: 'title Pick: A; B' },
      { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: ['A,B'] },
      { kind: 'rename_actor', from: 'A,B', to: 'A,B; C' },
    ] as JourneyMutationOp[]) {
      d = apply(d, op)
    }
    const expected = { title: 'A; B', sections: [{ label: 'A:B; C', tasks: [{ text: 'title Pick: A; B', score: 3, actors: ['A,B; C'] }] }] }
    expect(d.body).toMatchObject(expected)
    expect(journey(serializeMermaid(d)).body).toMatchObject(expected)
    expect(apply(d, { kind: 'set_title', title: 'A &amp; B' }).body.title).toBe('A &amp; B')
  })

  test('error paths: missing targets, invalid score, unknown actor', () => {
    const cases: Array<[JourneyMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'remove_section', index: 9 }, 'SECTION_NOT_FOUND'],
      [{ kind: 'remove_task', sectionIndex: 0, taskIndex: 9 }, 'TASK_NOT_FOUND'],
      [{ kind: 'set_task_score', sectionIndex: 0, taskIndex: 0, score: 6 }, 'INVALID_OP'],
      [{ kind: 'add_section', label: '' }, 'INVALID_OP'],
      [{ kind: 'add_task', sectionIndex: 0, text: '', score: 3 }, 'INVALID_OP'],
      [{ kind: 'add_section', label: ' ' }, 'INVALID_OP'],
      [{ kind: 'add_task', sectionIndex: 0, text: ' ', score: 3 }, 'INVALID_OP'],
      [{ kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: [' '] }, 'INVALID_OP'],
      [{ kind: 'rename_actor', from: 'Nobody', to: 'Anyone' }, 'ACTOR_NOT_FOUND'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(journey(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
  })

  test('mutation does not alias the input diagram', () => {
    const d = journey()
    apply(d, { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: 'Changed' })
    expect(d.body.sections[0]!.tasks[0]!.text).toBe('Make tea')
  })
})

describe('journey ordering + accessibility ops', () => {
  test('move_task reorders within a section', () => {
    const d = apply(journey(), { kind: 'move_task', fromSection: 0, fromIndex: 0, toSection: 0, toIndex: 2 })
    expect(d.body.sections[0]!.tasks.map(t => t.text)).toEqual(['Go upstairs', 'Do work', 'Make tea'])
  })

  test('move_task moves between sections at the given position', () => {
    const d = apply(journey(), { kind: 'move_task', fromSection: 0, fromIndex: 2, toSection: 1, toIndex: 0 })
    expect(d.body.sections[0]!.tasks.map(t => t.text)).toEqual(['Make tea', 'Go upstairs'])
    expect(d.body.sections[1]!.tasks.map(t => t.text)).toEqual(['Do work', 'Sit down'])
    // canonicalSource is rebuilt: the moved task serializes in its new position.
    expect(d.canonicalSource.indexOf('Do work')).toBeLessThan(d.canonicalSource.indexOf('Sit down'))
  })

  test('move_task out of an implicit unlabeled section removes the empty section (remove_task parity)', () => {
    const d = journey('journey\n  Wake up: 4: Me\n  section Morning\n    Stretch: 3: Me')
    const moved = apply(d, { kind: 'move_task', fromSection: 0, fromIndex: 0, toSection: 1, toIndex: 1 })
    expect(moved.body.sections).toHaveLength(1)
    expect(moved.body.sections[0]!.label).toBe('Morning')
    expect(moved.body.sections[0]!.tasks.map(t => t.text)).toEqual(['Stretch', 'Wake up'])
  })

  test('move_task keeps a labeled section alive when emptied', () => {
    const d = apply(journey(), { kind: 'move_task', fromSection: 1, fromIndex: 0, toSection: 0, toIndex: 0 })
    expect(d.body.sections.map(s => s.label)).toEqual(['Go to work', 'Go home'])
    expect(d.body.sections[1]!.tasks).toEqual([])
  })

  test('move_section reorders sections', () => {
    const d = apply(journey(), { kind: 'move_section', from: 1, to: 0 })
    expect(d.body.sections.map(s => s.label)).toEqual(['Go home', 'Go to work'])
    const out = serializeMermaid(d)
    expect(out.indexOf('Go home')).toBeLessThan(out.indexOf('Go to work'))
  })

  test('add_task and add_section accept an optional insert index', () => {
    let d = apply(journey(), { kind: 'add_task', sectionIndex: 0, text: 'Boil water', score: 4, index: 0 })
    expect(d.body.sections[0]!.tasks.map(t => t.text)).toEqual(['Boil water', 'Make tea', 'Go upstairs', 'Do work'])
    d = apply(d, { kind: 'add_section', label: 'Prep', index: 0 })
    expect(d.body.sections.map(s => s.label)).toEqual(['Prep', 'Go to work', 'Go home'])
    // Omitting index keeps append semantics.
    d = apply(d, { kind: 'add_task', sectionIndex: 0, text: 'Plan', score: 3 })
    expect(d.body.sections[0]!.tasks.map(t => t.text)).toEqual(['Plan'])
  })

  test('accessibility edits update body, source, metadata, facts, and clears atomically', () => {
    let d = journey('journey\n  accTitle: Old\n  accDescr: Old description\n  Task: 3: Me')
    d = apply(d, { kind: 'set_accessibility_title', title: 'New' })
    d = apply(d, { kind: 'set_accessibility_description', description: 'New description' })
    expect(d.meta.accessibility).toEqual({ title: 'New', descr: 'New description' })
    expect(d.canonicalSource).toContain('accTitle: New')
    expect(describeMermaidFacts(d)).toContain('accessibility title New')
    d = apply(d, { kind: 'set_accessibility_title', title: null })
    d = apply(d, { kind: 'set_accessibility_description', description: null })
    expect(d.meta.accessibility).toEqual({})
    expect(describeMermaidFacts(d).some(fact => fact.startsWith('accessibility '))).toBe(false)
  })

  test('set_accessibility_title / set_accessibility_description set, round-trip, and clear', () => {
    let d = apply(journey(), { kind: 'set_accessibility_title', title: 'Accessible: overview' })
    d = apply(d, { kind: 'set_accessibility_description', description: 'First line\nSecond line' })
    expect(d.body.accessibilityTitle).toBe('Accessible: overview')
    expect(d.body.accessibilityDescription).toBe('First line\nSecond line')
    const out = serializeMermaid(d)
    expect(journey(out).body.accessibilityTitle).toBe('Accessible: overview')
    expect(out).toContain('accDescr {')
    expect(journey(out).body).toEqual(d.body)
    d = apply(d, { kind: 'set_accessibility_title', title: null })
    d = apply(d, { kind: 'set_accessibility_description', description: null })
    expect(d.body.accessibilityTitle).toBeUndefined()
    expect(d.body.accessibilityDescription).toBeUndefined()
    expect(serializeMermaid(d)).not.toContain('accTitle')
  })

  test('ordering/accessibility op error paths', () => {
    const cases: Array<[JourneyMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'move_task', fromSection: 9, fromIndex: 0, toSection: 0, toIndex: 0 }, 'SECTION_NOT_FOUND'],
      [{ kind: 'move_task', fromSection: 0, fromIndex: 9, toSection: 0, toIndex: 0 }, 'TASK_NOT_FOUND'],
      [{ kind: 'move_task', fromSection: 0, fromIndex: 0, toSection: 9, toIndex: 0 }, 'SECTION_NOT_FOUND'],
      [{ kind: 'move_task', fromSection: 0, fromIndex: 0, toSection: 1, toIndex: 5 }, 'TASK_NOT_FOUND'],
      [{ kind: 'move_section', from: 9, to: 0 }, 'SECTION_NOT_FOUND'],
      [{ kind: 'move_section', from: 0, to: 9 }, 'SECTION_NOT_FOUND'],
      [{ kind: 'add_task', sectionIndex: 0, text: 'X', score: 3, index: 99 }, 'INVALID_OP'],
      [{ kind: 'add_section', label: 'X', index: -1 }, 'INVALID_OP'],
      [{ kind: 'set_accessibility_title', title: '   ' }, 'INVALID_OP'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(journey(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
  })
})

describe('journey facts aggregates + describe model', () => {
  // The parity spec (journey-migration-parity.md §Describe, Facts, and Verify)
  // commits to score statistics in facts — the "find the pain points" surface.
  test('facts include section/task/actor counts, score stats, and extremes', () => {
    const facts = describeMermaidFacts(journey())
    expect(facts).toContain('journey sections 2')
    expect(facts).toContain('journey tasks 4')
    expect(facts).toContain('journey actors 2')
    expect(facts).toContain('journey score range 1..5')
    expect(facts).toContain('journey average score 3.5')
    expect(facts).toContain('journey lowest task Do work score 1')
    expect(facts).toContain('journey highest task Make tea score 5')
    expect(facts).toContain('journey highest task Sit down score 5')
    expect(facts).toContain('journey actor Me tasks 4')
    expect(facts).toContain('journey actor Cat tasks 1')
  })

  test('describe tree exposes score and actors, not bare task text', () => {
    const tree = describeMermaidTree(journey())
    const labels = tree.nodes.map(n => n.label)
    expect(labels).toContain('Make tea (score 5; Me)')
    expect(labels).toContain('Do work (score 1; Me, Cat)')

    const formatted = journey('journey\nFirst: 3: &lt;b&gt;Alice&lt;/b&gt;\nSecond: 4: <b>Alice</b>\nThird: 5: &lt;b&gt;Alice&lt;/b&gt;, <b>Alice</b>')
    const facts = describeMermaidFacts(formatted)
    expect(facts).toContain('journey actors 2')
    expect(facts).toContain('journey actor <b>Alice</b> tasks 2')
    expect(facts).toContain('journey actor Alice tasks 2')
    expect(describeMermaid(formatted)).toContain('Actors: <b>Alice</b>, Alice.')
    expect(describeMermaidTree(formatted).nodes.map(node => node.label)).toContain('Third (score 5; <b>Alice</b>, Alice)')
  })
})

describe('journey ineffective-config lint', () => {
  test('sequence-era no-op config fields are named, effective fields are not', () => {
    const parsed = parseMermaid('%%{init: {"journey": {"boxMargin": 10, "rightAngles": true, "taskMargin": 40}}}%%\njourney\n  Task: 3: Me')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const verify = verifyMermaid(parsed.value)
    expect(verify.ok).toBe(true)
    const fields = verify.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field: string }).field)
    expect(fields).toEqual(['journey.boxMargin', 'journey.rightAngles'])
  })

  test('journeys without no-op config stay lint-free', () => {
    const verify = verifyMermaid(journey())
    expect(verify.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')).toEqual([])
  })
})

describe('journey verify + render', () => {
  test('section containment is checked (groups healthy on a real journey)', () => {
    // groupContainment is enabled for journey: sections project as groups
    // with task members, so this is the regression guard that keeps it on.
    const verify = verifyMermaid(journey())
    expect(verify.ok).toBe(true)
    expect(verify.warnings.filter(w => w.code === 'GROUP_BREACH')).toEqual([])
    expect(verify.layout.groups.length).toBeGreaterThan(0)
  })

  test('verify passes on a healthy journey and serializes after the loop', () => {
    let d = journey()
    d = apply(d, { kind: 'add_task', sectionIndex: 1, text: 'Sleep', score: 5, actors: ['Me'] })
    const v = verifyMermaid(d)
    expect(v.ok).toBe(true)
    expect(serializeMermaid(d)).toContain('Sleep: 5: Me')
  })

  test('verify treats Mermaid header-furniture journeys as renderable', () => {
    for (const src of [
      'journey\n  title Adding journey diagram functionality to mermaid',
      'journey\n  accTitle: Accessible journey',
      'journey\n  section Order from website',
    ]) {
      const d = journey(src)
      const v = verifyMermaid(d)
      expect({ src, ok: v.ok, codes: v.warnings.map(w => w.code) }).toEqual({ src, ok: true, codes: [] })
    }
  })

  test('LABEL_OVERFLOW fires on an over-cap task text', () => {
    const long = 'X'.repeat(80)
    const d = journey(`journey\n  ${long}: 3: Me`)
    const v = verifyMermaid(d)
    const overflow = v.warnings.find(w => w.code === 'LABEL_OVERFLOW')
    expect(overflow).toBeDefined()
  })

  test('mutated journey renders through the legacy renderer', async () => {
    const { renderMermaidSVG } = await import('../agent/index.ts')
    const d = apply(journey(), { kind: 'add_task', sectionIndex: 0, text: 'Stretch', score: 4, actors: ['Me'] })
    const svg = renderMermaidSVG(d)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Stretch')
  })
})

describe('journey round-trip property', () => {
  const textArb = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,18}[A-Za-z]$/)
  test('parse(serialize(parse(src))) is identity on generated journeys', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            label: textArb,
            tasks: fc.array(
              fc.record({
                text: textArb,
                score: fc.integer({ min: 1, max: 5 }),
                actors: fc.array(textArb, { maxLength: 3 }),
              }),
              { minLength: 1, maxLength: 4 },
            ),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        sections => {
          const src = ['journey', ...sections.flatMap(s => [
            `  section ${s.label}`,
            ...s.tasks.map(t => `    ${t.text}: ${t.score}${t.actors.length ? `: ${t.actors.join(', ')}` : ''}`),
          ])].join('\n')
          const d = journey(src)
          const meaning = (diagram: JourneyValidDiagram) => diagram.body.sections.map(section => ({
            label: section.label,
            tasks: section.tasks.map(({ text, score, actors }) => ({ text, score, actors })),
          }))
          expect(meaning(d)).toEqual(sections)
          const out = serializeMermaid(d)
          const d2 = journey(out)
          expect(meaning(d2)).toEqual(sections)
          expect(serializeMermaid(d2)).toBe(out)
        },
      ),
      fcParameters({ numRuns: 50 }),
    )
  })
})


describe('Journey field escapes preserve literal text', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(() => upstream.close())

  test.each([
    ['%% Keep this task\njourney\n  Book #2: 3: Editor', 'journey_nonportable_text', { title: '', sections: [], tasks: [{ text: 'Book #2', score: 3, actors: ['Editor'] }] }],
    ['journey journey:5', 'journey_nonportable_text', { title: '', sections: [], tasks: [{ text: 'journey', score: 5, actors: [] }] }],
    ['journey\n  journey review: 4: Me', 'journey_nonportable_text', { title: '', sections: [], tasks: [{ text: 'journey review', score: 4, actors: ['Me'] }] }],
    ['journey\n  Review &amp; revise: 3: Me', 'journey_entity_semicolon', { title: '', sections: [], tasks: [{ text: 'Review & revise', score: 3, actors: ['Me'] }] }],
    ['journey\n  title &lt;', 'journey_entity_semicolon', { title: '<', sections: [], tasks: [] }],
    ['journey\n  section &mp;\n  Read: 4: Editor', 'journey_entity_semicolon', { title: '', sections: ['&mp;'], tasks: [{ text: 'Read', score: 4, actors: ['Editor'] }] }],
    ['journey\n  Read: 4: &lt;', 'journey_entity_semicolon', { title: '', sections: [], tasks: [{ text: 'Read', score: 4, actors: ['<'] }] }],
  ])('retains literal native text through editable portable output: %s', async (source, syntax, expected) => {
    expect(await upstream.accepts(source)).toBe(false)
    expect(await upstream.publicAccepts('journey\nControl: 3: Actor')).toBe(true)
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    if (parsed.value.body.kind !== 'journey') throw new Error('Expected editable Journey')
    const written = serializeMermaid(parsed.value)
    expect(await upstream.publicAccepts(written), written).toBe(true)
    const reference = await upstream.project(written, diagram => ({
      title: diagram.db.getDiagramTitle(), sections: diagram.db.getSections(),
      tasks: diagram.db.getTasks().map((task: any) => ({ text: task.task, score: task.score, actors: task.people })),
    }))
    expect(reference.ok).toBe(true)
    if (!reference.ok) throw new Error(reference.error)
    expect({
      title: projectEntityMarkers(reference.value.title),
      sections: reference.value.sections.map((label: string) => projectEntityMarkers(label)),
      tasks: reference.value.tasks.map((task: { text: string; score: number; actors: string[] }) => ({ text: projectEntityMarkers(task.text), score: task.score, actors: task.actors.map(actor => projectEntityMarkers(actor)) })),
    }).toEqual(expected)
    expect(journey(written).body).toEqual(parsed.value.body)
    expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(source))
    expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax }))
    expect(mutate(parsed.value, { kind: 'set_title', title: 'Safe title' }).ok).toBe(true)
  })

  const unwritable: JourneyMutationOp[] = [
    { kind: 'set_title', title: '&lt;' },
    { kind: 'add_section', label: '&amp;' },
    { kind: 'set_section_label', index: 0, label: '&mp;' },
    { kind: 'add_task', sectionIndex: 0, text: 'journey review', score: 3 },
    { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: 'Book #2' },
    { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: '&lt;' },
    { kind: 'set_task_actors', sectionIndex: 0, taskIndex: 0, actors: ['&lt;'] },
    { kind: 'rename_actor', from: 'Me', to: '&lt;' },
  ]
  test.each(unwritable)('writes text without leaking grammar tokens: %j', async op => {
    const parsed = journey()
    const before = serializeMermaid(parsed)
    const result = mutate(parsed, op)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(await upstream.publicAccepts(serializeMermaid(result.value))).toBe(true)
      expect(journey(serializeMermaid(result.value)).body).toEqual(result.value.body)
    }
    expect(serializeMermaid(parsed)).toBe(before)
  })

  test('neighboring task words and accessibility literals remain editable and reload intact', async () => {
    let parsed = journey('journey\n  section Reading\n  journeys: 3: Editor')
    parsed = apply(parsed, { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: 'journeyed' })
    parsed = apply(parsed, { kind: 'set_accessibility_title', title: 'Book #2 &amp;' })
    parsed = apply(parsed, { kind: 'set_accessibility_description', description: 'Read &lt; and #2' })
    const written = serializeMermaid(parsed)
    expect(await upstream.accepts(written)).toBe(true)
    expect(journey(written).body).toEqual(parsed.body)
    expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(parsed))
  })

  test('multiline accessibility values protect literal entities and block delimiters on every line', async () => {
    let parsed = journey('journey\naccDescr {\nLine &amp;amp;\nHash #35;35;\n}\nTask: 3: Me')
    expect(parsed.body.accessibilityDescription).toBe('Line &amp;\nHash #35;')
    parsed = apply(parsed, { kind: 'set_task_score', sectionIndex: 0, taskIndex: 0, score: 4 })
    expect(journey(serializeMermaid(parsed)).body).toEqual(parsed.body)
    const description = 'First { literal }\nSecond; %%{ #35;'
    parsed = apply(parsed, { kind: 'set_accessibility_description', description })
    const written = serializeMermaid(parsed)
    expect(journey(written).body).toEqual(parsed.body)
    const reference = await upstream.project(written, diagram => diagram.db.getAccDescription())
    expect(reference.ok).toBe(true)
    if (!reference.ok) throw new Error(reference.error)
    expect(projectEntityMarkers(reference.value).split(/\r?\n/).map(line => line.trim()).join('\n')).toBe(description)
    expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(parsed))
    expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(parsed))
  })
})
