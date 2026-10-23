import { estimatedResidency } from './cache-residency.ts'
import type { FamilyLayoutResult, FamilyPositionedView } from '../agent/families.ts'
import { transferRetainedPixelText } from '../shared/prepared-text.ts'
import { WeightedLru } from './weighted-lru.ts'
import { observeCache } from '../performance-observations.ts'
const familyIds = new WeakMap<object, number>()
let nextFamilyId = 0
interface PositionedSnapshot { result: FamilyLayoutResult; projection?: FamilyPositionedView }
const MAX_WEIGHT = 16 * 1024 * 1024
const results = new WeightedLru<string, PositionedSnapshot>(128, MAX_WEIGHT)
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
      const copies = b.entries()
      for (const [key, value] of a) {
        const [copyKey, copyValue] = copies.next().value!
        visit(key, copyKey); visit(value, copyValue)
      }
    } else if (a instanceof Set && b instanceof Set) {
      const copies = b.values()
      for (const value of a) visit(value, copies.next().value)
    } else for (const key of Object.keys(a)) visit((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  }
  visit(source, copy)
  return copy
}
export function cachedPositioned(family: object, key: string): FamilyLayoutResult | undefined {
  const value = results.get(isolatedKey(family, key))
  observeCache('positioned-layout', value ? 'hit' : 'miss')
  return value ? clonePositioned(value.result) : undefined
}
/** Only the private native renderer may borrow this certified snapshot. */
export function borrowedPositioned(family: object, key: string): PositionedSnapshot | undefined {
  const value = results.get(isolatedKey(family, key))
  observeCache('positioned-layout', value ? 'hit' : 'miss')
  return value
}
export function retainPositioned(family: object, key: string, value: FamilyLayoutResult, projection?: FamilyPositionedView): void {
  const snapshot: PositionedSnapshot = { result: value, ...(projection ? { projection } : {}) }
  const weight = key.length * 2 + estimatedResidency(snapshot, MAX_WEIGHT) + 1024
  if (weight > MAX_WEIGHT) { observeCache('positioned-layout', 'store-skipped', 'weight-limit'); return }
  let copy: PositionedSnapshot
  try { copy = clonePositioned(snapshot) } catch (error) {
    // C4 identity planners carry callbacks. Keep the complete authoritative
    // artifact uncached when a private snapshot cannot preserve its evidence.
    if (error instanceof Error && error.name === 'DataCloneError') { observeCache('positioned-layout', 'store-skipped', 'uncloneable'); return }
    throw error
  }
  results.set(isolatedKey(family, key), copy, weight)
}
