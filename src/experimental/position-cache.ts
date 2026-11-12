import type { FamilyLayoutResult, FamilyPositionedView } from '../agent/families.ts'
import { transferConstructedBundleRoute } from '../layout/bundle-routes.ts'
import { graphLayoutDecisionsOf, transferGraphLayoutDecisions } from '../layout/decision-evidence.ts'
import { observeCache } from '../performance-observations.ts'
import type { PaintLayoutCertification } from '../scene/paint-certification.ts'
import { isImmutablePixelTextPart, isRetainedPixelText, transferRetainedPixelText } from '../shared/prepared-text.ts'
import { estimatedResidency } from './cache-residency.ts'
import { WeightedLru } from './weighted-lru.ts'

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
const copiedResults = new WeakSet<object>()
function isolatedKey(family: object, key: string): string {
  let id = familyIds.get(family)
  if (id === undefined) { id = nextFamilyId++; familyIds.set(family, id) }
  return `${id}:${key}`
}
// Intrinsic collection iterators ignore caller overrides and mutable prototypes.
const recordPrototype = Object.prototype, mapPrototype = Map.prototype, setPrototype = Set.prototype
const mapEntries = Map.prototype.entries, setValues = Set.prototype.values
const mapNext = Object.getPrototypeOf(new Map().entries()).next as MapIterator<[unknown, unknown]>['next']
const setNext = Object.getPrototypeOf(new Set().values()).next as SetIterator<unknown>['next']
function clonedKind(value: object): 'record' | 'array' | 'map' | 'set' | 'native' {
  if (Array.isArray(value)) return 'array'
  const prototype = Object.getPrototypeOf(value)
  return prototype === recordPrototype || prototype === null ? 'record'
    : prototype === mapPrototype ? 'map' : prototype === setPrototype ? 'set' : 'native'
}

function mapSnapshot(value: object): Array<[unknown, unknown]> {
  const iterator = mapEntries.call(value as Map<unknown, unknown>), entries: Array<[unknown, unknown]> = []
  for (let next = mapNext.call(iterator); !next.done; next = mapNext.call(iterator)) entries.push(next.value)
  return entries
}

function setSnapshot(value: object): unknown[] {
  const iterator = setValues.call(value as Set<unknown>), entries: unknown[] = []
  for (let next = setNext.call(iterator); !next.done; next = setNext.call(iterator)) entries.push(next.value)
  return entries
}

/** A complete value/alias witness permits original immutable substitutions.
 * A failed witness never changes the native snapshot. */
function positionedCustodyProof(source: unknown, copy: unknown, immutableText: boolean) {
  const originals = new WeakMap<object, object>(), snapshots = new WeakMap<object, object>()
  const replacements = new WeakMap<object, object>(), metadata: Array<[object, object]> = []
  let hasReplacements = false
  const prove = (a: unknown, b: unknown): boolean => {
    if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') return Object.is(a, b)
    if (originals.has(a) || snapshots.has(b)) return originals.get(a) === b && snapshots.get(b) === a
    originals.set(a, b); snapshots.set(b, a)
    const kind = clonedKind(b)
    const immutable = isImmutablePixelTextPart(a)
    // Opaque native objects keep their authoritative native snapshot. Optional
    // custody reuse requires a complete value and bidirectional alias proof.
    if (kind === 'native') return false
    if (kind === 'map') {
      const entries = mapSnapshot(a), copied = mapSnapshot(b)
      if (entries.length !== copied.length) return false
      for (let index = 0; index < entries.length; index++) {
        const [key, item] = entries[index]!, [copyKey, copyValue] = copied[index]!
        if (!prove(key, copyKey) || !prove(item, copyValue)) return false
      }
    } else if (kind === 'set') {
      const values = setSnapshot(a), copied = setSnapshot(b)
      if (values.length !== copied.length) return false
      for (let index = 0; index < values.length; index++) if (!prove(values[index], copied[index])) return false
    } else {
      if (Array.isArray(a) !== (kind === 'array')) return false
      // Constructor custody proves frozen, accessor-free data. Mutable source
      // nodes still need a single descriptor snapshot before any recursion:
      // a later Proxy trap can mutate siblings during the proof.
      const descriptors = immutable ? undefined : Object.getOwnPropertyDescriptors(a)
      const keys = descriptors ? Object.keys(descriptors).filter(key => descriptors[key]!.enumerable) : Object.keys(a)
      const copied = Object.keys(b)
      if (kind === 'array' && (descriptors ? descriptors.length?.value : (a as unknown[]).length) !== (b as unknown[]).length) return false
      if (keys.length !== copied.length) return false
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!, descriptor = descriptors?.[key]
        if (key !== copied[index] || (descriptor && !('value' in descriptor))) return false
        // Native-created records and arrays contain own data properties.
        if (!prove(descriptor ? descriptor.value : (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
      }
    }
    if (isRetainedPixelText(a)) metadata.push([a, b])
    if (immutableText && immutable) { replacements.set(b, a); hasReplacements = true }
    return true
  }
  let proved = false
  // Post-admission Proxy reflection can still be observed. A trap failure or
  // inconsistent witness only declines custody; it cannot change admission or
  // the captured native values. No original graph nodes are returned except
  // value/alias-proved constructor-owned immutable parts.
  try { proved = prove(source, copy) } catch { /* optional custody proof failed */ }
  return proved ? { metadata, replacements, hasReplacements } : undefined
}

/** Metadata alone does not substitute values or merge aliases. If an unrelated
 * native value or accessor prevents whole-graph reuse, independently prove each
 * retained text subtree before transferring its preparation authority. */
function transferIndependentTextCustody(source: unknown, copy: unknown): void {
  const seen = new WeakSet<object>()
  const visit = (a: unknown, b: unknown): void => {
    if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object' || seen.has(b)) return
    seen.add(b)
    if (isRetainedPixelText(a)) {
      const proof = positionedCustodyProof(a, b, false)
      if (proof) {
        for (const [original, snapshot] of proof.metadata) transferRetainedPixelText(original, snapshot)
        return
      }
    }
    try {
      const kind = clonedKind(b)
      if (kind === 'map') {
        const entries = mapSnapshot(a), copies = mapSnapshot(b)
        if (entries.length !== copies.length) return
        for (let i = 0; i < entries.length; i++) { visit(entries[i]![0], copies[i]![0]); visit(entries[i]![1], copies[i]![1]) }
      } else if (kind === 'set') {
        const entries = setSnapshot(a), copies = setSnapshot(b)
        if (entries.length !== copies.length) return
        for (let i = 0; i < entries.length; i++) visit(entries[i], copies[i])
      } else if (kind === 'record' || kind === 'array') {
        const descriptors = Object.getOwnPropertyDescriptors(a)
        for (const key of Object.keys(b)) {
          const descriptor = descriptors[key]
          if (descriptor?.enumerable && 'value' in descriptor) visit(descriptor.value, (b as Record<string, unknown>)[key])
        }
      }
    } catch { /* unrelated opaque or changed source data cannot grant custody */ }
  }
  visit(source, copy)
}

/** A copied bundle route keeps its construction ownership, so a cached layout
 * is audited exactly like the fresh one it was copied from. structuredClone
 * preserves shape and order, so source and copy are walked in parallel. */
function transferBundleRouteOwnership(source: unknown, copy: unknown): void {
  const seen = new WeakSet<object>()
  const visit = (a: unknown, b: unknown): void => {
    if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object' || seen.has(a)) return
    seen.add(a)
    transferConstructedBundleRoute(a, b)
    try {
      const kind = clonedKind(b)
      if (kind === 'map') {
        const entries = mapSnapshot(a), copies = mapSnapshot(b)
        for (let i = 0; i < Math.min(entries.length, copies.length); i++) { visit(entries[i]![0], copies[i]![0]); visit(entries[i]![1], copies[i]![1]) }
      } else if (kind === 'set') {
        const entries = setSnapshot(a), copies = setSnapshot(b)
        for (let i = 0; i < Math.min(entries.length, copies.length); i++) visit(entries[i], copies[i])
      } else if (kind === 'record' || kind === 'array') {
        for (const key of Object.keys(b)) {
          const descriptor = Object.getOwnPropertyDescriptor(a, key)
          if (descriptor && 'value' in descriptor) visit(descriptor.value, (b as Record<string, unknown>)[key])
        }
      }
    } catch { /* opaque source data carries no route ownership */ }
  }
  visit(source, copy)
}

// Constructor-owned text parts are deeply frozen, so their estimate is stable.
const immutableTextResidency = new WeakMap<object, number>()
function immutableTextWeight(item: object): number | undefined {
  if (!isImmutablePixelTextPart(item)) return undefined
  let weight = immutableTextResidency.get(item)
  if (weight === undefined) immutableTextResidency.set(item, weight = estimatedResidency(item, MAX_WEIGHT))
  return weight
}

type OwnedSnapshot<T> = { readonly kind: 'copied'; readonly value: T; readonly weight: number } | { readonly kind: 'oversized' | 'uncloneable' | 'unmodelled' }

/** One walk over a graph this package constructed: an original family
 * producer's fresh result, or this cache's own snapshot. Such graphs hold no
 * caller Proxy (request data reaches producers only as plain immutable
 * snapshots), so plain reads replace the native-admission and custody-proof
 * walks. The result matches that path's successful proof: mutable records,
 * arrays, Maps and Sets are copied with aliases intact, constructor-owned
 * immutable text is shared, and bundle-route and retained-text custody move
 * to the copies. The residency estimate is accumulated in the same walk. A
 * function or symbol is `uncloneable`, exactly as structuredClone would reject
 * it; any other value outside the model is `unmodelled`, and the caller keeps
 * the native path. */
function ownedPositionedSnapshot<T>(source: T, limit: number): OwnedSnapshot<T> {
  const copies = new Map<object, object>()
  let weight = 0, unmodelled = false, uncloneable = false
  const copy = (value: unknown): unknown => {
    if (unmodelled || weight > limit) return undefined
    if (typeof value === 'string') { weight += value.length * 4 + 16; return value }
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') unmodelled = uncloneable = true
      weight += 16
      return value
    }
    const existing = copies.get(value)
    if (existing) { weight += 8; return existing }
    const textWeight = immutableTextWeight(value)
    if (textWeight !== undefined) { copies.set(value, value); weight += textWeight; return value }
    const kind = clonedKind(value)
    let target: object
    weight += 64
    if (kind === 'map') {
      const map = new Map<unknown, unknown>()
      copies.set(value, target = map)
      for (const [key, item] of mapSnapshot(value)) { weight += 32; map.set(copy(key), copy(item)) }
    } else if (kind === 'set') {
      const set = new Set<unknown>()
      copies.set(value, target = set)
      for (const item of setSnapshot(value)) { weight += 16; set.add(copy(item)) }
    } else if (kind === 'record' || kind === 'array') {
      const record = (kind === 'array' ? new Array((value as unknown[]).length) : {}) as Record<string, unknown>
      copies.set(value, target = record)
      for (const key of Object.keys(value)) {
        weight += key.length * 2 + 16
        record[key] = copy((value as Record<string, unknown>)[key])
      }
    } else {
      unmodelled = true
      return undefined
    }
    transferConstructedBundleRoute(value, target)
    transferRetainedPixelText(value, target)
    return target
  }
  const value = copy(source) as T
  return uncloneable ? { kind: 'uncloneable' } : unmodelled ? { kind: 'unmodelled' } : weight > limit ? { kind: 'oversized' } : { kind: 'copied', value, weight }
}

/** Public copies remain independent mutable snapshots. Private native copies
 * may share only constructor-owned immutable text, preserving custody cost.
 * `ownedSource` asserts the graph was constructed by this package (see
 * ownedPositionedSnapshot); every other source keeps native admission. */
export function clonePositioned<T>(source: T, immutableText = false, ownedSource = false): T {
  if (immutableText && ownedSource) {
    const owned = ownedPositionedSnapshot(source, Infinity)
    if (owned.kind === 'copied') return owned.value
  }
  // Native admission must precede reflection: even a descriptor trap can
  // delete an uncloneable Proxy before structuredClone gets to reject it.
  const copy = structuredClone(source)
  transferBundleRouteOwnership(source, copy)
  const proof = positionedCustodyProof(source, copy, immutableText)
  if (!proof) { transferIndependentTextCustody(source, copy); return copy }
  const { metadata, replacements, hasReplacements } = proof
  for (const [a, b] of metadata) transferRetainedPixelText(a, b)
  if (!hasReplacements) return copy
  const seen = new WeakSet<object>()
  const retain = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value
    const replacement = replacements.get(value)
    if (replacement) return replacement
    if (seen.has(value)) return value
    seen.add(value)
    const kind = clonedKind(value)
    if (kind === 'map') {
      const entries = mapSnapshot(value), target = value as Map<unknown, unknown>
      let changed = false
      for (const entry of entries) {
        const key = retain(entry[0]), item = retain(entry[1])
        if (key !== entry[0] || item !== entry[1]) { entry[0] = key; entry[1] = item; changed = true }
      }
      if (changed) { target.clear(); for (const [key, item] of entries) target.set(key, item) }
    } else if (kind === 'set') {
      const entries = setSnapshot(value), target = value as Set<unknown>
      let changed = false
      for (let index = 0; index < entries.length; index++) {
        const item = retain(entries[index])
        if (item !== entries[index]) { entries[index] = item; changed = true }
      }
      if (changed) { target.clear(); for (const item of entries) target.add(item) }
    } else if (kind === 'record' || kind === 'array') {
      const target = value as Record<string, unknown>
      for (const key of Object.keys(value)) {
        const item = target[key], retained = retain(item)
        if (retained !== item) target[key] = retained
      }
    }
    return value
  }
  return retain(copy) as T
}
/** Membership records actual private cache geometry, including its operation
 * wrappers, never a caller brand. */
export function isRetainedPositionedSnapshot(result: object): boolean { return retainedResults.has(result) }
/** Captured geometry stays cache-private even when a drawing must be rebuilt. */
export function positionedDrawingNeedsCopy(result: object): boolean { return copiedResults.has(result) }
export function cachedPositioned(family: object, key: string, alreadyObserved = false, immutableText = false): FamilyLayoutResult | undefined {
  const value = results.get(isolatedKey(family, key))
  if (!alreadyObserved) observeCache('positioned-layout', value ? 'hit' : 'miss')
  if (!value) return undefined
  // The cache's own snapshot: copied here, or an original producer's result.
  const copy = clonePositioned(value.result, immutableText, true)
  transferGraphLayoutDecisions(value.result, copy)
  return copy
}
/** Only the private native renderer may borrow this certified snapshot. */
export function borrowedPositioned(family: object, key: string, nativeSvgRequest?: object, reuseCapturedDrawing = false): PositionedSnapshot | undefined {
  const isolated = isolatedKey(family, key)
  const value = results.get(isolated)
  observeCache('positioned-layout', value ? 'hit' : 'miss')
  // Only the private renderer opts in after checking the captured family,
  // backend, native producer and metric identities. Generic/public cache
  // users do not acquire a drawing capability by supplying a request object.
  if (reuseCapturedDrawing && nativeSvgRequest && value && !nativeResidency.has(value)) {
    nativeResidency.set(value, { locallyRepeated: false })
  }
  if (nativeSvgRequest && value && nativeResidency.has(value) && (reuseCapturedDrawing || !copiedResults.has(value.result))) {
    // The operation owns this wrapper. A retained request cannot keep the
    // cache graph alive through its proof after eviction or an early exit.
    const result = Object.freeze({ ...value.result })
    transferGraphLayoutDecisions(value.result, result)
    nativeOwners.set(result, { key: isolated, snapshot: value, request: nativeSvgRequest })
    retainedResults.add(result)
    if (copiedResults.has(value.result)) copiedResults.add(result)
    return { ...value, result }
  }
  return value
}
/** `ownedProducer`: the value is an original family producer's fresh result. */
export function retainPositioned(family: object, key: string, value: FamilyLayoutResult, projection?: FamilyPositionedView, ownedProducer = false): void {
  retainSnapshot(family, key, value, projection, true, ownedProducer)
}
/** Fresh original Flowchart/State/Sequence/Pie geometry, private native SVG only. */
export function retainOwnedNativeSvgPositioned(family: object, key: string, value: FamilyLayoutResult, projection?: FamilyPositionedView): void {
  retainSnapshot(family, key, value, projection, false, true)
}
function retainSnapshot(family: object, key: string, value: FamilyLayoutResult, projection: FamilyPositionedView | undefined, copy: boolean, ownedProducer: boolean): void {
  const snapshot: PositionedSnapshot = { result: value, ...(projection ? { projection } : {}) }
  const fixedWeight = key.length * 2 + estimatedResidency(graphLayoutDecisionsOf(value), MAX_WEIGHT) + 1024
  const owned = copy && ownedProducer ? ownedPositionedSnapshot(snapshot, MAX_WEIGHT - fixedWeight) : undefined
  // C4 identity planners carry callbacks. Keep the complete authoritative
  // artifact uncached when a private snapshot cannot preserve its evidence.
  if (owned?.kind === 'uncloneable') { observeCache('positioned-layout', 'store-skipped', 'uncloneable'); return }
  const weight = owned?.kind === 'copied' ? fixedWeight + owned.weight : owned?.kind === 'oversized' ? Infinity
    : fixedWeight + estimatedResidency(snapshot, MAX_WEIGHT, immutableTextWeight)
  if (weight > MAX_WEIGHT) { observeCache('positioned-layout', 'store-skipped', 'weight-limit'); return }
  let retained = snapshot
  if (owned?.kind === 'copied') retained = owned.value
  else if (copy) {
    try { retained = clonePositioned(snapshot, true) } catch (error) {
      if (error instanceof Error && error.name === 'DataCloneError') { observeCache('positioned-layout', 'store-skipped', 'uncloneable'); return }
      throw error
    }
  }
  if (copy) transferGraphLayoutDecisions(value, retained.result)
  if (!copy) nativeResidency.set(retained, { locallyRepeated: false })
  results.set(isolatedKey(family, key), retained, weight)
  retainedResults.add(retained.result)
  if (copy) copiedResults.add(retained.result)
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
