/** Qualify at existing constructor freeze sites, bottom-up. Unknown mutable
 * fields and accessors cannot become authority through a shallow freeze. */
export function createImmutableParts(known: (value: object) => boolean = () => false) {
  const parts = new WeakSet<object>()
  const has = (value: object): boolean => parts.has(value) || known(value)
  const freeze = <T extends object>(value: T): Readonly<T> => {
    Object.freeze(value)
    if (Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!, child = descriptor.value
      return 'value' in descriptor && (child === null || typeof child !== 'object' && typeof child !== 'function' || has(child))
    })) parts.add(value)
    return value
  }
  return { has, freeze }
}
