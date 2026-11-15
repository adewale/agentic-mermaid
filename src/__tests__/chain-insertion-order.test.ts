import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { refinePrivateChainOrder } from '../layout/chain-insertion-order.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

function example(flags: readonly boolean[]) {
  const bands = Array.from({ length: 4 }, (_, rank) => [rank * 3, rank * 3 + 1, rank * 3 + 2])
  const vertices = bands.flatMap((row, rank) => row.map(() => ({ rank, incoming: [] as number[], outgoing: [] as number[] })))
  const add = (a: number, b: number) => { vertices[a]!.outgoing.push(b); vertices[b]!.incoming.push(a) }
  add(0, 3); add(3, 6); add(6, 9)
  let index = 0
  for (let rank = 0; rank < 3; rank++) for (const a of bands[rank]!) for (const b of bands[rank + 1]!) {
    if ((rank > 0 && a === rank * 3) || (rank < 2 && b === (rank + 1) * 3)) continue
    if (flags[index++]) add(a, b)
  }
  return { bands, vertices, chains: [[0, 3, 6, 9]] }
}

function score(bands: readonly number[][], vertices: ReturnType<typeof example>['vertices']): number {
  const order = new Map(bands.flatMap(row => row.map((id, slot) => [id, slot] as const)))
  let count = 0
  for (const row of bands.slice(0, -1)) {
    const arcs = row.flatMap(a => vertices[a]!.outgoing.map(b => [a, b] as const))
    for (let i = 0; i < arcs.length; i++) for (let j = i + 1; j < arcs.length; j++) {
      const [a, b] = arcs[i]!, [c, d] = arcs[j]!
      if ((order.get(a)! - order.get(c)!) * (order.get(b)! - order.get(d)!) < 0) count++
    }
  }
  return count
}

describe('bounded private-chain insertion', () => {
  test('matches exhaustive simultaneous insertions while keeping every other vertex fixed', () => {
    const permutation = fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 })
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 16, maxLength: 16 }), fc.tuple(permutation, permutation, permutation, permutation), (flags, orders) => {
      const input = example(flags)
      input.bands = orders.map((order, rank) => order.map(slot => rank * 3 + slot))
      const before = structuredClone(input)
      let best = Infinity
      for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) {
        const trial = structuredClone(input.bands)
        trial[1] = trial[1]!.filter(id => id !== 3); trial[1]!.splice(a, 0, 3)
        trial[2] = trial[2]!.filter(id => id !== 6); trial[2]!.splice(b, 0, 6)
        best = Math.min(best, score(trial, input.vertices))
      }
      const work = { blockPairs: 100_000 }
      refinePrivateChainOrder(input.bands, input.vertices, input.chains, work)
      expect(score(input.bands, input.vertices)).toBe(best)
      expect(input.vertices).toEqual(before.vertices)
      expect(input.chains).toEqual(before.chains)
      for (let rank = 0; rank < 4; rank++) expect(input.bands[rank]!.filter(id => id !== 3 && id !== 6)).toEqual(before.bands[rank]!.filter(id => id !== 3 && id !== 6))
      const incomplete = structuredClone(before.bands)
      refinePrivateChainOrder(incomplete, input.vertices, input.chains, { blockPairs: 100_000 - work.blockPairs - 1 })
      expect(incomplete).toEqual(before.bands)
    }), fcParameters({ numRuns: 128 }))
  })

  test('retains feasible ordering with no work and declines branches inside private chains', () => {
    const input = example(Array(16).fill(true)), before = structuredClone(input.bands)
    refinePrivateChainOrder(input.bands, input.vertices, input.chains, { blockPairs: 0 })
    expect(input.bands).toEqual(before)
    input.vertices[3]!.outgoing.push(7)
    const work = { blockPairs: 1000 }
    refinePrivateChainOrder(input.bands, input.vertices, input.chains, work)
    expect(input.bands).toEqual(before)
    expect(work.blockPairs).toBe(1000)
  })
})
