/**
 * Identity metadata shared by the kind-specific extension registries.
 *
 * This module deliberately does not provide a global extension registry:
 * families, styles, backends, resources, and roles retain their own typed
 * registries and share only naming, provenance, version, and collision rules.
 */

import { parseSemVer } from '../capability-negotiation.ts'

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

  return Object.freeze({
    id: input.id as `${Kind}:${string}`,
    kind: input.kind,
    version: input.version,
    compatibility: Object.freeze({ ...(input.compatibility ?? {}) }),
    provenance: Object.freeze({ ...input.provenance }),
  })
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
