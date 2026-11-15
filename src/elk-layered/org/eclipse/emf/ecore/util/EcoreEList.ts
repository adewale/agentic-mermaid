/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Class } from '../../../../../java/lang/Class.ts'
import type { AbstractList } from '../../../../../java/util/AbstractList.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import type { Iterator, ListIterator } from '../../../../../java/util/Iterator.ts'
import { Array as EmfArray } from '../../common/util/Array.ts'
import { Reflect } from '../../common/util/Reflect.ts'
import { BasicEList } from '../../common/util/BasicEList.ts'
import { Notification } from '../../common/notify/Notification.ts'
import type { NotificationChain } from '../../common/notify/NotificationChain.ts'
import { NotificationImpl } from '../../common/notify/impl/NotificationImpl.ts'
import type { EClass } from '../EClass.ts'
import type { EClassifier } from '../EClassifier.ts'
import type { EObject } from '../EObject.ts'
import type { EReference } from '../EReference.ts'
import type { EStructuralFeature } from '../EStructuralFeature.ts'
import { InternalEObject } from '../InternalEObject.ts'
import { ENotificationImpl } from '../impl/ENotificationImpl.ts'
import type { InternalEList } from './InternalEList.ts'
import { NotifyingInternalEListImpl } from './NotifyingInternalEListImpl.ts'

const NotifyingInternalEListImplBase: new <T>() => NotifyingInternalEListImpl<T> = NotifyingInternalEListImpl
const BasicUnmodifiableEListBase: new <T>(size: number, data: T[] | null) => BasicEList.UnmodifiableEList<T> = BasicEList.UnmodifiableEList

export abstract class EcoreEList<T> extends NotifyingInternalEListImplBase<T> implements InternalEList.Unsettable<T> {
  constructor(protected readonly dataClass: Class<unknown>, protected readonly owner: InternalEObject) { super() }
  protected override newData(capacity: number): T[] { return EmfArray.newInstance(this.dataClass, capacity) as T[] }
  protected override validate(index: number, object: T): T { super.validate(index, object); if (!this.hasInstanceClass() && object !== null && !this.isInstance(object)) throw new TypeError('Array store type mismatch'); return object }
  protected isInstance(object: unknown): boolean { return Reflect.isInstance(this.dataClass, object) }
  override getNotifier(): InternalEObject { return this.owner }
  override getFeature(): EStructuralFeature { return this.getEStructuralFeature() }
  override getFeatureID(_expectedClass?: Class<unknown> | null): number { return this.owner.eClass().getFeatureID(this.getEStructuralFeature()) }
  getEStructuralFeature(): EStructuralFeature { return this.owner.eClass().getEStructuralFeature(this.getFeatureID())! }
  protected getFeatureType(): EClassifier { return this.getEStructuralFeature().getEType() }
  protected getInverseEReference(): EReference { return (this.getEStructuralFeature() as EReference).getEOpposite()! }
  protected getInverseFeatureID(): number { return this.getInverseEReference().getFeatureID() }
  protected getInverseFeatureClass(): Class<unknown> { return (this.getEStructuralFeature().getEType() as EClass).getInstanceClass() }
  protected hasManyInverse(): boolean { return false }
  protected hasNavigableInverse(): boolean { return false }
  protected isEObject(): boolean { return true }
  protected isContainment(): boolean { return false }
  protected hasProxies(): boolean { return false }
  protected hasInstanceClass(): boolean { return true }
  protected override resolve(index: number, object: T): T
  protected override resolve(object: T): T
  protected override resolve(first: number | T, second?: T): T {
    if (arguments.length === 1) return this.isEObject() ? this.resolveProxy(first as EObject) as T : first as T
    return this.isEObject() && this.hasProxies() ? this.resolveEObject(first as number, second as EObject) as T : second!
  }
  protected resolveEObject(index: number, eObject: EObject): EObject {
    const resolved = this.resolveProxy(eObject)
    if (resolved !== eObject) {
      const oldObject = this.dataValue![index]!
      this.assign(index, this.validate(index, resolved as T))
      this.didSet(index, resolved as T, oldObject)
      if (this.isContainment()) {
        let notificationChain = this.inverseRemove(eObject as T, null)
        if ((resolved as InternalEObject).eInternalContainer() === null) notificationChain = this.inverseAdd(resolved as T, notificationChain)
        if (notificationChain !== null) notificationChain.dispatch()
      }
      if (this.isNotificationRequired()) this.dispatchNotification(this.createNotification(Notification.RESOLVE, eObject, resolved, index, false))
      return resolved
    }
    return eObject
  }
  protected resolveProxy(eObject: EObject): EObject { return (eObject as InternalEObject).eIsProxy() ? this.owner.eResolveProxy(eObject as InternalEObject) : eObject }
  override toArray(): T[]
  override toArray(array: T[]): T[]
  override toArray(array?: T[]): T[] {
    if (this.hasProxies()) for (let i = this.sizeValue - 1; i >= 0; --i) this.get(i)
    return array === undefined ? super.toArray() : super.toArray(array)
  }
  protected override createNotification(eventType: number, oldObject: unknown, newObject: unknown, index: number, wasSet: boolean): NotificationImpl
  protected createNotification(eventType: number, oldValue: boolean, newValue: boolean): NotificationImpl
  protected override createNotification(eventType: number, oldObject: unknown, newObject: unknown, index?: number, wasSet?: boolean): NotificationImpl {
    return arguments.length === 3 ? new ENotificationImpl(this.owner, eventType, this.getFeatureID(), oldObject, newObject, Notification.NO_INDEX, undefined, NotificationImpl.PRIMITIVE_TYPE_BOOLEAN) : new ENotificationImpl(this.owner, eventType, this.getFeatureID(), oldObject, newObject, index!, wasSet)
  }
  protected override dispatchNotification(notification: Notification): void { this.owner.eNotify(notification) }
  protected override isNotificationRequired(): boolean { return this.owner.eNotificationRequired() }
  public override inverseAdd(object: T, notifications: NotificationChain | null): NotificationChain | null {
    const internalEObject = object as InternalEObject
    if (this.hasNavigableInverse()) return !this.hasInstanceClass() ? internalEObject.eInverseAdd(this.owner, internalEObject.eClass().getFeatureID(this.getInverseEReference()), null, notifications) : internalEObject.eInverseAdd(this.owner, this.getInverseFeatureID(), this.getInverseFeatureClass(), notifications)
    return internalEObject.eInverseAdd(this.owner, InternalEObject.EOPPOSITE_FEATURE_BASE - this.getFeatureID(), null, notifications)
  }
  public override inverseRemove(object: T, notifications: NotificationChain | null): NotificationChain | null {
    const internalEObject = object as InternalEObject
    if (this.hasNavigableInverse()) return !this.hasInstanceClass() ? internalEObject.eInverseRemove(this.owner, internalEObject.eClass().getFeatureID(this.getInverseEReference()), null, notifications) : internalEObject.eInverseRemove(this.owner, this.getInverseFeatureID(), this.getInverseFeatureClass(), notifications)
    return internalEObject.eInverseRemove(this.owner, InternalEObject.EOPPOSITE_FEATURE_BASE - this.getFeatureID(), null, notifications)
  }
  override contains(object: T): boolean {
    if (!this.isEObject()) return super.contains(object)
    if (this.sizeValue > 4) {
      if (!this.isInstance(object)) return false
      if (this.isContainment()) {
        const eObject = object as InternalEObject, eContainer = eObject.eContainer()
        const result = eContainer === this.owner && (this.hasNavigableInverse() ? eObject.eBaseStructuralFeatureID(eObject.eContainerFeatureID(), this.getInverseFeatureClass()) === this.getInverseFeatureID() : InternalEObject.EOPPOSITE_FEATURE_BASE - eObject.eContainerFeatureID() === this.getFeatureID())
        if (this.hasProxies() && !result && eContainer === null && eObject.eDirectResource() !== null) for (let i = 0; i < this.sizeValue; ++i) if (this.resolveProxy(this.dataValue![i] as EObject) === object as unknown) return true
        return result
      }
      if (this.hasNavigableInverse() && !this.hasManyInverse()) {
        const opposite = (object as InternalEObject).eGet(this.getInverseEReference()) as InternalEObject | null
        if (opposite === this.owner) return true
        if (opposite === null || !opposite.eIsProxy()) return false
      }
    }
    const result = super.contains(object)
    if (this.hasProxies() && !result) for (let i = 0; i < this.sizeValue; ++i) if (this.resolveProxy(this.dataValue![i] as EObject) === object as unknown) return true
    return result
  }
  override indexOf(object: T): number {
    const index = super.indexOf(object)
    if (index >= 0) return index
    if (this.isEObject()) for (let i = 0; i < this.sizeValue; ++i) if (this.resolveProxy(this.dataValue![i] as EObject) === object as unknown) return i
    return -1
  }
  override lastIndexOf(object: T): number {
    const result = super.lastIndexOf(object)
    if (this.isEObject() && result === -1) for (let i = this.sizeValue - 1; i >= 0; --i) if (this.resolveProxy(this.dataValue![i] as EObject) === object as unknown) return i
    return result
  }
  getEObject(): EObject { return this.owner }
  override get(index: number): T
  get(resolve: boolean): this
  override get(indexOrResolve: number | boolean): T | this { return typeof indexOrResolve === 'boolean' ? this : super.get(indexOrResolve) }
  override set(index: number, object: T): T
  set(newValue: Collection<T>): void
  override set(first: number | Collection<T>, second?: T): T | void { if (arguments.length === 1) { this.clear(); this.addAll(first as Collection<T>); return }; return super.set(first as number, second!) }
  public override isSet(): boolean { return !this.isEmpty() }
  unset(): void { this.clear() }
}

export namespace EcoreEList {
  export class UnmodifiableEList<T> extends BasicUnmodifiableEListBase<T> implements InternalEList.Unsettable<T> {
    constructor(protected readonly owner: InternalEObject, protected readonly eStructuralFeature: EStructuralFeature, size: number, data: T[] | null) { super(size, data) }
    public override basicList(): AbstractList<T> { return super.basicList() }
    public override basicIterator(): Iterator<T> { return super.basicIterator() }
    public override basicListIterator(index = 0): ListIterator<T> { return super.basicListIterator(index) }
    basicContains(object: T): boolean { return super.contains(object) }
    basicContainsAll(collection: Iterable<T>): boolean { return super.containsAll(collection) }
    basicIndexOf(object: T): number { return super.indexOf(object) }
    basicLastIndexOf(object: T): number { return super.lastIndexOf(object) }
    basicToArray(): T[]
    basicToArray(array: T[]): T[]
    basicToArray(array?: T[]): T[] { return array === undefined ? super.toArray() : super.toArray(array) }
    getEObject(): EObject { return this.owner }
    getEStructuralFeature(): EStructuralFeature { return this.eStructuralFeature }
    override get(index: number): T
    get(resolve: boolean): this
    override get(indexOrResolve: number | boolean): T | this { return typeof indexOrResolve === 'boolean' ? this : super.get(indexOrResolve) }
    override set(index: number, object: T): never
    set(newValue: unknown): never
    override set(_first: number | unknown, _second?: T): never { throw new Error('Unsupported operation') }
    isSet(): boolean { return !this.isEmpty() }
    unset(): never { throw new Error('Unsupported operation') }
    basicRemove(_object: T, _notifications: NotificationChain | null): never { throw new Error('Unsupported operation') }
    basicAdd(_object: T, _notifications: NotificationChain | null): never { throw new Error('Unsupported operation') }
  }
  export namespace UnmodifiableEList { export class FastCompare<T> extends UnmodifiableEList<T> { protected override useEquals(): boolean { return false } } }
}
