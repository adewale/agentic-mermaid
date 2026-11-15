import { linearFraction } from '../shared/linear-range.ts'

/** A numeric domain projected onto cell boundaries, rather than cell centers.
 * The authored endpoints remain fixed; rounding never expands the domain. */
export function quantizedScale(domain: { min: number; max: number }, extent: number) {
  const position = (value: number, subdivisions = 1): number => {
    const fraction = linearFraction(value, domain.min, domain.max)
    return Math.round(Math.max(0, Math.min(1, fraction)) * extent * subdivisions) / subdivisions
  }

  return {
    position,
    /** Endpoints win when coarse projection puts several ticks on one boundary. */
    ticks(values: number[]): number[] {
      const occupied = new Map<number, number>()
      for (const value of [domain.min, domain.max, ...values]) {
        const boundary = position(value)
        if (!occupied.has(boundary)) occupied.set(boundary, value)
      }
      return [...occupied.entries()].sort(([a], [b]) => a - b).map(([, value]) => value)
    },
    /** Each occupied interval is half open. A collapsed interval paints no cell.
     * Coverage bits identify the first/second half of a cell in axis order. */
    interval(from: number, to: number, subdivisions: 1 | 2): { index: number; coverage: number }[] {
      const a = Math.round(position(from, subdivisions) * subdivisions)
      const b = Math.round(position(to, subdivisions) * subdivisions)
      const result: { index: number; coverage: number }[] = []
      for (let unit = Math.min(a, b); unit < Math.max(a, b); unit++) {
        const index = Math.floor(unit / subdivisions)
        const coverage = subdivisions === 1 ? 3 : 1 << (unit % 2)
        const last = result[result.length - 1]
        if (last?.index === index) last.coverage |= coverage
        else result.push({ index, coverage })
      }
      return result
    },
  }
}
