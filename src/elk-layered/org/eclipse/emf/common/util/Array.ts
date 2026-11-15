/*******************************************************************************
 * Copyright (c) 2010 Ed Merks and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Class } from '../../../../../java/lang/Class.ts'
import { Reflect } from './Reflect.ts'

export class Array {
  static newInstance(componentType: Class<unknown>, size: number): unknown[] {
    const helper = Reflect.HELPER_REGISTRY.get(componentType)
    return helper !== null ? helper.newArrayInstance(size) : new globalThis.Array<unknown>(size).fill(null)
  }
  static getLength(array: unknown[]): number { return array.length }
}
