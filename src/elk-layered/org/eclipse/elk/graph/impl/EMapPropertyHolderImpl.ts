/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Class } from '../../../../../java/lang/Class.ts'
import { isCloneable } from '../../../../../java/lang/Cloneable.ts'
import type { JavaMap } from '../../../../../java/util/Map.ts'
import type { NotificationChain } from '../../../emf/common/notify/NotificationChain.ts'
import type { EClass } from '../../../emf/ecore/EClass.ts'
import type { EStructuralFeature } from '../../../emf/ecore/EStructuralFeature.ts'
import type { InternalEObject } from '../../../emf/ecore/InternalEObject.ts'
import { MinimalEObjectImpl } from '../../../emf/ecore/impl/MinimalEObjectImpl.ts'
import { EcoreEMap } from '../../../emf/ecore/util/EcoreEMap.ts'
import { EMapPropertyHolder, isEMapPropertyHolder } from '../EMapPropertyHolder.ts'
import { ElkGraphPackage } from '../ElkGraphPackage.ts'
import type { IProperty } from '../properties/IProperty.ts'
import type { IPropertyHolder } from '../properties/IPropertyHolder.ts'
import { IPropertyValueProxy } from '../properties/IPropertyValueProxy.ts'
import { ElkPropertyToValueMapEntryImpl } from './ElkPropertyToValueMapEntryImpl.ts'

export abstract class EMapPropertyHolderImpl extends MinimalEObjectImpl.Container implements EMapPropertyHolder {
  static readonly javaName: string = 'org.eclipse.elk.graph.impl.EMapPropertyHolderImpl'
  readonly [EMapPropertyHolder] = true
  protected properties: EcoreEMap<IProperty<unknown>, unknown> | null = null
  protected eStaticClass(): EClass { return ElkGraphPackage.Literals.EMAP_PROPERTY_HOLDER }
  getProperties(): EcoreEMap<IProperty<unknown>, unknown> {
    if (this.properties === null) this.properties = new EcoreEMap(ElkGraphPackage.Literals.ELK_PROPERTY_TO_VALUE_MAP_ENTRY, Class.of(ElkPropertyToValueMapEntryImpl), this, ElkGraphPackage.EMAP_PROPERTY_HOLDER__PROPERTIES)
    return this.properties
  }
  setProperty<T>(property: IProperty<T>, value: T | null): this { if (value === null) this.getProperties().removeKey(property); else this.getProperties().put(property, value); return this }
  getProperty<T>(property: IProperty<T>): T {
    let value = this.getProperties().getValueForKey(property)
    if (value !== null && typeof value === 'object' && (value as IPropertyValueProxy)[IPropertyValueProxy] === true) {
      value = (value as IPropertyValueProxy).resolveValue(property)
      if (value !== null) { this.getProperties().put(property, value); return value as T }
    } else if (value !== null) return value as T
    const defaultValue = property.getDefault()
    if (isCloneable(defaultValue)) this.setProperty(property, defaultValue)
    return defaultValue
  }
  hasProperty(property: IProperty<unknown>): boolean { return this.getProperties().containsKey(property) }
  copyProperties(source: IPropertyHolder | null): this {
    if (source === null) return this
    if (isEMapPropertyHolder(source)) {
      const ourProps = this.getProperties()
      for (const entry of source.getProperties()) {
        let value = entry.getValue()
        if (value !== null && typeof value === 'object' && (value as IPropertyValueProxy)[IPropertyValueProxy] === true) {
          const newValue = (value as IPropertyValueProxy).resolveValue(entry.getKey())
          if (newValue !== null) { entry.setValue(newValue); value = newValue }
        }
        ourProps.put(entry.getKey(), value)
      }
    } else this.getProperties().putAll(source.getAllProperties())
    return this
  }
  getAllProperties(): JavaMap<IProperty<unknown>, unknown> {
    const props = this.getProperties()
    for (const entry of props) {
      const proxy = entry.getValue()
      if (proxy !== null && typeof proxy === 'object' && (proxy as IPropertyValueProxy)[IPropertyValueProxy] === true && entry.getKey() !== null) {
        const value = (proxy as IPropertyValueProxy).resolveValue(entry.getKey())
        if (value !== null) entry.setValue(value)
      }
    }
    return props.map()
  }
  override eInverseRemove(otherEnd: InternalEObject, featureID: number, msgs: NotificationChain | null): NotificationChain | null
  override eInverseRemove(otherEnd: InternalEObject, featureID: number, baseClass: Class<unknown> | null, msgs: NotificationChain | null): NotificationChain | null
  override eInverseRemove(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    if (arguments.length === 4) return super.eInverseRemove(otherEnd, featureID, third as Class<unknown> | null, fourth!)
    if (featureID === ElkGraphPackage.EMAP_PROPERTY_HOLDER__PROPERTIES) return this.getProperties().basicRemove(otherEnd as unknown as ElkPropertyToValueMapEntryImpl, third as NotificationChain | null)
    return super.eInverseRemove(otherEnd, featureID, third as NotificationChain | null)
  }
  override eGet(featureID: number | EStructuralFeature, resolve = true, coreType = true): unknown { if (featureID === ElkGraphPackage.EMAP_PROPERTY_HOLDER__PROPERTIES) return coreType ? this.getProperties() : this.getProperties().map(); return super.eGet(featureID, resolve, coreType) }
  override eSet(featureID: number | EStructuralFeature, newValue: unknown): void { if (featureID === ElkGraphPackage.EMAP_PROPERTY_HOLDER__PROPERTIES) { this.getProperties().set(newValue as JavaMap<IProperty<unknown>, unknown>); return }; super.eSet(featureID, newValue) }
  override eUnset(featureID: number | EStructuralFeature): void { if (featureID === ElkGraphPackage.EMAP_PROPERTY_HOLDER__PROPERTIES) { this.getProperties().clear(); return }; super.eUnset(featureID) }
  override eIsSet(featureID: number | EStructuralFeature): boolean { if (featureID === ElkGraphPackage.EMAP_PROPERTY_HOLDER__PROPERTIES) return this.properties !== null && !this.properties.isEmpty(); return super.eIsSet(featureID) }
}
