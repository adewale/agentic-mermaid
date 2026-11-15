/*
 * Copyright (C) 2007 The Guava Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* TypeScript translation: EPL-2.0. Guava 31.1-jre GWT-compatible source.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { AbstractSet } from '../../../../java/util/AbstractSet.ts'
import { Collections } from '../../../../java/util/Collections.ts'
import { HashMap } from '../../../../java/util/HashMap.ts'
import type { Iterator } from '../../../../java/util/Iterator.ts'
import { AbstractMultimap } from './AbstractMultimap.ts'

export abstract class AbstractMapBasedMultimap<K, V> extends AbstractMultimap<K, V> {
  totalSize = 0
  constructor(private readonly map: HashMap<K, AbstractSet<V>>) {
    super()
    if (!map.isEmpty()) throw new Error('Backing map must be empty')
  }
  abstract createCollection(): AbstractSet<V>
  backingMap(): HashMap<K, AbstractSet<V>> { return this.map }
  size(): number { return this.totalSize }
  containsKey(key: K): boolean { return this.map.containsKey(key) }
  containsValue(value: V): boolean { for (const collection of this.map.values()) if (collection.contains(value)) return true; return false }
  override containsEntry(key: K, value: V): boolean { return this.map.get(key)?.contains(value) ?? false }
  override remove(key: K, value: V): boolean {
    const collection = this.map.get(key)
    return collection !== null && this.wrapCollection(key, collection).remove(value)
  }
  override put(key: K, value: V): boolean {
    let collection = this.map.get(key)
    if (collection === null) {
      collection = this.createCollection()
      if (!collection.add(value)) throw new Error('New Collection violated the Collection spec')
      this.totalSize++
      this.map.put(key, collection)
      return true
    }
    if (collection.add(value)) { this.totalSize++; return true }
    return false
  }
  override replaceValues(key: K, values: Iterable<V>): AbstractSet<V> {
    const iterator = values[Symbol.iterator]()
    let value = iterator.next()
    if (value.done) return this.removeAll(key)
    let collection = this.map.get(key)
    if (collection === null) { collection = this.createCollection(); this.map.put(key, collection) }
    const oldValues = this.createCollection()
    oldValues.addAll(collection)
    this.totalSize -= collection.size()
    collection.clear()
    do { if (collection.add(value.value)) this.totalSize++; value = iterator.next() } while (!value.done)
    return Collections.unmodifiableSet(oldValues)
  }
  removeAll(key: K): AbstractSet<V> {
    const collection = this.map.remove(key)
    const output = this.createCollection()
    if (collection !== null) {
      output.addAll(collection)
      this.totalSize -= collection.size()
      collection.clear()
    }
    return Collections.unmodifiableSet(output)
  }
  clear(): void {
    for (const collection of this.map.values()) collection.clear()
    this.map.clear()
    this.totalSize = 0
  }
  get(key: K): AbstractSet<V> { return this.wrapCollection(key, this.map.get(key) ?? this.createCollection()) }
  wrapCollection(key: K, collection: AbstractSet<V>): AbstractSet<V> { return new WrappedCollection(this, key, collection) }
}

/** The full-collection path of Guava's WrappedCollection; set views have no subcollections. */
export class WrappedCollection<K, V> extends AbstractSet<V> {
  constructor(protected readonly multimap: AbstractMapBasedMultimap<K, V>, protected readonly key: K, protected delegate: AbstractSet<V>) { super() }
  refreshIfEmpty(): void {
    if (this.delegate.isEmpty()) {
      const newDelegate = this.multimap.backingMap().get(this.key)
      if (newDelegate !== null) this.delegate = newDelegate
    }
  }
  removeIfEmpty(): void { if (this.delegate.isEmpty()) this.multimap.backingMap().remove(this.key) }
  addToMap(): void { this.multimap.backingMap().put(this.key, this.delegate) }
  size(): number { this.refreshIfEmpty(); return this.delegate.size() }
  contains(value: V): boolean { this.refreshIfEmpty(); return this.delegate.contains(value) }
  override containsAll(values: Iterable<V>): boolean { this.refreshIfEmpty(); return this.delegate.containsAll(values) }
  override equals(other: unknown): boolean { if (other === this) return true; this.refreshIfEmpty(); return this.delegate.equals(other) }
  override hashCode(): number { this.refreshIfEmpty(); return this.delegate.hashCode() }
  override toString(): string { this.refreshIfEmpty(); return this.delegate.toString() }
  iterator(): Iterator<V> {
    this.refreshIfEmpty()
    const originalDelegate = this.delegate
    const delegateIterator = originalDelegate.iterator()
    const validateIterator = (): void => { this.refreshIfEmpty(); if (this.delegate !== originalDelegate) throw new Error('Concurrent modification') }
    return {
      hasNext: () => { validateIterator(); return delegateIterator.hasNext() },
      next: () => { validateIterator(); return delegateIterator.next() },
      remove: () => { delegateIterator.remove(); this.multimap.totalSize--; this.removeIfEmpty() },
    }
  }
  add(value: V): boolean {
    this.refreshIfEmpty()
    const wasEmpty = this.delegate.isEmpty()
    const changed = this.delegate.add(value)
    if (changed) { this.multimap.totalSize++; if (wasEmpty) this.addToMap() }
    return changed
  }
  override addAll(values: Iterable<V>): boolean {
    const collection = values as Iterable<V> & { isEmpty?: () => boolean }
    if (collection.isEmpty?.()) return false
    const oldSize = this.size()
    const changed = this.delegate.addAll(values)
    if (changed) { this.multimap.totalSize += this.delegate.size() - oldSize; if (oldSize === 0) this.addToMap() }
    return changed
  }
  clear(): void {
    const oldSize = this.size()
    if (oldSize === 0) return
    this.delegate.clear()
    this.multimap.totalSize -= oldSize
    this.removeIfEmpty()
  }
  remove(value: V): boolean {
    this.refreshIfEmpty()
    const changed = this.delegate.remove(value)
    if (changed) { this.multimap.totalSize--; this.removeIfEmpty() }
    return changed
  }
  override removeAll(values: Iterable<V>): boolean {
    const collection = values as Iterable<V> & { isEmpty?: () => boolean }
    if (collection.isEmpty?.()) return false
    const oldSize = this.size()
    const changed = this.delegate.removeAll(values)
    if (changed) { this.multimap.totalSize += this.delegate.size() - oldSize; this.removeIfEmpty() }
    return changed
  }
  override retainAll(values: AbstractSet<V>): boolean {
    const oldSize = this.size()
    const changed = this.delegate.retainAll(values)
    if (changed) { this.multimap.totalSize += this.delegate.size() - oldSize; this.removeIfEmpty() }
    return changed
  }
}

export class WrappedSet<K, V> extends WrappedCollection<K, V> {
  override removeAll(values: Iterable<V>): boolean {
    const collection = values as Iterable<V> & { isEmpty?: () => boolean; size?: () => number; contains?: (value: V) => boolean }
    if (collection.isEmpty?.()) return false
    const oldSize = this.size()
    let changed = false
    // Sets.removeAllImpl: iterate this set only when the input is a larger set.
    if (values instanceof AbstractSet && values.size() > this.delegate.size()) {
      const iterator = this.delegate.iterator()
      while (iterator.hasNext()) if (values.contains(iterator.next())) { iterator.remove(); changed = true }
    } else for (const value of values) changed = this.delegate.remove(value) || changed
    if (changed) { this.multimap.totalSize += this.delegate.size() - oldSize; this.removeIfEmpty() }
    return changed
  }
}
