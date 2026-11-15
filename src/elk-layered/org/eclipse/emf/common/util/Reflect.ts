/*******************************************************************************
 * Copyright (c) 2010-2011 Ed Merks and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Class } from '../../../../../java/lang/Class.ts'
import { HashMap } from '../../../../../java/util/HashMap.ts'

export class Reflect {
  static readonly HELPER_REGISTRY = new HashMap<Class<unknown>, Reflect.Helper>()
  protected static strict = false
  static isStrict(): boolean { return Reflect.strict }
  static setStrict(enable: boolean): void { Reflect.strict = enable }
  static register(clazz: Class<unknown>, helper: Reflect.Helper): void { Reflect.HELPER_REGISTRY.put(clazz, helper) }
  static isInstance(clazz: Class<unknown>, instance: unknown): boolean {
    const helper = Reflect.HELPER_REGISTRY.get(clazz)
    if (helper !== null) return helper.isInstance(instance)
    if (Reflect.isStrict()) throw new Error('Unsupported operation')
    return true
  }
}
export namespace Reflect { export interface Helper { isInstance(instance: unknown): boolean; newArrayInstance(size: number): unknown[] } }
