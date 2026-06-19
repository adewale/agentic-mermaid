// Move 5: targeted (search-guided) PBT finds stress inputs that random sampling
// rarely hits (Löscher & Sagonas, ISSTA 2017). The fast unit test uses a CHEAP
// combinatorial crossing proxy (interleaveFitness — no ELK) so the "guidance
// beats random" claim can be asserted per-PR without 30s of layout; the real
// ELK-crossing version (crossingFitness) is exercised by the opt-in runner in
// eval/targeted/search.ts, where guided beat random 7/8 with a ~5x margin.
//
// Finding while building this: on a TINY graph space (4-node flowcharts) the
// fitness is too flat and guidance cannot beat random — the search space has to
// have a gradient. randomFlowSpec uses 8–12 nodes for that reason.

import { describe, test, expect } from 'bun:test'
import {
  mulberry32, searchMaximize, interleaveFitness, randomFlowSpec, flowNeighbors,
  type FlowSpec,
} from '../../eval/targeted/search.ts'

const search = (seed: number) => searchMaximize<FlowSpec>({
  initial: randomFlowSpec, neighbors: flowNeighbors, fitness: interleaveFitness,
  iterations: 25, restarts: 6, rng: mulberry32(seed),
})

describe('targeted PBT: search-guided crossing maximization', () => {
  test('guided search beats equal-budget random on a MAJORITY of seeds', () => {
    const seeds = [1, 7, 42, 99, 123, 500, 777, 2024]
    let guidedWins = 0
    for (const seed of seeds) {
      const guided = search(seed)
      const rng2 = mulberry32(seed * 31 + 1)
      let randomBest = 0
      for (let i = 0; i < guided.evaluations; i++) randomBest = Math.max(randomBest, interleaveFitness(randomFlowSpec(rng2)))
      if (guided.score > randomBest) guidedWins++
    }
    expect(guidedWins).toBeGreaterThanOrEqual(6)
  })

  test('guided search climbs above its random starting point', () => {
    const rng = mulberry32(2025)
    const start = interleaveFitness(randomFlowSpec(rng))
    const guided = search(2025)
    expect(guided.score).toBeGreaterThanOrEqual(start)
    expect(guided.score).toBeGreaterThan(0)
  })

  test('the search is deterministic for a fixed seed', () => {
    expect(search(999).score).toBe(search(999).score)
  })
})
