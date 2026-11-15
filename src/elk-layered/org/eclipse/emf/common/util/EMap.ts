/* SPDX-License-Identifier: EPL-2.0 */
import type { Collection } from '../../../../../java/util/Collection.ts'
import type { JavaMap, Entry } from '../../../../../java/util/Map.ts'

export interface EMap<K, V> extends Collection<Entry<K, V>> {
  map(): JavaMap<K, V>
}
