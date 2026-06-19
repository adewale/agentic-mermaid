// Targeted property-based testing (Move 5): Löscher & Sagonas (ISSTA 2017) make
// input generation SEARCH-GUIDED by a fitness function instead of purely random,
// so the generator hunts for the inputs that stress the code (here: maximize
// edge crossings, or find a quality-bound violation) rather than waiting for
// random luck. This replaces the manual "probe → calibrate → pin a hard fixture"
// loop the testing-tools work had been doing by hand with automated search.

import { parseMermaid, layoutMermaid, measureQuality } from '../../src/agent/index.ts'

// ---- deterministic RNG (so the search is reproducible in tests) ------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- generic hill-climb with random restarts -------------------------------
export interface SearchResult<S> { best: S; score: number; evaluations: number }

export function searchMaximize<S>(opts: {
  initial: (rng: () => number) => S
  neighbors: (s: S, rng: () => number) => S[]
  fitness: (s: S) => number
  iterations: number
  restarts: number
  rng: () => number
}): SearchResult<S> {
  let best: S | undefined
  let bestScore = -Infinity
  let evaluations = 0
  const score = (s: S) => { evaluations++; return opts.fitness(s) }
  for (let r = 0; r < opts.restarts; r++) {
    let cur = opts.initial(opts.rng)
    let curScore = score(cur)
    for (let i = 0; i < opts.iterations; i++) {
      let improved = false
      for (const n of opts.neighbors(cur, opts.rng)) {
        const s = score(n)
        if (s > curScore) { cur = n; curScore = s; improved = true }
      }
      if (!improved) break  // local optimum → restart
    }
    if (curScore > bestScore) { best = cur; bestScore = curScore }
  }
  return { best: best as S, score: bestScore, evaluations }
}

// ---- flowchart search space ------------------------------------------------
export interface FlowSpec { k: number; edges: Array<[number, number]> }

export function specToSource(spec: FlowSpec): string {
  const lines = ['flowchart TD']
  for (let i = 0; i < spec.k; i++) lines.push(`  n${i}["N${i}"]`)
  for (const [a, b] of spec.edges) lines.push(`  n${a} --> n${b}`)
  return lines.join('\n')
}

/** Fitness = rendered edge-crossing count (0 if the source fails to render).
 *  Realistic but SLOW (runs ELK); use it via the opt-in runner, not a unit test. */
export function crossingFitness(spec: FlowSpec): number {
  const p = parseMermaid(specToSource(spec))
  if (!p.ok) return 0
  try { return measureQuality(layoutMermaid(p.value)).edgeCrossings } catch { return 0 }
}

/** Cheap combinatorial proxy for crossings: edge pairs that interleave on the
 *  natural 0..k-1 node ordering. Pure O(edges²), no rendering — a non-trivial
 *  landscape for unit-testing that guided search beats random, without ELK. */
export function interleaveFitness(spec: FlowSpec): number {
  const e = spec.edges.map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const)
  let crossings = 0
  for (let i = 0; i < e.length; i++) {
    for (let j = i + 1; j < e.length; j++) {
      const [a1, b1] = e[i]!, [a2, b2] = e[j]!
      if ((a1 < a2 && a2 < b1 && b1 < b2) || (a2 < a1 && a1 < b2 && b2 < b1)) crossings++
    }
  }
  return crossings
}

export function randomFlowSpec(rng: () => number): FlowSpec {
  // A richer space than tiny graphs: crossings need enough nodes/edges to have a
  // gradient for the search to climb (on 4-node graphs the fitness is too flat
  // and guidance can't beat random — an empirical finding when building this).
  const k = 8 + Math.floor(rng() * 5)   // 8..12 nodes
  const m = 8 + Math.floor(rng() * 8)   // 8..15 edges
  const edges: Array<[number, number]> = []
  for (let i = 0; i < m; i++) {
    const a = Math.floor(rng() * k), b = Math.floor(rng() * k)
    if (a !== b) edges.push([a, b])
  }
  return { k, edges }
}

export function flowNeighbors(s: FlowSpec, rng: () => number): FlowSpec[] {
  const out: FlowSpec[] = []
  // Several add-edge candidates per step (more neighbors → fewer false plateaus).
  for (let t = 0; t < 6; t++) {
    const a = Math.floor(rng() * s.k), b = Math.floor(rng() * s.k)
    if (a !== b) out.push({ k: s.k, edges: [...s.edges, [a, b]] })
  }
  // and one remove, so the search can also back out of a bad edge.
  if (s.edges.length > 2) out.push({ k: s.k, edges: s.edges.filter((_, i) => i !== Math.floor(rng() * s.edges.length)) })
  return out
}

// Opt-in runner: demonstrate guided vs random on the REAL ELK crossing fitness
// (slow). `bun run eval/targeted/search.ts`
if (import.meta.main) {
  let guidedWins = 0
  for (const seed of [1, 7, 42, 99, 123, 500, 777, 2024]) {
    const g = searchMaximize<FlowSpec>({ initial: randomFlowSpec, neighbors: flowNeighbors, fitness: crossingFitness, iterations: 20, restarts: 5, rng: mulberry32(seed) })
    const r2 = mulberry32(seed * 31 + 1)
    let rb = 0
    for (let i = 0; i < g.evaluations; i++) rb = Math.max(rb, crossingFitness(randomFlowSpec(r2)))
    if (g.score > rb) guidedWins++
    console.log(`seed=${seed}: guided=${g.score} random=${rb} (${g.evaluations} evals)`)
  }
  console.log(`guided wins ${guidedWins}/8 on real ELK crossings`)
}
