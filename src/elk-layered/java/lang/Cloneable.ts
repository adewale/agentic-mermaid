/* SPDX-License-Identifier: EPL-2.0 */
export const Cloneable = Symbol('java.lang.Cloneable')

export interface Cloneable {
  readonly [Cloneable]: true
}

export function isCloneable(value: unknown): value is Cloneable {
  return value !== null && typeof value === 'object' && (value as Partial<Cloneable>)[Cloneable] === true
}
