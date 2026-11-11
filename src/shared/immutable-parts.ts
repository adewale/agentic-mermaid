/** Qualify at existing constructor freeze sites, bottom-up. Unknown mutable
 * fields and accessors cannot become authority through a shallow freeze. */
export function createImmutableParts(known: (value: object) => boolean = () => false) {
  // Keep ownership on each value rather than retaining a weak table's capacity.
  class OwnedPart extends class { constructor(value: object) { return value } } {
    #owned: undefined
    static has(value: unknown): boolean {
      return (typeof value === 'object' && value !== null || typeof value === 'function') && #owned in value
    }
  }
  const stamp = (value: object): void => {
    // Qualification can reenter this constructor through the known callback.
    if (!OwnedPart.has(value)) new OwnedPart(value)
  }
  const has = (value: object): boolean => OwnedPart.has(value) || known(value)
  const freeze = <T extends object>(value: T): Readonly<T> => {
    if (OwnedPart.has(value)) return value
    Object.freeze(value)
    if (Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!, child = descriptor.value
      return 'value' in descriptor && (child === null || typeof child !== 'object' && typeof child !== 'function' || has(child))
    })) stamp(value)
    return value
  }
  // This constructor owns all fields. No supplied object can acquire immutable
  // authority through the scalar path, including a transferred text brand.
  const sourceSpan = (text: string, sourceStart: number, sourceEnd: number) => {
    if (typeof text !== 'string' || typeof sourceStart !== 'number' || typeof sourceEnd !== 'number') throw new TypeError('Source spans require scalar text and offsets')
    const span = Object.freeze({ text, sourceStart, sourceEnd })
    stamp(span)
    return span
  }
  return { has, freeze, sourceSpan }
}
