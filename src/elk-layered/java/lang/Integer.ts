/* SPDX-License-Identifier: EPL-2.0 */
import { JavaObject } from './Object.ts'
import type { Comparable } from './Comparable.ts'
import { NumberFormatException } from './Double.ts'

export class Integer extends JavaObject implements Comparable<Integer> {
  static readonly MIN_VALUE = -2147483648
  static readonly MAX_VALUE = 2147483647
  private static readonly boxedValues: Integer[] = Array.from({ length: 256 }, (_, index) => new Integer(index - 128))
  constructor(private readonly value: number) { super() }
  static valueOf(value: number | string, radix = 10): Integer { const integer = typeof value === 'string' ? Integer.parseInt(value, radix) : value; return integer >= -128 && integer <= 127 ? Integer.boxedValues[integer + 128]! : new Integer(integer) }
  static parseInt(value: string, radix = 10): number {
    if (value === null) throw new NumberFormatException('null')
    if (radix < 2 || radix > 36) throw new NumberFormatException('radix ' + radix + ' out of range')
    const startIndex = value.length > 0 && (value.charAt(0) === '-' || value.charAt(0) === '+') ? 1 : 0
    for (let i = startIndex; i < value.length; i++) {
      const code = value.charCodeAt(i)
      const digit = code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 122 ? code - 97 + 10 : code >= 65 && code <= 90 ? code - 65 + 10 : -1
      if (digit === -1 || digit >= radix) throw new NumberFormatException('For input string: "' + value + '"')
    }
    const result = globalThis.parseInt(value, radix)
    if (Number.isNaN(result) || result < Integer.MIN_VALUE || result > Integer.MAX_VALUE) throw new NumberFormatException('For input string: "' + value + '"')
    return result | 0
  }
  intValue(): number { return this.value }
  doubleValue(): number { return this.value }
  valueOf(): number { return this.value }
  floatValue(): number { return Math.fround(this.value) }
  compareTo(other: Integer): number { return this.value < other.value ? -1 : this.value > other.value ? 1 : 0 }
  override equals(other: unknown): boolean { return other instanceof Integer && this.value === other.value }
  override hashCode(): number { return this.value }
  override toString(): string { return String(this.value) }
  static reverse(value: number): number {
    let result = 0
    for (let bit = 0; bit < 32; bit++) {
      result = (result << 1) | (value & 1)
      value >>>= 1
    }
    return result
  }
}
