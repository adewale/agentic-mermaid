// State op-menu widening (plan §State 7): set_direction, move_state,
// dissolve_composite, recursive remove_state — journey/gantt op conventions
// (prescriptive errors, full registration, render-parse round-trip proof per
// op). Note ops are covered in state-notes.test.ts.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asState } from '../agent/types.ts'
import type { StateValidDiagram, StateMutationOp, MutationError } from '../agent/types.ts'
import { parseMermaid as parseLegacy } from '../parser.ts'
import { opMenu, validateOp } from '../agent/op-schema.ts'
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'

const SRC = `stateDiagram-v2
  [*] --> Idle
  Idle --> Active : start
  Active --> Idle : pause
  state Machine {
    [*] --> Cog
    Cog --> Wheel
  }
  Active --> Machine
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

function expectErr(d: StateValidDiagram, op: StateMutationOp, code: MutationError['code'], msgPart?: string): void {
  const r = mutate(d, op)
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.error.code).toBe(code)
    if (msgPart) expect(r.error.message).toContain(msgPart)
  }
}

/** Round-trip proof helper: serialize → agent reparse idempotent, and the
 *  canonical source still parses under the LEGACY (renderer) parser. */
function roundTrips(d: StateValidDiagram): void {
  const s1 = serializeMermaid(d)
  const r2 = parseMermaid(s1)
  expect(r2.ok).toBe(true)
  if (!r2.ok) return
  expect(serializeMermaid(r2.value)).toBe(s1)
  expect(() => parseLegacy(s1)).not.toThrow()
}

// ---------------------------------------------------------------------------
describe('registration: schema, menu, and mutation-op list agree', () => {
  const NEW_OPS = ['set_direction', 'move_state', 'dissolve_composite', 'add_note', 'remove_note', 'set_note_text']
  test('MUTATION_OPS_BY_FAMILY.state lists the widened menu', () => {
    for (const op of NEW_OPS) expect(MUTATION_OPS_BY_FAMILY.state as readonly string[]).toContain(op)
  })
  test('opMenu exposes field lists for every new op', () => {
    const menu = opMenu('state')
    for (const op of NEW_OPS) expect(Object.keys(menu)).toContain(op)
    expect(menu['remove_state']).toContain('recursive?')
  })
  test('validateOp accepts well-formed new ops and rejects field typos prescriptively', () => {
    expect(validateOp('state', { kind: 'set_direction', direction: 'LR' })).toBeNull()
    expect(validateOp('state', { kind: 'move_state', id: 'A', parent: null })).toBeNull()
    expect(validateOp('state', { kind: 'dissolve_composite', id: 'M' })).toBeNull()
    const err = validateOp('state', { kind: 'move_state', id: 'A', parnet: 'B' })
    expect(err).not.toBeNull()
    expect(err!.reason).toBe('unknown_field')
    expect(err!.didYouMean).toBe('parent')
  })
})

// ---------------------------------------------------------------------------
describe('history endpoint mutation', () => {
  test('shallow/deep qualified and bare history stay contextual and round-trip', () => {
    let d = state()
    d = apply(d, { kind: 'add_transition', from: 'Machine[H]', to: 'Machine' })
    d = apply(d, { kind: 'add_transition', from: 'Machine[H*]', to: 'Machine' })
    d = apply(d, { kind: 'add_transition', from: '[H]', to: 'Cog', parent: 'Machine' })
    const ids: string[] = []
    const walk = (nodes: typeof d.body.states) => { for (const node of nodes) { ids.push(node.id); if (node.states) walk(node.states) } }
    walk(d.body.states)
    expect(ids.some(id => id.includes('[H'))).toBe(false)
    expect(state(serializeMermaid(d)).body).toEqual(d.body)
  })

  test('rejects missing/simple history bases and bare history without a composite scope', () => {
    expectErr(state(), { kind: 'add_transition', from: 'Missing[H]', to: 'Idle' }, 'STATE_NOT_FOUND')
    expectErr(state(), { kind: 'add_transition', from: 'Idle[H]', to: 'Active' }, 'INVALID_OP')
    expectErr(state(), { kind: 'add_transition', from: '[H]', to: 'Idle' }, 'INVALID_OP')
  })
})

describe('set_direction', () => {
  test('sets the diagram direction', () => {
    const d = apply(state(), { kind: 'set_direction', direction: 'LR' })
    expect(d.body.direction).toBe('LR')
    expect(serializeMermaid(d)).toContain('direction LR')
    roundTrips(d)
  })
  test('sets a composite direction', () => {
    const d = apply(state(), { kind: 'set_direction', direction: 'LR', state: 'Machine' })
    expect(d.body.states.find(s => s.id === 'Machine')?.direction).toBe('LR')
    expect(d.body.direction).toBeUndefined()
    roundTrips(d)
  })
  test('errors: unknown composite, non-composite target', () => {
    expectErr(state(), { kind: 'set_direction', direction: 'LR', state: 'Ghost' }, 'STATE_NOT_FOUND')
    expectErr(state(), { kind: 'set_direction', direction: 'LR', state: 'Idle' }, 'INVALID_OP', 'composite')
  })
})

// ---------------------------------------------------------------------------
describe('move_state', () => {
  test('moves a top-level state into a composite', () => {
    const d = apply(state(), { kind: 'move_state', id: 'Active', parent: 'Machine' })
    expect(d.body.states.some(s => s.id === 'Active')).toBe(false)
    const machine = d.body.states.find(s => s.id === 'Machine')!
    expect(machine.states!.some(s => s.id === 'Active')).toBe(true)
    // Cross-boundary transitions survive (ids are global in state diagrams).
    expect(d.body.transitions).toContainEqual({ from: 'Idle', to: 'Active', label: 'start' })
    roundTrips(d)
  })
  test('moves a nested state to the top level with parent: null', () => {
    const d = apply(state(), { kind: 'move_state', id: 'Cog', parent: null })
    expect(d.body.states.some(s => s.id === 'Cog')).toBe(true)
    const machine = d.body.states.find(s => s.id === 'Machine')!
    expect(machine.states!.some(s => s.id === 'Cog')).toBe(false)
    roundTrips(d)
  })
  test('promotes a simple parent into a composite', () => {
    const d = apply(state(), { kind: 'move_state', id: 'Idle', parent: 'Active' })
    const active = d.body.states.find(s => s.id === 'Active')!
    expect(active.states!.map(s => s.id)).toEqual(['Idle'])
    roundTrips(d)
  })
  test('errors: missing state/parent, self/descendant cycle, no-op move', () => {
    expectErr(state(), { kind: 'move_state', id: 'Ghost', parent: null }, 'STATE_NOT_FOUND')
    expectErr(state(), { kind: 'move_state', id: 'Idle', parent: 'Ghost' }, 'STATE_NOT_FOUND')
    expectErr(state(), { kind: 'move_state', id: 'Machine', parent: 'Machine' }, 'INVALID_OP')
    expectErr(state(), { kind: 'move_state', id: 'Machine', parent: 'Cog' }, 'INVALID_OP')
  })
})

// ---------------------------------------------------------------------------
describe('dissolve_composite', () => {
  test('hoists children and inner transitions into the parent scope', () => {
    // Machine is referenced by a transition — retarget first, then dissolve.
    let d = apply(state(), { kind: 'remove_transition', from: 'Active', to: 'Machine' })
    d = apply(d, { kind: 'dissolve_composite', id: 'Machine' })
    expect(d.body.states.some(s => s.id === 'Machine')).toBe(false)
    expect(d.body.states.some(s => s.id === 'Cog')).toBe(true)
    expect(d.body.states.some(s => s.id === 'Wheel')).toBe(true)
    expect(d.body.transitions).toContainEqual({ from: 'Cog', to: 'Wheel' })
    expect(d.body.transitions).toContainEqual({ from: '[*]', to: 'Cog' })
    roundTrips(d)
  })
  test('rejects while transitions still reference the composite', () => {
    expectErr(state(), { kind: 'dissolve_composite', id: 'Machine' }, 'INVALID_OP', 'reference')
  })
  test('errors: missing, not a composite', () => {
    expectErr(state(), { kind: 'dissolve_composite', id: 'Ghost' }, 'STATE_NOT_FOUND')
    expectErr(state(), { kind: 'dissolve_composite', id: 'Idle' }, 'INVALID_OP', 'composite')
  })
})

// ---------------------------------------------------------------------------
describe('recursive remove_state', () => {
  test('non-recursive still refuses a non-empty composite (unchanged contract)', () => {
    expectErr(state(), { kind: 'remove_state', id: 'Machine' }, 'INVALID_OP')
  })
  test('recursive removes the composite, its descendants, and every touching transition', () => {
    const d = apply(state(), { kind: 'remove_state', id: 'Machine', recursive: true })
    expect(d.body.states.some(s => s.id === 'Machine')).toBe(false)
    const all = JSON.stringify(d.body)
    expect(all).not.toContain('Cog')
    expect(all).not.toContain('Wheel')
    expect(d.body.transitions.some(t => t.from === 'Machine' || t.to === 'Machine')).toBe(false)
    roundTrips(d)
  })
  test('recursive removal reaches nested composites', () => {
    const nested = state(`stateDiagram-v2
  A --> Outer
  state Outer {
    state Inner {
      deep1 --> deep2
    }
    Inner --> x1
  }
`)
    const d = apply(nested, { kind: 'remove_state', id: 'Outer', recursive: true })
    const all = JSON.stringify(d.body)
    for (const gone of ['Outer', 'Inner', 'deep1', 'deep2', 'x1']) {
      expect(all).not.toContain(gone)
    }
    expect(d.body.states.some(s => s.id === 'A')).toBe(true)
  })
})

describe('implicit-state preservation after transition removal', () => {
  test('surviving implicit endpoints become bare declarations before serialization', () => {
    const d = apply(state('stateDiagram-v2\n  A --> B\n'), { kind: 'remove_transition', index: 0 })
    expect(d.body.states).toEqual([
      expect.objectContaining({ id: 'A', declaredBare: true }),
      expect.objectContaining({ id: 'B', declaredBare: true }),
    ])
    roundTrips(d)
    const reparsed = parseMermaid(serializeMermaid(d))
    expect(reparsed.ok && reparsed.value.body.kind === 'state'
      ? reparsed.value.body.states.map(item => item.id)
      : []).toEqual(['A', 'B'])
  })
})
