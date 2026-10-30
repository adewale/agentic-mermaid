import { estimatedResidency } from './cache-residency.ts'
import type { FamilyLayoutResult, FamilyPositionedView } from '../agent/families.ts'
import { graphLayoutDecisionsOf, transferGraphLayoutDecisions } from '../layout/decision-evidence.ts'
import { isImmutablePixelTextPart, transferRetainedPixelText } from '../shared/prepared-text.ts'
import { WeightedLru } from './weighted-lru.ts'
import { observeCache } from '../performance-observations.ts'
import type { PaintLayoutCertification } from '../scene/paint-certification.ts'
const familyIds = new WeakMap<object, number>()
let nextFamilyId = 0
interface PositionedSnapshot { result: FamilyLayoutResult; projection?: FamilyPositionedView }
interface NativeResidency { lastUse?: number; locallyRepeated: boolean; drawingWeight?: number; oversized?: boolean }
export interface RetainedNativeDrawing {
  readonly svg: string
  readonly preparedText: boolean
  readonly certification: PaintLayoutCertification
}
const nativeResidency = new WeakMap<PositionedSnapshot, NativeResidency>()
let nativeUse = 0
const nativeOwners = new WeakMap<FamilyLayoutResult, { key: string; snapshot: PositionedSnapshot; request: object }>()
const MAX_WEIGHT = 16 * 1024 * 1024
const DRAWING_WEIGHT = 8 * 1024 * 1024
const DRAWING_REPLACEMENT_AGE = 128
const drawings = new WeightedLru<string, { owner: PositionedSnapshot; drawing: RetainedNativeDrawing }>(128, DRAWING_WEIGHT)
const results = new WeightedLru<string, PositionedSnapshot>(128, MAX_WEIGHT, key => { drawings.delete(key) })
const retainedResults = new WeakSet<object>()
function isolatedKey(family: object, key: string): string {
  let id = familyIds.get(family)
  if (id === undefined) { id = nextFamilyId++; familyIds.set(family, id) }
  return `${id}:${key}`
}
/** Public copies remain independent mutable snapshots. Private native copies
 * may share only constructor-owned immutable text, preserving custody cost. */
export function clonePositioned<T>(source: T, immutableText = false): T {
  const copy = structuredClone(source)
  const seen = new WeakSet<object>()
  const visit = (a: unknown, b: unknown): unknown => {
    if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') return b
    if (immutableText && isImmutablePixelTextPart(a)) return a
    if (seen.has(a)) return b
    seen.add(a); transferRetainedPixelText(a, b)
    if (a instanceof Map && b instanceof Map) {
      const copies = b.entries()
      for (const [key, value] of a) {
        const [copyKey, copyValue] = copies.next().value!
        const retainedKey = visit(key, copyKey), retainedValue = visit(value, copyValue)
        b.delete(copyKey); b.set(retainedKey, retainedValue)
      }
    } else if (a instanceof Set && b instanceof Set) {
      const copies = b.values()
      for (const value of a) { const copied = copies.next().value; b.delete(copied); b.add(visit(value, copied)) }
    } else for (const key of Object.keys(a)) (b as Record<string, unknown>)[key] = visit((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    return b
  }
  return visit(source, copy) as T
}
/** Membership records actual private cache geometry, including its operation
 * wrappers, never a caller brand. */
export function isRetainedPositionedSnapshot(result: object): boolean { return retainedResults.has(result) }
export function cachedPositioned(family: object, key: string, alreadyObserved = false, immutableText = false): FamilyLayoutResult | undefined {
  const value = results.get(isolatedKey(family, key))
  if (!alreadyObserved) observeCache('positioned-layout', value ? 'hit' : 'miss')
  if (!value) return undefined
  const copy = clonePositioned(value.result, immutableText)
  transferGraphLayoutDecisions(value.result, copy)
  return copy
}
/** Only the private native renderer may borrow this certified snapshot. */
export function borrowedPositioned(family: object, key: string, nativeSvgRequest?: object): PositionedSnapshot | undefined {
  const isolated = isolatedKey(family, key)
  const value = results.get(isolated)
  observeCache('positioned-layout', value ? 'hit' : 'miss')
  if (nativeSvgRequest && value && nativeResidency.has(value)) {
    // The operation owns this wrapper. A retained request cannot keep the
    // cache graph alive through its proof after eviction or an early exit.
    const result = Object.freeze({ ...value.result })
    transferGraphLayoutDecisions(value.result, result)
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
  const snapshot: PositionedSnapshot = { result: value, ...(projection ? { projection } : {}) }
  const weight = key.length * 2 + estimatedResidency([snapshot, graphLayoutDecisionsOf(value)], MAX_WEIGHT) + 1024
  if (weight > MAX_WEIGHT) { observeCache('positioned-layout', 'store-skipped', 'weight-limit'); return }
  let retained = snapshot
  if (copy) {
    try { retained = clonePositioned(snapshot, true) } catch (error) {
      // C4 identity planners carry callbacks. Keep the complete authoritative
      // artifact uncached when a private snapshot cannot preserve its evidence.
      if (error instanceof Error && error.name === 'DataCloneError') { observeCache('positioned-layout', 'store-skipped', 'uncloneable'); return }
      throw error
    }
    transferGraphLayoutDecisions(value, retained.result)
  }
  if (!copy) nativeResidency.set(retained, { locallyRepeated: false })
  results.set(isolatedKey(family, key), retained, weight)
  retainedResults.add(retained.result)
}

/** The request acquired this entry through the full private positioning key.
 * A public layout copy or arbitrary request/layout pair cannot inherit it. */
export function cachedNativeDrawing(request: object, layout: FamilyLayoutResult, originalProducer: boolean): RetainedNativeDrawing | undefined {
  const entry = nativeOwners.get(layout)
  if (!originalProducer) {
    nativeOwners.delete(layout)
    return undefined
  }
  if (!entry || entry.request !== request || results.get(entry.key) !== entry.snapshot) return undefined
  const serial = ++nativeUse
  const residency = nativeResidency.get(entry.snapshot)!
  residency.locallyRepeated = residency.lastUse === serial - 1
  residency.lastUse = serial
  const retained = drawings.get(entry.key)
  return retained?.owner === entry.snapshot ? retained.drawing : undefined
}

/** Derived drawings have their own bounded tier and cannot evict geometry.
 * Cold cyclic sources use spare capacity. Consecutive reuse or a working-set
 * change that leaves the oldest drawing unused may replace drawings.
 * Evicting geometry invalidates its dependent certified drawing artifact. */
export function retainNativeDrawing(request: object, layout: FamilyLayoutResult, drawing: RetainedNativeDrawing): void {
  const entry = nativeOwners.get(layout)
  if (!entry || entry.request !== request || results.get(entry.key) !== entry.snapshot) return
  const residency = nativeResidency.get(entry.snapshot)!
  if (residency.oversized) { observeCache('native-drawing', 'store-skipped', 'weight-limit'); return }
  const lowerBound = residency.drawingWeight ?? entry.key.length * 2 + drawing.svg.length * 4 + 1024
  const oldest = drawings.leastRecentlyUsed()
  const oldestUse = oldest && nativeResidency.get(oldest.owner)?.lastUse
  const canReplaceAged = oldestUse !== undefined && nativeUse - oldestUse >= DRAWING_REPLACEMENT_AGE
  if (!residency.locallyRepeated && !canReplaceAged && !drawings.canFit(entry.key, lowerBound)) {
    observeCache('native-drawing', 'store-skipped', 'drawing-budget'); return
  }
  const retained = { owner: entry.snapshot, drawing }
  // The certified artifact deliberately excludes construction paint and its
  // geometry aliases. Its parent owns those graphs; this tier needs only the
  // reusable SVG, prepared-text decision and completed paint certificate.
  const weight = entry.key.length * 2 + estimatedResidency(drawing, DRAWING_WEIGHT) + 1024
  residency.drawingWeight = weight
  if (weight > DRAWING_WEIGHT) {
    residency.oversized = true
    observeCache('native-drawing', 'store-skipped', 'weight-limit'); return
  }
  if (!residency.locallyRepeated && !canReplaceAged && !drawings.canFit(entry.key, weight)) {
    observeCache('native-drawing', 'store-skipped', 'drawing-budget'); return
  }
  drawings.set(entry.key, retained, weight)
}
