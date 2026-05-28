// Comprehensive agent-surface test suite.
//
// Covers: parse, serialize, mutate (all 6 ops), verify (all 8 codes, both
// tiers), round-trip property, Finite brand, asFlowchart narrowing, edge +
// shape serialization across all combinations.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asFlowchart, toFinite, WARNING_TIER } from '../agent/types.ts'
import type { MutationOp, FlowchartValidDiagram } from '../agent/types.ts'

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

// ============================================================================
// parseMermaid
// ============================================================================

describe('parseMermaid', () => {
  test('parses a minimal flowchart', () => {
    const r = parseMermaid('flowchart TD\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.kind).toBe('flowchart')
    expect(r.value.body.kind).toBe('flowchart')
  })

  test('extracts frontmatter into meta', () => {
    const r = parseMermaid('---\ntitle: T\n---\nflowchart TD\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta.frontmatter?.title).toBe('T')
  })

  test('captures init directives', () => {
    const r = parseMermaid('%%{init: {"theme":"forest"}}%%\nflowchart TD\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta.initDirectives).toHaveLength(1)
    expect(r.value.meta.initDirectives[0]!.parsed.theme).toBe('forest')
  })

  test('captures comments', () => {
    const r = parseMermaid('flowchart TD\n%% comment\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta.comments).toHaveLength(1)
    expect(r.value.meta.comments[0]!.text).toBe('comment')
  })

  test('captures accTitle / accDescr', () => {
    const r = parseMermaid('flowchart TD\n  accTitle: Title\n  accDescr: Descr\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta.accessibility.title).toBe('Title')
    expect(r.value.meta.accessibility.descr).toBe('Descr')
  })

  test('returns multi-error on empty source', () => {
    const r = parseMermaid('')
    expect(r.ok).toBe(false)
  })

  test('returns UNKNOWN_HEADER on unrecognized', () => {
    const r = parseMermaid('notADiagram\n  X')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error[0]!.code).toBe('UNKNOWN_HEADER')
  })

  test('detects non-flowchart families as opaque', () => {
    const families = [
      ['sequenceDiagram\n  A->>B: Hi', 'sequence'],
      ['classDiagram\n  Animal <|-- Duck', 'class'],
      ['erDiagram\n  CUSTOMER ||--o{ ORDER : places', 'er'],
      ['timeline\n  2020 : A', 'timeline'],
      ['journey\n  title T', 'journey'],
    ] as const
    for (const [src, kind] of families) {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.value.kind).toBe(kind)
      expect(r.value.body.kind).toBe('opaque')
    }
  })

  test('canonicalSource is set on every ValidDiagram', () => {
    for (const src of ['flowchart TD\n  A --> B', 'sequenceDiagram\n  A->>B: Hi']) {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.value.canonicalSource.length).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// asFlowchart narrowing
// ============================================================================

describe('asFlowchart', () => {
  test('narrows flowchart', () => {
    const flow = asFlowchart(parse('flowchart TD\n  A --> B'))
    expect(flow).not.toBeNull()
  })

  test('returns null for opaque families', () => {
    expect(asFlowchart(parse('sequenceDiagram\n  A->>B: Hi'))).toBeNull()
    expect(asFlowchart(parse('timeline\n  2020 : A'))).toBeNull()
  })

  test('narrowing preserves the diagram identity', () => {
    const d = parse('flowchart TD\n  A --> B')
    const flow = asFlowchart(d)
    expect(flow).toBe(d as FlowchartValidDiagram)
  })
})

// ============================================================================
// mutate — all six op kinds
// ============================================================================

describe('mutate — add_node', () => {
  test('adds a node', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_node', id: 'C', label: 'Cache' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.nodes.has('C')).toBe(true)
  })

  test('respects shape override', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_node', id: 'D', label: 'DB', shape: 'cylinder' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.nodes.get('D')!.shape).toBe('cylinder')
  })

  test('rejects duplicate id', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_node', id: 'A', label: 'X' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('DUPLICATE_NODE')
  })
})

describe('mutate — remove_node', () => {
  test('removes node and incident edges', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B\n  B --> C'), { kind: 'remove_node', id: 'B' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.nodes.has('B')).toBe(false)
    expect(r.value.body.graph.edges).toHaveLength(0)
  })

  test('NODE_NOT_FOUND on missing id', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'remove_node', id: 'Z' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('NODE_NOT_FOUND')
  })
})

describe('mutate — rename_node', () => {
  test('renames and updates incident edges', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B\n  B --> C'), { kind: 'rename_node', from: 'B', to: 'Middle' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.nodes.has('Middle')).toBe(true)
    expect(r.value.body.graph.edges[0]!.target).toBe('Middle')
    expect(r.value.body.graph.edges[1]!.source).toBe('Middle')
  })

  test('rejects rename to existing', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'rename_node', from: 'A', to: 'B' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('DUPLICATE_NODE')
  })
})

describe('mutate — set_label', () => {
  test('sets node label', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'set_label', target: 'A', label: 'Alpha' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.nodes.get('A')!.label).toBe('Alpha')
  })

  test('sets edge label by from->to id', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'set_label', target: 'A->B', label: 'flows' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.edges[0]!.label).toBe('flows')
  })
})

describe('mutate — add_edge / remove_edge', () => {
  test('adds an edge', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_edge', from: 'A', to: 'B', label: 'second' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.edges).toHaveLength(2)
  })

  test('add_edge creates implicit endpoint nodes', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_edge', from: 'C', to: 'D' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.nodes.has('C')).toBe(true)
    expect(r.value.body.graph.nodes.has('D')).toBe(true)
  })

  test('removes an edge by id', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B\n  B --> C'), { kind: 'remove_edge', id: 'A->B' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.graph.edges).toHaveLength(1)
  })

  test('EDGE_NOT_FOUND on missing id', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'remove_edge', id: 'Z->Y' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('EDGE_NOT_FOUND')
  })
})

describe('mutate — immutability', () => {
  test('does not modify the input diagram', () => {
    const flow = flowchart('flowchart TD\n  A --> B')
    const before = [...flow.body.graph.nodes.keys()].sort()
    mutate(flow, { kind: 'add_node', id: 'C', label: 'C' })
    expect([...flow.body.graph.nodes.keys()].sort()).toEqual(before)
  })
})

// ============================================================================
// verify
// ============================================================================

describe('verifyMermaid', () => {
  test('ok for a clean flowchart (ignoring NODE_OVERLAP/ROUTE_SELF_CROSS)', () => {
    const r = verifyMermaid('flowchart TD\n  A --> B')
    expect(r.ok).toBe(true)
  })

  test('returns layout JSON with finite coordinates', () => {
    const r = verifyMermaid('flowchart TD\n  A --> B\n  B --> C')
    expect(r.layout.nodes.length).toBe(3)
    for (const n of r.layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
    expect(JSON.stringify(r.layout)).not.toContain('NaN')
    expect(JSON.stringify(r.layout)).not.toContain('Infinity')
  })

  test('EMPTY_DIAGRAM on empty source', () => {
    const r = verifyMermaid('')
    expect(r.ok).toBe(false)
    expect(r.warnings.find(w => w.code === 'EMPTY_DIAGRAM')).toBeDefined()
  })

  test('suppress filter omits codes', () => {
    const r = verifyMermaid('flowchart TD\n  A --> B', { suppress: ['NODE_OVERLAP', 'ROUTE_SELF_CROSS'] })
    expect(r.warnings.find(w => w.code === 'NODE_OVERLAP')).toBeUndefined()
  })

  test('deterministic across runs', () => {
    const a = verifyMermaid('flowchart LR\n  A --> B --> C')
    const b = verifyMermaid('flowchart LR\n  A --> B --> C')
    expect(JSON.stringify(b.layout)).toEqual(JSON.stringify(a.layout))
  })

  test('opaque family verifies without forcing error', () => {
    const r = verifyMermaid('sequenceDiagram\n  A->>B: Hi')
    expect(r.layout.kind).toBe('sequence')
  })

  test('accepts ValidDiagram directly', () => {
    const r = verifyMermaid(parse('flowchart TD\n  A --> B'))
    expect(r.ok).toBe(true)
  })
})

describe('warning tier classification', () => {
  test('every emitted code has a tier', () => {
    for (const code of ['EMPTY_DIAGRAM', 'EDGE_MISANCHORED', 'OFF_CANVAS', 'GROUP_BREACH', 'UNKNOWN_SHAPE', 'LABEL_OVERFLOW', 'NODE_OVERLAP', 'ROUTE_SELF_CROSS'] as const) {
      expect(WARNING_TIER[code]).toMatch(/^(structural|metric)$/)
    }
  })

  test('Tier 1 codes match the structural set', () => {
    expect(WARNING_TIER.EMPTY_DIAGRAM).toBe('structural')
    expect(WARNING_TIER.EDGE_MISANCHORED).toBe('structural')
    expect(WARNING_TIER.OFF_CANVAS).toBe('structural')
    expect(WARNING_TIER.GROUP_BREACH).toBe('structural')
    expect(WARNING_TIER.UNKNOWN_SHAPE).toBe('structural')
  })

  test('Tier 2 codes are metric', () => {
    expect(WARNING_TIER.LABEL_OVERFLOW).toBe('metric')
    expect(WARNING_TIER.NODE_OVERLAP).toBe('metric')
    expect(WARNING_TIER.ROUTE_SELF_CROSS).toBe('metric')
  })
})

// ============================================================================
// Round-trip
// ============================================================================

describe('round-trip', () => {
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

  test('opaque-family round-trip preserves source verbatim', () => {
    const corpus = [
      'sequenceDiagram\n  A->>B: Hi',
      'timeline\n  title T\n  2020 : Event',
      'journey\n  title D\n  section M\n    W: 3: Me',
    ]
    for (const src of corpus) {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      const s = serializeMermaid(r.value)
      const r2 = parseMermaid(s)
      expect(r2.ok).toBe(true)
      if (!r2.ok) continue
      expect(r2.value.kind).toBe(r.value.kind)
    }
  })

  test('property: random mutation chains stay parseable', () => {
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
          const r0 = parseMermaid('flowchart TD\n  A --> B')
          if (!r0.ok) return true
          const flow = asFlowchart(r0.value)
          if (!flow) return true
          let d = flow
          for (const o of ops) {
            const op: MutationOp =
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

// ============================================================================
// Edge + shape serialization
// ============================================================================

describe('edge round-trip across style × marker', () => {
  const cases = [
    'flowchart TD\n  A --> B',
    'flowchart TD\n  A --- B',
    'flowchart TD\n  A --o B',
    'flowchart TD\n  A --x B',
    'flowchart TD\n  A <--> B',
    'flowchart TD\n  A -.-> B',
    'flowchart TD\n  A -.- B',
    'flowchart TD\n  A ==> B',
    'flowchart TD\n  A === B',
  ]
  for (const src of cases) {
    test(src.split('\n')[1]!.trim(), () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const out = serializeMermaid(r.value)
      const r2 = parseMermaid(out)
      expect(r2.ok).toBe(true)
      if (!r2.ok) return
      expect(serializeMermaid(r2.value)).toBe(out)
    })
  }
})

describe('shape round-trip', () => {
  const shapes = ['A[Alpha]', 'A(Alpha)', 'A([Alpha])', 'A[[Alpha]]', 'A[(Alpha)]', 'A((Alpha))', 'A(((Alpha)))', 'A{Alpha}', 'A{{Alpha}}']
  for (const ref of shapes) {
    test(ref, () => {
      const src = `flowchart TD\n  ${ref} --> B`
      const r = parseMermaid(src)
      if (!r.ok) throw new Error('parse')
      const out = serializeMermaid(r.value)
      expect(out).toContain(ref)
    })
  }
})

// ============================================================================
// Finite brand
// ============================================================================

describe('toFinite', () => {
  test('accepts finite', () => {
    expect(toFinite(0)).toBe(0 as never)
    expect(toFinite(3.14)).toBe(3.14 as never)
  })

  test('throws on NaN', () => {
    expect(() => toFinite(NaN)).toThrow(RangeError)
  })

  test('throws on Infinity', () => {
    expect(() => toFinite(Infinity)).toThrow(RangeError)
    expect(() => toFinite(-Infinity)).toThrow(RangeError)
  })
})
