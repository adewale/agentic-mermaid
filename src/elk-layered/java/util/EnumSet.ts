/*
 * Copyright 2008 Google Inc. (GWT sparse enum-set iteration).
 * Original GWT portions: Apache-2.0, http://www.apache.org/licenses/LICENSE-2.0.
 * TypeScript translation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import type { Enum } from '../lang/Enum.ts'
import type { Class } from '../lang/Class.ts'
import { Cloneable } from '../lang/Cloneable.ts'
import { AbstractSet } from './AbstractSet.ts'
import type { Iterator } from './Iterator.ts'

export class EnumSet<T extends Enum<T>> extends AbstractSet<T> implements Cloneable {
  readonly [Cloneable] = true
  private readonly set: (T | null)[]
  private count = 0

  private constructor(private readonly constants: T[]) {
    super()
    this.set = new Array<T | null>(constants.length).fill(null)
  }

  static noneOf<T extends Enum<T>>(type: Class<T>): EnumSet<T> { return new EnumSet(type.getEnumConstants()) }
  static allOf<T extends Enum<T>>(type: Class<T>): EnumSet<T> { const set = EnumSet.noneOf(type); set.addAll(type.getEnumConstants()); return set }
  static of<T extends Enum<T>>(first: T, ...rest: T[]): EnumSet<T> {
    const type = first.constructor as Function & { values(): T[] }
    const set = new EnumSet(type.values())
    set.add(first)
    set.addAll(rest)
    return set
  }
  static copyOf<T extends Enum<T>>(source: EnumSet<T>): EnumSet<T> { return source.clone() }

  size(): number { return this.count }
  contains(value: T): boolean { return value != null && this.set[value.ordinal()] === value }
  add(value: T): boolean {
    const ordinal = value.ordinal()
    if (this.set[ordinal] != null) return false
    this.set[ordinal] = value
    this.count++
    return true
  }
  remove(value: T): boolean {
    if (!this.contains(value)) return false
    this.set[value.ordinal()] = null
    this.count--
    return true
  }
  clear(): void { this.set.fill(null); this.count = 0 }
  clone(): EnumSet<T> {
    const set = new EnumSet(this.constants)
    for (let index = 0; index < this.set.length; index++) set.set[index] = this.set[index]!
    set.count = this.count
    return set
  }
  iterator(): Iterator<T> {
    let cursor = -1
    let last = -1
    const findNext = (): void => { cursor++; while (cursor < this.constants.length && this.set[cursor] == null) cursor++ }
    findNext()
    return {
      hasNext: () => cursor < this.constants.length,
      next: () => {
        if (cursor === this.constants.length) throw new Error('No such element')
        last = cursor
        findNext()
        return this.set[last]!
      },
      remove: () => { if (last < 0) throw new Error('No current element'); this.set[last] = null; this.count--; last = -1 },
    }
  }
}
