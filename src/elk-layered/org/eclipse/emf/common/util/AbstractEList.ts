/*******************************************************************************
 * Copyright (c) 2009-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { javaEquals, javaHashCode } from '../../../../../java/lang/Object.ts'
import { AbstractList } from '../../../../../java/util/AbstractList.ts'
import { ArrayList } from '../../../../../java/util/ArrayList.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import { HashSet } from '../../../../../java/util/HashSet.ts'
import { ECollections } from './ECollections.ts'
import { LinkedHashSet } from '../../../../../java/util/LinkedHashSet.ts'
import type { Iterator, ListIterator } from '../../../../../java/util/Iterator.ts'
import { isJavaList } from '../../../../../java/util/List.ts'
import type { EList } from './EList.ts'

export abstract class AbstractEList<T> extends AbstractList<T> implements EList<T> {
  protected useEquals(): boolean { return true }
  protected equalObjects(firstObject: T, secondObject: T): boolean { return this.useEquals() && firstObject !== null ? javaEquals(firstObject, secondObject) : firstObject === secondObject }
  protected canContainNull(): boolean { return true }
  protected isUnique(): boolean { return false }
  protected validate(_index: number, object: T): T {
    if (!this.canContainNull() && object === null) throw new Error("The 'no null' constraint is violated")
    return object
  }
  protected resolve(_index: number, object: T): T { return object }
  protected didSet(_index: number, _newObject: T, _oldObject: T): void {}
  protected didAdd(_index: number, _newObject: T): void {}
  protected didRemove(_index: number, _oldObject: T): void {}
  protected didClear(size: number, oldObjects: T[] | null): void { if (oldObjects !== null) for (let i = 0; i < size; i++) this.didRemove(i, oldObjects[i]!) }
  protected didMove(_index: number, _movedObject: T, _oldIndex: number): void {}
  protected didChange(): void {}
  protected basicGet(index: number): T { this.checkIndex(index); return this.primitiveGet(index) }
  protected abstract primitiveGet(index: number): T
  abstract setUnique(index: number, object: T): T
  abstract addUnique(object: T): void
  abstract addUnique(index: number, object: T): void
  abstract addAllUnique(collection: Collection<T>): boolean
  abstract addAllUnique(index: number, collection: Collection<T>): boolean
  abstract addAllUnique(objects: T[], start: number, end: number): boolean
  abstract addAllUnique(index: number, objects: T[], start: number, end: number): boolean

  override set(index: number, object: T): T {
    this.checkIndex(index)
    if (this.isUnique()) {
      const currentIndex = this.indexOf(object)
      if (currentIndex >= 0 && currentIndex !== index) throw new Error("The 'no duplicates' constraint is violated")
    }
    return this.setUnique(index, object)
  }

  override add(object: T): boolean
  override add(index: number, object: T): void
  override add(first: number | T, object?: T): boolean | void {
    if (arguments.length === 1) {
      if (this.isUnique() && this.contains(first as T)) return false
      this.addUnique(first as T)
      return true
    }
    const index = first as number
    this.checkIndex(index, true)
    if (this.isUnique() && this.contains(object!)) throw new Error("The 'no duplicates' constraint is violated")
    this.addUnique(index, object!)
  }

  override addAll(collection: Collection<T>): boolean
  override addAll(index: number, collection: Collection<T>): boolean
  override addAll(first: number | Collection<T>, second?: Collection<T>): boolean {
    if (typeof first === 'number') {
      this.checkIndex(first, true)
      return this.addAllUnique(first, this.isUnique() ? this.getNonDuplicates(second!) : second!)
    }
    return this.addAllUnique(this.isUnique() ? this.getNonDuplicates(first) : first)
  }
  override removeAll(collection: { contains(value: T): boolean }): boolean {
    let modified = false
    for (let i = this.size(); --i >= 0;) if (collection.contains(this.primitiveGet(i))) { this.removeAt(i); modified = true }
    return modified
  }
  override retainAll(collection: { contains(value: T): boolean }): boolean {
    let modified = false
    for (let i = this.size(); --i >= 0;) if (!collection.contains(this.primitiveGet(i))) { this.removeAt(i); modified = true }
    return modified
  }

  abstract move(targetIndex: number, sourceIndex: number): T
  abstract move(targetIndex: number, object: T): void
  protected abstract basicList(): AbstractList<T>

  override equals(object: unknown): boolean {
    if (object === this) return true
    if (!isJavaList(object) || object.size() !== this.size()) return false
    const objects = object[Symbol.iterator]()
    for (let i = 0; i < this.size(); i++) {
      const first = this.primitiveGet(i), second = objects.next().value
      if (this.useEquals() ? !javaEquals(first, second) : first !== second) return false
    }
    return true
  }
  override hashCode(): number { let hashCode = 1; for (let i = 0; i < this.size(); i++) hashCode = (Math.imul(31, hashCode) + javaHashCode(this.primitiveGet(i))) | 0; return hashCode }
  override toString(): string { let result = '['; for (let i = 0; i < this.size(); i++) { if (i > 0) result += ', '; result += String(this.primitiveGet(i)) } return result + ']' }

  protected getDuplicates(collection: Collection<T> & { contains(value: T): boolean }): Collection<T> & { contains(value: T): boolean } {
    if (collection.size() === 0) return ECollections.emptyEList<T>()
    const owner = this
    const useEquals = (): boolean => owner.useEquals()
    // BasicEList derives from this class; Java initializes the subclass only
    // when this method is called, rather than during module initialization.
    const { BasicEList } = require('./BasicEList.ts') as typeof import('./BasicEList.ts')
    const filteredResult = new class extends BasicEList<T> {
      private expectedModCount = 0
      private setCache: HashSet<T> | null = null
      override contains(object: T): boolean {
        if (this.sizeValue > 10) {
          if (this.setCache === null || owner.modCount !== this.expectedModCount) { this.setCache = new HashSet(this); this.expectedModCount = this.modCount }
          return this.setCache.contains(object)
        }
        return super.contains(object)
      }
      protected override useEquals(): boolean { return useEquals() }
    }(collection.size())
    for (const object of this) if (collection.contains(object)) filteredResult.add(object)
    return filteredResult
  }

  protected getNonDuplicates(collection: Collection<T>): Collection<T> {
    const result = new LinkedHashSet(collection)
    result.removeAll(this)
    return new ArrayList(result)
  }

  override iterator(): Iterator<T> { return this.makeIterator(0, false) }
  override listIterator(index = 0): ListIterator<T> { this.checkIndex(index, true); return this.makeIterator(index, false) }
  protected basicIterator(): Iterator<T> { return this.makeIterator(0, true) }
  protected basicListIterator(index = 0): ListIterator<T> { this.checkIndex(index, true); return this.makeIterator(index, true) }

  private makeIterator(index: number, nonResolving: boolean): ListIterator<T> {
    let cursor = index
    let lastCursor = -1
    let expectedModCount = this.modCount
    const checkModCount = (): void => { if (this.modCount !== expectedModCount) throw new Error('Concurrent modification') }
    const checkMutable = (): void => { if (nonResolving) throw new Error('Unsupported operation') }
    const read = (at: number): T => nonResolving ? this.primitiveGet(at) : this.get(at)
    return {
      hasNext: () => cursor !== this.size(),
      next: () => {
        try { const next = read(cursor); checkModCount(); lastCursor = cursor++; return next }
        catch (error) { if (!(error instanceof RangeError)) throw error; checkModCount(); throw new Error('No such element') }
      },
      hasPrevious: () => cursor !== 0,
      previous: () => {
        try { const previous = read(--cursor); checkModCount(); lastCursor = cursor; return previous }
        catch (error) { if (!(error instanceof RangeError)) throw error; checkModCount(); throw new Error('No such element') }
      },
      nextIndex: () => cursor,
      previousIndex: () => cursor - 1,
      remove: () => {
        checkMutable()
        if (lastCursor === -1) throw new Error('Illegal iterator state')
        checkModCount()
        try { this.removeAt(lastCursor); expectedModCount = this.modCount; if (lastCursor < cursor) --cursor; lastCursor = -1 }
        catch (error) { if (!(error instanceof RangeError)) throw error; throw new Error('Concurrent modification') }
      },
      set: object => {
        checkMutable()
        if (lastCursor === -1) throw new Error('Illegal iterator state')
        checkModCount()
        try { this.set(lastCursor, object); expectedModCount = this.modCount }
        catch (error) { if (!(error instanceof RangeError)) throw error; throw new Error('Concurrent modification') }
      },
      add: object => {
        checkMutable()
        checkModCount()
        try { this.add(cursor++, object); expectedModCount = this.modCount; lastCursor = -1 }
        catch (error) { if (!(error instanceof RangeError)) throw error; throw new Error('Concurrent modification') }
      },
    }
  }
}
