/**
 * One bounded immutable snapshot for external Scene data.
 *
 * Both the public declarative builder and the family-to-backend admission
 * boundary consume this helper. Validation therefore observes the same plain
 * data that compilation/serialization later uses; caller Proxies, accessors,
 * iterators, and post-admission mutation never remain live past this point.
 */

import { transferRetainedPixelText } from '../shared/prepared-text.ts'
import type { SceneDoc } from './ir.ts'
import { SCENE_VALIDATION_LIMITS, SceneValidationError, sceneValidationMode } from './scene-validation-core.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { transferSceneNodeSerialization } from './serialization.ts'
import { materializeOwnTerminalProjection } from './deferred-terminal-projection.ts'

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
        if (!descriptor || !descriptor.enumerable) {
          throw new TypeError(`External Scene ${path}.${key} must be an enumerable data property`)
        }
        let captured: unknown
        if ('value' in descriptor) captured = descriptor.value
        else {
          captured = materializeOwnTerminalProjection(candidate, key, descriptor)
          if (captured === undefined) throw new TypeError(`External Scene ${path}.${key} must be an enumerable data property`)
        }
        Object.defineProperty(snapshot, key, {
          value: visit(captured, depth + 1, `${path}.${key}`),
          enumerable: true,
          configurable: false,
          writable: false,
        })
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
const ADMITTED_SCENES = new WeakMap<object, { mode: 'internal' | 'external'; crossChecks: boolean }>()

/** Record a document this module froze that passed `mode` admission. */
export function recordAdmittedScene(scene: SceneDoc, mode: 'internal' | 'external', crossChecks = true): void {
  ADMITTED_SCENES.set(scene, { mode, crossChecks })
}

export type SceneAdmissionValidator = (value: unknown, mode: 'internal' | 'external' | undefined, crossChecks: boolean) => asserts value is SceneDoc

function refuseExternalBrowserScene(): never {
  throw new SceneValidationError([{ code: 'SCENE_DOCUMENT', path: 'scene.family', message: 'source-only browser admission requires a built-in family' }])
}

export function admitSceneDocumentWith(value: unknown, mode: 'internal' | 'external' | undefined, crossChecks: boolean, validate: SceneAdmissionValidator, internalOnly = false): SceneDoc {
  // Look up before reading any property: a caller Proxy sees no trap here.
  const prior = typeof value === 'object' && value !== null ? ADMITTED_SCENES.get(value) : undefined
  if (internalOnly && (mode === 'external' || prior !== undefined && (prior.mode === 'external' || sceneValidationMode(value) === 'external'))) refuseExternalBrowserScene()
  const requiredChecks = mode !== 'internal' || crossChecks
  if (prior !== undefined && prior.mode === (mode ?? sceneValidationMode(value))) {
    // A prior cheap admission cannot stand in for a later strict request.
    if ((prior.mode === 'external' || crossChecks) && !prior.crossChecks) {
      validate(value, prior.mode, true)
      recordAdmittedScene(value as SceneDoc, prior.mode, true)
    }
    return value as SceneDoc
  }
  const admitted = snapshotBoundedExternalData(value, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, 'scene')
  if (internalOnly && sceneValidationMode(admitted) === 'external') refuseExternalBrowserScene()
  validate(admitted, mode, mode !== 'internal' || crossChecks)
  recordAdmittedScene(admitted as SceneDoc, mode ?? sceneValidationMode(admitted), requiredChecks)
  return admitted as SceneDoc
}
