// Standing corner-case fuzz gate — the structural families where our heuristics
// are scoped out (diamonds/non-rect, subgraphs, chained hubs, high-degree fan,
// reversed directions) and used to silently drop to raw ELK. The regressions we
// caught during development lived in specific generators (RL mixed-label fan-in
// node-overlap; BT chained-hub mixed-shape edgeThroughNode) that a UNIFORM sweep
// under-samples — index-derived families can systematically miss a class (an
// earlier fuzzer's self-loop family always landed on odd indices, so its label
// was always off, and it never exercised the labelled self-loop at all). A
// generator audit found several such correlations here; the generators below now
// DECORRELATE (structural selectors from disjoint residues of i, label/shape
// toggles from the high bits of a hash of i — see the note by the helpers), so
// every direction × family × label-state combination is reachable. This gate
// runs those exact generators plus a broad family sweep and asserts, at
// ZERO tolerance, the binary STRUCTURAL invariants B/C fix (overlaps,
// edgeThroughNode, hitches, off-outline, diagonals, unexplained bends) hold
// everywhere, plus determinism and a soft label-centring ceiling (the class of
// the label-hugging regression that started this work). Deterministic: every
// input is index-derived (no Date/Math.random), so this is a stable CI gate.
//
// Every generator now pins labelOffRoute at ZERO. (The one pre-existing near-miss
// this gate first surfaced — a high-degree RL double-hub fan-in whose diamond→hub
// spoke label sat ~25px above a congested shared-approach trunk — is now fixed by
// the repairLabelsOffOwnRoute pass, which pulls such a label back within the
// allowance. The pins stay as an explicit contract: any NEW off-route label fails
// the gate.)
import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations, HARD_METRICS } from '../layout-rubric.ts'

const DIRS = ['LR', 'RL', 'TD', 'BT']
const W = ['warnings', 'ok', 'same word ok', 'a longer label goes here', 'x', 'errors', 'q', 'done']
const clean = (s: string) => s.replace(/[^a-z ]/g, '')
const sh = (id: string, t: string, k: number) => [`${id}["${t}"]`, `${id}{${t}}`, `${id}((${t}))`, `${id}(["${t}"])`, `${id}[/"${t}"/]`][k % 5]
// Decorrelation rule (a generator audit found the failure this suite guards
// against hiding in correlated indices — e.g. the self-loop family always landed
// on odd i, so its label was ALWAYS off): NEVER let a family/direction/degree
// selector and an inner label toggle read overlapping bits of i. Structural
// selectors below use disjoint low residues of i; label/shape toggles use the
// HIGH bits of a multiplicative hash of i, which are well-mixed and independent
// of i's low residues (i%4, i%6, ...). All still a pure function of i (no
// Date/Math.random), so the gate stays deterministic.
const hash = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0)
const bit = (i: number, b: number) => (hash(i) >>> (24 + (b & 7))) & 1 // 8 decorrelated toggle bits
const labB = (i: number, b: number, word: number) => bit(i, b) ? `|${clean(W[word % W.length]!)}|` : ''

// (1) mixed-label fan-in — reproduced the RL widen-into-neighbour node-overlap.
// Spoke labels now toggle on hash bits, so all-labelled/no-labelled fan-ins occur
// in EVERY direction (not just LR), which is what surfaces the reversed-flow
// widen-into-upstream overlap the equalizer now guards against.
function mixedFanin(i: number): string {
  const d = DIRS[i % 4], k = 2 + (i % 5), L = [`flowchart ${d}`]
  for (let s = 0; s < k; s++) { L.push(`  S${s}["${W[(i * 3 + s) % W.length]}"] -->${labB(i, s, i + s)} H["hub"]`); if ((i + s) % 3 === 0) L.push(`  U${s} --> S${s}`) }
  L.push(bit(i, 6) ? `  H --> T["t"]` : `  H -->${labB(i, 7, i)} T1["t1"]\n  H --> T2["t2"]`)
  return L.join('\n')
}
// (2) chained hubs + mixed shapes — reproduced the BT edgeThroughNode. Fan-in
// degree (k1) now comes from a slice disjoint from the direction bits, so wide
// fan-ins occur in every direction (was: k1 locked to direction).
function chainedHubs(i: number): string {
  const d = DIRS[i % 4], L = [`flowchart ${d}`], wrap = i % 5 === 0
  if (wrap) L.push('  subgraph G')
  const k1 = 2 + ((i >> 2) % 4), k2 = 2 + ((i >> 4) % 3)
  for (let s = 0; s < k1; s++) { L.push(`  ${sh('P' + s, W[(i * 5 + s) % W.length]!, s + i)} -->${labB(i, s, i + s)} H1["hub one"]`); if ((i + s) % 4 === 0) L.push(`  Q${s} --> P${s}`) }
  L.push(`  H1 -->${labB(i, 5, i)} H2["hub two"]`)
  for (let s = 0; s < k2; s++) L.push(`  ${sh('R' + s, W[(i + s * 3) % W.length]!, s + i + 1)} -->${labB(i, s ^ 3, i * 7 + s)} H2`)
  if (wrap) L.push('  end')
  L.push(`  H2 --> Z["end"]`)
  return L.join('\n')
}
// (3) broad families — diamonds, cycles, self-loops, parallel edges, wide labels.
// Direction cycles WITHIN each family (was: each family reached only 2 of 4
// directions), and label toggles come from hash bits (was: family selector i%6
// forced constant parity, freezing every toggle — e.g. self-loops were always
// labelled, parallel bundles always exactly {off,on,none}).
function broad(i: number): string {
  const fam = i % 6, d = DIRS[((i / 6) | 0) % 4]
  switch (fam) {
    case 0: return `flowchart ${d}\n  A{${clean(W[i % W.length]!)}} -->${labB(i, 0, i)} B["b"]\n  A -->${labB(i, 1, i + 1)} C["c"]\n  B --> R["r"]\n  C --> R\n  R --> ${sh('E', 'end', i)}`
    case 1: return `flowchart ${d}\n  A["a"] -->${labB(i, 2, i)} B["b"]\n  B --> C["c"]\n  C -->${labB(i, 3, i + 1)} A\n  C --> ${sh('D', 'out', i)}`
    case 2: return `flowchart ${d}\n  A["a"] -->${labB(i, 4, i)} B["${W[i % W.length]}"]\n  B -->${labB(i, 5, i + 1)} B\n  B --> C["c"]`
    case 3: return `flowchart ${d}\n  A["${W[i % W.length]}"] -->${labB(i, 0, i)} B["b"]\n  A -->${labB(i, 1, i + 1)} B\n  A --> B\n  B --> C`
    case 4: return `flowchart ${d}\n  A["a really quite long node label ${i % 7}"] -->|an equally long edge label here| B["ok"]\n  C["c"] --> B\n  B -->|another long-ish label| D["a wide destination label"]`
    default: { const L = [`flowchart ${d}`, `  Z --> H{hub}`]; for (let s = 0; s < 2 + i % 4; s++) L.push(`  H -->${labB(i, s, i + s)} ${sh('T' + s, W[(i + s) % W.length]!, i + s)}`); return L.join('\n') }
  }
}
// (4) fan-in peers with their own upstream CONES — reproduces the stale-endpoint
// offOutlineEndpoints: equalizePeerNodeDimensions repositions a (differing-width,
// so rectangle) fan-in peer S, and a cone edge U->S into it was left dangling off
// S's new outline until reanchorOffOutlineEndpoints re-routed it. Cone depth (0-3)
// comes from hash bits, so deep chains occur in every direction. Simple CHAINS,
// not branches: a branching cone additionally exercises dense cone-vs-cone
// routing (a separate pre-existing edgeThroughNode class, out of scope here) and
// would conflate the two — this generator isolates the stale-endpoint class.
function conedFanin(i: number): string {
  const d = DIRS[i % 4], k = 2 + (i % 4), L = [`flowchart ${d}`]
  for (let s = 0; s < k; s++) {
    L.push(`  S${s}["${W[(i * 3 + s) % W.length]}"] --> H["hub"]`)
    let prev = `S${s}`
    const depth = (hash(i + s) >> 26) % 4
    for (let z = 0; z < depth; z++) {
      const u = `U${s}_${z}`
      L.push(`  ${u}["${W[(i + s + z) % W.length]}"] -->${labB(i, (s + z) & 7, i + z)} ${prev}`)
      prev = u
    }
  }
  L.push(`  H --> T["t"]`)
  return L.join('\n')
}

// Binary structural invariants — must be ZERO everywhere. This is labelOffRoute's
// complement: the correctness invariants the layout passes fix, none of which
// tolerate a single exception.
const STRUCTURAL_HARD = HARD_METRICS.filter(m => m !== 'labelOffRoute')

// generator, case count, and the DOCUMENTED pre-existing labelOffRoute floor
// (0 unless a specific out-of-scope near-miss is known and pinned).
const GENERATORS: Array<{ name: string; gen: (i: number) => string; n: number; knownLabelOffRoute: number }> = [
  { name: 'chained-hubs (BT edgeThroughNode class)', gen: chainedHubs, n: 600, knownLabelOffRoute: 0 },
  { name: 'mixed-label fan-in (RL overlap class)', gen: mixedFanin, n: 400, knownLabelOffRoute: 0 },
  { name: 'broad families (diamond/cycle/selfloop/parallel/wide)', gen: broad, n: 400, knownLabelOffRoute: 0 },
  { name: 'coned fan-in (stale-endpoint offOutline class)', gen: conedFanin, n: 500, knownLabelOffRoute: 0 },
]

const LABEL_OFFSET_CEIL = 0.45 // soft sanity: a label may drift but never sit essentially AT an endpoint (0.5)

describe('corner-case fuzz gate: structurally HARD-clean + deterministic across families', () => {
  for (const { name, gen, n, knownLabelOffRoute } of GENERATORS) {
    test(`${name} — ${n} cases: zero structural HARD violations`, () => {
      const structural: string[] = []
      let labelOffRoute = 0
      let worstLabel = 0
      for (let i = 0; i < n; i++) {
        const src = gen(i)
        let g, p
        try { g = parseMermaid(src); p = layoutGraphSync(g) } catch (e) { structural.push(`#${i} CRASH ${(e as Error).message}\n${src}`); continue }
        const r = assessLayout(g, p)
        for (const v of hardViolations(r)) {
          if (v.metric === 'labelOffRoute') labelOffRoute++
          else structural.push(`#${i} ${v.metric}\n${src}`)
        }
        worstLabel = Math.max(worstLabel, (r.metrics as { worstLabelOffset?: number }).worstLabelOffset ?? 0)
      }
      if (structural.length) throw new Error(`${structural.length} structural-hard/crash case(s):\n${structural.slice(0, 3).join('\n---\n')}`)
      expect(labelOffRoute).toBeLessThanOrEqual(knownLabelOffRoute) // pinned pre-existing floor; growth = regression
      expect(worstLabel).toBeLessThan(LABEL_OFFSET_CEIL) // soft centring sanity ceiling
    }, 60_000)
  }

  test('determinism: re-layout is byte-identical across families', () => {
    for (let i = 0; i < 60; i++) {
      const src = [chainedHubs, mixedFanin, broad][i % 3]!(i * 7 + 1)
      const a = layoutGraphSync(parseMermaid(src)), b = layoutGraphSync(parseMermaid(src))
      const same = a.nodes.every((n, j) => Math.abs(n.x - b.nodes[j]!.x) < 1e-9 && Math.abs(n.y - b.nodes[j]!.y) < 1e-9)
      expect(same).toBe(true)
    }
  }, 30_000)
})
