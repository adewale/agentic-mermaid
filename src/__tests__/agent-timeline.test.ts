// Timeline structured mutation (3rd structured family).

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asTimeline } from '../agent/types.ts'
import type { TimelineValidDiagram } from '../agent/types.ts'

function parse(src: string) {
  const r = parseMermaid(src); if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  return r.value
}
function timeline(src: string): TimelineValidDiagram {
  const t = asTimeline(parse(src)); if (!t) throw new Error('not timeline'); return t
}

describe('timeline parsing — structured', () => {
  test('title + sections + periods → structured body', () => {
    const d = parse('timeline\n  title History\n  section Phase 1\n  2020 : First\n  2021 : Second\n  section Phase 2\n  2022 : Third')
    expect(d.body.kind).toBe('timeline')
    if (d.body.kind !== 'timeline') return
    expect(d.body.title).toBe('History')
    expect(d.body.sections.length).toBe(2)
    expect(d.body.sections[0]!.label).toBe('Phase 1')
    expect(d.body.sections[0]!.periods.length).toBe(2)
    expect(d.body.sections[0]!.periods[0]!.events[0]!.text).toBe('First')
    expect(d.body.sections[1]!.label).toBe('Phase 2')
  })

  test('multi-event period via colon-separated text', () => {
    const d = parse('timeline\n  2020 : A : B : C')
    if (d.body.kind !== 'timeline') return
    expect(d.body.sections[0]!.periods[0]!.events.map(e => e.text)).toEqual(['A', 'B', 'C'])
  })

  test('continuation line `: text` adds event to previous period', () => {
    const d = parse('timeline\n  2020 : First\n  : Second')
    if (d.body.kind !== 'timeline') return
    expect(d.body.sections[0]!.periods[0]!.events.map(e => e.text)).toEqual(['First', 'Second'])
  })

  test('no title, implicit section is created on first period', () => {
    const d = parse('timeline\n  2020 : A')
    if (d.body.kind !== 'timeline') return
    expect(d.body.title).toBeUndefined()
    expect(d.body.sections.length).toBe(1)
    expect(d.body.sections[0]!.label).toBeUndefined()
  })
})

describe('timeline fidelity fallback', () => {
  test('unmodeled syntax falls back to opaque (lossless)', () => {
    const d = parse('timeline\n  some other line')
    expect(d.body.kind).toBe('opaque')
    expect(asTimeline(d)).toBeNull()
    // Round-trip preserves the unknown line.
    expect(serializeMermaid(d)).toContain('some other line')
  })

  test('continuation `: text` with no prior period falls back to opaque', () => {
    const d = parse('timeline\n  : orphan continuation')
    expect(d.body.kind).toBe('opaque')
  })
})

describe('timeline mutate — all 10 ops', () => {
  const SRC = 'timeline\n  title H\n  section P1\n  2020 : A\n  2021 : B\n  section P2\n  2022 : C'

  test('set_title', () => {
    const r = mutate(timeline(SRC), { kind: 'set_title', title: 'New' })
    expect(r.ok && r.value.body.title).toBe('New')
  })
  test('set_title to null clears it', () => {
    const r = mutate(timeline(SRC), { kind: 'set_title', title: null })
    expect(r.ok && r.value.body.title).toBeUndefined()
  })
  test('add_section', () => {
    const r = mutate(timeline(SRC), { kind: 'add_section', label: 'P3' })
    expect(r.ok && r.value.body.sections.length).toBe(3)
    expect(r.ok && r.value.body.sections[2]!.label).toBe('P3')
  })
  test('remove_section', () => {
    const r = mutate(timeline(SRC), { kind: 'remove_section', index: 0 })
    expect(r.ok && r.value.body.sections.length).toBe(1)
    expect(r.ok && r.value.body.sections[0]!.label).toBe('P2')
  })
  test('remove_section missing → SECTION_NOT_FOUND', () => {
    const r = mutate(timeline(SRC), { kind: 'remove_section', index: 99 })
    expect(!r.ok && r.error.code).toBe('SECTION_NOT_FOUND')
  })
  test('set_section_label', () => {
    const r = mutate(timeline(SRC), { kind: 'set_section_label', index: 0, label: 'Updated' })
    expect(r.ok && r.value.body.sections[0]!.label).toBe('Updated')
  })
  test('add_period with events', () => {
    const r = mutate(timeline(SRC), { kind: 'add_period', sectionIndex: 0, label: '2019', events: ['Zero', 'Half'] })
    expect(r.ok && r.value.body.sections[0]!.periods.length).toBe(3)
    expect(r.ok && r.value.body.sections[0]!.periods[2]!.events.length).toBe(2)
  })
  test('remove_period', () => {
    const r = mutate(timeline(SRC), { kind: 'remove_period', sectionIndex: 0, periodIndex: 0 })
    expect(r.ok && r.value.body.sections[0]!.periods.length).toBe(1)
    expect(r.ok && r.value.body.sections[0]!.periods[0]!.label).toBe('2021')
  })
  test('remove_period missing → PERIOD_NOT_FOUND', () => {
    const r = mutate(timeline(SRC), { kind: 'remove_period', sectionIndex: 0, periodIndex: 99 })
    expect(!r.ok && r.error.code).toBe('PERIOD_NOT_FOUND')
  })
  test('set_period_label', () => {
    const r = mutate(timeline(SRC), { kind: 'set_period_label', sectionIndex: 0, periodIndex: 0, label: '2020-revised' })
    expect(r.ok && r.value.body.sections[0]!.periods[0]!.label).toBe('2020-revised')
  })
  test('add_event', () => {
    const r = mutate(timeline(SRC), { kind: 'add_event', sectionIndex: 0, periodIndex: 0, text: 'A-extra' })
    expect(r.ok && r.value.body.sections[0]!.periods[0]!.events.length).toBe(2)
  })
  test('remove_event', () => {
    const r = mutate(timeline(SRC), { kind: 'remove_event', sectionIndex: 0, periodIndex: 0, eventIndex: 0 })
    expect(r.ok && r.value.body.sections[0]!.periods[0]!.events.length).toBe(0)
  })
  test('set_event_text', () => {
    const r = mutate(timeline(SRC), { kind: 'set_event_text', sectionIndex: 0, periodIndex: 0, eventIndex: 0, text: 'A-revised' })
    expect(r.ok && r.value.body.sections[0]!.periods[0]!.events[0]!.text).toBe('A-revised')
  })
})

describe('timeline round-trip stability', () => {
  const corpus = [
    'timeline\n  2020 : A',
    'timeline\n  title History\n  2020 : A',
    'timeline\n  section Phase 1\n  2020 : A\n  2021 : B',
    'timeline\n  title H\n  section P1\n  2020 : A\n  section P2\n  2021 : B',
    'timeline\n  2020 : A : B : C',
    'timeline\n  2020 : A\n  : Continued',
  ]
  for (const src of corpus) {
    test(`stable: ${src.slice(0, 40).replace(/\n/g, ' / ')}…`, () => {
      const d = parse(src); const s1 = serializeMermaid(d)
      const d2 = parse(s1); expect(serializeMermaid(d2)).toBe(s1)
    })
  }

  test('mutation chain → verify → serialize round-trip', () => {
    const t = timeline('timeline\n  title H\n  2020 : A')
    const r1 = mutate(t, { kind: 'add_section', label: 'New' })
    if (!r1.ok) throw new Error('m1')
    const r2 = mutate(r1.value, { kind: 'add_period', sectionIndex: 1, label: '2024', events: ['X', 'Y'] })
    if (!r2.ok) throw new Error('m2')
    const v = verifyMermaid(r2.value)
    expect(v.ok).toBe(true)
    const s = serializeMermaid(r2.value)
    expect(parseMermaid(s).ok).toBe(true)
  })
})

describe('timeline verify', () => {
  test('clean timeline ok', () => {
    expect(verifyMermaid('timeline\n  2020 : A').ok).toBe(true)
  })
  test('header-only → EMPTY_DIAGRAM', () => {
    const r = verifyMermaid('timeline')
    expect(r.ok).toBe(false)
    expect(r.warnings.some(w => w.code === 'EMPTY_DIAGRAM')).toBe(true)
  })
  test('LABEL_OVERFLOW on long event text', () => {
    const r = verifyMermaid(`timeline\n  2020 : ${'x'.repeat(60)}`)
    expect(r.warnings.some(w => w.code === 'LABEL_OVERFLOW')).toBe(true)
  })
})
