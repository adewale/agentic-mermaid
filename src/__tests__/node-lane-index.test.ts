import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { buildNodeLaneIndex, nodeLaneCell, nodeLaneIndexForQuery, type NodeLaneIndexes } from '../shared/node-lane-index.ts'
import type { PositionedNode } from '../types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

function node(x: number, y: number, width: number, height: number): PositionedNode {
  return { id: 'duplicate', label: '', shape: 'rectangle', x, y, width, height }
}

/** Exercise the same strict geometric interval after the broad phase. */
function candidates(nodes: PositionedNode[], axis: 'x' | 'y', coordinate: number): number[] {
  const index = buildNodeLaneIndex(nodes, axis, 4)
  const cell = index ? nodeLaneCell(index, coordinate) : null
  const ordinals = index && cell !== null
    ? [...index.ordinals.subarray(index.offsets[cell] ?? 0, index.offsets[cell + 1] ?? 0)]
    : nodes.map((_, ordinal) => ordinal)
  return ordinals.filter(ordinal => {
    const n = nodes[ordinal]!
    return coordinate > n[axis] - 4 && coordinate < n[axis] + (axis === 'x' ? n.width : n.height) + 4
  })
}

describe('ordered node lane broad phase', () => {
  it('builds each owned axis lazily and reuses its frozen geometry', () => {
    let coordinateReads = 0
    const nodes = Array.from({ length: 40 }, (_, i) => {
      const value = node(i % 4 * 128, i % 4 * 128, 20, 20)
      Object.defineProperty(value, 'x', { enumerable: true, get: () => { coordinateReads++; return i % 4 * 128 } })
      return value
    })
    const cache: NodeLaneIndexes = {}
    expect(coordinateReads).toBe(0)
    const selected = nodeLaneIndexForQuery(cache, nodes, 'x', 4)
    expect(coordinateReads).toBeGreaterThan(0)
    expect(selected).not.toBeNull()
    const reads = coordinateReads
    expect(nodeLaneIndexForQuery(cache, nodes, 'x', 4)).toBe(selected)
    expect(coordinateReads).toBe(reads)
    expect(cache.y).toBeUndefined()
    nodeLaneIndexForQuery(cache, nodes, 'y', 4)
    expect(cache.y).not.toBeNull()
  })

  it('does not index live/custom-host geometry', () => {
    const nodes = Array.from({ length: 40 }, () => node(0, 0, 20, 20))
    Object.defineProperty(nodes[0]!, 'x', { get: () => { throw new Error('live geometry must not be snapshotted') } })
    expect(nodeLaneIndexForQuery(undefined, nodes, 'x', 4)).toBeUndefined()
  })

  it('preserves duplicate occurrences and exact strict boundaries in both axes', () => {
    const repeated = node(124, -132, 128, 128)
    const nodes = Array.from({ length: 40 }, (_, i) => i % 2 ? repeated : node(-132, 124, 128, 128))
    for (const axis of ['x', 'y'] as const) {
      expect(buildNodeLaneIndex(nodes, axis, 4)).not.toBeNull()
      for (const coordinate of [-136, -128, -Number.MIN_VALUE, -0, 0, Number.MIN_VALUE, 120, 128, 256]) {
        const expected = nodes.flatMap((n, i) => coordinate > n[axis] - 4 && coordinate < n[axis] + (axis === 'x' ? n.width : n.height) + 4 ? [i] : [])
        expect(candidates(nodes, axis, coordinate)).toEqual(expected)
      }
    }
  })

  it('falls back for sparse, excessive, non-finite or unsafe cell ranges', () => {
    for (const bad of [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE]) {
      const nodes = Array.from({ length: 40 }, () => node(0, 0, 20, 20))
      nodes[39]!.x = bad
      expect(buildNodeLaneIndex(nodes, 'x', 4)).toBeNull()
    }
    expect(buildNodeLaneIndex(Array.from({ length: 40 }, (_, i) => node(i * 1e9, 0, 20, 20)), 'x', 4)).toBeNull()
    expect(buildNodeLaneIndex(Array.from({ length: 40 }, () => node(0, 0, 1e6, 20)), 'x', 4)).toBeNull()
    expect(buildNodeLaneIndex([node(0, 0, 20, 20)], 'x', 4)).toBeNull()
  })

  it('matches an independent linear scan across finite floating-point intervals', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.double({ min: 0, max: 1024, noNaN: true })), { minLength: 32, maxLength: 96 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      (intervals, coordinate) => {
        const nodes = intervals.map(([start, size]) => node(start, start, size, size))
        const expected = intervals.flatMap(([start, size], ordinal) => coordinate > start - 4 && coordinate < start + size + 4 ? [ordinal] : [])
        expect(candidates(nodes, 'x', coordinate)).toEqual(expected)
      },
    ), fcParameters({ numRuns: 1000 }))
  })

  it('matches an independent scan when dense cells actually build', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.double({ min: -1024, max: 1024, noNaN: true }), fc.double({ min: 0, max: 128, noNaN: true })), { minLength: 32, maxLength: 128 }),
      fc.double({ min: -1200, max: 1400, noNaN: true }),
      (intervals, coordinate) => {
        const nodes = intervals.map(([start, size]) => node(start, start, size, size))
        expect(buildNodeLaneIndex(nodes, 'x', 4)).not.toBeNull()
        expect(candidates(nodes, 'x', coordinate)).toEqual(intervals.flatMap(([start, size], i) => coordinate > start - 4 && coordinate < start + size + 4 ? [i] : []))
      },
    ), fcParameters({ numRuns: 1000 }))
  })
})
