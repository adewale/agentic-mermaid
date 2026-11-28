import type { Point } from '../types.ts'

/** Drop repeated points and interior points that lie on the straight run
 * between their neighbours. */
export function simplifyOrthogonal(points: readonly Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    if (result.at(-1)?.x === point.x && result.at(-1)?.y === point.y) continue
    result.push({ ...point })
    while (result.length > 2) {
      const a = result.at(-3)!, b = result.at(-2)!, c = result.at(-1)!
      if (!((a.x === b.x && b.x === c.x && b.y >= Math.min(a.y, c.y) && b.y <= Math.max(a.y, c.y))
        || (a.y === b.y && b.y === c.y && b.x >= Math.min(a.x, c.x) && b.x <= Math.max(a.x, c.x)))) break
      result.splice(result.length - 2, 1)
    }
  }
  return result
}
