// Unit tests for the A* pathfinder internals, written to kill mutation-testing
// survivors (see docs/mutation-testing.md). The golden corpus never observes
// these behaviors directly — preferred-direction ordering only decides ties
// between equal-cost paths, and mergePath's guards only matter for degenerate
// inputs — so each contract is pinned here at the unit level through the
// public exports (heuristic, getPath, mergePath).

import { describe, test, expect } from 'bun:test'
import { heuristic, getPath, mergePath } from '../ascii/pathfinder.ts'
import { gridKey, Up, Down, Left, Right, UpperRight, UpperLeft, LowerRight, LowerLeft } from '../ascii/types.ts'
import type { GridCoord, AsciiNode } from '../ascii/types.ts'

const NODE = {} as AsciiNode
const emptyGrid = () => new Map<string, AsciiNode>()
const gridWith = (...cells: GridCoord[]) => {
  const g = emptyGrid()
  for (const c of cells) g.set(gridKey(c), NODE)
  return g
}

describe('heuristic: Manhattan distance with corner penalty', () => {
  test('axis-aligned distances carry no corner penalty', () => {
    expect(heuristic({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3)
    expect(heuristic({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4)
    expect(heuristic({ x: 5, y: 2 }, { x: 1, y: 2 })).toBe(4)
    expect(heuristic({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0)
  })

  test('off-axis distances pay exactly +1 (a turn is unavoidable)', () => {
    expect(heuristic({ x: 0, y: 0 }, { x: 2, y: 3 })).toBe(6) // 2+3+1
    expect(heuristic({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(3) // 1+1+1
    expect(heuristic({ x: 4, y: 1 }, { x: 0, y: 5 })).toBe(9) // 4+4+1
  })
})

describe('getPath: preferred direction decides equal-cost ties', () => {
  // From (2,2) to a diagonal corner there are multiple shortest L-paths; the
  // FIFO tie-break makes the winner the first move direction A* tries, so the
  // second path cell observably encodes the preferredDir → moveDirs mapping.
  const FROM = { x: 2, y: 2 }

  test.each([
    ['Right', Right, { x: 5, y: 5 }, { x: 3, y: 2 }],
    ['Left', Left, { x: 0, y: 5 }, { x: 1, y: 2 }],
    ['Down', Down, { x: 5, y: 5 }, { x: 2, y: 3 }],
    ['Up', Up, { x: 5, y: 0 }, { x: 2, y: 1 }],
  ] as const)('%s: first step follows the preferred axis', (_name, dir, to, expectedFirstStep) => {
    const path = getPath(emptyGrid(), FROM, to, dir)
    expect(path).not.toBeNull()
    expect(path![0]).toEqual(FROM)
    expect(path![1]).toEqual(expectedFirstStep)
    expect(path![path!.length - 1]).toEqual(to)
    // Shortest path: Manhattan length + 1 cells.
    expect(path!.length).toBe(Math.abs(to.x - FROM.x) + Math.abs(to.y - FROM.y) + 1)
  })

  test('no preferred direction defaults to +x first', () => {
    const path = getPath(emptyGrid(), FROM, { x: 5, y: 5 })
    expect(path).not.toBeNull()
    expect(path![1]).toEqual({ x: 3, y: 2 })
    expect(path!.length).toBe(7)
  })

  test('corner attachment offsets fall back by dominant signed delta', () => {
    // Corner offsets miss the four explicit cardinal branches and use the
    // signed-delta fallback; with |dx| == |dy| the x-axis wins. Targets sit on
    // the exact diagonal so the tie is decided purely by move order.
    // UpperRight={2,0}: dx=+1 → +x first.
    expect(getPath(emptyGrid(), FROM, { x: 4, y: 0 }, UpperRight)![1]).toEqual({ x: 3, y: 2 })
    // LowerRight={2,2}: dx=+1 → +x first.
    expect(getPath(emptyGrid(), FROM, { x: 4, y: 4 }, LowerRight)![1]).toEqual({ x: 3, y: 2 })
    // UpperLeft={0,0} and LowerLeft={0,2}: dx=-1 → -x first.
    expect(getPath(emptyGrid(), FROM, { x: 0, y: 0 }, UpperLeft)![1]).toEqual({ x: 1, y: 2 })
    expect(getPath(emptyGrid(), FROM, { x: 0, y: 4 }, LowerLeft)![1]).toEqual({ x: 1, y: 2 })
  })

  test('routes around an obstacle but may end on an occupied destination', () => {
    // Wall directly right of FROM forces the Right-preferring path to detour,
    // yet a target that is itself occupied (a node border) stays reachable.
    const to = { x: 6, y: 2 }
    const grid = gridWith({ x: 3, y: 2 }, to)
    const path = getPath(grid, FROM, to, Right)
    expect(path).not.toBeNull()
    expect(path![path!.length - 1]).toEqual(to)
    // The detour must not pass through the blocked cell...
    expect(path!.some(c => c.x === 3 && c.y === 2)).toBe(false)
    // ...and never wanders into negative coordinates.
    expect(path!.every(c => c.x >= 0 && c.y >= 0)).toBe(true)
    // Detour costs exactly two extra cells over the straight line.
    expect(path!.length).toBe(5 + 2)
  })

  test('fully walled-off target returns null instead of hanging', () => {
    const to = { x: 4, y: 2 }
    const grid = gridWith(
      { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 },
      { x: 3, y: 2 }, { x: 5, y: 2 },
      { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
    )
    expect(getPath(grid, FROM, to, Right)).toBeNull()
  })
})

describe('mergePath: collapses straight runs, preserves every turn', () => {
  test('straight horizontal run collapses to its endpoints', () => {
    const merged = mergePath([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ])
    expect(merged).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }])
  })

  test('an L-path keeps exactly its corner', () => {
    const merged = mergePath([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 },
    ])
    expect(merged).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }])
  })

  test('a backtrack is NOT a straight run (dy matches, dx flips)', () => {
    const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }]
    expect(mergePath(path)).toEqual(path)
  })

  test('matching dx with differing dy is NOT a straight run', () => {
    // Not produced by 4-directional A*, but mergePath is a general utility:
    // a diagonal step followed by a horizontal one must keep the middle point.
    const path = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }]
    expect(mergePath(path)).toEqual(path)
    const path2 = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }]
    expect(mergePath(path2)).toEqual(path2)
  })

  test('paths of length ≤ 2 come back with identical contents', () => {
    expect(mergePath([])).toEqual([])
    expect(mergePath([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }])
    expect(mergePath([{ x: 1, y: 1 }, { x: 1, y: 2 }])).toEqual([{ x: 1, y: 1 }, { x: 1, y: 2 }])
  })
})
