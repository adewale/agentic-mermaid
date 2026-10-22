/** Scalar maxima over half-open actor-gap ranges. Pixel/cell adapters own
 * measurement and rounding; this accumulator only combines their requirements. */
export class SequenceGapRequirements {
  private readonly maxima: number[]
  private readonly base: number

  constructor(readonly length: number) {
    // Ordinary diagrams keep the direct loop and one small array.
    let base = 0
    if (length > 32) {
      base = 1
      while (base < length) base *= 2
    }
    this.base = base
    this.maxima = new Array<number>(base ? base * 2 : length).fill(0)
  }

  require(first: number, last: number, value: number): void {
    if (!this.base) {
      for (let gap = first; gap < last; gap++) this.maxima[gap] = Math.max(this.maxima[gap]!, value)
      return
    }
    for (let left = first + this.base, right = last + this.base; left < right; left >>= 1, right >>= 1) {
      if (left & 1) { this.maxima[left] = Math.max(this.maxima[left]!, value); left++ }
      if (right & 1) { right--; this.maxima[right] = Math.max(this.maxima[right]!, value) }
    }
  }

  values(): number[] {
    if (!this.base) return this.maxima
    for (let index = 1; index < this.base; index++) {
      const value = this.maxima[index]!
      this.maxima[index * 2] = Math.max(this.maxima[index * 2]!, value)
      this.maxima[index * 2 + 1] = Math.max(this.maxima[index * 2 + 1]!, value)
    }
    return this.maxima.slice(this.base, this.base + this.length)
  }
}
