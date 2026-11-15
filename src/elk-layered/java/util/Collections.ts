/* SPDX-License-Identifier: EPL-2.0 */
import { JavaObject } from '../lang/Object.ts'
import { MapView, type SimpleEntry } from './HashMap.ts'
import type { JavaMap } from './Map.ts'

class EmptyMap<K, V> extends JavaObject implements JavaMap<K, V> {
  get(_key: K): null { return null }
  put(_key: K, _value: V): never { throw new Error('Unsupported operation on an empty map') }
  remove(_key: K): null { return null }
  containsKey(_key: K): boolean { return false }
  size(): number { return 0 }
  isEmpty(): boolean { return true }
  clear(): void {}
  entrySet(): MapView<SimpleEntry<K, V>> {
    return new MapView(() => ({ hasNext: () => false, next: () => { throw new Error('No such element') }, remove: () => { throw new Error('No current element') } }), () => 0)
  }
  override hashCode(): number { return 0 }
}

export class Collections {
  private static readonly EMPTY_MAP = new EmptyMap<unknown, unknown>()
  static emptyMap<K, V>(): JavaMap<K, V> { return Collections.EMPTY_MAP as JavaMap<K, V> }
}
