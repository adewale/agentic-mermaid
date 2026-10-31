/** Qualify at existing constructor freeze sites, bottom-up. Unknown mutable
 * fields and accessors cannot become authority through a shallow freeze. */
const immutableSet = WeakSet, immutableApply = Reflect.apply
const immutableHas = WeakSet.prototype.has, immutableAdd = WeakSet.prototype.add
const immutableFrozen = Object.isFrozen, immutableKeys = Reflect.ownKeys
const immutableDescriptor = Object.getOwnPropertyDescriptor, immutableOwn = Object.hasOwn

export function createImmutableParts(known: (value: object) => boolean = () => false, knownOwned: (value: object) => boolean = () => false) {
  const parts = new immutableSet<object>(), ownedParts = new immutableSet<object>()
  const has = (value: object): boolean => immutableApply(immutableHas, parts, [value]) || known(value)
  const hasOwned = (value: object): boolean => immutableApply(immutableHas, ownedParts, [value]) || knownOwned(value)
  const qualify = <T extends object>(value: T, allocationOwned: boolean): Readonly<T> => {
    Object.freeze(value)
    // A caller can interpose the freeze operation. Reuse needs the actual
    // sealed data, rather than the operation's name or its returned value.
    if (!immutableFrozen(value)) return value
    let owned = allocationOwned
    const keys = immutableKeys(value)
    for (let index = 0; index < keys.length; index++) {
      const descriptor = immutableDescriptor(value, keys[index]!)
      if (!descriptor || !immutableOwn(descriptor, 'value')) return value
      const child = descriptor.value
      const scalar = child === null || typeof child !== 'object' && typeof child !== 'function'
      if (owned && !scalar && !hasOwned(child)) owned = false
      if (!scalar && !has(child)) return value
    }
    immutableApply(immutableAdd, parts, [value])
    if (owned) immutableApply(immutableAdd, ownedParts, [value])
    return value
  }
  const freeze = <T extends object>(value: T): Readonly<T> => qualify(value, false)
  // Only call at a known local allocation. Caller-dispatched map results and
  // other supplied objects may use freeze, but cannot mint this provenance.
  const freezeOwned = <T extends object>(value: T): Readonly<T> => qualify(value, true)
  return { has, freeze, hasOwned, freezeOwned }
}
