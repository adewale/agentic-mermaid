import { countPolylineCrossings, type CrossingPolyline } from './edge-crossings.ts'

type CrossingPoint = CrossingPolyline['points'][number]

/** Build-only twin: the lazy SVG renderer keeps the compact reference sweep.
 * Node/IIFE use a specialized pair representation; both count exact incidences.
 * Keep the allocation-free rejection before constructing the sweep inputs. */
export function countPointPairCrossings(first: readonly CrossingPoint[], second: readonly CrossingPoint[]): number {
  for (let i = 1; i < first.length; i++) {
    const a = first[i - 1]!, b = first[i]!
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y)
    for (let j = 1; j < second.length; j++) {
      const c = second[j - 1]!, d = second[j]!
      if (maxX < Math.min(c.x, d.x) || minX > Math.max(c.x, d.x) || maxY < Math.min(c.y, d.y) || minY > Math.max(c.y, d.y)) continue
      if ((a.x === b.x && c.x === d.x) || (a.y === b.y && c.y === d.y)) continue
      return countPolylineCrossings([{ points: first }, { points: second }])
    }
  }
  return 0
}
