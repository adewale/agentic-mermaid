import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { rotateBoxBounds, rotatePoint } from '../shared/transformed-bounds.ts'

const close = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(1e-9)

describe('transformed bounds geometry kernel', () => {
  test('maps a non-square box through an arbitrary rotation', () => {
    const box = rotateBoxBounds({ x0: 0, y0: 0, x1: 4, y1: 2 }, { x: 0, y: 0 }, 45)
    close(box.x0, -Math.SQRT2)
    close(box.y0, 0)
    close(box.x1, 2 * Math.SQRT2)
    close(box.y1, 3 * Math.SQRT2)
  })

  test('every transformed source corner is contained in the returned AABB', () => {
    fc.assert(fc.property(
      fc.record({
        x0: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
        y0: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
        width: fc.double({ min: 0.001, max: 1_000, noNaN: true }),
        height: fc.double({ min: 0.001, max: 1_000, noNaN: true }),
        cx: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
        cy: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
        angle: fc.double({ min: -1_440, max: 1_440, noNaN: true }),
      }),
      ({ x0, y0, width, height, cx, cy, angle }) => {
        const source = { x0, y0, x1: x0 + width, y1: y0 + height }
        const bounds = rotateBoxBounds(source, { x: cx, y: cy }, angle)
        for (const [x, y] of [[source.x0, source.y0], [source.x1, source.y0], [source.x0, source.y1], [source.x1, source.y1]]) {
          const point = rotatePoint({ x: x!, y: y! }, { x: cx, y: cy }, angle)
          expect(point.x).toBeGreaterThanOrEqual(bounds.x0 - 1e-9)
          expect(point.x).toBeLessThanOrEqual(bounds.x1 + 1e-9)
          expect(point.y).toBeGreaterThanOrEqual(bounds.y0 - 1e-9)
          expect(point.y).toBeLessThanOrEqual(bounds.y1 + 1e-9)
        }
      },
    ), { numRuns: 200 })
  })
})
