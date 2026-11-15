/* SPDX-License-Identifier: EPL-2.0 */
import type { Enum } from '../../../../java/lang/Enum.ts'
import { AbstractSet } from '../../../../java/util/AbstractSet.ts'
import { EnumSet } from '../../../../java/util/EnumSet.ts'
import { Collections } from '../../../../java/util/Collections.ts'
import type { Iterator } from '../../../../java/util/Iterator.ts'

export class Sets {
  static immutableEnumSet<T extends Enum<T>>(first: T, ...rest: T[]): AbstractSet<T> {
    return Collections.unmodifiableSet(EnumSet.of(first, ...rest))
  }
  static intersection<T>(set1: AbstractSet<T>, set2: AbstractSet<T>): AbstractSet<T> { return new IntersectionSet(set1, set2) }
}

class IntersectionSet<T> extends AbstractSet<T> {
  constructor(private readonly set1: AbstractSet<T>, private readonly set2: AbstractSet<T>) { super() }
  size(): number { let count = 0; for (const value of this.set1) if (this.set2.contains(value)) count++; return count }
  contains(value: T): boolean { return this.set1.contains(value) && this.set2.contains(value) }
  add(_value: T): never { throw new Error('Unsupported operation on a set intersection') }
  remove(_value: T): never { throw new Error('Unsupported operation on a set intersection') }
  clear(): never { throw new Error('Unsupported operation on a set intersection') }
  iterator(): Iterator<T> {
    const original = this.set1.iterator()
    let ready = false
    let next: T
    const hasNext = (): boolean => {
      if (ready) return true
      while (original.hasNext()) {
        next = original.next()
        if (this.set2.contains(next)) { ready = true; return true }
      }
      return false
    }
    return {
      hasNext,
      next: () => { if (!hasNext()) throw new Error('No such element'); ready = false; return next },
      remove: () => { throw new Error('Unsupported operation on a set intersection') },
    }
  }
}
