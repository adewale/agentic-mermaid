/* SPDX-License-Identifier: EPL-2.0 */
export const JavaList = Symbol('java.util.List')
export interface JavaList<T> extends Iterable<T> {
  readonly [JavaList]: true
  size(): number
  get(index: number): T
}
export function isJavaList(value: unknown): value is JavaList<unknown> { return value !== null && typeof value === 'object' && (value as JavaList<unknown>)[JavaList] === true }
