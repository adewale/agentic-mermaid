// Metamorphic relations for layout + faithfulness (Moves 4, 5, 2).
//
// When "is this diagram correct?" has no computable oracle (the test-oracle
// problem; Barr et al. 2015), metamorphic testing asserts that RELATED inputs
// produce RELATED outputs — no ground truth required (Chen et al., ACM Comput.
// Surv. 2018). The project's determinism and round-trip tests are already
// metamorphic relations; this file formalizes the rest and — via the shared
// registry in helpers/metamorphic-families.ts — applies them to ALL twelve
// renderable families, with a citizenship guard so a new family must declare
// its generators or fail CI.
//
// Relations:
//   MR1 Determinism   — same source ⇒ identical layout metrics (flowchart).
//   MR2 Relabeling    — ids/labels carry no structural meaning: build(k, tagA)
//                       and build(k, tagB) have identical counts + verify.ok.
//   MR3 Add-primary   — appending one primary entity ⇒ nodes += nodeDelta,
//                       edges unchanged (faithfulness monotonicity).
//   MR4 Add-relation  — appending one relation ⇒ edges += 1, nodes unchanged.
//
// Deliberately NOT asserted: statement-permutation invariance — this renderer
// preserves source order by design, so permuting statements may legitimately
// change geometry.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid, verifyMermaid, layoutMermaid, measureQuality, serializeMermaid } from '../agent/index.ts'
import { countStructuralElements, type StructuralCount } from '../agent/structural-count.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { assessRenderedLayout, familyHardViolations } from '../family-rubric.ts'

/** Parse + structural count, asserting the source is well-formed and structured. */
function counts(source: string): StructuralCount {
  const p = parseMermaid(source)
  if (!p.ok) throw new Error(`generated source failed to parse:\n${source}`)
  const c = countStructuralElements(p.value)
  if (!c) throw new Error(`expected a structured (non-opaque) body:\n${source}`)
  return c
}

// A tag is any short identifier-safe token; two different tags must be a real
// relabeling. base36 of an integer keeps it alphanumeric and leading-letter.
const tagArb = fc.integer({ min: 0, max: 1_000_000 }).map(n => `q${n.toString(36)}`)

describe('metamorphic: determinism (flowchart)', () => {
  test('MR1 — identical source yields identical metrics', () => {
    const fam = METAMORPHIC_FAMILIES.flowchart
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), tagArb, (k, t) => {
        const p = parseMermaid(fam.build(k, t))
        if (!p.ok) return
        expect(measureQuality(layoutMermaid(p.value))).toEqual(measureQuality(layoutMermaid(p.value)))
      }),
      { numRuns: 50 },
    )
  })
})

describe('metamorphic: relations across all renderable families', () => {
  // Move 5: a new family in the registry must declare metamorphic generators.
  test('every BUILTIN family has a metamorphic generator (citizenship)', () => {
    const registered = BUILTIN_FAMILY_METADATA.map(f => f.id).sort()
    const covered = Object.keys(METAMORPHIC_FAMILIES).sort()
    expect(covered).toEqual(registered)
    // And each generator is self-consistent: its declared family matches its key.
    for (const [key, gen] of Object.entries(METAMORPHIC_FAMILIES)) expect(gen.family as string).toBe(key)
  })

  // Pin each generator's base-build structural count exactly. The metamorphic
  // relations only assert DELTAS (relabel/monotonicity), so a generator change
  // that shifts the base count (as adding a junction / nested composite did)
  // would pass silently. Regenerate by probing build(kRange[0], 'q0') if a
  // generator legitimately changes.
  const BASE_COUNTS: Record<string, { nodes: number; edges: number; groups: number }> = {
    flowchart: { nodes: 2, edges: 1, groups: 0 },
    state: { nodes: 5, edges: 2, groups: 0 },        // chain + nested composite
    sequence: { nodes: 2, edges: 1, groups: 0 },
    class: { nodes: 2, edges: 1, groups: 0 },
    er: { nodes: 2, edges: 1, groups: 0 },
    architecture: { nodes: 3, edges: 1, groups: 1 }, // 2 services + 1 junction
    xychart: { nodes: 1, edges: 0, groups: 0 },
    pie: { nodes: 2, edges: 0, groups: 0 },
    quadrant: { nodes: 2, edges: 0, groups: 0 },
    journey: { nodes: 2, edges: 0, groups: 3 },
    timeline: { nodes: 4, edges: 0, groups: 1 },
    gantt: { nodes: 2, edges: 0, groups: 1 },
  }

  test('every generator base build has its pinned structural count', () => {
    const got: Record<string, unknown> = {}
    for (const fam of Object.values(METAMORPHIC_FAMILIES)) {
      const p = parseMermaid(fam.build(fam.kRange[0], 'q0'))
      got[fam.family] = p.ok ? countStructuralElements(p.value) : 'PARSE_FAIL'
    }
    expect(got).toEqual(BASE_COUNTS)
  })

  for (const fam of Object.values(METAMORPHIC_FAMILIES)) {
    const [kmin, kmax] = fam.kRange
    const kArb = fc.integer({ min: kmin, max: kmax })

    // Move 6: MR1 determinism for EVERY family (the top-level MR1 covered only
    // flowchart) — measuring the same layout twice must be byte-identical.
    test(`${fam.family}: MR1 determinism — identical metrics across two layouts`, () => {
      const p = parseMermaid(fam.build(fam.kRange[0], 'qseed'))
      expect(p.ok).toBe(true)
      if (!p.ok) return
      expect(measureQuality(layoutMermaid(p.value))).toEqual(measureQuality(layoutMermaid(p.value)))
    })

    // Move 9: serialization determinism for every family — two serializations of
    // the same diagram are byte-identical (a precondition for the round-trip and
    // faithfulness gates to be meaningful).
    test(`${fam.family}: MR1 determinism — byte-identical serialization`, () => {
      const p = parseMermaid(fam.build(fam.kRange[0], 'qseed'))
      expect(p.ok).toBe(true)
      if (!p.ok) return
      expect(serializeMermaid(p.value)).toBe(serializeMermaid(p.value))
    })

    test(`${fam.family}: base build is structured + verifiable`, () => {
      fc.assert(fc.property(kArb, tagArb, (k, t) => {
        const p = parseMermaid(fam.build(k, t))
        expect(p.ok).toBe(true)
        if (!p.ok) return
        expect(countStructuralElements(p.value)).not.toBeNull()
        expect(verifyMermaid(p.value).ok).toBe(true)
        const rubric = assessRenderedLayout(layoutMermaid(p.value))
        expect(familyHardViolations(rubric)).toEqual([])
      }), { numRuns: 40 })
    })

    test(`${fam.family}: MR2 relabeling preserves structure + verify.ok`, () => {
      fc.assert(fc.property(kArb, tagArb, tagArb, (k, a, b) => {
        expect(counts(fam.build(k, b))).toEqual(counts(fam.build(k, a)))
        const pa = parseMermaid(fam.build(k, a)), pb = parseMermaid(fam.build(k, b))
        if (pa.ok && pb.ok) expect(verifyMermaid(pb.value).ok).toBe(verifyMermaid(pa.value).ok)
      }), { numRuns: 40 })
    })

    if (fam.addPrimary) {
      const ap = fam.addPrimary
      test(`${fam.family}: MR3 add-primary ⇒ nodes += ${ap.nodeDelta}, edges unchanged`, () => {
        fc.assert(fc.property(kArb, tagArb, (k, t) => {
          const cb = counts(fam.build(k, t))
          const ca = counts(fam.build(k, t) + ap.snippet(k, t))
          expect(ca.nodes).toBe(cb.nodes + ap.nodeDelta)
          expect(ca.edges).toBe(cb.edges)
        }), { numRuns: 40 })
      })
    }

    if (fam.addRelation) {
      const ar = fam.addRelation
      test(`${fam.family}: MR4 add-relation ⇒ edges += 1, nodes unchanged`, () => {
        fc.assert(fc.property(kArb, tagArb, (k, t) => {
          const cb = counts(fam.build(k, t))
          const ca = counts(fam.build(k, t) + ar(k, t))
          expect(ca.edges).toBe(cb.edges + 1)
          expect(ca.nodes).toBe(cb.nodes)
        }), { numRuns: 40 })
      })
    }
  }
})
