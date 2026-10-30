/** Qualify at existing constructor freeze sites, bottom-up. Unknown mutable
 * fields and accessors cannot become authority through a shallow freeze. */
export function createImmutableParts(known: (value: object) => boolean = () => false, knownOwned: (value: object) => boolean = () => false) {
  const parts = new WeakSet<object>(), ownedParts = new WeakSet<object>()
  const has = (value: object): boolean => parts.has(value) || known(value)
  const hasOwned = (value: object): boolean => ownedParts.has(value) || knownOwned(value)
  const qualify = <T extends object>(value: T, allocationOwned: boolean): Readonly<T> => {
    Object.freeze(value)
    let owned = allocationOwned
    const immutable = Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) { owned = false; return false }
      const child = descriptor.value
      const scalar = child === null || typeof child !== 'object' && typeof child !== 'function'
      if (owned && !scalar && !hasOwned(child)) owned = false
      return scalar || has(child)
    })
    if (immutable) parts.add(value)
    if (owned) ownedParts.add(value)
    return value
  }
  const freeze = <T extends object>(value: T): Readonly<T> => qualify(value, false)
  // Only call at a known local allocation. Caller-dispatched map results and
  // other supplied objects may use freeze, but cannot mint this provenance.
  const freezeOwned = <T extends object>(value: T): Readonly<T> => qualify(value, true)
  return { has, freeze, hasOwned, freezeOwned }
}
