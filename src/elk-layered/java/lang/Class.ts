/* SPDX-License-Identifier: EPL-2.0 */
import { JavaObject } from './Object.ts'
import { Enum } from './Enum.ts'

const CLASS = Symbol('java.lang.Class')
type Constructor<T> = Function & { prototype: T }

export class Class<T> extends JavaObject {
  static readonly javaName = 'java.lang.Class'
  private static readonly interfaces = new Map<symbol, Class<unknown>>()
  private constructor(readonly constructorFunction: Constructor<T>) { super() }

  static of<T>(constructor: Constructor<T>): Class<T> {
    const registered = constructor as Constructor<T> & { [CLASS]?: Class<T> }
    if (!Object.hasOwn(registered, CLASS)) Object.defineProperty(registered, CLASS, { value: new Class(constructor) })
    return registered[CLASS]!
  }

  static interfaceOf<T>(type: symbol): Class<T> {
    let clazz = Class.interfaces.get(type)
    if (clazz === undefined) {
      const constructor = function JavaInterface(): never { throw new TypeError('Cannot instantiate interface ' + type.description) }
      Object.defineProperty(constructor, 'name', { value: type.description?.split('.').at(-1) ?? '' })
      Object.defineProperty(constructor, 'javaName', { value: type.description ?? '' })
      clazz = new Class(constructor as Constructor<unknown>)
      Class.interfaces.set(type, clazz)
    }
    return clazz as Class<T>
  }

  getSimpleName(): string { return this.constructorFunction.name }
  getName(): string { return Object.hasOwn(this.constructorFunction, 'javaName') ? (this.constructorFunction as Constructor<T> & { javaName: string }).javaName : this.constructorFunction.name }
  isEnum(): boolean { return this.constructorFunction.prototype instanceof Enum }

  getEnumConstants(): T[] {
    return (this.constructorFunction as Constructor<T> & { values(): T[] }).values()
  }
}
