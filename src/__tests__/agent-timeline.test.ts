// Timeline structured mutation (3rd structured family).

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { buildMermaid } from '../agent/create.ts'
import { asTimeline } from '../agent/types.ts'
import type { TimelineValidDiagram, TimelineMutationOp } from '../agent/types.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

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
    const d = parse('timeline\n  some:unsupported')
    expect(d.body.kind).toBe('opaque')
    expect(asTimeline(d)).toBeNull()
    // Round-trip preserves the unknown line.
    expect(serializeMermaid(d)).toContain('some:unsupported')
  })

  test('continuation `: text` with no prior period falls back to opaque', () => {
    const d = parse('timeline\n  : orphan continuation')
    expect(d.body.kind).toBe('opaque')
  })

  test('header suffix falls back to opaque instead of being dropped', () => {
    const d = parse('timeline EXTRA\n  2020 : A')
    expect(d.body.kind).toBe('opaque')
    expect(serializeMermaid(d)).toContain('timeline EXTRA')
  })

  test('a trailing colon stays event text, while a dangling event separator falls back to opaque', () => {
    const trailingText = parse('timeline\n  2020 : A :')
    expect(trailingText.body.kind).toBe('timeline')
    if (trailingText.body.kind === 'timeline') {
      expect(trailingText.body.sections[0]!.periods[0]!.events[0]!.text).toBe('A :')
    }
    expect(parse('timeline\n  2020 :').body.kind).toBe('opaque')
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
    expect(r.ok && new Set(r.value.body.sections[0]!.periods[2]!.events.map(e => e.id)).size).toBe(2)
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

  test('normalizes padded mutation text and updates canonicalSource', () => {
    const r = mutate(timeline(SRC), { kind: 'set_event_text', sectionIndex: 0, periodIndex: 0, eventIndex: 0, text: '  A revised  ' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.sections[0]!.periods[0]!.events[0]!.text).toBe('A revised')
    expect(r.value.canonicalSource).toContain('2020 : A revised')
    const reparsed = parse(serializeMermaid(r.value))
    expect(reparsed.body.kind).toBe('timeline')
    if (reparsed.body.kind !== 'timeline') return
    expect(reparsed.body.sections[0]!.periods[0]!.events[0]!.text).toBe('A revised')
  })

  test('rejects mutation text that would change timeline structure on reparse', () => {
    const event = mutate(timeline(SRC), { kind: 'set_event_text', sectionIndex: 0, periodIndex: 0, eventIndex: 0, text: 'A: B' })
    const period = mutate(timeline(SRC), { kind: 'set_period_label', sectionIndex: 0, periodIndex: 0, label: '2020:Q1' })
    const title = mutate(timeline(SRC), { kind: 'set_title', title: '   ' })
    expect(!event.ok && event.error.code).toBe('INVALID_OP')
    expect(!period.ok && period.error.code).toBe('INVALID_OP')
    expect(!title.ok && title.error.code).toBe('INVALID_OP')
  })

  test('removing last period from an implicit section drops the unrenderable empty section', () => {
    const r = mutate(timeline('timeline\n  2020 : A'), { kind: 'remove_period', sectionIndex: 0, periodIndex: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.sections).toEqual([])
    expect(parse(serializeMermaid(r.value)).body.kind).toBe('timeline')
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
  test('section-only timeline is renderable header furniture, not EMPTY_DIAGRAM (upstream parity)', () => {
    const r = verifyMermaid('timeline\n  section Phase 1')
    expect(r.warnings.filter(w => w.code === 'EMPTY_DIAGRAM')).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('timeline direction (upstream `timeline TD` contract)', () => {
  test('`timeline TD` parses structured with direction TD and round-trips', () => {
    const d = parse('timeline TD\n  2020 : A')
    expect(d.body.kind).toBe('timeline')
    if (d.body.kind !== 'timeline') return
    expect(d.body.direction).toBe('TD')
    const s1 = serializeMermaid(d)
    expect(s1.startsWith('timeline TD\n')).toBe(true)
    expect(serializeMermaid(parse(s1))).toBe(s1)
  })
  test('`timeline LR` parses structured with explicit LR preserved', () => {
    const d = parse('timeline LR\n  2020 : A')
    expect(d.body.kind).toBe('timeline')
    if (d.body.kind !== 'timeline') return
    expect(d.body.direction).toBe('LR')
    expect(serializeMermaid(d).startsWith('timeline LR\n')).toBe(true)
  })
  test('bare header keeps direction unset and serializes bare', () => {
    const d = parse('timeline\n  2020 : A')
    if (d.body.kind !== 'timeline') return
    expect(d.body.direction).toBeUndefined()
    expect(serializeMermaid(d).startsWith('timeline\n')).toBe(true)
  })
  test('non-direction header suffix still falls back to opaque', () => {
    expect(parse('timeline EXTRA\n  2020 : A').body.kind).toBe('opaque')
    expect(parse('timeline TB\n  2020 : A').body.kind).toBe('opaque')
  })
})

describe('timeline accessibility metadata (accTitle/accDescr)', () => {
  test('accTitle/accDescr lines parse structured (no phantom period) and round-trip', () => {
    const d = parse('timeline\n  accTitle: Accessible roadmap\n  accDescr: Launch milestones\n  2020 : A')
    expect(d.body.kind).toBe('timeline')
    if (d.body.kind !== 'timeline') return
    expect(d.body.accessibilityTitle).toBe('Accessible roadmap')
    expect(d.body.accessibilityDescription).toBe('Launch milestones')
    expect(d.body.sections.flatMap(s => s.periods.map(p => p.label))).toEqual(['2020'])
    const s1 = serializeMermaid(d)
    expect(s1).toContain('accTitle: Accessible roadmap')
    expect(s1).toContain('accDescr: Launch milestones')
    expect(serializeMermaid(parse(s1))).toBe(s1)
  })
  test('accDescr block form parses structured, keeps newlines, and round-trips', () => {
    const d = parse('timeline\n  accDescr {\n    First line\n    Second line\n  }\n  2020 : A')
    expect(d.body.kind).toBe('timeline')
    if (d.body.kind !== 'timeline') return
    expect(d.body.accessibilityDescription).toBe('First line\nSecond line')
    const s1 = serializeMermaid(d)
    expect(s1).toContain('accDescr {')
    expect(serializeMermaid(parse(s1))).toBe(s1)
  })
  test('set_accessibility_title / set_accessibility_description ops set and clear', () => {
    const t = timeline('timeline\n  2020 : A')
    const r1 = mutate(t, { kind: 'set_accessibility_title', title: 'Spoken title' })
    expect(r1.ok && r1.value.body.accessibilityTitle).toBe('Spoken title')
    if (!r1.ok) return
    expect(r1.value.canonicalSource).toContain('accTitle: Spoken title')
    const r2 = mutate(r1.value, { kind: 'set_accessibility_description', description: 'Spoken description' })
    expect(r2.ok && r2.value.body.accessibilityDescription).toBe('Spoken description')
    if (!r2.ok) return
    const cleared = mutate(r2.value, { kind: 'set_accessibility_title', title: null })
    expect(cleared.ok && cleared.value.body.accessibilityTitle).toBeUndefined()
  })
  test('a11y text that could not survive reparse is rejected prescriptively', () => {
    const t = timeline('timeline\n  2020 : A')
    const bad = mutate(t, { kind: 'set_accessibility_description', description: 'has } brace' })
    expect(!bad.ok && bad.error.code).toBe('INVALID_OP')
  })
})

describe('timeline ops parity with the journey convention (move/insert)', () => {
  const SRC = 'timeline\n  title H\n  section P1\n  2020 : A\n  2021 : B\n  section P2\n  2022 : C'

  test('add_section with insert index', () => {
    const r = mutate(timeline(SRC), { kind: 'add_section', label: 'P0', index: 0 })
    expect(r.ok && r.value.body.sections.map(s => s.label)).toEqual(['P0', 'P1', 'P2'])
  })
  test('add_section index out of range names the valid range', () => {
    const r = mutate(timeline(SRC), { kind: 'add_section', label: 'X', index: 9 })
    expect(!r.ok && r.error.code).toBe('INVALID_OP')
    if (r.ok) return
    expect(r.error.message).toContain('(0..2)')
  })
  test('add_period with insert index', () => {
    const r = mutate(timeline(SRC), { kind: 'add_period', sectionIndex: 0, label: '2019', events: ['Zero'], index: 0 })
    expect(r.ok && r.value.body.sections[0]!.periods.map(p => p.label)).toEqual(['2019', '2020', '2021'])
  })
  test('add_event with insert index', () => {
    const r = mutate(timeline(SRC), { kind: 'add_event', sectionIndex: 0, periodIndex: 0, text: 'A0', index: 0 })
    expect(r.ok && r.value.body.sections[0]!.periods[0]!.events.map(e => e.text)).toEqual(['A0', 'A'])
  })
  test('move_period across sections', () => {
    const r = mutate(timeline(SRC), { kind: 'move_period', fromSection: 0, fromIndex: 0, toSection: 1, toIndex: 1 })
    expect(r.ok && r.value.body.sections[0]!.periods.map(p => p.label)).toEqual(['2021'])
    expect(r.ok && r.value.body.sections[1]!.periods.map(p => p.label)).toEqual(['2022', '2020'])
  })
  test('move_period bad insert position names the valid range', () => {
    const r = mutate(timeline(SRC), { kind: 'move_period', fromSection: 0, fromIndex: 0, toSection: 1, toIndex: 5 })
    expect(!r.ok && r.error.code).toBe('PERIOD_NOT_FOUND')
    if (r.ok) return
    expect(r.error.message).toContain('(0..1)')
  })
  test('move_period out of an implicit section drops the emptied section', () => {
    const src = 'timeline\n  2020 : A\n  section P1\n  2021 : B'
    const r = mutate(timeline(src), { kind: 'move_period', fromSection: 0, fromIndex: 0, toSection: 1, toIndex: 1 })
    expect(r.ok && r.value.body.sections.length).toBe(1)
    expect(r.ok && r.value.body.sections[0]!.periods.map(p => p.label)).toEqual(['2021', '2020'])
  })
  test('move_event across periods', () => {
    const src = 'timeline\n  2020 : A : B\n  2021 : C'
    const r = mutate(timeline(src), { kind: 'move_event', fromSection: 0, fromPeriod: 0, fromIndex: 1, toSection: 0, toPeriod: 1, toIndex: 0 })
    expect(r.ok && r.value.body.sections[0]!.periods[0]!.events.map(e => e.text)).toEqual(['A'])
    expect(r.ok && r.value.body.sections[0]!.periods[1]!.events.map(e => e.text)).toEqual(['B', 'C'])
  })
  test('move_event bad insert position names the valid range', () => {
    const src = 'timeline\n  2020 : A : B\n  2021 : C'
    const r = mutate(timeline(src), { kind: 'move_event', fromSection: 0, fromPeriod: 0, fromIndex: 0, toSection: 0, toPeriod: 1, toIndex: 7 })
    expect(!r.ok && r.error.code).toBe('EVENT_NOT_FOUND')
    if (r.ok) return
    expect(r.error.message).toContain('(0..1)')
  })
  test('move_section reorders sections', () => {
    const r = mutate(timeline(SRC), { kind: 'move_section', from: 1, to: 0 })
    expect(r.ok && r.value.body.sections.map(s => s.label)).toEqual(['P2', 'P1'])
  })
  test('move_section bad target names the valid range', () => {
    const r = mutate(timeline(SRC), { kind: 'move_section', from: 0, to: 4 })
    expect(!r.ok && r.error.code).toBe('SECTION_NOT_FOUND')
    if (r.ok) return
    expect(r.error.message).toContain('(0..1)')
  })
  test('not-found errors name the valid index range', () => {
    const r = mutate(timeline(SRC), { kind: 'remove_period', sectionIndex: 0, periodIndex: 99 })
    expect(!r.ok && r.error.code).toBe('PERIOD_NOT_FOUND')
    if (r.ok) return
    expect(r.error.message).toContain('(valid: 0..1)')
  })
  test('mutation chain with new ops stays round-trip stable', () => {
    const t = timeline(SRC)
    const ops: TimelineMutationOp[] = [
      { kind: 'add_period', sectionIndex: 1, label: '2023', events: ['D'], index: 0 },
      { kind: 'move_period', fromSection: 1, fromIndex: 0, toSection: 0, toIndex: 2 },
      { kind: 'move_section', from: 0, to: 1 },
      { kind: 'set_accessibility_title', title: 'Roadmap' },
    ]
    let cur = t
    for (const op of ops) {
      const r = mutate(cur, op)
      if (!r.ok) throw new Error(JSON.stringify(r.error))
      cur = r.value
    }
    const s1 = serializeMermaid(cur)
    expect(serializeMermaid(parse(s1))).toBe(s1)
    expect(verifyMermaid(cur).ok).toBe(true)
  })
})

describe('timeline differential vs renderer-grade parser', () => {
  test('the canonical source the body serializer emits re-parses identically under parseTimelineDiagram', () => {
    const built = buildMermaid('timeline', [
      { kind: 'set_title', title: 'Release history' },
      { kind: 'set_accessibility_title', title: 'Spoken title' },
      { kind: 'set_accessibility_description', description: 'Spoken description' },
      { kind: 'add_section', label: 'Phase 1' },
      { kind: 'add_period', sectionIndex: 0, label: '2020', events: ['Alpha', 'Beta'] },
      { kind: 'add_period', sectionIndex: 0, label: '2021', events: ['GA'] },
      { kind: 'add_section', label: 'Phase 2' },
      { kind: 'add_period', sectionIndex: 1, label: '2022', events: ['Scale-out'] },
      { kind: 'add_event', sectionIndex: 1, periodIndex: 0, text: 'Hardening', index: 0 },
    ])
    if (!built.ok) throw new Error(JSON.stringify(built.error))
    const d = built.value
    const out = serializeMermaid(d)
    const model = parseTimelineDiagram(normalizeMermaidSource(out).lines)
    expect(model.title).toBe(d.body.title)
    expect(model.accessibilityTitle).toBe(d.body.accessibilityTitle)
    expect(model.accessibilityDescription).toBe(d.body.accessibilityDescription)
    expect(model.sections.map(s => s.label)).toEqual(d.body.sections.map(s => s.label))
    expect(model.sections.map(s => s.periods.map(p => p.label)))
      .toEqual(d.body.sections.map(s => s.periods.map(p => p.label)))
    expect(model.sections.map(s => s.periods.map(p => p.events.map(e => e.text))))
      .toEqual(d.body.sections.map(s => s.periods.map(p => p.events.map(e => e.text))))
  })

  test('direction survives the body → renderer seam', () => {
    const d = parse('timeline TD\n  2020 : A')
    if (d.body.kind !== 'timeline') throw new Error('expected structured timeline')
    const model = parseTimelineDiagram(normalizeMermaidSource(serializeMermaid(d)).lines)
    expect(model.direction).toBe('TD')
  })

  test('clock times containing a colon stay one event on both parser surfaces', () => {
    const source = 'timeline\n  2020 : Standup at 10:30 daily'
    const d = parse(source)
    expect(d.body.kind).toBe('timeline')
    if (d.body.kind !== 'timeline') return
    expect(d.body.sections[0]!.periods[0]!.events.map(event => event.text))
      .toEqual(['Standup at 10:30 daily'])

    const model = parseTimelineDiagram(normalizeMermaidSource(source).lines)
    expect(model.sections[0]!.periods[0]!.events.map(event => event.text))
      .toEqual(['Standup at 10:30 daily'])
  })

  test('event-less periods serialize to the bare form accepted by both parser surfaces', () => {
    const d = parse('timeline\n  2020')
    expect(d.body.kind).toBe('timeline')
    if (d.body.kind !== 'timeline') return
    expect(d.body.sections[0]!.periods[0]!.events).toEqual([])

    const canonical = serializeMermaid(d)
    expect(canonical).toBe('timeline\n  2020\n')
    const model = parseTimelineDiagram(normalizeMermaidSource(canonical).lines)
    expect(model.sections[0]!.periods[0]!.label).toBe('2020')
    expect(model.sections[0]!.periods[0]!.events).toEqual([])
  })
})

describe('timeline INEFFECTIVE_CONFIG lint (wire-or-warn)', () => {
  const withConfig = (fields: string) => `---
config:
  timeline:
${fields}
---
timeline
  2020 : A`

  test('documented-but-unwired timeline config keys are named', () => {
    const r = verifyMermaid(withConfig('    noteMargin: 4\n    rightAngles: true'))
    const fields = r.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field?: string }).field)
    expect(fields).toEqual(['timeline.noteMargin', 'timeline.rightAngles'])
    expect(r.ok).toBe(true) // lint only — never flips verify
  })

  test('wired keys (disableMulticolor/sectionFills/sectionColours) never warn', () => {
    const r = verifyMermaid(withConfig('    disableMulticolor: true'))
    expect(r.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')).toEqual([])
  })
})
