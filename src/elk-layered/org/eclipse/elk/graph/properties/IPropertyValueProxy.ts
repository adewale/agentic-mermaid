/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { IProperty } from './IProperty.ts'

export const IPropertyValueProxy = Symbol('org.eclipse.elk.graph.properties.IPropertyValueProxy')
export interface IPropertyValueProxy {
  readonly [IPropertyValueProxy]: true
  resolveValue<T>(property: IProperty<T>): T | null
}
