/*
 * Copyright (C) 2007 The Guava Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
/* TypeScript translation: EPL-2.0. Guava 31.1-jre GWT-compatible source.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { JavaObject, javaEquals, javaHashCode } from '../../../../java/lang/Object.ts'
import { AbstractSet } from '../../../../java/util/AbstractSet.ts'
import { MapView } from '../../../../java/util/HashMap.ts'
import type { Iterator } from '../../../../java/util/Iterator.ts'
import type { Entry, JavaMap } from '../../../../java/util/Map.ts'
import type { BiMap } from './BiMap.ts'

class BiEntry<K, V> {
  nextInKToVBucket: BiEntry<K, V> | null = null
  nextInVToKBucket: BiEntry<K, V> | null = null
  nextInKeyInsertionOrder: BiEntry<K, V> | null = null
  prevInKeyInsertionOrder: BiEntry<K, V> | null = null
  constructor(readonly key: K, readonly keyHash: number, readonly value: V, readonly valueHash: number) {}
}

function equal(left: unknown, right: unknown): boolean { return left === right || javaEquals(left, right) }

function smearedHash(value: unknown): number {
  const hash = Math.imul(javaHashCode(value), 0xcc9e2d51)
  return Math.imul((hash << 15) | (hash >>> 17), 0x1b873593)
}

export class HashBiMap<K, V> extends JavaObject implements BiMap<K, V> {
  private hashTableKToV: (BiEntry<K, V> | null)[]
  private hashTableVToK: (BiEntry<K, V> | null)[]
  private firstInKeyInsertionOrder: BiEntry<K, V> | null = null
  private lastInKeyInsertionOrder: BiEntry<K, V> | null = null
  private count = 0
  private mask: number
  private modCount = 0
  private inverseView: BiMap<V, K> | null = null

  static create<K, V>(source?: number | JavaMap<K, V>): HashBiMap<K, V> {
    const result = new HashBiMap<K, V>(typeof source === 'number' ? source : source?.size() ?? 16)
    if (source !== undefined && typeof source !== 'number') result.putAll(source)
    return result
  }

  private constructor(expectedSize: number) {
    super()
    if (expectedSize < 0) throw new Error('expectedSize cannot be negative')
    expectedSize = Math.max(expectedSize, 2)
    let tableSize = 2 ** Math.floor(Math.log2(expectedSize))
    if (expectedSize > tableSize) tableSize = Math.min(tableSize * 2, 0x40000000)
    this.hashTableKToV = new Array<BiEntry<K, V> | null>(tableSize).fill(null)
    this.hashTableVToK = new Array<BiEntry<K, V> | null>(tableSize).fill(null)
    this.mask = tableSize - 1
  }

  private delete(entry: BiEntry<K, V>): void {
    const keyBucket = entry.keyHash & this.mask
    let previous: BiEntry<K, V> | null = null
    for (let current = this.hashTableKToV[keyBucket]!; ; current = current.nextInKToVBucket!) {
      if (current === entry) {
        if (previous === null) this.hashTableKToV[keyBucket] = entry.nextInKToVBucket
        else previous.nextInKToVBucket = entry.nextInKToVBucket
        break
      }
      previous = current
    }
    const valueBucket = entry.valueHash & this.mask
    previous = null
    for (let current = this.hashTableVToK[valueBucket]!; ; current = current.nextInVToKBucket!) {
      if (current === entry) {
        if (previous === null) this.hashTableVToK[valueBucket] = entry.nextInVToKBucket
        else previous.nextInVToKBucket = entry.nextInVToKBucket
        break
      }
      previous = current
    }
    if (entry.prevInKeyInsertionOrder === null) this.firstInKeyInsertionOrder = entry.nextInKeyInsertionOrder
    else entry.prevInKeyInsertionOrder.nextInKeyInsertionOrder = entry.nextInKeyInsertionOrder
    if (entry.nextInKeyInsertionOrder === null) this.lastInKeyInsertionOrder = entry.prevInKeyInsertionOrder
    else entry.nextInKeyInsertionOrder.prevInKeyInsertionOrder = entry.prevInKeyInsertionOrder
    this.count--
    this.modCount++
  }

  private insert(entry: BiEntry<K, V>, oldEntryForKey: BiEntry<K, V> | null): void {
    const keyBucket = entry.keyHash & this.mask
    entry.nextInKToVBucket = this.hashTableKToV[keyBucket]!
    this.hashTableKToV[keyBucket] = entry
    const valueBucket = entry.valueHash & this.mask
    entry.nextInVToKBucket = this.hashTableVToK[valueBucket]!
    this.hashTableVToK[valueBucket] = entry
    if (oldEntryForKey === null) {
      entry.prevInKeyInsertionOrder = this.lastInKeyInsertionOrder
      entry.nextInKeyInsertionOrder = null
      if (this.lastInKeyInsertionOrder === null) this.firstInKeyInsertionOrder = entry
      else this.lastInKeyInsertionOrder.nextInKeyInsertionOrder = entry
      this.lastInKeyInsertionOrder = entry
    } else {
      entry.prevInKeyInsertionOrder = oldEntryForKey.prevInKeyInsertionOrder
      if (entry.prevInKeyInsertionOrder === null) this.firstInKeyInsertionOrder = entry
      else entry.prevInKeyInsertionOrder.nextInKeyInsertionOrder = entry
      entry.nextInKeyInsertionOrder = oldEntryForKey.nextInKeyInsertionOrder
      if (entry.nextInKeyInsertionOrder === null) this.lastInKeyInsertionOrder = entry
      else entry.nextInKeyInsertionOrder.prevInKeyInsertionOrder = entry
    }
    this.count++
    this.modCount++
  }

  private seekByKey(key: K, keyHash: number): BiEntry<K, V> | null {
    for (let entry: BiEntry<K, V> | null = this.hashTableKToV[keyHash & this.mask]!; entry !== null; entry = entry.nextInKToVBucket) {
      if (keyHash === entry.keyHash && equal(key, entry.key)) return entry
    }
    return null
  }

  private seekByValue(value: V, valueHash: number): BiEntry<K, V> | null {
    for (let entry: BiEntry<K, V> | null = this.hashTableVToK[valueHash & this.mask]!; entry !== null; entry = entry.nextInVToKBucket) {
      if (valueHash === entry.valueHash && equal(value, entry.value)) return entry
    }
    return null
  }

  containsKey(key: K): boolean { return this.seekByKey(key, smearedHash(key)) !== null }
  containsValue(value: V): boolean { return this.seekByValue(value, smearedHash(value)) !== null }
  get(key: K): V | null { return this.seekByKey(key, smearedHash(key))?.value ?? null }
  put(key: K, value: V): V | null { return this.putInternal(key, value, false) }
  forcePut(key: K, value: V): V | null { return this.putInternal(key, value, true) }

  private putInternal(key: K, value: V, force: boolean): V | null {
    const keyHash = smearedHash(key)
    const valueHash = smearedHash(value)
    const oldEntryForKey = this.seekByKey(key, keyHash)
    if (oldEntryForKey !== null && valueHash === oldEntryForKey.valueHash && equal(value, oldEntryForKey.value)) return value
    const oldEntryForValue = this.seekByValue(value, valueHash)
    if (oldEntryForValue !== null) {
      if (force) this.delete(oldEntryForValue)
      else throw new Error(`value already present: ${value}`)
    }
    const newEntry = new BiEntry(key, keyHash, value, valueHash)
    if (oldEntryForKey !== null) {
      this.delete(oldEntryForKey)
      this.insert(newEntry, oldEntryForKey)
      oldEntryForKey.prevInKeyInsertionOrder = null
      oldEntryForKey.nextInKeyInsertionOrder = null
      return oldEntryForKey.value
    }
    this.insert(newEntry, null)
    this.rehashIfNecessary()
    return null
  }

  private putInverse(value: V, key: K, force: boolean): K | null {
    const valueHash = smearedHash(value)
    const keyHash = smearedHash(key)
    const oldEntryForValue = this.seekByValue(value, valueHash)
    const oldEntryForKey = this.seekByKey(key, keyHash)
    if (oldEntryForValue !== null && keyHash === oldEntryForValue.keyHash && equal(key, oldEntryForValue.key)) return key
    if (oldEntryForKey !== null && !force) throw new Error(`key already present: ${key}`)
    if (oldEntryForValue !== null) this.delete(oldEntryForValue)
    if (oldEntryForKey !== null) this.delete(oldEntryForKey)
    this.insert(new BiEntry(key, keyHash, value, valueHash), oldEntryForKey)
    if (oldEntryForKey !== null) {
      oldEntryForKey.prevInKeyInsertionOrder = null
      oldEntryForKey.nextInKeyInsertionOrder = null
    }
    if (oldEntryForValue !== null) {
      oldEntryForValue.prevInKeyInsertionOrder = null
      oldEntryForValue.nextInKeyInsertionOrder = null
    }
    this.rehashIfNecessary()
    return oldEntryForValue?.key ?? null
  }

  private rehashIfNecessary(): void {
    if (this.count > this.hashTableKToV.length && this.hashTableKToV.length < 0x40000000) {
      const newTableSize = this.hashTableKToV.length * 2
      this.hashTableKToV = new Array<BiEntry<K, V> | null>(newTableSize).fill(null)
      this.hashTableVToK = new Array<BiEntry<K, V> | null>(newTableSize).fill(null)
      this.mask = newTableSize - 1
      this.count = 0
      for (let entry = this.firstInKeyInsertionOrder; entry !== null; entry = entry.nextInKeyInsertionOrder) this.insert(entry, entry)
      this.modCount++
    }
  }

  remove(key: K): V | null {
    const entry = this.seekByKey(key, smearedHash(key))
    if (entry === null) return null
    this.delete(entry)
    entry.prevInKeyInsertionOrder = null
    entry.nextInKeyInsertionOrder = null
    return entry.value
  }

  clear(): void {
    this.count = 0
    this.hashTableKToV.fill(null)
    this.hashTableVToK.fill(null)
    this.firstInKeyInsertionOrder = null
    this.lastInKeyInsertionOrder = null
    this.modCount++
  }
  size(): number { return this.count }
  isEmpty(): boolean { return this.size() === 0 }
  putAll(map: JavaMap<K, V>): void { for (const entry of map.entrySet()) this.put(entry.getKey(), entry.getValue()) }

  private itr<T>(output: (entry: BiEntry<K, V>, state: { expectedModCount: number; toRemove: BiEntry<K, V> | null }) => T): Iterator<T> {
    let next = this.firstInKeyInsertionOrder
    let remaining = this.size()
    const state = { expectedModCount: this.modCount, toRemove: null as BiEntry<K, V> | null }
    const hasNext = (): boolean => {
      if (this.modCount !== state.expectedModCount) throw new Error('Concurrent modification')
      return next !== null && remaining > 0
    }
    return {
      hasNext,
      next: () => {
        if (!hasNext()) throw new Error('No such element')
        const entry = next!
        next = entry.nextInKeyInsertionOrder
        state.toRemove = entry
        remaining--
        return output(entry, state)
      },
      remove: () => {
        if (this.modCount !== state.expectedModCount) throw new Error('Concurrent modification')
        if (state.toRemove === null) throw new Error('no calls to next() since the last call to remove()')
        this.delete(state.toRemove)
        state.expectedModCount = this.modCount
        state.toRemove = null
      },
    }
  }

  keySet(): AbstractSet<K> {
    return new KeySet(this, () => this.itr(entry => entry.key), key => this.containsKey(key), key => {
      const entry = this.seekByKey(key, smearedHash(key))
      if (entry === null) return false
      this.delete(entry)
      entry.prevInKeyInsertionOrder = null
      entry.nextInKeyInsertionOrder = null
      return true
    })
  }
  values(): AbstractSet<V> { return this.inverse().keySet() }
  entrySet(): MapView<Entry<K, V>> { return new MapView(() => this.entryIterator(), () => this.size(), undefined, undefined, undefined, true) }

  entryIterator(): Iterator<Entry<K, V>> {
    return this.itr((entry, state) => {
      let delegate = entry
      return new MapEntry(() => delegate.key, () => delegate.value, value => {
        const oldValue = delegate.value
        const valueHash = smearedHash(value)
        if (valueHash === delegate.valueHash && equal(value, oldValue)) return value
        if (this.seekByValue(value, valueHash) !== null) throw new Error(`value already present: ${value}`)
        this.delete(delegate)
        const newEntry = new BiEntry(delegate.key, delegate.keyHash, value, valueHash)
        this.insert(newEntry, delegate)
        delegate.prevInKeyInsertionOrder = null
        delegate.nextInKeyInsertionOrder = null
        state.expectedModCount = this.modCount
        if (state.toRemove === delegate) state.toRemove = newEntry
        delegate = newEntry
        return oldValue
      })
    })
  }

  forEach(action: (key: K, value: V) => void): void {
    for (let entry = this.firstInKeyInsertionOrder; entry !== null; entry = entry.nextInKeyInsertionOrder) action(entry.key, entry.value)
  }
  replaceAll(fn: (key: K, value: V) => V): void {
    const oldFirst = this.firstInKeyInsertionOrder
    this.clear()
    for (let entry = oldFirst; entry !== null; entry = entry.nextInKeyInsertionOrder) this.put(entry.key, fn(entry.key, entry.value))
  }
  override hashCode(): number {
    let hash = 0
    for (const entry of this.entrySet()) hash = (hash + (javaHashCode(entry.getKey()) ^ javaHashCode(entry.getValue()))) | 0
    return hash
  }

  inverse(): BiMap<V, K> {
    if (this.inverseView !== null) return this.inverseView
    const forward = this
    this.inverseView = new class Inverse extends JavaObject implements BiMap<V, K> {
      size(): number { return forward.size() }
      isEmpty(): boolean { return this.size() === 0 }
      clear(): void { forward.clear() }
      containsKey(value: V): boolean { return forward.containsValue(value) }
      containsValue(key: K): boolean {
        for (const entry of this.entrySet()) if (javaEquals(key, entry.getValue())) return true
        return false
      }
      get(value: V): K | null { return forward.seekByValue(value, smearedHash(value))?.key ?? null }
      put(value: V, key: K): K | null { return forward.putInverse(value, key, false) }
      forcePut(value: V, key: K): K | null { return forward.putInverse(value, key, true) }
      putAll(map: JavaMap<V, K>): void { for (const entry of map.entrySet()) this.put(entry.getKey(), entry.getValue()) }
      remove(value: V): K | null {
        const entry = forward.seekByValue(value, smearedHash(value))
        if (entry === null) return null
        forward.delete(entry)
        entry.prevInKeyInsertionOrder = null
        entry.nextInKeyInsertionOrder = null
        return entry.key
      }
      inverse(): BiMap<K, V> { return forward }
      keySet(): AbstractSet<V> {
        return new KeySet(this, () => forward.itr(entry => entry.value), value => this.containsKey(value), value => {
          const entry = forward.seekByValue(value, smearedHash(value))
          if (entry === null) return false
          forward.delete(entry)
          return true
        })
      }
      values(): AbstractSet<K> { return forward.keySet() }
      entrySet(): MapView<Entry<V, K>> { return new MapView(() => this.entryIterator(), () => this.size(), undefined, undefined, undefined, true) }
      entryIterator(): Iterator<Entry<V, K>> {
        return forward.itr((entry, state) => {
          let delegate = entry
          return new MapEntry(() => delegate.value, () => delegate.key, key => {
            const oldKey = delegate.key
            const keyHash = smearedHash(key)
            if (keyHash === delegate.keyHash && equal(key, oldKey)) return key
            if (forward.seekByKey(key, keyHash) !== null) throw new Error(`value already present: ${key}`)
            forward.delete(delegate)
            const newEntry = new BiEntry(key, keyHash, delegate.value, delegate.valueHash)
            delegate = newEntry
            forward.insert(newEntry, null)
            state.expectedModCount = forward.modCount
            return oldKey
          })
        })
      }
      forEach(action: (value: V, key: K) => void): void { forward.forEach((key, value) => action(value, key)) }
      replaceAll(fn: (value: V, key: K) => K): void {
        const oldFirst = forward.firstInKeyInsertionOrder
        this.clear()
        for (let entry = oldFirst; entry !== null; entry = entry.nextInKeyInsertionOrder) this.put(entry.value, fn(entry.value, entry.key))
      }
      override hashCode(): number { return forward.hashCode() }
    }()
    return this.inverseView
  }
}

class MapEntry<K, V> extends JavaObject implements Entry<K, V> {
  constructor(private readonly key: () => K, private readonly value: () => V, private readonly changeValue: (value: V) => V) { super() }
  getKey(): K { return this.key() }
  getValue(): V { return this.value() }
  setValue(value: V): V { return this.changeValue(value) }
  override equals(other: unknown): boolean {
    const entry = other as Entry<K, V> | null
    return entry !== null && typeof entry === 'object' && typeof entry.getKey === 'function' && typeof entry.getValue === 'function' && equal(this.getKey(), entry.getKey()) && equal(this.getValue(), entry.getValue())
  }
  override hashCode(): number { return javaHashCode(this.getKey()) ^ javaHashCode(this.getValue()) }
}

class KeySet<T> extends AbstractSet<T> {
  constructor(private readonly map: { size(): number; clear(): void }, private readonly makeIterator: () => Iterator<T>, private readonly has: (key: T) => boolean, private readonly deleteKey: (key: T) => boolean) { super() }
  size(): number { return this.map.size() }
  iterator(): Iterator<T> { return this.makeIterator() }
  contains(key: T): boolean { return this.has(key) }
  add(_key: T): never { throw new Error('Unsupported operation on a map key set') }
  remove(key: T): boolean { return this.deleteKey(key) }
  clear(): void { this.map.clear() }
}
