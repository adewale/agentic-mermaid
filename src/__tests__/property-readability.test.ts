// Readability mechanism + fuzzing.
//
// "Readable" = every text element can actually be read: not occluded by foreign
// geometry, not clipped off the canvas. auditReadability (src/agent/readability-
// audit.ts) checks this on the public RenderedLayout — an edge-label pill over a
// non-incident node or another edge label, a labelled node's box overlapped by
// another node (node-link families), or anything past the bounds. It is the gate
// the before/after fan-out screenshots would have failed (the "yes" label
// clipped to "es" behind a node box; auditReadability flags exactly that — see
// the unit test below).
//
// The gate is a single GLOBAL RATCHET over the real mermaid-docs corpus PLUS a
// deterministic fuzz sample of every family (vary entity count + relabel + append
// a primary/relation, fixed seed). One number, no per-family special-casing, and
// a regression ceiling whose target is 0: any new unreadable diagram — in any
// family, including a new one that joins the registry — pushes the total over the
// ceiling and fails CI. (Same shape as the duplicate-edge crossing ratchet; see
// docs/contributing/visual-review-evidence.md.)
//
// Today's baseline is two real, separately-fixable classes the mechanism surfaced:
//   • 3 — sequence message labels grazing a participant box (sequence/15,/21,/22).
//   • 9 — ER parallel-relationship label overlaps: a duplicate relationship
//     between two entities, which the family-layout ER renderer does not yet
//     separate into lanes (the same class fixed for flowchart edges elsewhere).
// Lower the ceiling when either is fixed.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMermaid, layoutMermaid } from '../agent/index.ts'
import { auditReadability } from '../agent/readability-audit.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { toFinite } from '../agent/types.ts'
import type { RenderedLayout } from '../agent/types.ts'

const SEED = 0x0decaf
const RATCHET = 12

const tagArb = fc.integer({ min: 0, max: 1_000_000 }).map(n => `q${n.toString(36)}`)
function srcArb(fam: typeof METAMORPHIC_FAMILIES[keyof typeof METAMORPHIC_FAMILIES]) {
  const [kmin, kmax] = fam.kRange
  return fc.record({
    k: fc.integer({ min: kmin, max: kmax }),
    tag: tagArb,
    extra: fc.constantFrom('none', 'primary', 'relation'),
  }).map(({ k, tag, extra }) => {
    let s = fam.build(k, tag)
    if (extra === 'primary' && fam.addPrimary) s += fam.addPrimary.snippet(k, tag)
    if (extra === 'relation' && fam.addRelation) s += fam.addRelation(k, tag)
    return s
  })
}

describe('auditReadability (the mechanism)', () => {
  test('flags an edge label drawn over a non-incident node', () => {
    const f = toFinite
    // Synthetic layout: A→B's label pill sits squarely on node C's box.
    const layout: RenderedLayout = {
      version: 1, kind: 'flowchart',
      nodes: [
        { id: 'A', x: f(0), y: f(0), w: f(60), h: f(40), shape: 'rectangle', label: 'A' },
        { id: 'B', x: f(300), y: f(0), w: f(60), h: f(40), shape: 'rectangle', label: 'B' },
        { id: 'C', x: f(150), y: f(0), w: f(60), h: f(40), shape: 'rectangle', label: 'C' },
      ],
      edges: [{ id: 'A->B', from: 'A', to: 'B', path: [[f(60), f(20)], [f(300), f(20)]], label: { x: f(180), y: f(20), text: 'over C' } }],
      groups: [], bounds: { w: f(360), h: f(40) },
    }
    expect(auditReadability(layout).map(x => x.code)).toContain('LABEL_OCCLUDED')
  })

  test('is clean when the same label clears the node', () => {
    const f = toFinite
    const layout: RenderedLayout = {
      version: 1, kind: 'flowchart',
      nodes: [
        { id: 'A', x: f(0), y: f(0), w: f(60), h: f(40), shape: 'rectangle', label: 'A' },
        { id: 'B', x: f(300), y: f(0), w: f(60), h: f(40), shape: 'rectangle', label: 'B' },
        { id: 'C', x: f(150), y: f(200), w: f(60), h: f(40), shape: 'rectangle', label: 'C' },
      ],
      edges: [{ id: 'A->B', from: 'A', to: 'B', path: [[f(60), f(20)], [f(300), f(20)]], label: { x: f(180), y: f(20), text: 'clear' } }],
      groups: [], bounds: { w: f(360), h: f(240) },
    }
    expect(auditReadability(layout)).toEqual([])
  })
})

describe('readability: global ratchet (corpus + fuzzed families, target 0)', () => {
  test('total occluded/clipped labels does not exceed the ceiling', () => {
    const offenders: string[] = []
    let total = 0
    const tally = (id: string, src: string) => {
      const p = parseMermaid(src)
      if (!p.ok) return
      const n = auditReadability(layoutMermaid(p.value)).length
      if (n > 0) { total += n; offenders.push(`${id}×${n}`) }
    }

    const corpus = JSON.parse(
      readFileSync(join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json'), 'utf8'),
    ) as Array<{ family: string; source: string; index: number }>
    for (const ent of corpus) tally(`corpus/${ent.family}/${ent.index}`, ent.source)

    for (const fam of Object.values(METAMORPHIC_FAMILIES)) {
      fc.sample(srcArb(fam), { numRuns: 40, seed: SEED }).forEach((src, i) => tally(`fuzz/${fam.family}/${i}`, src))
    }

    if (total > RATCHET) {
      throw new Error(`readability regressed: ${total} > ceiling ${RATCHET}.\nOffenders:\n  ${offenders.join('\n  ')}`)
    }
  })
})
