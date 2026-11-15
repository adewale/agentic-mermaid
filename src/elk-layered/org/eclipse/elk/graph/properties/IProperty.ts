/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Comparable } from '../../../../../java/lang/Comparable.ts'

export const IProperty = Symbol('org.eclipse.elk.graph.properties.IProperty')
export interface IProperty<T> {
  readonly [IProperty]: true
  getDefault(): T
  getId(): string
  getLowerBound(): Comparable<T>
  getUpperBound(): Comparable<T>
}
