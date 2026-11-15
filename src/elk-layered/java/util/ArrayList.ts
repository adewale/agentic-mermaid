/*
 * Copyright 2007 Google Inc. (GWT ArrayList operations).
 * Original GWT portions: Apache-2.0, http://www.apache.org/licenses/LICENSE-2.0.
 * TypeScript translation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { Cloneable } from '../lang/Cloneable.ts'
import { AbstractList } from './AbstractList.ts'
import type { Collection } from './Collection.ts'

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
  override addAll(collection: Collection<T>): boolean
  override addAll(index: number, collection: Collection<T>): boolean
  override addAll(first: number | Collection<T>, second?: Collection<T>): boolean {
    const index = typeof first === 'number' ? first : this.size()
    if (typeof first === 'number') this.checkIndex(index, true)
    const values = (typeof first === 'number' ? second! : first).toArray()
    for (let offset = 0; offset < values.length; offset++) this.add(index + offset, values[offset]!)
    return values.length !== 0
  }
  override clear(): void { this.array = []; this.modCount = (this.modCount + 1) | 0 }
  clone(): ArrayList<T> { return new ArrayList(this) }
}
