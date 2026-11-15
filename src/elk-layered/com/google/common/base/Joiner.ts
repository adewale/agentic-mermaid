/*
 * Copyright 2008 The Guava Authors.
 * Original portions: Apache-2.0, http://www.apache.org/licenses/LICENSE-2.0.
 * TypeScript translation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import type { JavaIterable } from '../../../../java/lang/Iterable.ts'

export class Joiner {
  private constructor(private readonly separator: string) { if (separator === null) throw new TypeError('Null separator') }
  static on(separator: string): Joiner { return new Joiner(separator) }
  join(parts: JavaIterable<unknown>): string {
    const iterator = parts.iterator()
    let builder = ''
    if (iterator.hasNext()) {
      builder += this.toString(iterator.next())
      while (iterator.hasNext()) { builder += this.separator; builder += this.toString(iterator.next()) }
    }
    return builder
  }
  private toString(part: unknown): string { if (part === null) throw new TypeError('Null part'); return String(part) }
}
