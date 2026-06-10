// BUILD-15: journey structured mutation (the pilot promotion of a
// source-level family). Parse / narrow / mutate / verify / serialize, the
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
})

describe('journey structured-or-opaque fallback', () => {
  const opaqueCases: Array<[string, string]> = [
    ['accTitle line', 'journey\n  accTitle: Accessible\n  Wake: 3: Me'],
    ['out-of-range score', 'journey\n  Wake: 9: Me'],
    ['non-integer score line', 'journey\n  Wake: high: Me'],
    ['header suffix', 'journey EXTRA\n  Alpha: 3: Me'],
    ['no scored tasks', 'journey\n  title Only a title'],
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
