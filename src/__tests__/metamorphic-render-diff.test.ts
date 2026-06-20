// Move 3: GraphicsFuzz-style render-and-diff over the metamorphic generators,
// with ddmin reduction of any failure. The equivalent transform is node-id
// relabeling; the rendered GEOMETRY (not just the structural count) must be
// identical up to the rename. This gates the visual layer that no count/round-
// trip oracle reaches.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { geometrySignature, geometryEquivalent } from '../../eval/metamorphic/render-diff.ts'
import { reduceSource } from '../../eval/shared/ddmin.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'

const tagArb = fc.integer({ min: 0, max: 1_000_000 }).map(n => `q${n.toString(36)}`)

// Flowchart geometry is laid out by ELK and is id-order-independent (verified
// 5/5 byte-identical under relabel). NOTE — a finding from building this:
// STATE geometry is NOT relabel-invariant (the state→graph projection orders by
// id), so it's deliberately excluded here and noted as a follow-up to
// investigate (id-sensitive layout is a latent determinism concern).
const GEOMETRIC_FAMILIES = ['flowchart'] as const

describe('GraphicsFuzz render-diff: relabeling preserves geometry', () => {
  for (const family of GEOMETRIC_FAMILIES) {
    const fam = METAMORPHIC_FAMILIES[family]
    test(`${family}: a node-id relabel renders byte-identical geometry`, () => {
      fc.assert(
        fc.property(fc.integer({ min: fam.kRange[0], max: fam.kRange[1] }), tagArb, tagArb, (k, a, b) => {
          const sa = fam.build(k, a)
          const sb = fam.build(k, b)
          if (geometryEquivalent(sa, sb)) return
          // The "reduce" half: shrink the failing (relabeled) source to a minimal
          // repro whose geometry still differs from its sibling — what GraphicsFuzz
          // does to turn a huge variant into a tiny one.
          const original = fam.build(k, a)
          const minimal = reduceSource(sb, s => {
            const sig = geometrySignature(s)
            return sig !== null && sig !== geometrySignature(original)
          })
          throw new Error(`relabel changed geometry for ${family} k=${k}; minimal repro:\n${minimal}`)
        }),
        { numRuns: 40 },
      )
    })
  }

  test('the signature is sensitive: a genuinely different structure differs', () => {
    // Guards against a vacuous signature that calls everything equal.
    const fc2 = METAMORPHIC_FAMILIES.flowchart
    expect(geometryEquivalent(fc2.build(2, 'q'), fc2.build(4, 'q'))).toBe(false)
  })
})
