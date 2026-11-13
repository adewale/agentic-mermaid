import type { IndexedSegment } from './edge-crossings-indexed.ts'

/** Build-only twin: the lazy SVG renderer keeps the reference sweep, which
 * returns the same count, so its initial graph does not carry the index. */
export function countIndexedCrossings(_routeCount: number, _byRoute: readonly IndexedSegment[], _sorted: readonly IndexedSegment[]): number | undefined {
  return undefined
}
