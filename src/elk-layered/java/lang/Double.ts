/*
 * Java numeric operations required by the ELK translation.
 * Decimal parsing expression: Copyright 2008 Google Inc., Apache-2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 * Translation and other operations: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { JavaObject } from './Object.ts'
import { IllegalArgumentException } from './IllegalArgumentException.ts'
import type { Comparable } from './Comparable.ts'

export class Double extends JavaObject implements Comparable<unknown> {
  constructor(private readonly value: number) { super() }

  static valueOf(value: number | string): Double { return new Double(typeof value === 'string' ? Double.parseDouble(value) : value) }
  doubleValue(): number { return this.value }
  floatValue(): number { return Math.fround(this.value) }
  intValue(): number { return Double.hashCode(this.value) }
  valueOf(): number { return this.value }
  static compare(left: number, right: number): number {
    if (left < right) return -1
    if (left > right) return 1
    if (left === right) return left === 0 ? Double.compare(1 / left, 1 / right) : 0
    return Number.isNaN(left) ? Number.isNaN(right) ? 0 : 1 : -1
  }
  compareTo(other: unknown): number { return Double.compare(this.value, typeof other === 'number' ? other : (other as { doubleValue(): number }).doubleValue()) }
  override toString(): string { return String(this.value) }

  static hashCode(value: number): number {
    // GWT 2.11.0 Double.hashCode uses a Java double-to-int conversion.
    return Math.max(-2147483648, Math.min(2147483647, value)) | 0
  }

  override hashCode(): number { return Double.hashCode(this.value) }
  override equals(other: unknown): boolean { return other instanceof Double && this.value === other.value }

  static parseDouble(value: string): number {
    // The GWT Number parser used by elkjs accepts decimal type suffixes.
    if (!/^\s*[+-]?(NaN|Infinity|((\d+\.?\d*)|(\.\d+))([eE][+-]?\d+)?[dDfF]?)\s*$/.test(value)) {
      throw new NumberFormatException(`For input string: "${value}"`)
    }
    return globalThis.parseFloat(value)
  }

  static isNaN(value: number): boolean { return globalThis.Number.isNaN(value) }
  static isInfinite(value: number): boolean { return !Double.isNaN(value) && !globalThis.Number.isFinite(value) }
}

export class NumberFormatException extends IllegalArgumentException {
  constructor(message = '') { super(message); this.name = 'NumberFormatException' }
  override toString(): string { return `java.lang.NumberFormatException: ${this.message}` }
}
