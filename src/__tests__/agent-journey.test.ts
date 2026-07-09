// BUILD-15: journey structured mutation (the pilot promotion from opaque-only
// fallback semantics). Parse / narrow / mutate / verify / serialize, the
// structured-or-opaque fallback, and round-trip identity.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asJourney } from '../agent/types.ts'
import type { JourneyValidDiagram, JourneyMutationOp } from '../agent/types.ts'

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

  test('models title-only journeys as renderable header furniture', () => {
    const d = journey('journey\n  title Only a title')
    expect(d.body.title).toBe('Only a title')
    expect(d.body.sections).toEqual([])
  })

  test('preserves Mermaid literal title and accessibility punctuation structurally', () => {
    const d = journey(`journey
      title Book #2: subtitle &amp; notes
      accTitle: Book #2: accessible subtitle
      accDescr: Literal #2: keep &amp; entity text
      Read: 3: Editor`)

    expect(d.body.title).toBe('Book #2: subtitle &amp; notes')
    expect(d.body.accessibilityTitle).toBe('Book #2: accessible subtitle')
    expect(d.body.accessibilityDescription).toBe('Literal #2: keep &amp; entity text')
    expect(serializeMermaid(d)).toContain('title Book #2: subtitle &amp; notes')
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
    expect(serializeMermaid(d)).toContain('Triage ticket: 2: Agent: Tier 1, Escalation: API')
  })
})

describe('journey structured-or-opaque fallback', () => {
  const opaqueCases: Array<[string, string]> = [
    ['unclosed accDescr block', 'journey\n  accDescr {\n    Accessible\n  Wake: 3: Me'],
    ['out-of-range score', 'journey\n  Wake: 9: Me'],
    ['non-integer score line', 'journey\n  Wake: high: Me'],
    ['header suffix', 'journey EXTRA\n  Alpha: 3: Me'],
    ['no modeled content', 'journey\n  %% comment only'],
    ['unknown colonless body line', 'journey\n  section S\n  nonsense\n  Task: 3: Me'],
    ['section label with colon', 'journey\n  section A:B\n  Task: 3: Me'],
    ['accTitle without colon', 'journey\n  accTitle Missing colon\n  Task: 3: Me'],
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
  })

  test('rename_actor renames across all tasks', () => {
    const d = apply(journey(), { kind: 'rename_actor', from: 'Me', to: 'Sam' })
    for (const s of d.body.sections) {
      for (const t of s.tasks) expect(t.actors).not.toContain('Me')
    }
    expect(d.body.sections[0]!.tasks[2]!.actors).toEqual(['Sam', 'Cat'])
  })

  test('error paths: missing targets, invalid score, unknown actor, emptying floor', () => {
    const cases: Array<[JourneyMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'remove_section', index: 9 }, 'SECTION_NOT_FOUND'],
      [{ kind: 'remove_task', sectionIndex: 0, taskIndex: 9 }, 'TASK_NOT_FOUND'],
      [{ kind: 'set_task_score', sectionIndex: 0, taskIndex: 0, score: 6 }, 'INVALID_OP'],
      [{ kind: 'add_section', label: 'has: colon' }, 'INVALID_OP'],
      [{ kind: 'add_task', sectionIndex: 0, text: 'has: colon', score: 3 }, 'INVALID_OP'],
      [{ kind: 'rename_actor', from: 'Nobody', to: 'Anyone' }, 'ACTOR_NOT_FOUND'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(journey(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
    // The floor: a journey must keep at least one scored task.
    const single = journey('journey\n  Wake: 3: Me')
    const r = mutate(single, { kind: 'remove_task', sectionIndex: 0, taskIndex: 0 })
    expect(r.ok).toBe(false)
  })

  test('mutation does not alias the input diagram', () => {
    const d = journey()
    apply(d, { kind: 'set_task_text', sectionIndex: 0, taskIndex: 0, text: 'Changed' })
    expect(d.body.sections[0]!.tasks[0]!.text).toBe('Make tea')
  })
})

describe('journey verify + render', () => {
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
  test('parse(render(parse(src))) is identity on generated journeys', () => {
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
          const out = serializeMermaid(d)
          const d2 = journey(out)
          expect(d2.body).toEqual(d.body)
          expect(serializeMermaid(d2)).toBe(out)
        },
      ),
      { numRuns: 50 },
    )
  })
})
