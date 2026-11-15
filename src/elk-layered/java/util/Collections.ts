/* SPDX-License-Identifier: EPL-2.0 */
import { JavaObject } from '../lang/Object.ts'
import { MapView, type SimpleEntry } from './HashMap.ts'
import type { JavaMap } from './Map.ts'
import { AbstractSet } from './AbstractSet.ts'
import type { Iterator } from './Iterator.ts'
import { AbstractList } from './AbstractList.ts'

class EmptyMap<K, V> extends JavaObject implements JavaMap<K, V> {
  get(_key: K): null { return null }
  put(_key: K, _value: V): never { throw new Error('Unsupported operation on an empty map') }
  remove(_key: K): null { return null }
  containsKey(_key: K): boolean { return false }
  size(): number { return 0 }
  isEmpty(): boolean { return true }
  clear(): void {}
  entrySet(): MapView<SimpleEntry<K, V>> {
    return new MapView(() => ({ hasNext: () => false, next: () => { throw new Error('No such element') }, remove: () => { throw new Error('No current element') } }), () => 0)
  }
  override hashCode(): number { return 0 }
}

class EmptyList<T> extends AbstractList<T> {
  size(): number { return 0 }
  get(_index: number): never { throw new RangeError('Index outside empty list') }
  set(_index: number, _value: T): never { throw new RangeError('Index outside empty list') }
  add(_value: T): never
  add(_index: number, _value: T): never
  add(_first: T | number, _second?: T): never { throw new Error('Unsupported operation on an empty list') }
  removeAt(_index: number): never { throw new RangeError('Index outside empty list') }
}

export class Collections {
  private static readonly EMPTY_MAP = new EmptyMap<unknown, unknown>()
  private static readonly EMPTY_LIST = new EmptyList<unknown>()
  static emptyMap<K, V>(): JavaMap<K, V> { return Collections.EMPTY_MAP as JavaMap<K, V> }
  static unmodifiableSet<T>(set: AbstractSet<T>): AbstractSet<T> { return new UnmodifiableSet(set) }
  static emptyList<T>(): AbstractList<T> { return Collections.EMPTY_LIST as AbstractList<T> }
}

class UnmodifiableSet<T> extends AbstractSet<T> {
  constructor(private readonly set: AbstractSet<T>) { super() }
  size(): number { return this.set.size() }
  contains(value: T): boolean { return this.set.contains(value) }
  add(_value: T): never { throw new Error('Unsupported operation on an unmodifiable set') }
  remove(_value: T): never { throw new Error('Unsupported operation on an unmodifiable set') }
  clear(): never { throw new Error('Unsupported operation on an unmodifiable set') }
  override addAll(_values: Iterable<T>): never { throw new Error('Unsupported operation on an unmodifiable set') }
  override removeAll(_values: Iterable<T>): never { throw new Error('Unsupported operation on an unmodifiable set') }
  override retainAll(_values: AbstractSet<T>): never { throw new Error('Unsupported operation on an unmodifiable set') }
  iterator(): Iterator<T> {
    const iterator = this.set.iterator()
    return { hasNext: () => iterator.hasNext(), next: () => iterator.next(), remove: () => { throw new Error('Unsupported operation on an unmodifiable set') } }
  }
}
