// Property fuzz for synthesizeFromGraph — the untrusted-JSON rehydration boundary behind
// `am serialize`, the batch `serialize` op, and Code Mode. It re-hydrates a diagram from a
// JSON payload (the `am parse` output shape). It DECLARES a Result return, so its contract is:
// total — never throw on ANY payload, always return a tagged {ok}. Before the fix, malformed
// (but valid-JSON) payloads threw: `am serialize` surfaced them as exit 4 (and exit 0 on
// `null`), bypassing the clean `!ok` → exit 2 error path. Seed pinned globally
// (fc-seed.preload.ts); AM_FC_SEED=random hunts fresh counterexamples.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'

import { synthesizeFromGraph, serializeMermaid, parseRegisteredMermaid as parseMermaid, createMermaid, describeMermaidFacts } from '../agent/index.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import type { DiagramKind, ParsedDiagram } from '../agent/types.ts'

const NUM_RUNS = 400

// Every registered built-in family, from the registry (a hand-written list had
// silently left sankey out of this untrusted boundary).
const FAMILIES = BUILTIN_FAMILY_METADATA.map(family => family.id) as DiagramKind[]
/** The `am parse` JSON wire shape: Maps become records, as the CLI's replacer does. */
const toWire = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, v) => v instanceof Map ? Object.fromEntries(v) : v))
// Real payloads (the `am parse` JSON shape) for every family — the round-trip seed corpus.
const REAL_PAYLOADS = FAMILIES.map(fam => ({ family: fam, payload: toWire(createMermaid(fam)) }))

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
  fc.tuple(fc.constantFrom(...REAL_PAYLOADS.map(real => real.payload)), fc.constantFrom('kind', 'body', 'meta'), junkValue).map(([base, key, v]) => ({ ...base, [key]: v })),
)

describe('synthesize fuzz: synthesizeFromGraph is total and deterministic', () => {
  it('never throws on any payload; always returns a tagged Result', () => {
    fc.assert(fc.property(payloadArb, payload => {
      const r = synthesizeFromGraph(payload as never)
      expect(typeof r.ok).toBe('boolean')
      if (r.ok) {
        // A successful rebuild must publish a parseable, family-consistent
        // source rather than a half-built body that merely did not throw.
        const source = serializeMermaid(r.value)
        expect(typeof source).toBe('string')
        const reparsed = parseMermaid(source)
        expect(reparsed.ok).toBe(true)
        if (reparsed.ok) expect(reparsed.value.kind).toBe(r.value.kind)
      } else {
        expect(Array.isArray(r.error)).toBe(true)
        expect(r.error.length).toBeGreaterThan(0)
        expect(typeof r.error[0]!.message).toBe('string')
      }
    }), fcParameters({ numRuns: NUM_RUNS }))
  })

  it('is deterministic for identical input', () => {
    fc.assert(fc.property(payloadArb, payload => {
      expect(JSON.stringify(synthesizeFromGraph(payload as never))).toBe(JSON.stringify(synthesizeFromGraph(payload as never)))
    }), fcParameters({ numRuns: NUM_RUNS }))
  })
})

// `am serialize` rehydrates untrusted JSON (V13). A string field holding
// grammar — a direction `LR; click A href "javascript:…"`, a node id with a
// newline and a statement, an edge to a node nobody declared — used to be
// written verbatim and published as whatever its source re-read as. A payload
// is published only as the diagram it states, or refused.
describe('synthesize fuzz: a forged payload is refused or published as written', () => {
  const SOURCES = [
    'flowchart LR\n  A[Alpha] --> B\n  subgraph G\n    C\n  end\n',
    'sequenceDiagram\n  A->>B: hi\n',
    'stateDiagram-v2\n  S1 --> S2 : go\n',
    'classDiagram\n  class A\n  A <|-- B\n',
    'erDiagram\n  A ||--o{ B : has\n',
    'pie\n  title Pets\n  "Dogs" : 3\n',
    'journey\n  section S\n    Wake: 3: Me\n',
    'timeline\n  2020 : Start\n',
    'sankey-beta\nA,B,1\n',
    'gantt\n  dateFormat YYYY-MM-DD\n  section S\n    T : t1, 2024-01-01, 1d\n',
    'quadrantChart\n  A: [0.3, 0.6]\n',
    'architecture-beta\n  service api(server)[API]\n  service db(database)[DB]\n  api:R --> L:db\n',
    'gitGraph\n  commit id: "a"\n',
  ]
  const payloads = SOURCES.map(source => {
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    return toWire(parsed.value) as { kind: DiagramKind; body: Record<string, unknown> }
  })
  const stringLeaves = (value: unknown, path: Array<string | number>): Array<Array<string | number>> => {
    if (typeof value === 'string') return [path]
    if (!value || typeof value !== 'object') return []
    return Object.entries(value).flatMap(([key, entry]) => stringLeaves(entry, [...path, Array.isArray(value) ? Number(key) : key]))
  }
  const HOSTILE = ['LR; click A href "javascript:alert(1)"', 'A\nclick A call alert(1)', 'Z', 'A[B]', 'A;B', '%%{init: {}}%%', '%%', '"', '\n', ' ', ';', ':', ',', '-->', '|', '[', ']', '{', '}']
  const textArb = fc.oneof(fc.constantFrom(...HOSTILE), fc.string({ unit: 'binary', minLength: 1, maxLength: 8 }), fc.array(fc.constantFrom(...HOSTILE, 'x', ' '), { minLength: 1, maxLength: 4 }).map(parts => parts.join('')))
  const forgedArb = fc.constantFrom(...payloads).chain(payload => fc.tuple(fc.constant(payload), fc.constantFrom(...stringLeaves(payload.body, ['body'])), textArb)).map(([payload, path, text]) => {
    const forged = structuredClone(payload) as Record<string | number, unknown>
    let record = forged
    for (const part of path.slice(0, -1)) record = record[part] as Record<string | number, unknown>
    record[path.at(-1)!] = text
    return forged
  })
  // The payload as the diagram it states: the flowchart graph's records are
  // Maps in memory, as the rehydration rebuilds them.
  const stated = (payload: Record<string | number, unknown>): ParsedDiagram => {
    const diagram = structuredClone(payload) as unknown as ParsedDiagram & { body: { graph?: Record<string, unknown> } }
    const graph = diagram.body.graph
    if (graph) for (const key of ['nodes', 'classDefs', 'classAssignments', 'nodeStyles', 'linkStyles']) graph[key] = new Map(Object.entries((graph[key] ?? {}) as object))
    return diagram
  }
  const EXAMPLES: Array<[Record<string | number, unknown>]> = [
    [(() => { const p = structuredClone(payloads[0]!) as any; p.body.graph.direction = 'LR; click A href "javascript:alert(1)"'; return p })()],
    [(() => { const p = structuredClone(payloads[0]!) as any; p.body.graph.edges[0].target = 'Z'; return p })()],
  ]

  it('a published rehydration states exactly the facts of its payload', () => {
    fc.assert(fc.property(forgedArb, forged => {
      const published = synthesizeFromGraph(forged as never)
      if (!published.ok) {
        expect(published.error[0]!.code).toBe('INVALID_PAYLOAD')
        return
      }
      expect(describeMermaidFacts(published.value)).toEqual(describeMermaidFacts(stated(forged)))
    }), fcParameters({ numRuns: 1500, examples: EXAMPLES }))
  })
})

// A minimal createMermaid(fam) is a non-degenerate diagram for every family EXCEPT radar,
// whose empty base (no axes) is not a serializable radar — so it is legitimately not
// round-trippable and is exercised only by the crash-freedom/determinism suites above.
const NOT_ROUND_TRIPPABLE: readonly DiagramKind[] = ['radar']

describe('synthesize fuzz: real payloads round-trip', () => {
  it('rejects malformed and family-inconsistent payloads instead of emitting invalid source', () => {
    for (const payload of [
      { kind: 'flowchart', body: { kind: 'flowchart', graph: { nodes: {} } } },
      { kind: 'flowchart', body: { kind: 'opaque', family: 'pie', source: 'pie\n  "A" : 1\n' } },
      { kind: 'constructor', body: { kind: 'opaque', family: 'pie', source: 'pie\n  "A" : 1\n' } },
      { kind: { toString: '' }, body: { kind: 'flowchart' } },
      { kind: 'flowchart', body: { kind: 'opaque', family: { toString: '' } } },
      { kind: 'pie', body: { kind: 'pie', title: '', showData: false, slices: [{ label: 'A', value: 'oops' }] } },
    ]) {
      expect(synthesizeFromGraph(payload as never)).toMatchObject({ ok: false })
    }
  })

  it('publishes the parser-admitted metadata snapshot, not malformed retained JSON', () => {
    const payload = JSON.parse(JSON.stringify(createMermaid('flowchart')))
    payload.body.graph.nodes = { A: { id: 'A', label: 'A', shape: 'rectangle' } }
    payload.meta.comments = null
    const result = synthesizeFromGraph(payload)
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.isArray(result.value.meta.comments)).toBe(true)
  })

  it('empty creation scaffolds survive JSON rehydration except radar, which requires axes', () => {
    // A deterministic loop, not constantFrom sampling: every family is visited.
    for (const { family, payload } of REAL_PAYLOADS) {
      const r = synthesizeFromGraph(payload as never)
      if (NOT_ROUND_TRIPPABLE.includes(family)) {
        expect({ family, ok: r.ok }).toEqual({ family, ok: false })
        continue
      }
      expect({ family, ok: r.ok }).toEqual({ family, ok: true })
      if (!r.ok) continue
      const source = serializeMermaid(r.value)
      expect({ family, source }).toEqual({ family, source: serializeMermaid(createMermaid(family)) })
      const reparsed = parseMermaid(source)
      expect({ family, reparsed: reparsed.ok && reparsed.value.kind }).toEqual({ family, reparsed: family })
    }
  })
})
