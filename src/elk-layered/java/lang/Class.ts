/* SPDX-License-Identifier: EPL-2.0 */
import { JavaObject } from './Object.ts'

const CLASS = Symbol('java.lang.Class')
type Constructor<T> = Function & { prototype: T }

export class Class<T> extends JavaObject {
  private constructor(readonly constructorFunction: Constructor<T>) { super() }

  static of<T>(constructor: Constructor<T>): Class<T> {
    const registered = constructor as Constructor<T> & { [CLASS]?: Class<T> }
    if (!Object.hasOwn(registered, CLASS)) Object.defineProperty(registered, CLASS, { value: new Class(constructor) })
    return registered[CLASS]!
  }

  getSimpleName(): string { return this.constructorFunction.name }

  getEnumConstants(): T[] {
    return (this.constructorFunction as Constructor<T> & { values(): T[] }).values()
  }
}
