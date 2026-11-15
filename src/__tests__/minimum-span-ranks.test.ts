import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { minimumSpanRanks } from '../layout/minimum-span-ranks.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

const nodes = Array.from({ length: 4 }, (_, index) => ({ id: String(index), width: 40, height: 40 }))

describe('bounded minimum-span rank assignment', () => {
  test('matches exhaustive feasible assignments on small weighted DAGs', () => {
    fc.assert(fc.property(fc.array(fc.option(fc.integer({ min: 1, max: 2 })), { minLength: 6, maxLength: 6 }), spans => {
      const edges: { source: number; target: number; minSpan: number }[] = []
      let index = 0
      for (let source = 0; source < 4; source++) for (let target = source + 1; target < 4; target++) {
        const minSpan = spans[index++]
        if (minSpan !== null && minSpan !== undefined) edges.push({ source, target, minSpan })
      }
      const input = { nodes, edges }, original = structuredClone(input)
      const ranks = minimumSpanRanks(input, { rankPairs: 1_000_000 })!
      expect(input).toEqual(original)
      expect(Array.from(ranks).every(rank => Number.isSafeInteger(rank) && rank >= 0)).toBe(true)
      expect(edges.every(edge => ranks[edge.target]! - ranks[edge.source]! >= 2 * edge.minSpan)).toBe(true)
      let best = Infinity
      for (let a = 0; a <= 12; a++) for (let b = 0; b <= 12; b++) for (let c = 0; c <= 12; c++) for (let d = 0; d <= 12; d++) {
        const values = [a, b, c, d]
        if (edges.some(edge => values[edge.target]! - values[edge.source]! < 2 * edge.minSpan)) continue
        best = Math.min(best, edges.reduce((sum, edge) => sum + values[edge.target]! - values[edge.source]!, 0))
      }
      expect(edges.reduce((sum, edge) => sum + ranks[edge.target]! - ranks[edge.source]!, 0)).toBe(best)
    }), fcParameters({ numRuns: 64 }))
  })

  test('minimizes compact private ranks with a reserved rank only for measured labels', () => {
    fc.assert(fc.property(fc.array(fc.option(fc.record({ minSpan: fc.integer({ min: 1, max: 2 }), labelled: fc.boolean() })), { minLength: 6, maxLength: 6 }), constraints => {
      const edges: { source: number; target: number; minSpan: number; label?: { width: number; height: number } }[] = []
      let index = 0
      for (let source = 0; source < 4; source++) for (let target = source + 1; target < 4; target++) {
        const constraint = constraints[index++]
        if (constraint) edges.push({ source, target, minSpan: constraint.minSpan, ...(constraint.labelled ? { label: { width: 40, height: 12 } } : {}) })
      }
      const input = { nodes, edges, compactPrivateRanks: true }, original = structuredClone(input)
      const ranks = minimumSpanRanks(input, { rankPairs: 1_000_000 })!
      const span = (edge: typeof edges[number]) => (edge.label ? 2 : 1) * edge.minSpan
      expect(input).toEqual(original)
      expect(Array.from(ranks).every(rank => Number.isSafeInteger(rank) && rank >= 0)).toBe(true)
      expect(edges.every(edge => ranks[edge.target]! - ranks[edge.source]! >= span(edge))).toBe(true)
      let best = Infinity
      for (let a = 0; a <= 12; a++) for (let b = 0; b <= 12; b++) for (let c = 0; c <= 12; c++) for (let d = 0; d <= 12; d++) {
        const values = [a, b, c, d]
        if (edges.some(edge => values[edge.target]! - values[edge.source]! < span(edge))) continue
        best = Math.min(best, edges.reduce((sum, edge) => sum + values[edge.target]! - values[edge.source]!, 0))
      }
      expect(edges.reduce((sum, edge) => sum + ranks[edge.target]! - ranks[edge.source]!, 0)).toBe(best)
    }), fcParameters({ numRuns: 64 }))
  })

  test('retains empty graphs and declines optional work without mutating constraints', () => {
    expect(Array.from(minimumSpanRanks({ nodes: [], edges: [] }, { rankPairs: 10 })!)).toEqual([])
    const input = { nodes, edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }, { source: 0, target: 2, minSpan: 1 }] }
    const before = structuredClone(input), work = { rankPairs: 1 }
    expect(minimumSpanRanks(input, work)).toBeUndefined()
    expect(work.rankPairs).toBeLessThan(0)
    expect(input).toEqual(before)
    expect(minimumSpanRanks({ ...input, nodes: Array.from({ length: 65 }, (_, index) => ({ id: String(index), width: 1, height: 1 })) }, { rankPairs: 1_000_000 })).toBeUndefined()
  })
})
