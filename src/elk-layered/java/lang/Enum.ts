/* SPDX-License-Identifier: EPL-2.0 */
import { JavaObject } from './Object.ts'
import type { Comparable } from './Comparable.ts'

export abstract class Enum<E extends Enum<E>> extends JavaObject implements Comparable<E> {
  protected constructor(private readonly enumName: string, private readonly enumOrdinal: number) { super() }
  name(): string { return this.enumName }
  ordinal(): number { return this.enumOrdinal }
  compareTo(other: E): number { return this.enumOrdinal - other.ordinal() }
  override toString(): string { return this.enumName }
}
