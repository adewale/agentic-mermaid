// Core agent surface: parse, serialize, mutate (flowchart + sequence),
// verify, round-trip, sequence fidelity fallback, synthesizeFromGraph, Finite.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asFlowchart, asSequence, toFinite, WARNING_TIER, WARNING_SEVERITY } from '../agent/types.ts'
import type { FlowchartMutationOp, FlowchartValidDiagram, SequenceValidDiagram } from '../agent/types.ts'

function parse(src: string) {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  return r.value
}
function flowchart(src: string): FlowchartValidDiagram {
  const f = asFlowchart(parse(src)); if (!f) throw new Error('not flowchart'); return f
}
function sequence(src: string): SequenceValidDiagram {
  const s = asSequence(parse(src)); if (!s) throw new Error('not sequence'); return s
}

describe('parseMermaid', () => {
  test('flowchart', () => { expect(parse('flowchart TD\n  A --> B').body.kind).toBe('flowchart') })
  test('frontmatter into meta', () => {
    expect(parse('---\ntitle: T\n---\nflowchart TD\n  A --> B').meta.frontmatter?.title).toBe('T')
  })
  test('init directive captured', () => {
    expect(parse('%%{init: {"theme":"forest"}}%%\nflowchart TD\n  A --> B').meta.initDirectives[0]!.parsed.theme).toBe('forest')
  })
  test('accTitle/accDescr', () => {
    const d = parse('flowchart TD\n  accTitle: T\n  accDescr: D\n  A --> B')
    expect(d.meta.accessibility.title).toBe('T'); expect(d.meta.accessibility.descr).toBe('D')
  })
  test('empty source errors', () => { expect(parseMermaid('').ok).toBe(false) })
  test('unknown header errors', () => {
    const r = parseMermaid('notADiagram\n X'); expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error[0]!.code).toBe('UNKNOWN_HEADER')
  })
  test('class/er/timeline stay opaque', () => {
    for (const [s, k] of [['classDiagram\n  A <|-- B','class'],['erDiagram\n  A ||--o{ B : x','er'],['timeline\n  2020 : A','timeline']] as const) {
      const d = parse(s); expect(d.kind).toBe(k); expect(d.body.kind).toBe('opaque')
    }
  })
})

describe('sequence parsing — structured', () => {
  test('simple messages → structured body', () => {
    const d = parse('sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello')
    expect(d.body.kind).toBe('sequence')
    if (d.body.kind !== 'sequence') return
    expect(d.body.participants.map(p => p.id)).toEqual(['Alice', 'Bob'])
    expect(d.body.messages.map(m => m.style)).toEqual(['sync', 'reply'])
  })
  test('participant/actor + alias', () => {
    const d = parse('sequenceDiagram\n  participant A as Alice\n  actor B as Bob\n  A->>B: Hi')
    if (d.body.kind !== 'sequence') throw new Error('expected sequence')
    expect(d.body.participants[0]).toEqual({ id: 'A', label: 'Alice', kind: 'participant' })
    expect(d.body.participants[1]).toEqual({ id: 'B', label: 'Bob', kind: 'actor' })
  })
})

describe('sequence fidelity fallback (THE v4 fix — never lossy)', () => {
  const COMPLEX = [
    'sequenceDiagram\n  Alice->>Bob: Hi\n  Note over Alice: thinking',
    'sequenceDiagram\n  alt success\n    A->>B: ok\n  else failure\n    A->>B: no\n  end',
    'sequenceDiagram\n  loop every minute\n    A->>B: poll\n  end',
    'sequenceDiagram\n  activate Bob\n  A->>B: x\n  deactivate Bob',
    'sequenceDiagram\n  autonumber\n  A->>B: x',
  ]
  for (const src of COMPLEX) {
    test(`falls back to opaque: ${src.split('\n')[1]!.trim()}`, () => {
      const d = parse(src)
      expect(d.kind).toBe('sequence')
      expect(d.body.kind).toBe('opaque')             // not structured
      expect(asSequence(d)).toBeNull()               // mutation not offered
      // Lossless: serialize re-emits the canonical source verbatim, and a
      // re-parse yields the same canonicalSource. Nothing dropped.
      const out = serializeMermaid(d)
      const d2 = parse(out)
      expect(d2.canonicalSource).toBe(d.canonicalSource)
      // And the Note / alt / loop content survives.
      expect(out).toContain(src.split('\n').slice(1).map(l => l.trim()).find(l => l && !l.includes('->'))!)
    })
  }
})

describe('flowchart mutate — six ops', () => {
  test('add_node', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_node', id: 'C', label: 'Cache' })
    expect(r.ok && r.value.body.graph.nodes.has('C')).toBe(true)
  })
  test('add_node duplicate rejected', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_node', id: 'A', label: 'X' })
    expect(!r.ok && r.error.code).toBe('DUPLICATE_NODE')
  })
  test('remove_node cascades', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B\n  B --> C'), { kind: 'remove_node', id: 'B' })
    expect(r.ok && r.value.body.graph.edges.length).toBe(0)
  })
  test('rename_node updates edges', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'rename_node', from: 'B', to: 'M' })
    expect(r.ok && r.value.body.graph.edges[0]!.target).toBe('M')
  })
  test('set_label node', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'set_label', target: 'A', label: 'Alpha' })
    expect(r.ok && r.value.body.graph.nodes.get('A')!.label).toBe('Alpha')
  })
  test('add_edge implicit nodes', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'add_edge', from: 'C', to: 'D' })
    expect(r.ok && r.value.body.graph.nodes.has('C') && r.value.body.graph.nodes.has('D')).toBe(true)
  })
  test('remove_edge', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B\n  B --> C'), { kind: 'remove_edge', id: 'A->B' })
    expect(r.ok && r.value.body.graph.edges.length).toBe(1)
  })
  test('remove_edge missing id', () => {
    const r = mutate(flowchart('flowchart TD\n  A --> B'), { kind: 'remove_edge', id: 'Z->Y' })
    expect(!r.ok && r.error.code).toBe('EDGE_NOT_FOUND')
  })
  test('input not mutated', () => {
    const f = flowchart('flowchart TD\n  A --> B')
    const before = [...f.body.graph.nodes.keys()].sort()
    mutate(f, { kind: 'add_node', id: 'C', label: 'C' })
    expect([...f.body.graph.nodes.keys()].sort()).toEqual(before)
  })
})

describe('sequence mutate — five ops', () => {
  test('add_participant', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), { kind: 'add_participant', id: 'C', label: 'Charlie' })
    expect(r.ok && r.value.body.participants.some(p => p.id === 'C' && p.label === 'Charlie')).toBe(true)
  })
  test('add_participant duplicate', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), { kind: 'add_participant', id: 'A' })
    expect(!r.ok && r.error.code).toBe('DUPLICATE_PARTICIPANT')
  })
  test('remove_participant cascades to messages', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi\n  B-->>A: Hello\n  A->>C: Bye'), { kind: 'remove_participant', id: 'B' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.participants.some(p => p.id === 'B')).toBe(false)
    expect(r.value.body.messages.length).toBe(1)
  })
  test('add_message implicit participants', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), { kind: 'add_message', from: 'C', to: 'D', text: 'New' })
    expect(r.ok && r.value.body.participants.map(p => p.id).includes('C')).toBe(true)
  })
  test('remove_message by index', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: First\n  B-->>A: Second'), { kind: 'remove_message', index: 0 })
    expect(r.ok && r.value.body.messages[0]!.text).toBe('Second')
  })
  test('set_message_text', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), { kind: 'set_message_text', index: 0, text: 'Yo' })
    expect(r.ok && r.value.body.messages[0]!.text).toBe('Yo')
  })
  test('index out of bounds', () => {
    const r = mutate(sequence('sequenceDiagram\n  A->>B: Hi'), { kind: 'remove_message', index: 9 })
    expect(!r.ok && r.error.code).toBe('MESSAGE_NOT_FOUND')
  })
})

describe('round-trip stability', () => {
  const corpus = [
    'flowchart TD\n  A --> B',
    'flowchart LR\n  A[Alpha] --> B[Beta]',
    'flowchart TD\n  A{D} --> B[Yes]\n  A --> C[No]',
    'flowchart TD\n  A((S)) --> B[Step]\n  B --> C((E))',
    '---\ntitle: T\n---\nflowchart TD\n  A --> B',
    'sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello',
    'sequenceDiagram\n  participant A as Alice\n  A->>B: Hi',
  ]
  for (const src of corpus) {
    test(`stable: ${src.split('\n')[0]} ...`, () => {
      const d = parse(src); const s1 = serializeMermaid(d)
      const d2 = parse(s1); expect(serializeMermaid(d2)).toBe(s1)
    })
  }
  test('edge styles + markers preserved', () => {
    for (const e of ['-->', '---', '--o', '--x', '<-->', '-.->', '-.-', '==>', '===']) {
      const src = `flowchart TD\n  A ${e} B`
      const d = parse(src); const out = serializeMermaid(d)
      expect(serializeMermaid(parse(out))).toBe(out)
    }
  })
  test('property: random flowchart mutation chains stay parseable', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        kind: fc.constantFrom('add_node', 'add_edge'),
        id: fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[A-Za-z][A-Za-z0-9]*$/.test(s)),
        label: fc.string({ minLength: 0, maxLength: 10 }).filter(s => !/[\[\]{}()<>|"]/.test(s)),
        from: fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[A-Za-z][A-Za-z0-9]*$/.test(s)),
        to: fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[A-Za-z][A-Za-z0-9]*$/.test(s)),
      }), { maxLength: 6 }),
      ops => {
        const f = asFlowchart(parse('flowchart TD\n  A --> B')); if (!f) return true
        let d = f
        for (const o of ops) {
          const op: FlowchartMutationOp = o.kind === 'add_node'
            ? { kind: 'add_node', id: o.id, label: o.label || o.id }
            : { kind: 'add_edge', from: o.from, to: o.to }
          const next = mutate(d, op); if (next.ok) d = next.value
        }
        return parseMermaid(serializeMermaid(d)).ok
      },
    ), { numRuns: 100 })
  })
})

describe('synthesizeFromGraph', () => {
  test('flowchart payload round-trips without canonicalSource', () => {
    const d = parse('flowchart TD\n  A[Alpha] --> B[Beta]')
    if (d.body.kind !== 'flowchart') throw new Error('x')
    const r = synthesizeFromGraph({
      kind: 'flowchart', meta: d.meta,
      body: { kind: 'flowchart', graph: {
        direction: d.body.graph.direction,
        nodes: Object.fromEntries(d.body.graph.nodes),
        edges: d.body.graph.edges, subgraphs: d.body.graph.subgraphs,
      } },
    })
    expect(r.ok && r.value.canonicalSource.includes('A[Alpha] --> B[Beta]')).toBe(true)
  })
  test('sequence payload', () => {
    const r = synthesizeFromGraph({
      kind: 'sequence',
      body: { kind: 'sequence', participants: [{ id: 'A', label: 'A', kind: 'participant' }, { id: 'B', label: 'B', kind: 'participant' }], messages: [{ from: 'A', to: 'B', text: 'Hi', style: 'sync' }] },
    })
    expect(r.ok && r.value.canonicalSource.includes('A->>B: Hi')).toBe(true)
  })
})

describe('verify', () => {
  test('clean flowchart ok', () => { expect(verifyMermaid('flowchart TD\n  A --> B').ok).toBe(true) })
  test('EMPTY_DIAGRAM', () => {
    const r = verifyMermaid(''); expect(r.ok).toBe(false)
    expect(r.warnings.some(w => w.code === 'EMPTY_DIAGRAM')).toBe(true)
  })
  test('LABEL_OVERFLOW source-based, reliable', () => {
    const r = verifyMermaid(`flowchart TD\n  A[${'X'.repeat(60)}] --> B`)
    const o = r.warnings.find(w => w.code === 'LABEL_OVERFLOW')
    expect(o && o.code === 'LABEL_OVERFLOW' && o.charCount === 60 && o.limit === 40).toBe(true)
  })
  test('LABEL_OVERFLOW custom cap', () => {
    expect(verifyMermaid('flowchart TD\n  A[longish] --> B', { labelCharCap: 3 }).warnings.some(w => w.code === 'LABEL_OVERFLOW')).toBe(true)
  })
  test('no LABEL_OVERFLOW for short labels', () => {
    expect(verifyMermaid('flowchart TD\n  A --> B').warnings.some(w => w.code === 'LABEL_OVERFLOW')).toBe(false)
  })
  test('sequence verify EDGE_MISANCHORED impossible via parse (implicit declare); via long text LABEL_OVERFLOW fires', () => {
    expect(verifyMermaid(`sequenceDiagram\n  A->>B: ${'x'.repeat(60)}`).warnings.some(w => w.code === 'LABEL_OVERFLOW')).toBe(true)
  })
  test('suppress filter', () => {
    expect(verifyMermaid('flowchart TD\n  A --> B', { suppress: ['NODE_OVERLAP', 'ROUTE_SELF_CROSS'] }).warnings.some(w => w.code === 'NODE_OVERLAP')).toBe(false)
  })
  test('finite coordinates only', () => {
    const flat = JSON.stringify(verifyMermaid('flowchart TD\n  A --> B\n  B --> C').layout)
    expect(flat).not.toContain('NaN'); expect(flat).not.toContain('Infinity')
  })
  test('no seed field on layout', () => {
    expect('seed' in verifyMermaid('flowchart TD\n  A --> B').layout).toBe(false)
  })
})

describe('warning vocabulary', () => {
  test('8 codes, all tiered + severity', () => {
    const codes = Object.keys(WARNING_SEVERITY)
    expect(codes.length).toBe(8)
    for (const c of codes) {
      expect(WARNING_SEVERITY[c as keyof typeof WARNING_SEVERITY]).toMatch(/^(error|warning)$/)
      expect(WARNING_TIER[c as keyof typeof WARNING_TIER]).toMatch(/^(structural|geometric)$/)
    }
  })
  test('LABEL_OVERFLOW is Tier 1', () => { expect(WARNING_TIER.LABEL_OVERFLOW).toBe('structural') })
})

describe('toFinite', () => {
  test('accepts finite', () => { expect(toFinite(3.14)).toBe(3.14 as never) })
  test('throws on NaN', () => { expect(() => toFinite(NaN)).toThrow(RangeError) })
  test('throws on Infinity', () => { expect(() => toFinite(Infinity)).toThrow(RangeError) })
})
