/* SPDX-License-Identifier: EPL-2.0 */
export interface Comparable<T> {
  compareTo(other: T): number
}
