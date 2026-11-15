/*******************************************************************************
 * Copyright (c) 2009-2010 Ed Merks and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { BasicNotifierImpl } from '../../common/notify/impl/BasicNotifierImpl.ts'
import type { Adapter } from '../../common/notify/Adapter.ts'
import type { EList } from '../../common/util/EList.ts'
import type { InternalEObject } from '../InternalEObject.ts'
import { ENotificationImpl } from './ENotificationImpl.ts'
import { Notification } from '../../common/notify/Notification.ts'
import type { Class } from '../../../../../java/lang/Class.ts'
import type { NotificationChain } from '../../common/notify/NotificationChain.ts'
import type { EClass } from '../EClass.ts'
import type { EObject } from '../EObject.ts'
import type { EReference } from '../EReference.ts'
import type { EStructuralFeature } from '../EStructuralFeature.ts'

export abstract class MinimalEObjectImpl extends BasicNotifierImpl implements EObject, InternalEObject {
  static readonly EOPPOSITE_FEATURE_BASE = -1
  private container: InternalEObject | null = null
  private containerFeatureID = 0
  private deliver = true
  private adapters: BasicNotifierImpl.EAdapterList<Adapter> | null = null
  protected abstract eStaticClass(): EClass
  eClass(): EClass { return this.eStaticClass() }
  eContainer(): InternalEObject | null { return this.eInternalContainer() }
  eInternalContainer(): InternalEObject | null { return this.container }
  eContainerFeatureID(): number { return this.containerFeatureID }
  eIsProxy(): boolean { return false }
  override eDeliver(): boolean { return this.deliver }
  override eSetDeliver(deliver: boolean): void { this.deliver = deliver }
  override eAdapters(): EList<Adapter> { return this.adapters ??= new BasicNotifierImpl.EAdapterList(this) }
  protected override eBasicAdapters(): BasicNotifierImpl.EAdapterList<Adapter> | null { return this.adapters }
  eDirectResource(): null { return null }
  eResolveProxy(_proxy: InternalEObject): InternalEObject { throw new Error('Unsupported external proxy resolution in the JSON layout boundary') }
  eBaseStructuralFeatureID(featureID: number, _baseClass: Class<unknown> | null): number { return featureID }
  eDerivedStructuralFeatureID(featureID: number, _baseClass: Class<unknown> | null): number { return featureID }

  eInverseAdd(otherEnd: InternalEObject, featureID: number, msgs: NotificationChain | null): NotificationChain | null
  eInverseAdd(otherEnd: InternalEObject, featureID: number, baseClass: Class<unknown> | null, msgs: NotificationChain | null): NotificationChain | null
  eInverseAdd(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    const msgs = arguments.length === 4 ? fourth! : third as NotificationChain | null
    if (arguments.length === 4 && featureID >= 0) return this.eInverseAdd(otherEnd, this.eDerivedStructuralFeatureID(featureID, third as Class<unknown> | null), msgs)
    if (featureID < 0) {
      let notifications = msgs
      if (this.eInternalContainer() !== null) notifications = this.eBasicRemoveFromContainer(notifications)
      return this.eBasicSetContainer(otherEnd, featureID, notifications)
    }
    throw new Error('Unsupported dynamic inverse feature: ' + featureID)
  }
  eInverseRemove(otherEnd: InternalEObject, featureID: number, msgs: NotificationChain | null): NotificationChain | null
  eInverseRemove(otherEnd: InternalEObject, featureID: number, baseClass: Class<unknown> | null, msgs: NotificationChain | null): NotificationChain | null
  eInverseRemove(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    const msgs = arguments.length === 4 ? fourth! : third as NotificationChain | null
    if (arguments.length === 4 && featureID >= 0) return this.eInverseRemove(otherEnd, this.eDerivedStructuralFeatureID(featureID, third as Class<unknown> | null), msgs)
    if (featureID < 0) return this.eBasicSetContainer(null, featureID, msgs)
    throw new Error('Unsupported dynamic inverse feature: ' + featureID)
  }
  eBasicSetContainer(newContainer: InternalEObject | null, newContainerFeatureID: number, msgs: NotificationChain | null): NotificationChain | null {
    const oldContainer = this.eInternalContainer(), oldContainerFeatureID = this.eContainerFeatureID()
    this.container = newContainer
    this.containerFeatureID = newContainerFeatureID
    if (this.eNotificationRequired()) {
      if (oldContainer !== null && oldContainerFeatureID >= 0 && oldContainerFeatureID !== newContainerFeatureID) {
        const notification = new ENotificationImpl(this, Notification.SET, oldContainerFeatureID, oldContainer, null)
        if (msgs === null) msgs = notification; else msgs.add(notification)
      }
      if (newContainerFeatureID >= 0) {
        const notification = new ENotificationImpl(this, Notification.SET, newContainerFeatureID, oldContainerFeatureID === newContainerFeatureID ? oldContainer : null, newContainer)
        if (msgs === null) msgs = notification; else msgs.add(notification)
      }
    }
    return msgs
  }
  eBasicRemoveFromContainer(msgs: NotificationChain | null): NotificationChain | null { return this.eBasicRemoveFromContainerFeature(msgs) }
  eBasicRemoveFromContainerFeature(msgs: NotificationChain | null): NotificationChain | null {
    const featureID = this.eContainerFeatureID()
    if (featureID < 0) return this.eInternalContainer()!.eInverseRemove(this, MinimalEObjectImpl.EOPPOSITE_FEATURE_BASE - featureID, null, msgs)
    throw new Error('Unsupported container feature: ' + featureID)
  }
  eContainmentFeature(): EReference | null {
    const container = this.eInternalContainer()
    if (container === null) return null
    const featureID = this.eContainerFeatureID()
    if (featureID <= MinimalEObjectImpl.EOPPOSITE_FEATURE_BASE) return container.eClass().getEStructuralFeature(MinimalEObjectImpl.EOPPOSITE_FEATURE_BASE - featureID) as EReference
    return (this.eClass().getEStructuralFeature(featureID) as EReference).getEOpposite()
  }
  eGet(feature: number | EStructuralFeature, resolve = true, coreType = true): unknown {
    if (typeof feature !== 'number') return this.eGet(feature.getFeatureID(), resolve, coreType)
    throw new Error('Unsupported dynamic feature: ' + feature)
  }
  eSet(feature: number | EStructuralFeature, value: unknown): void {
    if (typeof feature !== 'number') { this.eSet(feature.getFeatureID(), value); return }
    throw new Error('Unsupported dynamic feature: ' + feature)
  }
  eUnset(feature: number | EStructuralFeature): void {
    if (typeof feature !== 'number') { this.eUnset(feature.getFeatureID()); return }
    throw new Error('Unsupported dynamic feature: ' + feature)
  }
  eIsSet(feature: number | EStructuralFeature): boolean {
    if (typeof feature !== 'number') return this.eIsSet(feature.getFeatureID())
    throw new Error('Unsupported dynamic feature: ' + feature)
  }
}

export namespace MinimalEObjectImpl { export abstract class Container extends MinimalEObjectImpl {} }
