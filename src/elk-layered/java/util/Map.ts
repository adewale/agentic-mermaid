/* SPDX-License-Identifier: EPL-2.0 */
import type { MapView } from './HashMap.ts'

export interface Entry<K, V> {
  getKey(): K
  getValue(): V
  setValue(value: V): V
}

export interface JavaMap<K, V> {
  get(key: K): V | null
  put(key: K, value: V): V | null
  remove(key: K): V | null
  containsKey(key: K): boolean
  size(): number
  isEmpty(): boolean
  clear(): void
  entrySet(): MapView<Entry<K, V>>
}
