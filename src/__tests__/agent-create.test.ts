import { describe, expect, test } from 'bun:test'
import {
  createMermaid, buildMermaid, mutate, parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid,
} from '../agent/core.ts'
import type { DiagramKind } from '../agent/types.ts'

const ALL_KINDS: DiagramKind[] = [
  'flowchart', 'state', 'sequence', 'timeline', 'class', 'er',
  'journey', 'architecture', 'xychart', 'pie', 'quadrant', 'gantt',
]

describe('createMermaid', () => {
  test('returns an empty STRUCTURED body for every built-in family', () => {
    for (const kind of ALL_KINDS) {
      const d = createMermaid(kind)
      expect(d.kind).toBe(kind)
      expect(d.body.kind).not.toBe('opaque')
      expect(verifyMermaid(d).warnings.some(w => w.code === 'EMPTY_DIAGRAM')).toBe(true)
    }
  })
  test('serializes to the family header', () => {
    expect(serializeMermaid(createMermaid('flowchart'))).toStartWith('flowchart TD')
    expect(serializeMermaid(createMermaid('er'))).toStartWith('erDiagram')
    expect(serializeMermaid(createMermaid('quadrant'))).toStartWith('quadrantChart')
  })
  test('direction option applies to flowchart and state', () => {
    expect(serializeMermaid(createMermaid('flowchart', { direction: 'LR' }))).toStartWith('flowchart LR')
    const s = createMermaid('state', { direction: 'LR' })
    expect(s.body.kind === 'state' && s.body.direction).toBe('LR')
  })
  test('created diagrams feed straight into mutate', () => {
    const d = createMermaid('pie')
    const r = mutate(d, { kind: 'add_slice', label: 'A', value: 5 })
    expect(r.ok && serializeMermaid(r.value)).toBe('pie\n  "A" : 5\n')
  })
  test('unknown kind fails loudly', () => {
    expect(() => createMermaid('nonsense' as DiagramKind)).toThrow(/unknown diagram kind/)
  })
})

describe('buildMermaid', () => {
  test('flowchart from ops round-trips and verifies', () => {
    const r = buildMermaid('flowchart', [
      { kind: 'add_node', id: 'A', label: 'Start' },
      { kind: 'add_node', id: 'B', label: 'End' },
      { kind: 'add_edge', from: 'A', to: 'B', label: 'go' },
    ], { direction: 'LR' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const src = serializeMermaid(r.value)
    expect(src).toBe('flowchart LR\n  A[Start] -->|go| B[End]\n')
    const reparsed = parseMermaid(src)
    expect(reparsed.ok && reparsed.value.body.kind).toBe('flowchart')
    expect(verifyMermaid(r.value).ok).toBe(true)
  })
  test('every family can be authored from a blank slate', () => {
    const cases: Array<[DiagramKind, object[]]> = [
      ['state', [{ kind: 'add_state', id: 'Idle' }, { kind: 'add_transition', from: '[*]', to: 'Idle' }]],
      ['sequence', [{ kind: 'add_participant', id: 'A' }, { kind: 'add_participant', id: 'B' }, { kind: 'add_message', from: 'A', to: 'B', text: 'hi' }]],
      ['timeline', [{ kind: 'add_section', label: 'S' }, { kind: 'add_period', sectionIndex: 0, label: '2024', events: ['e1'] }]],
      ['class', [{ kind: 'add_class', id: 'Animal', members: ['+name: string'] }]],
      ['er', [{ kind: 'add_entity', id: 'USER' }, { kind: 'add_entity', id: 'ORDER' }, { kind: 'add_relation', from: 'USER', to: 'ORDER', leftCard: 'one-only', rightCard: 'zero-or-many' }]],
      ['journey', [{ kind: 'set_title', title: 'J' }, { kind: 'add_section', label: 'S' }, { kind: 'add_task', sectionIndex: 0, text: 't', score: 3 }]],
      ['architecture', [{ kind: 'add_service', id: 'api', label: 'API' }, { kind: 'add_service', id: 'db', label: 'DB' }, { kind: 'add_edge', from: 'api', to: 'db', fromSide: 'R', toSide: 'L' }]],
      ['xychart', [{ kind: 'set_title', title: 'X' }, { kind: 'add_series', kind2: 'bar', values: [1, 2, 3] }]],
      ['pie', [{ kind: 'add_slice', label: 'A', value: 3 }]],
      ['quadrant', [{ kind: 'add_point', label: 'p', x: 0.5, y: 0.5 }]],
      ['gantt', [{ kind: 'add_section', label: 'S' }, { kind: 'add_task', sectionIndex: 0, label: 'T1', start: '2026-01-01', end: '3d' }]],
    ]
    for (const [kind, ops] of cases) {
      const r = buildMermaid(kind, ops as never[])
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      const reparsed = parseMermaid(serializeMermaid(r.value))
      expect(reparsed.ok && reparsed.value.body.kind).toBe(kind)
    }
  })
  test('a failing op reports its index', () => {
    const r = buildMermaid('pie', [
      { kind: 'add_slice', label: 'A', value: 3 },
      { kind: 'set_slice_value', label: 'missing', value: 1 },
    ])
    expect(!r.ok && r.error.opIndex).toBe(1)
    expect(!r.ok && r.error.code).toBe('SLICE_NOT_FOUND')
  })
})

describe('structured-floor relaxation (build-up from empty)', () => {
  test('journey: ops may keep an EMPTY body empty while building up', () => {
    const d = createMermaid('journey')
    const r = mutate(d, { kind: 'set_title', title: 'T' })
    expect(r.ok).toBe(true)
  })
  test('journey: emptying a NON-empty journey is still refused', () => {
    const built = buildMermaid('journey', [
      { kind: 'add_section', label: 'S' },
      { kind: 'add_task', sectionIndex: 0, text: 't', score: 3 },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const r = mutate(built.value, { kind: 'remove_task', sectionIndex: 0, taskIndex: 0 })
    expect(!r.ok && r.error.code).toBe('INVALID_OP')
  })
  test('xychart: ops may keep an EMPTY body empty while building up', () => {
    const d = createMermaid('xychart')
    const r = mutate(d, { kind: 'set_title', title: 'T' })
    expect(r.ok).toBe(true)
  })
  test('xychart: removing the last series of a NON-empty chart is still refused', () => {
    const built = buildMermaid('xychart', [{ kind: 'add_series', kind2: 'bar', values: [1] }])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const r = mutate(built.value, { kind: 'remove_series', index: 0 })
    expect(!r.ok && r.error.code).toBe('INVALID_OP')
  })
})

describe('ER label-less relation round-trip', () => {
  test('add_relation without label serializes to a form that re-parses structured', () => {
    const r = buildMermaid('er', [
      { kind: 'add_entity', id: 'USER' },
      { kind: 'add_entity', id: 'ORDER' },
      { kind: 'add_relation', from: 'USER', to: 'ORDER', leftCard: 'one-only', rightCard: 'zero-or-many' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const src = serializeMermaid(r.value)
    expect(src).toContain('USER ||--o{ ORDER : ""')
    const reparsed = parseMermaid(src)
    expect(reparsed.ok && reparsed.value.body.kind).toBe('er')
    if (reparsed.ok && reparsed.value.body.kind === 'er') {
      expect(reparsed.value.body.relations[0]!.label).toBeUndefined()
    }
  })
})
