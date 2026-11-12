/** Qualify at existing constructor freeze sites, bottom-up. Unknown mutable
 * fields and accessors cannot become authority through a shallow freeze. */
const immutableSet = WeakSet, immutableApply = Reflect.apply
const immutableHas = WeakSet.prototype.has, immutableAdd = WeakSet.prototype.add
const immutableFreeze = Object.freeze, immutableFrozen = Object.isFrozen, immutableKeys = Reflect.ownKeys
const immutableDescriptor = Object.getOwnPropertyDescriptor, immutableOwn = Object.hasOwn
const immutablePrototype = Object.getPrototypeOf, immutableArray = Array.isArray
const immutableObjectPrototype = Object.prototype, immutableArrayPrototype = Array.prototype
const supportedPrototype = (value: object, prototype: object | null): boolean => immutableArray(value)
  ? prototype === immutableArrayPrototype : prototype === immutableObjectPrototype || prototype === null

export function createImmutableParts(known: (value: object) => boolean = () => false, knownOwned: (value: object) => boolean = () => false) {
  const parts = new immutableSet<object>(), ownedParts = new immutableSet<object>()
  const has = (value: object): boolean => immutableApply(immutableHas, parts, [value]) || known(value)
  const hasOwned = (value: object): boolean => immutableApply(immutableHas, ownedParts, [value]) || knownOwned(value)
  const qualify = <T extends object>(value: T, allocationOwned: boolean): Readonly<T> => {
    const prototype = immutablePrototype(value)
    Object.freeze(value)
    // A caller can interpose the freeze operation. Reuse needs the actual
    // sealed data, rather than the operation's name or its returned value.
    if (!immutableFrozen(value) || !supportedPrototype(value, prototype) || immutablePrototype(value) !== prototype) return value
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
  // A sealing hook may return a foreign object. Preserve that result, but
  // local-allocation provenance belongs only to the actual closed literal.
  const sourceSpan = (text: string, sourceStart: number, sourceEnd: number) => {
    if (typeof text !== 'string' || typeof sourceStart !== 'number' || typeof sourceEnd !== 'number') throw new TypeError('Source spans require scalar text and offsets')
    const allocated = { text, sourceStart, sourceEnd }
    const span = immutableFreeze(allocated)
    const prototype = immutablePrototype(span), keys = immutableKeys(span)
    let closed = immutableFrozen(span) && supportedPrototype(span, prototype) && (span !== allocated || prototype === immutableObjectPrototype)
    for (let index = 0; closed && index < keys.length; index++) {
      const descriptor = immutableDescriptor(span, keys[index]!)
      if (!descriptor || !immutableOwn(descriptor, 'value')) { closed = false; break }
      const child = descriptor.value
      if (child !== null && (typeof child === 'object' || typeof child === 'function') && !has(child)) closed = false
    }
    if (closed) {
      immutableApply(immutableAdd, parts, [span])
      if (span === allocated && keys.length === 3) {
        const textSlot = immutableDescriptor(span, 'text'), startSlot = immutableDescriptor(span, 'sourceStart'), endSlot = immutableDescriptor(span, 'sourceEnd')
        if (textSlot && immutableOwn(textSlot, 'value') && typeof textSlot.value === 'string'
          && startSlot && immutableOwn(startSlot, 'value') && typeof startSlot.value === 'number'
          && endSlot && immutableOwn(endSlot, 'value') && typeof endSlot.value === 'number') immutableApply(immutableAdd, ownedParts, [span])
      }
    }
    return span
  }
  return { has, freeze, hasOwned, freezeOwned, sourceSpan }
}
