/* SPDX-License-Identifier: EPL-2.0 */
import type { JavaIterable } from '../../../../java/lang/Iterable.ts'
import { iterableIterator, type Iterator } from '../../../../java/util/Iterator.ts'
import type { Predicate } from '../base/Predicates.ts'

class IterableAdapter<T> implements JavaIterable<T> {
  constructor(private readonly makeIterator: () => Iterator<T>) {}
  iterator(): Iterator<T> { return this.makeIterator() }
  [Symbol.iterator](): IterableIterator<T> { return iterableIterator(this.iterator()) }
}

export class Iterables {
  static ofIterator<T>(makeIterator: () => Iterator<T>): JavaIterable<T> { return new IterableAdapter(makeIterator) }

  static filter<T>(source: JavaIterable<T>, predicate: Predicate<T>): JavaIterable<T> {
    return new IterableAdapter(() => {
      const iterator = source.iterator()
      let ready = false
      let value: T
      const hasNext = (): boolean => {
        if (ready) return true
        while (iterator.hasNext()) {
          value = iterator.next()
          if (predicate(value)) { ready = true; return true }
        }
        return false
      }
      return {
        hasNext,
        next: () => { if (!hasNext()) throw new Error('No such element'); ready = false; return value },
        remove: () => { throw new Error('Unsupported operation on a filtered iterator') },
      }
    })
  }

  static concat<T>(sources: JavaIterable<JavaIterable<T>>): JavaIterable<T>
  static concat<T>(first: JavaIterable<T>, second: JavaIterable<T>): JavaIterable<T>
  static concat<T>(first: JavaIterable<T> | JavaIterable<JavaIterable<T>>, second?: JavaIterable<T>): JavaIterable<T> {
    return new IterableAdapter(() => {
      const outer = second === undefined ? (first as JavaIterable<JavaIterable<T>>).iterator() : null
      let pairIndex = 0
      let current: Iterator<T> | null = null
      let last: Iterator<T> | null = null
      const hasNext = (): boolean => {
        while (current === null || !current.hasNext()) {
          if (outer) {
            if (!outer.hasNext()) return false
            current = outer.next().iterator()
          } else {
            if (pairIndex >= 2) return false
            current = (pairIndex++ === 0 ? first as JavaIterable<T> : second!).iterator()
          }
        }
        return true
      }
      return {
        hasNext,
        next: () => { if (!hasNext()) throw new Error('No such element'); last = current; return current!.next() },
        remove: () => { if (last === null) throw new Error('No current element'); last.remove(); last = null },
      }
    })
  }
}
