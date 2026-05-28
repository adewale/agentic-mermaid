// Comprehensive agent surface tests — flowchart, sequence, round-trip,
// verify (Tier 1 + Tier 2), Finite brand, asFlowchart/asSequence narrowing.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import {
  asFlowchart,
  asSequence,
  toFinite,
  WARNING_TIER,
  WARNING_SEVERITY,
} from '../agent/types.ts'
import { createLayoutContext } from '../agent/context.ts'
import type {
  FlowchartMutationOp,
  FlowchartValidDiagram,
  SequenceValidDiagram,
} from '../agent/types.ts'

function parse(src: string) {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse failed: ' + JSON.stringify(r.error))
  return r.value
}

function flowchart(src: string): FlowchartValidDiagram {
  const flow = asFlowchart(parse(src))
  if (!flow) throw new Error('not a flowchart')
  return flow
}

function sequence(src: string): SequenceValidDiagram {
  const seq = asSequence(parse(src))
  if (!seq) throw new Error('not a sequence diagram')
  return seq
}

// ============================================================================
// parseMermaid
// ============================================================================

describe('parseMermaid', () => {
  test('flowchart', () => {
    const r = parseMermaid('flowchart TD\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.kind).toBe('flowchart')
    expect(r.value.body.kind).toBe('flowchart')
  })

  test('sequence (structured body)', () => {
    const r = parseMermaid('sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.kind).toBe('sequence')
    expect(r.value.body.kind).toBe('sequence')
    if (r.value.body.kind !== 'sequence') return
    expect(r.value.body.participants.map(p => p.id)).toEqual(['Alice', 'Bob'])
    expect(r.value.body.messages.length).toBe(2)
    expect(r.value.body.messages[0]!.style).toBe('sync')
    expect(r.value.body.messages[1]!.style).toBe('reply')
  })

  test('sequence with explicit participants and aliases', () => {
    const r = parseMermaid(`sequenceDiagram
  participant A as Alice
  actor B as Bob
  A->>B: Hi`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'sequence') return
    expect(r.value.body.participants[0]).toEqual({ id: 'A', label: 'Alice', kind: 'participant' })
    expect(r.value.body.participants[1]).toEqual({ id: 'B', label: 'Bob', kind: 'actor' })
  })

  test('non-flowchart non-sequence stays opaque', () => {
    for (const [src, kind] of [
      ['classDiagram\n  Animal <|-- Duck', 'class'],
      ['erDiagram\n  CUSTOMER ||--o{ ORDER : places', 'er'],
      ['timeline\n  2020 : A', 'timeline'],
    ] as const) {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.value.kind).toBe(kind)
      expect(r.value.body.kind).toBe('opaque')
    }
  })
})

// ============================================================================
// Narrowing
// ============================================================================

describe('asFlowchart / asSequence', () => {
  test('asFlowchart narrows flowchart', () => {
    expect(asFlowchart(parse('flowchart TD\n  A --> B'))).not.toBeNull()
  })
  test('asFlowchart rejects sequence', () => {
    expect(asFlowchart(parse('sequenceDiagram\n  A->>B: Hi'))).toBeNull()
  })
  test('asSequence narrows sequence', () => {
    expect(asSequence(parse('sequenceDiagram\n  A->>B: Hi'))).not.toBeNull()
  })
  test('asSequence rejects flowchart', () => {
    expect(asSequence(parse('flowchart TD\n  A --> B'))).toBeNull()
  })
  test('asSequence rejects opaque families', () => {
    expect(asSequence(parse('timeline\n  2020 : A'))).toBeNull()
  })
})

// ============================================================================
// Flowchart mutation
// ============================================================================

describe('flowchart mutate — all six ops', () => {
  test('add_node', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_node', id: 'C', label: 'Cache' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.nodes.has('C')).toBe(true)
  })
  test('remove_node cascades to incident edges', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B\n  B --> C'), { kind: 'remove_node', id: 'B' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.edges).toHaveLength(0)
  })
  test('rename_node updates edges', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'rename_node', from: 'B', to: 'M' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.edges[0]!.target).toBe('M')
  })
  test('set_label on node', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'set_label', target: 'A', label: 'Alpha' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.nodes.get('A')!.label).toBe('Alpha')
  })
  test('add_edge creates implicit nodes', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_edge', from: 'C', to: 'D' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.nodes.has('C')).toBe(true)
  })
  test('remove_edge', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B\n  B --> C'), { kind: 'remove_edge', id: 'A->B' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.edges).toHaveLength(1)
  })
})

// ============================================================================
// Sequence mutation
// ============================================================================

describe('sequence mutate — all five ops', () => {
  test('add_participant', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), { kind: 'add_participant', id: 'C', label: 'Charlie' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.participants.find(p => p.id === 'C')).toMatchObject({ label: 'Charlie' })
  })
  test('add_participant rejects duplicate', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), { kind: 'add_participant', id: 'A' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('DUPLICATE_PARTICIPANT')
  })
  test('remove_participant cascades to messages', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi\n  B-->>A: Hello\n  A->>C: Bye'), {
      kind: 'remove_participant', id: 'B',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.participants.find(p => p.id === 'B')).toBeUndefined()
    expect(r.value.body.messages.every(m => m.from !== 'B' && m.to !== 'B')).toBe(true)
    expect(r.value.body.messages.length).toBe(1)
  })
  test('add_message implicitly declares missing participants', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), {
      kind: 'add_message', from: 'C', to: 'D', text: 'New',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.participants.map(p => p.id)).toContain('C')
    expect(r.value.body.participants.map(p => p.id)).toContain('D')
    expect(r.value.body.messages.length).toBe(2)
  })
  test('remove_message by index', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: First\n  B-->>A: Second'), {
      kind: 'remove_message', index: 0,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.messages.length).toBe(1)
    expect(r.value.body.messages[0]!.text).toBe('Second')
  })
  test('set_message_text', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), {
      kind: 'set_message_text', index: 0, text: 'Updated',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.messages[0]!.text).toBe('Updated')
  })
  test('out-of-bounds index errors', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), { kind: 'remove_message', index: 5 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('MESSAGE_NOT_FOUND')
  })
})

// ============================================================================
// Round-trip
// ============================================================================

describe('flowchart round-trip', () => {
  test('serialize ∘ parse is stable on a hand-picked corpus', () => {
    const corpus = [
      'flowchart TD\n  A --> B',
      'flowchart LR\n  A[Alpha] --> B[Beta]',
      'flowchart TD\n  A{D} --> B[Yes]\n  A --> C[No]',
      'flowchart TD\n  A((Start)) --> B[Step]\n  B --> C((End))',
      '---\ntitle: T\n---\nflowchart TD\n  A --> B',
    ]
    for (const src of corpus) {
      const r1 = parseMermaid(src)
      expect(r1.ok).toBe(true)
      if (!r1.ok) continue
      const s1 = serializeMermaid(r1.value)
      const r2 = parseMermaid(s1)
      expect(r2.ok).toBe(true)
      if (!r2.ok) continue
      expect(serializeMermaid(r2.value)).toBe(s1)
    }
  })
})

describe('sequence round-trip', () => {
  test('serialize ∘ parse is stable', () => {
    const corpus = [
      'sequenceDiagram\n  Alice->>Bob: Hi',
      'sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello',
      'sequenceDiagram\n  participant A as Alice\n  A->>B: Hi',
    ]
    for (const src of corpus) {
      const r1 = parseMermaid(src)
      expect(r1.ok).toBe(true)
      if (!r1.ok) continue
      const s1 = serializeMermaid(r1.value)
      const r2 = parseMermaid(s1)
      expect(r2.ok).toBe(true)
      if (!r2.ok) continue
      expect(serializeMermaid(r2.value)).toBe(s1)
    }
  })

  test('preserves message styles', () => {
    const src = 'sequenceDiagram\n  A->>B: sync\n  B-->>A: reply\n  A->B: async\n  A-->B: async-d\n  B-x A: lost'
    const r = parseMermaid(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'sequence') return
    const styles = r.value.body.messages.map(m => m.style)
    expect(styles).toEqual(['sync', 'reply', 'async', 'async-dashed', 'lost'])
    const out = serializeMermaid(r.value)
    expect(out).toContain('->>')
    expect(out).toContain('-->>')
    expect(out).toContain(' -> ')
    expect(out).toContain('-->')
    expect(out).toContain('-x')
  })
})

describe('round-trip property', () => {
  test('random flowchart mutation chains stay parseable', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom('add_node', 'add_edge'),
            id: fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[A-Za-z][A-Za-z0-9]*$/.test(s)),
            label: fc.string({ minLength: 0, maxLength: 10 }).filter(s => !/[\[\]{}()<>|"]/.test(s)),
            from: fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[A-Za-z][A-Za-z0-9]*$/.test(s)),
            to: fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[A-Za-z][A-Za-z0-9]*$/.test(s)),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        ops => {
          const flow = asFlowchart(parse('flowchart TD\n  A --> B'))
          if (!flow) return true
          let d = flow
          for (const o of ops) {
            const op: FlowchartMutationOp =
              o.kind === 'add_node'
                ? { kind: 'add_node', id: o.id, label: o.label || o.id }
                : { kind: 'add_edge', from: o.from, to: o.to }
            const next = mutate(d, op)
            if (next.ok) d = next.value
          }
          return parseMermaid(serializeMermaid(d)).ok
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('synthesizeFromGraph', () => {
  test('round-trips a flowchart payload without canonicalSource', () => {
    const original = parse('flowchart TD\n  A[Alpha] --> B[Beta]\n  B --> C[Gamma]')
    if (original.body.kind !== 'flowchart') throw new Error('flowchart expected')
    const payload = {
      kind: original.kind,
      meta: original.meta,
      body: {
        kind: 'flowchart' as const,
        graph: {
          direction: original.body.graph.direction,
          nodes: Object.fromEntries(original.body.graph.nodes),
          edges: original.body.graph.edges,
          subgraphs: original.body.graph.subgraphs,
        },
      },
    }
    const r = synthesizeFromGraph(payload)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const out = serializeMermaid(r.value)
    expect(out).toContain('A[Alpha] --> B[Beta]')
  })

  test('round-trips a sequence body', () => {
    const r = synthesizeFromGraph({
      kind: 'sequence',
      body: {
        kind: 'sequence',
        participants: [
          { id: 'Alice', label: 'Alice', kind: 'participant' },
          { id: 'Bob', label: 'Bob', kind: 'participant' },
        ],
        messages: [{ from: 'Alice', to: 'Bob', text: 'Hi', style: 'sync' }],
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(serializeMermaid(r.value)).toContain('Alice ->> Bob: Hi')
  })
})

// ============================================================================
// Verify
// ============================================================================

describe('verifyMermaid — Tier 1 source-based', () => {
  test('clean flowchart returns ok', () => {
    expect(verifyMermaid('flowchart TD\n  A --> B').ok).toBe(true)
  })

  test('EMPTY_DIAGRAM on empty source', () => {
    const r = verifyMermaid('')
    expect(r.ok).toBe(false)
    expect(r.warnings.find(w => w.code === 'EMPTY_DIAGRAM')).toBeDefined()
  })

  test('LABEL_OVERFLOW is now source-based and reliably fires on long labels', () => {
    const longLabel = 'X'.repeat(60)
    const r = verifyMermaid(`flowchart TD\n  A[${longLabel}] --> B`)
    const overflow = r.warnings.find(w => w.code === 'LABEL_OVERFLOW')
    expect(overflow).toBeDefined()
    if (overflow && overflow.code === 'LABEL_OVERFLOW') {
      expect(overflow.charCount).toBe(60)
      expect(overflow.limit).toBe(40)
    }
  })

  test('LABEL_OVERFLOW respects custom labelCharCap', () => {
    const r = verifyMermaid('flowchart TD\n  A[shortish] --> B', {
      layoutContext: createLayoutContext({ labelCharCap: 4 }),
    })
    expect(r.warnings.find(w => w.code === 'LABEL_OVERFLOW')).toBeDefined()
  })

  test('LABEL_OVERFLOW does not fire on short labels', () => {
    const r = verifyMermaid('flowchart TD\n  A --> B')
    expect(r.warnings.find(w => w.code === 'LABEL_OVERFLOW')).toBeUndefined()
  })
})

describe('verifyMermaid — sequence', () => {
  test('clean sequence is ok', () => {
    expect(verifyMermaid('sequenceDiagram\n  A->>B: Hi').ok).toBe(true)
  })

  test('LABEL_OVERFLOW on long message text', () => {
    const r = verifyMermaid(`sequenceDiagram\n  A->>B: ${'x'.repeat(60)}`)
    expect(r.warnings.find(w => w.code === 'LABEL_OVERFLOW')).toBeDefined()
  })

  test('EMPTY_DIAGRAM on header-only', () => {
    const r = verifyMermaid('sequenceDiagram')
    expect(r.ok).toBe(false)
    expect(r.warnings.find(w => w.code === 'EMPTY_DIAGRAM')).toBeDefined()
  })
})

describe('verifyMermaid — suppress', () => {
  test('omits suppressed codes', () => {
    const r = verifyMermaid('flowchart TD\n  A --> B', {
      suppress: ['NODE_OVERLAP', 'ROUTE_SELF_CROSS'],
    })
    expect(r.warnings.find(w => w.code === 'NODE_OVERLAP')).toBeUndefined()
  })
})

describe('warning tier classification', () => {
  test('all 8 codes have severity + tier', () => {
    const codes = [
      'EMPTY_DIAGRAM', 'EDGE_MISANCHORED', 'OFF_CANVAS', 'GROUP_BREACH',
      'UNKNOWN_SHAPE', 'LABEL_OVERFLOW', 'NODE_OVERLAP', 'ROUTE_SELF_CROSS',
    ] as const
    for (const c of codes) {
      expect(WARNING_SEVERITY[c]).toMatch(/^(error|warning)$/)
      expect(WARNING_TIER[c]).toMatch(/^(structural|geometric)$/)
    }
  })
  test('LABEL_OVERFLOW is now Tier 1 (structural)', () => {
    expect(WARNING_TIER.LABEL_OVERFLOW).toBe('structural')
  })
})

// ============================================================================
// Finite brand
// ============================================================================

describe('toFinite', () => {
  test('accepts finite numbers', () => {
    expect(toFinite(3.14)).toBe(3.14 as never)
  })
  test('throws on NaN', () => {
    expect(() => toFinite(NaN)).toThrow(RangeError)
  })
  test('throws on Infinity', () => {
    expect(() => toFinite(Infinity)).toThrow(RangeError)
  })
})

describe('verify emits only finite coordinates', () => {
  test('layout JSON contains no NaN or Infinity', () => {
    const layout = verifyMermaid('flowchart TD\n  A --> B\n  B --> C').layout
    const flat = JSON.stringify(layout)
    expect(flat).not.toContain('NaN')
    expect(flat).not.toContain('Infinity')
  })
})
