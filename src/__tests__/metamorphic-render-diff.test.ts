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
// A permutation of one fixed glyph multiset (narrow i/l, wide m/w): the tag
// changes, its rendered text width does not.
const sameWidthTagArb = fc.shuffledSubarray([...'qwzmilk'], { minLength: 7, maxLength: 7 }).map(xs => `s${xs.join('')}`)

// Flowchart nodes carry fixed labels (`["N0"]`), so any id relabel must leave
// geometry byte-identical. State ids ARE the visible labels, so a relabel that
// changes glyph widths legitimately resizes the boxes; state relabels keep the
// width fixed and permute the glyphs instead (measured: arbitrary tags changed
// 28/30 state layouts, same-width permutations 0/60).
const GEOMETRIC_FAMILIES = { flowchart: tagArb, state: sameWidthTagArb } as const

describe('GraphicsFuzz render-diff: relabeling preserves geometry', () => {
  for (const [family, familyTagArb] of Object.entries(GEOMETRIC_FAMILIES)) {
    const fam = METAMORPHIC_FAMILIES[family as keyof typeof GEOMETRIC_FAMILIES]
    test(`${family}: a node-id relabel renders byte-identical geometry`, () => {
      fc.assert(
        fc.property(fc.integer({ min: fam.kRange[0], max: fam.kRange[1] }), familyTagArb, familyTagArb, (k, a, b) => {
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
