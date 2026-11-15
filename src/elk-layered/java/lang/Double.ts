/*
 * Java numeric operations required by the ELK translation.
 * Decimal parsing expression: Copyright 2008 Google Inc., Apache-2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 * Translation and other operations: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { JavaObject } from './Object.ts'

export class Double extends JavaObject {
  constructor(private readonly value: number) { super() }

  static valueOf(value: number): Double { return new Double(value) }

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

export class NumberFormatException extends Error {
  override toString(): string { return `java.lang.NumberFormatException: ${this.message}` }
}
