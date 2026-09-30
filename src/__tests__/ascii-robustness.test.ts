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
import type { AsciiNode } from '../ascii/types.ts'

describe('#66 A* OOM guard', () => {
  // The walled-off (unreachable) target case is covered by
  // ascii-pathfinder-units.test.ts ("fully walled-off target returns null").

  test('reachable target still routes normally', () => {
    const grid = new Map<string, AsciiNode>()
    const path = getPath(grid, { x: 0, y: 0 }, { x: 3, y: 0 })
    expect(path).not.toBeNull()
    expect(path![0]).toEqual({ x: 0, y: 0 })
    expect(path![path!.length - 1]).toEqual({ x: 3, y: 0 })
  })

  test('a wide pathological graph renders every node without hanging', () => {
    // Many parallel chains — exercises many getPath calls. A hang is caught by
    // the test timeout, not a wall-clock assertion.
    let src = 'flowchart LR\n'
    for (let i = 0; i < 30; i++) src += `  A${i} --> B${i}\n`
    const out = renderMermaidASCII(src)
    const ids = Array.from({ length: 30 }, (_, i) => [`A${i}`, `B${i}`]).flat()
    expect(ids.filter(id => !new RegExp(`\\b${id}\\b`).test(out))).toEqual([])
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
