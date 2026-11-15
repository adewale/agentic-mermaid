/*
 * Copyright 2008, 2014 Google Inc. (GWT map iteration semantics).
 * Original GWT portions: Apache-2.0, http://www.apache.org/licenses/LICENSE-2.0.
 * Java Map operations with GWT 2.11's string-first, hash-chain iteration.
 * TypeScript translation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { JavaObject, javaEquals, javaHashCode } from '../lang/Object.ts'
import { JavaSet, isJavaSet } from './Set.ts'
import { Cloneable } from '../lang/Cloneable.ts'
import { iterableIterator, type Iterator } from './Iterator.ts'
import type { JavaMap, Entry } from './Map.ts'

export class SimpleEntry<K, V> extends JavaObject {
  constructor(private readonly key: K, private value: V) { super() }
  getKey(): K { return this.key }
  getValue(): V { return this.value }
  setValue(value: V): V { const previous = this.value; this.value = value; return previous }
  override equals(other: unknown): boolean {
    return other instanceof SimpleEntry && javaEquals(this.key, other.key) && javaEquals(this.value, other.value)
  }
  override hashCode(): number { return javaHashCode(this.key) ^ javaHashCode(this.value) }
}

export class HashMap<K, V> extends JavaObject implements JavaMap<K, V>, Cloneable, Iterable<SimpleEntry<K, V>> {
  readonly [Cloneable] = true
  private stringMap = new Map<string, SimpleEntry<K, V>>()
  private hashCodeMap = new Map<number, SimpleEntry<K, V>[]>()
  private count = 0
  protected modCount = 0

  constructor(source?: JavaMap<K, V> | number, loadFactor = 0) {
    super()
    if (typeof source === 'number' && source < 0) throw new Error('Negative initial capacity')
    if (loadFactor < 0) throw new Error('Non-positive load factor')
    if (source !== undefined && typeof source !== 'number') this.putAll(source)
  }

  protected entry(key: K): SimpleEntry<K, V> | null {
    if (typeof key === 'string') return this.stringMap.get(key) ?? null
    const chain = this.hashCodeMap.get(javaHashCode(key))
    return chain?.find(entry => javaEquals(key, entry.getKey())) ?? null
  }

  get(key: K): V | null { return this.entry(key)?.getValue() ?? null }
  containsKey(key: K): boolean { return this.entry(key) !== null }
  containsValue(value: V): boolean {
    for (const entry of this) if (javaEquals(value, entry.getValue())) return true
    return false
  }

  put(key: K, value: V): V | null {
    if (typeof key === 'string') {
      const entry = this.stringMap.get(key)
      if (entry) return entry.setValue(value)
      this.stringMap.set(key, new SimpleEntry(key, value))
    } else {
      const hash = javaHashCode(key)
      let chain = this.hashCodeMap.get(hash)
      if (chain) {
        const entry = chain.find(entry => javaEquals(key, entry.getKey()))
        if (entry) return entry.setValue(value)
      } else {
        chain = []
        this.hashCodeMap.set(hash, chain)
      }
      chain.push(new SimpleEntry(key, value))
    }
    this.count++
    this.modCount++
    return null
  }

  remove(key: K): V | null {
    if (typeof key === 'string') {
      const entry = this.stringMap.get(key)
      if (!entry) return null
      this.stringMap.delete(key)
      this.count--
      this.modCount++
      return entry.getValue()
    }
    const hash = javaHashCode(key)
    const chain = this.hashCodeMap.get(hash)
    if (!chain) return null
    const index = chain.findIndex(entry => javaEquals(key, entry.getKey()))
    if (index < 0) return null
    const [entry] = chain.splice(index, 1)
    if (chain.length === 0) this.hashCodeMap.delete(hash)
    this.count--
    this.modCount++
    return entry!.getValue()
  }

  putAll(other: JavaMap<K, V>): void {
    for (const entry of other.entrySet()) this.put(entry.getKey(), entry.getValue())
  }

  clear(): void {
    this.stringMap = new Map()
    this.hashCodeMap = new Map()
    this.count = 0
    this.modCount++
  }

  size(): number { return this.count }
  isEmpty(): boolean { return this.count === 0 }
  clone(): HashMap<K, V> { return new HashMap(this) }
  protected containsEntry(entry: Entry<K, V>): boolean {
    if (entry === null || typeof entry !== 'object' || typeof entry.getKey !== 'function' || typeof entry.getValue !== 'function') return false
    const key = entry.getKey(), value = entry.getValue(), ourValue = this.get(key)
    if (!javaEquals(value, ourValue)) return false
    return ourValue !== null || this.containsKey(key)
  }
  entrySet(): MapView<Entry<K, V>> { return new MapView<Entry<K, V>>(() => this.iterator(), () => this.size(), entry => this.containsEntry(entry), entry => { if (!this.containsEntry(entry)) return false; this.remove(entry.getKey()); return true }, () => this.clear(), true) }
  keySet(): MapView<K> {
    return this.project(entry => entry.getKey(), key => this.containsKey(key), key => {
      if (!this.containsKey(key)) return false
      this.remove(key)
      return true
    }, true)
  }
  values(): MapView<V> { return this.project(entry => entry.getValue(), value => this.containsValue(value)) }

  private project<T>(project: (entry: SimpleEntry<K, V>) => T, contains: (value: T) => boolean, remove?: (value: T) => boolean, setView = false): MapView<T> {
    return new MapView(() => {
      const source = this.iterator()
      return { hasNext: () => source.hasNext(), next: () => project(source.next()), remove: () => source.remove() }
    }, () => this.size(), contains, remove, () => this.clear(), setView)
  }

  iterator(): Iterator<SimpleEntry<K, V>> {
    const strings = this.stringMap.values()
    const chains = this.hashCodeMap.values()
    let currentString = strings.next()
    let chain: SimpleEntry<K, V>[] = []
    let chainIndex = 0
    let last: SimpleEntry<K, V> | null = null
    let lastModCount = this.modCount
    const hasNext = (): boolean => {
      if (!currentString.done) return true
      if (chainIndex < chain.length) return true
      const next = chains.next()
      if (next.done) return false
      chain = next.value
      chainIndex = 0
      return true
    }
    let available = hasNext()
    return {
      hasNext: () => available,
      next: () => {
        if (lastModCount !== this.modCount) throw new Error('Concurrent modification')
        if (!available) throw new Error('No such element')
        if (!currentString.done) {
          last = currentString.value
          currentString = strings.next()
        } else last = chain[chainIndex++]!
        available = hasNext()
        return last
      },
      remove: () => {
        if (last === null) throw new Error('No current element')
        if (lastModCount !== this.modCount) throw new Error('Concurrent modification')
        const currentChain = this.hashCodeMap.get(javaHashCode(last.getKey()))
        this.remove(last.getKey())
        if (currentChain === chain && chainIndex !== 0) chainIndex--
        last = null
        available = hasNext()
        lastModCount = this.modCount
      },
    }
  }

  [Symbol.iterator](): IterableIterator<SimpleEntry<K, V>> { return iterableIterator(this.iterator()) }
  override hashCode(): number { let hash = 0; for (const entry of this) hash = (hash + entry.hashCode()) | 0; return hash }
}

export class MapView<T> extends JavaObject implements Iterable<T> {
  constructor(private readonly makeIterator: () => Iterator<T>, private readonly getSize: () => number, private readonly containsElement?: (value: T) => boolean, private readonly removeElement?: (value: T) => boolean, private readonly clearElements?: () => void, private readonly setView = false) { super() }
  get [JavaSet](): boolean { return this.setView }
  contains(value: T): boolean {
    if (this.containsElement !== undefined) return this.containsElement(value)
    for (const element of this) if (javaEquals(value, element)) return true
    return false
  }
  add(_value: T): never { throw new Error('Unsupported operation') }
  addAll(values: Iterable<T>): boolean { let changed = false; for (const value of values) { this.add(value); changed = true } return changed }
  containsAll(values: Iterable<T>): boolean { for (const value of values) if (!this.contains(value)) return false; return true }
  remove(value: T): boolean {
    if (this.removeElement !== undefined) return this.removeElement(value)
    const iterator = this.iterator()
    while (iterator.hasNext()) if (javaEquals(value, iterator.next())) { iterator.remove(); return true }
    return false
  }
  removeAll(values: Iterable<T> & { contains(value: T): boolean; size(): number }): boolean {
    if (this.setView && this.size() >= values.size()) { let changed = false; for (const value of values) changed = this.remove(value) || changed; return changed }
    let changed = false
    const iterator = this.iterator()
    while (iterator.hasNext()) if (values.contains(iterator.next())) { iterator.remove(); changed = true }
    return changed
  }
  retainAll(values: { contains(value: T): boolean }): boolean {
    let changed = false
    const iterator = this.iterator()
    while (iterator.hasNext()) if (!values.contains(iterator.next())) { iterator.remove(); changed = true }
    return changed
  }
  clear(): void {
    if (this.clearElements !== undefined) { this.clearElements(); return }
    const iterator = this.iterator()
    while (iterator.hasNext()) { iterator.next(); iterator.remove() }
  }
  toArray(): T[]
  toArray(array: T[]): T[]
  toArray(array?: T[]): T[] {
    const result = array !== undefined && array.length >= this.size() ? array : new Array<T>(this.size())
    let index = 0
    for (const value of this) result[index++] = value
    if (result.length > index) result[index] = null as T
    return result
  }
  override hashCode(): number { if (!this.setView) return super.hashCode(); let hash = 0; for (const value of this) hash = (hash + javaHashCode(value)) | 0; return hash }
  override equals(other: unknown): boolean { return this.setView ? other === this || isJavaSet<T>(other) && other.size() === this.size() && this.containsAll(other) : super.equals(other) }
  override toString(): string { return `[${Array.from(this, value => (value as unknown) === this ? '(this Collection)' : String(value)).join(', ')}]` }
  iterator(): Iterator<T> { return this.makeIterator() }
  size(): number { return this.getSize() }
  isEmpty(): boolean { return this.size() === 0 }
  [Symbol.iterator](): IterableIterator<T> { return iterableIterator(this.iterator()) }
}
