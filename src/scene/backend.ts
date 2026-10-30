import { PACKAGE_VERSION } from '../version.ts'
import { observeCache } from '../performance-observations.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
// ============================================================================
// StyleBackend interface + DefaultBackend + backend registry (SPEC §3.2).
//
// A backend consumes a SceneDoc and produces the SVG document string. The
// DefaultBackend is the Agentic Mermaid precise renderer: it emits each mark's
// canonical projection, not its construction-time byte order. Styled backends (rough/hybrid) redraw shape and
// connector marks from their semantic fields and re-derive the document shell
// from the admitted Scene serialization; they never dispatch on diagram family.
// ============================================================================

import type { SceneDoc, SceneNode } from './ir.ts'
import { indentLines } from './marks.ts'
import type { StyleSpec } from './style-registry.ts'
import { backendWithAdmittedConformanceFixture, runBackendConformance } from './backend-conformance.ts'
import type { BackendConformanceReport } from './backend-conformance.ts'
import {
  ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES,
  graphicalBackendCapabilityClaims,
  validatePrimitiveCapabilities,
} from './capabilities.ts'
import type { PrimitiveCapabilityClaim } from './capabilities.ts'
import { admitBackendSceneDocument } from './external-data-snapshot.ts'
import { sceneNodeSerialization } from './serialization.ts'
import { capturedPart } from './part-capture.ts'
import {
  canonicalExtensionId,
  createExtensionIdentity,
  parseExtensionId,
  registerExtension,
  requireExtensionContractCompatibility,
} from '../shared/extension-identity.ts'
import type {
  ExtensionCompatibility,
  ExtensionIdentity,
  ExtensionProvenance,
  ExtensionRegistration,
} from '../shared/extension-identity.ts'

export interface StyleBackendContext {
  /** User-supplied deterministic re-roll seed (RenderOptions.seed). */
  seed: number
  /** The selected style (undefined on the default path). */
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
  readonly compatibility: ExtensionCompatibility & {
    readonly core: string
    readonly scene: string
  }
  readonly provenance?: ExtensionProvenance
}

export interface BackendDescriptor {
  readonly identity: ExtensionIdentity<'backend'>
  readonly backend: StyleBackend
  /** Stable preferred input for first-party backends. */
  readonly inputName: string
  /** Claim-keyed executable SVG conformance: run at registration for a host
   * backend, and at first use (draw, render or this read) for a built-in. */
  readonly conformance: BackendConformanceReport
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

/** Capture a bound renderer's caller-owned policy exactly once. This freezes
 * the selector reference and property surface; variables intentionally closed
 * over by the selector remain host-owned state. */
export function snapshotHostBackendPolicy(policy: HostBackendPolicy | undefined): HostBackendPolicy | undefined {
  if (policy === undefined) return undefined
  if ((typeof policy !== 'object' && typeof policy !== 'function') || policy === null) {
    throw new TypeError('backendPolicy must be an object with a selectBackend function')
  }
  const selectBackend = policy.selectBackend
  if (typeof selectBackend !== 'function') {
    throw new TypeError('backendPolicy.selectBackend must be a function')
  }
  let snapshot: HostBackendPolicy
  snapshot = Object.freeze({
    selectBackend(selection: HostBackendSelection): string | null | undefined {
      return Reflect.apply(selectBackend, snapshot, [selection])
    },
  })
  return snapshot
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
 *  every backend when a style is active and the document isn't transparent. */
export function pageRectFor(doc: Pick<SceneDoc, 'width' | 'height' | 'transparent'>, ctx: StyleBackendContext): string {
  if (!ctx.style || doc.transparent) return ''
  return `<rect width="${formatSvgNumber(doc.width)}" height="${formatSvgNumber(doc.height)}" fill="var(--bg)" data-backdrop="page" />`
}

export const DefaultBackend: StyleBackend = {
  id: 'default',
  capabilities: graphicalBackendCapabilityClaims('backend:default', 'crisp'),
  drawNode(node: SceneNode): string {
    return sceneNodeSerialization(node)
  },
  render(doc: SceneDoc, ctx: StyleBackendContext): string {
    const admitted = admitBackendSceneDocument(doc)
    const pageRect = pageRectFor(admitted, ctx)
    return admitted.parts.map((part, i) => {
      const svg = capturedPart(ctx, part, sceneNodeSerialization(part))
      return pageRect && i === 0 ? `${svg}\n${pageRect}` : svg
    }).join('\n')
  },
}

const OWNED_DEFAULT_RENDERERS = new WeakSet<StyleBackend['render']>([DefaultBackend.render])
const ORIGINAL_DEFAULT_FIELDS = Object.getOwnPropertyDescriptors(DefaultBackend)
let enrolledOriginalDefault: StyleBackend | undefined

/** Only our unchanged own-data implementation may reuse the private fixture.
 * Check identity first so custom backends and Proxies observe no new reads. */
function hasOriginalDefaultImplementation(backend: StyleBackend): boolean {
  if (backend !== DefaultBackend) return false
  for (const field of ['id', 'capabilities', 'drawNode', 'render'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(backend, field)
    if (!descriptor || !('value' in descriptor) || descriptor.value !== ORIGINAL_DEFAULT_FIELDS[field]!.value) return false
  }
  return true
}

/** A replacement method must use the checked backend path. */
export function isBuiltinDefaultBackend(backend: StyleBackend): boolean {
  return backend === DefaultBackend && OWNED_DEFAULT_RENDERERS.has(backend.render)
}

/** Match the original implementation after enrollment wrapped and froze it. */
export function isOriginalEnrolledDefaultBackend(backend: unknown): boolean {
  return enrolledOriginalDefault !== undefined && backend === enrolledOriginalDefault
}

const CORE_BACKEND_VERSION = '1.0.0'
const CORE_BACKEND_COMPATIBILITY = Object.freeze({ core: PACKAGE_VERSION, scene: '^2.0.0' })
const CORE_BACKEND_PROVENANCE = Object.freeze({
  owner: 'agentic-mermaid',
  source: 'built-in',
  reference: 'src/scene/backend.ts',
})
const HOST_BACKEND_PROVENANCE = Object.freeze({ owner: 'host', source: 'in-process' })

const BACKENDS = new Map<string, ExtensionRegistration<StyleBackend, 'backend'>>()
const BACKEND_INPUT_NAMES = new Map<string, string>()
const BACKEND_CONFORMANCE = new Map<string, () => BackendConformanceReport>()
// Internal selection reuses one immutable registry snapshot until publication
// changes. Public discovery still returns its ordinary fresh descriptor array.
let selectionSnapshot: readonly BackendDescriptor[] | undefined

/** Registration executes caller-owned methods. Keep every registry mutation
 * outside that executable window so a callback cannot install/uninstall a
 * sibling backend or observe a half-committed candidate. */
let backendConformanceCandidate: string | null = null

interface BuiltInConformance {
  readonly report: () => BackendConformanceReport
  readonly running: () => boolean
}

/** Running every built-in backend's executable SVG conformance at import cost
 * each process tens to hundreds of milliseconds, mostly for sketch backends a
 * render may never use. A built-in's report is computed once, on its first
 * draw or render or the first read of its descriptor, inside the same
 * mutation guard as a registration. */
function lazyBuiltInConformance(backend: StyleBackend, id: string, originalDefault: boolean): BuiltInConformance {
  let report: BackendConformanceReport | undefined
  let running = false
  return {
    running: () => running,
    report: () => {
      if (report) return report
      const outer = backendConformanceCandidate
      backendConformanceCandidate = id
      running = true
      try {
        report = runBackendConformance(originalDefault ? backendWithAdmittedConformanceFixture(backend) : backend, id)
      } finally {
        running = false
        backendConformanceCandidate = outer
      }
      return report
    },
  }
}

/** A built-in proves its conformance before it first draws or renders, as a
 * host backend does before it registers, so a built-in that fails in this
 * runtime never produces output. Direct calls on a registered built-in, such
 * as `DefaultBackend.render`, are covered too. Calls made while its
 * conformance runs pass through: that run executes only the conformance
 * fixtures and never calls host code, so no caller sees unproven output. */
export function assertBackendConformance(report: BackendConformanceReport, inputName: string): void {
  if (report.passed) return
  const failures = report.checks.filter(check => !check.passed)
    .map(check => `${check.id}${check.diagnostic ? `: ${check.diagnostic}` : ''}`)
  throw new Error(`Built-in backend "${inputName}" failed SVG conformance: ${failures.join('; ')}`)
}

function refuseUntilConforming(backend: StyleBackend, inputName: string, conformance: BuiltInConformance): StyleBackend {
  const methods = backend as { drawNode: StyleBackend['drawNode']; render: StyleBackend['render'] }
  const { drawNode, render } = backend
  let proven = false
  const prove = (): void => {
    if (proven || conformance.running()) return
    const report = conformance.report()
    assertBackendConformance(report, inputName)
    proven = true
  }
  methods.drawNode = (node, ctx) => {
    prove()
    return drawNode.call(backend, node, ctx)
  }
  methods.render = (doc, ctx) => {
    prove()
    return render.call(backend, doc, ctx)
  }
  if (backend === DefaultBackend && OWNED_DEFAULT_RENDERERS.has(render)) OWNED_DEFAULT_RENDERERS.add(methods.render)
  return backend
}

function assertBackendRegistryMutationAllowed(): void {
  if (backendConformanceCandidate !== null) {
    throw new Error(`Backend registry mutation is forbidden while candidate "${backendConformanceCandidate}" is undergoing conformance`)
  }
}

function backendIdentity(id: string, options: BackendRegistrationOptions): ExtensionIdentity<'backend'> {
  return createExtensionIdentity({
    id,
    kind: 'backend',
    version: options.version ?? CORE_BACKEND_VERSION,
    // Host extensions must state the wire contracts they consume. Only the
    // internal built-in enrollment path supplies first-party defaults.
    compatibility: options.compatibility,
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
  for (const { primitive, feature, operation } of ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES) {
    if (!backend.capabilities.some(claim => claim.primitive === primitive && claim.feature === feature && claim.operation === operation)) {
      throw new Error(`Backend "${backend.id}" must declare an evidenced essential ${primitive}/${feature}/${operation} capability`)
    }
  }
}

function snapshotBackendCapabilities(
  capabilities: readonly PrimitiveCapabilityClaim[],
): readonly PrimitiveCapabilityClaim[] {
  const fields = [
    'target',
    'primitive',
    'feature',
    'operation',
    'realization',
    'evidence',
    'diagnostic',
  ] as const satisfies readonly (keyof PrimitiveCapabilityClaim)[]
  return Object.freeze(capabilities.map(claim => {
    const isObject = (typeof claim === 'object' || typeof claim === 'function') && claim !== null
    const source = isObject ? claim as unknown as object : undefined
    const captured = source
      ? { ...(source as Record<PropertyKey, unknown>) } as Record<PropertyKey, unknown>
      : {} as Record<PropertyKey, unknown>
    // Claim fields may legally arrive through a prototype or a non-enumerable
    // property. Capture those once too; validation still decides whether the
    // resulting values satisfy the capability contract.
    if (source) {
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(captured, field)) {
          captured[field] = Reflect.get(source, field)
        }
      }
    }
    return Object.freeze(captured as unknown as PrimitiveCapabilityClaim)
  }))
}

function capturedBackendField(
  captured: Readonly<Record<PropertyKey, unknown>>,
  source: object,
  key: keyof StyleBackend,
): unknown {
  return Object.prototype.hasOwnProperty.call(captured, key)
    ? captured[key]
    : Reflect.get(source, key)
}

/** Capture every enumerable field and each required inherited/non-enumerable
 * field exactly once. Validation and conformance must never return to the
 * caller-owned object: accessor-backed candidates could otherwise present one
 * value while being checked and publish another value afterward. Methods
 * execute with the frozen snapshot as `this`, so later caller mutation cannot
 * change registered rendering behavior. */
function snapshotBackend(backend: StyleBackend): StyleBackend {
  if ((typeof backend !== 'object' && typeof backend !== 'function') || backend === null) {
    throw new TypeError('registerBackend requires a backend object')
  }
  const source = backend as unknown as object
  // Object spread materializes accessor values as data properties. Read a
  // required field from the source only when it was not an enumerable own
  // property and therefore was not captured by the spread.
  const captured = { ...(source as Record<PropertyKey, unknown>) } as Record<PropertyKey, unknown>
  const idValue = capturedBackendField(captured, source, 'id')
  if (typeof idValue !== 'string') throw new TypeError('registerBackend id must be a string')
  const capabilitiesValue = capturedBackendField(captured, source, 'capabilities')
  if (!Array.isArray(capabilitiesValue)) {
    throw new Error(`Backend "${idValue}" must declare capability claims`)
  }
  const drawNode = capturedBackendField(captured, source, 'drawNode') as StyleBackend['drawNode']
  const render = capturedBackendField(captured, source, 'render') as StyleBackend['render']
  const snapshot: StyleBackend = {
    ...captured,
    id: idValue,
    capabilities: snapshotBackendCapabilities(capabilitiesValue),
    drawNode(node, ctx) {
      return drawNode.call(snapshot, node, ctx)
    },
    render(doc, ctx) {
      return render.call(snapshot, admitBackendSceneDocument(doc), ctx)
    },
  }
  return Object.freeze(snapshot)
}

/** Built-in backend instances receive the same frozen capability/method
 * surface as host registrations. */
function freezeBuiltInBackend(backend: StyleBackend): StyleBackend {
  const mutable = backend as {
    capabilities: readonly PrimitiveCapabilityClaim[]
  }
  mutable.capabilities = snapshotBackendCapabilities(backend.capabilities)
  // Built-ins admit documents at their own public render boundary, including
  // direct imports, and avoid a second validation pass after
  // registry selection; host backends remain wrapped by snapshotBackend().
  return Object.freeze(backend)
}

/** Register a host backend by canonical `backend:*` identity. */
export function registerBackend(backend: StyleBackend, options: BackendRegistrationOptions): () => void {
  assertBackendRegistryMutationAllowed()
  backendConformanceCandidate = '<unread>'
  try {
    if (!options || typeof options !== 'object') {
      throw new TypeError('registerBackend options with explicit core and Scene compatibility ranges are required')
    }
    const snapshot = snapshotBackend(backend)
    const id = snapshot.id
    backendConformanceCandidate = id
    const parsed = parseExtensionId(id)
    if (!parsed || parsed.kind !== 'backend') {
      throw new Error(`registerBackend id "${id}" must use the "backend:" namespace`)
    }
    const identity = backendIdentity(id, options)
    requireExtensionContractCompatibility(identity, 'core')
    requireExtensionContractCompatibility(identity, 'scene')
    validateBackendCapabilities(snapshot, id)
    const conformance = runBackendConformance(snapshot, id)
    if (!conformance.passed) {
      const failures = conformance.checks
        .filter(check => !check.passed)
        .map(check => `${check.id}${check.diagnostic ? `: ${check.diagnostic}` : ''}`)
      throw new Error(`Backend "${id}" failed registration SVG conformance: ${failures.join('; ')}`)
    }
    // No caller-owned code runs after this point. Publish the immutable value
    // and its proof together during the same synchronous mutation window.
    registerExtension(BACKENDS, { identity, value: snapshot })
    BACKEND_CONFORMANCE.set(id, () => conformance)
    selectionSnapshot = undefined
    const registration = BACKENDS.get(id)!
    return () => {
      assertBackendRegistryMutationAllowed()
      // An old token must not remove a later registration that reused the id
      // after this registration was explicitly removed.
      if (BACKENDS.get(id) !== registration) return
      BACKENDS.delete(id)
      BACKEND_CONFORMANCE.delete(id)
      selectionSnapshot = undefined
    }
  } finally {
    backendConformanceCandidate = null
  }
}

const BUILT_IN_BACKEND_VALUES = new WeakSet<StyleBackend>()

/** True only for a backend enrolled by core, never for a host registration. */
export function isBuiltInBackend(backend: StyleBackend): boolean {
  return BUILT_IN_BACKEND_VALUES.has(backend)
}

/** Internal built-in enrollment publishes the short runtime id as a stable
 * input name. Stable names are deliberately not compatibility aliases. */
export function registerBuiltInBackend(backend: StyleBackend): void {
  assertBackendRegistryMutationAllowed()
  backendConformanceCandidate = '<built-in>'
  try {
    const inputName = backend.id
    const id = canonicalExtensionId('backend', inputName)
    backendConformanceCandidate = id
    const existingInput = BACKEND_INPUT_NAMES.get(inputName)
    if (existingInput !== undefined) throw new Error(`Backend input name "${inputName}" already selects "${existingInput}"`)
    const originalDefault = hasOriginalDefaultImplementation(backend)
    validateBackendCapabilities(backend, id)
    const conformance = lazyBuiltInConformance(backend, id, originalDefault)
    const frozen = freezeBuiltInBackend(refuseUntilConforming(backend, inputName, conformance))
    registerExtension(BACKENDS, {
      identity: backendIdentity(id, {
        version: CORE_BACKEND_VERSION,
        compatibility: CORE_BACKEND_COMPATIBILITY,
        provenance: CORE_BACKEND_PROVENANCE,
      }),
      value: frozen,
    })
    BACKEND_CONFORMANCE.set(id, conformance.report)
    BACKEND_INPUT_NAMES.set(inputName, id)
    BUILT_IN_BACKEND_VALUES.add(frozen)
    if (originalDefault) enrolledOriginalDefault = frozen
    selectionSnapshot = undefined
  } finally {
    backendConformanceCandidate = null
  }
}

export function knownBackendDescriptors(): readonly BackendDescriptor[] {
  return Object.freeze(Array.from(BACKENDS.values(), ({ identity, value }) => {
    const conformance = BACKEND_CONFORMANCE.get(identity.id)!
    return Object.freeze({
      identity,
      backend: value,
      inputName: Array.from(BACKEND_INPUT_NAMES.entries()).find(([, target]) => target === identity.id)?.[0] ?? identity.id,
      get conformance() {
        return conformance()
      },
    })
  }))
}

function backendDescriptorFromSnapshot(
  registered: readonly BackendDescriptor[],
  id: string,
): BackendDescriptor | undefined {
  return registered.find(descriptor =>
    descriptor.identity.id === id
    || descriptor.inputName === id)
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
  observeCache('backend-registry', policy ? 'bypass' : selectionSnapshot ? 'hit' : 'miss')
  const registered = policy ? knownBackendDescriptors() : (selectionSnapshot ??= knownBackendDescriptors())
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
