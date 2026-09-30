import { afterAll, describe, expect, test } from 'bun:test'
import {
  createMermaid, buildMermaid, mutate, parseRegisteredMermaid as parseMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid,
} from '../agent/core.ts'
import { BUILTIN_FAMILY_METADATA, type BuiltinFamilyId } from '../agent/families.ts'
import type { DiagramKind } from '../agent/types.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

// One long-lived pinned-Mermaid child is the oracle for every blank below.
const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

// Derived from the registry, so a new family is enrolled here automatically.
const ALL_KINDS: BuiltinFamilyId[] = BUILTIN_FAMILY_METADATA.map(f => f.id)

// What verify says about the blank diagram createMermaid returns. Mindmap
// grammar requires a root, so its blank slate carries a placeholder root node.
const BLANK_VERIFY = {
  flowchart: 'EMPTY_DIAGRAM', state: 'EMPTY_DIAGRAM', sequence: 'EMPTY_DIAGRAM', timeline: 'EMPTY_DIAGRAM',
  class: 'EMPTY_DIAGRAM', er: 'EMPTY_DIAGRAM', journey: 'EMPTY_DIAGRAM', architecture: 'EMPTY_DIAGRAM',
  xychart: 'EMPTY_DIAGRAM', pie: 'EMPTY_DIAGRAM', quadrant: 'EMPTY_DIAGRAM', gantt: 'EMPTY_DIAGRAM',
  mindmap: 'placeholder root', gitgraph: 'EMPTY_DIAGRAM', radar: 'EMPTY_DIAGRAM', sankey: 'EMPTY_DIAGRAM',
} as const satisfies Record<BuiltinFamilyId, 'EMPTY_DIAGRAM' | 'placeholder root'>

describe('createMermaid', () => {
  for (const kind of ALL_KINDS) {
    test(`returns a blank STRUCTURED ${kind} body that verify reports as ${BLANK_VERIFY[kind]}`, () => {
      const d = createMermaid(kind)
      expect({ kind: d.kind, body: d.body.kind }).toEqual({ kind, body: kind })
      const codes = verifyMermaid(d).warnings.map(w => w.code)
      if (BLANK_VERIFY[kind] === 'EMPTY_DIAGRAM') expect(codes).toContain('EMPTY_DIAGRAM')
      else expect({ codes, serialized: serializeMermaid(d) }).toEqual({ codes: [], serialized: 'mindmap\n  root\n' })
    })
  }
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

function renders(source: string): boolean {
  try {
    renderMermaidSVG(source)
    return true
  } catch {
    return false
  }
}

// A saved blank must read back the way pinned Mermaid reads it: typed and
// renderable where Mermaid accepts the bare header, and rejected through the
// family's opaque fallback where Mermaid rejects it (a Sankey needs a link).
// Registered deviation, not a bug: a Gantt with no tasks has no time range to
// draw, so ours diagnoses it where Mermaid draws an empty chart (the same
// deviation official-fence-corpus.test.ts records for gantt.md#6).
const BLANK_RENDER_DEVIATIONS: ReadonlySet<BuiltinFamilyId> = new Set(['gantt'])
// Read generously: Mermaid rejects a bare class header, but its meaning (an
// empty class diagram) is clear, so ours reads it typed and draws it, and
// verify says Mermaid rejects it (upstream-rejection-parity.test.ts).
const BLANK_GENEROUS_READS: ReadonlySet<BuiltinFamilyId> = new Set(['class'])

describe('a blank diagram survives a save wherever Mermaid accepts it', () => {
  for (const kind of ALL_KINDS) {
    test(`${kind}: serialize -> parse -> render agrees with Mermaid on the blank`, async () => {
      const source = serializeMermaid(createMermaid(kind))
      const read = (await upstream.parse(source)).ok || BLANK_GENEROUS_READS.has(kind)
      const reparsed = parseMermaid(source)
      expect({ source, reparsed: reparsed.ok && reparsed.value.body.kind, renders: renders(source) })
        .toEqual({ source, reparsed: read ? kind : 'opaque', renders: read && !BLANK_RENDER_DEVIATIONS.has(kind) })
    })
  }

  // Header furniture is not content: these blanks carry a header tail or a
  // title and still have nothing to plot.
  test.each<[BuiltinFamilyId, string]>([
    ['pie', 'pie showData\n'],
    ['pie', 'pie title Pets\n'],
    ['xychart', 'xychart-beta horizontal\n'],
    ['xychart', 'xychart-beta\n  title Sales\n'],
    ['radar', 'radar-beta\n  title Skills\n'],
    ['state', 'stateDiagram-v2\n  direction LR\n'],
  ])('%s blank %j that Mermaid accepts parses typed and renders', async (kind, source) => {
    const reparsed = parseMermaid(source)
    expect({ upstream: (await upstream.parse(source)).ok, reparsed: reparsed.ok && reparsed.value.body.kind, renders: renders(source) })
      .toEqual({ upstream: true, reparsed: kind, renders: true })
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
    const cases = Object.entries({
      flowchart: [{ kind: 'add_node', id: 'A', label: 'A' }, { kind: 'add_edge', from: 'A', to: 'B' }],
      state: [{ kind: 'add_state', id: 'Idle' }, { kind: 'add_transition', from: '[*]', to: 'Idle' }],
      sequence: [{ kind: 'add_participant', id: 'A' }, { kind: 'add_participant', id: 'B' }, { kind: 'add_message', from: 'A', to: 'B', text: 'hi' }],
      timeline: [{ kind: 'add_section', label: 'S' }, { kind: 'add_period', sectionIndex: 0, label: '2024', events: ['e1'] }],
      class: [{ kind: 'add_class', id: 'Animal', members: ['+name: string'] }],
      er: [{ kind: 'add_entity', id: 'USER' }, { kind: 'add_entity', id: 'ORDER' }, { kind: 'add_relation', from: 'USER', to: 'ORDER', leftCard: 'one-only', rightCard: 'zero-or-many' }],
      journey: [{ kind: 'set_title', title: 'J' }, { kind: 'add_section', label: 'S' }, { kind: 'add_task', sectionIndex: 0, text: 't', score: 3 }],
      architecture: [{ kind: 'add_service', id: 'api', label: 'API' }, { kind: 'add_service', id: 'db', label: 'DB' }, { kind: 'add_edge', from: 'api', to: 'db', fromSide: 'R', toSide: 'L' }],
      xychart: [{ kind: 'set_title', title: 'X' }, { kind: 'add_series', kind2: 'bar', values: [1, 2, 3] }],
      pie: [{ kind: 'add_slice', label: 'A', value: 3 }],
      quadrant: [{ kind: 'add_point', label: 'p', x: 0.5, y: 0.5 }],
      gantt: [{ kind: 'add_section', label: 'S' }, { kind: 'add_task', sectionIndex: 0, label: 'T1', start: '2026-01-01', end: '3d' }],
      mindmap: [{ kind: 'add_node', id: 'Idea', label: 'Idea', parent: 'root' }],
      gitgraph: [{ kind: 'append_commit', id: 'c1' }, { kind: 'create_branch', name: 'dev' }, { kind: 'append_commit', id: 'c2' }],
      radar: [{ kind: 'add_axis', id: 'a', label: 'A' }, { kind: 'add_axis', id: 'b', label: 'B' }, { kind: 'add_axis', id: 'c', label: 'C' }, { kind: 'add_curve', id: 'x', label: 'X', values: [1, 2, 3] }],
      sankey: [{ kind: 'add_link', source: 'Coal', target: 'Power', value: 5 }],
    } satisfies Record<BuiltinFamilyId, object[]>) as Array<[BuiltinFamilyId, object[]]>
    expect(cases.map(([kind]) => kind)).toEqual(ALL_KINDS)
    for (const [kind, ops] of cases) {
      const r = buildMermaid(kind, ops as never[])
      if (!r.ok) throw new Error(`${kind}: ${JSON.stringify(r.error)}`)
      const reparsed = parseMermaid(serializeMermaid(r.value))
      expect({ kind, reparsed: reparsed.ok && reparsed.value.body.kind }).toEqual({ kind, reparsed: kind })
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
