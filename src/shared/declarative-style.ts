import { JSON_CONFIG_ADMISSION_LIMITS } from './json-config-admission.ts'
import { isPlainRecord } from './plain-data.ts'

/** Style admission reads caller-owned accessors while reducing a public
 * StyleSpec to immutable declarative data. A getter must not be able to use a
 * nested register/dispose call to leave the registry changed when the outer
 * admission later fails. Resolution is synchronous, so one depth counter
 * protects registration, inline stacks, and disposer callbacks without
 * changing ordinary nested read-only resolution semantics. */
let styleAdmissionDepth = 0

export function assertStyleRegistryMutationAllowed(): void {
  if (styleAdmissionDepth > 0) {
    throw new Error('Style registry mutation is forbidden while a Style input is undergoing admission')
  }
}

export function withStyleAdmission<T>(admit: () => T): T {
  styleAdmissionDepth++
  try {
    return admit()
  } finally {
    styleAdmissionDepth--
  }
}

/**
 * Materialize caller-owned declarative data once. Object.entries invokes each
 * enumerable accessor once; recursive snapshots ensure nested colors (and any
 * future object-valued StyleSpec field) cannot change after validation. A
 * proxy that presents a plain-record surface is safely reduced to frozen data;
 * other object kinds remain intact so the canonical validator rejects them.
 */
export function snapshotDeclarativeStyleValue(value: unknown): unknown {
  const snapshots = new WeakMap<object, unknown>()
  const active = new WeakSet<object>()
  const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
  let nodes = 0
  let textCharacters = 0

  const snapshot = (candidate: unknown, depth: number): unknown => {
    if (depth > JSON_CONFIG_ADMISSION_LIMITS.maxDepth) {
      throw new TypeError(`Style input exceeds maximum nesting depth ${JSON_CONFIG_ADMISSION_LIMITS.maxDepth}`)
    }
    nodes++
    if (nodes > JSON_CONFIG_ADMISSION_LIMITS.maxNodes) {
      throw new TypeError(`Style input exceeds the ${JSON_CONFIG_ADMISSION_LIMITS.maxNodes}-node limit`)
    }
    if (typeof candidate === 'string') {
      textCharacters += candidate.length
      if (textCharacters > JSON_CONFIG_ADMISSION_LIMITS.maxAggregateTextCharacters) {
        throw new TypeError(`Style input exceeds the ${JSON_CONFIG_ADMISSION_LIMITS.maxAggregateTextCharacters}-character text limit`)
      }
      return candidate
    }
    if (typeof candidate !== 'object' || candidate === null) return candidate
    if (active.has(candidate)) throw new TypeError('Style input must be acyclic')
    const existing = snapshots.get(candidate)
    if (existing !== undefined) return existing

    if (Array.isArray(candidate)) {
      if (candidate.length > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer) {
        throw new TypeError(`Style array must contain at most ${JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer} items`)
      }
      const copy: unknown[] = []
      snapshots.set(candidate, copy)
      active.add(candidate)
      for (let index = 0; index < candidate.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(candidate, index)) throw new TypeError('Style arrays must not be sparse')
        copy.push(snapshot(candidate[index], depth + 1))
      }
      active.delete(candidate)
      return Object.freeze(copy)
    }

    if (!isPlainRecord(candidate)) return candidate
    const entries = Object.entries(candidate)
    if (entries.length > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer) {
      throw new TypeError(`Style object must contain at most ${JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer} properties`)
    }
    const copy = Object.create(null) as Record<string, unknown>
    snapshots.set(candidate, copy)
    active.add(candidate)
    for (const [key, child] of entries) {
      if (forbiddenKeys.has(key)) throw new TypeError(`Style input uses forbidden key "${key}"`)
      textCharacters += key.length
      if (textCharacters > JSON_CONFIG_ADMISSION_LIMITS.maxAggregateTextCharacters) {
        throw new TypeError(`Style input exceeds the ${JSON_CONFIG_ADMISSION_LIMITS.maxAggregateTextCharacters}-character text limit`)
      }
      Object.defineProperty(copy, key, {
        value: snapshot(child, depth + 1),
        enumerable: true,
        writable: false,
        configurable: false,
      })
    }
    active.delete(candidate)
    return Object.freeze(copy)
  }

  return snapshot(value, 0)
}
