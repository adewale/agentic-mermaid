// Equal-cost routes must be repeatable, valid and shortest. The routing
// algorithm and its default tie-break order are implementation choices;
// reviewed ASCII goldens protect deliberate changes to rendered appearance.

import { describe, test, expect } from 'bun:test'
import { getPath } from '../ascii/pathfinder.ts'
import type { AsciiNode } from '../ascii/types.ts'

const emptyGrid = (): Map<string, AsciiNode> => new Map()

describe('getPath determinism and preferredDir', () => {
  test('equal-cost routes are deterministic across repeated calls', () => {
    // An open grid from (0,0) to (4,4) has many equal-length L-shaped routes.
    // Any shortest route is acceptable, provided repeated calls agree.
    const grid = emptyGrid()
    const first = JSON.stringify(getPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 }))
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(getPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 }))).toBe(first)
    }
    expect(first).not.toBe('null')
  })

  test('equal-cost routes reach both endpoints using only shortest orthogonal steps', () => {
    const start = { x: 0, y: 0 }, end = { x: 2, y: 2 }
    const path = getPath(emptyGrid(), start, end)
    expect(path).not.toBeNull()
    expect(path![0]).toEqual(start)
    expect(path!.at(-1)).toEqual(end)
    expect(path).toHaveLength(5) // Manhattan distance + the starting cell.
    for (let i = 1; i < path!.length; i++) {
      const previous = path![i - 1]!, current = path![i]!
      expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(1)
    }
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
})
