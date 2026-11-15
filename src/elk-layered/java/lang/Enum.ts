/* SPDX-License-Identifier: EPL-2.0 */
import { JavaObject } from './Object.ts'
import type { Comparable } from './Comparable.ts'
import type { Class } from './Class.ts'
import { IllegalArgumentException } from './IllegalArgumentException.ts'

export abstract class Enum<E extends Enum<E>> extends JavaObject implements Comparable<E> {
  protected constructor(private readonly enumName: string, private readonly enumOrdinal: number) { super() }
  name(): string { return this.enumName }
  ordinal(): number { return this.enumOrdinal }
  compareTo(other: E): number { return this.enumOrdinal - other.ordinal() }
  override toString(): string { return this.enumName }
}

export function enumValueOf<T extends Enum<T>>(enumType: Class<T>, name: string): T {
  if (name === null) throw new TypeError('Name is null')
  for (const value of enumType.getEnumConstants()) if (value.name() === name) return value
  throw new IllegalArgumentException('No enum constant ' + enumType.getSimpleName() + '.' + name)
}
