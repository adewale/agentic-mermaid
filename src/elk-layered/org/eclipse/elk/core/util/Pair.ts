/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { JavaObject, javaEquals, javaHashCode } from '../../../../../java/lang/Object.ts'
import type { Comparable } from '../../../../../java/lang/Comparable.ts'
import type { JavaIterable } from '../../../../../java/lang/Iterable.ts'
import { ArrayList } from '../../../../../java/util/ArrayList.ts'
import { iterableIterator, type Iterator } from '../../../../../java/util/Iterator.ts'
import type { Entry, JavaMap } from '../../../../../java/util/Map.ts'

export class Pair<F, S> extends JavaObject implements JavaIterable<unknown> {
  private static readonly HALF_WORD = 16
  private static readonly MASK1 = (1 << Pair.HALF_WORD) - 1
  private static readonly MASK2 = ~Pair.MASK1
  private first: F = null as F
  private second: S = null as S

  static create<T1, T2>(): Pair<T1, T2> { return new Pair<T1, T2>() }
  static of<T1, T2>(first: T1, second: T2): Pair<T1, T2> { return new Pair(first, second) }
  static fromMap<G, T>(map: JavaMap<G, T>): ArrayList<Pair<G, T>> {
    const list = new ArrayList<Pair<G, T>>(map.size())
    for (const entry of map.entrySet()) list.add(new Pair(entry))
    return list
  }

  constructor()
  constructor(thefirst: F, thesecond: S)
  constructor(entry: Entry<F, S>)
  constructor(first?: F | Entry<F, S>, second?: S) {
    super()
    if (arguments.length === 1) {
      this.first = (first as Entry<F, S>).getKey()
      this.second = (first as Entry<F, S>).getValue()
    } else if (arguments.length === 2) {
      this.first = first as F
      this.second = second!
    }
  }

  override equals(obj: unknown): boolean { return obj instanceof Pair && javaEquals(this.first, obj.first) && javaEquals(this.second, obj.second) }
  override hashCode(): number {
    const firstCode = javaHashCode(this.first)
    const first1 = firstCode & Pair.MASK1
    const first2 = firstCode & Pair.MASK2
    const secondCode = javaHashCode(this.second)
    const second1 = secondCode & Pair.MASK1
    const second2 = secondCode & Pair.MASK2
    return (first1 ^ ((second2 >> Pair.HALF_WORD) & Pair.MASK1)) | (first2 ^ (second1 << Pair.HALF_WORD))
  }
  override toString(): string { return `pair(${this.first === null ? 'null' : String(this.first)},${this.second === null ? 'null' : String(this.second)})` }
  setFirst(thefirst: F): void { this.first = thefirst }
  getFirst(): F { return this.first }
  setSecond(thesecond: S): void { this.second = thesecond }
  getSecond(): S { return this.second }
  clear(): void { this.first = null as F; this.second = null as S }

  iterator(): Iterator<unknown> {
    let visitedFirst = false
    let visitedSecond = false
    return {
      hasNext: () => !visitedSecond && ((!visitedFirst && this.first !== null) || this.second !== null),
      next: () => {
        if (!visitedSecond && !visitedFirst && this.first !== null) { visitedFirst = true; return this.first }
        if (!visitedSecond && this.second !== null) { visitedSecond = true; return this.second }
        throw new Error('No such element')
      },
      remove: () => {
        if (visitedSecond && this.second !== null) this.second = null as S
        else if (visitedFirst && this.first !== null) this.first = null as F
        throw new Error('Illegal iterator state')
      },
    }
  }
  [Symbol.iterator](): IterableIterator<unknown> { return iterableIterator(this.iterator()) }
}

export namespace Pair {
  export class FirstComparator<F extends Comparable<F>, S> {
    static readonly #serialVersionUID = 1n
    compare(o1: Pair<F, S>, o2: Pair<F, S>): number { return o1.getFirst().compareTo(o2.getFirst()) }
  }
  export class SecondComparator<F, S extends Comparable<S>> {
    static readonly #serialVersionUID = 1n
    compare(o1: Pair<F, S>, o2: Pair<F, S>): number { return o1.getSecond().compareTo(o2.getSecond()) }
  }
}
