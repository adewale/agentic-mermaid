// Property fuzz for synthesizeFromGraph — the untrusted-JSON rehydration boundary behind
// `am serialize`, the batch `serialize` op, and Code Mode. It re-hydrates a diagram from a
// JSON payload (the `am parse` output shape). It DECLARES a Result return, so its contract is:
// total — never throw on ANY payload, always return a tagged {ok}. Before the fix, malformed
// (but valid-JSON) payloads threw: `am serialize` surfaced them as exit 4 (and exit 0 on
// `null`), bypassing the clean `!ok` → exit 2 error path. Seed pinned globally
// (fc-seed.preload.ts); AM_FC_SEED=random hunts fresh counterexamples.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { synthesizeFromGraph, serializeMermaid, parseMermaid, createMermaid } from '../agent/index.ts'
import type { DiagramKind } from '../agent/types.ts'

const NUM_RUNS = 400

const FAMILIES: DiagramKind[] = [
  'flowchart', 'state', 'sequence', 'timeline', 'class', 'er', 'journey', 'architecture',
  'xychart', 'pie', 'quadrant', 'gantt', 'mindmap', 'gitgraph', 'radar',
]
// Real payloads (the `am parse` JSON shape) for every family — the round-trip seed corpus.
const REAL_PAYLOADS = FAMILIES.map(fam => JSON.parse(JSON.stringify(createMermaid(fam))))

const junkValue = fc.oneof(
  fc.string({ maxLength: 12 }), fc.integer(), fc.double(), fc.boolean(),
  fc.constant(null), fc.constant(undefined),
  fc.array(fc.oneof(fc.string({ maxLength: 6 }), fc.integer()), { maxLength: 4 }),
  fc.object({ maxDepth: 2 }),
)
// Graph shapes chosen to hit the flowchart rehydration paths that used to throw:
// non-tuple node arrays, null/number node maps, object node maps, missing graph.
const graphArb = fc.oneof(
  fc.constant(undefined), fc.constant(null), fc.constant({}),
  fc.record({ nodes: fc.oneof(fc.integer(), fc.array(junkValue, { maxLength: 4 }), fc.object({ maxDepth: 1 })), edges: junkValue }, { requiredKeys: [] }),
  fc.record({ nodes: fc.array(fc.tuple(fc.string({ maxLength: 4 }), fc.object({ maxDepth: 1 })), { maxLength: 3 }) }),
)
const bodyArb = fc.oneof(
  fc.constant(undefined), junkValue,
  fc.record({ kind: fc.oneof(fc.constantFrom(...FAMILIES, 'opaque', 'toString', '__proto__', 'nope'), junkValue), graph: graphArb }, { requiredKeys: [] }),
)
const payloadArb = fc.oneof(
  fc.anything(),
  fc.record({ kind: fc.oneof(fc.constantFrom(...FAMILIES), fc.string({ maxLength: 6 })), body: bodyArb, meta: fc.oneof(fc.constant(undefined), fc.object({ maxDepth: 1 })) }, { requiredKeys: [] }),
  // A real payload with one corrupted top-level field.
  fc.tuple(fc.constantFrom(...REAL_PAYLOADS), fc.constantFrom('kind', 'body', 'meta'), junkValue).map(([base, key, v]) => ({ ...base, [key]: v })),
)

describe('synthesize fuzz: synthesizeFromGraph is total and deterministic', () => {
  it('never throws on any payload; always returns a tagged Result', () => {
    fc.assert(fc.property(payloadArb, payload => {
      const r = synthesizeFromGraph(payload as never)
      expect(typeof r.ok).toBe('boolean')
      if (r.ok) {
        // A successful rebuild must serialize to a string (no half-built body).
        expect(typeof serializeMermaid(r.value)).toBe('string')
      } else {
        expect(Array.isArray(r.error)).toBe(true)
        expect(r.error.length).toBeGreaterThan(0)
        expect(typeof r.error[0]!.message).toBe('string')
      }
    }), { numRuns: NUM_RUNS })
  })

  it('is deterministic for identical input', () => {
    fc.assert(fc.property(payloadArb, payload => {
      expect(JSON.stringify(synthesizeFromGraph(payload as never))).toBe(JSON.stringify(synthesizeFromGraph(payload as never)))
    }), { numRuns: NUM_RUNS })
  })
})

// A minimal createMermaid(fam) is a non-degenerate diagram for every family EXCEPT radar,
// whose empty base (no axes) is not a serializable radar — so it is legitimately not
// round-trippable and is exercised only by the crash-freedom/determinism suites above. Round-
// trip is asserted for the payloads synthesizeFromGraph actually accepts.
const ROUND_TRIP_PAYLOADS = REAL_PAYLOADS.filter(p => synthesizeFromGraph(p as never).ok)

describe('synthesize fuzz: real payloads round-trip', () => {
  it('a parsed diagram survives parse -> JSON -> synthesizeFromGraph -> serialize', () => {
    // Guard against silently dropping the whole corpus: at least the graph families must synthesize.
    expect(ROUND_TRIP_PAYLOADS.length).toBeGreaterThanOrEqual(FAMILIES.length - 1)
    fc.assert(fc.property(fc.constantFrom(...ROUND_TRIP_PAYLOADS), payload => {
      const r = synthesizeFromGraph(payload as never)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const source = serializeMermaid(r.value)
      const reparsed = parseMermaid(source)
      expect(reparsed.ok).toBe(true)
      if (reparsed.ok) expect(reparsed.value.kind).toBe(r.value.kind)
    }), { numRuns: ROUND_TRIP_PAYLOADS.length })
  })
})
