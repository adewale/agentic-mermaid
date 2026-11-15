/* SPDX-License-Identifier: EPL-2.0 */
const JAVA_OBJECT = Symbol('java.lang.Object')
import type { Class } from './Class.ts'
let nextHash = 0

export class JavaObject {
  readonly [JAVA_OBJECT] = true

  equals(other: unknown): boolean { return this === other }
  hashCode(): number { return getObjectIdentityHashCode(this) }
  getClass(): Class<unknown> { return (require('./Class.ts') as { Class: { of(constructor: Function & { prototype: unknown }): Class<unknown> } }).Class.of(this.constructor) }
  toString(): string { return this.getClass().getName() + '@' + (this.hashCode() >>> 0).toString(16) }
}

export function getObjectIdentityHashCode(object: object): number {
  const current = (object as { $H?: number }).$H
  if (current) return current
  const hash = ++nextHash
  Reflect.set(object, '$H', hash)
  return hash
}

export function javaEquals(left: unknown, right: unknown): boolean {
  if (left == null) return right == null
  if (left instanceof JavaObject) return left.equals(right)
  return left === right
}

export function javaHashCode(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'string') {
    let hash = 0
    for (let index = 0; index < value.length; index++) hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0
    return hash
  }
  if (typeof value === 'number') return Math.max(-2147483648, Math.min(2147483647, value)) | 0
  if (typeof value === 'boolean') return value ? 1231 : 1237
  if (value instanceof JavaObject) return value.hashCode()
  return getObjectIdentityHashCode(value as object)
}
