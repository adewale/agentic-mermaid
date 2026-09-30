// BUILD-19: state structured mutation. Promotes the state family from a
// "parses AS flowchart" projection to a dedicated StateBody IR with state-shaped
// ops and a real `asState` narrower. Covers: parse / narrow / mutate / verify /
// serialize, the structured-or-opaque fallback, round-trip identity, an error-
// path table for every op, an opaque-fallback table, the differential proof
// (canonical source re-parses under the LEGACY parser into a graph whose
// nodes/edges correspond 1:1 to the body's states/transitions), a fast-check
// round-trip property over generated state machines (incl. nested composites),
// and the verify-projection proof (state runs the same geometric Tier 2 path
// as the equivalent flowchart).

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asState, asFlowchart } from '../agent/types.ts'
import type { LayoutWarning, StateValidDiagram, StateMutationOp, StateNode, StateTransition, MutationError } from '../agent/types.ts'
import { parseMermaid as parseLegacy } from '../parser.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { describeMermaid, describeMermaidTree } from '../agent/describe.ts'

const SRC = `stateDiagram-v2
  [*] --> Idle
  state "In Progress" as Active
  Idle --> Active : start
  Active --> Idle : pause
  Active --> [*] : done
`

function state(src: string = SRC): StateValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const s = asState(r.value)
  if (!s) throw new Error('not a structured state: ' + r.value.body.kind)
  return s
}

function apply(d: StateValidDiagram, op: StateMutationOp): StateValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error('mutate: ' + JSON.stringify(r.error))
  return r.value
}

function expectErr(d: StateValidDiagram, op: StateMutationOp, code: MutationError['code']): void {
  const r = mutate(d, op)
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.code).toBe(code)
}

// ---------------------------------------------------------------------------
describe('state structured parse', () => {
  test('models states, labels, transitions, and [*] pseudostates', () => {
    const d = state()
    expect(d.kind).toBe('state')
    expect(d.body.kind).toBe('state')
    const ids = d.body.states.map(s => s.id).sort()
    expect(ids).toEqual(['Active', 'Idle'])
    const active = d.body.states.find(s => s.id === 'Active')!
    expect(active.label).toBe('In Progress')
    expect(d.body.transitions).toContainEqual({ from: '[*]', to: 'Idle' })
    expect(d.body.transitions).toContainEqual({ from: 'Idle', to: 'Active', label: 'start' })
    expect(d.body.transitions).toContainEqual({ from: 'Active', to: '[*]', label: 'done' })
  })

  test('asState narrows; asFlowchart returns null (the BUILD-19 breaking flip)', () => {
    const r = parseMermaid(SRC)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(asState(r.value)).not.toBeNull()
    expect(asFlowchart(r.value)).toBeNull()
  })

  test('models nested composite states with per-composite direction', () => {
    const d = state(`stateDiagram-v2
  [*] --> First
  state First {
    direction LR
    [*] --> inner
    inner --> [*]
  }
  First --> [*]`)
    const first = d.body.states.find(s => s.id === 'First')!
    expect(first.states).toBeDefined()
    expect(first.direction).toBe('LR')
    expect(first.states!.map(s => s.id)).toEqual(['inner'])
    expect(first.transitions).toContainEqual({ from: '[*]', to: 'inner' })
    // The top-level transition referencing the composite stays at top level.
    expect(d.body.transitions).toContainEqual({ from: '[*]', to: 'First' })
    expect(d.body.transitions).toContainEqual({ from: 'First', to: '[*]' })
  })

  test('forward references to nested composites keep one globally unique ID', () => {
    let d = state(`stateDiagram-v2
  A --> C
  state P {
    state C {
      X --> Y
    }
  }`)
    const all: StateNode[] = []
    const walk = (nodes: StateNode[]) => { for (const node of nodes) { all.push(node); if (node.states) walk(node.states) } }
    walk(d.body.states)
    expect(all.filter(node => node.id === 'C')).toHaveLength(1)
    expect(all.find(node => node.id === 'C')?.states).toBeDefined()
    d = apply(d, { kind: 'set_direction', state: 'C', direction: 'LR' })
    expect(state(serializeMermaid(d)).body).toEqual(d.body)
  })

  test('top-level direction is modeled', () => {
    const d = state(`stateDiagram-v2
  direction LR
  A --> B`)
    expect(d.body.direction).toBe('LR')
  })
})

// ---------------------------------------------------------------------------
describe('state round-trip identity', () => {
  const cases: [string, string][] = [
    ['simple', `stateDiagram-v2
  [*] --> Still
  Still --> Moving
  Moving --> [*]`],
    ['labels', `stateDiagram-v2
  state "Nice Label" as s1
  s1 --> s2 : go`],
    ['nested composite', `stateDiagram-v2
  [*] --> First
  state First {
    [*] --> inner
    inner --> [*]
  }
  First --> [*]`],
  ]
  for (const [name, src] of cases) {
    test(`${name}: serialize → parse → serialize is idempotent`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const s1 = serializeMermaid(r.value)
      const r2 = parseMermaid(s1)
      expect(r2.ok).toBe(true)
      if (!r2.ok) return
      expect(serializeMermaid(r2.value)).toBe(s1)
      expect(s1.startsWith('stateDiagram-v2')).toBe(true)
    })
  }

  test('standalone alias with label equal to id stays renderable', () => {
    const d = state(`stateDiagram-v2
  state "as" as as`)
    const out = serializeMermaid(d)
    expect(out).toContain('state "as" as as')
    const v = verifyMermaid(d)
    expect(v.warnings.map(w => w.code)).not.toContain('EMPTY_DIAGRAM')
    expect(v.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('state residual syntax promotion table', () => {
  const promoted: [string, string][] = [
    ['concurrency --', `stateDiagram-v2
  state Active {
    [*] --> A
    --
    [*] --> B
  }`],
    ['classDef styling', `stateDiagram-v2
  classDef bad fill:#f00
  A --> B
  class A bad`],
    ['::: shorthand', `stateDiagram-v2
  [*] --> A:::bad`],
    ['bare state id', `stateDiagram-v2
  stateId`],
    ['hyphenated composite id', `stateDiagram-v2
  state a-b {
    x --> y
  }`],
  ]
  for (const [name, src] of promoted) {
    test(`${name} → structured body, round-trips canonically`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('state')
      expect(asState(r.value)).not.toBeNull()
      const s1 = serializeMermaid(r.value)
      const r2 = parseMermaid(s1)
      expect(r2.ok).toBe(true)
      if (r2.ok) expect(serializeMermaid(r2.value)).toBe(s1)
    })
  }

  test('fork/choice/join/note — the former opaque rows — now parse structured', () => {
    for (const src of [
      'stateDiagram-v2\n  state fork_state <<fork>>\n  [*] --> fork_state',
      'stateDiagram-v2\n  state if_state <<choice>>\n  [*] --> if_state',
      'stateDiagram-v2\n  state join_state <<join>>\n  State2 --> join_state',
      'stateDiagram-v2\n  A --> B\n  note right of A : hello',
    ]) {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.value.body.kind).toBe('state')
      expect(asState(r.value)).not.toBeNull()
    }
  })

  test('an opaque state body exposes the renderer-backed layout', () => {
    const r = parseMermaid(`stateDiagram-v2
  state Active
  Active --> Done`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.kind).toBe('opaque')
    const verified = verifyMermaid(r.value)
    expect(verified.layout.kind).toBe('state')
    expect(verified.layout.nodes.map(node => node.id).sort()).toEqual(['Active', 'Done'])
    expect(verified.layout.bounds.w).toBeGreaterThan(0)
    expect(verified.layout.bounds.h).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
describe('state mutation — happy paths', () => {
  test('add_state appends a simple state; add_transition wires it', () => {
    let d = state()
    d = apply(d, { kind: 'add_state', id: 'Done', label: 'All Done' })
    expect(d.body.states.find(s => s.id === 'Done')?.label).toBe('All Done')
    d = apply(d, { kind: 'add_transition', from: 'Active', to: 'Done' })
    expect(d.body.transitions).toContainEqual({ from: 'Active', to: 'Done' })
    expect(verifyMermaid(d).ok).toBe(true)
  })

  test('rename_state rewrites transitions', () => {
    const d = apply(state(), { kind: 'rename_state', from: 'Idle', to: 'Waiting' })
    expect(d.body.states.find(s => s.id === 'Waiting')).toBeDefined()
    expect(d.body.states.find(s => s.id === 'Idle')).toBeUndefined()
    expect(d.body.transitions).toContainEqual({ from: '[*]', to: 'Waiting' })
    expect(d.body.transitions.some(t => t.from === 'Idle' || t.to === 'Idle')).toBe(false)
  })

  test('remove_state cascades transitions touching it', () => {
    const d = apply(state(), { kind: 'remove_state', id: 'Active' })
    expect(d.body.states.find(s => s.id === 'Active')).toBeUndefined()
    expect(d.body.transitions.some(t => t.from === 'Active' || t.to === 'Active')).toBe(false)
    // Idle and its [*] transition survive.
    expect(d.body.transitions).toContainEqual({ from: '[*]', to: 'Idle' })
  })

  test('set_state_label sets and clears', () => {
    let d = apply(state(), { kind: 'set_state_label', id: 'Idle', label: 'Waiting Room' })
    expect(d.body.states.find(s => s.id === 'Idle')?.label).toBe('Waiting Room')
    d = apply(d, { kind: 'set_state_label', id: 'Idle', label: null })
    expect(d.body.states.find(s => s.id === 'Idle')?.label).toBeUndefined()
  })

  test('remove_transition by from/to and by index', () => {
    let d = apply(state(), { kind: 'remove_transition', from: 'Idle', to: 'Active' })
    expect(d.body.transitions.some(t => t.from === 'Idle' && t.to === 'Active')).toBe(false)
    const before = d.body.transitions.length
    d = apply(d, { kind: 'remove_transition', index: 0 })
    expect(d.body.transitions.length).toBe(before - 1)
  })

  test('set_transition_label sets and clears', () => {
    let d = apply(state(), { kind: 'set_transition_label', from: 'Idle', to: 'Active', label: 'begin' })
    expect(d.body.transitions.find(t => t.from === 'Idle' && t.to === 'Active')?.label).toBe('begin')
    d = apply(d, { kind: 'set_transition_label', from: 'Idle', to: 'Active', label: null })
    expect(d.body.transitions.find(t => t.from === 'Idle' && t.to === 'Active')?.label).toBeUndefined()
  })

  test('make_composite wraps members and pulls internal transitions in', () => {
    const base = state(`stateDiagram-v2
  [*] --> A
  A --> B
  B --> C`)
    const d = apply(base, { kind: 'make_composite', id: 'Group', members: ['A', 'B'], label: 'Grouped' })
    const group = d.body.states.find(s => s.id === 'Group')!
    expect(group.label).toBe('Grouped')
    expect(group.states!.map(s => s.id).sort()).toEqual(['A', 'B'])
    expect(group.transitions).toContainEqual({ from: 'A', to: 'B' })
    // Cross-boundary transitions stay at the top level.
    expect(d.body.transitions).toContainEqual({ from: '[*]', to: 'A' })
    expect(d.body.transitions).toContainEqual({ from: 'B', to: 'C' })
    expect(verifyMermaid(d).ok).toBe(true)
  })

  test('add_state into a composite parent (promotes simple parent)', () => {
    let d = state(`stateDiagram-v2
  A --> B`)
    d = apply(d, { kind: 'add_state', id: 'child', parent: 'A' })
    const a = d.body.states.find(s => s.id === 'A')!
    expect(a.states?.map(s => s.id)).toEqual(['child'])
  })
})

// ---------------------------------------------------------------------------
describe('state mutation — error-path table (every op)', () => {
  test('add_state duplicate / invalid id', () => {
    expectErr(state(), { kind: 'add_state', id: 'Idle' }, 'DUPLICATE_STATE')
    expectErr(state(), { kind: 'add_state', id: 'has space' }, 'INVALID_OP')
    expectErr(state(), { kind: 'add_state', id: 'A', parent: 'Nope' }, 'STATE_NOT_FOUND')
  })
  test('remove_state missing / non-empty composite refused', () => {
    expectErr(state(), { kind: 'remove_state', id: 'Ghost' }, 'STATE_NOT_FOUND')
    const comp = state(`stateDiagram-v2
  state First {
    [*] --> inner
    inner --> [*]
  }`)
    expectErr(comp, { kind: 'remove_state', id: 'First' }, 'INVALID_OP')
  })
  test('rename_state missing / duplicate / invalid', () => {
    expectErr(state(), { kind: 'rename_state', from: 'Ghost', to: 'X' }, 'STATE_NOT_FOUND')
    expectErr(state(), { kind: 'rename_state', from: 'Idle', to: 'Active' }, 'DUPLICATE_STATE')
    expectErr(state(), { kind: 'rename_state', from: 'Idle', to: 'bad id' }, 'INVALID_OP')
  })
  test('set_state_label missing / invalid label', () => {
    expectErr(state(), { kind: 'set_state_label', id: 'Ghost', label: 'x' }, 'STATE_NOT_FOUND')
    expectErr(state(), { kind: 'set_state_label', id: 'Idle', label: 'has "quote"' }, 'INVALID_OP')
  })
  test('add_transition invalid endpoint', () => {
    expectErr(state(), { kind: 'add_transition', from: 'bad id', to: 'Idle' }, 'INVALID_OP')
    expectErr(state(), { kind: 'add_transition', from: 'A', to: 'B', parent: 'Nope' }, 'STATE_NOT_FOUND')
  })
  test('remove_transition not found / underspecified', () => {
    expectErr(state(), { kind: 'remove_transition', index: 99 }, 'TRANSITION_NOT_FOUND')
    expectErr(state(), { kind: 'remove_transition', from: 'X', to: 'Y' }, 'TRANSITION_NOT_FOUND')
    expectErr(state(), { kind: 'remove_transition' }, 'INVALID_OP')
  })
  test('set_transition_label not found', () => {
    expectErr(state(), { kind: 'set_transition_label', from: 'X', to: 'Y', label: 'z' }, 'TRANSITION_NOT_FOUND')
  })
  test('make_composite duplicate / missing member', () => {
    expectErr(state(), { kind: 'make_composite', id: 'Idle', members: ['Active'] }, 'DUPLICATE_STATE')
    expectErr(state(), { kind: 'make_composite', id: 'G', members: ['Ghost'] }, 'STATE_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
describe('state differential — canonical source re-parses 1:1 under the LEGACY parser', () => {
  // The renderer-projection proof: the source we emit, parsed by the legacy
  // state parser (which the renderer uses), yields a graph whose nodes/edges
  // correspond to the body's states/transitions. [*] maps to _start/_end
  // pseudostate nodes; composites map to subgraphs.
  test('simple body: states ↔ graph nodes, transitions ↔ graph edges', () => {
    const d = state(`stateDiagram-v2
  [*] --> Idle
  Idle --> Run : go
  Run --> [*]`)
    const graph = parseLegacy(serializeMermaid(d))
    // Non-pseudo states become rounded nodes labeled by id/label.
    const rounded = [...graph.nodes.values()].filter(n => n.shape === 'rounded')
    expect(rounded.map(n => n.id).sort()).toEqual(['Idle', 'Run'])
    // [*] sources/targets become state-start/state-end pseudostate nodes.
    expect([...graph.nodes.values()].some(n => n.shape === 'state-start')).toBe(true)
    expect([...graph.nodes.values()].some(n => n.shape === 'state-end')).toBe(true)
    // One graph edge per transition.
    expect(graph.edges.length).toBe(d.body.transitions.length)
    // The labeled transition survives as a labeled edge.
    expect(graph.edges.some(e => e.source === 'Idle' && e.target === 'Run' && e.label === 'go')).toBe(true)
  })

  test('composite body: composite ↔ subgraph with its members', () => {
    const d = state(`stateDiagram-v2
  state First {
    a --> b
  }`)
    const graph = parseLegacy(serializeMermaid(d))
    expect(graph.subgraphs.map(s => s.id)).toEqual(['First'])
    expect(graph.subgraphs[0]!.nodeIds.sort()).toEqual(['a', 'b'])
  })
})

// ---------------------------------------------------------------------------
describe('state verify — geometric Tier 2 projection (parity with flowchart)', () => {
  // State diagrams project to a MermaidGraph and run the SAME verifyGraph as
  // flowcharts. Prove parity: a state source and the equivalent flowchart
  // source produce the same graph-verifier warnings, and state verify
  // produces a real geometric layout (not the empty layout).
  const STATE = `stateDiagram-v2
  A --> B
  B --> C
  C --> A`

  test('state verify yields a real geometric layout with finite coordinates', () => {
    const r = parseMermaid(STATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = verifyMermaid(r.value)
    expect(v.layout.nodes.length).toBeGreaterThan(0)
    const flat = JSON.stringify(v.layout)
    expect(flat).not.toContain('NaN')
    expect(flat).not.toContain('Infinity')
  })

  test('composite state ids are valid transition endpoints', () => {
    const r = parseMermaid(`stateDiagram-v2
      state Configuring {
        [*] --> NewValueSelection
        NewValueSelection --> NewValuePreview : EvNewValue
        NewValuePreview --> NewValueSelection : EvNewValueRejected

        state NewValuePreview {
          State1 --> State2
        }
      }`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = verifyMermaid(r.value)
    expect(v.warnings.filter(w => w.code === 'EDGE_MISANCHORED')).toEqual([])
    expect(v.ok).toBe(true)
  })

  test('state runs the flowchart graph verifier: graph-path warnings match the flowchart projection', () => {
    // Real layouts never overlap, so NODE_OVERLAP / ROUTE_SELF_CROSS cannot be
    // forced from source. DUPLICATE_EDGE and UNREACHABLE_NODE are emitted only
    // by the flowchart graph verifier (the same pass that holds the Tier 2
    // geometric checks), so seeing them on a state diagram proves the state
    // path runs it, and suppressing one of them proves suppression is honored.
    const body = '  [*] --> A\n  A --> B\n  A --> B\n  C --> D\n  D --> C'
    const expected: LayoutWarning[] = [
      { code: 'DUPLICATE_EDGE', edge: 'A->B#2', duplicateOf: 'A->B#1', from: 'A', to: 'B' },
      { code: 'UNREACHABLE_NODE', node: 'C' },
      { code: 'UNREACHABLE_NODE', node: 'D' },
    ]
    expect(verifyMermaid(`stateDiagram-v2\n${body}`).warnings).toEqual(expected)
    expect(verifyMermaid(`flowchart TD\n${body.replace('[*]', 'S')}`).warnings).toEqual(expected)
    expect(verifyMermaid(`stateDiagram-v2\n${body}`, { suppress: ['DUPLICATE_EDGE'] }).warnings).toEqual(expected.slice(1))
  })

  test('dense state source: geometric path runs and lays out every state', () => {
    // ELK is robust enough that a real NODE_OVERLAP is layout-dependent, so we
    // prove the geometric Tier 2 path RUNS for state by checking the projection
    // produces a real geometric layout (positioned nodes for every modeled
    // state) — only the geometric path does this; the empty-layout fallback
    // would yield zero nodes.
    const dense = `stateDiagram-v2
  [*] --> A
  A --> B
  A --> C
  B --> C
  C --> B
  B --> A
  C --> A`
    const r = parseMermaid(dense)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = verifyMermaid(r.value)
    // Three modeled states (A,B,C) plus the start pseudostate all positioned.
    const ids = new Set(v.layout.nodes.map(n => n.id))
    expect(ids.has('A') && ids.has('B') && ids.has('C')).toBe(true)
    expect(v.layout.nodes.length).toBeGreaterThanOrEqual(4)
    // Every edge has a real polyline path (geometric routing ran).
    expect(v.layout.edges.every(e => e.path.length >= 2)).toBe(true)
  })

  test('EMPTY_DIAGRAM fires for a header-only state diagram', () => {
    const v = verifyMermaid('stateDiagram-v2')
    expect(v.warnings.some(w => w.code === 'EMPTY_DIAGRAM')).toBe(true)
    expect(v.ok).toBe(false)
  })

  test('LABEL_OVERFLOW fires for an over-long state label', () => {
    const v = verifyMermaid(`stateDiagram-v2\n  state "${'x'.repeat(60)}" as s1\n  s1 --> s2`)
    expect(v.warnings.some(w => w.code === 'LABEL_OVERFLOW')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('state fast-check round-trip property', () => {
  // Generate small state machines (incl. nested composites depth ≤ 2 and [*]
  // usage) and assert serialize → parse → serialize is idempotent and the body
  // survives the round-trip with the same state/transition shape.
  const id = fc.string({ minLength: 1, maxLength: 4 }).filter(s => /^[A-Za-z][A-Za-z0-9]*$/.test(s))

  const shape = (states: StateNode[], transitions: StateTransition[]): unknown => ({
    states: states.map(s => ({ id: s.id, children: s.states ? shape(s.states, s.transitions ?? []) : null })),
    transitions: transitions.map(t => `${t.from}->${t.to}`),
  })
  // `state()` throws unless the source parses to a structured state body, so a
  // regression to opaque fails the property instead of passing it vacuously.
  const roundTripsAsState = (src: string): void => {
    const d = state(src)
    const s1 = serializeMermaid(d)
    const d2 = state(s1)
    expect({ src, reserialized: serializeMermaid(d2), shape: shape(d2.body.states, d2.body.transitions) })
      .toEqual({ src, reserialized: s1, shape: shape(d.body.states, d.body.transitions) })
  }

  const simpleMachine = fc.record({
    states: fc.uniqueArray(id, { minLength: 1, maxLength: 4 }),
  }).chain(({ states }) => {
    const endpoints = fc.constantFrom('[*]', ...states)
    return fc.record({
      states: fc.constant(states),
      transitions: fc.array(fc.record({ from: endpoints, to: endpoints }), { minLength: 1, maxLength: 5 }),
    })
  })

  test('generated simple machines round-trip stably', () => {
    fc.assert(fc.property(simpleMachine, ({ states, transitions }) => {
      const lines = ['stateDiagram-v2']
      for (const t of transitions) lines.push(`  ${t.from} --> ${t.to}`)
      const src = lines.join('\n') + '\n'
      return roundTripsAsState(src)
    }), { numRuns: 200 })
  })

  test('generated nested composites (depth ≤ 2) round-trip stably', () => {
    const composite = fc.record({
      outer: id,
      inner: fc.uniqueArray(id, { minLength: 1, maxLength: 3 }),
    }).filter(({ outer, inner }) => !inner.includes(outer))
    fc.assert(fc.property(composite, ({ outer, inner }) => {
      const lines = ['stateDiagram-v2', `  state ${outer} {`]
      lines.push(`    [*] --> ${inner[0]}`)
      for (let i = 0; i < inner.length - 1; i++) lines.push(`    ${inner[i]} --> ${inner[i + 1]}`)
      lines.push(`    ${inner[inner.length - 1]} --> [*]`)
      lines.push('  }')
      const src = lines.join('\n') + '\n'
      return roundTripsAsState(src)
    }), { numRuns: 100 })
  })
})

// ---------------------------------------------------------------------------
describe('state semantic read-back', () => {
  test('facts, check surface, and prose expose stereotypes and notes', () => {
    const d = state(`stateDiagram-v2
  state F <<fork>>
  note right of F : hello`)
    const facts = describeMermaidFacts(d)
    expect(facts).toContain('state F stereotype fork')
    expect(facts).toContain('note#0 right of F : hello')
    const prose = describeMermaid(d, { format: 'text' })
    expect(prose).toContain('F (fork)')
    expect(prose).toContain('right of F: hello')
  })
})

describe('state describe (prose + AX tree)', () => {
  test('AX tree exposes states as nodes and transitions as edges', () => {
    const tree = describeMermaidTree(state())
    expect({ kind: tree.kind, nodes: tree.nodes, edges: tree.edges }).toEqual({
      kind: 'state',
      nodes: [{ id: 'Active', label: 'In Progress' }, { id: 'Idle', label: 'Idle' }],
      edges: [
        { from: '[*]', to: 'Idle' },
        { from: 'Idle', to: 'Active', label: 'start' },
        { from: 'Active', to: 'Idle', label: 'pause' },
        { from: 'Active', to: '[*]', label: 'done' },
      ],
    })
  })
})
