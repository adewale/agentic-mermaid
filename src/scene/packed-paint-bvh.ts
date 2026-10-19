import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'

/** Render-local bulk BVH. Numeric node lanes avoid recursively allocated tree
 * records and copied/sorted surface arrays. Partitioning retains the existing
 * median split, tie order and eight-item leaves so proof budgets stay stable. */
export class PackedPaintBvh<T extends { bounds: AxisAlignedBox; primitive: { order: number } }> {
  private readonly bounds: Float64Array
  private readonly left: Int32Array
  private readonly right: Int32Array
  private readonly first: Uint32Array
  private readonly last: Uint32Array
  private readonly indices: Uint32Array
  private used = 0
  private readonly root: number

  constructor(private readonly items: readonly T[]) {
    const nodeCount = (n: number): number => n <= 8 ? 1 : 1 + nodeCount(n >>> 1) + nodeCount(n - (n >>> 1))
    const capacity = nodeCount(items.length)
    this.bounds = new Float64Array(capacity * 4)
    this.left = new Int32Array(capacity).fill(-1)
    this.right = new Int32Array(capacity).fill(-1)
    this.first = new Uint32Array(capacity)
    this.last = new Uint32Array(capacity)
    this.indices = Uint32Array.from({ length: items.length }, (_, index) => index)
    this.root = items.length ? this.build(0, items.length) : -1
  }

  private compare(a: number, b: number, axis: 'x0' | 'y0'): number {
    return this.items[a]!.bounds[axis] - this.items[b]!.bounds[axis]
      || this.items[a]!.primitive.order - this.items[b]!.primitive.order
  }

  private swap(a: number, b: number): void {
    const value = this.indices[a]!
    this.indices[a] = this.indices[b]!
    this.indices[b] = value
  }

  private partition(first: number, last: number, middle: number, axis: 'x0' | 'y0'): void {
    // Median-of-three pivot and a bounded fallback avoid hostile quadratic
    // quickselect. Sorting a remaining range costs O(n log n), never O(n²).
    let low = first, high = last
    let budget = 2 * Math.ceil(Math.log2(last - first + 1))
    while (high - low > 1) {
      if (--budget < 0) {
        this.indices.subarray(low, high).sort((a, b) => this.compare(a, b, axis))
        return
      }
      const mid = (low + high) >>> 1
      const end = high - 1
      if (this.compare(this.indices[low]!, this.indices[mid]!, axis) > 0) this.swap(low, mid)
      if (this.compare(this.indices[mid]!, this.indices[end]!, axis) > 0) this.swap(mid, end)
      if (this.compare(this.indices[low]!, this.indices[mid]!, axis) > 0) this.swap(low, mid)
      const pivot = this.indices[mid]!
      this.swap(mid, end)
      let target = low
      for (let index = low; index < end; index++) {
        if (this.compare(this.indices[index]!, pivot, axis) < 0) this.swap(index, target++)
      }
      this.swap(target, end)
      if (target === middle) return
      if (target < middle) low = target + 1
      else high = target
    }
  }

  private build(first: number, last: number, inheritedAxis?: 'x0' | 'y0'): number {
    const node = this.used++
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let index = first; index < last; index++) {
      const bounds = this.items[this.indices[index]!]!.bounds
      x0 = Math.min(x0, bounds.x0); y0 = Math.min(y0, bounds.y0)
      x1 = Math.max(x1, bounds.x1); y1 = Math.max(y1, bounds.y1)
    }
    this.bounds.set([x0, y0, x1, y1], 4 * node)
    this.first[node] = first
    this.last[node] = last
    if (last - first <= 8) {
      // A recursive reference leaf keeps its parent's sorted order. Root
      // leaves retain input order; both matter when a proof budget is hit.
      if (inheritedAxis) this.indices.subarray(first, last).sort((a, b) => this.compare(a, b, inheritedAxis))
    } else {
      const axis = x1 - x0 >= y1 - y0 ? 'x0' : 'y0'
      const middle = first + Math.floor((last - first) / 2)
      this.partition(first, last, middle, axis)
      this.left[node] = this.build(first, middle, axis)
      this.right[node] = this.build(middle, last, axis)
    }
    return node
  }

  /** `work` is charged for every branch and every examined leaf surface,
   * including rejected broad-phase candidates, just like the reference tree. */
  visit(query: AxisAlignedBox, work: () => boolean, visit: (item: T) => boolean): void {
    const walk = (node: number): boolean => {
      if (!work()) return false
      if (node < 0) return true
      const offset = 4 * node
      if (!(this.bounds[offset]! < query.x1 && query.x0 < this.bounds[offset + 2]!
        && this.bounds[offset + 1]! < query.y1 && query.y0 < this.bounds[offset + 3]!)) return true
      const left = this.left[node]!
      if (left >= 0) return walk(left) && walk(this.right[node]!)
      for (let index = this.first[node]!; index < this.last[node]!; index++) {
        if (!work() || !visit(this.items[this.indices[index]!]!)) return false
      }
      return true
    }
    walk(this.root)
  }
}
