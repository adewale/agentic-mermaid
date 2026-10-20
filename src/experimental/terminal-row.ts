/** Adaptive Map-compatible row. Dense occupied spans use 32-cell tiles;
 * sparse/widely separated columns retain Map storage. Iteration stays in
 * insertion order, including delete/reinsert, as ordinary composition expects. */
export class AdaptiveTerminalRow<T> {
  private sparse: Map<number, T> | undefined = new Map()
  private tiles = new Map<number, { values: Array<T | undefined>; order: Int32Array; size: number }>()
  private history: number[] = []
  private count = 0
  private min = Infinity
  private max = -Infinity
  get size(): number { return this.sparse?.size ?? this.count }
  get(key: number): T | undefined { return this.sparse ? this.sparse.get(key) : this.tiles.get(Math.floor(key / 32))?.values[key % 32] }
  set(key: number, value: T): this {
    if (this.sparse) {
      this.sparse.set(key, value); this.min = Math.min(this.min, key); this.max = Math.max(this.max, key)
      if (this.sparse.size >= 64 && this.max - this.min <= this.sparse.size * 4) {
        const items = this.sparse; this.sparse = undefined
        for (const [x, cell] of items) this.set(x, cell)
      }
      return this
    }
    const tileId = Math.floor(key / 32), offset = key % 32
    let tile = this.tiles.get(tileId)
    if (!tile) { tile = { values: new Array<T | undefined>(32), order: new Int32Array(32).fill(-1), size: 0 }; this.tiles.set(tileId, tile) }
    if (tile.order[offset] === -1) { tile.order[offset] = this.history.length; this.history.push(key); this.count++; tile.size++ }
    tile.values[offset] = value
    return this
  }
  delete(key: number): boolean {
    if (this.sparse) return this.sparse.delete(key)
    const id = Math.floor(key / 32), tile = this.tiles.get(id), offset = key % 32
    if (!tile || tile.order[offset] === -1) return false
    tile.values[offset] = undefined; tile.order[offset] = -1; this.count--; tile.size--
    if (!tile.size) this.tiles.delete(id)
    if (this.history.length > Math.max(256, this.count * 4)) {
      const live = [...this.keys()]; this.history = live
      for (let index = 0; index < live.length; index++) { const x = live[index]!; this.tiles.get(Math.floor(x / 32))!.order[x % 32] = index }
    }
    return true
  }
  *keys(): IterableIterator<number> { for (const [key] of this) yield key }
  *values(): IterableIterator<T> { for (const [, value] of this) yield value }
  *[Symbol.iterator](): IterableIterator<[number, T]> {
    if (this.sparse) { yield* this.sparse; return }
    for (let index = 0; index < this.history.length; index++) {
      const key = this.history[index]!, tile = this.tiles.get(Math.floor(key / 32)), offset = key % 32
      if (tile && tile.order[offset] === index) yield [key, tile.values[offset]!]
    }
  }
}
