/**
 * Sequence serializer → RENDERER-parser conformance guard (P3 pattern, scoped
 * to the constructs this elevation added: box segments, indexed inserts,
 * moves, participant relabels).
 *
 * The fidelity contract: any form the agent serializer emits after a
 * SUCCEEDING op must re-parse through the renderer's parser
 * (src/sequence/parser.ts) to the same structure the op promised. This is the
 * seam where the audit found silent-loss bugs in four families
 * (flowchart-parser-conformance.test.ts is the pattern being extended).
 */
import { describe, test, expect } from 'bun:test'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asSequence } from '../agent/types.ts'
import type { SequenceValidDiagram, SequenceMutationOp } from '../agent/types.ts'

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

/** Re-parse serialized agent output through the RENDERER parser. */
function renderParse(source: string) {
  const lines = source.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseSequenceDiagram(lines)
}

const BOXED = `sequenceDiagram
  box Aqua Team A
    participant A as Alice
    participant B as Bob
  end
  A->>B: one
  B-->>A: two`

describe('sequence serializer → renderer-parser conformance (new constructs)', () => {
  test('boxed body: serialize keeps the box parseable by the renderer', () => {
    const d = sequence(BOXED)
    const rendered = renderParse(serializeMermaid(d))
    expect(rendered.boxes).toHaveLength(1)
    expect(rendered.boxes![0]!.label).toBe('Team A')
    expect(rendered.boxes![0]!.color).toBe('Aqua')
    expect(rendered.boxes![0]!.actorIds).toEqual(['A', 'B'])
    expect(rendered.messages.map(m => m.label)).toEqual(['one', 'two'])
  })

  test('ops on a boxed body keep renderer-visible structure consistent', () => {
    let d = sequence(BOXED)
    d = apply(d, { kind: 'add_message', from: 'B', to: 'A', text: 'mid', index: 1 })
    d = apply(d, { kind: 'move_message', from: 2, to: 0 })
    d = apply(d, { kind: 'set_participant_label', id: 'A', label: 'Alicia' })
    const rendered = renderParse(serializeMermaid(d))
    // Top-level messages in the mutated order, all visible to the renderer
    expect(rendered.messages.map(m => m.label)).toEqual(d.body.messages.map(m => m.text))
    // The relabel is what the renderer will draw
    expect(rendered.actors.find(a => a.id === 'A')!.label).toBe('Alicia')
    // Box intact
    expect(rendered.boxes).toHaveLength(1)
    expect(rendered.boxes![0]!.actorIds).toContain('A')
  })

  test('set_participant_label survives renderer parse for adversarial labels', () => {
    const labels = ['Retry (up to 3x)', 'a as b', 'x -> y', 'Bob & Carol', '50% done']
    for (const label of labels) {
      const d = apply(sequence('sequenceDiagram\n  A->>B: hi'), { kind: 'set_participant_label', id: 'A', label })
      const rendered = renderParse(serializeMermaid(d))
      expect(rendered.actors.find(a => a.id === 'A')!.label).toBe(label)
      expect(rendered.messages).toHaveLength(1)
    }
  })

  test('indexed insert and move keep renderer message order equal to body order', () => {
    const src = 'sequenceDiagram\n  A->>B: m0\n  B->>A: m1\n  A->>B: m2'
    let d = sequence(src)
    d = apply(d, { kind: 'add_message', from: 'A', to: 'B', text: 'mNew', index: 0 })
    d = apply(d, { kind: 'move_message', from: 3, to: 1 })
    const rendered = renderParse(serializeMermaid(d))
    expect(rendered.messages.map(m => m.label)).toEqual(d.body.messages.map(m => m.text))
    // Idempotence: a second serialize of the re-parsed agent body is stable
    const again = sequence(serializeMermaid(d))
    expect(serializeMermaid(again)).toBe(serializeMermaid(d))
  })
})
