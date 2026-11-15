/*******************************************************************************
 * Copyright (c) 2011, 2015 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { JavaObject } from '../../../../../java/lang/Object.ts'
import { LinkedList } from '../../../../../java/util/LinkedList.ts'
import type { IFactory } from './IFactory.ts'

export class InstancePool<T> extends JavaObject {
  static readonly INFINITE = -1
  private readonly instances = new LinkedList<T>()
  constructor(private readonly factory: IFactory<T>, private readonly limit = InstancePool.INFINITE) { super() }
  fetch(): T { return this.instances.isEmpty() ? this.factory.create() : this.instances.removeFirst() }
  release(obj: T): void {
    if (this.limit < 0 || this.instances.size() < this.limit) this.instances.addLast(obj)
    else this.factory.destroy(obj)
  }
  clear(): void { for (const obj of this.instances) this.factory.destroy(obj); this.instances.clear() }
}
