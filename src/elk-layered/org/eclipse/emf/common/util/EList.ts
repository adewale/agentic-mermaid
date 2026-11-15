/* SPDX-License-Identifier: EPL-2.0 */
import type { AbstractList } from '../../../../../java/util/AbstractList.ts'

export interface EList<T> extends AbstractList<T> {
  move(newPosition: number, object: T): void
  move(newPosition: number, oldPosition: number): T
}
