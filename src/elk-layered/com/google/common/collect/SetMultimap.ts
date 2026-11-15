/*
 * Copyright (C) 2007 The Guava Authors
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
import type { AbstractSet } from '../../../../java/util/AbstractSet.ts'
import type { Multimap } from './Multimap.ts'

export interface SetMultimap<K, V> extends Multimap<K, V> {
  get(key: K): AbstractSet<V>
  removeAll(key: K): AbstractSet<V>
  replaceValues(key: K, values: Iterable<V>): AbstractSet<V>
}
