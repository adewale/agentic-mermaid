/*
 * Copyright 2008 Google Inc. (GWT LinkedHashSet operations).
 * Original GWT portions: Apache-2.0, http://www.apache.org/licenses/LICENSE-2.0.
 * TypeScript translation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { HashSet } from './HashSet.ts'
import { LinkedHashMap } from './LinkedHashMap.ts'

export class LinkedHashSet<T> extends HashSet<T> {
  constructor(source?: Iterable<T> | number) {
    super()
    this.map = new LinkedHashMap(typeof source === 'number' ? source : undefined)
    if (source !== undefined && typeof source !== 'number') this.addAll(source)
  }
  override clone(): LinkedHashSet<T> { return new LinkedHashSet(this) }
}
