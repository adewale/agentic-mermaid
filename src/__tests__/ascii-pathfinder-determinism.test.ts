// BUILD-10 (#113 port): pathfinder determinism + preferredDir capability.
//
// The #111 fan-out detour fix in this fork is driven by deterministic FIFO
// tie-breaking in the A* MinHeap: equal-cost routes must resolve to the SAME
// path regardless of incidental heap topology. These unit tests pin that
// determinism directly at the pathfinder layer, and exercise the `preferredDir`
// neighbour-ordering parameter that the port adds for API parity.

import { describe, test, expect } from 'bun:test'
import { getPath } from '../ascii/pathfinder.ts'
import type { AsciiNode } from '../ascii/types.ts'

const emptyGrid = (): Map<string, AsciiNode> => new Map()

describe('getPath determinism and preferredDir', () => {
  test('equal-cost routes are deterministic across repeated calls', () => {
    // An open grid from (0,0) to (4,4) has many equal-length L-shaped routes.
    // FIFO tie-breaking must pick the SAME one every time.
    const grid = emptyGrid()
    const first = JSON.stringify(getPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 }))
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(getPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 }))).toBe(first)
    }
    expect(first).not.toBe('null')
  })

  test('preferredDir biases the first leg without changing endpoints or length', () => {
    const grid = emptyGrid()
    const base = getPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 })!
    const downFirst = getPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 1 })!
    const rightFirst = getPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 1, y: 0 })!
    // Same endpoints regardless of bias.
    expect(downFirst[0]).toEqual({ x: 0, y: 0 })
    expect(downFirst[downFirst.length - 1]).toEqual({ x: 4, y: 4 })
    expect(rightFirst[rightFirst.length - 1]).toEqual({ x: 4, y: 4 })
    // Manhattan-optimal: every route has the same total cell count.
    expect(downFirst.length).toBe(base.length)
    expect(rightFirst.length).toBe(base.length)
    // The two biased routes commit to different first legs.
    expect(JSON.stringify(downFirst)).not.toBe(JSON.stringify(rightFirst))
  })

  test('returns null when target is walled off (bounded search, no hang)', () => {
    const grid = emptyGrid()
    const wall = {} as AsciiNode
    // Box (2,2) completely in by occupying its 4-neighbourhood.
    grid.set('1,2', wall)
    grid.set('3,2', wall)
    grid.set('2,1', wall)
    grid.set('2,3', wall)
    expect(getPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull()
  })
})
