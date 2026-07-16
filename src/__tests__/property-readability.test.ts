// Readability mechanism + fuzzing.
//
// This gate covers the text geometry represented by public RenderedLayout:
// edge-label pills plus labelled boxes in node-link families. It catches a pill
// over a foreign node/label, overlapping labelled boxes, and clipping. Family-
// specific text roles (axes, legends, notes, headers) retain their own explicit
// layout/containment suites; this file does not claim to replace those gates.
//
// The single zero ratchet runs over the real Mermaid docs corpus and a
// deterministic fuzz sample of every family. Parse failures are hard failures,
// never silent skips that could make the score improve when support regresses.
//
// Closing The Gap removes the final two classes the mechanism surfaced:
// sequence message-label/header and note clearance, plus ER duplicate/group
// relationship label lanes. The zero ceiling is now a hard no-regression gate.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid as parseMermaid, layoutMermaid, verifyMermaid } from '../agent/index.ts'
import { auditReadability } from '../agent/readability-audit.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { toFinite } from '../agent/types.ts'
import type { RenderedLayout } from '../agent/types.ts'

const SEED = 0x0decaf
const RATCHET = 0

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

describe('node-link and edge-label readability ratchet (corpus + fuzzed families, target 0)', () => {
  test('total occluded/clipped labels does not exceed the ceiling', () => {
    const offenders: string[] = []
    let total = 0
    const tally = (id: string, src: string) => {
      const p = parseMermaid(src)
      expect(p.ok, `${id}: source must parse; failed parsing cannot improve readability`).toBe(true)
      if (!p.ok) throw new Error(`${id}: parse failed`)
      // This ratchet measures labels on successfully positioned artifacts;
      // layout-equivalence separately owns the success/failure outcome. Some
      // preserved upstream examples are deliberately non-renderable locally
      // (for example the Gantt wall-clock-fallback divergences), and strict
      // Section A layout now throws for those instead of returning a false
      // 0x0 success.
      let layout
      try {
        layout = layoutMermaid(p.value)
      } catch (error) {
        const codes = verifyMermaid(p.value).warnings.map(warning => warning.code)
        if (codes.includes('EMPTY_DIAGRAM') || codes.includes('UNRESOLVABLE_SCHEDULE')) return
        throw error
      }
      const n = auditReadability(layout).length
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
