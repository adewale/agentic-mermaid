/* SPDX-License-Identifier: EPL-2.0 */
import { Cloneable } from '../lang/Cloneable.ts'
import { AbstractList } from './AbstractList.ts'

export class ArrayList<T> extends AbstractList<T> implements Cloneable {
  readonly [Cloneable] = true
  private array: T[]

  constructor(source?: Iterable<T> | number) {
    super()
    if (typeof source === 'number' && source < 0) throw new RangeError('Negative initial capacity')
    this.array = source !== undefined && typeof source !== 'number' ? Array.from(source) : []
  }
  size(): number { return this.array.length }
  get(index: number): T { this.checkIndex(index); return this.array[index]! }
  set(index: number, value: T): T { this.checkIndex(index); const previous = this.array[index]!; this.array[index] = value; return previous }
  add(value: T): boolean
  add(index: number, value: T): void
  add(first: T | number, second?: T): boolean | void {
    if (arguments.length === 1) {
      this.array.push(first as T)
      this.modCount = (this.modCount + 1) | 0
      return true
    }
    const index = first as number
    this.checkIndex(index, true)
    this.array.splice(index, 0, second!)
    this.modCount = (this.modCount + 1) | 0
  }
  removeAt(index: number): T { this.checkIndex(index); const [removed] = this.array.splice(index, 1); this.modCount = (this.modCount + 1) | 0; return removed! }
  override clear(): void { this.array = []; this.modCount = (this.modCount + 1) | 0 }
  clone(): ArrayList<T> { return new ArrayList(this) }
}
