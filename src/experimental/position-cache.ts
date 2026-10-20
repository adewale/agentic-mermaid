import { estimatedResidency } from './cache-residency.ts'
import type { FamilyLayoutResult, FamilyPositionedView } from '../agent/families.ts'
import { graphLayoutDecisionsOf, transferGraphLayoutDecisions } from '../layout/backend.ts'
import { transferRetainedPixelText } from '../shared/prepared-text.ts'
import { WeightedLru } from './weighted-lru.ts'
import { observeCache } from '../performance-observations.ts'
import type { NativeDrawing } from '../scene/native-drawing.ts'
const familyIds = new WeakMap<object, number>()
let nextFamilyId = 0
interface PositionedSnapshot { result: FamilyLayoutResult; projection?: FamilyPositionedView; ownedNative?: true; drawing?: NativeDrawing }
const nativeOwners = new WeakMap<FamilyLayoutResult, { key: string; snapshot: PositionedSnapshot; request: object }>()
const MAX_WEIGHT = 16 * 1024 * 1024
const results = new WeightedLru<string, PositionedSnapshot>(128, MAX_WEIGHT)
const retainedResults = new WeakSet<object>()
function isolatedKey(family: object, key: string): string {
  let id = familyIds.get(family)
  if (id === undefined) { id = nextFamilyId++; familyIds.set(family, id) }
  return `${id}:${key}`
}
/** Copies remain private until provenance needed by prepared text is restored. */
export function clonePositioned<T>(source: T): T {
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
/** Membership records actual private cache geometry, including its operation
 * wrappers, never a caller brand. */
export function isRetainedPositionedSnapshot(result: object): boolean { return retainedResults.has(result) }
export function cachedPositioned(family: object, key: string, alreadyObserved = false): FamilyLayoutResult | undefined {
  const value = results.get(isolatedKey(family, key))
  if (!alreadyObserved) observeCache('positioned-layout', value ? 'hit' : 'miss')
  if (!value) return undefined
  const copy = clonePositioned(value.result)
  transferGraphLayoutDecisions(value.result, copy)
  return copy
}
/** Only the private native renderer may borrow this certified snapshot. */
export function borrowedPositioned(family: object, key: string, nativeSvgRequest?: object): PositionedSnapshot | undefined {
  const isolated = isolatedKey(family, key)
  const value = results.get(isolated)
  observeCache('positioned-layout', value ? 'hit' : 'miss')
  if (nativeSvgRequest && value?.ownedNative) {
    // The operation owns this wrapper. A retained request cannot keep the
    // cache graph alive through its proof after eviction or an early exit.
    const result = Object.freeze({ ...value.result })
    nativeOwners.set(result, { key: isolated, snapshot: value, request: nativeSvgRequest })
    retainedResults.add(result)
    return { ...value, result }
  }
  return value
}
export function retainPositioned(family: object, key: string, value: FamilyLayoutResult, projection?: FamilyPositionedView): void {
  retainSnapshot(family, key, value, projection, true)
}
/** Fresh original Flowchart/State/Sequence geometry, private native SVG only. */
export function retainOwnedNativeSvgPositioned(family: object, key: string, value: FamilyLayoutResult, projection?: FamilyPositionedView): void {
  retainSnapshot(family, key, value, projection, false)
}
function retainSnapshot(family: object, key: string, value: FamilyLayoutResult, projection: FamilyPositionedView | undefined, copy: boolean): void {
  const snapshot: PositionedSnapshot = { result: value, ...(projection ? { projection } : {}), ...(!copy ? { ownedNative: true as const } : {}) }
  const weight = key.length * 2 + estimatedResidency([snapshot, graphLayoutDecisionsOf(value)], MAX_WEIGHT) + 1024
  if (weight > MAX_WEIGHT) { observeCache('positioned-layout', 'store-skipped', 'weight-limit'); return }
  let retained = snapshot
  if (copy) {
    try { retained = clonePositioned(snapshot) } catch (error) {
      // C4 identity planners carry callbacks. Keep the complete authoritative
      // artifact uncached when a private snapshot cannot preserve its evidence.
      if (error instanceof Error && error.name === 'DataCloneError') { observeCache('positioned-layout', 'store-skipped', 'uncloneable'); return }
      throw error
    }
    transferGraphLayoutDecisions(value, retained.result)
  }
  results.set(isolatedKey(family, key), retained, weight)
  retainedResults.add(retained.result)
}

/** The request acquired this entry through the full private positioning key.
 * A public layout copy or arbitrary request/layout pair cannot inherit it. */
export function cachedNativeDrawing(request: object, layout: FamilyLayoutResult, originalProducer: boolean): NativeDrawing | undefined {
  const entry = nativeOwners.get(layout)
  if (!originalProducer) {
    nativeOwners.delete(layout)
    return undefined
  }
  return entry?.request === request && results.get(entry.key) === entry.snapshot ? entry.snapshot.drawing : undefined
}

/** Charge the drawing and paint graph to the existing positioning budget.
 * Only a repeated private positioning hit enrolls a request: fresh sources
 * pay no drawing-residency walk. Oversized additions retain geometry alone. */
export function retainNativeDrawing(request: object, layout: FamilyLayoutResult, drawing: NativeDrawing, hiddenEvidence: () => unknown): void {
  const entry = nativeOwners.get(layout)
  if (!entry || entry.request !== request || results.get(entry.key) !== entry.snapshot) return
  const combined = { ...entry.snapshot, drawing }
  // Paint certification's private WeakMaps also retain source fields and
  // world matrices. Count those aliases in the same graph, without storing
  // the temporary inventory or pulling Scene code into this cache module.
  const weight = entry.key.length * 2 + estimatedResidency([combined, hiddenEvidence()], MAX_WEIGHT) + 1024
  if (weight > MAX_WEIGHT) { observeCache('native-drawing', 'store-skipped', 'weight-limit'); return }
  entry.snapshot.drawing = drawing
  results.set(entry.key, entry.snapshot, weight)
}
