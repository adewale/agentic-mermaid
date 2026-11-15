/*******************************************************************************
 * Copyright (c) 2009, 2017 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { JavaMap } from '../../../../../java/util/Map.ts'
import type { IProperty } from './IProperty.ts'

export interface IPropertyHolder {
  setProperty<T>(property: IProperty<T>, value: T | null): IPropertyHolder
  getProperty<T>(property: IProperty<T>): T
  hasProperty(property: IProperty<unknown>): boolean
  copyProperties(holder: IPropertyHolder | null): IPropertyHolder
  getAllProperties(): JavaMap<IProperty<unknown>, unknown>
}
