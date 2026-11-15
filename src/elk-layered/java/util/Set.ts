/* SPDX-License-Identifier: EPL-2.0 */
export const JavaSet = Symbol('java.util.Set')

export interface JavaSet<T> extends Iterable<T> {
  readonly [JavaSet]: true
  size(): number
  contains(value: T): boolean
}

export function isJavaSet<T>(value: unknown): value is JavaSet<T> {
  return value !== null && typeof value === 'object' && (value as { [JavaSet]?: boolean })[JavaSet] === true
}
