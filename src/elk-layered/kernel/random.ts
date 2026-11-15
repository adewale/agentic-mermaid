/*******************************************************************************
 * TypeScript translation of GWT 2.11 java.util.Random operations used by ELK.
 * Copyright 2009 Google Inc. Original licensed under the Apache License 2.0,
 * https://www.apache.org/licenses/LICENSE-2.0.
 * This translation is made available under the Eclipse Public License 2.0,
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
export class Random {
  private seed = 0n

  constructor(seed: number | bigint) { this.setSeed(seed) }

  setSeed(seed: number | bigint): void {
    this.seed = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n)
  }

  protected next(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & ((1n << 48n) - 1n)
    return Number(this.seed >> BigInt(48 - bits)) | 0
  }

  nextBoolean(): boolean { return this.next(1) !== 0 }

  nextInt(): number
  nextInt(bound: number): number
  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32)
    if (bound <= 0) throw new Error('java.lang.IllegalArgumentException: bound must be positive')
    if ((bound & -bound) === bound) return Math.floor(bound * this.next(31) / 2147483648)
    let bits: number, value: number
    do {
      bits = this.next(31)
      value = bits % bound
    } while (bits - value + bound - 1 < 0)
    return value
  }

  nextDouble(): number { return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992 }
  nextFloat(): number { return Math.fround(this.next(24) / 16777216) }
  nextLong(): bigint { return BigInt.asIntN(64, (BigInt(this.next(32)) << 32n) + BigInt(this.next(32))) }
}
