// Standing corner-case fuzz gate — the structural families where our heuristics
// are scoped out (diamonds/non-rect, subgraphs, chained hubs, high-degree fan,
// reversed directions) and used to silently drop to raw ELK. The regressions we
// caught during development lived in specific generators (RL mixed-label fan-in
// node-overlap; BT chained-hub mixed-shape edgeThroughNode) that a UNIFORM sweep
// under-samples — index-derived families can systematically miss a class (an
// earlier fuzzer's self-loop family always landed on odd indices, so its label
// was always off, and it never exercised the labelled self-loop at all). This
// gate runs those exact generators plus a broad family sweep and asserts, at
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
const lab = (i: number, on: boolean) => on ? `|${clean(W[i % W.length]!)}|` : ''

// (1) mixed-label fan-in — reproduced the RL widen-into-neighbour node-overlap.
function mixedFanin(i: number): string {
  const d = DIRS[i % 4], k = 2 + (i % 5), L = [`flowchart ${d}`]
  for (let s = 0; s < k; s++) { L.push(`  S${s}["${W[(i * 3 + s) % W.length]}"] -->${lab(i + s, ((i >> s) & 1) === 0)} H["hub"]`); if ((i + s) % 3 === 0) L.push(`  U${s} --> S${s}`) }
  L.push(i % 2 ? `  H --> T["t"]` : `  H -->${lab(i, true)} T1["t1"]\n  H --> T2["t2"]`)
  return L.join('\n')
}
// (2) chained hubs + mixed shapes — reproduced the BT edgeThroughNode.
function chainedHubs(i: number): string {
  const d = DIRS[i % 4], L = [`flowchart ${d}`], wrap = i % 5 === 0
  if (wrap) L.push('  subgraph G')
  const k1 = 2 + i % 4, k2 = 2 + ((i >> 2) % 3)
  for (let s = 0; s < k1; s++) { L.push(`  ${sh('P' + s, W[(i * 5 + s) % W.length]!, s + i)} -->${lab(i + s, ((i >> s) & 1) === 0)} H1["hub one"]`); if ((i + s) % 4 === 0) L.push(`  Q${s} --> P${s}`) }
  L.push(`  H1 -->${lab(i, true)} H2["hub two"]`)
  for (let s = 0; s < k2; s++) L.push(`  ${sh('R' + s, W[(i + s * 3) % W.length]!, s + i + 1)} -->${lab(i * 7 + s, ((i >> (s + 1)) & 1) === 0)} H2`)
  if (wrap) L.push('  end')
  L.push(`  H2 --> Z["end"]`)
  return L.join('\n')
}
// (3) broad families — diamonds, cycles, self-loops (labelled), parallel edges, wide labels.
function broad(i: number): string {
  const d = DIRS[i % 4]
  switch (i % 6) {
    case 0: return `flowchart ${d}\n  A{${clean(W[i % W.length]!)}} -->${lab(i, i % 2 === 0)} B["b"]\n  A -->${lab(i + 1, i % 2 === 0)} C["c"]\n  B --> R["r"]\n  C --> R\n  R --> ${sh('E', 'end', i)}`
    case 1: return `flowchart ${d}\n  A["a"] -->${lab(i, true)} B["b"]\n  B --> C["c"]\n  C -->${lab(i + 1, i % 2 === 0)} A\n  C --> ${sh('D', 'out', i)}`
    case 2: return `flowchart ${d}\n  A["a"] -->${lab(i, true)} B["${W[i % W.length]}"]\n  B -->${lab(i + 1, i % 2 === 0)} B\n  B --> C["c"]`
    case 3: return `flowchart ${d}\n  A["${W[i % W.length]}"] -->${lab(i, i % 2 === 0)} B["b"]\n  A -->${lab(i + 1, (i + 1) % 2 === 0)} B\n  A --> B\n  B --> C`
    case 4: return `flowchart ${d}\n  A["a really quite long node label ${i % 7}"] -->|an equally long edge label here| B["ok"]\n  C["c"] --> B\n  B -->|another long-ish label| D["a wide destination label"]`
    default: { const L = [`flowchart ${d}`, `  Z --> H{hub}`]; for (let s = 0; s < 2 + i % 4; s++) L.push(`  H -->${lab(i + s, ((i >> s) & 1) === 0)} ${sh('T' + s, W[(i + s) % W.length]!, i + s)}`); return L.join('\n') }
  }
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
