/*
 * Copyright 2007 Google Inc. (GWT list and sublist iterator semantics).
 * Original GWT portions: Apache-2.0, http://www.apache.org/licenses/LICENSE-2.0.
 * TypeScript translation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { JavaObject, javaEquals, javaHashCode } from '../lang/Object.ts'
import { iterableIterator, type Iterator, type ListIterator } from './Iterator.ts'
import type { Collection } from './Collection.ts'

export abstract class AbstractList<T> extends JavaObject implements Collection<T> {
  modCount = 0
  abstract size(): number
  abstract get(index: number): T
  abstract set(index: number, value: T): T
  abstract add(value: T): boolean
  abstract add(index: number, value: T): void
  abstract removeAt(index: number): T

  protected checkIndex(index: number, insertion = false): void {
    if (index < 0 || index >= this.size() + (insertion ? 1 : 0)) throw new RangeError(`Index ${index} outside list of size ${this.size()}`)
  }

  isEmpty(): boolean { return this.size() === 0 }
  contains(value: T): boolean { return this.indexOf(value) >= 0 }
  indexOf(value: T): number { for (let index = 0; index < this.size(); index++) if (javaEquals(value, this.get(index))) return index; return -1 }
  lastIndexOf(value: T): number { for (let index = this.size() - 1; index >= 0; index--) if (javaEquals(value, this.get(index))) return index; return -1 }

  remove(index: number): T
  remove(value: T): boolean
  remove(first: number | T): T | boolean { return typeof first === 'number' ? this.removeAt(first) : this.removeObject(first) }
  removeObject(value: T): boolean { const index = this.indexOf(value); if (index < 0) return false; this.removeAt(index); return true }
  clear(): void { const iterator = this.iterator(); while (iterator.hasNext()) { iterator.next(); iterator.remove() } }

  addAll(collection: Collection<T>): boolean
  addAll(index: number, collection: Collection<T>): boolean
  addAll(first: number | Collection<T>, second?: Collection<T>): boolean {
    const index = typeof first === 'number' ? first : this.size()
    let nextIndex = index
    let changed = false
    for (const value of typeof first === 'number' ? second! : first) { this.add(nextIndex++, value); changed = true }
    return changed
  }

  containsAll(values: Iterable<T>): boolean { for (const value of values) if (!this.contains(value)) return false; return true }
  removeAll(values: { contains(value: T): boolean }): boolean {
    let changed = false
    const iterator = this.iterator()
    while (iterator.hasNext()) if (values.contains(iterator.next())) { iterator.remove(); changed = true }
    return changed
  }
  retainAll(values: { contains(value: T): boolean }): boolean {
    let changed = false
    const iterator = this.iterator()
    while (iterator.hasNext()) if (!values.contains(iterator.next())) { iterator.remove(); changed = true }
    return changed
  }

  toArray(): T[]
  toArray(array: T[]): T[]
  toArray(array?: T[]): T[] {
    const result = array && array.length >= this.size() ? array : new Array<T>(this.size())
    let index = 0
    for (const value of this) result[index++] = value
    if (result.length > index) result[index] = null as T
    return result
  }

  iterator(): Iterator<T> { return this.listIterator() }
  listIterator(index = 0): ListIterator<T> {
    this.checkIndex(index, true)
    let cursor = index
    let last = -1
    return {
      hasNext: () => cursor < this.size(),
      next: () => { if (cursor >= this.size()) throw new Error('No such element'); last = cursor++; return this.get(last) },
      hasPrevious: () => cursor > 0,
      previous: () => { if (cursor === 0) throw new Error('No such element'); last = --cursor; return this.get(last) },
      nextIndex: () => cursor,
      previousIndex: () => cursor - 1,
      remove: () => {
        if (last < 0) throw new Error('No current element')
        this.removeAt(last)
        cursor = last
        last = -1
      },
      set: value => { if (last < 0) throw new Error('No current element'); this.set(last, value) },
      add: value => { this.add(cursor, value); cursor++; last = -1 },
    }
  }
  [Symbol.iterator](): IterableIterator<T> { return iterableIterator(this.iterator()) }

  subList(fromIndex: number, toIndex: number): AbstractList<T> {
    if (fromIndex < 0 || toIndex > this.size() || fromIndex > toIndex) throw new RangeError('Invalid sublist range')
    return new SubList(this, fromIndex, toIndex - fromIndex)
  }
  sort(comparator: { compare(left: T, right: T): number } | ((left: T, right: T) => number)): void {
    const values = this.toArray()
    values.sort(typeof comparator === 'function' ? comparator : (left, right) => comparator.compare(left, right))
    for (let index = 0; index < values.length; index++) this.set(index, values[index]!)
  }
  override equals(other: unknown): boolean {
    if (!(other instanceof AbstractList) || this.size() !== other.size()) return false
    for (let index = 0; index < this.size(); index++) if (!javaEquals(this.get(index), other.get(index))) return false
    return true
  }
  override hashCode(): number { let hash = 1; for (const value of this) hash = (Math.imul(31, hash) + javaHashCode(value)) | 0; return hash }
  override toString(): string { return `[${Array.from(this).join(', ')}]` }
}

class SubList<T> extends AbstractList<T> {
  constructor(private readonly parent: AbstractList<T>, private readonly offset: number, private length: number) {
    super()
  }
  size(): number { return this.length }
  get(index: number): T { this.checkIndex(index); return this.parent.get(this.offset + index) }
  set(index: number, value: T): T { this.checkIndex(index); return this.parent.set(this.offset + index, value) }
  add(value: T): boolean
  add(index: number, value: T): void
  add(first: T | number, second?: T): boolean | void {
    const indexed = arguments.length === 2
    const index = indexed ? first as number : this.length
    this.checkIndex(index, true)
    this.parent.add(this.offset + index, indexed ? second! : first as T)
    this.length++
    if (!indexed) return true
  }
  removeAt(index: number): T {
    this.checkIndex(index)
    const removed = this.parent.removeAt(this.offset + index)
    this.length--
    return removed
  }
}
