import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { smallFeedbackCuts } from '../layout/small-feedback-cuts.ts'
import type { MeasuredGraph } from '../layout/agentic-layered-core.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

function permutations(values: number[]): number[][] {
  return values.length ? values.flatMap(value => permutations(values.filter(other => other !== value)).map(rest => [value, ...rest])) : [[]]
}
const orders = permutations([0, 1, 2, 3, 4]).map(sequence => Int32Array.from(sequence, (_, node) => sequence.indexOf(node)))
const cutKey = (input: MeasuredGraph, order: Int32Array) => input.edges.map(edge => Number(order[edge.source]! > order[edge.target]!)).join('')
function cyclic(extra: readonly { source: number; target: number }[]): MeasuredGraph {
  return { nodes: Array.from({ length: 5 }, (_, index) => ({ id: String(index), width: 40, height: 30 })),
    edges: [...Array.from({ length: 5 }, (_, source) => ({ source, target: (source + 1) % 5 })), ...extra.filter(edge => edge.source !== edge.target)].map(edge => ({ ...edge, minSpan: 1 })),
    compactPrivateRanks: true, direction: 'TB', padding: 20, nodeSpacing: 20, layerSpacing: 30 }
}

describe('bounded small feedback cuts', () => {
  test.each([2, 3] as const)('matches exhaustive minimum reversal cuts of cyclic multigraphs up to %s edges', maximum => {
    fc.assert(fc.property(fc.array(fc.record({ source: fc.integer({ min: 0, max: 4 }), target: fc.integer({ min: 0, max: 4 }) }), { maxLength: 6 }), extra => {
      const input = cyclic(extra), before = structuredClone(input)
      const keys = orders.map(order => cutKey(input, order))
      const count = (key: string) => [...key].filter(bit => bit === '1').length
      const minimum = Math.min(...keys.map(count))
      const expected = minimum <= maximum ? [...new Set(keys.filter(key => count(key) === minimum))].sort() : []
      const cuts = smallFeedbackCuts(input, { blockPairs: 2_000_000 }, maximum)
      expect(cuts.map(cut => cutKey(input, cut.order)).sort()).toEqual(expected)
      expect(input).toEqual(before)
      for (const cut of cuts) {
        expect([...cut.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
        expect(cut.span).toBeGreaterThanOrEqual(input.edges.length)
      }
    }), fcParameters({ numRuns: 128, examples: [[[{ source: 1, target: 0 }, { source: 2, target: 1 }, { source: 3, target: 2 }]]] }))
  })

  test('exhaustion returns only completed orders without changing the graph', () => {
    const input = cyclic([{ source: 1, target: 3 }, { source: 3, target: 1 }]), before = structuredClone(input)
    expect(smallFeedbackCuts(input, { blockPairs: 1 })).toEqual([])
    for (const budget of [40, 200, 1000]) {
      const work = { blockPairs: budget }, cuts = smallFeedbackCuts(input, work)
      expect(work.blockPairs).toBeGreaterThanOrEqual(0)
      expect(work.blockPairs).toBeLessThanOrEqual(budget)
      for (const cut of cuts) {
        expect([...cut.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
        expect([...cutKey(input, cut.order)].filter(bit => bit === '1')).toHaveLength(2)
      }
    }
    expect(input).toEqual(before)
  })

  test('three-cut cycle branching retains complete feasible orders on exhaustion', () => {
    const input = cyclic([{ source: 1, target: 0 }, { source: 2, target: 1 }, { source: 3, target: 2 }])
    const before = structuredClone(input)
    for (const budget of [1, 40, 200, 1000, 3000, 10000]) {
      const work = { blockPairs: budget }, cuts = smallFeedbackCuts(input, work, 3)
      expect(work.blockPairs).toBeGreaterThanOrEqual(0)
      expect(work.blockPairs).toBeLessThanOrEqual(budget)
      for (const cut of cuts) {
        expect([...cut.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
        expect([...cutKey(input, cut.order)].filter(bit => bit === '1')).toHaveLength(3)
      }
    }
    expect(input).toEqual(before)
  })

})
