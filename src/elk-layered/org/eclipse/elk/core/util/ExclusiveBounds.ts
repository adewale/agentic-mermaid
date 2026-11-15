/*******************************************************************************
 * Copyright (c) 2016 TypeFox and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Comparable } from '../../../../../java/lang/Comparable.ts'
import { Double } from '../../../../../java/lang/Double.ts'
import { JavaObject } from '../../../../../java/lang/Object.ts'

export class ExclusiveBounds {
  private constructor() {}
  static greaterThan(exclusiveLowerBound: number): Comparable<number> { return new ExclusiveBounds.ExclusiveLowerBound(exclusiveLowerBound) }
  static lessThan(exclusiveUpperBound: number): Comparable<number> { return new ExclusiveBounds.ExclusiveUpperBound(exclusiveUpperBound) }
}

export namespace ExclusiveBounds {
  export class ExclusiveLowerBound extends JavaObject implements Comparable<number> {
    constructor(private readonly exclusiveLowerBound: number) { super() }
    compareTo(x: number): number { return this.exclusiveLowerBound < x ? -1 : 1 }
    override equals(obj: unknown): boolean { return obj instanceof ExclusiveLowerBound && this.exclusiveLowerBound === obj.exclusiveLowerBound }
    override hashCode(): number { return Double.hashCode(this.exclusiveLowerBound) }
    override toString(): string { return this.exclusiveLowerBound + ' (exclusive)' }
  }
  export class ExclusiveUpperBound extends JavaObject implements Comparable<number> {
    constructor(private readonly exclusiveUpperBound: number) { super() }
    compareTo(x: number): number { return this.exclusiveUpperBound > x ? 1 : -1 }
    override equals(obj: unknown): boolean { return obj instanceof ExclusiveUpperBound && this.exclusiveUpperBound === obj.exclusiveUpperBound }
    override hashCode(): number { return Double.hashCode(this.exclusiveUpperBound) }
    override toString(): string { return this.exclusiveUpperBound + ' (exclusive)' }
  }
}
