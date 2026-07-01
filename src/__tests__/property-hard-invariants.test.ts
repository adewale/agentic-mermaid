// The independent hard-invariant gate — the "mandatory total checker".
//
// assessLayout (src/layout-rubric.ts) is an INDEPENDENT oracle: it reimplements
// each shape's rendered outline equation and recomputes every HARD invariant
// (endpoints on outline, no diagonals, no unexplained bends, no node overlap, no
// label off its route, no edge through a node, no hitch) from the public
// PositionedGraph alone — sharing no code with the route-contract producer. So a
// bug in the producer's own predicates cannot hide from it (that independence is
// the whole point; see the layout-rubric outline-oracle comment).
//
// The existing oracle gates are scattered (the 74 tracked examples in
// heuristic-tracker; syntax fuzz in route-contracts-syntax-range; metamorphic
// transforms in layout-metamorphic). What was missing is a SINGLE gate that runs
// the oracle over the broadest input set we have — every real-world flowchart in
// the mermaid-docs corpus PLUS a deterministic fuzz sample — and asserts ZERO
// hard violations everywhere. The layout-equivalence gate pins those same corpus
// diagrams byte-for-byte, but byte-identical geometry is not the same claim as
// "every hard invariant holds": this gate makes the structural claim explicit and
// total, so any future heuristic that breaks a hard invariant on ANY of them
// fails loudly and immediately — which is exactly what lets new placement/routing
// heuristics be added aggressively without silently regressing the foundation.
//
// Target is 0, not a ratchet: hard invariants are conventions (achievable by
// construction), not NP-hard optima — see docs/design/system/
// layout-guarantees-and-robustness.md.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'

const SEED = 0x0decaf

/** Run the independent oracle on one flowchart source; return hard-violation details. */
function offences(id: string, source: string): string[] {
  let graph
  try {
    graph = parseMermaid(source)
  } catch {
    return [] // non-flowchart / unparseable by the core parser: out of this gate's scope
  }
  const positioned = layoutGraphSync(graph)
  return hardViolations(assessLayout(graph, positioned)).map(v => `${id}: ${v.metric} — ${v.detail}`)
}

// Reuse the family fuzzer shape from property-readability: vary entity count,
// relabel, and optionally append a primary/relation.
function flowchartArb() {
  const fam = METAMORPHIC_FAMILIES.flowchart
  const [kmin, kmax] = fam.kRange
  return fc.record({
    k: fc.integer({ min: kmin, max: kmax }),
    tag: fc.integer({ min: 0, max: 1_000_000 }).map(n => `q${n.toString(36)}`),
    extra: fc.constantFrom('none', 'primary', 'relation'),
  }).map(({ k, tag, extra }) => {
    let s = fam.build(k, tag)
    if (extra === 'primary' && fam.addPrimary) s += fam.addPrimary.snippet(k, tag)
    if (extra === 'relation' && fam.addRelation) s += fam.addRelation(k, tag)
    return s
  })
}

describe('hard invariants: independent oracle over corpus + fuzz (target 0)', () => {
  test('every flowchart corpus diagram is hard-clean', () => {
    const corpus = JSON.parse(
      readFileSync(join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json'), 'utf8'),
    ) as Array<{ family: string; source: string; index: number }>
    const flowcharts = corpus.filter(e => e.family === 'flowchart')
    // Guard against the gate silently passing by checking nothing.
    expect(flowcharts.length).toBeGreaterThanOrEqual(100)

    const offenders = flowcharts.flatMap(e => offences(`corpus/flowchart/${e.index}`, e.source))
    if (offenders.length > 0) {
      throw new Error(`hard-invariant violations in the flowchart corpus:\n  ${offenders.join('\n  ')}`)
    }
  })

  test('a deterministic flowchart fuzz sample is hard-clean', () => {
    const samples = fc.sample(flowchartArb(), { numRuns: 200, seed: SEED })
    const offenders = samples.flatMap((src, i) => offences(`fuzz/flowchart/${i}`, src))
    if (offenders.length > 0) {
      throw new Error(`hard-invariant violations in fuzzed flowcharts:\n  ${offenders.join('\n  ')}`)
    }
  })
})
