/* SPDX-License-Identifier: EPL-2.0 */
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
    this.checkIndex(index, true)
    const values = Array.from(typeof first === 'number' ? second! : first)
    for (let offset = 0; offset < values.length; offset++) this.add(index + offset, values[offset]!)
    return values.length !== 0
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
    let expectedModCount = this.modCount
    const check = (): void => { if (this.modCount !== expectedModCount) throw new Error('Concurrent modification') }
    return {
      hasNext: () => cursor < this.size(),
      next: () => { check(); if (cursor >= this.size()) throw new Error('No such element'); last = cursor++; return this.get(last) },
      hasPrevious: () => cursor > 0,
      previous: () => { check(); if (cursor === 0) throw new Error('No such element'); last = --cursor; return this.get(last) },
      nextIndex: () => cursor,
      previousIndex: () => cursor - 1,
      remove: () => {
        check()
        if (last < 0) throw new Error('No current element')
        this.removeAt(last)
        if (last < cursor) cursor--
        last = -1
        expectedModCount = this.modCount
      },
      set: value => { check(); if (last < 0) throw new Error('No current element'); this.set(last, value) },
      add: value => { check(); this.add(cursor++, value); last = -1; expectedModCount = this.modCount },
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
    this.modCount = parent.modCount
  }
  private check(): void { if (this.parent.modCount !== this.modCount) throw new Error('Concurrent modification') }
  size(): number { this.check(); return this.length }
  get(index: number): T { this.check(); this.checkIndex(index); return this.parent.get(this.offset + index) }
  set(index: number, value: T): T { this.check(); this.checkIndex(index); return this.parent.set(this.offset + index, value) }
  add(value: T): boolean
  add(index: number, value: T): void
  add(first: T | number, second?: T): boolean | void {
    this.check()
    const indexed = arguments.length === 2
    const index = indexed ? first as number : this.length
    this.checkIndex(index, true)
    this.parent.add(this.offset + index, indexed ? second! : first as T)
    this.length++
    this.modCount = this.parent.modCount
    if (!indexed) return true
  }
  removeAt(index: number): T {
    this.check()
    this.checkIndex(index)
    const removed = this.parent.removeAt(this.offset + index)
    this.length--
    this.modCount = this.parent.modCount
    return removed
  }
}
