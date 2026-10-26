// State notes (plan §State 1; repo #118 state half; upstream #3782).
//
// Fix stage: `note left|right of X : text` and the block form
// (`note left of X` … `end note`) must not misparse — no phantom states from
// note-body lines that happen to contain `:` or `-->`.
// Feature stage: notes are MODELED (graph.stateNotes + StateBody.notes) and
// RENDERED anchored to the declared side of their state — beating upstream's
// open placement bug (#3782). Invariant gates (not just snapshots): the note
// box sits on the declared side, overlaps no node box, and stays on-canvas.

import { describe, test, expect } from 'bun:test'
import { parseMermaid as parseLegacy } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asState } from '../agent/types.ts'
import type { StateValidDiagram, StateMutationOp, MutationError } from '../agent/types.ts'
import { describeMermaid, describeMermaidFacts, renderMermaidASCII } from '../agent/core.ts'

const SRC = `stateDiagram-v2
  [*] --> Active
  Active --> Idle : timeout
  note right of Active : Currently processing
  note left of Idle
    Waits for input
    retry: 3 times
  end note
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

describe('floating State notes', () => {
  test('a floating note retains its own identity and text beside a state with the same name', () => {
    const source = 'stateDiagram-v2\nN1\nnote "Floating #quot;note#quot;" as N1'
    const d = state(source)
    expect(d.body.states.map(node => node.id)).toEqual(['N1'])
    expect(d.body.floatingNotes).toMatchObject([{ id: 'N1', text: 'Floating "note"' }])
    expect(d.body.notes).toBeUndefined()
    const written = serializeMermaid(d)
    expect(state(written).body.floatingNotes).toEqual(d.body.floatingNotes)
    const graph = parseLegacy(source)
    expect(graph.nodes.get('N1')?.shape).toBe('rounded')
    const note = graph.floatingStateNotes![0]!
    expect(note.nodeId).not.toBe('N1')
    expect(graph.nodes.get(note.nodeId)?.shape).toBe('state-note')
    expect(renderMermaidSVG(source)).toContain('data-floating-note-id="N1"')
    expect(renderMermaidASCII(source, { colorMode: 'none' })).toContain('Floating')
    expect(describeMermaidFacts(d).some(fact => fact.includes('floating note N1'))).toBe(true)
    expect(describeMermaid(d)).toContain('Floating "note"')
  })

  test('floating notes belong to concurrent regions and follow scope rename, dissolve and removal', () => {
    const d = state('stateDiagram-v2\nstate Box {\nnote "First" as N1\n--\nnote "Second" as N2\n}')
    expect(d.body.floatingNotes).toEqual([
      { id: 'N1', text: 'First', scope: { parent: 'Box', region: 0 } },
      { id: 'N2', text: 'Second', scope: { parent: 'Box', region: 1 } },
    ])
    const written = serializeMermaid(d)
    expect(state(written).body).toEqual(d.body)
    const graph = parseLegacy(written)
    const positioned = layoutGraphSync(graph)
    for (const [index, note] of graph.floatingStateNotes!.entries()) {
      expect(graph.subgraphs[0]!.children[index]!.nodeIds).toContain(note.nodeId)
      const node = positioned.nodes.find(node => node.id === note.nodeId)!
      const region = positioned.groups[0]!.children[index]!
      expect(node.x).toBeGreaterThanOrEqual(region.x)
      expect(node.y).toBeGreaterThanOrEqual(region.y)
      expect(node.x + node.width).toBeLessThanOrEqual(region.x + region.width)
      expect(node.y + node.height).toBeLessThanOrEqual(region.y + region.height)
    }
    const renamed = apply(d, { kind: 'rename_state', from: 'Box', to: 'Renamed' })
    expect(renamed.body.floatingNotes?.map(note => note.scope?.parent)).toEqual(['Renamed', 'Renamed'])
    expect(d.body.floatingNotes?.[0]?.scope?.parent).toBe('Box')
    const dissolved = apply(renamed, { kind: 'dissolve_composite', id: 'Renamed' })
    expect(dissolved.body.floatingNotes?.map(note => note.scope)).toEqual([undefined, undefined])
    expect(verifyMermaid(dissolved).ok).toBe(true)
    expect(apply(d, { kind: 'remove_state', id: 'Box', recursive: true }).body.floatingNotes).toBeUndefined()
  })

  test('floating note operations preserve quoted syntax-like text and keep the note namespace separate', () => {
    let d = state('stateDiagram-v2\nN1')
    d = apply(d, { kind: 'add_floating_note', id: 'N1', text: 'end note\nHe said "hi"; %% #quot;' })
    const written = serializeMermaid(d)
    const reread = state(written)
    expect(reread.body.floatingNotes?.[0]?.text).toBe('end note\nHe said "hi"; %% #quot;')
    expect(serializeMermaid(reread)).toBe(written)
    expectErr(d, { kind: 'add_floating_note', id: 'N1', text: 'duplicate' }, 'INVALID_OP')
    d = apply(d, { kind: 'set_floating_note_text', id: 'N1', text: 'Changed' })
    expect(d.body.floatingNotes?.[0]?.text).toBe('Changed')
    d = apply(d, { kind: 'rename_state', from: 'N1', to: 'State2' })
    expect(d.body.floatingNotes?.[0]?.id).toBe('N1')
    d = apply(d, { kind: 'remove_floating_note', id: 'N1' })
    expect(d.body.floatingNotes).toBeUndefined()
    expectErr(d, { kind: 'remove_floating_note', id: 'missing' }, 'NOTE_NOT_FOUND')
  })

  test('adding scoped notes validates scope and preserves the independent state namespace', () => {
    let d = state('stateDiagram-v2\nN1\nstate Outer {\nstate Inner { A }\n--\nB\n}')
    d = apply(d, { kind: 'add_floating_note', id: 'N1', text: '审查', parent: 'Outer', region: 1 })
    d = apply(d, { kind: 'add_floating_note', id: 'Nested', text: 'Nested annotation', parent: 'Inner' })
    expect(state(serializeMermaid(d)).body.floatingNotes).toEqual([
      { id: 'Nested', text: 'Nested annotation', scope: { parent: 'Inner' } },
      { id: 'N1', text: '审查', scope: { parent: 'Outer', region: 1 } },
    ])
    expectErr(d, { kind: 'add_floating_note', id: 'Bad', text: 'x', parent: 'Missing' }, 'STATE_NOT_FOUND')
    expectErr(d, { kind: 'add_floating_note', id: 'Bad', text: 'x', parent: 'Outer', region: 2 }, 'INVALID_OP')
    expectErr(d, { kind: 'add_floating_note', id: 'Empty', text: '' }, 'INVALID_OP')
    expectErr(d, { kind: 'set_floating_note_text', id: 'N1', text: '' }, 'INVALID_OP')
    const blank = parseMermaid('stateDiagram-v2\nnote "" as Empty')
    expect(blank.ok && blank.value.body.kind).toBe('opaque')
    const removed = apply(d, { kind: 'remove_state', id: 'N1' })
    expect(removed.body.floatingNotes?.[0]?.id).toBe('N1')
    const dissolved = apply(d, { kind: 'dissolve_composite', id: 'Inner' })
    expect(dissolved.body.floatingNotes?.find(note => note.id === 'Nested')?.scope).toEqual({ parent: 'Outer', region: 0 })
    const corrupt = { ...d, body: { ...d.body, floatingNotes: [{ id: 'Bad', text: 'keep me', scope: { parent: 'Missing' } }] } }
    expect(() => serializeMermaid(corrupt)).toThrow('Invalid scope')
    expect(() => parseLegacy('stateDiagram-v2\nnote "First" as N\nnote "Second" as N')).toThrow('Duplicate floating')
  })
})

// ---------------------------------------------------------------------------
describe('state notes — render parser (no phantom states)', () => {
  test('note lines create no phantom states', () => {
    const graph = parseLegacy(SRC)
    const ids = [...graph.nodes.keys()]
    // Exactly the real states + the start pseudostate — nothing minted from
    // "note", "retry" (a note-body line with a colon), or "Waits".
    expect(ids.sort()).toEqual(['Active', 'Idle', '_start'])
  })

  test('single-line and block notes are modeled on the graph', () => {
    const graph = parseLegacy(SRC)
    expect(graph.stateNotes).toBeDefined()
    expect(graph.stateNotes!.length).toBe(2)
    expect(graph.stateNotes![0]).toMatchObject({ target: 'Active', side: 'right', text: 'Currently processing' })
    expect(graph.stateNotes![1]).toMatchObject({ target: 'Idle', side: 'left', text: 'Waits for input\nretry: 3 times' })
  })

  test('a note-body transition-looking line does not mint edges', () => {
    const graph = parseLegacy(`stateDiagram-v2
  A --> B
  note right of A
    then A --> C happens
  end note
`)
    expect(graph.edges.length).toBe(1)
    expect([...graph.nodes.keys()].sort()).toEqual(['A', 'B'])
    expect(graph.stateNotes![0]!.text).toBe('then A --> C happens')
  })

  test('a note on an undeclared state creates the state (upstream parity)', () => {
    const graph = parseLegacy(`stateDiagram-v2
  note right of Solo : hello
`)
    expect(graph.nodes.has('Solo')).toBe(true)
    expect(graph.stateNotes![0]!.target).toBe('Solo')
  })
})

// ---------------------------------------------------------------------------
describe('state notes — layout anchoring invariants', () => {
  const positioned = () => layoutGraphSync(parseLegacy(SRC))

  test('notes are positioned on the declared side of their state', () => {
    const p = positioned()
    expect(p.notes).toBeDefined()
    expect(p.notes!.length).toBe(2)
    const nodeOf = (id: string) => p.nodes.find(n => n.id === id)!
    const right = p.notes!.find(n => n.target === 'Active')!
    expect(right.x).toBeGreaterThanOrEqual(nodeOf('Active').x + nodeOf('Active').width)
    const left = p.notes!.find(n => n.target === 'Idle')!
    expect(left.x + left.width).toBeLessThanOrEqual(nodeOf('Idle').x)
  })

  test('note boxes overlap no node box and stay on-canvas', () => {
    const p = positioned()
    for (const note of p.notes!) {
      for (const n of p.nodes) {
        const xo = Math.min(note.x + note.width, n.x + n.width) - Math.max(note.x, n.x)
        const yo = Math.min(note.y + note.height, n.y + n.height) - Math.max(note.y, n.y)
        expect(Math.min(xo, yo)).toBeLessThanOrEqual(0)
      }
      expect(note.x).toBeGreaterThanOrEqual(0)
      expect(note.y).toBeGreaterThanOrEqual(0)
      expect(note.x + note.width).toBeLessThanOrEqual(p.width + 0.5)
      expect(note.y + note.height).toBeLessThanOrEqual(p.height + 0.5)
    }
  })

  test('note placement is deterministic', () => {
    const a = JSON.stringify(positioned().notes)
    const b = JSON.stringify(positioned().notes)
    expect(a).toBe(b)
  })

  test('a note anchored to a composite state sits beside the composite box', () => {
    const p = layoutGraphSync(parseLegacy(`stateDiagram-v2
  state Active {
    [*] --> A
  }
  note right of Active : whole group
`))
    const group = p.groups.find(g => g.id === 'Active')!
    const note = p.notes!.find(n => n.target === 'Active')!
    expect(note.x).toBeGreaterThanOrEqual(group.x + group.width)
  })
})

// ---------------------------------------------------------------------------
describe('state notes — SVG rendering', () => {
  test('note text renders, tagged with target and side', () => {
    const svg = renderMermaidSVG(SRC)
    expect(svg).toContain('Currently processing')
    expect(svg).toContain('Waits for input')
    expect(svg).toContain('class="state-note"')
    expect(svg).toContain('data-side="right"')
    expect(svg).toContain('data-side="left"')
  })
})

// ---------------------------------------------------------------------------
describe('state notes — structured agent body', () => {
  test.each([
    ['empty', 'note right of A\nend note'],
    ['blank lines', 'note right of A\n  \n\t\nend note'],
    ['nested target', 'state Outer {\nA\nnote right of A\nend note\n}'],
  ])('%s block notes retain their annotation through verification and writing', (_name, body) => {
    const d = state(`stateDiagram-v2\n${body}`)
    expect(d.body.notes).toMatchObject([{ target: 'A', side: 'right', text: '' }])
    expect(verifyMermaid(d).ok).toBe(true)
    const written = serializeMermaid(d)
    expect(written).toContain('note right of A\n')
    expect(state(written).body).toEqual(d.body)
    expect(parseLegacy(written).stateNotes).toMatchObject([{ target: 'A', side: 'right', text: '' }])
    expect(renderMermaidSVG(written)).toContain('class="state-note"')
    const edited = apply(d, { kind: 'set_note_text', index: 0, text: 'Review' })
    expect(state(serializeMermaid(edited)).body.notes).toMatchObject([{ target: 'A', text: 'Review' }])
  })

  test('notes parse structured (no opaque fallback), queryable on the body', () => {
    const d = state()
    expect(d.body.notes).toBeDefined()
    expect(d.body.notes!.length).toBe(2)
    expect(d.body.notes![0]).toMatchObject({ target: 'Active', side: 'right', text: 'Currently processing' })
    const v = verifyMermaid(d)
    expect(v.warnings.some(w => w.code === 'UNSUPPORTED_SYNTAX' && w.syntax === 'state_opaque')).toBe(false)
    expect(v.ok).toBe(true)
  })

  test('serialize → parse → serialize is idempotent (incl. multiline block note)', () => {
    const d = state()
    const s1 = serializeMermaid(d)
    const r2 = parseMermaid(s1)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(serializeMermaid(r2.value)).toBe(s1)
  })

  test('canonical source round-trips through the RENDER parser (1:1 notes)', () => {
    const d = state()
    const graph = parseLegacy(serializeMermaid(d))
    expect(graph.stateNotes!.length).toBe(2)
    expect(graph.stateNotes![0]!.text).toBe('Currently processing')
    expect(graph.stateNotes![1]!.text).toBe('Waits for input\nretry: 3 times')
  })

  test('note LABEL_OVERFLOW fires through verify', () => {
    const v = verifyMermaid(`stateDiagram-v2\n  A --> B\n  note right of A : ${'x'.repeat(60)}\n`)
    expect(v.warnings.some(w => w.code === 'LABEL_OVERFLOW')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('state note ops (add_note / remove_note / set_note_text)', () => {
  test('add_note accepts every parser-legal hyphenated ordinary state target', () => {
    let d = state('stateDiagram-v2\n  in-progress : Working')
    d = apply(d, { kind: 'add_note', target: 'in-progress', side: 'right', text: 'watch' })
    expect(d.body.notes?.[0]).toMatchObject({ target: 'in-progress', text: 'watch' })
    expect(state(serializeMermaid(d)).body).toEqual(d.body)
  })

  test('add_note appends and round-trips through the render parser', () => {
    let d = state(`stateDiagram-v2
  A --> B
`)
    d = apply(d, { kind: 'add_note', target: 'B', side: 'left', text: 'watch this' })
    expect(d.body.notes).toContainEqual({ target: 'B', side: 'left', text: 'watch this' })
    const graph = parseLegacy(serializeMermaid(d))
    expect(graph.stateNotes).toContainEqual(expect.objectContaining({ target: 'B', side: 'left', text: 'watch this' }))
  })

  test('add_note defaults to the right side', () => {
    const d = apply(state(), { kind: 'add_note', target: 'Idle', text: 'plain' })
    expect(d.body.notes![d.body.notes!.length - 1]).toMatchObject({ target: 'Idle', side: 'right', text: 'plain' })
  })

  test('add_note multiline text serializes as a block note and survives', () => {
    const d = apply(state(), { kind: 'add_note', target: 'Active', side: 'right', text: 'line one\nline two' })
    const s = serializeMermaid(d)
    expect(s).toContain('end note')
    const r2 = parseMermaid(s)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(serializeMermaid(r2.value)).toBe(s)
    const back = asState(r2.value)!
    expect(back.body.notes).toContainEqual({ target: 'Active', side: 'right', text: 'line one\nline two' })
  })

  test('remove_note by index; set_note_text edits in place', () => {
    let d = state()
    d = apply(d, { kind: 'set_note_text', index: 0, text: 'updated' })
    expect(d.body.notes![0]!.text).toBe('updated')
    const before = d.body.notes!.length
    d = apply(d, { kind: 'remove_note', index: 0 })
    expect(d.body.notes!.length).toBe(before - 1)
  })

  test('error paths are prescriptive', () => {
    expectErr(state(), { kind: 'add_note', target: 'Ghost', text: 'x' }, 'STATE_NOT_FOUND')
    expectErr(state(), { kind: 'add_note', target: 'Idle', text: '' }, 'INVALID_OP')
    expectErr(state(), { kind: 'add_note', target: 'Idle', text: 'a\nend note\nb' }, 'INVALID_OP')
    expectErr(state(), { kind: 'remove_note', index: 99 }, 'NOTE_NOT_FOUND')
    expectErr(state(), { kind: 'set_note_text', index: 99, text: 'x' }, 'NOTE_NOT_FOUND')
  })

  test('remove_state also drops notes anchored to the removed state', () => {
    let d = state()
    d = apply(d, { kind: 'remove_state', id: 'Active' })
    expect(d.body.notes!.some(n => n.target === 'Active')).toBe(false)
    // …and rename_state re-targets them.
    let d2 = state()
    d2 = apply(d2, { kind: 'rename_state', from: 'Active', to: 'Running' })
    expect(d2.body.notes!.some(n => n.target === 'Running')).toBe(true)
    expect(d2.body.notes!.some(n => n.target === 'Active')).toBe(false)
  })
})
