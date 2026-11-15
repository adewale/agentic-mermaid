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
import type { Entry, JavaMap } from '../../../../../java/util/Map.ts'
import { BasicEMap } from '../../common/util/BasicEMap.ts'
import { BasicEList } from '../../common/util/BasicEList.ts'
import { Array as EmfArray } from '../../common/util/Array.ts'
import type { NotificationChain } from '../../common/notify/NotificationChain.ts'
import type { EClass } from '../EClass.ts'
import type { EObject } from '../EObject.ts'
import type { EStructuralFeature } from '../EStructuralFeature.ts'
import type { InternalEObject } from '../InternalEObject.ts'
import type { EcoreEList } from './EcoreEList.ts'
import { EObjectContainmentEList } from './EObjectContainmentEList.ts'

type MapDelegate<K, V> = EcoreEList<BasicEMap.Entry<K, V>>

export class EcoreEMap<K, V> extends BasicEMap<K, V> {
  protected entryEClass: EClass
  protected entryClass: Class<unknown>
  protected declare delegateEList: MapDelegate<K, V>
  constructor(entryEClass: EClass, entryClass: Class<unknown>, delegateEList: MapDelegate<K, V> | null)
  constructor(entryEClass: EClass, entryClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID?: number)
  constructor(entryEClass: EClass, entryClass: Class<unknown>, third: InternalEObject | MapDelegate<K, V> | null, featureID?: number, inverseFeatureID?: number) {
    super()
    this.entryClass = entryClass
    this.entryEClass = entryEClass
    if (arguments.length === 3) { this.delegateEList = third as MapDelegate<K, V>; return }
    const owner = this
    class DelegateEObjectContainmentEList extends EObjectContainmentEList<BasicEMap.Entry<K, V>> {
      protected override didAdd(_index: number, newObject: BasicEMap.Entry<K, V>): void { owner.doPut(newObject) }
      protected override didSet(index: number, newObject: BasicEMap.Entry<K, V>, oldObject: BasicEMap.Entry<K, V>): void {
        this.didRemove(index, oldObject)
        if (oldObject === newObject) oldObject.setHash(owner.hashOf(newObject.getKey()))
        this.didAdd(index, newObject)
      }
      protected override didRemove(_index: number, oldObject: BasicEMap.Entry<K, V>): void { owner.doRemove(oldObject) }
      protected override didClear(_size: number, _oldObjects: BasicEMap.Entry<K, V>[] | null): void { owner.doClear() }
      protected override didMove(_index: number, movedObject: BasicEMap.Entry<K, V>, _oldIndex: number): void { owner.doMove(movedObject) }
    }
    class DelegateEObjectContainmentWithInverseEList extends DelegateEObjectContainmentEList {
      constructor(dataClass: Class<unknown>, object: InternalEObject, featureID: number, protected readonly inverseFeatureID: number) { super(dataClass, object, featureID) }
      protected override hasNavigableInverse(): boolean { return true }
      public override getInverseFeatureID(): number { return this.inverseFeatureID }
      public override getInverseFeatureClass(): Class<unknown> { return this.dataClass }
    }
    this.delegateEList = inverseFeatureID === undefined ? new DelegateEObjectContainmentEList(entryClass, third as InternalEObject, featureID!) : new DelegateEObjectContainmentWithInverseEList(entryClass, third as InternalEObject, featureID!, inverseFeatureID)
  }
  protected override initializeDelegateEList(): void {}
  protected override newList(): BasicEList<BasicEMap.Entry<K, V>> {
    const owner = this
    return new class extends BasicEList<BasicEMap.Entry<K, V>> { protected override newData(listCapacity: number): BasicEMap.Entry<K, V>[] { return EmfArray.newInstance(owner.entryClass, listCapacity) as BasicEMap.Entry<K, V>[] } }()
  }
  protected override newEntry(hash: number, key: K, value: V): BasicEMap.Entry<K, V> {
    const entry = this.entryEClass.getEPackage().getEFactoryInstance().create(this.entryEClass) as unknown as BasicEMap.Entry<K, V>
    entry.setHash(hash); entry.setKey(key); entry.setValue(value)
    return entry
  }
  basicGet(index: number): BasicEMap.Entry<K, V> { return this.delegateEList.basicGet(index) }
  basicList(): AbstractList<BasicEMap.Entry<K, V>> { return this.delegateEList.basicList() }
  basicIterator(): Iterator<BasicEMap.Entry<K, V>> { return this.delegateEList.basicIterator() }
  basicListIterator(index = 0): ListIterator<BasicEMap.Entry<K, V>> { return this.delegateEList.basicListIterator(index) }
  basicContains(object: Entry<K, V>): boolean { return this.delegateEList.basicContains(object as BasicEMap.Entry<K, V>) }
  basicContainsAll(collection: Iterable<BasicEMap.Entry<K, V>>): boolean { return this.delegateEList.basicContainsAll(collection) }
  basicIndexOf(object: Entry<K, V>): number { return this.delegateEList.basicIndexOf(object as BasicEMap.Entry<K, V>) }
  basicLastIndexOf(object: Entry<K, V>): number { return this.delegateEList.basicLastIndexOf(object as BasicEMap.Entry<K, V>) }
  basicToArray(): BasicEMap.Entry<K, V>[]
  basicToArray(array: BasicEMap.Entry<K, V>[]): BasicEMap.Entry<K, V>[]
  basicToArray(array?: BasicEMap.Entry<K, V>[]): BasicEMap.Entry<K, V>[] { return array === undefined ? this.delegateEList.basicToArray() : this.delegateEList.basicToArray(array) }
  basicRemove(object: Entry<K, V>, notifications: NotificationChain | null): NotificationChain | null { return this.delegateEList.basicRemove(object as BasicEMap.Entry<K, V>, notifications) }
  basicAdd(object: Entry<K, V>, notifications: NotificationChain | null): NotificationChain | null { return this.delegateEList.basicAdd(object as BasicEMap.Entry<K, V>, notifications) }
  addUnique(object: Entry<K, V>): void
  addUnique(index: number, object: Entry<K, V>): void
  addUnique(first: number | Entry<K, V>, second?: Entry<K, V>): void { if (arguments.length === 1) this.delegateEList.addUnique(first as BasicEMap.Entry<K, V>); else this.delegateEList.addUnique(first as number, second as BasicEMap.Entry<K, V>) }
  addAllUnique(collection: Collection<BasicEMap.Entry<K, V>>): boolean
  addAllUnique(index: number, collection: Collection<BasicEMap.Entry<K, V>>): boolean
  addAllUnique(first: number | Collection<BasicEMap.Entry<K, V>>, second?: Collection<BasicEMap.Entry<K, V>>): boolean { return this.delegateEList.addAllUnique(typeof first === 'number' ? second! : first) }
  setUnique(index: number, object: Entry<K, V>): Entry<K, V> { return this.delegateEList.setUnique(index, object as BasicEMap.Entry<K, V>) }
  getEObject(): EObject { return this.delegateEList.getEObject() }
  getEStructuralFeature(): EStructuralFeature { return this.delegateEList.getEStructuralFeature() }
  override get(index: number): BasicEMap.Entry<K, V>
  override get(key: K): V | null
  get(resolve: boolean): MapDelegate<K, V>
  override get(first: number | K | boolean): BasicEMap.Entry<K, V> | V | null | MapDelegate<K, V> { if (typeof first === 'boolean') return this.delegateEList.get(first); return typeof first === 'number' ? super.get(first) : this.getValueForKey(first as K) }
  override set(index: number, object: Entry<K, V>): Entry<K, V>
  set(value: JavaMap<K, V> | Collection<BasicEMap.Entry<K, V>>): void
  override set(first: number | JavaMap<K, V> | Collection<BasicEMap.Entry<K, V>>, second?: Entry<K, V>): Entry<K, V> | void {
    if (arguments.length === 2) return super.set(first as number, second!)
    const value = first as JavaMap<K, V> | Collection<BasicEMap.Entry<K, V>>
    if ('entrySet' in value) { this.delegateEList.unset(); this.putAll(value) }
    else this.delegateEList.set(value)
  }
  isSet(): boolean { return this.delegateEList.isSet() }
  unset(): void { this.delegateEList.unset() }
}
