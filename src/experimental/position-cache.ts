import type { FamilyLayoutResult } from '../agent/families.ts'
import { transferRetainedPixelText } from '../shared/prepared-text.ts'
import { WeightedLru } from './weighted-lru.ts'
const familyIds = new WeakMap<object, number>()
let nextFamilyId = 0
const results = new WeightedLru<string, FamilyLayoutResult>(128, 16 * 1024 * 1024)
function isolatedKey(family: object, key: string): string {
  let id = familyIds.get(family)
  if (id === undefined) { id = nextFamilyId++; familyIds.set(family, id) }
  return `${id}:${key}`
}
/** Copies remain private until provenance needed by prepared text is restored. */
function clonePositioned<T>(source: T): T {
  const copy = structuredClone(source)
  const seen = new WeakSet<object>()
  const visit = (a: unknown, b: unknown): void => {
    if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object' || seen.has(a)) return
    seen.add(a); transferRetainedPixelText(a, b)
    if (a instanceof Map && b instanceof Map) {
      const av = [...a.values()], bv = [...b.values()]; av.forEach((value, i) => visit(value, bv[i]))
    } else if (a instanceof Set && b instanceof Set) {
      const av = [...a], bv = [...b]; av.forEach((value, i) => visit(value, bv[i]))
    } else for (const key of Object.keys(a)) visit((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  }
  visit(source, copy)
  return copy
}
export function cachedPositioned(family: object, key: string): FamilyLayoutResult | undefined {
  const value = results.get(isolatedKey(family, key))
  return value ? clonePositioned(value) : undefined
}
export function retainPositioned(family: object, key: string, value: FamilyLayoutResult): void {
  // Conservative weighted estimate; the cache never retains caller objects.
  const weight = key.length * 2 + JSON.stringify(value).length * 4 + 1024
  if (weight <= 16 * 1024 * 1024) results.set(isolatedKey(family, key), clonePositioned(value), weight)
}
