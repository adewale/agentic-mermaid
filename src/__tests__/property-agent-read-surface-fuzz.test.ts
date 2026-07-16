// Property fuzz for the agent "read" surface — the source-in functions an agent calls to
// inspect a diagram it did not author: describeMermaidSource, describeMermaidFactsSource,
// analyzeMermaidSource, checkMermaidSource, and asciiToMermaid. These take UNTRUSTED strings
// (and, for checkMermaidSource, an untrusted spec). property-crash-freedom covers the parsers;
// this closes the gap that the describe/facts/analyze/check/reverse *readers* had no
// generated-input coverage. Contracts:
//   • total: never throw on any string / any spec — return a value or a tagged Result.
//   • deterministic: two calls on the same input are byte-identical (guards a Date.now()/
//     Math.random() leak into agent-facing output, which cross-run determinism gates on the
//     layout JSON would not catch on these text/JSON readers).
// Seed pinned globally (fc-seed.preload.ts); AM_FC_SEED=random hunts fresh counterexamples.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import {
  describeMermaidSource, describeMermaidFactsSource, analyzeMermaidSource, checkMermaidSource,
  asciiToMermaid, parseRegisteredMermaid as parseMermaid, serializeMermaid, createMermaid,
  describeMermaid, describeMermaidTree, describeMermaidFacts, analyzeMermaid, checkMermaid,
} from '../agent/index.ts'
import type { DiagramKind } from '../agent/types.ts'

const NUM_RUNS = 250

const SPECIAL_CHARS = [
  '[', ']', '{', '}', '(', ')', '<', '>', '|', ':', ';', '-', '=', '.', ',', '!', '?', '@',
  '#', '$', '%', '^', '&', '*', '+', '~', '`', '"', "'", '\\', '/', '\n', '\r', '\t', ' ',
  '\0', '￿', '​', 'é', '☃', '-->', '==>', 'graph', 'end', 'subgraph',
]
const specialStringArb = fc.array(fc.constantFrom(...SPECIAL_CHARS), { maxLength: 60 }).map(c => c.join(''))
const headers = [
  'graph TD', 'flowchart LR', 'stateDiagram-v2', 'sequenceDiagram', 'classDiagram', 'erDiagram',
  'timeline', 'journey', 'architecture-beta', 'xychart-beta', 'pie', 'quadrantChart', 'gantt',
  'mindmap', 'gitGraph',
]
// Header + random body: exercises the "valid-family-then-garbage" path, where readers do real
// projection work rather than bailing at the family-detection gate.
const sourceArb = fc.oneof(
  fc.string({ maxLength: 200 }),
  specialStringArb,
  fc.tuple(fc.constantFrom(...headers), fc.string({ maxLength: 160 })).map(([h, b]) => `${h}\n${b}`),
  fc.tuple(fc.constantFrom(...headers), specialStringArb).map(([h, b]) => `${h}\n${b}`),
)

const specArb = fc.oneof(
  fc.array(fc.string({ maxLength: 20 }), { maxLength: 6 }),
  fc.record({
    include: fc.array(fc.string({ maxLength: 16 }), { maxLength: 4 }),
    exclude: fc.array(fc.string({ maxLength: 16 }), { maxLength: 4 }),
    exact: fc.boolean(),
  }, { requiredKeys: [] }),
  fc.object({ maxDepth: 2 }),
  fc.anything(),
)

// The source-in readers are "safe" APIs: they return a value or a tagged Result for ANY input
// and must NEVER throw (unlike the raw parsers, whose crash-freedom convention tolerates a
// clean Error). So this helper does not swallow throws — a throw fails the property, which is
// exactly how the checkMermaid(null) TypeError was caught.
function assertTotalAndDeterministic<T>(fn: () => T, shape: (v: T) => void): void {
  const first = fn()
  shape(first)
  // Determinism: a second call must be byte-identical (guards a Date.now()/Math.random() leak).
  const second = fn()
  expect(JSON.stringify(second)).toBe(JSON.stringify(first))
}

describe('read-surface fuzz: source readers are total and deterministic', () => {
  it('describeMermaidSource', () => {
    fc.assert(fc.property(sourceArb, src => {
      assertTotalAndDeterministic(() => describeMermaidSource(src), v => expect(typeof v).toBe('string'))
    }), { numRuns: NUM_RUNS })
  })

  it('describeMermaidFactsSource', () => {
    fc.assert(fc.property(sourceArb, src => {
      assertTotalAndDeterministic(() => describeMermaidFactsSource(src), v => {
        expect(typeof v.ok).toBe('boolean')
        if (v.ok) expect(Array.isArray(v.value)).toBe(true)
      })
    }), { numRuns: NUM_RUNS })
  })

  it('analyzeMermaidSource', () => {
    fc.assert(fc.property(sourceArb, src => {
      assertTotalAndDeterministic(() => analyzeMermaidSource(src), v => expect(typeof v.ok).toBe('boolean'))
    }), { numRuns: NUM_RUNS })
  })

  it('checkMermaidSource tolerates an arbitrary spec', () => {
    fc.assert(fc.property(sourceArb, specArb, (src, spec) => {
      assertTotalAndDeterministic(() => checkMermaidSource(src, spec as never), v => {
        expect(typeof v.ok).toBe('boolean')
        if (v.ok) expect(typeof v.value.ok).toBe('boolean')
      })
    }), { numRuns: NUM_RUNS })
  })

  it('asciiToMermaid', () => {
    fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 200 }), specialStringArb), ascii => {
      assertTotalAndDeterministic(() => asciiToMermaid(ascii), v => expect(typeof v.ok).toBe('boolean'))
    }), { numRuns: NUM_RUNS })
  })
})

// A valid diagram per family (created structurally, then serialized to canonical source),
// so the typed readers run their full projection over real content, not just the empty base.
const FAMILIES: DiagramKind[] = [
  'flowchart', 'state', 'sequence', 'timeline', 'class', 'er', 'journey', 'architecture',
  'xychart', 'pie', 'quadrant', 'gantt', 'mindmap', 'gitgraph', 'radar',
]
const CORPUS = FAMILIES.map(fam => serializeMermaid(createMermaid(fam)))

describe('read-surface fuzz: typed readers deterministic over the family corpus', () => {
  it('describe / describeTree / facts / analyze / checkMermaid are byte-stable per diagram', () => {
    fc.assert(fc.property(fc.constantFrom(...CORPUS), specArb, (source, spec) => {
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const d = parsed.value
      // parseMermaid yields structured families or an opaque fallback; the typed readers below
      // require a ValidDiagram (non-opaque). Every CORPUS entry is a structured family anyway.
      if (d.body.kind === 'opaque') return
      const valid = d as never
      expect(describeMermaid(valid)).toBe(describeMermaid(valid))
      expect(JSON.stringify(describeMermaidTree(valid))).toBe(JSON.stringify(describeMermaidTree(valid)))
      expect(describeMermaidFacts(valid)).toEqual(describeMermaidFacts(valid))
      expect(JSON.stringify(analyzeMermaid(valid))).toBe(JSON.stringify(analyzeMermaid(valid)))
      expect(JSON.stringify(checkMermaid(valid, spec as never))).toBe(JSON.stringify(checkMermaid(valid, spec as never)))
    }), { numRuns: NUM_RUNS })
  })
})
