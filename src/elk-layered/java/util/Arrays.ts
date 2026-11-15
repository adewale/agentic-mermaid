/*
 * Copyright 2007 Google Inc. (GWT array-backed list semantics).
 * Original GWT portions: Apache-2.0, http://www.apache.org/licenses/LICENSE-2.0.
 * TypeScript translation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { AbstractList } from './AbstractList.ts'

class ArraysArrayList<T> extends AbstractList<T> {
  constructor(private readonly array: T[]) { super(); if (array === null) throw new TypeError('Null array') }
  override contains(object: T): boolean { return this.indexOf(object) !== -1 }
  get(index: number): T { this.checkIndex(index); return this.array[index]! }
  set(index: number, value: T): T { const was = this.get(index); this.array[index] = value; return was }
  size(): number { return this.array.length }
  add(_value: T): never
  add(_index: number, _value: T): never
  add(_first: number | T, _second?: T): never { throw new Error('Unsupported operation') }
  removeAt(_index: number): never { throw new Error('Unsupported operation') }
  override toArray(): T[]
  override toArray(array: T[]): T[]
  override toArray(out?: T[]): T[] {
    const size = this.array.length
    if (out === undefined || out.length < size) out = new Array<T>(size)
    for (let i = 0; i < size; ++i) out[i] = this.array[i]!
    if (out.length > size) out[size] = null as T
    return out
  }
}

export class Arrays {
  static asList<T>(array: T[]): AbstractList<T> { return new ArraysArrayList(array) }
}
