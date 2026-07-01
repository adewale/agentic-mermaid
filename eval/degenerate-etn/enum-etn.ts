// Reproducer for issue #81: enumerate the degenerate `edgeThroughNode` residual
// that survives PR #80. Two deterministic generators (no RNG) over fixed integer
// seeds, delta-debugged to minimal repros and bucketed by a structural signature.
//
//   bun run eval/degenerate-etn/enum-etn.ts
//
// Deterministic: hash-seeded generators + deterministic layout => stable output.
// The catalog in README.md (source + editor links per case) is generated from this.
import { parseMermaid } from '../../src/parser.ts'
import { layoutGraphSync } from '../../src/layout-engine.ts'
import { assessLayout, hardViolations } from '../../src/layout-rubric.ts'

const DIRS = ['LR', 'RL', 'TD', 'BT']
const W = ['warnings', 'ok', 'same word ok', 'a longer label goes here', 'x', 'errors', 'q', 'done', 'retry', 'validate input']
const hash = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0), bit = (i: number, b: number) => (hash(i) >>> (b & 31)) & 1
const shp = (id: string, t: string, k: number) => [`${id}["${t}"]`, `${id}{${t}}`, `${id}((${t}))`, `${id}(["${t}"])`, `${id}[/"${t}"/]`, `${id}[(${t})]`, `${id}{{${t}}}`][k % 7]

// dense multi-component DAG: back-edges, high fan-out, mixed shapes, variable-length links
function denseDag(i: number): string {
  const d = DIRS[i % 4], n = 5 + (hash(i) % 8), L = [`flowchart ${d}`]
  for (let a = 0; a < n; a++) L.push(`  ${shp('N' + a, W[(i + a) % W.length]!, hash(i + a) % 7)}`)
  const edges = 4 + (hash(i >> 2) % 10)
  for (let e = 0; e < edges; e++) {
    const s = hash(i * 7 + e) % n, t = hash(i * 13 + e + 1) % n
    if (s === t) { L.push(`  N${s} --> N${s}`); continue }
    const arr = ['-->', '===>', '--->', '---->'][hash(i + e) % 4]
    const lab = bit(i + e, 5) ? `|${W[(i + e) % W.length]!.replace(/[^a-z ]/g, '')}|` : ''
    L.push(`  N${s} ${arr}${lab} N${t}`)
  }
  return L.join('\n')
}
// extreme diamond fan
function diamondFan(i: number): string {
  const d = DIRS[i % 4], k = 2 + (hash(i) % 6), L = [`flowchart ${d}`]
  L.push(`  D{${W[i % W.length]}}`)
  for (let a = 0; a < k; a++) L.push(`  D -->|${bit(i + a, 4) ? 'yes' : 'no'}| T${a}["${W[(i + a) % W.length]}"]`)
  for (let a = 0; a < 2 + (hash(i >> 3) % 3); a++) L.push(`  S${a}["${W[(i + a) % W.length]}"] --> D`)
  if (bit(i, 15)) L.push(`  T0 --> D`)
  return L.join('\n')
}

const etn = (src: string): boolean => {
  try {
    const g = parseMermaid(src); const p = layoutGraphSync(g)
    return hardViolations(assessLayout(g, p)).some(v => v.metric === 'edgeThroughNode')
  } catch { return false }
}
// greedy delta-debug: drop any line that still preserves the violation
function shrink(src: string): string {
  let lines = src.split('\n'), ch = true
  while (ch) {
    ch = false
    for (let j = 1; j < lines.length; j++) {
      const c = [...lines.slice(0, j), ...lines.slice(j + 1)]
      if (c.length > 1 && etn(c.join('\n'))) { lines = c; ch = true; break }
    }
  }
  return lines.join('\n')
}
// structural signature: direction, #connected-components, has-diamond, has-variable-length-link
function sig(src: string): string {
  const g = parseMermaid(src); const dir = src.match(/flowchart (\w+)/)?.[1]
  const adj = new Map<string, Set<string>>()
  for (const n of g.nodes.keys()) adj.set(n, new Set())
  for (const e of g.edges) { adj.get(e.source)?.add(e.target); adj.get(e.target)?.add(e.source) }
  const seen = new Set<string>(); let comps = 0
  for (const n of g.nodes.keys()) {
    if (seen.has(n)) continue
    comps++; const st = [n]
    while (st.length) { const x = st.pop()!; if (seen.has(x)) continue; seen.add(x); for (const y of adj.get(x) ?? []) st.push(y) }
  }
  const diamond = [...g.nodes.values()].some(n => n.shape === 'diamond')
  const longlink = g.edges.some(e => (e.length ?? 1) > 1)
  return `${dir} comp=${comps} diamond=${diamond} long=${longlink}`
}

const reps = new Map<string, { src: string; lines: number }>()
for (const [gen, N] of [[denseDag, 1200], [diamondFan, 800]] as [(i: number) => string, number][]) {
  for (let i = 0; i < N; i++) {
    const src = gen(i); if (!etn(src)) continue
    const m = shrink(src); const s = sig(m)
    if (!reps.has(s) || m.split('\n').length < reps.get(s)!.lines) reps.set(s, { src: m, lines: m.split('\n').length })
  }
}

const ordered = [...reps.entries()].sort((a, b) => a[1].lines - b[1].lines)
console.log(`distinct signatures among residual edgeThroughNode: ${ordered.length}`)
let k = 0
for (const [s, { src, lines }] of ordered) {
  const g = parseMermaid(src); const p = layoutGraphSync(g)
  console.log(`\n### rep ${++k} [${s}] ${lines} lines`)
  console.log(src)
  console.log('HARD:', hardViolations(assessLayout(g, p)).map(v => v.detail).join(' | '))
}
