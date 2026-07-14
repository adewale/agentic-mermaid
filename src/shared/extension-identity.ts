/**
 * Identity metadata shared by the kind-specific extension registries.
 *
 * This module deliberately does not provide a global extension registry:
 * families, styles, backends, resources, and roles retain their own typed
 * registries and share only naming, provenance, version, and collision rules.
 */

import {
  isCapabilityId,
  isSupportedSemVerRange,
  parseSemVer,
  semVerSatisfies,
} from '../capability-negotiation.ts'
import pkg from '../../package.json'
import { SCENE_CONTRACT_SEMVER } from '../scene/version.ts'

export interface ExtensionCompatibility {
  readonly [contract: string]: string | undefined
  /** Compatible Agentic Mermaid core contract/range. */
  readonly core?: string
  /** Compatible Scene contract/range, when the extension consumes Scene. */
  readonly scene?: string
}

export interface ExtensionProvenance {
  /** Stable owner/package identifier, not a display label. */
  readonly owner: string
  /** Where the registration came from (for example `built-in` or `host`). */
  readonly source: string
  /** Optional source URL, package reference, or build receipt. */
  readonly reference?: string
}

export interface ExtensionIdentity<Kind extends string = string> {
  /** Collision-safe `${kind}:${local-name}` identifier. */
  readonly id: `${Kind}:${string}`
  readonly kind: Kind
  readonly version: string
  readonly compatibility: ExtensionCompatibility
  readonly provenance: ExtensionProvenance
}

/** Content equality for a portable descriptor identity snapshot. Object
 * identity is insufficient because ParsedDiagram envelopes may cross a JSON
 * transport before they are serialized or rendered. */
export function sameExtensionIdentity<Kind extends string>(
  left: ExtensionIdentity<Kind> | undefined,
  right: ExtensionIdentity<Kind> | undefined,
): boolean {
  if (left === undefined || right === undefined) return false
  if (left.id !== right.id || left.kind !== right.kind || left.version !== right.version) return false
  const compatibilityKeys = new Set([
    ...Object.keys(left.compatibility),
    ...Object.keys(right.compatibility),
  ])
  for (const key of compatibilityKeys) {
    if (left.compatibility[key] !== right.compatibility[key]) return false
  }
  return left.provenance.owner === right.provenance.owner
    && left.provenance.source === right.provenance.source
    && left.provenance.reference === right.provenance.reference
}

/** Host contract versions understood by this runtime. Requirements for other
 * namespaced contracts are retained but deliberately deferred to their owner. */
export const KNOWN_EXTENSION_CONTRACT_VERSIONS = Object.freeze({
  core: pkg.version,
  scene: SCENE_CONTRACT_SEMVER,
} as const)

export interface ExtensionCompatibilityResolution {
  readonly contract: string
  readonly range: string
  readonly status: 'compatible' | 'incompatible' | 'deferred' | 'invalid'
  readonly version?: string
  readonly diagnostic?: string
}

export interface ExtensionCompatibilityDecision {
  readonly accepted: boolean
  readonly resolutions: readonly ExtensionCompatibilityResolution[]
}

/** Require an explicit range when an extension crosses a versioned wire
 * contract. Presence is distinct from compatibility: silently inheriting the
 * current host version would let an old Scene producer appear compatible
 * after a future breaking host upgrade. */
export function requireExtensionContractCompatibility(
  identity: Pick<ExtensionIdentity, 'id' | 'compatibility'>,
  contract: keyof typeof KNOWN_EXTENSION_CONTRACT_VERSIONS,
): void {
  if (!identity.compatibility[contract]) {
    throw new Error(`Extension "${identity.id}" must declare an explicit compatible "${contract}" range`)
  }
}

/**
 * Evaluate every identity kind through one compatibility policy. Known core
 * and Scene ranges are enforced now; valid unknown namespaced requirements
 * remain visible and deferred for forward-compatible hosts.
 */
export function evaluateExtensionCompatibility(
  identity: Pick<ExtensionIdentity, 'id' | 'compatibility'>,
): ExtensionCompatibilityDecision {
  const resolutions: ExtensionCompatibilityResolution[] = []
  for (const [contract, range] of Object.entries(identity.compatibility)) {
    if (range === undefined) continue
    const knownVersion = KNOWN_EXTENSION_CONTRACT_VERSIONS[contract as keyof typeof KNOWN_EXTENSION_CONTRACT_VERSIONS]
    if (!isSupportedSemVerRange(range)) {
      resolutions.push(Object.freeze({
        contract,
        range,
        status: 'invalid',
        diagnostic: `Compatibility requirement "${contract}" has invalid semantic-version range "${range}".`,
      }))
      continue
    }
    if (knownVersion !== undefined) {
      const compatible = semVerSatisfies(knownVersion, range)
      resolutions.push(Object.freeze({
        contract,
        range,
        status: compatible ? 'compatible' : 'incompatible',
        version: knownVersion,
        ...(!compatible
          ? { diagnostic: `Compatibility requirement "${contract}" range "${range}" does not include host version ${knownVersion}.` }
          : {}),
      }))
      continue
    }
    if (!isCapabilityId(contract)) {
      resolutions.push(Object.freeze({
        contract,
        range,
        status: 'invalid',
        diagnostic: `Unknown compatibility requirement "${contract}" must use a namespace.`,
      }))
      continue
    }
    resolutions.push(Object.freeze({ contract, range, status: 'deferred' }))
  }
  return Object.freeze({
    accepted: resolutions.every(resolution => resolution.status === 'compatible' || resolution.status === 'deferred'),
    resolutions: Object.freeze(resolutions),
  })
}

export interface ExtensionRegistration<Value, Kind extends string = string> {
  readonly identity: ExtensionIdentity<Kind>
  readonly value: Value
}

export interface CompatibilityRemoval {
  /** First release in which the alias may be absent. */
  readonly release: string
  /** ISO date after which removal may ship. */
  readonly date: string
}

export interface CompatibilityAliasDiagnostic {
  readonly code: string
  readonly message: string
  readonly removal: CompatibilityRemoval
}

export interface CompatibilityAlias {
  readonly alias: string
  readonly targetId: `${string}:${string}`
  /** Compatibility aliases are temporary by definition. Stable, preferred
   * short inputs belong on the kind-specific descriptor instead. */
  readonly diagnostic: CompatibilityAliasDiagnostic
}

const KIND_RE = /^[a-z][a-z0-9-]*$/
const LOCAL_ID_RE = /^[a-z0-9][a-z0-9._/-]*$/
/** Preserve the exact immutable identity reference used by disposer guards,
 * while preventing callers from forging a live identity with accessor-backed
 * fields that can diverge after registry keying. */
const VERIFIED_EXTENSION_IDENTITIES = new WeakSet<object>()

interface RegistryMutationState {
  readonly operation: string
  reentrantAttempted: boolean
}

/** The low-level helpers are public and capture caller-owned accessors. A
 * getter must not be able to commit a nested mutation to the same Map while
 * the outer candidate is still being admitted. The shared guard also closes
 * cross-helper reentrancy when a Map is deliberately cast between registries. */
const ACTIVE_REGISTRY_MUTATIONS = new WeakMap<object, RegistryMutationState>()

function beginRegistryMutation(registry: object, operation: string): RegistryMutationState {
  const active = ACTIVE_REGISTRY_MUTATIONS.get(registry)
  if (active) {
    active.reentrantAttempted = true
    throw new Error(`Extension registry mutation is forbidden while ${active.operation} is in progress`)
  }
  const state: RegistryMutationState = { operation, reentrantAttempted: false }
  ACTIVE_REGISTRY_MUTATIONS.set(registry, state)
  return state
}

function assertRegistryMutationAtomic(state: RegistryMutationState): void {
  if (state.reentrantAttempted) {
    throw new Error(`Extension registry mutation is forbidden after a reentrant attempt during ${state.operation}`)
  }
}

function endRegistryMutation(registry: object, state: RegistryMutationState): void {
  if (ACTIVE_REGISTRY_MUTATIONS.get(registry) === state) ACTIVE_REGISTRY_MUTATIONS.delete(registry)
}

export function canonicalExtensionId<Kind extends string>(kind: Kind, localId: string): `${Kind}:${string}` {
  if (!KIND_RE.test(kind)) throw new Error(`Invalid extension kind "${kind}"`)
  if (!LOCAL_ID_RE.test(localId)) {
    throw new Error(`Invalid ${kind} extension local id "${localId}"`)
  }
  return `${kind}:${localId}`
}

export function parseExtensionId(id: string): { kind: string; localId: string } | undefined {
  const separator = id.indexOf(':')
  if (separator <= 0 || separator === id.length - 1 || id.indexOf(':', separator + 1) !== -1) return undefined
  const kind = id.slice(0, separator)
  const localId = id.slice(separator + 1)
  if (!KIND_RE.test(kind) || !LOCAL_ID_RE.test(localId)) return undefined
  return { kind, localId }
}

export function createExtensionIdentity<Kind extends string>(input: {
  id: string
  kind: Kind
  version: string
  compatibility?: ExtensionCompatibility
  provenance: ExtensionProvenance
}): ExtensionIdentity<Kind> {
  // Public registrations may arrive from plain JavaScript, including objects
  // with accessors. Materialize every caller-owned field once so validation,
  // compatibility negotiation, and the returned identity all describe the
  // same request snapshot.
  const id = input.id
  const kind = input.kind
  const version = input.version
  const compatibilityInput = input.compatibility
  const provenanceInput = input.provenance
  const compatibilitySnapshot = Object.freeze({ ...(compatibilityInput ?? {}) })
  const provenanceSnapshot = Object.freeze({ ...provenanceInput })

  const parsed = parseExtensionId(id)
  if (!parsed || parsed.kind !== kind) {
    throw new Error(`Extension id "${id}" must use the "${kind}:" namespace`)
  }
  if (!parseSemVer(version)) {
    throw new Error(`Extension "${id}" requires a semantic version (received "${version}")`)
  }
  if (provenanceSnapshot.owner.trim().length === 0) throw new Error(`Extension "${id}" requires a provenance owner`)
  if (provenanceSnapshot.source.trim().length === 0) throw new Error(`Extension "${id}" requires a provenance source`)

  const identity = Object.freeze({
    id: id as `${Kind}:${string}`,
    kind,
    version,
    compatibility: compatibilitySnapshot,
    provenance: provenanceSnapshot,
  })
  const compatibility = evaluateExtensionCompatibility(identity)
  if (!compatibility.accepted) {
    throw new Error(`Extension "${id}" has incompatible requirements: ${compatibility.resolutions
      .filter(resolution => resolution.status === 'incompatible' || resolution.status === 'invalid')
      .map(resolution => resolution.diagnostic)
      .join('; ')}`)
  }
  VERIFIED_EXTENSION_IDENTITIES.add(identity)
  return identity
}

export class ExtensionCollisionError extends Error {
  readonly code = 'EXTENSION_ID_COLLISION'

  constructor(
    readonly incoming: ExtensionIdentity,
    readonly existing: ExtensionIdentity,
  ) {
    super(
      `Cannot register ${incoming.kind} "${incoming.id}" for owner "${incoming.provenance.owner}": ` +
      `already registered by "${existing.provenance.owner}" at version ${existing.version}`,
    )
    this.name = 'ExtensionCollisionError'
  }
}

/** Register into one existing kind-specific registry without implicit replace. */
export function registerExtension<Value, Kind extends string>(
  registry: Map<string, ExtensionRegistration<Value, Kind>>,
  registration: ExtensionRegistration<Value, Kind>,
): void {
  const mutation = beginRegistryMutation(registry, 'extension registration')
  try {
    const captured = Object.freeze({
      identity: registration.identity,
      value: registration.value,
    })
    if (!VERIFIED_EXTENSION_IDENTITIES.has(captured.identity)) {
      throw new TypeError('Extension registration identity must be created by createExtensionIdentity()')
    }
    const id = captured.identity.id
    const existing = registry.get(id)
    if (existing) throw new ExtensionCollisionError(captured.identity, existing.identity)
    assertRegistryMutationAtomic(mutation)
    registry.set(id, captured)
  } finally {
    endRegistryMutation(registry, mutation)
  }
}

/** Add an alias without implicit retargeting. Canonical IDs may not be aliases. */
export function registerCompatibilityAlias(
  aliases: Map<string, CompatibilityAlias>,
  input: CompatibilityAlias,
): void {
  const mutation = beginRegistryMutation(aliases, 'compatibility alias registration')
  try {
    const alias = input.alias
    const targetId = input.targetId
    const diagnosticInput = input.diagnostic
    const removalInput = diagnosticInput?.removal
    const diagnostic = diagnosticInput && removalInput
      ? Object.freeze({
          code: diagnosticInput.code,
          message: diagnosticInput.message,
          removal: Object.freeze({
            release: removalInput.release,
            date: removalInput.date,
          }),
        })
      : undefined

    if (!LOCAL_ID_RE.test(alias) || alias.includes(':')) {
      throw new Error(`Compatibility alias "${alias}" must be an unqualified legacy name`)
    }
    if (!parseExtensionId(targetId)) {
      throw new Error(`Compatibility alias "${alias}" requires a canonical target id`)
    }
    if (!diagnostic) {
      throw new Error(
        `Compatibility alias "${alias}" requires a diagnostic and removal release/date; ` +
        'use a kind-specific inputName for a stable short input',
      )
    }
    const existing = aliases.get(alias)
    if (existing) {
      throw new Error(`Compatibility alias "${alias}" already targets "${existing.targetId}"`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(diagnostic.removal.date)) {
      throw new Error(`Compatibility alias "${alias}" requires an ISO removal date`)
    }
    if (diagnostic.removal.release.trim().length === 0) {
      throw new Error(`Compatibility alias "${alias}" requires a removal release`)
    }
    assertRegistryMutationAtomic(mutation)
    aliases.set(alias, Object.freeze({
      alias,
      targetId,
      diagnostic,
    }))
  } finally {
    endRegistryMutation(aliases, mutation)
  }
}
