/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { AbstractList } from '../../../../../java/util/AbstractList.ts'
import { Collections } from '../../../../../java/util/Collections.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import type { Iterator, ListIterator } from '../../../../../java/util/Iterator.ts'
import type { EList } from './EList.ts'

class BasicEmptyUnmodifiableEList<T> extends AbstractList<T> implements EList<T> {
  private readonly emptyIterator: ListIterator<T> = {
    hasNext: () => false, next: () => { throw new Error('No such element') },
    hasPrevious: () => false, previous: () => { throw new Error('No such element') },
    nextIndex: () => 0, previousIndex: () => -1,
    remove: () => { throw new Error('Unsupported operation') },
    set: () => { throw new Error('Unsupported operation') },
    add: () => { throw new Error('Unsupported operation') },
  }
  size(): number { return 0 }
  override isEmpty(): boolean { return true }
  override equals(object: unknown): boolean { return Collections.emptyList().equals(object) }
  override hashCode(): number { return Collections.emptyList().hashCode() }
  get(index: number): T { return Collections.emptyList<T>().get(index) }
  override contains(_object: T): boolean { return false }
  override indexOf(_object: T): number { return -1 }
  override lastIndexOf(_object: T): number { return -1 }
  override iterator(): Iterator<T> { return this.emptyIterator }
  override listIterator(_index = 0): ListIterator<T> { return this.emptyIterator }
  override subList(fromIndex: number, toIndex: number): AbstractList<T> { return Collections.emptyList<T>().subList(fromIndex, toIndex) }
  override toArray(): T[]
  override toArray(array: T[]): T[]
  override toArray(array?: T[]): T[] { return array === undefined ? Collections.emptyList<T>().toArray() : Collections.emptyList<T>().toArray(array) }
  override toString(): string { return Collections.emptyList<T>().toString() }
  add(_object: T): never
  add(_index: number, _object: T): never
  add(_first: number | T, _second?: T): never { throw new Error('Unsupported operation') }
  override remove(_object: T): never
  override remove(_index: number): never
  override remove(_first: number | T): never { throw new Error('Unsupported operation') }
  override removeObject(_object: T): never { throw new Error('Unsupported operation') }
  removeAt(_index: number): never { throw new Error('Unsupported operation') }
  override containsAll(_collection: Iterable<T>): boolean { return false }
  override addAll(_collection: Collection<T>): never
  override addAll(_index: number, _collection: Collection<T>): never
  override addAll(_first: number | Collection<T>, _second?: Collection<T>): never { throw new Error('Unsupported operation') }
  override removeAll(_collection: { contains(value: T): boolean }): never { throw new Error('Unsupported operation') }
  override retainAll(_collection: { contains(value: T): boolean }): never { throw new Error('Unsupported operation') }
  override clear(): never { throw new Error('Unsupported operation') }
  set(_index: number, _object: T): never { throw new Error('Unsupported operation') }
  move(_newPosition: number, _object: T): never
  move(_newPosition: number, _oldPosition: number): never
  move(_newPosition: number, _second: number | T): never { throw new Error('Unsupported operation') }
}
class EmptyUnmodifiableEList extends BasicEmptyUnmodifiableEList<unknown> {}

export class ECollections {
  private constructor() {}
  static readonly EMPTY_ELIST: EList<unknown> = new EmptyUnmodifiableEList()
  static emptyEList<T>(): EList<T> { return ECollections.EMPTY_ELIST as EList<T> }
}
