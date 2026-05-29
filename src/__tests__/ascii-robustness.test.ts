// Loop 10 M4 (ktrysmt #66/#67): ASCII robustness guards.
//
// #66 A* OOM guard: getPath now bounds exploration to the grid extent + a
//   margin, plus a hard iteration cap. An unreachable/walled target returns
//   null (caller falls back to a direct route) instead of exhausting memory.
// #67 root detection: flowchart layout already places no-incoming-edge nodes
//   at the top (grid.ts initialRoots). Verified here.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { getPath } from '../ascii/pathfinder.ts'
import type { AsciiNode, GridCoord } from '../ascii/types.ts'
import { gridKey } from '../ascii/types.ts'

describe('#66 A* OOM guard', () => {
  test('unreachable target returns null instead of hanging', () => {
    // Wall off the target completely: surround (5,5) with occupied cells.
    const grid = new Map<string, AsciiNode>()
    const fake = { name: 'x' } as unknown as AsciiNode
    const offsets: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]
    for (const [dx, dy] of offsets) {
      grid.set(gridKey({ x: 5 + dx, y: 5 + dy }), fake)
    }
    const from: GridCoord = { x: 0, y: 0 }
    const to: GridCoord = { x: 5, y: 5 }
    const start = Date.now()
    const path = getPath(grid, from, to)
    const elapsed = Date.now() - start
    // The walled target is unreachable → null, and fast (bounded search).
    expect(path).toBeNull()
    expect(elapsed).toBeLessThan(2000)
  })

  test('reachable target still routes normally', () => {
    const grid = new Map<string, AsciiNode>()
    const path = getPath(grid, { x: 0, y: 0 }, { x: 3, y: 0 })
    expect(path).not.toBeNull()
    expect(path![0]).toEqual({ x: 0, y: 0 })
    expect(path![path!.length - 1]).toEqual({ x: 3, y: 0 })
  })

  test('a wide pathological graph renders without hanging', () => {
    // Many parallel chains — exercises many getPath calls.
    let src = 'flowchart LR\n'
    for (let i = 0; i < 30; i++) src += `  A${i} --> B${i}\n`
    const start = Date.now()
    const out = renderMermaidASCII(src)
    const elapsed = Date.now() - start
    expect(out.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(10_000)
  })
})

describe('#67 root detection', () => {
  test('a root node (no incoming edges) appears above its children in TD', () => {
    const out = renderMermaidASCII('flowchart TD\n  Root --> Child\n  Child --> Leaf')
    const lines = out.split('\n')
    const rowOf = (label: string) => lines.findIndex(l => l.includes(label))
    expect(rowOf('Root')).toBeGreaterThanOrEqual(0)
    expect(rowOf('Root')).toBeLessThan(rowOf('Child'))
    expect(rowOf('Child')).toBeLessThan(rowOf('Leaf'))
  })

  test('declaration order does not bury the real root below its descendants', () => {
    // Child-edge declared before the external root that feeds it. Start has no
    // incoming edge, so it must be at the top level — at or above A, and
    // never below B (its grandchild). It need not be strictly above A: the
    // layout legitimately places Start and A on the same top row (Start feeds
    // A from the side; A→B descends).
    const out = renderMermaidASCII('flowchart TD\n  A --> B\n  Start --> A')
    const lines = out.split('\n')
    const rowOf = (label: string) => lines.findIndex(l => l.includes(label))
    expect(rowOf('Start')).toBeLessThanOrEqual(rowOf('A'))
    expect(rowOf('Start')).toBeLessThan(rowOf('B'))
  })
})
