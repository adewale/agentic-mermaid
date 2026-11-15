/* SPDX-License-Identifier: EPL-2.0 */
import { Cloneable } from '../lang/Cloneable.ts'
import { AbstractSet } from './AbstractSet.ts'
import { HashMap } from './HashMap.ts'
import type { Iterator } from './Iterator.ts'

export class HashSet<T> extends AbstractSet<T> implements Cloneable {
  readonly [Cloneable] = true
  protected map: HashMap<T, boolean>

  constructor(source?: Iterable<T> | number) {
    super()
    this.map = new HashMap(typeof source === 'number' ? source : undefined)
    if (source !== undefined && typeof source !== 'number') this.addAll(source)
  }

  iterator(): Iterator<T> { return this.map.keySet().iterator() }
  size(): number { return this.map.size() }
  contains(value: T): boolean { return this.map.containsKey(value) }
  add(value: T): boolean { return this.map.put(value, true) === null }
  remove(value: T): boolean { return this.map.remove(value) !== null }
  clear(): void { this.map.clear() }
  clone(): HashSet<T> { return new HashSet(this) }
}
