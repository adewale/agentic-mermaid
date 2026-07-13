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
  readonly diagnostic?: CompatibilityAliasDiagnostic
}

const KIND_RE = /^[a-z][a-z0-9-]*$/
const LOCAL_ID_RE = /^[a-z0-9][a-z0-9._/-]*$/

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
  const parsed = parseExtensionId(input.id)
  if (!parsed || parsed.kind !== input.kind) {
    throw new Error(`Extension id "${input.id}" must use the "${input.kind}:" namespace`)
  }
  if (!parseSemVer(input.version)) {
    throw new Error(`Extension "${input.id}" requires a semantic version (received "${input.version}")`)
  }
  if (input.provenance.owner.trim().length === 0) throw new Error(`Extension "${input.id}" requires a provenance owner`)
  if (input.provenance.source.trim().length === 0) throw new Error(`Extension "${input.id}" requires a provenance source`)

  const identity = Object.freeze({
    id: input.id as `${Kind}:${string}`,
    kind: input.kind,
    version: input.version,
    compatibility: Object.freeze({ ...(input.compatibility ?? {}) }),
    provenance: Object.freeze({ ...input.provenance }),
  })
  const compatibility = evaluateExtensionCompatibility(identity)
  if (!compatibility.accepted) {
    throw new Error(`Extension "${input.id}" has incompatible requirements: ${compatibility.resolutions
      .filter(resolution => resolution.status === 'incompatible' || resolution.status === 'invalid')
      .map(resolution => resolution.diagnostic)
      .join('; ')}`)
  }
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
  const existing = registry.get(registration.identity.id)
  if (existing) throw new ExtensionCollisionError(registration.identity, existing.identity)
  registry.set(registration.identity.id, Object.freeze({ ...registration }))
}

/** Add an alias without implicit retargeting. Canonical IDs may not be aliases. */
export function registerCompatibilityAlias(
  aliases: Map<string, CompatibilityAlias>,
  input: CompatibilityAlias,
): void {
  if (!LOCAL_ID_RE.test(input.alias) || input.alias.includes(':')) {
    throw new Error(`Compatibility alias "${input.alias}" must be an unqualified legacy name`)
  }
  if (!parseExtensionId(input.targetId)) {
    throw new Error(`Compatibility alias "${input.alias}" requires a canonical target id`)
  }
  const existing = aliases.get(input.alias)
  if (existing) {
    throw new Error(`Compatibility alias "${input.alias}" already targets "${existing.targetId}"`)
  }
  if (input.diagnostic) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.diagnostic.removal.date)) {
      throw new Error(`Compatibility alias "${input.alias}" requires an ISO removal date`)
    }
    if (input.diagnostic.removal.release.trim().length === 0) {
      throw new Error(`Compatibility alias "${input.alias}" requires a removal release`)
    }
  }
  aliases.set(input.alias, Object.freeze({
    ...input,
    ...(input.diagnostic
      ? {
          diagnostic: Object.freeze({
            ...input.diagnostic,
            removal: Object.freeze({ ...input.diagnostic.removal }),
          }),
        }
      : {}),
  }))
}
