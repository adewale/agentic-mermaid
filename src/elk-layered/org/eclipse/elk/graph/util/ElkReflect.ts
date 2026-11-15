/*******************************************************************************
 * Copyright (c) 2017 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Class } from '../../../../../java/lang/Class.ts'
import { EnumSet } from '../../../../../java/util/EnumSet.ts'
import { HashMap } from '../../../../../java/util/HashMap.ts'

export class ElkReflect {
  private static readonly REGISTRY_NEW = new HashMap<Class<unknown>, ElkReflect.NewInstanceFunction>()
  private static readonly REGISTRY_CLONE = new HashMap<Class<unknown>, ElkReflect.CloneFunction>()

  static {
    ElkReflect.registerClone(Class.of(EnumSet), { clone: object => (object as EnumSet<never>).clone() })
  }

  private constructor() {}

  static register(clazz: Class<unknown> | null, newFun: ElkReflect.NewInstanceFunction | null, cloneFun: ElkReflect.CloneFunction | null): void {
    if (clazz !== null && newFun !== null) ElkReflect.REGISTRY_NEW.put(clazz, newFun)
    if (clazz !== null && cloneFun !== null) ElkReflect.REGISTRY_CLONE.put(clazz, cloneFun)
  }

  static registerNewInstance(clazz: Class<unknown>, newFun: ElkReflect.NewInstanceFunction): void { ElkReflect.register(clazz, newFun, null) }
  static registerClone(clazz: Class<unknown>, cloneFun: ElkReflect.CloneFunction): void { ElkReflect.register(clazz, null, cloneFun) }

  static newInstance<T>(clazz: Class<T>): T | null {
    if (ElkReflect.REGISTRY_NEW.containsKey(clazz)) return ElkReflect.REGISTRY_NEW.get(clazz)!.newInstance() as T
    return null
  }

  static clone<T>(clonee: T): T | null {
    if (clonee instanceof EnumSet) return ElkReflect.REGISTRY_CLONE.get(Class.of(EnumSet))!.clone(clonee) as T
    const clazz = Class.of((clonee as object).constructor as Function & { prototype: unknown })
    if (ElkReflect.REGISTRY_CLONE.containsKey(clazz)) return ElkReflect.REGISTRY_CLONE.get(clazz)!.clone(clonee) as T
    return null
  }
}

export namespace ElkReflect {
  export interface NewInstanceFunction { newInstance(): unknown }
  export interface CloneFunction { clone(object: unknown): unknown }
}
