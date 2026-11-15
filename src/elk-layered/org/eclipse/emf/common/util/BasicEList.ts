/*******************************************************************************
 * Copyright (c) 2002-2009 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { javaEquals } from '../../../../../java/lang/Object.ts'
import { Cloneable } from '../../../../../java/lang/Cloneable.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import { AbstractList } from '../../../../../java/util/AbstractList.ts'
import { Collections } from '../../../../../java/util/Collections.ts'
import type { Iterator, ListIterator } from '../../../../../java/util/Iterator.ts'
import { AbstractEList } from './AbstractEList.ts'

export class BasicEList<T> extends AbstractEList<T> implements Cloneable {
  static readonly #serialVersionUID = 1n
  readonly [Cloneable] = true
  protected sizeValue = 0
  protected dataValue: T[] | null = null

  constructor()
  constructor(initialCapacity: number)
  constructor(collection: Collection<T>)
  constructor(size: number, data: T[] | null)
  constructor(first?: number | Collection<T>, data?: T[] | null) {
    super()
    if (arguments.length === 2) { this.sizeValue = first as number; this.dataValue = data! }
    else if (typeof first === 'number') {
      if (first < 0) throw new Error('Illegal Capacity: ' + first)
      this.dataValue = this.newData(first)
    } else if (first !== undefined) {
      this.sizeValue = first.size()
      if (this.sizeValue > 0) {
        this.dataValue = this.newData(this.sizeValue + Math.trunc(this.sizeValue / 8) + 1)
        first.toArray(this.dataValue)
      }
    }
  }

  protected newData(capacity: number): T[] { return new Array<T>(capacity).fill(null as T) }
  protected assign(index: number, object: T): T { this.dataValue![index] = object; return object }
  size(): number { return this.sizeValue }
  override isEmpty(): boolean { return this.sizeValue === 0 }
  override contains(object: T): boolean { const useEquals = this.useEquals() && object !== null; for (let i = 0; i < this.sizeValue; i++) if (useEquals ? javaEquals(object, this.dataValue![i]) : object === this.dataValue![i]) return true; return false }
  override indexOf(object: T): number { const useEquals = this.useEquals() && object !== null; for (let i = 0; i < this.sizeValue; i++) if (useEquals ? javaEquals(object, this.dataValue![i]) : object === this.dataValue![i]) return i; return -1 }
  override lastIndexOf(object: T): number { const useEquals = this.useEquals() && object !== null; for (let i = this.sizeValue - 1; i >= 0; i--) if (useEquals ? javaEquals(object, this.dataValue![i]) : object === this.dataValue![i]) return i; return -1 }

  override toArray(): T[]
  override toArray(array: T[]): T[]
  override toArray(array?: T[]): T[] {
    if (array === undefined) {
      const result = this.newData(this.sizeValue)
      if (this.sizeValue > 0) for (let i = 0; i < this.sizeValue; i++) result[i] = this.dataValue![i]!
      return result
    }
    if (this.sizeValue > 0) {
      if (array.length < this.sizeValue) array = this.newData(this.sizeValue)
      for (let i = 0; i < this.sizeValue; i++) array[i] = this.dataValue![i]!
    }
    if (array.length > this.sizeValue) array[this.sizeValue] = null as T
    return array
  }
  data(): T[] | null { return this.dataValue }
  setData(size: number, data: T[] | null): void { this.sizeValue = size; this.dataValue = data; this.modCount++ }
  get(index: number): T { this.checkIndex(index); return this.resolve(index, this.dataValue![index]!) }
  override basicGet(index: number): T { this.checkIndex(index); return this.primitiveGet(index) }
  protected primitiveGet(index: number): T { return this.dataValue![index]! }

  setUnique(index: number, object: T): T {
    const oldObject = this.dataValue![index]!
    this.assign(index, this.validate(index, object))
    this.didSet(index, object, oldObject)
    this.didChange()
    return oldObject
  }
  addUnique(object: T): void
  addUnique(index: number, object: T): void
  addUnique(first: number | T, second?: T): void {
    this.grow(this.sizeValue + 1)
    if (arguments.length === 1) {
      const object = first as T
      this.assign(this.sizeValue, this.validate(this.sizeValue, object))
      this.didAdd(this.sizeValue++, object)
      this.didChange()
    } else {
      const index = first as number
      const object = second!
      const validatedObject = this.validate(index, object)
      if (index !== this.sizeValue) this.copy(this.dataValue!, index, this.dataValue!, index + 1, this.sizeValue - index)
      this.assign(index, validatedObject)
      ++this.sizeValue
      this.didAdd(index, object)
      this.didChange()
    }
  }

  addAllUnique(collection: Collection<T>): boolean
  addAllUnique(index: number, collection: Collection<T>): boolean
  addAllUnique(objects: T[], start: number, end: number): boolean
  addAllUnique(index: number, objects: T[], start: number, end: number): boolean
  addAllUnique(first: number | Collection<T> | T[], second?: Collection<T> | T[] | number, third?: number, fourth?: number): boolean {
    const indexed = typeof first === 'number'
    const objects = (indexed ? second : first) as Collection<T> | T[]
    if (Array.isArray(objects)) {
      const start = (indexed ? third : second) as number
      const end = (indexed ? fourth : third)!
      const growth = end - start
      this.grow(this.sizeValue + growth)
      if (indexed) {
        const shifted = this.sizeValue - first
        if (shifted > 0) this.copy(this.dataValue!, first, this.dataValue!, first + growth, shifted)
      }
      this.sizeValue += growth
      let index = indexed ? first : this.sizeValue
      for (let i = start; i < end; i++) {
        const object = objects[i]!
        this.assign(index, this.validate(index, object))
        this.didAdd(index, object)
        this.didChange()
        ++index
      }
      return growth !== 0
    }
    const growth = objects.size()
    this.grow(this.sizeValue + growth)
    if (indexed) {
      const shifted = this.sizeValue - first
      if (shifted > 0) this.copy(this.dataValue!, first, this.dataValue!, first + growth, shifted)
    }
    const iterator = objects.iterator()
    const oldSize = this.sizeValue
    this.sizeValue += growth
    let index = indexed ? first : oldSize
    for (let i = 0; i < growth; i++) {
      const object = iterator.next()
      this.assign(index, this.validate(index, object))
      this.didAdd(index, object)
      this.didChange()
      ++index
    }
    return growth !== 0
  }

  removeAt(index: number): T {
    this.checkIndex(index)
    ++this.modCount
    const oldObject = this.dataValue![index]!
    const shifted = this.sizeValue - index - 1
    if (shifted > 0) this.copy(this.dataValue!, index + 1, this.dataValue!, index, shifted)
    this.dataValue![--this.sizeValue] = null as T
    this.didRemove(index, oldObject)
    this.didChange()
    return oldObject
  }
  override clear(): void {
    ++this.modCount
    const oldData = this.dataValue
    const oldSize = this.sizeValue
    this.dataValue = null
    this.sizeValue = 0
    this.didClear(oldSize, oldData)
    this.didChange()
  }

  move(targetIndex: number, sourceIndex: number): T
  move(targetIndex: number, object: T): void
  move(targetIndex: number, second: number | T): T | void {
    const sourceIndex = typeof second === 'number' ? second : this.indexOf(second)
    ++this.modCount
    this.checkIndex(targetIndex)
    this.checkIndex(sourceIndex)
    const object = this.dataValue![sourceIndex]!
    if (targetIndex !== sourceIndex) {
      if (targetIndex < sourceIndex) this.copy(this.dataValue!, targetIndex, this.dataValue!, targetIndex + 1, sourceIndex - targetIndex)
      else this.copy(this.dataValue!, sourceIndex + 1, this.dataValue!, sourceIndex, targetIndex - sourceIndex)
      this.assign(targetIndex, object)
      this.didMove(targetIndex, object, sourceIndex)
      this.didChange()
    }
    if (typeof second === 'number') return object
  }
  shrink(): void {
    ++this.modCount
    if (this.sizeValue === 0) this.dataValue = null
    else if (this.sizeValue < this.dataValue!.length) {
      const oldData = this.dataValue!
      this.dataValue = this.newData(this.sizeValue)
      this.copy(oldData, 0, this.dataValue, 0, this.sizeValue)
    }
  }
  grow(minimumCapacity: number): void {
    ++this.modCount
    const oldCapacity = this.dataValue === null ? 0 : this.dataValue.length
    if (minimumCapacity > oldCapacity) {
      const oldData = this.dataValue
      let newCapacity = oldCapacity + Math.trunc(oldCapacity / 2) + 4
      if (newCapacity < minimumCapacity) newCapacity = minimumCapacity
      this.dataValue = this.newData(newCapacity)
      if (oldData !== null) this.copy(oldData, 0, this.dataValue, 0, this.sizeValue)
    }
  }
  protected basicList(): AbstractList<T> { return this.sizeValue === 0 ? Collections.emptyList() : new BasicEList.UnmodifiableEList(this.sizeValue, this.dataValue) }
  private copy(source: T[], sourceIndex: number, target: T[], targetIndex: number, length: number): void {
    if (source === target && targetIndex > sourceIndex) for (let i = length - 1; i >= 0; i--) target[targetIndex + i] = source[sourceIndex + i]!
    else for (let i = 0; i < length; i++) target[targetIndex + i] = source[sourceIndex + i]!
  }
}

export namespace BasicEList {
  export class UnmodifiableEList<T> extends BasicEList<T> {
    constructor(size: number, data: T[] | null) { super(size, data) }
    override set(_index: number, _object: T): never { throw new Error('Unsupported operation') }
    override setUnique(_index: number, _object: T): never { throw new Error('Unsupported operation') }
    override add(_object: T): never
    override add(_index: number, _object: T): never
    override add(_first: number | T, _second?: T): never { throw new Error('Unsupported operation') }
    override addUnique(_object: T): never
    override addUnique(_index: number, _object: T): never
    override addUnique(_first: number | T, _second?: T): never { throw new Error('Unsupported operation') }
    override addAll(_collection: Collection<T>): never
    override addAll(_index: number, _collection: Collection<T>): never
    override addAll(_first: number | Collection<T>, _second?: Collection<T>): never { throw new Error('Unsupported operation') }
    override addAllUnique(_collection: Collection<T>): never
    override addAllUnique(_index: number, _collection: Collection<T>): never
    override addAllUnique(_objects: T[], _start: number, _end: number): never
    override addAllUnique(_index: number, _objects: T[], _start: number, _end: number): never
    override addAllUnique(_first: number | Collection<T> | T[], _second?: Collection<T> | T[] | number, _third?: number, _fourth?: number): never { throw new Error('Unsupported operation') }
    override removeAt(_index: number): never { throw new Error('Unsupported operation') }
    override remove(_index: number): never
    override remove(_object: T): never
    override remove(_first: number | T): never { throw new Error('Unsupported operation') }
    override removeObject(_object: T): never { throw new Error('Unsupported operation') }
    override removeAll(_collection: { contains(value: T): boolean }): never { throw new Error('Unsupported operation') }
    override retainAll(_collection: { contains(value: T): boolean }): never { throw new Error('Unsupported operation') }
    override clear(): never { throw new Error('Unsupported operation') }
    override move(_targetIndex: number, _sourceIndex: number): never
    override move(_targetIndex: number, _object: T): never
    override move(_targetIndex: number, _second: number | T): never { throw new Error('Unsupported operation') }
    override setData(_size: number, _data: T[] | null): never { throw new Error('Unsupported operation') }
    override shrink(): never { throw new Error('Unsupported operation') }
    override grow(_minimumCapacity: number): never { throw new Error('Unsupported operation') }
    override iterator(): Iterator<T> { return this.basicIterator() }
    override listIterator(index = 0): ListIterator<T> { return this.basicListIterator(index) }
  }
  export class FastCompare<T> extends BasicEList<T> {
    protected override useEquals(): boolean { return false }
    constructor(source?: number | Collection<T>) {
      if (source === undefined) super()
      else if (typeof source === 'number') super(source)
      else { super(source.size()); this.addAll(source) }
    }
  }
}
