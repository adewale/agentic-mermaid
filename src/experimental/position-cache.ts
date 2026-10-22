import type { FamilyLayoutResult, FamilyPositionedView } from '../agent/families.ts'
import { transferRetainedPixelText } from '../shared/prepared-text.ts'
import { WeightedLru } from './weighted-lru.ts'
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
/** Conservative residency units, including collection contents and aliases.
 * This is an eviction estimate, not a measurement of the engine's heap. */
function snapshotWeight(value: unknown, limit: number): number {
  const seen = new WeakSet<object>()
  let weight = 0
  const visit = (item: unknown): void => {
    if (weight > limit) return
    if (typeof item === 'string') { weight += item.length * 4 + 16; return }
    if (item === null || typeof item !== 'object') { weight += 16; return }
    if (seen.has(item)) { weight += 8; return }
    seen.add(item); weight += 64
    if (item instanceof Map) {
      for (const [key, value] of item) { weight += 32; visit(key); visit(value); if (weight > limit) break }
    } else if (item instanceof Set) {
      for (const value of item) { weight += 16; visit(value); if (weight > limit) break }
    } else if (item instanceof ArrayBuffer) weight += item.byteLength
    else if (ArrayBuffer.isView(item)) visit(item.buffer)
    else {
      for (const key of Object.keys(item)) {
        weight += key.length * 2 + 16
        visit((item as Record<string, unknown>)[key])
        if (weight > limit) break
      }
    }
  }
  visit(value)
  return weight
}
export function cachedPositioned(family: object, key: string): FamilyLayoutResult | undefined {
  const value = results.get(isolatedKey(family, key))
  return value ? clonePositioned(value.result) : undefined
}
/** Only the private native renderer may borrow this certified snapshot. */
export function borrowedPositioned(family: object, key: string): PositionedSnapshot | undefined {
  return results.get(isolatedKey(family, key))
}
export function retainPositioned(family: object, key: string, value: FamilyLayoutResult, projection?: FamilyPositionedView): void {
  const snapshot: PositionedSnapshot = { result: value, ...(projection ? { projection } : {}) }
  const weight = key.length * 2 + snapshotWeight(snapshot, MAX_WEIGHT) + 1024
  if (weight > MAX_WEIGHT) return
  let copy: PositionedSnapshot
  try { copy = clonePositioned(snapshot) } catch (error) {
    // C4 identity planners carry callbacks. Keep the complete authoritative
    // artifact uncached when a private snapshot cannot preserve its evidence.
    if (error instanceof Error && error.name === 'DataCloneError') return
    throw error
  }
  results.set(isolatedKey(family, key), copy, weight)
}
