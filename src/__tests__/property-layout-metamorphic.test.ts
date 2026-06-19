// Move 7: metamorphic relations for layout + faithfulness.
//
// When "is this diagram correct?" has no computable oracle (the test-oracle
// problem; Barr et al. 2015), metamorphic testing asserts that RELATED inputs
// produce RELATED outputs — no ground truth required (Chen et al., ACM Comput.
// Surv. 2018). The project's existing determinism and round-trip tests are
// already metamorphic relations; quality.md even flags that input-order /
// relabeling independence is "not yet covered". This file formalizes the
// relations that genuinely hold for THIS system and were previously implicit.
//
// Relations asserted (each over fast-check-generated flowcharts):
//   MR1 Determinism      — same source ⇒ byte-identical layout metrics.
//   MR2 Relabeling       — a bijective node-id renaming preserves structure
//                          (node/edge counts, verify.ok) — ids carry no meaning.
//   MR3 Disconnected-add — adding an isolated node ⇒ nodeCount+1, edges unchanged,
//                          and nothing already present is dropped (faithfulness).
//   MR4 Edge-add         — adding an edge between existing nodes ⇒ edgeCount+1,
//                          nodeCount unchanged.
//
// NOTE on what is deliberately NOT asserted: statement-permutation invariance.
// This renderer preserves source order on purpose (source-order layout is a
// stated design property), so permuting statements may legitimately change
// geometry — it is not a valid metamorphic relation here.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid, verifyMermaid, layoutMermaid, measureQuality } from '../agent/index.ts'
import { countStructuralElements } from '../../eval/shared/structural-count.ts'

// ---- generators ------------------------------------------------------------

interface FlowSpec { k: number; pairs: [number, number][] }

const flowSpec: fc.Arbitrary<FlowSpec> = fc
  .integer({ min: 2, max: 6 })
  .chain(k =>
    fc.record({
      k: fc.constant(k),
      pairs: fc.array(
        fc.tuple(fc.integer({ min: 0, max: k - 1 }), fc.integer({ min: 0, max: k - 1 }))
          .filter(([a, b]) => a !== b),  // no self-loops — keeps edge counting simple
        { minLength: 1, maxLength: 8 },
      ),
    }),
  )

function buildFlowchart(spec: FlowSpec, idFor: (i: number) => string): string {
  const lines = ['flowchart TD']
  for (let i = 0; i < spec.k; i++) lines.push(`  ${idFor(i)}["Node ${i}"]`)
  for (const [a, b] of spec.pairs) lines.push(`  ${idFor(a)} --> ${idFor(b)}`)
  return lines.join('\n')
}

const defaultId = (i: number) => `n${i}`

/** Parse + structural count, asserting the source is well-formed. */
function counts(source: string): { nodes: number; edges: number; groups: number } {
  const p = parseMermaid(source)
  if (!p.ok) throw new Error(`generated source failed to parse:\n${source}`)
  const c = countStructuralElements(p.value)
  if (!c) throw new Error('expected a structured (non-opaque) flowchart body')
  return c
}

// ---- MR1: determinism ------------------------------------------------------

describe('metamorphic: layout + faithfulness relations', () => {
  test('MR1 determinism — identical source yields identical metrics', () => {
    fc.assert(
      fc.property(flowSpec, spec => {
        const src = buildFlowchart(spec, defaultId)
        const p = parseMermaid(src)
        if (!p.ok) return
        const a = measureQuality(layoutMermaid(p.value))
        const b = measureQuality(layoutMermaid(p.value))
        expect(a).toEqual(b)
      }),
      { numRuns: 60 },
    )
  })

  test('MR2 relabeling — a bijective id renaming preserves structure', () => {
    fc.assert(
      fc.property(flowSpec, spec => {
        const original = buildFlowchart(spec, defaultId)
        // Bijection: reverse the index order. Ids carry no semantic weight, so
        // node/edge counts and structural validity must be identical.
        const relabeled = buildFlowchart(spec, i => `z${spec.k - 1 - i}`)

        const co = counts(original)
        const cr = counts(relabeled)
        expect(cr).toEqual(co)

        const po = parseMermaid(original), pr = parseMermaid(relabeled)
        if (po.ok && pr.ok) {
          expect(verifyMermaid(pr.value).ok).toBe(verifyMermaid(po.value).ok)
        }
      }),
      { numRuns: 60 },
    )
  })

  test('MR3 disconnected-node addition — +1 node, edges and existing content preserved', () => {
    fc.assert(
      fc.property(flowSpec, spec => {
        const base = buildFlowchart(spec, defaultId)
        const augmented = base + `\n  extra_iso["Isolated"]`

        const cb = counts(base)
        const ca = counts(augmented)
        // Faithfulness monotonicity: the new node appears, nothing is dropped.
        expect(ca.nodes).toBe(cb.nodes + 1)
        expect(ca.edges).toBe(cb.edges)
      }),
      { numRuns: 60 },
    )
  })

  test('MR4 edge addition — +1 edge between existing nodes, node count unchanged', () => {
    fc.assert(
      fc.property(flowSpec, spec => {
        const base = buildFlowchart(spec, defaultId)
        // n0 and n1 always exist (k >= 2); a self-distinct edge is always added.
        const augmented = base + `\n  n0 --> n1`

        const cb = counts(base)
        const ca = counts(augmented)
        expect(ca.edges).toBe(cb.edges + 1)
        expect(ca.nodes).toBe(cb.nodes)
      }),
      { numRuns: 60 },
    )
  })
})

// ---- the same relations across non-graph families (Move H) -----------------
//
// The structural counter (src/agent/structural-count.ts) projects every family
// onto {nodes, edges, groups}, so the relabeling + monotonicity relations are
// not flowchart-specific. Each family generator declares its primary entities
// explicitly so node/edge counts are predictable.

const pairsArb = (k: number) =>
  fc.array(
    fc.tuple(fc.integer({ min: 0, max: k - 1 }), fc.integer({ min: 0, max: k - 1 })).filter(([a, b]) => a !== b),
    { minLength: 1, maxLength: 6 },
  )

const familySpec: fc.Arbitrary<FlowSpec> = fc
  .integer({ min: 2, max: 5 })
  .chain(k => fc.record({ k: fc.constant(k), pairs: pairsArb(k) }))

function buildSequence(spec: FlowSpec, idFor: (i: number) => string): string {
  const lines = ['sequenceDiagram']
  for (let i = 0; i < spec.k; i++) lines.push(`  participant ${idFor(i)}`)
  for (const [a, b] of spec.pairs) lines.push(`  ${idFor(a)}->>${idFor(b)}: m${a}_${b}`)
  return lines.join('\n')
}

function buildClass(spec: FlowSpec, idFor: (i: number) => string): string {
  const lines = ['classDiagram']
  for (let i = 0; i < spec.k; i++) lines.push(`  class ${idFor(i)}`)
  for (const [a, b] of spec.pairs) lines.push(`  ${idFor(a)} --> ${idFor(b)}`)
  return lines.join('\n')
}

function buildEr(spec: FlowSpec, idFor: (i: number) => string): string {
  // A covering chain guarantees all k entities appear; extra pairs add relations.
  const lines = ['erDiagram']
  for (let i = 0; i < spec.k - 1; i++) lines.push(`  ${idFor(i)} ||--o{ ${idFor(i + 1)} : rel`)
  for (const [a, b] of spec.pairs) lines.push(`  ${idFor(a)} ||--o{ ${idFor(b)} : rel`)
  return lines.join('\n')
}

const families = [
  { name: 'sequence', build: buildSequence, def: (i: number) => `P${i}`, rel: (k: number, i: number) => `Q${k - 1 - i}`, addNode: '\n  participant EXTRA', addEdge: (id: (i: number) => string) => `\n  ${id(0)}->>${id(1)}: extra` },
  { name: 'class', build: buildClass, def: (i: number) => `C${i}`, rel: (k: number, i: number) => `Z${k - 1 - i}`, addNode: '\n  class EXTRA', addEdge: (id: (i: number) => string) => `\n  ${id(0)} --> ${id(1)}` },
  // ER has no isolated-entity syntax without attribute blocks, so it asserts
  // relabeling + relation-add only (no disconnected-node relation).
  { name: 'er', build: buildEr, def: (i: number) => `E${i}`, rel: (k: number, i: number) => `Y${k - 1 - i}`, addNode: null, addEdge: (id: (i: number) => string) => `\n  ${id(0)} ||--o{ ${id(1)} : extra` },
] as const

describe('metamorphic: relations across non-graph families', () => {
  for (const fam of families) {
    const id = fam.def

    test(`${fam.name} MR2 relabeling — bijective id rename preserves structure`, () => {
      fc.assert(
        fc.property(familySpec, spec => {
          const original = fam.build(spec, id)
          const relabeled = fam.build(spec, i => fam.rel(spec.k, i))
          expect(counts(relabeled)).toEqual(counts(original))
          const po = parseMermaid(original), pr = parseMermaid(relabeled)
          if (po.ok && pr.ok) expect(verifyMermaid(pr.value).ok).toBe(verifyMermaid(po.value).ok)
        }),
        { numRuns: 50 },
      )
    })

    if (fam.addNode) {
      test(`${fam.name} MR3 entity addition — +1 node, edges unchanged`, () => {
        fc.assert(
          fc.property(familySpec, spec => {
            const base = fam.build(spec, id)
            const cb = counts(base)
            const ca = counts(base + fam.addNode)
            expect(ca.nodes).toBe(cb.nodes + 1)
            expect(ca.edges).toBe(cb.edges)
          }),
          { numRuns: 50 },
        )
      })
    }

    test(`${fam.name} MR4 relation addition — +1 edge, node count unchanged`, () => {
      fc.assert(
        fc.property(familySpec, spec => {
          const base = fam.build(spec, id)
          const cb = counts(base)
          const ca = counts(base + fam.addEdge(id))
          expect(ca.edges).toBe(cb.edges + 1)
          expect(ca.nodes).toBe(cb.nodes)
        }),
        { numRuns: 50 },
      )
    })
  }
})
