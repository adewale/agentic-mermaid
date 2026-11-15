/**
 * Copyright (c) 2016 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import type { EMap } from '../../emf/common/util/EMap.ts'
import type { EObject } from '../../emf/ecore/EObject.ts'
import type { IProperty } from './properties/IProperty.ts'
import type { IPropertyHolder } from './properties/IPropertyHolder.ts'

export const EMapPropertyHolder = Symbol('org.eclipse.elk.graph.EMapPropertyHolder')

export interface EMapPropertyHolder extends EObject, IPropertyHolder {
  readonly [EMapPropertyHolder]: true
  getProperties(): EMap<IProperty<unknown>, unknown>
}

export function isEMapPropertyHolder(value: unknown): value is EMapPropertyHolder { return value !== null && typeof value === 'object' && (value as EMapPropertyHolder)[EMapPropertyHolder] === true }
