/** Search needs occupied cells and their current extent, not diagram nodes. */
export interface PathOccupancy {
  has(key: string): boolean
  readonly extent: Readonly<{ maxX: number; maxY: number }>
}

/** Sparse occupancy retaining Map's payload contract for graph layout. Bounds
 * follow insertion, deletion and clearing, including temporary reservations. */
export class OccupancyMap<T = true> extends Map<string, T> implements PathOccupancy {
  private columns = new Map<number, number>()
  private rows = new Map<number, number>()
  private limits: Readonly<{ maxX: number; maxY: number }> = Object.freeze({ maxX: 0, maxY: 0 })

  constructor(entries?: Iterable<readonly [string, T]>) {
    super()
    if (entries) for (const [key, value] of entries) this.set(key, value)
  }

  get extent(): Readonly<{ maxX: number; maxY: number }> { return this.limits }

  override set(key: string, value: T): this {
    if (!this.has(key)) {
      const [x, y] = coordinates(key)
      this.columns.set(x, (this.columns.get(x) ?? 0) + 1)
      this.rows.set(y, (this.rows.get(y) ?? 0) + 1)
      if (x > this.limits.maxX || y > this.limits.maxY) this.limits = Object.freeze({ maxX: Math.max(this.limits.maxX, x), maxY: Math.max(this.limits.maxY, y) })
    }
    return super.set(key, value)
  }

  override delete(key: string): boolean {
    if (!super.delete(key)) return false
    const [x, y] = coordinates(key)
    const remove = (counts: Map<number, number>, coordinate: number): void => {
      const count = counts.get(coordinate)!
      if (count === 1) counts.delete(coordinate)
      else counts.set(coordinate, count - 1)
    }
    remove(this.columns, x); remove(this.rows, y)
    const maxX = x === this.limits.maxX && !this.columns.has(x) ? maximum(this.columns) : this.limits.maxX
    const maxY = y === this.limits.maxY && !this.rows.has(y) ? maximum(this.rows) : this.limits.maxY
    if (maxX !== this.limits.maxX || maxY !== this.limits.maxY) this.limits = Object.freeze({ maxX, maxY })
    return true
  }

  override clear(): void {
    super.clear(); this.columns.clear(); this.rows.clear()
    this.limits = Object.freeze({ maxX: 0, maxY: 0 })
  }
}

function coordinates(key: string): readonly [number, number] {
  const comma = key.indexOf(','), x = Number(key.slice(0, comma)), y = Number(key.slice(comma + 1))
  if (comma < 1 || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || key !== `${x},${y}`) throw new RangeError('Occupancy keys must be integer x,y coordinates')
  return [x, y]
}

function maximum(counts: ReadonlyMap<number, number>): number {
  let maximum = 0
  for (const coordinate of counts.keys()) maximum = Math.max(maximum, coordinate)
  return maximum
}

/** Legacy callers may supply an ordinary Map; native layouts retain bounds. */
export function pathOccupancy(cells: PathOccupancy | ReadonlyMap<string, unknown>): PathOccupancy {
  if ('extent' in cells) return cells
  let maxX = 0, maxY = 0
  for (const key of cells.keys()) { const [x, y] = coordinates(key); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  return { has: key => cells.has(key), extent: { maxX, maxY } }
}
