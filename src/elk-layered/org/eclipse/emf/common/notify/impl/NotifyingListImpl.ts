/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Class } from '../../../../../../java/lang/Class.ts'
import type { Collection } from '../../../../../../java/util/Collection.ts'
import { Collections } from '../../../../../../java/util/Collections.ts'
import { Arrays } from '../../../../../../java/util/Arrays.ts'
import { BasicEList } from '../../util/BasicEList.ts'
import { Notification } from '../Notification.ts'
import type { NotificationChain } from '../NotificationChain.ts'
import type { Notifier } from '../Notifier.ts'
import { NotificationImpl } from './NotificationImpl.ts'
import { NotificationChainImpl } from './NotificationChainImpl.ts'

type ContainsCollection<T> = Collection<T> & { contains(value: T): boolean }

export class NotifyingListImpl<T> extends BasicEList<T> {
  constructor(source?: number | Collection<T>) { if (source === undefined) super(); else if (typeof source === 'number') super(source); else super(source) }
  getNotifier(): unknown { return null }
  getFeature(): unknown { return null }
  getFeatureID(_expectedClass?: Class<unknown> | null): number { return Notification.NO_FEATURE_ID }
  protected isSet(): boolean { return !this.isEmpty() }
  protected hasInverse(): boolean { return false }
  protected override canContainNull(): boolean { return !this.hasInverse() }
  protected isNotificationRequired(): boolean { return false }
  protected hasShadow(): boolean { return false }
  protected shadowAdd(_object: T, notifications: NotificationChain | null): NotificationChain | null { return notifications }
  protected shadowRemove(_object: T, notifications: NotificationChain | null): NotificationChain | null { return notifications }
  protected shadowSet(_oldObject: T, _newObject: T, notifications: NotificationChain | null): NotificationChain | null { return notifications }
  protected inverseAdd(_object: T, notifications: NotificationChain | null): NotificationChain | null { return notifications }
  protected inverseRemove(_object: T, notifications: NotificationChain | null): NotificationChain | null { return notifications }
  protected createNotification(eventType: number, oldObject: unknown, newObject: unknown, index: number, wasSet?: boolean): NotificationImpl {
    if (wasSet === undefined) throw new Error('Please change your code to call new five argument version of this method')
    const owner = this
    return new class extends NotificationImpl {
      override getNotifier(): unknown { return owner.getNotifier() }
      override getFeature(): unknown { return owner.getFeature() }
      override getFeatureID(expectedClass: Class<unknown> | null): number { return owner.getFeatureID(expectedClass) }
    }(eventType, oldObject, newObject, index, wasSet)
  }
  protected createNotificationChain(capacity: number): NotificationChain | null { return capacity < 100 ? null : new NotificationChainImpl(capacity) }
  protected dispatchNotification(notification: Notification): void { (this.getNotifier() as Notifier).eNotify(notification) }

  override addUnique(object: T): void
  override addUnique(index: number, object: T): void
  override addUnique(first: number | T, second?: T): void {
    const indexed = arguments.length === 2, index = indexed ? first as number : this.sizeValue, object = indexed ? second! : first as T
    if (this.isNotificationRequired()) {
      const oldIsSet = this.isSet()
      if (indexed) this.doAddUnique(index, object); else this.doAddUnique(object)
      const notification = this.createNotification(Notification.ADD, null, object, index, oldIsSet)
      if (this.hasInverse()) {
        let notifications = this.inverseAdd(object, null)
        if (this.hasShadow()) notifications = this.shadowAdd(object, notifications)
        if (notifications === null) this.dispatchNotification(notification)
        else { notifications.add(notification); notifications.dispatch() }
      } else this.dispatchNotification(notification)
    } else {
      if (indexed) this.doAddUnique(index, object); else this.doAddUnique(object)
      if (this.hasInverse()) { const notifications = this.inverseAdd(object, null); if (notifications !== null) notifications.dispatch() }
    }
  }
  protected doAddUnique(object: T): void
  protected doAddUnique(index: number, object: T): void
  protected doAddUnique(first: number | T, second?: T): void { if (arguments.length === 1) super.addUnique(first as T); else super.addUnique(first as number, second!) }

  override addAllUnique(collection: Collection<T>): boolean
  override addAllUnique(index: number, collection: Collection<T>): boolean
  override addAllUnique(objects: T[], start: number, end: number): boolean
  override addAllUnique(index: number, objects: T[], start: number, end: number): boolean
  override addAllUnique(first: number | Collection<T> | T[], second?: Collection<T> | T[] | number, third?: number, fourth?: number): boolean {
    if (arguments.length === 1) return this.addAllUnique(this.sizeValue, first as Collection<T>)
    if (arguments.length === 3) return this.addAllUnique(this.sizeValue, first as T[], second as number, third!)
    const index = first as number, array = arguments.length === 4, objects = second as T[], collection = second as Collection<T>, start = third!, end = fourth!
    const collectionSize = array ? end - start : collection.size()
    if (collectionSize === 0) return false
    if (this.isNotificationRequired()) {
      const oldIsSet = this.isSet()
      if (array) this.doAddAllUnique(index, objects, start, end); else this.doAddAllUnique(index, collection)
      let notification: NotificationImpl
      if (collectionSize === 1) notification = this.createNotification(Notification.ADD, null, array ? objects[0] : collection.iterator().next(), index, oldIsSet)
      else {
        let actualCollection: Collection<T> = collection
        if (array) {
          if (start !== 0 || end !== objects.length) {
            const actualObjects = new Array<T>(collectionSize)
            for (let i = 0, j = start; j < end; ++i, ++j) actualObjects[i] = objects[j]!
            actualCollection = Arrays.asList(actualObjects)
          } else actualCollection = Arrays.asList(objects)
        }
        notification = this.createNotification(Notification.ADD_MANY, null, actualCollection, index, oldIsSet)
      }
      if (this.hasInverse()) {
        let notifications = this.createNotificationChain(collectionSize)
        const lastIndex = index + collectionSize
        for (let i = index; i < lastIndex; ++i) { const value = this.dataValue![i]!; notifications = this.inverseAdd(value, notifications); notifications = this.shadowAdd(value, notifications) }
        if (notifications === null) this.dispatchNotification(notification)
        else { notifications.add(notification); notifications.dispatch() }
      } else this.dispatchNotification(notification)
    } else {
      if (array) this.doAddAllUnique(index, objects, start, end); else this.doAddAllUnique(index, collection)
      if (this.hasInverse()) {
        let notifications = this.createNotificationChain(collectionSize)
        const lastIndex = index + collectionSize
        for (let i = index; i < lastIndex; ++i) notifications = this.inverseAdd(this.dataValue![i]!, notifications)
        if (notifications !== null) notifications.dispatch()
      }
    }
    return true
  }
  protected doAddAllUnique(collection: Collection<T>): boolean
  protected doAddAllUnique(index: number, collection: Collection<T>): boolean
  protected doAddAllUnique(objects: T[], start: number, end: number): boolean
  protected doAddAllUnique(index: number, objects: T[], start: number, end: number): boolean
  protected doAddAllUnique(first: number | Collection<T> | T[], second?: Collection<T> | T[] | number, third?: number, fourth?: number): boolean {
    if (arguments.length === 1) return super.addAllUnique(first as Collection<T>)
    if (arguments.length === 2) return super.addAllUnique(first as number, second as Collection<T>)
    if (arguments.length === 3) return super.addAllUnique(first as T[], second as number, third!)
    return super.addAllUnique(first as number, second as T[], third!, fourth!)
  }
  basicAdd(object: T, notifications: NotificationChain | null): NotificationChain | null {
    if (this.isNotificationRequired()) {
      const index = this.sizeValue, oldIsSet = this.isSet()
      this.doAddUnique(index, object)
      const notification = this.createNotification(Notification.ADD, null, object, index, oldIsSet)
      if (notifications === null) notifications = notification; else notifications.add(notification)
    } else this.doAddUnique(this.sizeValue, object)
    return notifications
  }
  override removeAt(index: number): T {
    if (this.isNotificationRequired()) {
      let notifications: NotificationChain | null = null
      const oldIsSet = this.isSet()
      if (this.hasShadow()) notifications = this.shadowRemove(this.basicGet(index), null)
      const oldObject = this.doRemove(index), notification = this.createNotification(Notification.REMOVE, oldObject, null, index, oldIsSet)
      if (this.hasInverse() && oldObject !== null) notifications = this.inverseRemove(oldObject, notifications)
      if (notifications === null) this.dispatchNotification(notification); else { notifications.add(notification); notifications.dispatch() }
      return oldObject
    }
    const oldObject = this.doRemove(index)
    if (this.hasInverse() && oldObject !== null) { const notifications = this.inverseRemove(oldObject, null); if (notifications !== null) notifications.dispatch() }
    return oldObject
  }
  protected doRemove(index: number): T { return super.removeAt(index) }
  override removeAll(collection: ContainsCollection<T>): boolean {
    const oldIsSet = this.isSet()
    let result = false, positions: number[] | null = null
    if (this.isNotificationRequired()) {
      let listSize = collection.size()
      if (listSize > 0) {
        let notifications = this.createNotificationChain(listSize), list = new BasicEList(collection), objects = list.data()!
        positions = new Array<number>(listSize).fill(0)
        let count = 0
        if (this.isUnique()) {
          for (let i = 0; i < this.sizeValue; ++i) {
            const initialObject = this.dataValue![i]!
            let object: T = initialObject
            LOOP: for (let repeat = 0; repeat < 2; ++repeat) {
              for (let j = listSize; --j >= 0;) if (this.equalObjects(object, objects[j]!)) {
                if (count !== j) { const x = objects[count]!; objects[count] = objects[j]!; objects[j] = x }
                positions[count++] = i; break LOOP
              }
              object = this.resolve(object)
              if (object === initialObject) break
            }
          }
        } else {
          const resultList = new BasicEList<T>(listSize)
          for (let i = 0; i < this.sizeValue; ++i) {
            const initialObject = this.dataValue![i]!
            let object: T = initialObject
            LOOP: for (let repeat = 0; repeat < 2; ++repeat) {
              for (let j = listSize; --j >= 0;) if (this.equalObjects(object, objects[j]!)) {
                if (positions.length <= count) { const oldPositions = positions; positions = new Array<number>(2 * positions.length).fill(0); for (let k = 0; k < count; k++) positions[k] = oldPositions[k]! }
                positions[count++] = i; resultList.add(objects[j]!); break LOOP
              }
              object = this.resolve(object)
              if (object === initialObject) break
            }
          }
          list = resultList; objects = resultList.data()!; listSize = count
          if (count > positions.length) { const oldPositions = positions; positions = new Array<number>(count).fill(0); for (let k = 0; k < count; k++) positions[k] = oldPositions[k]! }
        }
        if (count > 0) {
          result = true
          if (this.hasShadow()) for (let i = 0; i < count; ++i) notifications = this.shadowRemove(objects[i]!, notifications)
          for (let i = count; --i >= 0;) this.doRemove(positions[i]!)
          if (count !== listSize) { for (let i = listSize; --i >= count;) list.removeAt(i); const oldPositions = positions; positions = new Array<number>(count).fill(0); for (let k = 0; k < count; k++) positions[k] = oldPositions[k]! }
          collection = list
        }
      }
    } else {
      collection = this.getDuplicates(collection)
      for (let i = this.sizeValue; --i >= 0;) if (collection.contains(this.dataValue![i]!)) { this.doRemove(i); result = true }
    }
    if (!result) return false
    if (positions !== null) {
      const collectionSize = collection.size(), notification = collectionSize === 1 ? this.createNotification(Notification.REMOVE, collection.iterator().next(), null, positions[0]!, oldIsSet) : this.createNotification(Notification.REMOVE_MANY, collection, positions, positions[0]!, oldIsSet)
      let notifications = this.createNotificationChain(collectionSize)
      if (this.hasInverse()) for (const object of collection) notifications = this.inverseRemove(object, notifications)
      if (notifications === null) this.dispatchNotification(notification); else { notifications.add(notification); notifications.dispatch() }
    } else if (this.hasInverse()) {
      let notifications = this.createNotificationChain(collection.size())
      for (const object of collection) notifications = this.inverseRemove(object, notifications)
      if (notifications !== null) notifications.dispatch()
    }
    return true
  }
  protected override resolve(index: number, object: T): T
  protected resolve(object: T): T
  protected override resolve(first: number | T, second?: T): T { return arguments.length === 1 ? first as T : super.resolve(first as number, second!) }
  protected doRemoveAll(collection: ContainsCollection<T>): boolean { return super.removeAll(collection) }
  basicRemove(object: T, notifications: NotificationChain | null): NotificationChain | null {
    const index = this.indexOf(object)
    if (index !== -1) {
      if (this.isNotificationRequired()) {
        const oldIsSet = this.isSet(), oldObject = this.doRemove(index), notification = this.createNotification(Notification.REMOVE, oldObject, null, index, oldIsSet)
        if (notifications === null) notifications = notification; else notifications.add(notification)
      } else this.doRemove(index)
    }
    return notifications
  }
  override clear(): void {
    if (this.isNotificationRequired()) {
      const oldIsSet = this.isSet()
      if (this.sizeValue > 0) {
        const collection = new BasicEList.UnmodifiableEList(this.sizeValue, this.dataValue), collectionSize = this.sizeValue
        let notifications = this.createNotificationChain(collectionSize)
        if (this.hasShadow()) for (let i = 0; i < this.sizeValue; ++i) notifications = this.shadowRemove(this.dataValue![i]!, notifications)
        this.doClear()
        const notification = collectionSize === 1 ? this.createNotification(Notification.REMOVE, collection.get(0), null, 0, oldIsSet) : this.createNotification(Notification.REMOVE_MANY, collection, null, Notification.NO_INDEX, oldIsSet)
        if (this.hasInverse()) for (const object of collection) notifications = this.inverseRemove(object, notifications)
        if (notifications === null) this.dispatchNotification(notification); else { notifications.add(notification); notifications.dispatch() }
      } else { this.doClear(); this.dispatchNotification(this.createNotification(Notification.REMOVE_MANY, Collections.emptyList(), null, Notification.NO_INDEX, oldIsSet)) }
    } else if (this.hasInverse()) {
      if (this.sizeValue > 0) {
        const oldData = this.dataValue!, oldSize = this.sizeValue
        this.doClear()
        let notifications = this.createNotificationChain(oldSize)
        for (let i = 0; i < oldSize; ++i) notifications = this.inverseRemove(oldData[i]!, notifications)
        if (notifications !== null) notifications.dispatch()
      } else this.doClear()
    } else this.doClear()
  }
  protected doClear(): void { super.clear() }
  override setUnique(index: number, object: T): T {
    if (this.isNotificationRequired()) {
      let notifications: NotificationChain | null = null
      const oldIsSet = this.isSet(), oldObject = this.doSetUnique(index, object), notification = this.createNotification(Notification.SET, oldObject, object, index, oldIsSet)
      if (this.hasInverse() && !this.equalObjects(oldObject, object)) {
        if (oldObject !== null) notifications = this.inverseRemove(oldObject, notifications)
        notifications = this.inverseAdd(object, notifications)
        if (this.hasShadow()) notifications = this.shadowSet(oldObject, object, notifications)
      } else if (this.hasShadow()) notifications = this.shadowSet(oldObject, object, notifications)
      if (notifications === null) this.dispatchNotification(notification); else { notifications.add(notification); notifications.dispatch() }
      return oldObject
    }
    const oldObject = this.doSetUnique(index, object)
    if (this.hasInverse() && !this.equalObjects(oldObject, object)) {
      let notifications: NotificationChain | null = null
      if (oldObject !== null) notifications = this.inverseRemove(oldObject, null)
      notifications = this.inverseAdd(object, notifications)
      if (notifications !== null) notifications.dispatch()
    }
    return oldObject
  }
  protected doSetUnique(index: number, object: T): T { return super.setUnique(index, object) }
  basicSet(index: number, object: T, notifications: NotificationChain | null): NotificationChain | null {
    if (this.isNotificationRequired()) {
      const oldIsSet = this.isSet(), notification = this.createNotification(Notification.SET, this.doSetUnique(index, object), object, index, oldIsSet)
      if (notifications === null) notifications = notification; else notifications.add(notification)
    } else this.doSetUnique(index, object)
    return notifications
  }
  override move(targetIndex: number, sourceIndex: number): T
  override move(targetIndex: number, object: T): void
  override move(targetIndex: number, second: number | T): T | void {
    if (typeof second !== 'number') { this.move(targetIndex, this.indexOf(second)); return }
    if (this.isNotificationRequired()) {
      const oldIsSet = this.isSet(), object = this.doMove(targetIndex, second)
      this.dispatchNotification(this.createNotification(Notification.MOVE, second, object, targetIndex, oldIsSet))
      return object
    }
    return this.doMove(targetIndex, second)
  }
  protected doMove(targetIndex: number, sourceIndex: number): T { return super.move(targetIndex, sourceIndex) }
}
