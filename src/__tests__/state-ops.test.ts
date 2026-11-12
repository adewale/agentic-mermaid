// State op-menu widening (plan §State 7): set_direction, move_state,
// dissolve_composite, recursive remove_state — journey/gantt op conventions
// (prescriptive errors, full registration, render-parse round-trip proof per
// op). Note ops are covered in state-notes.test.ts.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
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
    expect(state(serializeMermaid(d)).body).toEqual(d.body)
    roundTrips(d)
  })
  test('moves a nested state to the top level with parent: null', () => {
    const d = apply(state('stateDiagram-v2\nstate Machine { Cog }'), { kind: 'move_state', id: 'Cog', parent: null })
    expect(d.body.states.some(s => s.id === 'Cog')).toBe(true)
    const machine = d.body.states.find(s => s.id === 'Machine')!
    expect(machine.states!.some(s => s.id === 'Cog')).toBe(false)
    expect(state(serializeMermaid(d)).body).toEqual(d.body)
    roundTrips(d)
  })
  test('refuses a move whose old scoped transition would silently claim the state back', () => {
    expectErr(state(), { kind: 'move_state', id: 'Cog', parent: null }, 'INVALID_OP', 'cannot retain its requested scope')
  })
  test('promotes a simple parent into a composite', () => {
    const d = apply(state(), { kind: 'move_state', id: 'Idle', parent: 'Active' })
    const active = d.body.states.find(s => s.id === 'Active')!
    expect(active.states!.map(s => s.id)).toEqual(['Idle'])
    expect(state(serializeMermaid(d)).body).toEqual(d.body)
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

// Our reader takes hyphenated names (and `default`, `click`, `href`) and verify
// reports them as source Mermaid cannot read (`state_endpoint_name`). A typed
// edit writes strictly: rename_state S1 -> `x--y` used to succeed and write
// `[*] --> x--y`, which Mermaid 12.2.0 rejects (V2).
describe('a name a typed edit introduces is one Mermaid reads', () => {
  const NAMES = ['x--y', 'x-y', 'Idle-2', 'default', 'click', 'href']
  const OPS: Array<(name: string) => StateMutationOp> = [
    name => ({ kind: 'add_state', id: name }),
    name => ({ kind: 'rename_state', from: 'Idle', to: name }),
  ]
  test.each(NAMES.flatMap(name => OPS.map(op => op(name))))('%j is refused', op => {
    expect(mutate(state(), op)).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
  })
})

describe('grouping after transition edits (#596)', () => {
  test.each(['pair', 'index'] as const)('rebases both scopes after removal by %s', selector => {
    const base = state('stateDiagram-v2\n  a --> b\n  a --> c')
    const remove: StateMutationOp = selector === 'pair'
      ? { kind: 'remove_transition', from: 'a', to: 'c' }
      : { kind: 'remove_transition', index: 1 }
    const group: StateMutationOp = { kind: 'make_composite', id: 'g', members: ['a', 'b'] }
    const d = apply(apply(base, remove), group)
    expect(serializeMermaid(d)).toBe('stateDiagram-v2\n  c\n  state g {\n    a --> b\n  }\n')
    expect(serializeMermaid(apply(apply(base, group), { kind: 'remove_transition', from: 'a', to: 'c' }))).toBe(serializeMermaid(d))
    roundTrips(d)
    expect(base.body.transitions).toHaveLength(2)
  })

  test('rebases explicit declarations when grouping partitions interleaved transitions', () => {
    const d = apply(state(`stateDiagram-v2
      x --> y
      a : Alpha
      a --> b
      c : Charlie
      b --> c
      z : Zulu
      y --> z`), { kind: 'make_composite', id: 'g', members: ['a', 'b', 'c'] })
    const group = d.body.states.find(s => s.id === 'g')!
    expect(group.transitions).toEqual([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])
    expect(group.states!.find(s => s.id === 'a')!.declarationBeforeTransition).toBe(0)
    expect(group.states!.find(s => s.id === 'c')!.declarationBeforeTransition).toBe(1)
    expect(d.body.states.find(s => s.id === 'z')!.declarationBeforeTransition).toBe(1)
    roundTrips(d)
  })
})

describe('appending concurrency regions (#597)', () => {
  test.each(['state', 'transition'] as const)('creates and extends parallel scopes with add_%s', kind => {
    const base = state(`stateDiagram-v2
      state outer {
        state on {
          direction LR
          idle --> busy
          note "cycle" as memo
        }
      }`)
    const op: StateMutationOp = kind === 'state'
      ? { kind: 'add_state', id: 'still', parent: 'on', region: 1 }
      : { kind: 'add_transition', from: 'still', to: 'frothing', parent: 'on', region: 1 }
    let d = apply(base, op)
    const on = d.body.states[0]!.states![0]!
    expect(on.states).toBeUndefined()
    expect(on.transitions).toBeUndefined()
    expect(on.direction).toBe('LR')
    expect(on.regions).toHaveLength(2)
    expect(on.regions![0]!.transitions).toEqual([{ from: 'idle', to: 'busy' }])
    expect(on.regions![1]!.states.map(s => s.id)).toEqual(kind === 'state' ? ['still'] : ['still', 'frothing'])
    roundTrips(d)
    expect(serializeMermaid(d)).toContain('note "cycle" as memo')
    d = apply(d, { kind: 'add_state', id: 'third', parent: 'on', region: 2 })
    d = apply(d, { kind: 'add_state', id: 'extra', parent: 'on', region: 1 })
    expect(d.body.states[0]!.states![0]!.regions).toHaveLength(3)
    roundTrips(d)
    expect(base.body.states[0]!.states![0]!.regions).toBeUndefined()
  })

  test('rejects gaps, invalid indexes, missing parents, and creation by transition selectors', () => {
    const d = state('stateDiagram-v2\nstate on { idle --> busy }')
    for (const region of [-1, 0.5, 2]) {
      expectErr(d, { kind: 'add_state', id: 'still', parent: 'on', region }, 'INVALID_OP', 'out of range')
      expectErr(d, { kind: 'add_transition', from: 'x', to: 'y', parent: 'on', region }, 'INVALID_OP', 'out of range')
    }
    expectErr(d, { kind: 'add_state', id: 'still', region: 1 }, 'INVALID_OP', 'parent')
    expectErr(d, { kind: 'add_state', id: 'still', parent: 'missing', region: 1 }, 'STATE_NOT_FOUND')
    expectErr(d, { kind: 'add_state', id: 'still', parent: 'idle', region: 1 }, 'INVALID_OP')
    expectErr(d, { kind: 'remove_transition', index: 0, parent: 'on', region: 1 }, 'INVALID_OP', 'out of range')
  })
})

test('transition filtering, grouping and dissolution preserve declarations and surviving edges', () => {
  fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 2, maxLength: 6 }), flags => {
    // Always delete a transition, and vary declarations around interleaved
    // inner/outer edges. Independent expectations come from these operands.
    const removed = [true, ...flags]
    const lines = ['stateDiagram-v2', 'a0 : Inner0', 'x0 : Outer0']
    const inner = [], outer = []
    for (let i = 0; i < removed.length; i++) {
      lines.push(`a${i} --> a${i + 1}`, `a${i + 1} : Inner${i + 1}`,
        `x${i + 1} : Outer${i + 1}`, `x${i} --> x${i + 1}`)
      if (!removed[i]) inner.push({ from: `a${i}`, to: `a${i + 1}` })
      outer.push({ from: `x${i}`, to: `x${i + 1}` })
    }
    let d = state(lines.join('\n'))
    for (let i = 0; i < removed.length; i++) if (removed[i]) d = apply(d, { kind: 'remove_transition', from: `a${i}`, to: `a${i + 1}` })
    d = apply(d, { kind: 'make_composite', id: 'g', members: Array.from({ length: removed.length + 1 }, (_, i) => `a${i}`) })
    expect(d.body.transitions).toEqual(outer)
    expect(d.body.states.find(node => node.id === 'g')!.transitions).toEqual(inner)
    roundTrips(d)
    d = apply(d, { kind: 'dissolve_composite', id: 'g' })
    expect(d.body.states.map(node => [node.id, node.label]).sort()).toEqual(
      Array.from({ length: removed.length + 1 }, (_, i) => [[`a${i}`, `Inner${i}`], [`x${i}`, `Outer${i}`]]).flat().sort(),
    )
    expect(d.body.transitions).toEqual([...outer, ...inner])
    roundTrips(d)
  }), fcParameters({ numRuns: 100 }))
})

describe('scope edits preserve inferred declaration schedules', () => {
  test('implicit synthetic states retain creation order when their transition disappears', () => {
    const d = state('stateDiagram-v2\n  a --> b')
    d.body.states.reverse()
    const edited = apply(d, { kind: 'remove_transition', index: 0 })
    expect(serializeMermaid(edited)).toBe('stateDiagram-v2\n  a\n  b\n')
    expect(d.body.states.map(node => node.id)).toEqual(['b', 'a'])
  })

  test.each(['remove_transition', 'remove_state', 'make_composite', 'dissolve_composite', 'move_state'] as const)('%s agrees before and after materializing a legacy body', kind => {
    const legacy = state(`stateDiagram-v2
      x : Outside
      x --> y
      state g {
        a : Alpha
        a --> b
        c : Charlie
        b --> c
      }
      z : Last
      y --> z
      h`)
    const forget = (nodes: typeof legacy.body.states): void => {
      for (const node of nodes) {
        delete node.declarationBeforeTransition
        if (node.states) forget(node.states)
        for (const region of node.regions ?? []) forget(region.states)
      }
    }
    forget(legacy.body.states)
    const materialized = state(serializeMermaid(legacy))
    const ops: Record<typeof kind, StateMutationOp> = {
      remove_transition: { kind: 'remove_transition', index: 0 },
      remove_state: { kind: 'remove_state', id: 'y' },
      make_composite: { kind: 'make_composite', id: 'grouped', members: ['x', 'y', 'z'] },
      dissolve_composite: { kind: 'dissolve_composite', id: 'g' },
      move_state: { kind: 'move_state', id: 'g', parent: 'h' },
    }
    const edited = apply(legacy, ops[kind])
    expect(serializeMermaid(edited)).toBe(serializeMermaid(apply(materialized, ops[kind])))
    roundTrips(edited)
  })
})

describe('region topology edits', () => {
  test('inserts and removes empty regions without changing existing region ownership', () => {
    const base = state(`stateDiagram-v2
      state on {
        direction LR
        %% brewing transition
        idle --> busy
        note "brew" as brew
        --
        direction BT
        still --> frothing
        note "milk" as milk
      }`)
    const withFirst = apply(base, { kind: 'add_region', parent: 'on', index: 0 })
    const on = withFirst.body.states[0]!
    expect(on.regions).toHaveLength(3)
    expect(on.direction).toBe('LR')
    expect(on.regions![1]!.transitions).toEqual([{ from: 'idle', to: 'busy' }])
    expect(on.regions![2]!.direction).toBe('BT')
    expect(withFirst.body.floatingNotes?.map(note => note.scope)).toEqual([
      { parent: 'on', region: 1 }, { parent: 'on', region: 2 },
    ])
    const written = serializeMermaid(withFirst)
    expect(written.indexOf('%% brewing transition')).toBeGreaterThan(written.indexOf('--'))
    expect(written.indexOf('%% brewing transition')).toBeLessThan(written.indexOf('idle --> busy'))
    roundTrips(withFirst)
    expect(state(serializeMermaid(withFirst)).body).toEqual(withFirst.body)
    const restored = apply(withFirst, { kind: 'remove_region', parent: 'on', index: 0 })
    expect(serializeMermaid(restored)).toBe(serializeMermaid(base))
    const appended = apply(restored, { kind: 'add_region', parent: 'on' })
    expect(appended.body.states[0]!.regions).toHaveLength(3)
    roundTrips(appended)
    expect(base.body.states[0]!.regions).toHaveLength(2)
  })

  test('promotes and collapses a composite while preserving direction and floating notes', () => {
    const base = state('stateDiagram-v2\nstate on {\ndirection LR\nidle --> busy\nnote "brew" as memo\n}')
    const expanded = apply(base, { kind: 'add_region', parent: 'on', index: 0 })
    expect(expanded.body.floatingNotes![0]!.scope).toEqual({ parent: 'on', region: 1 })
    const collapsed = apply(expanded, { kind: 'remove_region', parent: 'on', index: 0 })
    expect(collapsed.body.states[0]!.regions).toBeUndefined()
    expect(collapsed.body.states[0]!.direction).toBe('LR')
    expect(collapsed.body.floatingNotes![0]!.scope).toEqual({ parent: 'on' })
    expect(serializeMermaid(collapsed)).toBe(serializeMermaid(base))
    roundTrips(collapsed)
    expect(state(serializeMermaid(collapsed)).body).toEqual(collapsed.body)
  })

  test('collapsing to a region with a direction override retains its effective direction', () => {
    const d = apply(state(`stateDiagram-v2
      state on {
        direction LR
        --
        direction BT
        idle --> busy
      }`), { kind: 'remove_region', parent: 'on', index: 0 })
    expect(d.body.states[0]!.direction).toBe('BT')
    expect(d.body.states[0]!.regions).toBeUndefined()
    roundTrips(d)
  })

  test.each(['LR', 'BT'] as const)('first-region removal preserves composite direction when the next override is %s', direction => {
    const base = state(`stateDiagram-v2
      state on {
        direction LR
        --
        direction ${direction}
        a --> b
        --
        c --> d
      }`)
    const original = serializeMermaid(base)
    if (direction === 'BT') {
      expectErr(base, { kind: 'remove_region', parent: 'on', index: 0 }, 'INVALID_OP', 'cannot preserve both')
    } else {
      const d = apply(base, { kind: 'remove_region', parent: 'on', index: 0 })
      expect(d.body.states[0]!.direction).toBe('LR')
      expect(d.body.states[0]!.regions![0]!.direction).toBeUndefined()
      expect(state(serializeMermaid(d)).body).toEqual(d.body)
      roundTrips(d)
    }
    expect(serializeMermaid(base)).toBe(original)
  })

  test.each(['move_state', 'add_floating_note'] as const)('%s can populate a new region', kind => {
    const base = state('stateDiagram-v2\nstate on { idle --> busy }\nspare')
    const op: StateMutationOp = kind === 'move_state'
      ? { kind, id: 'spare', parent: 'on', region: 1 }
      : { kind, id: 'memo', text: 'milk', parent: 'on', region: 1 }
    const d = apply(base, op)
    expect(d.body.states.find(node => node.id === 'on')!.regions).toHaveLength(2)
    if (kind === 'move_state') expect(d.body.states[0]!.regions![1]!.states.map(node => node.id)).toEqual(['spare'])
    else expect(d.body.floatingNotes![0]!.scope).toEqual({ parent: 'on', region: 1 })
    roundTrips(d)
  })

  test('refuses invalid insertion, simple parents, nonempty removal and removal of the sole scope', () => {
    const d = state('stateDiagram-v2\nstate on {\na\n--\nnote "milk" as memo\n}')
    for (const index of [-1, 0.5, 3]) {
      expectErr(d, { kind: 'add_region', parent: 'on', index }, 'INVALID_OP')
      expectErr(d, { kind: 'remove_region', parent: 'on', index }, 'INVALID_OP')
    }
    expectErr(d, { kind: 'add_region', parent: 'a' }, 'INVALID_OP', 'composite')
    expectErr(d, { kind: 'add_region', parent: 'missing' }, 'STATE_NOT_FOUND')
    expectErr(d, { kind: 'remove_region', parent: 'on', index: 0 }, 'INVALID_OP', 'empty')
    expectErr(d, { kind: 'remove_region', parent: 'on', index: 1 }, 'INVALID_OP', 'empty')
    expectErr(state('stateDiagram-v2\nstate on {}'), { kind: 'remove_region', parent: 'on', index: 0 }, 'INVALID_OP')
  })
})
