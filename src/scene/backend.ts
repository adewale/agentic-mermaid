// ============================================================================
// StyleBackend interface + DefaultBackend + backend registry (SPEC §3.2).
//
// A backend consumes a SceneDoc and produces the SVG document string. The
// DefaultBackend is the Agentic Mermaid crisp renderer: it emits each mark's
// construction-time crisp serialization verbatim, so its output is
// byte-identical to the pre-IR string renderers (svg-equivalence.test.ts is
// the corpus-wide gate). Styled backends (rough/hybrid) redraw shape and
// connector marks from their semantic fields and re-derive the document shell
// from PreludeMark parameters; they never dispatch on diagram family.
// ============================================================================

import type { SceneDoc, SceneNode } from './ir.ts'
import { indentLines } from './marks.ts'
import type { StyleSpec } from './style-registry.ts'
import { runBackendConformance } from './backend-conformance.ts'
import type { BackendConformanceReport } from './backend-conformance.ts'
import { graphicalBackendCapabilityClaims, validatePrimitiveCapabilities } from './capabilities.ts'
import type { PrimitiveCapabilityClaim } from './capabilities.ts'
import {
  canonicalExtensionId,
  createExtensionIdentity,
  parseExtensionId,
  registerCompatibilityAlias,
  registerExtension,
} from '../shared/extension-identity.ts'
import type {
  CompatibilityAlias,
  ExtensionCompatibility,
  ExtensionIdentity,
  ExtensionProvenance,
  ExtensionRegistration,
} from '../shared/extension-identity.ts'

export interface StyleBackendContext {
  /** User-supplied deterministic re-roll seed (RenderOptions.seed). */
  seed: number
  /** The selected style (undefined on the crisp default path). */
  style?: StyleSpec
}

export interface StyleBackend {
  id: string
  /** Versioned, feature/operation-level support claims for this Scene consumer. */
  readonly capabilities: readonly PrimitiveCapabilityClaim[]
  /** Serialize one top-level mark (recursing through groups). */
  drawNode(node: SceneNode, ctx: StyleBackendContext): string
  /** Serialize the whole document. */
  render(doc: SceneDoc, ctx: StyleBackendContext): string
}

export interface BackendRegistrationOptions {
  readonly version?: string
  readonly compatibility?: ExtensionCompatibility
  readonly provenance?: ExtensionProvenance
}

export interface BackendDescriptor {
  readonly identity: ExtensionIdentity<'backend'>
  readonly backend: StyleBackend
  readonly aliases: readonly string[]
  /** Executed registration smoke. Capability claims remain declarations; this
   * report proves only its named frozen SVG fixture and checks. */
  readonly conformance: BackendConformanceReport
  readonly capabilities: readonly PrimitiveCapabilityClaim[]
}

export interface HostBackendSelection {
  /** Backend capability inferred from declarative appearance. */
  readonly requestedId: string
  /** Canonical registry identity, when the requested backend is registered. */
  readonly canonicalId?: string
  readonly registered: readonly BackendDescriptor[]
}

/**
 * Trusted, in-process backend selection escape hatch. The callback makes this
 * capability non-serializable by construction: it cannot enter StyleSpec,
 * BrandPack, CLI, MCP, or editor payloads.
 */
export interface HostBackendPolicy {
  readonly selectBackend: (
    selection: HostBackendSelection,
  ) => string | null | undefined
}

/** Recompose a group from (possibly restyled) child serializations using the
 *  group's own indent/join rules. Shared by all backends so wrapper semantics
 *  (classes, data-*, ARIA) stay identical across styles. */
export function composeGroup(
  open: string,
  close: string,
  join: string,
  children: Array<{ serialized: string; indent: number }>,
): string {
  return [open, ...children.map(c => indentLines(c.serialized, c.indent)), close].join(join)
}

/** Styled documents carry an explicit page rect after the prelude — resvg
 *  does not paint the root style="background:…" CSS (SPEC §10). Emitted by
 *  every backend when a style is active and the document isn't transparent;
 *  the crisp path (no style) is byte-identical to previous releases. */
export function pageRectFor(doc: SceneDoc, ctx: StyleBackendContext): string {
  const prelude = doc.parts[0]
  if (!ctx.style || prelude?.kind !== 'prelude' || prelude.prelude.transparent) return ''
  return `<rect width="${doc.width}" height="${doc.height}" fill="var(--bg)" data-backdrop="page" />`
}

export const DefaultBackend: StyleBackend = {
  id: 'default',
  capabilities: graphicalBackendCapabilityClaims('backend:default', 'crisp'),
  drawNode(node: SceneNode): string {
    return node.crisp
  },
  render(doc: SceneDoc, ctx: StyleBackendContext): string {
    const pageRect = pageRectFor(doc, ctx)
    if (!pageRect) return doc.parts.map(part => part.crisp).join('\n')
    return doc.parts
      .map((part, i) => (i === 0 ? `${part.crisp}\n${pageRect}` : part.crisp))
      .join('\n')
  },
}

const CORE_BACKEND_VERSION = '1.0.0'
const CORE_BACKEND_COMPATIBILITY = Object.freeze({ core: '^0.1.1', scene: '1' })
const CORE_BACKEND_PROVENANCE = Object.freeze({
  owner: 'agentic-mermaid',
  source: 'built-in',
  reference: 'src/scene/backend.ts',
})
const HOST_BACKEND_PROVENANCE = Object.freeze({ owner: 'host', source: 'in-process' })

const BACKENDS = new Map<string, ExtensionRegistration<StyleBackend, 'backend'>>()
const BACKEND_ALIASES = new Map<string, CompatibilityAlias>()
const BACKEND_CONFORMANCE = new Map<string, BackendConformanceReport>()

function backendIdentity(id: string, options: BackendRegistrationOptions): ExtensionIdentity<'backend'> {
  return createExtensionIdentity({
    id,
    kind: 'backend',
    version: options.version ?? CORE_BACKEND_VERSION,
    compatibility: options.compatibility ?? CORE_BACKEND_COMPATIBILITY,
    provenance: options.provenance ?? HOST_BACKEND_PROVENANCE,
  })
}

function validateBackendCapabilities(backend: StyleBackend, canonicalId: string): void {
  if (!Array.isArray(backend.capabilities)) {
    throw new Error(`Backend "${backend.id}" must declare capability claims`)
  }
  const validation = validatePrimitiveCapabilities(backend.capabilities)
  if (!validation.valid) throw new Error(`Backend "${backend.id}" has invalid capabilities: ${validation.diagnostics.join('; ')}`)
  if (backend.capabilities.length === 0) throw new Error(`Backend "${backend.id}" must declare capability claims`)
  const wrongTarget = backend.capabilities.find(claim => claim.target !== canonicalId)
  if (wrongTarget) throw new Error(`Backend "${backend.id}" capability target must be "${canonicalId}"`)
  const unevidenced = backend.capabilities.find(claim => !claim.evidence?.trim())
  if (unevidenced) {
    throw new Error(`Backend "${backend.id}" capability ${unevidenced.primitive}/${unevidenced.feature}/${unevidenced.operation} must declare evidence`)
  }
  const essentialClaims = [
    ['document', 'serialize'],
    ['text', 'render'],
    ['shape', 'render'],
    ['container', 'render'],
    ['connector', 'render'],
    ['marker', 'render'],
    ['data-mark', 'render'],
  ] as const
  for (const [primitive, operation] of essentialClaims) {
    if (!backend.capabilities.some(claim => claim.primitive === primitive && claim.operation === operation)) {
      throw new Error(`Backend "${backend.id}" must declare an evidenced essential ${primitive}/${operation} capability`)
    }
  }
}

function snapshotBackendCapabilities(
  capabilities: readonly PrimitiveCapabilityClaim[],
): readonly PrimitiveCapabilityClaim[] {
  return Object.freeze(capabilities.map(claim => Object.freeze({ ...claim })))
}

/** Capture the registration surface once. Methods execute with the frozen
 * snapshot as `this`, so replacing methods or scalar fields on the caller's
 * original object cannot change registered rendering behavior. */
function snapshotBackend(backend: StyleBackend): StyleBackend {
  const drawNode = backend.drawNode
  const render = backend.render
  const snapshot: StyleBackend = {
    ...backend,
    id: backend.id,
    capabilities: snapshotBackendCapabilities(backend.capabilities),
    drawNode(node, ctx) {
      return drawNode.call(snapshot, node, ctx)
    },
    render(doc, ctx) {
      return render.call(snapshot, doc, ctx)
    },
  }
  return Object.freeze(snapshot)
}

/** Built-ins retain their historical object identity while receiving the same
 * frozen capability/method surface as host registrations. */
function freezeBuiltInBackend(backend: StyleBackend): StyleBackend {
  const mutable = backend as { capabilities: readonly PrimitiveCapabilityClaim[] }
  mutable.capabilities = snapshotBackendCapabilities(backend.capabilities)
  return Object.freeze(backend)
}

/** Register a host backend by canonical `backend:*` identity. */
export function registerBackend(backend: StyleBackend, options: BackendRegistrationOptions = {}): () => void {
  const parsed = parseExtensionId(backend.id)
  if (!parsed || parsed.kind !== 'backend') {
    throw new Error(`registerBackend id "${backend.id}" must use the "backend:" namespace`)
  }
  validateBackendCapabilities(backend, backend.id)
  const id = backend.id
  const snapshot = snapshotBackend(backend)
  const conformance = runBackendConformance(snapshot, id)
  if (!conformance.passed) {
    const failures = conformance.checks
      .filter(check => !check.passed)
      .map(check => `${check.id}${check.diagnostic ? `: ${check.diagnostic}` : ''}`)
    throw new Error(`Backend "${backend.id}" failed registration SVG conformance: ${failures.join('; ')}`)
  }
  registerExtension(BACKENDS, {
    identity: backendIdentity(id, options),
    value: snapshot,
  })
  BACKEND_CONFORMANCE.set(id, conformance)
  const registration = BACKENDS.get(id)!
  return () => {
    // An old token must not remove a later registration that reused the id
    // after this registration was explicitly removed.
    if (BACKENDS.get(id) !== registration) return
    BACKENDS.delete(id)
    BACKEND_CONFORMANCE.delete(id)
  }
}

/** Internal built-in enrollment retains the legacy short runtime id as alias. */
export function registerBuiltInBackend(backend: StyleBackend): void {
  const id = canonicalExtensionId('backend', backend.id)
  validateBackendCapabilities(backend, id)
  const frozen = freezeBuiltInBackend(backend)
  const conformance = runBackendConformance(frozen, id)
  if (!conformance.passed) {
    const failures = conformance.checks
      .filter(check => !check.passed)
      .map(check => `${check.id}${check.diagnostic ? `: ${check.diagnostic}` : ''}`)
    throw new Error(`Built-in backend "${backend.id}" failed registration SVG conformance: ${failures.join('; ')}`)
  }
  registerExtension(BACKENDS, {
    identity: backendIdentity(id, {
      version: CORE_BACKEND_VERSION,
      compatibility: CORE_BACKEND_COMPATIBILITY,
      provenance: CORE_BACKEND_PROVENANCE,
    }),
    value: frozen,
  })
  BACKEND_CONFORMANCE.set(id, conformance)
  registerCompatibilityAlias(BACKEND_ALIASES, { alias: backend.id, targetId: id })
}

export function knownBackendDescriptors(): readonly BackendDescriptor[] {
  return Object.freeze(Array.from(BACKENDS.values(), ({ identity, value }) => Object.freeze({
    identity,
    backend: value,
    aliases: Object.freeze(Array.from(BACKEND_ALIASES.values())
      .filter(alias => alias.targetId === identity.id)
      .map(alias => alias.alias)),
    conformance: BACKEND_CONFORMANCE.get(identity.id)!,
    capabilities: Object.freeze(value.capabilities.map(claim => Object.freeze({ ...claim }))),
  })))
}

function backendDescriptorFromSnapshot(
  registered: readonly BackendDescriptor[],
  id: string,
): BackendDescriptor | undefined {
  return registered.find(descriptor =>
    descriptor.identity.id === id || descriptor.aliases.includes(id))
}

/**
 * Resolve one exact immutable registry descriptor. Host policy receives and
 * selects from the same snapshot returned here, so registry mutation inside
 * the callback cannot swap the implementation after selection.
 *
 * This is an internal execution-planning seam; public callers normally use
 * getBackend(), which projects only the backend value.
 */
export function getBackendDescriptor(
  id: string,
  policy?: HostBackendPolicy,
): BackendDescriptor | undefined {
  const registered = knownBackendDescriptors()
  const requested = backendDescriptorFromSnapshot(registered, id)
  if (!policy) return requested

  const selected = policy.selectBackend(Object.freeze({
    requestedId: id,
    ...(requested ? { canonicalId: requested.identity.id } : {}),
    registered,
  }))
  if (selected === null) return undefined
  if (typeof selected === 'string') return backendDescriptorFromSnapshot(registered, selected)
  return requested
}

export function getBackend(id: string, policy?: HostBackendPolicy): StyleBackend | undefined {
  return getBackendDescriptor(id, policy)?.backend
}

registerBuiltInBackend(DefaultBackend)
