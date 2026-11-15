/*******************************************************************************
 * Copyright (c) 2002-2011 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { JavaObject, javaEquals, javaHashCode } from '../../../../../java/lang/Object.ts'
import type { AbstractList } from '../../../../../java/util/AbstractList.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import { Collections } from '../../../../../java/util/Collections.ts'
import { MapView } from '../../../../../java/util/HashMap.ts'
import { iterableIterator, type Iterator, type ListIterator } from '../../../../../java/util/Iterator.ts'
import type { Entry as MapEntry, JavaMap } from '../../../../../java/util/Map.ts'
import { JavaList, isJavaList } from '../../../../../java/util/List.ts'
import { BasicEList } from './BasicEList.ts'
import type { EMap } from './EMap.ts'

export class BasicEMap<K, V> extends JavaObject implements EMap<K, V> {
  readonly [JavaList] = true
  static readonly #serialVersionUID = 2n
  protected delegateEList!: BasicEList<BasicEMap.Entry<K, V>>
  protected sizeValue = 0
  protected entryData: (BasicEList<BasicEMap.Entry<K, V>> | null)[] | null = null
  protected modCount = 0
  private view: { map?: JavaMap<K, V>; keys?: EMapView<K>; entries?: EMapView<MapEntry<K, V>>; values?: EMapView<V> } | null = null

  constructor(source?: number | JavaMap<K, V>) {
    super()
    this.initializeDelegateEList()
    if (typeof source === 'number') {
      if (source < 0) throw new Error('Illegal Capacity:' + source)
      this.entryData = this.newEntryData(source)
    } else if (source !== undefined && source.size() > 0) { this.entryData = this.newEntryData(2 * source.size()); this.putAll(source) }
  }

  protected initializeDelegateEList(): void {
    const owner = this
    this.delegateEList = new class extends BasicEList<BasicEMap.Entry<K, V>> {
      protected override didAdd(_index: number, newObject: BasicEMap.Entry<K, V>): void { owner.doPut(newObject) }
      protected override didSet(index: number, newObject: BasicEMap.Entry<K, V>, oldObject: BasicEMap.Entry<K, V>): void { this.didRemove(index, oldObject); this.didAdd(index, newObject) }
      protected override didRemove(_index: number, oldObject: BasicEMap.Entry<K, V>): void { owner.doRemove(oldObject) }
      protected override didClear(_size: number, _oldObjects: BasicEMap.Entry<K, V>[] | null): void { owner.doClear() }
      protected override didMove(_index: number, movedObject: BasicEMap.Entry<K, V>, _oldIndex: number): void { owner.doMove(movedObject) }
    }()
  }
  protected newEntryData(capacity: number): (BasicEList<BasicEMap.Entry<K, V>> | null)[] { return new Array<BasicEList<BasicEMap.Entry<K, V>> | null>(capacity).fill(null) }
  protected ensureEntryDataExists(): void {
    if (this.entryData === null) {
      this.entryData = this.newEntryData(2 * this.sizeValue + 1)
      const oldModCount = this.modCount
      this.sizeValue = 0
      for (const entry of this.delegateEList) this.doPut(entry)
      this.modCount = oldModCount
    }
  }
  protected newList(): BasicEList<BasicEMap.Entry<K, V>> { return new BasicEList() }
  protected newEntry(hash: number, key: K, value: V): BasicEMap.Entry<K, V> { this.validateKey(key); this.validateValue(value); return new BasicEMap.EntryImpl(this, hash, key, value) }
  protected putEntry(entry: BasicEMap.Entry<K, V>, value: V): V { return entry.setValue(value) }
  useEqualsForKey(): boolean { return true }
  useEqualsForValue(): boolean { return true }
  protected resolve(_key: K, value: V): V { return value }
  validateKey(_key: K): void {}
  validateValue(_value: V): void {}
  protected didAdd(_entry: BasicEMap.Entry<K, V>): void {}
  protected didModify(_entry: BasicEMap.Entry<K, V>, _oldValue: V): void {}
  protected didRemove(_entry: BasicEMap.Entry<K, V>): void {}
  protected didClear(oldEntryData: (BasicEList<BasicEMap.Entry<K, V>> | null)[] | null): void {
    if (oldEntryData !== null) for (const list of oldEntryData) if (list !== null) for (let j = 0; j < list.size(); j++) this.didRemove(list.get(j))
  }
  size(): number { return this.sizeValue }
  isEmpty(): boolean { return this.sizeValue === 0 }
  indexOfKey(key: K): number { for (let i = 0; i < this.delegateEList.size(); i++) if (this.keyEquals(key, this.delegateEList.get(i).getKey())) return i; return -1 }
  containsKey(key: K): boolean {
    if (this.sizeValue === 0) return false
    this.ensureEntryDataExists()
    const hash = this.hashOf(key)
    return this.entryIndexForKey(this.indexOfHash(hash), hash, key) !== -1
  }
  containsValue(value: V): boolean {
    if (this.sizeValue > 0) {
      this.ensureEntryDataExists()
      for (const list of this.entryData!) if (list !== null) for (const entry of list) if (this.valueEquals(value, entry.getValue())) return true
    }
    return false
  }

  get(index: number): BasicEMap.Entry<K, V>
  get(key: K): V | null
  get(first: number | K): BasicEMap.Entry<K, V> | V | null { return typeof first === 'number' ? this.delegateEList.get(first) : this.getValueForKey(first) }
  getValueForKey(key: K): V | null {
    if (this.sizeValue > 0) {
      this.ensureEntryDataExists()
      const hash = this.hashOf(key)
      const entry = this.entryForKey(this.indexOfHash(hash), hash, key)
      if (entry !== null) return this.resolve(key, entry.getValue())
    }
    return null
  }
  put(key: K, value: V): V | null {
    this.ensureEntryDataExists()
    const hash = this.hashOf(key)
    if (this.sizeValue > 0) {
      const entry = this.entryForKey(this.indexOfHash(hash), hash, key)
      if (entry !== null) { const result = this.putEntry(entry, value); this.didModify(entry, result); return result }
    }
    this.delegateEList.add(this.newEntry(hash, key, value))
    return null
  }
  protected doPut(entry: BasicEMap.Entry<K, V>): void {
    if (this.entryData === null) { ++this.modCount; ++this.sizeValue }
    else {
      const hash = entry.getHash()
      this.grow(this.sizeValue + 1)
      const index = this.indexOfHash(hash)
      let list = this.entryData![index]!
      if (list === null) list = this.entryData![index] = this.newList()
      list.add(entry)
      ++this.sizeValue
      this.didAdd(entry)
    }
  }
  removeKey(key: K): V | null {
    this.ensureEntryDataExists()
    const hash = this.hashOf(key)
    const entry = this.entryForKey(this.indexOfHash(hash), hash, key)
    if (entry === null) return null
    this.remove(entry)
    return entry.getValue()
  }
  protected doRemove(entry: BasicEMap.Entry<K, V>): void {
    if (this.entryData === null) { ++this.modCount; --this.sizeValue }
    else {
      const key = entry.getKey(), hash = entry.getHash(), index = this.indexOfHash(hash)
      this.removeEntry(index, this.entryIndexForKey(index, hash, key))
      this.didRemove(entry)
    }
  }
  protected removeEntry(index: number, entryIndex: number): V { ++this.modCount; --this.sizeValue; return this.entryData![index]!.removeAt(entryIndex).getValue() }
  putAll(map: JavaMap<K, V> | EMap<K, V>): void { for (const entry of 'entrySet' in map ? map.entrySet() : map) this.put(entry.getKey(), entry.getValue()) }
  protected doClear(): void { ++this.modCount; const oldEntryData = this.entryData; this.entryData = null; this.sizeValue = 0; this.didClear(oldEntryData) }
  protected doMove(_entry: BasicEMap.Entry<K, V>): void { ++this.modCount }
  map(): JavaMap<K, V> {
    this.view ??= {}
    if (!this.view.map) {
      const owner = this
      this.view.map = new class extends JavaObject implements JavaMap<K, V> {
        eMap(): EMap<K, V> { return owner }
        size(): number { return owner.size() }
        isEmpty(): boolean { return owner.isEmpty() }
        containsKey(key: K): boolean { return owner.containsKey(key) }
        containsValue(value: V): boolean { return owner.containsValue(value) }
        get(key: K): V | null { return owner.getValueForKey(key) }
        put(key: K, value: V): V | null { return owner.put(key, value) }
        remove(key: K): V | null { return owner.removeKey(key) }
        putAll(map: JavaMap<K, V>): void { owner.putAll(map) }
        clear(): void { owner.clear() }
        keySet(): EMapView<K> { return owner.keySet() }
        values(): EMapView<V> { return owner.values() }
        entrySet(): EMapView<MapEntry<K, V>> { return owner.entrySet() }
        override equals(object: unknown): boolean { return owner.equals(object) }
        override hashCode(): number { return owner.hashCode() }
        override toString(): string { return owner.toString() }
      }()
    }
    return this.view.map
  }

  keySet(): EMapView<K> {
    this.view ??= {}
    return this.view.keys ??= new EMapView(() => this.bucketIterator(entry => entry.getKey()), () => this.sizeValue, key => this.containsKey(key), key => { const oldSize = this.sizeValue; this.removeKey(key); return this.sizeValue !== oldSize }, () => this.clear(), true)
  }
  values(): EMapView<V> {
    this.view ??= {}
    return this.view.values ??= new EMapView(() => this.bucketIterator(entry => entry.getValue()), () => this.sizeValue, value => this.containsValue(value), null, () => this.clear())
  }
  entrySet(): EMapView<MapEntry<K, V>> {
    this.view ??= {}
    return this.view.entries ??= new EMapView<MapEntry<K, V>>(() => this.bucketIterator(entry => entry), () => this.sizeValue, object => this.containsEntry(object), object => {
      if (!this.containsEntry(object)) return false
      return this.remove(object)
    }, () => this.clear(), true)
  }
  private containsEntry(object: MapEntry<K, V>): boolean {
    if (this.sizeValue === 0 || object === null || typeof object.getKey !== 'function') return false
    this.ensureEntryDataExists()
    const hash = this.hashOf(object.getKey())
    const list = this.entryData![this.indexOfHash(hash)]
    if (list !== null && list !== undefined) for (const entry of list) if (entry.getHash() === hash && javaEquals(entry, object)) return true
    return false
  }
  private bucketIterator<T>(project: (entry: BasicEMap.Entry<K, V>) => T): Iterator<T> {
    if (this.sizeValue === 0) return Collections.emptyList<T>().iterator()
    let cursor = 0, entryCursor = -1, lastCursor = 0, lastEntryCursor = 0
    let expectedModCount = this.modCount
    const scan = (): void => {
      this.ensureEntryDataExists()
      if (entryCursor !== -1) { ++entryCursor; if (entryCursor < this.entryData![cursor]!.size()) return; ++cursor }
      for (; cursor < this.entryData!.length; ++cursor) {
        const list = this.entryData![cursor]!
        if (list !== null && !list.isEmpty()) { entryCursor = 0; return }
      }
      entryCursor = -1
    }
    scan()
    return {
      hasNext: () => entryCursor !== -1,
      next: () => {
        if (this.modCount !== expectedModCount) throw new Error('Concurrent modification')
        if (entryCursor === -1) throw new Error('No such element')
        lastCursor = cursor; lastEntryCursor = entryCursor
        scan()
        return project(this.entryData![lastCursor]!.get(lastEntryCursor))
      },
      remove: () => {
        if (this.modCount !== expectedModCount) throw new Error('Concurrent modification')
        if (lastEntryCursor === -1) throw new Error('Illegal iterator state')
        this.delegateEList.remove(this.entryData![lastCursor]!.get(lastEntryCursor))
        expectedModCount = this.modCount
        lastEntryCursor = -1
        if (cursor === lastCursor && entryCursor !== -1) --entryCursor
      },
    }
  }
  protected hashOf(key: K): number { return key === null ? 0 : javaHashCode(key) }
  protected indexOfHash(hash: number): number { return (hash & 0x7fffffff) % this.entryData!.length }
  protected entryForKey(index: number, hash: number, key: K): BasicEMap.Entry<K, V> | null {
    const entryIndex = this.entryIndexForKey(index, hash, key)
    return entryIndex === -1 ? null : this.entryData![index]!.get(entryIndex)
  }
  protected entryIndexForKey(index: number, hash: number, key: K): number {
    const list = this.entryData![index]
    if (list !== null && list !== undefined) for (let i = 0; i < list.size(); i++) {
      const entry = list.get(i)
      if (this.useEqualsForKey() && key !== null ? entry.getHash() === hash && javaEquals(key, entry.getKey()) : entry.getKey() === key) return i
    }
    return -1
  }
  protected grow(minimumCapacity: number): boolean {
    ++this.modCount
    const oldCapacity = this.entryData === null ? 0 : this.entryData.length
    if (minimumCapacity <= oldCapacity) return false
    const oldEntryData = this.entryData!
    this.entryData = this.newEntryData(2 * oldCapacity + 4)
    for (let i = 0; i < oldCapacity; i++) {
      const oldList = oldEntryData[i]!
      if (oldList !== null) for (const entry of oldList) {
        const index = this.indexOfHash(entry.getHash())
        let list = this.entryData[index]!
        if (list === null) list = this.entryData[index] = this.newList()
        list.add(entry)
      }
    }
    return true
  }
  private keyEquals(key: K, other: K): boolean { return this.useEqualsForKey() && key !== null ? javaEquals(key, other) : key === other }
  private valueEquals(value: V, other: V): boolean { return this.useEqualsForValue() && value !== null ? javaEquals(value, other) : value === other }

  contains(object: MapEntry<K, V>): boolean { return this.delegateEList.contains(object as BasicEMap.Entry<K, V>) }
  containsAll(collection: Iterable<MapEntry<K, V>>): boolean { return this.delegateEList.containsAll(collection as Iterable<BasicEMap.Entry<K, V>>) }
  indexOf(object: MapEntry<K, V>): number { return this.delegateEList.indexOf(object as BasicEMap.Entry<K, V>) }
  lastIndexOf(object: MapEntry<K, V>): number { return this.delegateEList.lastIndexOf(object as BasicEMap.Entry<K, V>) }
  toArray(): MapEntry<K, V>[]
  toArray(array: MapEntry<K, V>[]): MapEntry<K, V>[]
  toArray(array?: MapEntry<K, V>[]): MapEntry<K, V>[] { return array === undefined ? this.delegateEList.toArray() : this.delegateEList.toArray(array as BasicEMap.Entry<K, V>[]) }
  set(index: number, object: MapEntry<K, V>): MapEntry<K, V> { return this.delegateEList.set(index, object as BasicEMap.Entry<K, V>) }
  add(object: MapEntry<K, V>): boolean
  add(index: number, object: MapEntry<K, V>): void
  add(first: number | MapEntry<K, V>, second?: MapEntry<K, V>): boolean | void { if (typeof first === 'number') this.delegateEList.add(first, second as BasicEMap.Entry<K, V>); else return this.delegateEList.add(first as BasicEMap.Entry<K, V>) }
  addAll(collection: Collection<BasicEMap.Entry<K, V>>): boolean
  addAll(index: number, collection: Collection<BasicEMap.Entry<K, V>>): boolean
  addAll(first: number | Collection<BasicEMap.Entry<K, V>>, second?: Collection<BasicEMap.Entry<K, V>>): boolean { return typeof first === 'number' ? this.delegateEList.addAll(first, second!) : this.delegateEList.addAll(first) }
  remove(index: number): MapEntry<K, V>
  remove(object: MapEntry<K, V> | K): boolean
  remove(first: number | MapEntry<K, V> | K): MapEntry<K, V> | boolean {
    if (typeof first === 'number') return this.delegateEList.removeAt(first)
    if (first !== null && typeof first === 'object' && 'getKey' in first) return this.delegateEList.removeObject(first as BasicEMap.Entry<K, V>)
    const result = this.containsKey(first as K)
    this.removeKey(first as K)
    return result
  }
  removeAll(collection: { contains(value: BasicEMap.Entry<K, V>): boolean }): boolean { return this.delegateEList.removeAll(collection) }
  retainAll(collection: { contains(value: BasicEMap.Entry<K, V>): boolean }): boolean { return this.delegateEList.retainAll(collection) }
  clear(): void { this.delegateEList.clear() }
  move(index: number, object: MapEntry<K, V>): void
  move(targetIndex: number, sourceIndex: number): MapEntry<K, V>
  move(index: number, second: number | MapEntry<K, V>): MapEntry<K, V> | void { if (typeof second === 'number') return this.delegateEList.move(index, second); this.delegateEList.move(index, second as BasicEMap.Entry<K, V>) }
  iterator(): Iterator<MapEntry<K, V>> { return this.delegateEList.iterator() }
  listIterator(index = 0): ListIterator<MapEntry<K, V>> { return this.delegateEList.listIterator(index) }
  subList(start: number, end: number): AbstractList<BasicEMap.Entry<K, V>> { return this.delegateEList.subList(start, end) }
  [Symbol.iterator](): IterableIterator<MapEntry<K, V>> { return iterableIterator(this.iterator()) }
  override hashCode(): number { return this.delegateEList.hashCode() }
  override equals(object: unknown): boolean { return isJavaList(object) && this.delegateEList.equals(object) }
  override toString(): string { return this.delegateEList.toString() }
}

export namespace BasicEMap {
  export interface Entry<K, V> extends MapEntry<K, V> { setKey(key: K): void; getHash(): number; setHash(hash: number): void }
  export class EntryImpl<K, V> extends JavaObject implements Entry<K, V> {
    constructor(private readonly owner: BasicEMap<K, V>, private hash: number, private key: K, private value: V) { super() }
    getHash(): number { return this.hash }
    setHash(hash: number): void { this.hash = hash }
    getKey(): K { return this.key }
    setKey(_key: K): never { throw new Error('Unsupported key mutation') }
    getValue(): V { return this.value }
    setValue(value: V): V { this.owner.validateValue(value); const oldValue = this.value; this.value = value; return oldValue }
    override equals(object: unknown): boolean {
      if (object === null || typeof object !== 'object' || !('getKey' in object) || !('getValue' in object)) return false
      const entry = object as MapEntry<K, V>
      return (this.owner.useEqualsForKey() && this.key !== null ? javaEquals(this.key, entry.getKey()) : this.key === entry.getKey()) && (this.owner.useEqualsForValue() && this.value !== null ? javaEquals(this.value, entry.getValue()) : this.value === entry.getValue())
    }
    override hashCode(): number { return this.hash ^ javaHashCode(this.value) }
    override toString(): string { return this.key + '->' + this.value }
  }
}

export class EMapView<T> extends MapView<T> {
  constructor(makeIterator: () => Iterator<T>, getSize: () => number, private readonly containsValue: (value: T) => boolean, private readonly removeValue: ((value: T) => boolean) | null, private readonly clearValues: () => void, setView = false) { super(makeIterator, getSize, undefined, undefined, undefined, setView) }
  contains(value: T): boolean { return this.containsValue(value) }
  remove(value: T): boolean {
    if (this.removeValue !== null) return this.removeValue(value)
    const iterator = this.iterator()
    while (iterator.hasNext()) if (javaEquals(value, iterator.next())) { iterator.remove(); return true }
    return false
  }
  clear(): void { this.clearValues() }
}
