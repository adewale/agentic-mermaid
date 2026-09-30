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

  test('the returned AABB is exactly the extent of the four rotated source corners', () => {
    // Independent oracle: the textbook rotation (SVG rotate(angle, cx, cy)),
    // not the module's rotatePoint. Equality (not just containment) also
    // rules out a box that is merely too large.
    const rotated = (x: number, y: number, cx: number, cy: number, degrees: number) => {
      const t = degrees * Math.PI / 180
      return { x: cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t), y: cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t) }
    }
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
        const corners = [[source.x0, source.y0], [source.x1, source.y0], [source.x0, source.y1], [source.x1, source.y1]]
          .map(([x, y]) => rotated(x!, y!, cx, cy, angle))
        const expected = {
          x0: Math.min(...corners.map(p => p.x)), y0: Math.min(...corners.map(p => p.y)),
          x1: Math.max(...corners.map(p => p.x)), y1: Math.max(...corners.map(p => p.y)),
        }
        for (const side of ['x0', 'y0', 'x1', 'y1'] as const) {
          expect({ side, withinTolerance: Math.abs(bounds[side] - expected[side]) < 1e-6 }).toEqual({ side, withinTolerance: true })
        }
      },
    ), { numRuns: 200 })
  })

  test('rotatePoint agrees with the textbook rotation', () => {
    close(rotatePoint({ x: 4, y: 0 }, { x: 0, y: 0 }, 45).x, 2 * Math.SQRT2)
    close(rotatePoint({ x: 4, y: 0 }, { x: 0, y: 0 }, 45).y, 2 * Math.SQRT2)
    close(rotatePoint({ x: 3, y: 1 }, { x: 1, y: 1 }, 90).x, 1)
    close(rotatePoint({ x: 3, y: 1 }, { x: 1, y: 1 }, 90).y, 3)
  })
})
