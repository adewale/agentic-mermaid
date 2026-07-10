/**
 * Sequence op-menu widening — family-elevation-plan §Sequence item 6, journey
 * conventions from PR #141: validated indices, prescriptive errors, and every
 * succeeding op must survive serialize → re-parse.
 *
 * New ops under test:
 *   - add_message gains optional `index` (top-level insert position)
 *   - move_message { from, to } (top-level indices)
 *   - set_participant_label { id, label }
 */
import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asSequence } from '../agent/types.ts'
import type { SequenceValidDiagram, SequenceMutationOp } from '../agent/types.ts'
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'
import { describeOps } from '../agent/op-schema.ts'

function sequence(src: string): SequenceValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const s = asSequence(r.value)
  if (!s) throw new Error('not a structured sequence body')
  return s
}

function apply(d: SequenceValidDiagram, op: SequenceMutationOp): SequenceValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.value
}

function messageTexts(d: SequenceValidDiagram): string[] {
  return d.body.messages.map(m => m.text)
}

const SRC = 'sequenceDiagram\n  participant A as Alice\n  A->>B: one\n  B-->>A: two\n  A->>B: three'

// ============================================================================
// add_message index
// ============================================================================

describe('sequence add_message with index', () => {
  test('inserts at a top-level position', () => {
    const d = apply(sequence(SRC), { kind: 'add_message', from: 'A', to: 'B', text: 'early', index: 1 })
    expect(messageTexts(d)).toEqual(['one', 'early', 'two', 'three'])
    // Serialized order matches
    const out = serializeMermaid(d)
    expect(out.indexOf('early')).toBeGreaterThan(out.indexOf('one'))
    expect(out.indexOf('early')).toBeLessThan(out.indexOf('two'))
    // Serialize → re-parse preserves the edit (P3 fidelity contract)
    const back = sequence(out)
    expect(messageTexts(back)).toEqual(['one', 'early', 'two', 'three'])
  })

  test('index 0 prepends; index === length appends', () => {
    const first = apply(sequence(SRC), { kind: 'add_message', from: 'B', to: 'A', text: 'zeroth', index: 0 })
    expect(messageTexts(first)).toEqual(['zeroth', 'one', 'two', 'three'])
    const last = apply(sequence(SRC), { kind: 'add_message', from: 'B', to: 'A', text: 'fourth', index: 3 })
    expect(messageTexts(last)).toEqual(['one', 'two', 'three', 'fourth'])
  })

  test('omitting index keeps the append behavior', () => {
    const d = apply(sequence(SRC), { kind: 'add_message', from: 'A', to: 'B', text: 'tail' })
    expect(messageTexts(d)).toEqual(['one', 'two', 'three', 'tail'])
  })

  test('out-of-range index is a prescriptive error', () => {
    const r = mutate(sequence(SRC), { kind: 'add_message', from: 'A', to: 'B', text: 'x', index: 7 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INVALID_OP')
    expect(r.error.message).toContain('7')
    expect(r.error.message).toContain('0..3')
  })

  test('non-integer index rejected', () => {
    const r = mutate(sequence(SRC), { kind: 'add_message', from: 'A', to: 'B', text: 'x', index: 1.5 })
    expect(r.ok).toBe(false)
  })

  test('insert lands before an opaque segment boundary correctly', () => {
    const src = 'sequenceDiagram\n  A->>B: one\n  Note over A: mid\n  A->>B: two'
    const d = apply(sequence(src), { kind: 'add_message', from: 'B', to: 'A', text: 'between', index: 1 })
    expect(messageTexts(d)).toEqual(['one', 'between', 'two'])
    const out = serializeMermaid(d)
    // The note keeps its anchoring after message one
    expect(out.indexOf('Note over A: mid')).toBeGreaterThan(out.indexOf('one'))
    const back = sequence(out)
    expect(messageTexts(back)).toEqual(['one', 'between', 'two'])
    expect(out).toContain('Note over A: mid')
  })
})

// ============================================================================
// move_message
// ============================================================================

describe('sequence move_message', () => {
  test('moves a top-level message to a new position', () => {
    const d = apply(sequence(SRC), { kind: 'move_message', from: 2, to: 0 })
    expect(messageTexts(d)).toEqual(['three', 'one', 'two'])
    const back = sequence(serializeMermaid(d))
    expect(messageTexts(back)).toEqual(['three', 'one', 'two'])
  })

  test('moves forward as well as backward', () => {
    const d = apply(sequence(SRC), { kind: 'move_message', from: 0, to: 2 })
    expect(messageTexts(d)).toEqual(['two', 'three', 'one'])
  })

  test('move is stable across opaque segments (box/notes preserved verbatim)', () => {
    const src = 'sequenceDiagram\n  A->>B: one\n  Note over A: mid\n  A->>B: two'
    const d = apply(sequence(src), { kind: 'move_message', from: 1, to: 0 })
    expect(messageTexts(d)).toEqual(['two', 'one'])
    const out = serializeMermaid(d)
    expect(out).toContain('Note over A: mid')
    const back = sequence(out)
    expect(messageTexts(back)).toEqual(['two', 'one'])
  })

  test('from out of range is a prescriptive error', () => {
    const r = mutate(sequence(SRC), { kind: 'move_message', from: 9, to: 0 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('MESSAGE_NOT_FOUND')
    expect(r.error.message).toContain('9')
    expect(r.error.message).toContain('0..2')
  })

  test('to out of range is a prescriptive error', () => {
    const r = mutate(sequence(SRC), { kind: 'move_message', from: 0, to: 3 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('MESSAGE_NOT_FOUND')
    expect(r.error.message).toContain('0..2')
  })

  test('from === to is a no-op success', () => {
    const d = apply(sequence(SRC), { kind: 'move_message', from: 1, to: 1 })
    expect(messageTexts(d)).toEqual(['one', 'two', 'three'])
  })
})

// ============================================================================
// set_participant_label
// ============================================================================

describe('sequence set_participant_label', () => {
  test('updates a declared participant label and round-trips', () => {
    const d = apply(sequence(SRC), { kind: 'set_participant_label', id: 'A', label: 'Alicia' })
    expect(d.body.participants.find(p => p.id === 'A')!.label).toBe('Alicia')
    const out = serializeMermaid(d)
    expect(out).toContain('participant A as Alicia')
    const back = sequence(out)
    expect(back.body.participants.find(p => p.id === 'A')!.label).toBe('Alicia')
  })

  test('labels an implicit (message-only) participant by adding a declaration', () => {
    const d = apply(sequence(SRC), { kind: 'set_participant_label', id: 'B', label: 'Bobby' })
    const out = serializeMermaid(d)
    expect(out).toContain('participant B as Bobby')
    const back = sequence(out)
    expect(back.body.participants.find(p => p.id === 'B')!.label).toBe('Bobby')
  })

  test('setting the label back to the id serializes a bare declaration', () => {
    const d = apply(sequence(SRC), { kind: 'set_participant_label', id: 'A', label: 'A' })
    const out = serializeMermaid(d)
    expect(out).not.toContain(' as ')
    const back = sequence(out)
    expect(back.body.participants.find(p => p.id === 'A')!.label).toBe('A')
  })

  test('unknown participant is a prescriptive error', () => {
    const r = mutate(sequence(SRC), { kind: 'set_participant_label', id: 'Z', label: 'Zed' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('PARTICIPANT_NOT_FOUND')
    expect(r.error.message).toContain('Z')
  })

  test('empty and multi-line labels rejected (would not survive re-parse)', () => {
    for (const label of ['', '   ', 'two\nlines']) {
      const r = mutate(sequence(SRC), { kind: 'set_participant_label', id: 'A', label })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_OP')
    }
  })
})

// ============================================================================
// Registry wiring
// ============================================================================

describe('sequence op registry wiring', () => {
  test('new ops are in MUTATION_OPS_BY_FAMILY', () => {
    expect(MUTATION_OPS_BY_FAMILY.sequence).toContain('move_message')
    expect(MUTATION_OPS_BY_FAMILY.sequence).toContain('set_participant_label')
  })

  test('op-schema knows the new shapes', () => {
    const docs = describeOps('sequence')
    expect(Object.keys(docs)).toContain('move_message')
    expect(Object.keys(docs)).toContain('set_participant_label')
    expect(docs.add_message!.map(f => f.name)).toContain('index')
  })
})
