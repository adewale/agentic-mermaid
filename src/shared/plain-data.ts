// Plain-data primitives shared by the contract, schema and admission modules.

/** A plain JSON-style record: a non-array object whose prototype is
 * `Object.prototype` or `null`, so class instances, Maps, Dates and exotic
 * objects are rejected before a validator reads their fields. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Freeze `value` and every object reachable through its own enumerable
 * properties. Already-frozen subtrees are left as they are. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}
