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
import { assertAdmissibleSceneDoc, sceneValidationMode } from './scene-validation.ts'
import { SCENE_VALIDATION_LIMITS } from './scene-limits.ts'
import { sceneAssertionsEnabled } from './assertions.ts'
import { svgEmissionMetadataCounts, svgGroupMetadata, svgGroupMetadataCounts, type SvgEmissionMetadataCounts, type SvgGroupEmission } from './svg-emission.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { transferSceneNodeSerialization, sceneNodeEmission, attachGroupEmissionViews, hasOwnedSceneEmissionView } from './serialization.ts'
import { measureRenderStage } from '../render-stages.ts'
import { materializeOwnTerminalProjection } from './deferred-terminal-projection.ts'
import { accountConstructionOperands } from './construction-operands.ts'

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
function privateMetadataAccounting(limits: ExternalDataSnapshotLimits) {
  const seen = new WeakSet<object>()
  const basic = (candidate: object, depth: number, consume: (counts: SvgEmissionMetadataCounts) => void): void => {
    const recipe = sceneNodeEmission(candidate)
    if (recipe && !seen.has(recipe)) {
      seen.add(recipe)
      consume(svgEmissionMetadataCounts(recipe))
    }
    const metadata = svgGroupMetadata(candidate)
    if (!metadata) return
    // The only hidden descendant is this scalar record. Check its actual
    // enclosing object depth even when another alias was already charged.
    if (depth + 1 > limits.maxDepth) throw new Error('External Scene input object graph is too deeply nested')
    if (seen.has(metadata)) return
    seen.add(metadata)
    const counts = svgGroupMetadataCounts(metadata)
    if (counts.properties > limits.maxPropertiesPerObject) throw new Error('Private SVG group metadata contains too many properties')
    if (limits.maxPropertyKeyBytes < 13) for (const key of Object.keys(metadata)) {
      if (key.length > limits.maxPropertyKeyBytes) throw new Error('Private SVG group metadata contains an oversized property key')
    }
    consume(counts)
  }
  return (candidate: object, depth: number, consume: (counts: SvgEmissionMetadataCounts) => void): void => {
    basic(candidate, depth, consume)
    accountConstructionOperands(candidate, depth, seen, limits, consume, (value, at) => basic(value, at, consume))
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
  const metadata = privateMetadataAccounting(limits)
  const consumeMetadata = (hidden: SvgEmissionMetadataCounts): void => {
    objects += hidden.objects; textBytes += hidden.textBytes
    arrayEntries += hidden.arrayEntries; properties += hidden.properties
    propertyKeyBytes += hidden.propertyKeyBytes
    if (textBytes > limits.maxTextBytes || arrayEntries > limits.maxAggregateArrayEntries
      || properties > limits.maxAggregateProperties || propertyKeyBytes > limits.maxAggregatePropertyKeyBytes) {
      throw new Error('Private SVG emission metadata exceeds the aggregate Scene data limits')
    }
  }

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
    metadata(candidate, depth, consumeMetadata)
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
      if (recipe?.kind === 'group') {
        const open = hasOwnedSceneEmissionView(candidate, 'open')
        const close = hasOwnedSceneEmissionView(candidate, 'close')
        // A caller may redefine only one compatibility field as own data.
        // Keep that captured value and independently restore the other view.
        if (open || close) attachGroupEmissionViews(snapshot as unknown as GroupMark, recipe as SvgGroupEmission, open && close ? 'both' : open ? 'open' : 'close')
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
 * Documents that passed admission, with the rule set they passed. Every document
 * is a recursively frozen own-data snapshot, including any registered built-in
 * terminal projection. Its validation result cannot change: passing it through
 * another admission gate re-proves nothing. Only this module records documents,
 * so a caller cannot forge membership.
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
  const metadata = privateMetadataAccounting(limits)
  const consumeMetadata = (hidden: SvgEmissionMetadataCounts): void => {
    objects += hidden.objects; textBytes += hidden.textBytes
    arrayEntries += hidden.arrayEntries; properties += hidden.properties
    propertyKeyBytes += hidden.propertyKeyBytes
    if (textBytes > limits.maxTextBytes || arrayEntries > limits.maxAggregateArrayEntries
      || properties > limits.maxAggregateProperties || propertyKeyBytes > limits.maxAggregatePropertyKeyBytes) {
      if (!exact) throw RECOUNT_EXACTLY
      throw new Error('Private SVG emission metadata exceeds the aggregate Scene data limits')
    }
  }
  const visit = (candidate: unknown, depth: number): void => {
    if (typeof candidate === 'string') {
      if (!exact) {
        const bytes = candidate.length * 3
        if (textBytes + bytes > limits.maxTextBytes) (() => { throw RECOUNT_EXACTLY })()
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
    metadata(candidate, depth, consumeMetadata)
    if (objects + 1 > limits.maxObjects) {
      throw new Error('External Scene input object graph is too large')
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
        throw new Error(`External Scene input exceeds the aggregate ${limits.maxAggregateArrayEntries}-array-entry limit`)
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
        throw new Error(`External Scene input exceeds the aggregate ${limits.maxAggregateProperties}-property limit`)
      }
      properties += keys.length
      for (const key of keys) {
        if (!exact) {
          // Which limit an over-long key trips depends on the exact aggregate,
          // so the exact pass reports it.
          if (key.length * 3 > limits.maxPropertyKeyBytes && boundedUtf8ByteLength(key, limits.maxPropertyKeyBytes) > limits.maxPropertyKeyBytes) throw RECOUNT_EXACTLY
          const bytes = key.length * 3
          if (propertyKeyBytes + bytes > limits.maxAggregatePropertyKeyBytes) (() => { throw RECOUNT_EXACTLY })()
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
      for (const key of keys) {
        if (hasOwnedSceneEmissionView(candidate, key)) continue
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key)!
        if (!('value' in descriptor)) {
          const projection = materializeOwnTerminalProjection(candidate, key, descriptor)
          if (projection === undefined) throw new TypeError(`External Scene ${path()}.${key} must be an enumerable data property`)
          Object.defineProperty(candidate, key, { value: projection, enumerable: true, configurable: true, writable: true })
        }
        keyPath.push(key)
        visit(record[key], depth + 1)
        keyPath.pop()
      }
    }
    Object.freeze(candidate)
    frozen.add(candidate)
    active.delete(candidate)
  }

  visit(value, 0)
}

/**
 * Documents that passed admission, with the rule set they passed: copies from
 * `snapshotBoundedExternalData`, and built-in lowerings frozen in place by
 * `freezeBoundedFirstPartyData`. Values are recursively frozen; registered built-in terminal projections are materialized as own data. Its validation
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
  // Retained Scene consumers receive the upstream immutable own-data snapshot;
  // ordinary native drawing avoids retaining this tree altogether.
  const admitted = measureRenderStage('scene-capture', () =>
    snapshotBoundedExternalData(value, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'scene'))
  measureRenderStage('scene-validation', () => assertAdmissibleSceneDoc(admitted, mode, mode !== 'internal' || crossChecks))
  recordAdmittedScene(admitted as SceneDoc, mode ?? sceneValidationMode(admitted), mode !== 'internal' || crossChecks)
  return admitted as SceneDoc
}
