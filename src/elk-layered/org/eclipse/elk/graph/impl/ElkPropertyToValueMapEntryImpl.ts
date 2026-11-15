/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { javaHashCode } from '../../../../../java/lang/Object.ts'
import type { BasicEMap } from '../../../emf/common/util/BasicEMap.ts'
import type { EMap } from '../../../emf/common/util/EMap.ts'
import { Notification } from '../../../emf/common/notify/Notification.ts'
import type { EClass } from '../../../emf/ecore/EClass.ts'
import type { EStructuralFeature } from '../../../emf/ecore/EStructuralFeature.ts'
import { MinimalEObjectImpl } from '../../../emf/ecore/impl/MinimalEObjectImpl.ts'
import { ENotificationImpl } from '../../../emf/ecore/impl/ENotificationImpl.ts'
import { ElkGraphPackage } from '../ElkGraphPackage.ts'
import type { IProperty } from '../properties/IProperty.ts'

export class ElkPropertyToValueMapEntryImpl extends MinimalEObjectImpl.Container implements BasicEMap.Entry<IProperty<unknown>, unknown> {
  static readonly javaName: string = 'org.eclipse.elk.graph.impl.ElkPropertyToValueMapEntryImpl'
  protected key: IProperty<unknown> | null = null
  protected static readonly VALUE_EDEFAULT: unknown = null
  protected value = ElkPropertyToValueMapEntryImpl.VALUE_EDEFAULT
  protected eStaticClass(): EClass { return ElkGraphPackage.Literals.ELK_PROPERTY_TO_VALUE_MAP_ENTRY }
  getTypedKey(): IProperty<unknown> | null { return this.key }
  setTypedKey(newKey: IProperty<unknown> | null): void { const oldKey = this.key; this.key = newKey; if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__KEY, oldKey, this.key)) }
  getTypedValue(): unknown { return this.value }
  setTypedValue(newValue: unknown): void { const oldValue = this.value; this.value = newValue; if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__VALUE, oldValue, this.value)) }
  override eGet(featureID: number | EStructuralFeature, resolve = true, coreType = true): unknown {
    switch (featureID) { case ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__KEY: return this.getTypedKey(); case ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__VALUE: return this.getTypedValue() }
    return super.eGet(featureID, resolve, coreType)
  }
  override eSet(featureID: number | EStructuralFeature, newValue: unknown): void {
    switch (featureID) { case ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__KEY: this.setTypedKey(newValue as IProperty<unknown> | null); return; case ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__VALUE: this.setTypedValue(newValue); return }
    super.eSet(featureID, newValue)
  }
  override eUnset(featureID: number | EStructuralFeature): void {
    switch (featureID) { case ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__KEY: this.setTypedKey(null); return; case ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__VALUE: this.setTypedValue(ElkPropertyToValueMapEntryImpl.VALUE_EDEFAULT); return }
    super.eUnset(featureID)
  }
  override eIsSet(featureID: number | EStructuralFeature): boolean {
    switch (featureID) { case ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__KEY: return this.key !== null; case ElkGraphPackage.ELK_PROPERTY_TO_VALUE_MAP_ENTRY__VALUE: return this.value !== null }
    return super.eIsSet(featureID)
  }
  override toString(): string { return this.eIsProxy() ? super.toString() : (this.key !== null ? this.key.getId() : 'null') + ' -> ' + String(this.value) }
  protected hash = -1
  getHash(): number { if (this.hash === -1) { const key = this.getKey(); this.hash = key === null ? 0 : javaHashCode(key) }; return this.hash }
  setHash(hash: number): void { this.hash = hash }
  getKey(): IProperty<unknown> { return this.getTypedKey() as IProperty<unknown> }
  setKey(key: IProperty<unknown>): void { this.setTypedKey(key) }
  getValue(): unknown { return this.getTypedValue() }
  setValue(value: unknown): unknown { const oldValue = this.getValue(); this.setTypedValue(value); return oldValue }
  getEMap(): EMap<IProperty<unknown>, unknown> | null { const container = this.eContainer(); return container === null ? null : container.eGet(this.eContainmentFeature()!) as EMap<IProperty<unknown>, unknown> }
}
