import { expect, test } from 'bun:test'
import { createInkIndex, type InkBounds } from '../shared/ink-index.ts'

test('ink queries preserve strict intersections through mixed axes, ties and reversed input', () => {
  const rows = Array.from({ length: 97 }, (_, id) => ({ id, x0: id % 11 * 7, y0: Math.floor(id / 11) * 13, x1: id % 11 * 7 + 5 + id % 3, y1: Math.floor(id / 11) * 13 + 8 }))
  const queries: InkBounds[] = rows.flatMap(row => [
    { x0: row.x0, y0: row.y0, x1: row.x1, y1: row.y1 },
    { x0: row.x1, y0: row.y0, x1: row.x1, y1: row.y1 },
    { x0: row.x0, y0: row.y1, x1: row.x1, y1: row.y1 },
    { x0: row.x0 - 30, y0: row.y0 - 2, x1: row.x1 + 30, y1: row.y1 + 2 },
  ])
  const overlaps = (low: number, high: number, start: number, end: number) => low === high ? start < low && low < end : Math.max(low, start) < Math.min(high, end)
  for (const input of [rows, rows.toReversed()]) {
    const original = structuredClone(input)
    const query = createInkIndex(input, row => row, () => {}, queries.length)
    for (const box of queries) {
      // Zero-width/height queries are segment/point probes: their coordinates
      // must be strictly inside the indexed bounds in that dimension.
      const expected = rows.filter(row => overlaps(box.x0, box.x1, row.x0, row.x1) && overlaps(box.y0, box.y1, row.y0, row.y1))
      expect(query(box).map(row => row.id).sort((a, b) => a - b)).toEqual(expected.map(row => row.id).sort((a, b) => a - b))
    }
    expect(input).toEqual(original)
  }
})
