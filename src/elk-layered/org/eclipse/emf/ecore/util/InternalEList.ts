/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { AbstractList } from '../../../../../java/util/AbstractList.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import type { Iterator, ListIterator } from '../../../../../java/util/Iterator.ts'
import type { EList } from '../../common/util/EList.ts'
import type { NotificationChain } from '../../common/notify/NotificationChain.ts'

export interface InternalEList<T> extends EList<T> {
  basicGet(index: number): T
  basicList(): AbstractList<T>
  basicIterator(): Iterator<T>
  basicListIterator(index?: number): ListIterator<T>
  basicToArray(): T[]
  basicToArray(array: T[]): T[]
  basicIndexOf(object: T): number
  basicLastIndexOf(object: T): number
  basicContains(object: T): boolean
  basicContainsAll(collection: Iterable<T>): boolean
  basicRemove(object: T, notifications: NotificationChain | null): NotificationChain | null
  basicAdd(object: T, notifications: NotificationChain | null): NotificationChain | null
  addUnique(object: T): void
  addUnique(index: number, object: T): void
  addAllUnique(collection: Collection<T>): boolean
  addAllUnique(index: number, collection: Collection<T>): boolean
  setUnique(index: number, object: T): T
}
export namespace InternalEList { export interface Unsettable<T> extends InternalEList<T> { isSet(): boolean; unset(): void } }
