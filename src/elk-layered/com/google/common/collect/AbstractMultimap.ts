/*
 * Copyright (C) 2012 The Guava Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* TypeScript translation: EPL-2.0. Guava 31.1-jre GWT-compatible source.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { JavaObject } from '../../../../java/lang/Object.ts'
import type { AbstractSet } from '../../../../java/util/AbstractSet.ts'
import type { Multimap } from './Multimap.ts'

export abstract class AbstractMultimap<K, V> extends JavaObject implements Multimap<K, V> {
  abstract size(): number
  abstract containsKey(key: K): boolean
  abstract containsValue(value: V): boolean
  abstract get(key: K): AbstractSet<V>
  abstract removeAll(key: K): AbstractSet<V>
  abstract clear(): void
  isEmpty(): boolean { return this.size() === 0 }
  containsEntry(key: K, value: V): boolean { return this.containsKey(key) && this.get(key).contains(value) }
  remove(key: K, value: V): boolean { return this.containsKey(key) && this.get(key).remove(value) }
  put(key: K, value: V): boolean { return this.get(key).add(value) }
  putAll(key: K, values: Iterable<V>): boolean {
    const collection = values as Iterable<V> & { isEmpty?: () => boolean }
    if (typeof collection.isEmpty === 'function') return !collection.isEmpty() && this.get(key).addAll(collection)
    const iterator = values[Symbol.iterator]()
    let value = iterator.next()
    if (value.done) return false
    const target = this.get(key)
    let changed = false
    do { changed = target.add(value.value) || changed; value = iterator.next() } while (!value.done)
    return changed
  }
  replaceValues(key: K, values: Iterable<V>): AbstractSet<V> {
    const result = this.removeAll(key)
    this.putAll(key, values)
    return result
  }
}
