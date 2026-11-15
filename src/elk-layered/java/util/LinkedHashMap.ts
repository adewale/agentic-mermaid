/*
 * Copyright 2008 Google Inc. (GWT LinkedHashMap operations).
 * Original GWT portions: Apache-2.0, http://www.apache.org/licenses/LICENSE-2.0.
 * TypeScript translation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { javaEquals } from '../lang/Object.ts'
import { HashMap, SimpleEntry } from './HashMap.ts'
import type { Iterator } from './Iterator.ts'
import type { JavaMap } from './Map.ts'

class ChainEntry<K, V> extends SimpleEntry<K, V> {
  next: ChainEntry<K, V> | null = null
  prev: ChainEntry<K, V> | null = null
  constructor(private readonly head: ChainEntry<K, V> | null, key: K, value: V) { super(key, value) }
  addToEnd(): void { const tail = this.head!.prev!; this.prev = tail; this.next = this.head; tail.next = this.head!.prev = this }
  remove(): void { this.next!.prev = this.prev; this.prev!.next = this.next; this.next = this.prev = null }
}

export class LinkedHashMap<K, V> extends HashMap<K, V> {
  private readonly head = new ChainEntry<K, V>(null, null as K, null as V)
  private readonly map = new HashMap<K, ChainEntry<K, V>>()
  private readonly accessOrder: boolean

  constructor(source?: JavaMap<K, V> | number, loadFactor = 0, accessOrder = false) {
    super(typeof source === 'number' ? source : undefined, loadFactor)
    this.accessOrder = accessOrder
    this.resetChainEntries()
    if (source !== undefined && typeof source !== 'number') this.putAll(source)
  }
  private resetChainEntries(): void { this.head.prev = this.head; this.head.next = this.head }
  override clear(): void { this.map.clear(); this.modCount++; this.resetChainEntries() }
  override clone(): LinkedHashMap<K, V> { return new LinkedHashMap(this) }
  override containsKey(key: K): boolean { return this.map.containsKey(key) }
  override containsValue(value: V): boolean { let node = this.head.next!; while (node !== this.head) { if (javaEquals(node.getValue(), value)) return true; node = node.next! } return false }
  override get(key: K): V | null {
    const entry = this.map.get(key)
    if (entry === null) return null
    this.recordAccess(entry)
    return entry.getValue()
  }
  override put(key: K, value: V): V | null {
    const old = this.map.get(key)
    if (old !== null) { const oldValue = old.setValue(value); this.recordAccess(old); return oldValue }
    const entry = new ChainEntry(this.head, key, value)
    this.map.put(key, entry)
    this.modCount++
    entry.addToEnd()
    const eldest = this.head.next!
    if (this.removeEldestEntry(eldest)) { eldest.remove(); this.map.remove(eldest.getKey()); this.modCount++ }
    return null
  }
  override remove(key: K): V | null {
    const entry = this.map.remove(key)
    if (entry === null) return null
    entry.remove()
    this.modCount++
    return entry.getValue()
  }
  override size(): number { return this.map.size() }
  override isEmpty(): boolean { return this.size() === 0 }
  protected removeEldestEntry(_eldest: SimpleEntry<K, V>): boolean { return false }
  private recordAccess(entry: ChainEntry<K, V>): void { if (this.accessOrder) { entry.remove(); entry.addToEnd() } }
  override iterator(): Iterator<SimpleEntry<K, V>> {
    let last: ChainEntry<K, V> | null = null
    let next = this.head.next!
    let expectedModCount = this.modCount
    return {
      hasNext: () => next !== this.head,
      next: () => {
        if (this.modCount !== expectedModCount) throw new Error('Concurrent modification')
        if (next === this.head) throw new Error('No such element')
        last = next
        next = next.next!
        return last
      },
      remove: () => {
        if (last === null) throw new Error('No current element')
        if (this.modCount !== expectedModCount) throw new Error('Concurrent modification')
        last.remove()
        this.map.remove(last.getKey())
        this.modCount++
        expectedModCount = this.modCount
        last = null
      },
    }
  }
}
