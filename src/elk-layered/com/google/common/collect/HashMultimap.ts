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
import { HashMap } from '../../../../java/util/HashMap.ts'
import { HashSet } from '../../../../java/util/HashSet.ts'
import { AbstractSetMultimap } from './AbstractSetMultimap.ts'

export class HashMultimap<K, V> extends AbstractSetMultimap<K, V> {
  private constructor(expectedKeys: number, private readonly expectedValuesPerKey: number) {
    super(new HashMap<K, AbstractSet<V>>(capacity(expectedKeys)))
    if (expectedValuesPerKey < 0) throw new Error('expectedValuesPerKey cannot be negative')
  }
  static create<K, V>(expectedKeys = 12, expectedValuesPerKey = 2): HashMultimap<K, V> { return new HashMultimap(expectedKeys, expectedValuesPerKey) }
  createCollection(): AbstractSet<V> { return new HashSet<V>(capacity(this.expectedValuesPerKey)) }
}

function capacity(expectedSize: number): number {
  if (expectedSize < 0) throw new Error('expectedSize cannot be negative')
  if (expectedSize < 3) return expectedSize + 1
  if (expectedSize < 0x40000000) return Math.trunc(Math.fround(Math.fround(Math.fround(expectedSize) / Math.fround(0.75)) + Math.fround(1)))
  return 0x7fffffff
}
