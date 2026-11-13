import { expect, test } from 'bun:test'
import { simplifyOrthogonalPoints } from '../architecture/layout.ts'
import type { Point } from '../types.ts'

// Frozen restart-and-splice reference: the stack implementation must preserve
// its treatment of repeated input points, collinear reversals and diagonals.
function reference(points: readonly Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const last = result.at(-1)
    if (!last || last.x !== point.x || last.y !== point.y) result.push(point)
  }
  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i + 1 < result.length; i++) {
      const a = result[i - 1]!, b = result[i]!, c = result[i + 1]!
      if (a.x === b.x && b.x === c.x || a.y === b.y && b.y === c.y) {
        result.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return result
}

test('linear Architecture simplification preserves restart reduction on mixed and backtracking paths', () => {
  let state = 0x4492398
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  for (let sample = 0; sample < 1_000; sample++) {
    const points: Point[] = [], length = Math.floor(random() * 30)
    for (let i = 0; i < length; i++) {
      const last = points.at(-1), x = Math.floor(random() * 5), y = Math.floor(random() * 5)
      points.push(last && sample % 3 === 0 ? { x: last.x, y } : last && sample % 3 === 1 ? { x, y: last.y } : { x, y })
    }
    const original = structuredClone(points)
    expect(simplifyOrthogonalPoints(points)).toEqual(reference(points))
    expect(simplifyOrthogonalPoints([...points].reverse())).toEqual(reference([...points].reverse()))
    expect(points).toEqual(original)
  }
})

test('long collinear routes retain their original end contacts', () => {
  const points = Array.from({ length: 20_000 }, (_, x) => ({ x, y: 0 }))
  expect(simplifyOrthogonalPoints(points)).toEqual([points[0]!, points.at(-1)!])
  expect(simplifyOrthogonalPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }])
})
