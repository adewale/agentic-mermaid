/*******************************************************************************
 * Copyright (c) 2009, 2017 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { JavaObject } from '../../../../../java/lang/Object.ts'
import { isCloneable } from '../../../../../java/lang/Cloneable.ts'
import { HashMap } from '../../../../../java/util/HashMap.ts'
import { Collections } from '../../../../../java/util/Collections.ts'
import type { JavaMap } from '../../../../../java/util/Map.ts'
import type { IProperty } from './IProperty.ts'
import type { IPropertyHolder } from './IPropertyHolder.ts'
import { IPropertyValueProxy } from './IPropertyValueProxy.ts'

export class MapPropertyHolder extends JavaObject implements IPropertyHolder {
  static readonly #serialVersionUID = 4507851447415709893n
  private propertyMap: HashMap<IProperty<unknown>, unknown> | null = null

  setProperty<T>(property: IProperty<T>, value: T | null): MapPropertyHolder {
    if (value === null) this.getProperties().remove(property)
    else this.getProperties().put(property, value)
    return this
  }

  getProperty<T>(property: IProperty<T>): T {
    let value = this.getProperties().get(property)
    if (value !== null && typeof value === 'object' && (value as IPropertyValueProxy)[IPropertyValueProxy] === true) {
      value = (value as IPropertyValueProxy).resolveValue(property)
      if (value !== null) {
        this.getProperties().put(property, value)
        return value as T
      }
    } else if (value !== null) return value as T
    const defaultValue = property.getDefault()
    if (isCloneable(defaultValue)) this.setProperty(property, defaultValue)
    return defaultValue
  }

  hasProperty(property: IProperty<unknown>): boolean { return this.propertyMap !== null && this.propertyMap.containsKey(property) }

  copyProperties(other: IPropertyHolder | null): MapPropertyHolder {
    if (other === null) return this
    const otherMap = other.getAllProperties()
    if (!otherMap.isEmpty()) {
      if (this.propertyMap === null) this.propertyMap = new HashMap(otherMap)
      else this.propertyMap.putAll(otherMap)
    }
    return this
  }

  getAllProperties(): JavaMap<IProperty<unknown>, unknown> { return this.propertyMap ?? Collections.emptyMap() }

  private getProperties(): JavaMap<IProperty<unknown>, unknown> {
    if (this.propertyMap === null) this.propertyMap = new HashMap()
    return this.propertyMap
  }
}
