export interface IndexedBounds<T> { x0: number; y0: number; x1: number; y1: number; value: T }

/**
 * A pass-owned packed BVH. One dominant-axis sort and midpoint partitioning
 * build O(n log n) bounds. Query results retain authored insertion order.
 * Owners must rebuild after any indexed bounds change; no global weak cache.
 */
export class StaticBoundsIndex<T> {
  private readonly boxes: Float64Array
  private readonly left: Int32Array
  private readonly right: Int32Array
  private readonly item: Int32Array
  private readonly root: number
  private readonly entries: readonly IndexedBounds<T>[]
  constructor(entries: readonly IndexedBounds<T>[]) {
    this.entries = entries
    const size = Math.max(1, 2 * entries.length - 1)
    this.boxes = new Float64Array(size * 4)
    this.left = new Int32Array(size).fill(-1)
    this.right = new Int32Array(size).fill(-1)
    this.item = new Int32Array(size).fill(-1)
    const ordinals = entries.map((_, index) => index)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const entry of entries) {
      x0 = Math.min(x0, entry.x0); y0 = Math.min(y0, entry.y0)
      x1 = Math.max(x1, entry.x1); y1 = Math.max(y1, entry.y1)
    }
    const horizontal = x1 - x0 >= y1 - y0
    ordinals.sort((a, b) => {
      const first = entries[a]!, second = entries[b]!
      return (horizontal ? first.x0 + first.x1 - second.x0 - second.x1 : first.y0 + first.y1 - second.y0 - second.y1) || a - b
    })
    let count = 0
    const build = (lo: number, hi: number): number => {
      if (lo >= hi) return -1
      const node = count++, offset = node * 4
      if (hi - lo === 1) {
        const ordinal = ordinals[lo]!, entry = entries[ordinal]!
        this.item[node] = ordinal
        this.boxes.set([entry.x0, entry.y0, entry.x1, entry.y1], offset)
      } else {
        const mid = (lo + hi) >>> 1, left = build(lo, mid), right = build(mid, hi)
        this.left[node] = left; this.right[node] = right
        const a = left * 4, b = right * 4
        this.boxes.set([
          Math.min(this.boxes[a]!, this.boxes[b]!), Math.min(this.boxes[a + 1]!, this.boxes[b + 1]!),
          Math.max(this.boxes[a + 2]!, this.boxes[b + 2]!), Math.max(this.boxes[a + 3]!, this.boxes[b + 3]!),
        ], offset)
      }
      return node
    }
    this.root = build(0, entries.length)
  }
  query(x0: number, y0: number, x1: number, y1: number): T[] {
    if (this.root < 0) return []
    const stack = [this.root], found: number[] = []
    while (stack.length > 0) {
      const node = stack.pop()!, offset = node * 4
      if (this.boxes[offset]! > x1 || this.boxes[offset + 2]! < x0 || this.boxes[offset + 1]! > y1 || this.boxes[offset + 3]! < y0) continue
      const ordinal = this.item[node]!
      if (ordinal >= 0) found.push(ordinal)
      else { stack.push(this.right[node]!, this.left[node]!) }
    }
    found.sort((a, b) => a - b)
    return found.map(ordinal => this.entries[ordinal]!.value)
  }
}
