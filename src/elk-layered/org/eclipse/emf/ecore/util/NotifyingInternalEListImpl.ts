/*******************************************************************************
 * Copyright (c) 2007-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { AbstractList } from '../../../../../java/util/AbstractList.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import type { Iterator, ListIterator } from '../../../../../java/util/Iterator.ts'
import { NotifyingListImpl } from '../../common/notify/impl/NotifyingListImpl.ts'
import type { InternalEList } from './InternalEList.ts'

export class NotifyingInternalEListImpl<T> extends NotifyingListImpl<T> implements InternalEList<T> {
  constructor(source?: number | Collection<T>) { if (source === undefined) super(); else super(source) }
  basicContains(object: T): boolean { return super.contains(object) }
  basicContainsAll(collection: Iterable<T>): boolean { return super.containsAll(collection) }
  basicIndexOf(object: T): number { return super.indexOf(object) }
  basicLastIndexOf(object: T): number { return super.lastIndexOf(object) }
  basicToArray(): T[]
  basicToArray(array: T[]): T[]
  basicToArray(array?: T[]): T[] { return array === undefined ? super.toArray() : super.toArray(array) }
  public override basicGet(index: number): T { return super.basicGet(index) }
  public override basicList(): AbstractList<T> { return super.basicList() }
  public override basicIterator(): Iterator<T> { return super.basicIterator() }
  public override basicListIterator(index = 0): ListIterator<T> { return super.basicListIterator(index) }
}
