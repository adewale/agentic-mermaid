/* SPDX-License-Identifier: EPL-2.0 */
import type { Iterator } from './Iterator.ts'

export interface Collection<T> extends Iterable<T> {
  size(): number
  iterator(): Iterator<T>
  toArray(): T[]
  toArray(array: T[]): T[]
}
