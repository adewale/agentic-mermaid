// Move 2: DIFFERENTIAL testing against mermaid-ast — an INDEPENDENT Mermaid
// parser (a separate implementation, a committed dependency). This breaks the
// closed loop the testing-tools trajectory had spiralled into: every prior gate
// was a self-generated / consistency oracle (round-trip, doc-sync, metamorphic
// on ourselves), which the oracle-problem literature (Barr et al. 2015) shows
// has a ceiling — it can prove the system agrees with itself, never with an
// external authority. A second implementation IS that authority (McKeeman 1998).
//
// Two gates:
//   A. CLEAN cross-check — on the metamorphic generators (well-formed, edge-
//      bearing, structured) our counter must agree EXACTLY with mermaid-ast for
//      every family both model (flowchart/sequence/class/er).
//   B. CORPUS divergence ratchet — over the docs corpus the two implementations
//      legitimately diverge in documented classes: mermaid-ast counts sequence
//      alt/loop/opt blocks as messages, which we model as opaque segments; and
//      it counts nested-subgraph membership differently than our flattened
//      node universe. The per-family divergence profile is PINNED so a
//      regression that introduces a new disagreement fails — surfacing it as a
//      real bug or a new oracle quirk to classify, exactly like
//      eval/mermaid-docs-corpus/divergences.json.
//
// (Building this oracle itself demonstrated differential testing's value twice:
// reading mermaid-ast's Map-typed node fields with Object.keys initially
// fabricated 16 phantom "isolated node" divergences — fixing the oracle to use
// the Map API cut the corpus divergences from 25 to 9 genuine ones.)

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid as parseMermaid } from '../agent/index.ts'
import { countStructuralElements } from '../agent/structural-count.ts'
import { countViaMermaidAst } from '../../eval/differential/mermaid-ast-oracle.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'

const eq = (a: { nodes: number; edges: number; groups: number } | null, b: { nodes: number; edges: number; groups: number } | null) =>
  !!a && !!b && a.nodes === b.nodes && a.edges === b.edges && a.groups === b.groups

describe('differential: our counter ↔ mermaid-ast (independent parser)', () => {
  test('A: the metamorphic generators agree EXACTLY with mermaid-ast', () => {
    let agreed = 0
    const disagreements: string[] = []
    for (const fam of Object.values(METAMORPHIC_FAMILIES)) {
      for (let k = fam.kRange[0]; k <= fam.kRange[1]; k++) {
        const src = fam.build(k, `q${k}`)
        const ours = parseMermaid(src)
        if (!ours.ok) continue
        const a = countStructuralElements(ours.value)
        const b = countViaMermaidAst(src)
        if (b === null) continue  // family mermaid-ast doesn't model → no cross-check
        if (eq(a, b)) agreed++
        else disagreements.push(`${fam.family} k=${k}: ours=${JSON.stringify(a)} ast=${JSON.stringify(b)}`)
      }
    }
    expect(disagreements).toEqual([])
    expect(agreed).toBeGreaterThanOrEqual(12)  // real cross-checks happened
  })

  // B: corpus ratchet. mermaid-ast 0.8.2 is pinned, so this is deterministic.
  const CORPUS = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json')
  const corpus: Array<{ family: string; source: string; origin: string; index: number }> =
    existsSync(CORPUS) ? JSON.parse(readFileSync(CORPUS, 'utf8')) : []

  test('B: corpus divergence profile vs mermaid-ast is pinned (ratchet)', () => {
    // Documented divergence classes (June 2026): mermaid-ast counts sequence
    // alt/loop/opt block delimiters as messages while we count the typed
    // fragment's actual interactions; it
    // counts nested-subgraph membership differently than our flattened universe;
    // it does not project ER statements preserved inside tolerated subgraphs;
    // and mermaid-ast 0.8.2 does not model the current v11 icon/image and edge
    // presentation metadata that this project now promotes to typed structure.
    // A change here means our counting moved relative to an independent
    // implementation — investigate before re-pinning.
    const BASELINE: Record<string, number> = { flowchart: 5, sequence: 6, er: 5 }
    const byFamily: Record<string, number> = {}
    let checked = 0
    for (const e of corpus) {
      const ours = parseMermaid(e.source)
      if (!ours.ok) continue
      const a = countStructuralElements(ours.value)
      if (!a) continue
      const b = countViaMermaidAst(e.source)
      if (b === null) continue
      checked++
      if (!eq(a, b)) byFamily[e.family] = (byFamily[e.family] ?? 0) + 1
    }
    expect(checked).toBeGreaterThanOrEqual(60)  // the oracle actually ran broadly
    expect(byFamily).toEqual(BASELINE)
  })
})
