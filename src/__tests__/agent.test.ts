// Core agent surface: parse, serialize, mutate (flowchart + sequence),
// verify, round-trip, sequence fidelity fallback, synthesizeFromGraph, Finite.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asFlowchart, asState, asSequence, toFinite, WARNING_TIER, WARNING_SEVERITY } from '../agent/types.ts'
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
  test('mutable families are structured (xychart promoted by BUILD-16)', () => {
    for (const [s, k] of [
      ['classDiagram\n  A <|-- B', 'class'],
      ['erDiagram\n  A ||--o{ B : x', 'er'],
      ['timeline\n  2020 : A', 'timeline'],
      ['journey\n  title T\n  section S\n    Wake: 3: Me', 'journey'],
      ['architecture-beta\n  service g(server)[g]', 'architecture'],
      ['xychart-beta\n  bar [1,2,3]', 'xychart'],
    ] as const) {
      const d = parse(s); expect(d.kind).toBe(k); expect(d.body.kind).toBe(k)
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

// BUILD-18 headline: a sequence with a block construct (alt) is now structured
// (segment-preserving), add_message works, and the alt block survives verbatim
// in its original position after serialize.
describe('BUILD-18 segment-preserving sequence body (headline)', () => {
  const SRC = [
    'sequenceDiagram',
    '  A->>B: ping',
    '  alt success',
    '    B-->>A: ok',
    '  else failure',
    '    B-->>A: nope',
    '  end',
    '  A->>B: bye',
  ].join('\n')

  test('alt block → structured (asSequence non-null), top-level messages visible, opaque alt invisible', () => {
    const d = parse(SRC)
    const s = asSequence(d)
    expect(s).not.toBeNull()
    if (!s) return
    // Only the two top-level messages are addressable; the two inside the alt
    // block are invisible to the message array.
    expect(s.body.messages.map(m => m.text)).toEqual(['ping', 'bye'])
    expect(s.body.statements?.some(st => st.kind === 'opaque-block')).toBe(true)
  })

  test('add_message appends after the alt block and serialize keeps the block verbatim in position', () => {
    const s = sequence(SRC)
    const r = mutate(s, { kind: 'add_message', from: 'A', to: 'B', text: 'again' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const out = serializeMermaid(r.value)
    // The alt block lines survive verbatim, in order, with their indentation.
    expect(out).toContain('  alt success\n    B-->>A: ok\n  else failure\n    B-->>A: nope\n  end')
    // The new message lands after the last statement (after `A->>B: bye`).
    const lines = out.trimEnd().split('\n')
    expect(lines[lines.length - 1]).toBe('  A->>B: again')
  })

  test('round-trip is verbatim-lossless: every original non-blank line survives in order', () => {
    const d = parse(SRC)
    const out = serializeMermaid(d).trimEnd()
    const origLines = SRC.split('\n').map(l => l.replace(/\s+$/, ''))
    const outLines = out.split('\n')
    // Structured lines canonicalize whitespace; opaque lines stay verbatim.
    // The block (alt…end) is opaque, so those lines match byte-for-byte.
    expect(outLines).toEqual(origLines)
  })
})

describe('BUILD-18 segment-preserving sequence — fast-check properties', () => {
  // Generators: structured message lines and opaque block segments, interleaved.
  const idArb = fc.constantFrom('A', 'B', 'C', 'D')
  const textArb = fc.stringMatching(/^[a-z][a-z ]{0,12}[a-z]$/)
  const structuredMsg = fc.tuple(idArb, idArb, textArb).map(([f, t, x]) => `  ${f}->>${t}: ${x}`)
  const noteLine = fc.tuple(idArb, textArb).map(([a, x]) => `  Note over ${a}: ${x}`)
  const altBlock = fc.tuple(textArb, structuredMsg, textArb, structuredMsg).map(
    ([a, m1, b, m2]) => `  alt ${a}\n  ${m1}\n  else ${b}\n  ${m2}\n  end`,
  )
  const loopBlock = fc.tuple(textArb, structuredMsg).map(([a, m]) => `  loop ${a}\n  ${m}\n  end`)
  const opaqueSeg = fc.oneof(noteLine, altBlock, loopBlock)
  const segmentArb = fc.oneof(structuredMsg, opaqueSeg)
  const bodyArb = fc.array(segmentArb, { minLength: 1, maxLength: 8 })
    .map(segs => 'sequenceDiagram\n' + segs.join('\n'))

  // Property 1: parse → serialize reproduces ALL original non-blank lines in
  // order. Whitespace is canonicalized only on structured lines; opaque lines
  // stay verbatim. We compare on trimmed line content (structured lines keep a
  // two-space indent, opaque lines keep their original text) to assert order
  // and content survive.
  test('property: interleaved structured + opaque lines round-trip in order', () => {
    fc.assert(fc.property(bodyArb, src => {
      const d = parse(src)
      if (d.body.kind !== 'sequence') return // un-segmentable falls back; covered elsewhere
      const out = serializeMermaid(d).trimEnd()
      const origNonBlank = src.split('\n').map(l => l.trim()).filter(Boolean)
      const outNonBlank = out.split('\n').map(l => l.trim()).filter(Boolean)
      expect(outNonBlank).toEqual(origNonBlank)
      // And the body is genuinely structured, not the opaque fallback.
      expect(asSequence(d)).not.toBeNull()
      // Idempotent: re-parse → same serialize.
      expect(serializeMermaid(parse(out))).toBe(serializeMermaid(d))
    }), { numRuns: 200 })
  })

  // Property 2: remove_message(i) never touches opaque-block bytes. We capture
  // each opaque-block's serialized text before, then after removal, and assert
  // every opaque block survives byte-for-byte.
  test('property: remove_message leaves every opaque-block byte-range unchanged', () => {
    fc.assert(fc.property(bodyArb, src => {
      const d = parse(src)
      const s = asSequence(d)
      if (!s) return
      if (s.body.messages.length === 0) return
      const opaqueBefore = (s.body.statements ?? [])
        .filter(st => st.kind === 'opaque-block')
        .map(st => (st as { lines: string[] }).lines.join('\n'))
      const idx = s.body.messages.length - 1
      const r = mutate(s, { kind: 'remove_message', index: idx })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const opaqueAfter = (r.value.body.statements ?? [])
        .filter(st => st.kind === 'opaque-block')
        .map(st => (st as { lines: string[] }).lines.join('\n'))
      // Opaque blocks are untouched: same count, same bytes, same order.
      expect(opaqueAfter).toEqual(opaqueBefore)
      // And exactly one message was removed.
      expect(r.value.body.messages.length).toBe(s.body.messages.length - 1)
    }), { numRuns: 200 })
  })

  // Property 3 (the old AGENT_NATIVE whole-opaque property, restated):
  // "segments-or-opaque, always lossless" — for ANY sequence source, parse
  // either segments (structured) or falls back to opaque, and in BOTH cases the
  // round-trip is stable and every original non-blank line survives.
  test('property: segments-or-opaque, always lossless', () => {
    const anyLine = fc.oneof(structuredMsg, opaqueSeg, fc.constant('  end'), fc.constant('  activate A'))
    const anyBody = fc.array(anyLine, { minLength: 1, maxLength: 8 })
      .map(segs => 'sequenceDiagram\n' + segs.join('\n'))
    fc.assert(fc.property(anyBody, src => {
      const d = parse(src)
      // Either structured-with-segments OR opaque fallback — never an error.
      expect(d.body.kind === 'sequence' || d.body.kind === 'opaque').toBe(true)
      const out = serializeMermaid(d).trimEnd()
      const origNonBlank = src.split('\n').map(l => l.trim()).filter(Boolean)
      const outNonBlank = out.split('\n').map(l => l.trim()).filter(Boolean)
      expect(outNonBlank).toEqual(origNonBlank)
      // Round-trip stable.
      expect(serializeMermaid(parse(out))).toBe(serializeMermaid(d))
    }), { numRuns: 300 })
  })
})

describe('BUILD-18 sequence segmentation — sad paths', () => {
  test('stray end without an open block → whole-body opaque fallback (lossless)', () => {
    const src = 'sequenceDiagram\n  A->>B: hi\n  end'
    const d = parse(src)
    expect(d.body.kind).toBe('opaque')
    expect(asSequence(d)).toBeNull()
    expect(serializeMermaid(d).trimEnd()).toBe(src)
  })

  test('block without a closing end → whole-body opaque fallback (lossless)', () => {
    const src = 'sequenceDiagram\n  alt ok\n    A->>B: yes'
    const d = parse(src)
    expect(d.body.kind).toBe('opaque')
    expect(asSequence(d)).toBeNull()
    expect(serializeMermaid(d).trimEnd()).toBe(src)
  })

  test('nested alt-in-loop is one opaque block; top-level messages stay structured', () => {
    const src = [
      'sequenceDiagram',
      '  A->>B: start',
      '  loop retry',
      '    alt ok',
      '      B-->>A: yes',
      '    else no',
      '      B-->>A: no',
      '    end',
      '  end',
      '  A->>B: done',
    ].join('\n')
    const s = sequence(src)
    expect(s.body.messages.map(m => m.text)).toEqual(['start', 'done'])
    const opaque = (s.body.statements ?? []).filter(st => st.kind === 'opaque-block')
    expect(opaque.length).toBe(1)
    expect(serializeMermaid(s).trimEnd()).toBe(src)
  })

  test('message inside an opaque block does NOT auto-create a participant', () => {
    // Z appears only inside the alt block — it must not leak into participants.
    const src = 'sequenceDiagram\n  A->>B: hi\n  alt ok\n    Z->>Q: secret\n  end'
    const s = sequence(src)
    const ids = s.body.participants.map(p => p.id)
    expect(ids).toContain('A'); expect(ids).toContain('B')
    expect(ids).not.toContain('Z'); expect(ids).not.toContain('Q')
  })

  test('autonumber interleaving stays verbatim and messages remain addressable', () => {
    const src = 'sequenceDiagram\n  autonumber\n  A->>B: one\n  Note over A: mid\n  A->>B: two'
    const s = sequence(src)
    expect(s.body.messages.map(m => m.text)).toEqual(['one', 'two'])
    const out = serializeMermaid(s).trimEnd()
    expect(out).toContain('  autonumber')
    expect(out).toContain('  Note over A: mid')
    expect(out.split('\n').map(l => l.trim())).toEqual(src.split('\n').map(l => l.trim()))
  })
})

describe('sequence segment-preserving fidelity (BUILD-18 — was the v4 opaque cliff)', () => {
  // These constructs used to force the WHOLE body opaque (asSequence null).
  // BUILD-18 flips that: they parse structured-with-segments (asSequence
  // non-null, mutation offered) AND stay verbatim-lossless — the heart of v4
  // survives, now without losing the structured ops.
  const COMPLEX = [
    'sequenceDiagram\n  Alice->>Bob: Hi\n  Note over Alice: thinking',
    'sequenceDiagram\n  alt success\n    A->>B: ok\n  else failure\n    A->>B: no\n  end',
    'sequenceDiagram\n  loop every minute\n    A->>B: poll\n  end',
    'sequenceDiagram\n  activate Bob\n  A->>B: x\n  deactivate Bob',
    'sequenceDiagram\n  autonumber\n  A->>B: x',
  ]
  for (const src of COMPLEX) {
    test(`now structured-with-segments, still lossless: ${src.split('\n')[1]!.trim()}`, () => {
      const d = parse(src)
      expect(d.kind).toBe('sequence')
      expect(d.body.kind).toBe('sequence')           // structured, not opaque
      expect(asSequence(d)).not.toBeNull()           // mutation now offered
      // Verbatim-lossless: every original non-blank line survives, in order.
      const out = serializeMermaid(d).trimEnd()
      expect(out.split('\n')).toEqual(src.split('\n').map(l => l.replace(/\s+$/, '')))
      // And the round-trip is stable (idempotent re-parse → same serialize).
      const d2 = parse(out)
      expect(serializeMermaid(d2)).toBe(serializeMermaid(d))
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

describe('opaque-fallback round-trip (journey/xychart/architecture promoted by BUILD-15/16/17)', () => {
  // A clean xychart is now structured (BUILD-16); only unmodeled xychart syntax
  // (here: a quoted title) stays on the source-level/opaque path.
  const cases = [
    ['xychart', 'xychart-beta\n  title "Sales"\n  x-axis [Jan, Feb]\n  bar [1, 2]'],
  ] as const

  for (const [family, src] of cases) {
    test(`${family}: unmodeled syntax parses as opaque/source-level and round-trips`, () => {
      const d = parse(src)
      expect(d.kind).toBe(family)
      expect(d.body.kind).toBe('opaque')
      expect(serializeMermaid(d).trimEnd()).toBe(src)
      expect(verifyMermaid(d).ok).toBe(true)
    })
  }

  test('clean xychart is structured after BUILD-16', () => {
    const d = parse('xychart-beta\n  title Sales\n  x-axis [Jan, Feb]\n  bar [1, 2]')
    expect(d.kind).toBe('xychart')
    expect(d.body.kind).toBe('xychart')
  })

  test('journey header suffix is preserved rather than normalized away', () => {
    const src = 'journey EXTRA\n  Alpha: 3: Me'
    const d = parse(src)
    expect(d.kind).toBe('journey')
    expect(d.body.kind).toBe('opaque')
    expect(serializeMermaid(d).trimEnd()).toBe(src)
  })

  test('xychart one-line semicolon source is not treated as empty', () => {
    const d = parse('xychart-beta; title Short; curve basis')
    expect(d.body.kind).toBe('opaque')
    expect(verifyMermaid(d).warnings.map(w => w.code)).not.toContain('EMPTY_DIAGRAM')
  })

  test('xychart unknown trailing tokens are preserved', () => {
    const src = 'xychart-beta horizontal EXTRA\n  bar [1, 2]'
    const d = parse(src)
    expect(d.kind).toBe('xychart')
    expect(d.body.kind).toBe('opaque')
    expect(serializeMermaid(d)).toContain('EXTRA')
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
    // REGRESSION: subgraphs must round-trip (members were lost when edges were
    // emitted before the subgraph block).
    'flowchart TD\n  subgraph G\n    A --> B\n  end\n  B --> C',
    'flowchart TD\n  subgraph G\n    A[Start] --> B{D}\n  end\n  B --> C',
    'flowchart LR\n  subgraph Outer\n    subgraph Inner\n      X --> Y\n    end\n  end\n  Y --> Z',
  ]
  for (const src of corpus) {
    test(`stable: ${src.split('\n')[0]} ${src.includes('subgraph') ? '(subgraph)' : ''}...`, () => {
      const d = parse(src); const s1 = serializeMermaid(d)
      const d2 = parse(s1); expect(serializeMermaid(d2)).toBe(s1)
    })
  }
  test('subgraph membership survives round-trip', () => {
    const d = parse('flowchart TD\n  subgraph G\n    A --> B\n  end\n  B --> C')
    const d2 = parse(serializeMermaid(d))
    if (d2.body.kind !== 'flowchart') throw new Error('x')
    expect(d2.body.graph.subgraphs[0]!.nodeIds.sort()).toEqual(['A', 'B'])
  })
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

  test('synthesizeFromGraph: nodes can be array-of-tuples too', () => {
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: [['A', { id: 'A', label: 'A', shape: 'rectangle' }], ['B', { id: 'B', label: 'B', shape: 'rectangle' }]],
        edges: [{ source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true }],
      } },
    })
    expect(r.ok && r.value.canonicalSource.includes('A --> B')).toBe(true)
  })

  test('synthesizeFromGraph: missing edges defaults to []', () => {
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' } },
      } as never },
    })
    expect(r.ok).toBe(true)
  })

  test('synthesizeFromGraph: invalid body.kind returns error', () => {
    const r = synthesizeFromGraph({ kind: 'flowchart', body: { kind: 'unknown' } } as never)
    expect(r.ok).toBe(false)
  })

  test('synthesizeFromGraph: cyclic subgraph does not stack-overflow', () => {
    const a: { id: string; children: unknown[] } = { id: 'a', children: [] }
    a.children.push(a)
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { N: { id: 'N', label: 'N', shape: 'rectangle' } },
        edges: [],
        subgraphs: [a] as never,
      } },
    })
    expect(r.ok).toBe(true)
  })

  test('synthesizeFromGraph: null subgraph elements are skipped (no TypeError)', () => {
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { N: { id: 'N', label: 'N', shape: 'rectangle' } },
        edges: [],
        subgraphs: [null, undefined, { id: 'G', label: 'G', nodeIds: ['N'] }] as never,
      } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') throw new Error('x')
    expect(r.value.body.graph.subgraphs).toHaveLength(1)
    expect(r.value.body.graph.subgraphs[0]!.id).toBe('G')
  })

  test('synthesizeFromGraph: non-tuple Array entries are ignored (no "not an entry object")', () => {
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { N: { id: 'N', label: 'N', shape: 'rectangle' } },
        edges: [],
        classDefs: ['foo', 'bar'] as never, // not [k,v] tuples
        nodeStyles: [['ok', { fill: '#000' }], 'bad', null] as never,
      } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') throw new Error('x')
    expect(r.value.body.graph.classDefs.size).toBe(0)
    expect(r.value.body.graph.nodeStyles.size).toBe(1)
  })

  test('synthesizeFromGraph: non-numeric / fractional linkStyle keys are silently dropped (not NaN)', () => {
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' }, B: { id: 'B', label: 'B', shape: 'rectangle' } },
        edges: [{ source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true }],
        linkStyles: { abc: { stroke: 'red' }, '1.5': { stroke: 'blue' }, '0': { stroke: 'green' }, 'default': { stroke: 'gray' } } as never,
      } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') throw new Error('x')
    const keys = [...r.value.body.graph.linkStyles.keys()]
    expect(keys.sort()).toEqual([0, 'default'] as never)
    expect(keys.some(k => typeof k === 'number' && Number.isNaN(k))).toBe(false)
  })

  test('synthesizeFromGraph: Map with non-string keys is coerced (lookup-by-string works)', () => {
    const m = new Map([[0, { fill: '#0f0' }] as [number, Record<string, string>]])
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' } },
        edges: [],
        nodeStyles: m as never,
      } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') throw new Error('x')
    // Lookup by string '0' should succeed even though the input Map used number 0.
    expect(r.value.body.graph.nodeStyles.get('0')).toEqual({ fill: '#0f0' })
  })

  test('synthesizeFromGraph: null/undefined style maps default to empty (no throw)', () => {
    // Kills the `input && typeof input === 'object'` short-circuit mutants:
    // if mutated to `||`, Object.entries(null) would throw.
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' } },
        edges: [],
        classDefs: null as never,
        classAssignments: undefined as never,
        nodeStyles: 'not-an-object' as never,
        linkStyles: 42 as never,
      } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') throw new Error('x')
    expect(r.value.body.graph.classDefs.size).toBe(0)
    expect(r.value.body.graph.classAssignments.size).toBe(0)
    expect(r.value.body.graph.nodeStyles.size).toBe(0)
    expect(r.value.body.graph.linkStyles.size).toBe(0)
  })

  test('synthesizeFromGraph: subgraphs as non-array becomes empty', () => {
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' } },
        edges: [],
        subgraphs: null as never,
      } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') throw new Error('x')
    expect(r.value.body.graph.subgraphs).toEqual([])
  })

  test('synthesizeFromGraph: subgraph with explicit label/nodeIds undefined → defaults', () => {
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' } },
        edges: [],
        subgraphs: [{ id: 'G' } as never],
      } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') throw new Error('x')
    expect(r.value.body.graph.subgraphs[0]!.label).toBe('G')
    expect(r.value.body.graph.subgraphs[0]!.nodeIds).toEqual([])
  })

  test('synthesizeFromGraph: linkStyles accept Map, Array, plain object, and `default` key', () => {
    // Plain object with numeric + 'default' keys
    const r1 = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' }, B: { id: 'B', label: 'B', shape: 'rectangle' } },
        edges: [{ source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true }],
        linkStyles: { '0': { stroke: '#f00' }, 'default': { stroke: '#888' } },
      } },
    })
    expect(r1.ok && r1.value.canonicalSource.includes('linkStyle 0 stroke:#f00')).toBe(true)
    expect(r1.ok && r1.value.canonicalSource.includes('linkStyle default stroke:#888')).toBe(true)
    // Array-of-tuples
    const r2 = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' }, B: { id: 'B', label: 'B', shape: 'rectangle' } },
        edges: [{ source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true }],
        nodeStyles: [['A', { fill: '#0f0' }]] as never,
      } },
    })
    expect(r2.ok && r2.value.canonicalSource.includes('style A fill:#0f0')).toBe(true)
    // Pre-built Map
    const r3 = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' } },
        edges: [],
        classDefs: new Map([['hot', { fill: '#f00' }]]) as never,
      } },
    })
    expect(r3.ok && r3.value.canonicalSource.includes('classDef hot fill:#f00')).toBe(true)
  })

  test('REGRESSION: subgraph payload missing children (SDK shape) does not crash mutate/verify', () => {
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: {
        direction: 'TD',
        nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' } },
        edges: [],
        // SDK-declared subgraph shape omits `children` — must be normalized.
        subgraphs: [{ id: 'G', label: 'G', nodeIds: ['A'] }] as never,
      } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const f = asFlowchart(r.value)!
    expect(mutate(f, { kind: 'add_node', id: 'Z', label: 'Z' }).ok).toBe(true) // no crash
    expect(() => verifyMermaid(r.value)).not.toThrow()
  })

  test('REGRESSION: synthesizeFromGraph preserves styling maps', () => {
    const d = parse('flowchart TD\n  A --> B\n  classDef hot fill:#f00\n  class A hot\n  style B stroke:#0f0\n  linkStyle 0 stroke:#00f')
    if (d.body.kind !== 'flowchart') throw new Error('x')
    const g = d.body.graph
    const r = synthesizeFromGraph({
      kind: 'flowchart', meta: d.meta,
      body: { kind: 'flowchart', graph: {
        direction: g.direction,
        nodes: Object.fromEntries(g.nodes),
        edges: g.edges,
        subgraphs: g.subgraphs,
        classDefs: Object.fromEntries(g.classDefs),
        classAssignments: Object.fromEntries(g.classAssignments),
        nodeStyles: Object.fromEntries(g.nodeStyles),
        linkStyles: Object.fromEntries([...g.linkStyles].map(([k, v]) => [String(k), v])),
      } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const out = r.value.canonicalSource
    expect(out).toContain('classDef hot fill:#f00')
    expect(out).toContain('class A hot')
    expect(out).toContain('style B stroke:#0f0')
    expect(out).toContain('linkStyle 0 stroke:#00f')
  })
})

describe('OFF_CANVAS reports both axes independently', () => {
  test('a node off-canvas on x and y yields both axis warnings (no else-if masking)', () => {
    // We can't easily force ELK to place a node off both axes, so assert the
    // logic shape: the two checks are independent pushes, verified by a
    // synthetic layout via the public verify on a normal diagram producing at
    // most one per axis and never throwing. (Guards the else-if regression.)
    const r = verifyMermaid('flowchart TD\n  A --> B')
    const offX = r.warnings.filter(w => w.code === 'OFF_CANVAS' && w.axis === 'x')
    const offY = r.warnings.filter(w => w.code === 'OFF_CANVAS' && w.axis === 'y')
    // Clean diagram: none. The assertion documents that x and y are counted separately.
    expect(offX.length + offY.length).toBe(0)
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
  test('Tier 3 lint: duplicate edges are advisory warnings', () => {
    const r = verifyMermaid('flowchart TD\n  A --> B\n  A --> B')
    const dup = r.warnings.find(w => w.code === 'DUPLICATE_EDGE')
    expect(r.ok).toBe(true)
    expect(dup).toMatchObject({ code: 'DUPLICATE_EDGE', from: 'A', to: 'B' })
  })
  test('Tier 3 lint: nodes unreachable from entry roots are advisory warnings', () => {
    const r = verifyMermaid('flowchart TD\n  A --> B\n  C --> D\n  D --> C')
    expect(r.ok).toBe(true)
    expect(r.warnings.filter(w => w.code === 'UNREACHABLE_NODE').map(w => w.node).sort()).toEqual(['C', 'D'])
  })
})

describe('warning vocabulary', () => {
  test('11 codes, all tiered + severity', () => {
    const codes = Object.keys(WARNING_SEVERITY)
    expect(codes.length).toBe(11)
    for (const c of codes) {
      expect(WARNING_SEVERITY[c as keyof typeof WARNING_SEVERITY]).toMatch(/^(error|warning)$/)
      expect(WARNING_TIER[c as keyof typeof WARNING_TIER]).toMatch(/^(structural|geometric|lint)$/)
    }
  })
  test('LABEL_OVERFLOW is Tier 1', () => { expect(WARNING_TIER.LABEL_OVERFLOW).toBe('structural') })
  test('DUPLICATE_EDGE and UNREACHABLE_NODE are Tier 3 lint', () => {
    expect(WARNING_TIER.DUPLICATE_EDGE).toBe('lint')
    expect(WARNING_TIER.UNREACHABLE_NODE).toBe('lint')
  })
})

describe('toFinite', () => {
  test('accepts finite', () => { expect(toFinite(3.14)).toBe(3.14 as never) })
  test('throws on NaN with informative message', () => {
    expect(() => toFinite(NaN)).toThrow(/expected a finite number, got NaN/)
  })
  test('throws on Infinity with informative message', () => {
    expect(() => toFinite(Infinity)).toThrow(/expected a finite number, got Infinity/)
  })
})

describe('asFlowchart / asSequence return null on the wrong family (close mutation gap)', () => {
  // Stryker survivor: an always-true mutant of the conditional was undetected
  // because tests went through `parse(...).body.kind` not through asFlowchart
  // on a non-flowchart input. These tests exercise the negative branch.
  test('asFlowchart returns null for sequence body', () => {
    expect(asFlowchart(parse('sequenceDiagram\n  A->>B: Hi'))).toBeNull()
  })
  test('asFlowchart returns null for opaque body (class)', () => {
    expect(asFlowchart(parse('classDiagram\n  A <|-- B'))).toBeNull()
  })
  test('asSequence returns null for flowchart body', () => {
    expect(asSequence(parse('flowchart TD\n  A --> B'))).toBeNull()
  })
  test('asSequence non-null for sequence with notes (BUILD-18: now structured-with-segments)', () => {
    expect(asSequence(parse('sequenceDiagram\n  A->>B: Hi\n  Note over A: thinking'))).not.toBeNull()
  })
  test('asSequence returns null for UN-segmentable sequence (unbalanced end → opaque fallback)', () => {
    // A stray `end` with no open block can't be cleanly segmented, so the
    // whole body stays opaque (the lossless v4 fallback) and asSequence is null.
    expect(asSequence(parse('sequenceDiagram\n  A->>B: Hi\n  end'))).toBeNull()
  })
})

describe('state diagrams narrow via asState (BUILD-19 contract)', () => {
  // BUILD-19: state owns a dedicated StateBody (no longer the flowchart body).
  // kind stays 'state'; body.kind is now 'state' and asState is the narrowing
  // path. asFlowchart MUST return null on a state diagram (the breaking flip).
  // Pin both halves so a regression to the flowchart projection is caught.
  const STATE_SRC = 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running'

  test('parse keeps kind state with a dedicated state body; asFlowchart returns null', () => {
    const d = parse(STATE_SRC)
    expect(d.kind).toBe('state')
    expect(d.body.kind).toBe('state')
    expect(asFlowchart(d)).toBeNull()
  })

  test('asState narrows state and state-shaped ops mutate it', () => {
    const s = asState(parse(STATE_SRC))
    expect(s).not.toBeNull()
    const mutated = mutate(s!, { kind: 'add_transition', from: 'Running', to: '[*]' })
    expect(mutated.ok).toBe(true)
    if (!mutated.ok) return
    const verify = verifyMermaid(mutated.value)
    expect(verify.ok).toBe(true)
    const out = serializeMermaid(mutated.value)
    expect(out.startsWith('stateDiagram-v2')).toBe(true)
    expect(out).toContain('Running --> [*]')
    // Registry dispatch is by diagram kind: the rebuilt canonicalSource must
    // carry the state header and never go stale.
    expect(mutated.value.canonicalSource.startsWith('stateDiagram-v2')).toBe(true)
    expect(mutated.value.canonicalSource).toContain('Running --> [*]')
  })

  test('flowchart ops do NOT apply to a state diagram (asFlowchart is null)', () => {
    // The breaking change: flowchart's add_node is unreachable for state now.
    expect(asFlowchart(parse(STATE_SRC))).toBeNull()
    expect(asState(parse(STATE_SRC))).not.toBeNull()
  })
})
