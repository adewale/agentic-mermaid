/* SPDX-License-Identifier: EPL-2.0 */
import type { Iterator } from '../util/Iterator.ts'
export interface JavaIterable<T> extends Iterable<T> { iterator(): Iterator<T> }
