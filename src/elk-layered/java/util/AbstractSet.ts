/* SPDX-License-Identifier: EPL-2.0 */
import { JavaObject, javaHashCode } from '../lang/Object.ts'
import { iterableIterator, type Iterator } from './Iterator.ts'

export abstract class AbstractSet<T> extends JavaObject implements Iterable<T> {
  abstract iterator(): Iterator<T>
  abstract size(): number
  abstract contains(value: T): boolean
  abstract add(value: T): boolean
  abstract remove(value: T): boolean
  abstract clear(): void
  isEmpty(): boolean { return this.size() === 0 }
  [Symbol.iterator](): IterableIterator<T> { return iterableIterator(this.iterator()) }
  addAll(values: Iterable<T>): boolean { let changed = false; for (const value of values) changed = this.add(value) || changed; return changed }
  containsAll(values: Iterable<T>): boolean { for (const value of values) if (!this.contains(value)) return false; return true }
  removeAll(values: Iterable<T>): boolean { let changed = false; for (const value of values) changed = this.remove(value) || changed; return changed }
  retainAll(values: AbstractSet<T>): boolean {
    let changed = false
    const iterator = this.iterator()
    while (iterator.hasNext()) if (!values.contains(iterator.next())) { iterator.remove(); changed = true }
    return changed
  }
  toArray(): T[] { return Array.from(this) }
  override hashCode(): number { let hash = 0; for (const value of this) hash = (hash + javaHashCode(value)) | 0; return hash }
  override equals(other: unknown): boolean { return other instanceof AbstractSet && other.size() === this.size() && this.containsAll(other) }
  override toString(): string { return `[${Array.from(this).join(', ')}]` }
}
