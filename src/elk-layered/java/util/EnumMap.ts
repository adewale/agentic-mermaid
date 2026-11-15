/* SPDX-License-Identifier: EPL-2.0 */
import type { Enum } from '../lang/Enum.ts'
import type { Class } from '../lang/Class.ts'
import { JavaObject } from '../lang/Object.ts'

export class EnumMap<K extends Enum<K>, V> extends JavaObject {
  private readonly values: (V | null)[]
  constructor(type: Class<K>) { super(); this.values = new Array<V | null>(type.getEnumConstants().length).fill(null) }
  get(key: K): V | null { return this.values[key.ordinal()] ?? null }
  put(key: K, value: V): V | null { const previous = this.get(key); this.values[key.ordinal()] = value; return previous }
}
