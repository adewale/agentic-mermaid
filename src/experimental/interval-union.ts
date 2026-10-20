/** Sorted union of open intervals; touching endpoints stay queryable. */
export class OpenIntervalUnion {
  private readonly spans: Array<readonly [number, number]>
  constructor(intervals: Array<readonly [number, number]>) {
    this.spans = []
    for (const [lo, hi] of intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      if (!(lo < hi)) continue
      const prior = this.spans.at(-1)
      if (prior && lo < prior[1]) this.spans[this.spans.length - 1] = [prior[0], Math.max(prior[1], hi)]
      else this.spans.push([lo, hi])
    }
  }
  contains(value: number): boolean {
    let lo = 0, hi = this.spans.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.spans[mid]![0] < value) lo = mid + 1; else hi = mid }
    return lo > 0 && value < this.spans[lo - 1]![1]
  }
}
