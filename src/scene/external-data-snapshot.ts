/**
 * One bounded immutable snapshot for external Scene data.
 *
 * Both the public declarative builder and the family-to-backend admission
 * boundary consume this helper. Validation therefore observes the same plain
 * data that compilation/serialization later uses; caller Proxies, accessors,
 * iterators, and post-admission mutation never remain live past this point.
 */

import { transferRetainedPixelText } from '../shared/prepared-text.ts'
import type { SceneDoc, GroupMark } from './ir.ts'
import { SCENE_VALIDATION_LIMITS, assertAdmissibleSceneDoc, sceneValidationMode } from './scene-validation.ts'
import { sceneAssertionsEnabled } from './assertions.ts'
import { svgEmissionMetadataCounts, type SvgGroupEmission } from './svg-emission.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { transferSceneNodeSerialization, sceneNodeEmission, attachGroupEmissionViews, hasOwnedSceneEmissionView } from './serialization.ts'
import { measureRenderStage } from '../render-stages.ts'
import { deferredTerminalProjectionInput, materializeOwnTerminalProjection, reserveDeferredTerminalProjection } from './deferred-terminal-projection.ts'
import type { ConnectorTerminalProjectionInput } from './connector-terminal.ts'

export interface ExternalDataSnapshotLimits {
  readonly maxObjects: number
  readonly maxTextBytes: number
  readonly maxArrayEntries: number
  readonly maxAggregateArrayEntries: number
  readonly maxDepth: number
  readonly maxPropertiesPerObject: number
  readonly maxAggregateProperties: number
  readonly maxPropertyKeyBytes: number
  readonly maxAggregatePropertyKeyBytes: number
}

const MAX_EXTERNAL_OBJECT_PROPERTIES = 64
const MAX_EXTERNAL_PROPERTY_KEY_BYTES = 256
const MAX_EXTERNAL_AGGREGATE_PROPERTIES = SCENE_VALIDATION_LIMITS.maxNodes * 16
const MAX_EXTERNAL_AGGREGATE_ARRAY_ENTRIES = SCENE_VALIDATION_LIMITS.maxNodes * 16
const MAX_EXTERNAL_AGGREGATE_KEY_BYTES = SCENE_VALIDATION_LIMITS.maxTextBytes * 8

/** Limits for authored declarative builder input. */
export const EXTERNAL_SCENE_INPUT_SNAPSHOT_LIMITS: ExternalDataSnapshotLimits = Object.freeze({
  maxObjects: SCENE_VALIDATION_LIMITS.maxNodes * 4,
  maxTextBytes: SCENE_VALIDATION_LIMITS.maxTextBytes,
  maxArrayEntries: SCENE_VALIDATION_LIMITS.maxNodes,
  maxAggregateArrayEntries: MAX_EXTERNAL_AGGREGATE_ARRAY_ENTRIES,
  maxDepth: SCENE_VALIDATION_LIMITS.maxDepth * 4,
  maxPropertiesPerObject: MAX_EXTERNAL_OBJECT_PROPERTIES,
  maxAggregateProperties: MAX_EXTERNAL_AGGREGATE_PROPERTIES,
  maxPropertyKeyBytes: MAX_EXTERNAL_PROPERTY_KEY_BYTES,
  maxAggregatePropertyKeyBytes: MAX_EXTERNAL_AGGREGATE_KEY_BYTES,
})

/**
 * A compiled Scene has private backend serialization beside its authored
 * semantics, so its text allowance includes both semantic and SVG budgets.
 */
export const EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS: ExternalDataSnapshotLimits = Object.freeze({
  ...EXTERNAL_SCENE_INPUT_SNAPSHOT_LIMITS,
  maxObjects: SCENE_VALIDATION_LIMITS.maxNodes * 8,
  maxTextBytes:
    SCENE_VALIDATION_LIMITS.maxTextBytes
    + SCENE_VALIDATION_LIMITS.maxAggregateSerializationBytes
    + SCENE_VALIDATION_LIMITS.maxFinalSvgBytes,
})

/** Hidden immutable recipes participate in the same graph limits as enumerable
 * Scene data. Shared templates are charged once, just as shared frozen data. */
function privateMetadataAccounting() {
  const seen = new WeakSet<object>()
  return (candidate: object) => {
    const recipe = sceneNodeEmission(candidate)
    if (!recipe || seen.has(recipe)) return undefined
    seen.add(recipe)
    return svgEmissionMetadataCounts(recipe)
  }
}

/**
 * Materialize a JSON-like external data graph exclusively from own enumerable
 * data descriptors. Arrays are read by index rather than through a caller
 * iterator. The returned graph is recursively frozen before validation or
 * compilation can observe it.
 */
export function snapshotBoundedExternalData(
  value: unknown,
  limits: ExternalDataSnapshotLimits,
  rootPath = 'input',
): unknown {
  const active = new WeakSet<object>()
  const snapshots = new WeakMap<object, unknown>()
  let objects = 0
  let textBytes = 0
  let arrayEntries = 0
  let properties = 0
  let propertyKeyBytes = 0
  const metadata = privateMetadataAccounting()

  const visit = (candidate: unknown, depth: number, path: string): unknown => {
    if (typeof candidate === 'string') {
      const remaining = Math.max(0, limits.maxTextBytes - textBytes)
      const bytes = boundedUtf8ByteLength(candidate, remaining)
      if (bytes > remaining) {
        throw new Error(`External Scene text values exceed the aggregate ${limits.maxTextBytes}-byte limit`)
      }
      textBytes += bytes
      return candidate
    }
    if (candidate === null || typeof candidate !== 'object') {
      if (typeof candidate === 'function' || typeof candidate === 'symbol' || typeof candidate === 'bigint') {
        throw new TypeError(`External Scene ${path} must be declarative data`)
      }
      return candidate
    }
    if (depth > limits.maxDepth) {
      throw new Error('External Scene input object graph is too deeply nested')
    }
    const hidden = metadata(candidate)
    if (hidden) {
      objects += hidden.objects; textBytes += hidden.textBytes
      arrayEntries += hidden.arrayEntries; properties += hidden.properties
      propertyKeyBytes += hidden.propertyKeyBytes
      if (textBytes > limits.maxTextBytes || arrayEntries > limits.maxAggregateArrayEntries
        || properties > limits.maxAggregateProperties || propertyKeyBytes > limits.maxAggregatePropertyKeyBytes) {
        throw new Error('Private SVG emission metadata exceeds the aggregate Scene data limits')
      }
    }
    if (++objects > limits.maxObjects) {
      throw new Error('External Scene input object graph is too large')
    }
    if (active.has(candidate)) throw new Error('External Scene input must be acyclic')
    const existing = snapshots.get(candidate)
    if (existing !== undefined) return existing
    active.add(candidate)
    try {
      if (Array.isArray(candidate)) {
        if (Object.getPrototypeOf(candidate) !== Array.prototype) {
          throw new TypeError(`External Scene ${path} must be a plain array`)
        }
        const lengthDescriptor = Reflect.getOwnPropertyDescriptor(candidate, 'length')
        if (!lengthDescriptor || !('value' in lengthDescriptor)
          || typeof lengthDescriptor.value !== 'number'
          || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
          throw new TypeError(`External Scene ${path}.length must be a non-negative integer data property`)
        }
        const length = lengthDescriptor.value as number
        if (length > limits.maxArrayEntries) {
          throw new Error(`External Scene ${path} contains too many entries`)
        }
        arrayEntries += length
        if (arrayEntries > limits.maxAggregateArrayEntries) {
          throw new Error(`External Scene input exceeds the aggregate ${limits.maxAggregateArrayEntries}-array-entry limit`)
        }
        const keys = Reflect.ownKeys(candidate)
        // Reject the key-count shape before asking a caller Proxy for every
        // descriptor. This mirrors the object preflight and bounds descriptor
        // trap work even when ownKeys reports a large custom-key list.
        if (keys.length > length + 1 || !keys.includes('length')) {
          throw new TypeError(`External Scene ${path} must not define custom array properties or iterators`)
        }
        const descriptors = new Map<PropertyKey, PropertyDescriptor>()
        descriptors.set('length', lengthDescriptor)
        for (const key of keys) {
          if (key === 'length') continue
          const descriptor = Reflect.getOwnPropertyDescriptor(candidate, key)
          if (!descriptor) throw new TypeError(`External Scene ${path} has an unstable property descriptor`)
          descriptors.set(key, descriptor)
        }
        for (const key of keys) {
          if (key === 'length') continue
          if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
            throw new TypeError(`External Scene ${path} must not define custom array properties or iterators`)
          }
        }
        const snapshot = new Array<unknown>(length)
        snapshots.set(candidate, snapshot)
        transferSceneNodeSerialization(candidate, snapshot)
        for (let index = 0; index < length; index++) {
          const descriptor = descriptors.get(String(index))
          if (!descriptor) throw new TypeError(`External Scene ${path} must not be sparse`)
          if (!('value' in descriptor) || !descriptor.enumerable) {
            throw new TypeError(`External Scene ${path}[${index}] must be an enumerable data property`)
          }
          snapshot[index] = visit(descriptor.value, depth + 1, `${path}[${index}]`)
        }
        return Object.freeze(snapshot)
      }

      const prototype = Object.getPrototypeOf(candidate)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`External Scene ${path} must be a plain object`)
      }
      const keys = Reflect.ownKeys(candidate)
      if (keys.length > limits.maxPropertiesPerObject) {
        throw new Error(`External Scene ${path} contains too many properties`)
      }
      properties += keys.length
      if (properties > limits.maxAggregateProperties) {
        throw new Error(`External Scene input exceeds the aggregate ${limits.maxAggregateProperties}-property limit`)
      }
      for (const key of keys) {
        if (typeof key !== 'string') continue
        const remaining = Math.max(0, limits.maxAggregatePropertyKeyBytes - propertyKeyBytes)
        const bytes = boundedUtf8ByteLength(key, Math.min(limits.maxPropertyKeyBytes, remaining))
        if (bytes > limits.maxPropertyKeyBytes) {
          throw new Error(`External Scene ${path} contains a property key longer than ${limits.maxPropertyKeyBytes} bytes`)
        }
        if (bytes > remaining) {
          throw new Error(`External Scene property keys exceed the aggregate ${limits.maxAggregatePropertyKeyBytes}-byte limit`)
        }
        propertyKeyBytes += bytes
      }
      // Never retain Object.prototype as a second, live data authority.
      // External Scene is an own-data contract: inherited metadata, parts,
      // getters, or later prototype mutation must not survive admission.
      const snapshot = Object.create(null) as Record<string, unknown>
      snapshots.set(candidate, snapshot)
      transferSceneNodeSerialization(candidate, snapshot)
      for (const key of keys) {
        if (typeof key !== 'string') throw new TypeError(`External Scene ${path} must not contain symbol keys`)
        const descriptor = Reflect.getOwnPropertyDescriptor(candidate, key)
        const ownedView = hasOwnedSceneEmissionView(candidate, key)
        if (!descriptor || !descriptor.enumerable) {
          throw new TypeError(`External Scene ${path}.${key} must be an enumerable data property`)
        }
        let captured: unknown
        if (ownedView) captured = ''
        else if ('value' in descriptor) captured = descriptor.value
        else {
          captured = materializeOwnTerminalProjection(candidate, key, descriptor)
          if (captured === undefined) throw new TypeError(`External Scene ${path}.${key} must be an enumerable data property`)
        }
        Object.defineProperty(snapshot, key, {
          value: ownedView ? '' : visit(captured, depth + 1, `${path}.${key}`),
          enumerable: true,
          configurable: ownedView,
          writable: false,
        })
      }
      const recipe = sceneNodeEmission(snapshot)
      if (recipe?.kind === 'group' && hasOwnedSceneEmissionView(candidate, 'open') && hasOwnedSceneEmissionView(candidate, 'close')) {
        attachGroupEmissionViews(snapshot as unknown as GroupMark, recipe as SvgGroupEmission)
      }
      transferRetainedPixelText(candidate, snapshot)
      return Object.freeze(snapshot)
    } finally {
      active.delete(candidate)
    }
  }

  return visit(value, 0, rootPath)
}

/**
 * Freeze a document a built-in family just lowered, in place. It is plain
 * object and array literals from our own code, with no caller Proxy, accessor
 * or iterator to defend against, so it is not copied: the walk applies the
 * same limits and the prototype, cycle and sparse-array checks as
 * `snapshotBoundedExternalData`, counting a shared object at every reference
 * as that copy does, then freezes each object where it stands. Shapes only a
 * lowering bug could produce are not diagnosed here: symbol and non-enumerable
 * keys and extra array properties are skipped, and accessors are read.
 * Registered terminal-projection getters may instead reserve their full
 * payload envelope; near a limit the walk materializes and visits its graph.
 * Validation still runs on the result. Everything the document references is
 * frozen with it, including first-party objects a lowering shares, such as a
 * layout's edge points and label positions or a family's module-level marker
 * table; nothing mutates those after lowering. A lowering must therefore never
 * hand admission an object anything else still mutates. Caller input never
 * reaches it: render options arrive as frozen copies, and typed diagrams are
 * re-serialized before they render. A document that fails admission may be
 * left partly frozen.
 */
export function freezeBoundedFirstPartyData(
  value: unknown,
  limits: ExternalDataSnapshotLimits,
  rootPath = 'input',
): unknown {
  try {
    walkFirstPartyData(value, limits, rootPath, false)
  } catch (error) {
    if (error !== RECOUNT_EXACTLY) throw error
    walkFirstPartyData(value, limits, rootPath, true)
  }
  return value
}

/** Thrown when an upper bound on UTF-8 bytes might exceed a limit, so the
 * walk restarts and counts exactly. */
const RECOUNT_EXACTLY = Symbol('recount exactly')

/** One walk of `freezeBoundedFirstPartyData`. A UTF-16 code unit encodes to at
 * most three UTF-8 bytes, so the first walk charges strings and keys three
 * bytes per unit instead of counting them; only a document whose bound could
 * pass a limit is walked again with exact counts. The path an error names is
 * kept as a stack of keys and only joined when the walk throws. */
function walkFirstPartyData(value: unknown, limits: ExternalDataSnapshotLimits, rootPath: string, exact: boolean): void {
  const active = new WeakSet<object>()
  const frozen = new WeakSet<object>()
  const keyPath: Array<string | number> = []
  const path = (): string => keyPath.reduce<string>((prefix, key) => typeof key === 'number' ? `${prefix}[${key}]` : `${prefix}.${key}`, rootPath)
  let objects = 0
  let textBytes = 0
  let arrayEntries = 0
  let properties = 0
  let propertyKeyBytes = 0
  const metadata = privateMetadataAccounting()
  let reservedProjection = false
  const reservations: Array<{
    node: object
    depth: number
    objects: number
    text: number
    entries: number
    properties: number
    keys: number
  } | undefined> = []
  let nextReservation = 0
  let reconciling = false
  let materializedOutOfOrder = false
  const COUNT_PROJECTION = Symbol('count this projection')

  /** Replace older upper bounds with their actual graphs only as needed.
   * The pending increment stays uncommitted while we visit a projection, so
   * its proven envelope makes room for every intermediate visit. Any doubt
   * replays the original exact walk to preserve rejection order and paths. */
  const makeRoom = (neededObjects = 0, neededText = 0, neededEntries = 0, neededProperties = 0, neededKeys = 0): void => {
    while (objects + neededObjects > limits.maxObjects || textBytes + neededText > limits.maxTextBytes
      || arrayEntries + neededEntries > limits.maxAggregateArrayEntries
      || properties + neededProperties > limits.maxAggregateProperties
      || propertyKeyBytes + neededKeys > limits.maxAggregatePropertyKeyBytes) {
      if (exact || reconciling || nextReservation === reservations.length) throw RECOUNT_EXACTLY
      const reservation = reservations[nextReservation]!
      reservations[nextReservation++] = undefined
      objects -= reservation.objects
      textBytes -= reservation.text
      arrayEntries -= reservation.entries
      properties -= reservation.properties
      propertyKeyBytes -= reservation.keys
      reconciling = true
      materializedOutOfOrder = true
      try {
        visit((reservation.node as Record<string, unknown>).terminalProjection, reservation.depth + 1)
      } catch {
        throw RECOUNT_EXACTLY
      } finally {
        reconciling = false
      }
    }
  }

  /** A projection copies selected parts of its normalized input and creates
   * bounded marker placements/loss diagnostics. Count a generous envelope
   * without building those copies. Repeated references are deliberately not
   * deduplicated here. Ordinary projection fields copy or reuse each input
   * occurrence at most once; placement point copies add at most two more.
   * Factor 8 covers these structural copies. Polyline placement wrappers are
   * charged separately, so this bound does not depend on shared geometry or
   * particular point keys. Fixed overhead covers line endpoint placements,
   * the extra endpoint of a degenerate/closed polyline and projection-only
   * keys/arrays.
   * Text retains factor 32 for copied strings, loss strings and diagnostics.
   * An envelope that cannot fit counts its own projection instead. Ordinary
   * field pressure can reconcile older reservations. No cap is weakened. */
  const reserveProjection = (node: object, input: ConnectorTerminalProjectionInput, depth: number): void => {
    let extraObjects = 64, extraText = 4096, extraEntries = 128, extraProperties = 256, extraKeys = 8192
    const inputDepthLimit = limits.maxDepth - depth - 8
    const check = (): void => {
      if (objects + extraObjects > limits.maxObjects || textBytes + extraText > limits.maxTextBytes
        || arrayEntries + extraEntries > limits.maxAggregateArrayEntries
        || properties + extraProperties > limits.maxAggregateProperties
        || propertyKeyBytes + extraKeys > limits.maxAggregatePropertyKeyBytes) {
        throw COUNT_PROJECTION
      }
    }
    const measure = (item: unknown, level: number): void => {
      if (typeof item === 'string') extraText += item.length * 3 * 32
      else if (item !== null && typeof item === 'object') {
        if (level > inputDepthLimit) throw RECOUNT_EXACTLY
        extraObjects += 8
        if (Array.isArray(item)) {
          if (Math.max(18, item.length + 1) > limits.maxArrayEntries) throw COUNT_PROJECTION
          extraEntries += item.length * 8
          check()
          for (const entry of item) measure(entry, level + 1)
        } else {
          const keys = Object.keys(item)
          if (Math.max(24, keys.length) > limits.maxPropertiesPerObject) throw COUNT_PROJECTION
          extraProperties += keys.length * 8
          check()
          for (const key of keys) {
            if (Math.max(24, key.length) * 3 > limits.maxPropertyKeyBytes) throw COUNT_PROJECTION
            extraKeys += key.length * 3 * 8
            measure((item as Record<string, unknown>)[key], level + 1)
          }
        }
      }
      check()
    }
    try {
      check()
      measure(input, 0)
      if (input.geometry.kind === 'polyline') {
        const vertices = input.geometry.points.length
        extraObjects += vertices * 2 // Placement and point copy.
        extraProperties += vertices * 3 // markerId, point, contourIndex.
        extraEntries += vertices
        extraKeys += vertices * 25 * 3 // UTF-8 upper bound for the three keys.
        check()
      }
      // One repeated mid marker contributes its identifier at every interior
      // vertex. Unlike object/key counts, this string fan-out is not bounded by
      // a constant multiple of the input's string bytes.
      if (input.geometry.kind === 'polyline' && input.markers.mid.length > 0) {
        let longestId = 0
        for (const marker of input.markers.mid) {
          if (typeof marker.id !== 'string') throw RECOUNT_EXACTLY
          longestId = Math.max(longestId, marker.id.length)
        }
        extraText += input.geometry.points.length * longestId * 3
        check()
      }
    } catch (error) {
      if (error !== COUNT_PROJECTION) throw error
      // Public input fields were visited first. Prove the complete depth
      // envelope before counting out of order: an early budget check may have
      // stopped measurement before a deeper shared transform was reached.
      // Memoized heights also bound work on heavily shared input graphs.
      const heights = new WeakMap<object, number>()
      const height = (item: unknown, level: number): number => {
        if (item === null || typeof item !== 'object') return -1
        if (level > inputDepthLimit) throw RECOUNT_EXACTLY
        const prior = heights.get(item)
        if (prior !== undefined) {
          if (level + prior > inputDepthLimit) throw RECOUNT_EXACTLY
          return prior
        }
        let result = 0
        if (Array.isArray(item)) {
          if (item.length > limits.maxArrayEntries) throw RECOUNT_EXACTLY
          for (const entry of item) result = Math.max(result, 1 + height(entry, level + 1))
        } else {
          const keys = Object.keys(item)
          if (keys.length > limits.maxPropertiesPerObject) throw RECOUNT_EXACTLY
          for (const key of keys) result = Math.max(result, 1 + height((item as Record<string, unknown>)[key], level + 1))
        }
        heights.set(item, result)
        return result
      }
      height(input, 0)
      materializedOutOfOrder = true
      keyPath.push('terminalProjection')
      try { visit((node as Record<string, unknown>).terminalProjection, depth + 1) }
      finally { keyPath.pop() }
      return
    }
    objects += extraObjects
    textBytes += extraText
    arrayEntries += extraEntries
    properties += extraProperties
    propertyKeyBytes += extraKeys
    reservedProjection = true
    reservations.push({ node, depth, objects: extraObjects, text: extraText, entries: extraEntries, properties: extraProperties, keys: extraKeys })
    reserveDeferredTerminalProjection(node)
  }

  const visit = (candidate: unknown, depth: number): void => {
    if (typeof candidate === 'string') {
      if (!exact) {
        const bytes = candidate.length * 3
        if (textBytes + bytes > limits.maxTextBytes) makeRoom(0, bytes)
        textBytes += bytes
        return
      }
      const remaining = Math.max(0, limits.maxTextBytes - textBytes)
      const bytes = boundedUtf8ByteLength(candidate, remaining)
      if (bytes > remaining) {
        throw new Error(`External Scene text values exceed the aggregate ${limits.maxTextBytes}-byte limit`)
      }
      textBytes += bytes
      return
    }
    if (candidate === null || typeof candidate !== 'object') {
      if (typeof candidate === 'function' || typeof candidate === 'symbol' || typeof candidate === 'bigint') {
        throw new TypeError(`External Scene ${path()} must be declarative data`)
      }
      return
    }
    if (depth > limits.maxDepth) {
      throw new Error('External Scene input object graph is too deeply nested')
    }
    const hidden = metadata(candidate)
    if (hidden) {
      objects += hidden.objects; textBytes += hidden.textBytes
      arrayEntries += hidden.arrayEntries; properties += hidden.properties
      propertyKeyBytes += hidden.propertyKeyBytes
      if (textBytes > limits.maxTextBytes || arrayEntries > limits.maxAggregateArrayEntries
        || properties > limits.maxAggregateProperties || propertyKeyBytes > limits.maxAggregatePropertyKeyBytes) {
        // Earlier text/projection charges may still be upper bounds. Replay
        // in canonical order before reporting a private-metadata refusal.
        if (!exact) throw RECOUNT_EXACTLY
        throw new Error('Private SVG emission metadata exceeds the aggregate Scene data limits')
      }
    }
    if (objects + 1 > limits.maxObjects) {
      if (!exact && reservedProjection) makeRoom(1)
      else throw new Error('External Scene input object graph is too large')
    }
    objects++
    if (active.has(candidate)) throw new Error('External Scene input must be acyclic')
    if (frozen.has(candidate)) return
    active.add(candidate)
    if (Array.isArray(candidate)) {
      if (Object.getPrototypeOf(candidate) !== Array.prototype) {
        throw new TypeError(`External Scene ${path()} must be a plain array`)
      }
      const length = candidate.length
      if (length > limits.maxArrayEntries) {
        throw new Error(`External Scene ${path()} contains too many entries`)
      }
      if (arrayEntries + length > limits.maxAggregateArrayEntries) {
        if (!exact && reservedProjection) makeRoom(0, 0, length)
        else throw new Error(`External Scene input exceeds the aggregate ${limits.maxAggregateArrayEntries}-array-entry limit`)
      }
      arrayEntries += length
      for (let index = 0; index < length; index++) {
        // A hole would otherwise read through Array.prototype.
        if (!Object.hasOwn(candidate, index)) throw new TypeError(`External Scene ${path()} must not be sparse`)
        keyPath.push(index)
        visit(candidate[index], depth + 1)
        keyPath.pop()
      }
    } else {
      const prototype = Object.getPrototypeOf(candidate)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`External Scene ${path()} must be a plain object`)
      }
      const keys = Object.keys(candidate)
      if (keys.length > limits.maxPropertiesPerObject) {
        throw new Error(`External Scene ${path()} contains too many properties`)
      }
      if (properties + keys.length > limits.maxAggregateProperties) {
        if (!exact && reservedProjection) makeRoom(0, 0, 0, keys.length)
        else throw new Error(`External Scene input exceeds the aggregate ${limits.maxAggregateProperties}-property limit`)
      }
      properties += keys.length
      for (const key of keys) {
        if (!exact) {
          // Which limit an over-long key trips depends on the exact aggregate,
          // so the exact pass reports it.
          if (key.length * 3 > limits.maxPropertyKeyBytes && boundedUtf8ByteLength(key, limits.maxPropertyKeyBytes) > limits.maxPropertyKeyBytes) throw RECOUNT_EXACTLY
          const bytes = key.length * 3
          if (propertyKeyBytes + bytes > limits.maxAggregatePropertyKeyBytes) makeRoom(0, 0, 0, 0, bytes)
          propertyKeyBytes += bytes
          continue
        }
        const remaining = Math.max(0, limits.maxAggregatePropertyKeyBytes - propertyKeyBytes)
        const bytes = boundedUtf8ByteLength(key, Math.min(limits.maxPropertyKeyBytes, remaining))
        if (bytes > limits.maxPropertyKeyBytes) {
          throw new Error(`External Scene ${path()} contains a property key longer than ${limits.maxPropertyKeyBytes} bytes`)
        }
        if (bytes > remaining) {
          throw new Error(`External Scene property keys exceed the aggregate ${limits.maxAggregatePropertyKeyBytes}-byte limit`)
        }
        propertyKeyBytes += bytes
      }
      const record = candidate as Record<string, unknown>
      // Once pressure requires real projections, count subsequent ones in
      // their original key order instead of measuring and then retiring more
      // envelopes. Earlier reservations remain available to make room.
      const deferredInput = !exact && nextReservation === 0 ? deferredTerminalProjectionInput(candidate) : undefined
      for (const key of keys) {
        if (hasOwnedSceneEmissionView(candidate, key) || key === 'terminalProjection' && deferredInput) continue
        keyPath.push(key)
        visit(record[key], depth + 1)
        keyPath.pop()
      }
      // All normalized input fields are now deeply frozen. Only private,
      // copied diagnostic strings live outside the public connector fields.
      if (deferredInput) reserveProjection(candidate, deferredInput, depth)
    }
    Object.freeze(candidate)
    frozen.add(candidate)
    active.delete(candidate)
  }

  try {
    visit(value, 0)
  } catch (error) {
    // Deferred projections may be visited outside their original key position.
    // Replay any later failure in canonical order before reporting it.
    if (!exact && materializedOutOfOrder) throw RECOUNT_EXACTLY
    throw error
  }
}

/**
 * Documents that passed admission, with the rule set they passed: copies from
 * `snapshotBoundedExternalData`, and built-in lowerings frozen in place by
 * `freezeBoundedFirstPartyData`. Values are recursively frozen; the one
 * registered built-in projection getter derives only from admitted own data
 * within its reserved budget and memoizes a frozen result. Its validation
 * result therefore cannot change: passing it through another admission gate
 * re-proves nothing. Only this module records documents, so a caller cannot
 * forge membership.
 */
const ADMITTED_SCENES = new WeakMap<object, { mode: 'internal' | 'external'; crossChecks: boolean }>()

/** Record a document this module froze that passed `mode` admission. */
export function recordAdmittedScene(scene: SceneDoc, mode: 'internal' | 'external', crossChecks = true): void {
  ADMITTED_SCENES.set(scene, { mode, crossChecks: crossChecks || mode === 'external' })
}

/** The sole public-backend Scene admission waist. Direct backend consumers
 * receive the same validate-the-snapshot/use-the-snapshot guarantee as family
 * rendering. Every document is reduced to bounded, immutable data before
 * validation; a snapshot already admitted under the same rules is returned as is. */
export function admitBackendSceneDocument(value: unknown): SceneDoc {
  return admitSceneDocument(value)
}

/** Family admission chooses its rule set explicitly; backend admission infers
 * it from the captured snapshot. Both reuse only our admitted immutable data. */
export function admitSceneDocument(value: unknown, mode?: 'internal' | 'external', crossChecks = sceneAssertionsEnabled()): SceneDoc {
  // Look up before reading any property: a caller Proxy sees no trap here.
  const prior = typeof value === 'object' && value !== null ? ADMITTED_SCENES.get(value) : undefined
  if (prior !== undefined && prior.mode === (mode ?? sceneValidationMode(value))) {
    if (crossChecks && !prior.crossChecks) {
      measureRenderStage('scene-validation', () => assertAdmissibleSceneDoc(value, prior.mode, true))
      recordAdmittedScene(value as SceneDoc, prior.mode, true)
    }
    return value as SceneDoc
  }
  // Only built-in family admission names 'internal': its document is our own
  // lowering output, frozen in place. An inferred mode copies through the
  // full descriptor path. The test-only replaceFamilyForTest installs lowering
  // under a built-in id, so a test of hostile Scenes must register a `family:`
  // extension instead.
  const admitted = measureRenderStage('scene-capture', () => mode === 'internal'
    ? freezeBoundedFirstPartyData(value, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'scene')
    : snapshotBoundedExternalData(value, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'scene'))
  measureRenderStage('scene-validation', () => assertAdmissibleSceneDoc(admitted, mode, mode !== 'internal' || crossChecks))
  recordAdmittedScene(admitted as SceneDoc, mode ?? sceneValidationMode(admitted), mode !== 'internal' || crossChecks)
  return admitted as SceneDoc
}
