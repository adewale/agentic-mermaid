/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { JavaObject, javaHashCode } from '../../../../../java/lang/Object.ts'
import { isCloneable } from '../../../../../java/lang/Cloneable.ts'
import type { Comparable } from '../../../../../java/lang/Comparable.ts'
import { ElkReflect } from '../util/ElkReflect.ts'
import { IProperty } from './IProperty.ts'

export class Property<T> extends JavaObject implements IProperty<T>, Comparable<IProperty<unknown>> {
  static readonly NEGATIVE_INFINITY: Comparable<unknown> & { toString(): string } = { compareTo: () => -1, toString: () => '-\u221e' }
  static readonly POSITIVE_INFINITY: Comparable<unknown> & { toString(): string } = { compareTo: () => 1, toString: () => '+\u221e' }
  readonly [IProperty] = true
  private readonly id: string
  private defaultValue: T = null as T
  private lowerBound: Comparable<T> = Property.NEGATIVE_INFINITY
  private upperBound: Comparable<T> = Property.POSITIVE_INFINITY

  constructor(theid: string)
  constructor(theid: string, thedefaultValue: T)
  constructor(other: IProperty<T>, thedefaultValue: T)
  constructor(theid: string, thedefaultValue: T, thelowerBound: Comparable<T> | null)
  constructor(theid: string, thedefaultValue: T, thelowerBound: Comparable<T> | null, theupperBound: Comparable<T> | null)
  constructor(first: string | IProperty<T>, thedefaultValue?: T, thelowerBound?: Comparable<T> | null, theupperBound?: Comparable<T> | null) {
    super()
    this.id = typeof first === 'string' ? first : first.getId()
    if (arguments.length > 1) this.defaultValue = thedefaultValue!
    if (thelowerBound != null) this.lowerBound = thelowerBound
    if (theupperBound != null) this.upperBound = theupperBound
  }

  override equals(obj: unknown): boolean {
    return obj !== null && typeof obj === 'object' && (obj as IProperty<unknown>)[IProperty] === true && this.id === (obj as IProperty<unknown>).getId()
  }
  override hashCode(): number { return javaHashCode(this.id) }
  override toString(): string { return this.id }

  getDefault(): T {
    if (isCloneable(this.defaultValue)) {
      const clone = ElkReflect.clone(this.defaultValue)
      if (clone === null) throw new Error(`Couldn't clone property '${this.id}'. Make sure its type is registered with the ElkReflect utility class.`)
      return clone
    }
    return this.defaultValue
  }
  getId(): string { return this.id }
  getLowerBound(): Comparable<T> { return this.lowerBound }
  getUpperBound(): Comparable<T> { return this.upperBound }
  compareTo(other: IProperty<unknown>): number {
    const otherId = other.getId()
    const length = Math.min(this.id.length, otherId.length)
    for (let index = 0; index < length; index++) {
      const difference = this.id.charCodeAt(index) - otherId.charCodeAt(index)
      if (difference !== 0) return difference
    }
    return this.id.length - otherId.length
  }

}
