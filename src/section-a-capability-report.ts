// ============================================================================
// Section A capability report.
//
// This is a projection, not another inventory. Every row is derived from a
// live contract authority: render fields/outputs, family/backend registries,
// Scene vocabularies, the pinned upstream manifest, and the existing
// consolidation-characterization index. The Markdown document is generated
// from the same JSON-safe object and guarded by a freshness test.
// ============================================================================

import './scene/builtin-backends.ts'

import { compareCodePointStrings } from './shared/deterministic-order.ts'
import characterizationIndex from '../docs/design/system/consolidation-characterization.json'
import {
  FAMILY_CAPABILITY_COLUMNS,
  FAMILY_CONFORMANCE_VERSION,
  UNREGISTERED_FAMILY_CAPABILITY_STATES,
  effectiveFamilyCapabilityState,
  getFamily,
  getFamilyConformanceReport,
  isBuiltinFamilyId,
  knownFamilies,
  type FamilyCapability,
  type FamilyCapabilityEvidence,
  type FamilyDescriptor,
  type FamilyConformanceReport,
  type FamilyScenePrimitiveEvidence,
} from './agent/families.ts'
import {
  FAMILY_SCOPED_RENDER_OPTION_FIELDS,
  NON_SERIALIZABLE_RENDER_OPTION_FIELDS,
  RENDER_CONTRACT_VERSION,
  RENDER_OUTPUT_DESCRIPTORS,
  RENDER_TRANSPORT_SURFACES,
  SHARED_RENDER_OPTION_FIELDS,
  applicableFamilyScopedRenderOptions,
  renderContractDigest,
  sharedRenderOptionsJsonSchema,
  type FamilyScopedRenderOptionField,
  type RenderOutputTransports,
  type RenderTransportSurface,
  type SharedRenderOptionField,
} from './render-contract.ts'
import {
  SHARED_RENDER_OPTION_SURFACE_CLAIMS,
  SHARED_RENDER_OPTION_SURFACE_EVIDENCE,
  SHARED_RENDER_OPTION_SURFACE_STATES,
  type SharedRenderOptionSurfaceClaim,
} from './render-surface-policy.ts'
import { RESOURCE_MANIFEST, validateResourceManifest } from './font-manifest.ts'
import { RESOURCE_MANIFEST_VERSION } from './resource-manifest.ts'
import { knownBackendDescriptors, type BackendDescriptor } from './scene/backend.ts'
import {
  BACKEND_CONFORMANCE_CHECK_IDS,
  BACKEND_CONFORMANCE_VERSION,
  type BackendCapabilityConformanceResult,
  type BackendConformanceReport,
} from './scene/backend-conformance.ts'
import {
  CORE_SCENE_FEATURES,
  CORE_SCENE_OPERATIONS,
  CORE_SCENE_PRIMITIVES,
  PRIMITIVE_REALIZATIONS,
  primitiveCapabilityClaimKey,
  validatePrimitiveCapabilities,
} from './scene/capabilities.ts'
import { SCENE_CONTRACT_VERSION } from './scene/ir.ts'
import { BUILTIN_SCENE_ROLE_TRAITS } from './scene/roles.ts'
import { OUTPUT_COLOR_PROFILE } from './output-color-profile.ts'
import { OUTPUT_SECURITY_POLICY_VERSION } from './output-security.ts'
import {
  NATIVE_PNG_HOST_ONLY_OPTION_FIELDS,
  PNG_OUTPUT_POLICY_VERSION,
  PNG_OUTPUT_OPTION_FIELDS,
  PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS,
  PORTABLE_PNG_OUTPUT_OPTION_FIELDS,
  pngOutputOptionsJsonSchema,
} from './png-contract.ts'
import { TERMINAL_STYLE_VERSION } from './terminal-style.ts'
import { TERMINAL_OUTPUT_POLICY_VERSION } from './terminal-contract.ts'
import {
  UPSTREAM_MERMAID_MANIFEST,
  validateUpstreamMermaidManifest,
  type AgenticHeaderStatus,
  type UpstreamFamilyDescriptor,
} from './upstream-mermaid-manifest.ts'
import {
  classifyMermaidFamilyFromFirstLine,
  familyDetectionDiagnostic,
} from './family-detection.ts'
import {
  FAMILY_SYNTAX_STATES,
  createSyntaxCapabilityLedger,
  validateSyntaxCapabilityLedger,
  type SyntaxCapabilityLedger,
} from './syntax-capability-ledger.ts'

export const SECTION_A_CAPABILITY_REPORT_SCHEMA_VERSION = 12 as const

export { FAMILY_CAPABILITY_COLUMNS, UNREGISTERED_FAMILY_CAPABILITY_STATES }
export type FamilyCapabilityColumn = FamilyCapability
export type FamilyCapabilityState = FamilyCapabilityEvidence['state']

export const SECTION_A_CAPABILITY_STATE_VOCABULARIES = Object.freeze({
  requestKind: Object.freeze(['shared', 'host-only'] as const),
  requestTransport: Object.freeze(['accepted', 'excluded'] as const),
  requestReceipt: Object.freeze(['included', 'excluded'] as const),
  requestSchema: Object.freeze(['declared', 'not-applicable'] as const),
  requestSurface: SHARED_RENDER_OPTION_SURFACE_STATES,
  outputOptionScope: Object.freeze(['portable', 'native-host-only'] as const),
  outputOptionInput: Object.freeze(['serializable', 'callback'] as const),
  outputOptionPolicy: Object.freeze(['included', 'excluded'] as const),
  backend: Object.freeze(['registered', 'scene-contracted'] as const),
  backendClaims: Object.freeze(['executable', 'executable-core-with-unverified-extensions'] as const),
  backendConformance: Object.freeze(['claim-keyed-svg-matrix'] as const),
  outputAvailability: Object.freeze(['public', 'internal', 'reserved'] as const),
  outputSecurity: Object.freeze(['enforced', 'not-applicable', 'reserved'] as const),
  outputColor: Object.freeze(['srgb', 'terminal-projected', 'not-applicable', 'reserved'] as const),
  outputTerminal: Object.freeze(['projected', 'not-applicable', 'reserved'] as const),
  outputTransport: Object.freeze(['direct', 'projected', 'indirect', 'unavailable'] as const),
  resourceNetwork: Object.freeze(['forbidden'] as const),
  familySupport: Object.freeze(['native', 'partial-native', 'unsupported', 'inventory-only', 'extension'] as const),
  familyCapability: Object.freeze(['native', 'source-preserved', 'diagnosed', 'not-applicable', 'absent'] as const),
  familyConformance: Object.freeze(['passed', 'failed', 'unverified-extension'] as const),
  familySceneApplicability: Object.freeze(['applicable', 'not-applicable'] as const),
  familySyntax: FAMILY_SYNTAX_STATES,
})

export type FamilySupportState = (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.familySupport)[number]

export interface SectionARequestCapabilityRow {
  field: string
  kind: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestKind)[number]
  transport: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestTransport)[number]
  receipt: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestReceipt)[number]
  schema: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestSchema)[number]
  /** Present only for serializable shared fields. */
  surfaces?: Readonly<Record<RenderTransportSurface, SharedRenderOptionSurfaceClaim>>
}

export interface SectionAOutputOptionCapabilityRow {
  output: 'png'
  field: string
  scope: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.outputOptionScope)[number]
  input: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.outputOptionInput)[number]
  policy: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.outputOptionPolicy)[number]
  receipt: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestReceipt)[number]
  schema: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestSchema)[number]
}

export interface SectionABackendCapabilityRow {
  id: string
  version: string
  registration: 'registered'
  sceneInput: 'scene-contracted'
  claimStatus: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.backendClaims)[number]
  conformanceKind: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.backendConformance)[number]
  conformance: BackendConformanceReport
  primitiveIds: readonly string[]
  rolePolicyIds: readonly string[]
  claims: readonly BackendCapabilityConformanceResult[]
  compatibility: Readonly<Record<string, string>>
  provenance: Readonly<Record<string, string>>
}

export interface SectionAOutputCapabilityRow {
  id: string
  availability: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.outputAvailability)[number]
  security: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.outputSecurity)[number]
  color: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.outputColor)[number]
  terminal: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.outputTerminal)[number]
  transports: RenderOutputTransports
  evidence: readonly string[]
}

export interface SectionAResourceCapabilityRow {
  id: string
  version: string
  path: string
  mediaType: string
  sha256: string
  bytes: number
  required: boolean
  network: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.resourceNetwork)[number]
  license: { spdx: string; noticePath: string }
  compatibility: Readonly<Record<string, string>>
  provenance: Readonly<Record<string, string>>
}

export interface SectionAFamilyHeaderRow {
  value: string
  status: AgenticHeaderStatus | 'extension'
}

export interface SectionAFamilyCapabilityRow {
  id: string
  label: string
  source: 'core' | 'external-first-party' | 'extension'
  maturity: string
  support: FamilySupportState
  registrationId?: string
  identity?: {
    id: string
    version: string
    compatibility: Readonly<Record<string, string>>
    provenance: Readonly<Record<string, string>>
  }
  headers: readonly SectionAFamilyHeaderRow[]
  aliases: readonly string[]
  /** Effective family-scoped shared options. Built-ins derive from the render
   * field manifest; extensions expose their explicit descriptor declaration. */
  applicableRenderOptions: readonly FamilyScopedRenderOptionField[]
  semanticRoles: readonly string[]
  scenePrimitiveEvidence: readonly FamilyScenePrimitiveEvidence[]
  capabilities: Readonly<Record<FamilyCapabilityColumn, FamilyCapabilityState>>
  evidence: readonly FamilyCapabilityEvidence[]
  conformance?: FamilyConformanceReport
}

export interface SectionASceneRoleRow {
  id: string
  applicableKinds: readonly string[]
  domIdentity: boolean
  relation: boolean
  sketch: string
  textHalo: boolean
}

export interface SectionAEvidenceSystem {
  id: string
  authority: string
  freshnessGate: string
}

export interface SectionARetiredAuthority {
  id: string
  replacement: string
  evidence: readonly string[]
}

export interface SectionACapabilityReport {
  schemaVersion: typeof SECTION_A_CAPABILITY_REPORT_SCHEMA_VERSION
  contracts: {
    renderRequest: number
    scene: number
    outputSecurity: number
    pngOutputPolicy: number
    terminalOutputPolicy: number
    backendConformance: number
    outputColor: number
    terminalStyle: number
    resourceManifest: number
    upstreamManifest: number
    familyConformance: number
    familyDescriptorVersions: readonly number[]
  }
  stateVocabularies: typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES
  summary: {
    sharedRequestFieldCount: number
    sharedRequestSurfaceCellCount: number
    hostOnlyRequestFieldCount: number
    portableOutputOptionFieldCount: number
    nativeHostOnlyOutputOptionFieldCount: number
    registeredBackendCount: number
    outputCount: number
    resourceCount: number
    registeredFamilyCount: number
    upstreamPublicFamilyCount: number
    upstreamNativeHeaderCount: number
    upstreamUnsupportedHeaderCount: number
    upstreamInventoryOnlyHeaderCount: number
    scenePrimitiveCount: number
    sceneRoleCount: number
    syntaxDimensionCount: number
    syntaxFamilyDimensionCount: number
    syntaxFeatureClassificationCount: number
    syntaxAbsentCount: number
    evidenceSystemCount: number
    retiredAuthorityCount: number
  }
  upstream: {
    package: string
    version: string
    commit: string
    inventorySha256: string
    semanticInventory: {
      syntaxFeatureCount: number
      exampleCount: number
      configKeyCount: number
      themeVariableCount: number
      sourceArtifacts: readonly {
        id: string
        kind: string
        path: string
        sha256: string
        upstreamRevision?: string
      }[]
    }
  }
  matrices: {
    request: readonly SectionARequestCapabilityRow[]
    outputOptions: readonly SectionAOutputOptionCapabilityRow[]
    backends: readonly SectionABackendCapabilityRow[]
    outputs: readonly SectionAOutputCapabilityRow[]
    resources: readonly SectionAResourceCapabilityRow[]
    families: readonly SectionAFamilyCapabilityRow[]
    syntax: SyntaxCapabilityLedger
    scene: {
      primitives: readonly string[]
      operations: readonly string[]
      features: readonly string[]
      realizations: readonly string[]
      roles: readonly SectionASceneRoleRow[]
    }
  }
  forwardCompatibility: {
    unknownHeader: { code: string; classification: string; sourcePreserved: boolean }
    unsupportedHeader: { code: string; classification: string; sourcePreserved: boolean }
    inventoryOnlyHeader: { code: string; classification: string; sourcePreserved: boolean }
  }
  evidence: {
    authority: string
    schemaVersion: number
    requestSurfaces: Readonly<Record<RenderTransportSurface, readonly string[]>>
    systems: readonly SectionAEvidenceSystem[]
    contracts: readonly { id: string; surface: string; familyScope: string; evidence: readonly string[] }[]
  }
  retiredAuthorities: readonly SectionARetiredAuthority[]
  digest: string
}

type ExactKeySet<Expected extends PropertyKey, Actual extends PropertyKey> =
  [Exclude<Expected, Actual>, Exclude<Actual, Expected>] extends [never, never]
    ? true
    : never

/** Compile-time tripwires: the ordering authorities must cover the complete
 * report records, not merely contain valid members of those records. */
export const ALL_RENDER_TRANSPORT_KEYS_ORDERED: ExactKeySet<
  keyof RenderOutputTransports,
  RenderTransportSurface
> = true
export const ALL_FAMILY_CAPABILITY_KEYS_ORDERED: ExactKeySet<
  keyof SectionAFamilyCapabilityRow['capabilities'],
  FamilyCapability
> = true

/**
 * Small, stable projection for routine agent discovery. The exhaustive report
 * deliberately stays in repository audit tooling and its generated
 * Markdown artifact; returning its evidence corpora from every
 * `am capabilities` call makes ordinary discovery needlessly expensive.
 */
export interface SectionACapabilityDiscoverySummary {
  projectionVersion: 1
  reportSchemaVersion: typeof SECTION_A_CAPABILITY_REPORT_SCHEMA_VERSION
  reportDigest: string
  upstreamPin: {
    package: string
    version: string
    commit: string
    inventorySha256: string
  }
  counts: SectionACapabilityReport['summary']
  noAbsentSyntaxCapabilities: boolean
  fullReport: {
    repositoryModule: 'src/section-a-capability-report.ts'
    factory: 'createSectionACapabilityReport'
    markdown: 'docs/project/section-a-capability-report.md'
    regenerateCommand: 'bun run section-a-report'
  }
}

interface CharacterizationIndex {
  schemaVersion: number
  scopeProjection: string
  evidenceSystems: SectionAEvidenceSystem[]
  retiredAuthorities: SectionARetiredAuthority[]
  contracts: Array<{ id: string; surface: string; familyScope: string; evidence: string[] }>
}

const CHARACTERIZATION = characterizationIndex as CharacterizationIndex

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function stringRecord(value: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function transportSnapshot(transports: RenderOutputTransports): RenderOutputTransports {
  return Object.fromEntries(RENDER_TRANSPORT_SURFACES.map(surface => {
    const transport = transports[surface]
    return [surface, { ...transport, evidence: [...transport.evidence] }]
  })) as unknown as RenderOutputTransports
}

function requestSurfaceSnapshot(
  field: SharedRenderOptionField,
): Readonly<Record<RenderTransportSurface, SharedRenderOptionSurfaceClaim>> {
  const claims = SHARED_RENDER_OPTION_SURFACE_CLAIMS[field]
  return Object.fromEntries(
    RENDER_TRANSPORT_SURFACES.map(surface => [surface, { ...claims[surface] }]),
  ) as unknown as Readonly<Record<RenderTransportSurface, SharedRenderOptionSurfaceClaim>>
}

function pngOutputOptionRows(): SectionAOutputOptionCapabilityRow[] {
  const portableSchema = pngOutputOptionsJsonSchema('portable') as { properties?: Record<string, unknown> }
  const nativeSchema = pngOutputOptionsJsonSchema('native') as { properties?: Record<string, unknown> }
  return PNG_OUTPUT_OPTION_FIELDS.map(field => {
    const descriptor = PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS[field]
    const schema = descriptor.scope === 'portable' ? portableSchema : nativeSchema
    const schemaDeclared = 'schema' in descriptor
      && Object.prototype.hasOwnProperty.call(schema.properties ?? {}, field)
    return {
      output: 'png',
      field,
      scope: descriptor.scope,
      input: descriptor.input,
      policy: descriptor.policy,
      receipt: descriptor.receipt,
      schema: schemaDeclared ? 'declared' : 'not-applicable',
    }
  })
}

function descriptorCapabilities(descriptor?: FamilyDescriptor): Readonly<Record<FamilyCapabilityColumn, FamilyCapabilityState>> {
  if (!descriptor) return UNREGISTERED_FAMILY_CAPABILITY_STATES
  return Object.freeze(Object.fromEntries(
    FAMILY_CAPABILITY_COLUMNS.map(capability => [capability, effectiveFamilyCapabilityState(descriptor, capability)]),
  )) as Readonly<Record<FamilyCapabilityColumn, FamilyCapabilityState>>
}

function familyIdentity(descriptor: FamilyDescriptor): NonNullable<SectionAFamilyCapabilityRow['identity']> {
  return {
    id: descriptor.identity.id,
    version: descriptor.identity.version,
    compatibility: stringRecord(descriptor.identity.compatibility),
    provenance: stringRecord(descriptor.identity.provenance),
  }
}

function supportState(family: UpstreamFamilyDescriptor): FamilySupportState {
  const statuses = new Set(family.headers.map(header => header.agenticStatus))
  if (statuses.has('native')) return statuses.size === 1 ? 'native' : 'partial-native'
  if (statuses.has('unsupported')) return 'unsupported'
  return 'inventory-only'
}

function registeredDescriptors(): FamilyDescriptor[] {
  return knownFamilies()
    .map(id => getFamily(id))
    // A descriptor is public report state only after its executable evidence
    // commits. Conformance temporarily stages the candidate in the routing
    // registry so its own hooks can run; exposing that half-state here can
    // poison the immutable report cache with an evidence-free registration.
    .filter((descriptor): descriptor is FamilyDescriptor =>
      descriptor !== undefined && getFamilyConformanceReport(descriptor.id) !== undefined)
}

function descriptorForUpstreamFamily(
  family: UpstreamFamilyDescriptor,
  descriptors: readonly FamilyDescriptor[],
): FamilyDescriptor | undefined {
  return descriptors.find(descriptor => primaryUpstreamFamilyId(descriptor) === family.id)
}

function normalizedFamilyHeader(value: string): string {
  return value.trim().toLowerCase()
}

function primaryUpstreamFamilyId(descriptor: FamilyDescriptor): string | undefined {
  const claimedHeaders = new Set(descriptor.headers.map(normalizedFamilyHeader))
  const declaredUpstream = descriptor.upstreamId
    ? UPSTREAM_MERMAID_MANIFEST.families.find(family => family.id === descriptor.upstreamId)
    : undefined
  // Treat upstreamId as a checked hint, not routing authority. An extension
  // cannot use an unrelated but valid id to hide its descriptor-only headers
  // from the upstream family actually established by its official claim.
  if (declaredUpstream?.headers.some(header => claimedHeaders.has(normalizedFamilyHeader(header.value)))) {
    return declaredUpstream.id
  }
  return UPSTREAM_MERMAID_MANIFEST.families.find(family =>
    family.headers.some(header => claimedHeaders.has(normalizedFamilyHeader(header.value))))?.id
}

/**
 * Join the pinned upstream inventory to the live descriptor. An installed
 * extension changes only headers it actually claims; unclaimed aliases retain
 * their pinned unsupported/inventory status. Descriptor-only headers belong on
 * the descriptor's primary upstream row so discovery never drops its dialect.
 */
function liveFamilyHeaders(
  family: UpstreamFamilyDescriptor,
  descriptor: FamilyDescriptor | undefined,
  owners: ReadonlyMap<string, FamilyDescriptor>,
): SectionAFamilyHeaderRow[] {
  const claimed = new Set(descriptor?.headers.map(normalizedFamilyHeader) ?? [])
  const upstream = new Set(family.headers.map(header => normalizedFamilyHeader(header.value)))
  const extension = descriptor !== undefined && !isBuiltinFamilyId(descriptor.id)
  const rows: SectionAFamilyHeaderRow[] = family.headers.flatMap(header => {
    const normalized = normalizedFamilyHeader(header.value)
    const owner = owners.get(normalized)
    // A public upstream family can have aliases adopted by separate extension
    // descriptors. Keep each claimed header on its owner's single row instead
    // of repeating it on the upstream row with contradictory status.
    if (owner && owner.id !== descriptor?.id) return []
    return [{
      value: header.value,
      status: extension && claimed.has(normalized) ? 'extension' : header.agenticStatus,
    }]
  })
  if (descriptor && primaryUpstreamFamilyId(descriptor) === family.id) {
    for (const header of descriptor.headers) {
      if (!upstream.has(normalizedFamilyHeader(header))) {
        rows.push({ value: header, status: extension ? 'extension' : 'native' })
      }
    }
  }
  return rows
}

function familyRows(descriptors: readonly FamilyDescriptor[]): SectionAFamilyCapabilityRow[] {
  const matched = new Set<string>()
  const owners = new Map<string, FamilyDescriptor>()
  for (const descriptor of descriptors) {
    for (const header of descriptor.headers) owners.set(normalizedFamilyHeader(header), descriptor)
  }
  const upstreamRows = UPSTREAM_MERMAID_MANIFEST.families.map(family => {
    const descriptor = descriptorForUpstreamFamily(family, descriptors)
    if (descriptor) matched.add(descriptor.id)
    return {
      id: family.id,
      label: family.label,
      source: family.source,
      maturity: family.maturity,
      support: descriptor && !isBuiltinFamilyId(descriptor.id) ? 'extension' : supportState(family),
      ...(descriptor ? { registrationId: descriptor.id } : {}),
      ...(descriptor ? { identity: familyIdentity(descriptor) } : {}),
      headers: liveFamilyHeaders(family, descriptor, owners),
      aliases: descriptor ? [...descriptor.aliases].sort(compareCodePointStrings) : [],
      applicableRenderOptions: descriptor ? [...applicableFamilyScopedRenderOptions(descriptor)] : [],
      semanticRoles: descriptor ? [...descriptor.semanticRoles].sort(compareCodePointStrings) : [],
      scenePrimitiveEvidence: descriptor ? descriptor.scenePrimitiveEvidence.map(cell => ({ ...cell, evidence: [...cell.evidence] })) : [],
      capabilities: descriptorCapabilities(descriptor),
      evidence: descriptor ? [...descriptor.capabilityEvidence] : [],
      ...(descriptor ? { conformance: getFamilyConformanceReport(descriptor.id)! } : {}),
    } satisfies SectionAFamilyCapabilityRow
  })
  const extensionRows = descriptors
    .filter(descriptor => !matched.has(descriptor.id))
    .sort((a, b) => compareCodePointStrings(a.id, b.id))
    .map(descriptor => ({
      id: descriptor.id,
      label: descriptor.label,
      source: 'extension' as const,
      maturity: descriptor.maturity,
      support: 'extension' as const,
      registrationId: descriptor.id,
      identity: familyIdentity(descriptor),
      headers: descriptor.headers.map(value => ({ value, status: 'extension' as const })),
      aliases: [...descriptor.aliases].sort(compareCodePointStrings),
      applicableRenderOptions: [...applicableFamilyScopedRenderOptions(descriptor)],
      semanticRoles: [...descriptor.semanticRoles].sort(compareCodePointStrings),
      scenePrimitiveEvidence: descriptor.scenePrimitiveEvidence.map(cell => ({ ...cell, evidence: [...cell.evidence] })),
      capabilities: descriptorCapabilities(descriptor),
      evidence: [...descriptor.capabilityEvidence],
      conformance: getFamilyConformanceReport(descriptor.id)!,
    }))
  return [...upstreamRows, ...extensionRows]
}

function diagnosticContract(source: string): { code: string; classification: string; sourcePreserved: boolean } {
  const classification = classifyMermaidFamilyFromFirstLine(source.split(/\r?\n/, 1)[0] ?? '')
  if (classification.kind === 'registered') {
    return { code: 'REGISTERED', classification: 'registered', sourcePreserved: true }
  }
  const diagnostic = familyDetectionDiagnostic(classification, source)
  return {
    code: diagnostic.code,
    classification: diagnostic.preservation.classification,
    sourcePreserved: diagnostic.preservation.source === source,
  }
}

function headerSource(status: AgenticHeaderStatus): string {
  const headers = UPSTREAM_MERMAID_MANIFEST.families
    .flatMap(family => family.headers)
    .filter(candidate => candidate.agenticStatus === status)
  const header = headers.find(candidate => {
    const classification = classifyMermaidFamilyFromFirstLine(candidate.value)
    return classification.kind !== 'registered'
  })
  if (!header) throw new Error(`Pinned upstream manifest has no ${status} header`)
  return `${header.value}\n  preserved source`
}

function withoutDigest(report: SectionACapabilityReport): Omit<SectionACapabilityReport, 'digest'> {
  const { digest: _digest, ...payload } = report
  return payload
}

interface CapabilityReportCache {
  readonly families: readonly FamilyDescriptor[]
  readonly backends: readonly BackendDescriptor[]
  readonly report: SectionACapabilityReport
}

let capabilityReportCache: CapabilityReportCache | undefined

function sameLiveRegistrations(
  cache: CapabilityReportCache,
  families: readonly FamilyDescriptor[],
  backends: readonly BackendDescriptor[],
): boolean {
  return cache.families.length === families.length
    && cache.families.every((descriptor, index) => descriptor === families[index])
    && cache.backends.length === backends.length
    // knownBackendDescriptors creates projection wrappers on every call, but
    // registration identities/backends are immutable and retain object identity.
    && cache.backends.every((descriptor, index) =>
      descriptor.identity === backends[index]?.identity
      && descriptor.backend === backends[index]?.backend
      && descriptor.conformance === backends[index]?.conformance)
}

/** Build a deterministic JSON snapshot, reusing it until a live registry changes. */
export function createSectionACapabilityReport(): SectionACapabilityReport {
  const descriptors = registeredDescriptors()
  const backendDescriptors = knownBackendDescriptors()
  if (capabilityReportCache && sameLiveRegistrations(capabilityReportCache, descriptors, backendDescriptors)) {
    return capabilityReportCache.report
  }
  const roles = Object.entries(BUILTIN_SCENE_ROLE_TRAITS)
    .sort(([a], [b]) => compareCodePointStrings(a, b))
    .map(([id, traits]) => ({ id, ...traits }))
  const schema = sharedRenderOptionsJsonSchema() as { properties?: Record<string, unknown> }
  const request: SectionARequestCapabilityRow[] = [
    ...SHARED_RENDER_OPTION_FIELDS.map(field => ({
      field,
      kind: 'shared' as const,
      transport: 'accepted' as const,
      receipt: 'included' as const,
      schema: Object.prototype.hasOwnProperty.call(schema.properties ?? {}, field)
        ? 'declared' as const
        : 'not-applicable' as const,
      surfaces: requestSurfaceSnapshot(field),
    })),
    ...NON_SERIALIZABLE_RENDER_OPTION_FIELDS.map(field => ({
      field,
      kind: 'host-only' as const,
      transport: 'excluded' as const,
      receipt: 'excluded' as const,
      schema: 'not-applicable' as const,
    })),
  ]
  const outputOptions = pngOutputOptionRows()
  const backends: SectionABackendCapabilityRow[] = backendDescriptors
    .map(descriptor => {
      const claims = descriptor.conformance.claims.map(claim => ({ ...claim }))
      const hasUnverifiedExtensions = claims.some(claim => claim.status === 'unverified-extension')
      return {
        id: descriptor.identity.id,
        version: descriptor.identity.version,
        registration: 'registered' as const,
        sceneInput: 'scene-contracted' as const,
        claimStatus: hasUnverifiedExtensions
          ? 'executable-core-with-unverified-extensions' as const
          : 'executable' as const,
        conformanceKind: 'claim-keyed-svg-matrix' as const,
        // Registration reports are already deeply frozen, JSON-safe snapshots.
        conformance: descriptor.conformance,
        primitiveIds: [...new Set(claims.map(claim => claim.primitive))].sort(compareCodePointStrings),
        rolePolicyIds: roles.map(role => role.id),
        claims,
        compatibility: stringRecord(descriptor.identity.compatibility),
        provenance: stringRecord(descriptor.identity.provenance),
      }
    })
    .sort((a, b) => compareCodePointStrings(a.id, b.id))
  const outputs = RENDER_OUTPUT_DESCRIPTORS.map(descriptor => ({
    id: descriptor.id,
    availability: descriptor.availability,
    security: descriptor.security,
    color: descriptor.color,
    terminal: descriptor.terminal,
    transports: transportSnapshot(descriptor.transports),
    evidence: [...descriptor.evidence],
  }))
  const resources: SectionAResourceCapabilityRow[] = RESOURCE_MANIFEST.resources.map(resource => ({
    id: resource.identity.id,
    version: resource.identity.version,
    path: resource.path,
    mediaType: resource.mediaType,
    sha256: resource.sha256,
    bytes: resource.bytes,
    required: resource.required,
    network: resource.network,
    license: { ...resource.license },
    compatibility: stringRecord(resource.identity.compatibility),
    provenance: stringRecord(resource.identity.provenance),
  }))
  const families = familyRows(descriptors)
  const syntax = createSyntaxCapabilityLedger(UPSTREAM_MERMAID_MANIFEST, descriptors)
  const syntaxAbsentCount = syntax.features.filter(row => row.state === 'absent').length
    + syntax.families.filter(row => row.state === 'absent').length
    + syntax.families.reduce((count, row) => count + (row.processing
      ? Object.values(row.processing).filter(state => state === 'absent').length
      : 0), 0)
  const familyDescriptorVersions = [...new Set(descriptors.map(descriptor => descriptor.contractVersion))].sort((a, b) => a - b)
  const payload: Omit<SectionACapabilityReport, 'digest'> = {
    schemaVersion: SECTION_A_CAPABILITY_REPORT_SCHEMA_VERSION,
    contracts: {
      renderRequest: RENDER_CONTRACT_VERSION,
      scene: SCENE_CONTRACT_VERSION,
      outputSecurity: OUTPUT_SECURITY_POLICY_VERSION,
      pngOutputPolicy: PNG_OUTPUT_POLICY_VERSION,
      terminalOutputPolicy: TERMINAL_OUTPUT_POLICY_VERSION,
      backendConformance: BACKEND_CONFORMANCE_VERSION,
      outputColor: OUTPUT_COLOR_PROFILE.version,
      terminalStyle: TERMINAL_STYLE_VERSION,
      resourceManifest: RESOURCE_MANIFEST_VERSION,
      upstreamManifest: UPSTREAM_MERMAID_MANIFEST.schemaVersion,
      familyConformance: FAMILY_CONFORMANCE_VERSION,
      familyDescriptorVersions,
    },
    stateVocabularies: SECTION_A_CAPABILITY_STATE_VOCABULARIES,
    summary: {
      sharedRequestFieldCount: SHARED_RENDER_OPTION_FIELDS.length,
      sharedRequestSurfaceCellCount: SHARED_RENDER_OPTION_FIELDS.length * RENDER_TRANSPORT_SURFACES.length,
      hostOnlyRequestFieldCount: NON_SERIALIZABLE_RENDER_OPTION_FIELDS.length,
      portableOutputOptionFieldCount: PORTABLE_PNG_OUTPUT_OPTION_FIELDS.length,
      nativeHostOnlyOutputOptionFieldCount: NATIVE_PNG_HOST_ONLY_OPTION_FIELDS.length,
      registeredBackendCount: backends.length,
      outputCount: outputs.length,
      resourceCount: resources.length,
      registeredFamilyCount: descriptors.length,
      upstreamPublicFamilyCount: UPSTREAM_MERMAID_MANIFEST.families.length,
      upstreamNativeHeaderCount: families.flatMap(row => row.headers).filter(header => header.status === 'native').length,
      upstreamUnsupportedHeaderCount: families.flatMap(row => row.headers).filter(header => header.status === 'unsupported').length,
      upstreamInventoryOnlyHeaderCount: families.flatMap(row => row.headers).filter(header => header.status === 'inventory-only').length,
      scenePrimitiveCount: CORE_SCENE_PRIMITIVES.length,
      sceneRoleCount: roles.length,
      syntaxDimensionCount: syntax.dimensions.length,
      syntaxFamilyDimensionCount: syntax.families.length,
      syntaxFeatureClassificationCount: syntax.features.length,
      syntaxAbsentCount,
      evidenceSystemCount: CHARACTERIZATION.evidenceSystems.length,
      retiredAuthorityCount: CHARACTERIZATION.retiredAuthorities.length,
    },
    upstream: {
      package: UPSTREAM_MERMAID_MANIFEST.provenance.package,
      version: UPSTREAM_MERMAID_MANIFEST.provenance.version,
      commit: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
      inventorySha256: UPSTREAM_MERMAID_MANIFEST.provenance.inventorySha256,
      semanticInventory: {
        syntaxFeatureCount: UPSTREAM_MERMAID_MANIFEST.semanticInventory.syntaxFeatures.length,
        exampleCount: UPSTREAM_MERMAID_MANIFEST.semanticInventory.examples.length,
        configKeyCount: UPSTREAM_MERMAID_MANIFEST.semanticInventory.configKeys.length,
        themeVariableCount: UPSTREAM_MERMAID_MANIFEST.semanticInventory.themeVariables.length,
        sourceArtifacts: UPSTREAM_MERMAID_MANIFEST.semanticInventory.sourceArtifacts.map(artifact => ({
          id: artifact.id,
          kind: artifact.kind,
          path: artifact.path,
          sha256: artifact.sha256,
          ...(artifact.upstreamRevision ? { upstreamRevision: artifact.upstreamRevision } : {}),
        })),
      },
    },
    matrices: {
      request,
      outputOptions,
      backends,
      outputs,
      resources,
      families,
      syntax,
      scene: {
        primitives: [...CORE_SCENE_PRIMITIVES],
        operations: [...CORE_SCENE_OPERATIONS],
        features: [...CORE_SCENE_FEATURES],
        realizations: [...PRIMITIVE_REALIZATIONS],
        roles,
      },
    },
    forwardCompatibility: {
      unknownHeader: diagnosticContract('futureDiagram-v99\n  preserved source'),
      unsupportedHeader: diagnosticContract(headerSource('unsupported')),
      inventoryOnlyHeader: diagnosticContract(headerSource('inventory-only')),
    },
    evidence: {
      authority: CHARACTERIZATION.scopeProjection,
      schemaVersion: CHARACTERIZATION.schemaVersion,
      requestSurfaces: Object.fromEntries(RENDER_TRANSPORT_SURFACES.map(surface => [
        surface,
        [...SHARED_RENDER_OPTION_SURFACE_EVIDENCE[surface]],
      ])) as unknown as Readonly<Record<RenderTransportSurface, readonly string[]>>,
      systems: CHARACTERIZATION.evidenceSystems.map(system => ({ ...system })),
      contracts: CHARACTERIZATION.contracts.map(contract => ({ ...contract, evidence: [...contract.evidence] })),
    },
    retiredAuthorities: CHARACTERIZATION.retiredAuthorities.map(authority => ({
      ...authority,
      evidence: [...authority.evidence],
    })),
  }
  const report = deepFreeze({ ...payload, digest: renderContractDigest(payload) }) as SectionACapabilityReport
  capabilityReportCache = { families: descriptors, backends: backendDescriptors, report }
  return report
}

/** Project the full audit report into the bounded `am capabilities` envelope. */
export function sectionACapabilityDiscoverySummary(
  report: SectionACapabilityReport = createSectionACapabilityReport(),
): SectionACapabilityDiscoverySummary {
  return deepFreeze({
    projectionVersion: 1,
    reportSchemaVersion: report.schemaVersion,
    reportDigest: report.digest,
    upstreamPin: {
      package: report.upstream.package,
      version: report.upstream.version,
      commit: report.upstream.commit,
      inventorySha256: report.upstream.inventorySha256,
    },
    counts: { ...report.summary },
    noAbsentSyntaxCapabilities: report.summary.syntaxAbsentCount === 0,
    fullReport: {
      repositoryModule: 'src/section-a-capability-report.ts',
      factory: 'createSectionACapabilityReport',
      markdown: 'docs/project/section-a-capability-report.md',
      regenerateCommand: 'bun run section-a-report',
    },
  }) as SectionACapabilityDiscoverySummary
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function hasExactKeys(value: object | undefined, expected: readonly string[]): boolean {
  if (!value) return false
  const actual = Object.keys(value).sort(compareCodePointStrings)
  const orderedExpected = [...expected].sort(compareCodePointStrings)
  return actual.length === orderedExpected.length
    && actual.every((key, index) => key === orderedExpected[index])
}

function stateIn(state: string, vocabulary: readonly string[]): boolean {
  return vocabulary.includes(state)
}

/** Semantic invariants complement the generated-file freshness comparison. */
export function validateSectionACapabilityReport(report: SectionACapabilityReport): string[] {
  const diagnostics: string[] = []
  const payload = withoutDigest(report)
  if (report.schemaVersion !== SECTION_A_CAPABILITY_REPORT_SCHEMA_VERSION) diagnostics.push('unsupported report schemaVersion')
  if (report.digest !== renderContractDigest(payload)) diagnostics.push('report digest does not match its payload')
  if (validateUpstreamMermaidManifest().length > 0) diagnostics.push('pinned upstream manifest is invalid')
  if (validateResourceManifest().length > 0) diagnostics.push('installed resource manifest is invalid')

  const { request, outputOptions, backends, outputs, resources, families, syntax, scene } = report.matrices
  const liveDescriptorById = new Map(registeredDescriptors().map(descriptor => [descriptor.id, descriptor] as const))
  if (!unique(request.map(row => row.field))) diagnostics.push('request matrix fields are not unique')
  if (!unique(outputOptions.map(row => `${row.output}.${row.field}`))) diagnostics.push('output-option matrix fields are not unique')
  if (!unique(backends.map(row => row.id))) diagnostics.push('backend matrix ids are not unique')
  if (!unique(outputs.map(row => row.id))) diagnostics.push('output matrix ids are not unique')
  if (!unique(resources.map(row => row.id))) diagnostics.push('resource matrix ids are not unique')
  if (!unique(resources.map(row => row.path))) diagnostics.push('resource matrix paths are not unique')
  if (!unique(families.map(row => row.id))) diagnostics.push('family matrix ids are not unique')
  if (!unique(scene.roles.map(row => row.id))) diagnostics.push('Scene role ids are not unique')
  const versionedOutputEvidence = new Map<string, number>([
    ['render-contract', report.contracts.renderRequest],
    ['output-security', report.contracts.outputSecurity],
    ['output-color-profile', report.contracts.outputColor],
    ['png-output-policy', report.contracts.pngOutputPolicy],
    ['terminal-output-policy', report.contracts.terminalOutputPolicy],
    ['terminal-style', report.contracts.terminalStyle],
  ])
  for (const row of outputs) {
    for (const evidence of row.evidence) {
      const match = /^([a-z][a-z0-9-]*)@(\d+)$/.exec(evidence)
      if (!match) continue
      const expected = versionedOutputEvidence.get(match[1]!)
      if (expected !== undefined && Number(match[2]) !== expected) {
        diagnostics.push(`output ${row.id} evidence ${evidence} does not match contract version ${expected}`)
      }
    }
  }
  diagnostics.push(...validateSyntaxCapabilityLedger(
    syntax,
    UPSTREAM_MERMAID_MANIFEST,
    families.map(row => row.id),
  ))
  for (const descriptor of registeredDescriptors()) {
    for (const declaredHeader of descriptor.headers) {
      const occurrences = families.flatMap(row => row.headers
        .filter(header => normalizedFamilyHeader(header.value) === normalizedFamilyHeader(declaredHeader))
        .map(() => row))
      if (occurrences.length !== 1) {
        diagnostics.push(`registered header ${declaredHeader} for ${descriptor.id} appears ${occurrences.length} times in the family matrix`)
      } else if (occurrences[0]?.registrationId !== descriptor.id) {
        diagnostics.push(`registered header ${declaredHeader} is projected under ${occurrences[0]?.registrationId ?? 'an unregistered family'} instead of ${descriptor.id}`)
      }
    }
  }

  for (const row of request) {
    if (!stateIn(row.kind, report.stateVocabularies.requestKind)) diagnostics.push(`request ${row.field} has invalid kind`)
    if (!stateIn(row.transport, report.stateVocabularies.requestTransport)) diagnostics.push(`request ${row.field} has invalid transport state`)
    if (!stateIn(row.receipt, report.stateVocabularies.requestReceipt)) diagnostics.push(`request ${row.field} has invalid receipt state`)
    if (!stateIn(row.schema, report.stateVocabularies.requestSchema)) diagnostics.push(`request ${row.field} has invalid schema state`)
    if (row.kind === 'shared' && (row.transport !== 'accepted' || row.receipt !== 'included' || row.schema !== 'declared')) {
      diagnostics.push(`shared request field ${row.field} is not accepted, receipted and schema-declared`)
    }
    if (row.kind === 'shared') {
      if (!hasExactKeys(row.surfaces, RENDER_TRANSPORT_SURFACES)) {
        diagnostics.push(`shared request field ${row.field} surface keys do not exactly match the product-surface authority`)
      }
      for (const surface of RENDER_TRANSPORT_SURFACES) {
        const claim = row.surfaces?.[surface]
        if (!claim || !stateIn(claim.state, report.stateVocabularies.requestSurface)) {
          diagnostics.push(`shared request field ${row.field} has an invalid ${surface} surface state`)
          continue
        }
        if (claim.state === 'host-enforced' && claim.enforcedValue === undefined) {
          diagnostics.push(`shared request field ${row.field} ${surface} does not declare its enforced value`)
        }
        if (claim.state === 'unavailable' && !claim.reason?.trim()) {
          diagnostics.push(`shared request field ${row.field} ${surface} does not explain unavailability`)
        }
        if (claim.state === 'unavailable' && claim.enforcedValue !== undefined) {
          diagnostics.push(`shared request field ${row.field} ${surface} declares a value for an unavailable field`)
        }
        if (claim.state === 'forwarded' && (claim.enforcedValue !== undefined || claim.reason !== undefined)) {
          diagnostics.push(`shared request field ${row.field} ${surface} attaches host policy to a forwarded field`)
        }
      }
      const canonical = SHARED_RENDER_OPTION_SURFACE_CLAIMS[row.field as SharedRenderOptionField]
      if (!canonical || JSON.stringify(row.surfaces) !== JSON.stringify(canonical)) {
        diagnostics.push(`shared request field ${row.field} surface policy does not match the canonical authority`)
      }
    }
    if (row.kind === 'host-only' && (row.transport !== 'excluded' || row.receipt !== 'excluded')) {
      diagnostics.push(`host-only request field ${row.field} leaked into a transport or receipt`)
    }
    if (row.kind === 'host-only' && row.surfaces !== undefined) {
      diagnostics.push(`host-only request field ${row.field} leaked into the shared-field surface matrix`)
    }
  }
  if (!hasExactKeys(report.evidence.requestSurfaces, RENDER_TRANSPORT_SURFACES)) {
    diagnostics.push('shared request surface evidence keys do not exactly match the product-surface authority')
  }
  for (const surface of RENDER_TRANSPORT_SURFACES) {
    const evidence = report.evidence.requestSurfaces[surface]
    if (!evidence || evidence.length === 0 || evidence.some(path => !path.trim())) {
      diagnostics.push(`shared request surface ${surface} has no policy evidence`)
    }
  }
  if (JSON.stringify(report.evidence.requestSurfaces) !== JSON.stringify(SHARED_RENDER_OPTION_SURFACE_EVIDENCE)) {
    diagnostics.push('shared request surface evidence does not match the canonical authority')
  }
  for (const row of outputOptions) {
    if (!stateIn(row.scope, report.stateVocabularies.outputOptionScope)) diagnostics.push(`output option ${row.output}.${row.field} has invalid scope`)
    if (!stateIn(row.input, report.stateVocabularies.outputOptionInput)) diagnostics.push(`output option ${row.output}.${row.field} has invalid input kind`)
    if (!stateIn(row.policy, report.stateVocabularies.outputOptionPolicy)) diagnostics.push(`output option ${row.output}.${row.field} has invalid policy state`)
    if (!stateIn(row.receipt, report.stateVocabularies.requestReceipt)) diagnostics.push(`output option ${row.output}.${row.field} has invalid receipt state`)
    if (!stateIn(row.schema, report.stateVocabularies.requestSchema)) diagnostics.push(`output option ${row.output}.${row.field} has invalid schema state`)
    if (row.scope === 'portable'
      && (row.input !== 'serializable' || row.policy !== 'included' || row.receipt !== 'included' || row.schema !== 'declared')) {
      diagnostics.push(`portable output option ${row.output}.${row.field} is not serializable, policy-included, receipted and schema-declared`)
    }
    if (row.input === 'callback'
      && (row.scope !== 'native-host-only' || row.policy !== 'excluded' || row.receipt !== 'excluded' || row.schema !== 'not-applicable')) {
      diagnostics.push(`callback output option ${row.output}.${row.field} leaked into policy, receipt or schema`)
    }
  }
  if (JSON.stringify(outputOptions) !== JSON.stringify(pngOutputOptionRows())) {
    diagnostics.push('PNG output-option matrix does not match the canonical PNG option authority')
  }
  for (const row of backends) {
    if (!stateIn(row.registration, report.stateVocabularies.backend) || !stateIn(row.sceneInput, report.stateVocabularies.backend)) {
      diagnostics.push(`backend ${row.id} has an invalid contract state`)
    }
    if (!stateIn(row.claimStatus, report.stateVocabularies.backendClaims)) {
      diagnostics.push(`backend ${row.id} has an invalid executable-claim state`)
    }
    if (!stateIn(row.conformanceKind, report.stateVocabularies.backendConformance)) {
      diagnostics.push(`backend ${row.id} has an invalid conformance kind`)
    }
    if (row.conformance.backendId !== row.id) diagnostics.push(`backend ${row.id} conformance targets another backend`)
    if (row.conformance.version !== BACKEND_CONFORMANCE_VERSION) diagnostics.push(`backend ${row.id} has a stale conformance version`)
    if (!row.conformance.passed || row.conformance.checks.some(check => !check.passed)) {
      diagnostics.push(`backend ${row.id} did not pass registration SVG conformance`)
    }
    if (JSON.stringify(row.conformance.checks.map(check => check.id)) !== JSON.stringify(BACKEND_CONFORMANCE_CHECK_IDS)) {
      diagnostics.push(`backend ${row.id} conformance checks do not match the registration fixture`)
    }
    if (JSON.stringify(row.conformance.directOutputs) !== JSON.stringify(['svg'])) {
      diagnostics.push(`backend ${row.id} conformance overstates directly tested outputs`)
    }
    if (JSON.stringify(row.claims) !== JSON.stringify(row.conformance.claims)) {
      diagnostics.push(`backend ${row.id} claim rows do not match executable conformance results`)
    }
    const declarations = row.claims.map(claim => ({
      target: claim.target,
      primitive: claim.primitive,
      feature: claim.feature,
      operation: claim.operation,
      realization: claim.realization,
      ...(claim.witnessId ? { evidence: claim.witnessId } : {}),
      ...(claim.limitation ? { diagnostic: claim.limitation } : {}),
    }))
    const claimValidation = validatePrimitiveCapabilities(declarations)
    if (!claimValidation.valid) diagnostics.push(`backend ${row.id} has invalid primitive claims: ${claimValidation.diagnostics.join('; ')}`)
    if (row.claims.some(claim => claim.target !== row.id)) diagnostics.push(`backend ${row.id} has a claim for another target`)
    if (row.claims.some(claim => claim.claimKey !== primitiveCapabilityClaimKey(claim))) {
      diagnostics.push(`backend ${row.id} has a stale executable claim key`)
    }
    if (row.claims.some(claim => claim.status === 'failed')) diagnostics.push(`backend ${row.id} exposes a failed executable claim`)
    if (row.claims.some(claim => claim.status === 'passed' && !claim.witnessId)) {
      diagnostics.push(`backend ${row.id} has a passing claim without an executable witness`)
    }
    const unverified = row.claims.filter(claim => claim.status === 'unverified-extension')
    const expectedClaimStatus = unverified.length > 0 ? 'executable-core-with-unverified-extensions' : 'executable'
    if (row.claimStatus !== expectedClaimStatus) diagnostics.push(`backend ${row.id} executable-claim state is stale`)
    if (row.provenance.owner === 'agentic-mermaid' && unverified.length > 0) {
      diagnostics.push(`first-party backend ${row.id} has unverified capability claims`)
    }
    if (scene.primitives.some(primitive => !row.primitiveIds.includes(primitive))) {
      diagnostics.push(`backend ${row.id} does not account for every Scene primitive`)
    }
    if (row.rolePolicyIds.length !== scene.roles.length) diagnostics.push(`backend ${row.id} does not account for every Scene role policy`)
  }
  for (const row of outputs) {
    if (!stateIn(row.availability, report.stateVocabularies.outputAvailability)) diagnostics.push(`output ${row.id} has invalid availability`)
    if (!stateIn(row.security, report.stateVocabularies.outputSecurity)) diagnostics.push(`output ${row.id} has invalid security state`)
    if (!stateIn(row.color, report.stateVocabularies.outputColor)) diagnostics.push(`output ${row.id} has invalid color state`)
    if (!stateIn(row.terminal, report.stateVocabularies.outputTerminal)) diagnostics.push(`output ${row.id} has invalid terminal state`)
    if (row.evidence.length === 0) diagnostics.push(`output ${row.id} has no evidence contract`)
    if (!hasExactKeys(row.transports, RENDER_TRANSPORT_SURFACES)) {
      diagnostics.push(`output ${row.id} transport keys do not exactly match the product-surface authority`)
    }
    for (const surface of RENDER_TRANSPORT_SURFACES) {
      const transport = row.transports[surface]
      if (!transport || !stateIn(transport.availability, report.stateVocabularies.outputTransport)) {
        diagnostics.push(`output ${row.id} has an invalid ${surface} transport state`)
        continue
      }
      if (!transport.entrypoint.trim()) diagnostics.push(`output ${row.id} ${surface} has no entry point decision`)
      if (transport.evidence.length === 0 || transport.evidence.some(path => !path.trim())) {
        diagnostics.push(`output ${row.id} ${surface} has no transport evidence`)
      }
      if (transport.availability === 'unavailable' && !transport.reason?.trim()) {
        diagnostics.push(`output ${row.id} ${surface} does not explain unavailability`)
      }
    }
    const descriptor = RENDER_OUTPUT_DESCRIPTORS.find(candidate => candidate.id === row.id)
    if (!descriptor || JSON.stringify(row.transports) !== JSON.stringify(descriptor.transports)) {
      diagnostics.push(`output ${row.id} transport descriptor does not match the canonical output contract`)
    }
  }
  for (const row of resources) {
    if (!stateIn(row.network, report.stateVocabularies.resourceNetwork)) diagnostics.push(`resource ${row.id} has invalid network policy`)
    if (!row.path || !row.mediaType || !row.sha256 || row.bytes <= 0) diagnostics.push(`resource ${row.id} is incomplete`)
    if (!row.license.spdx || !row.license.noticePath) diagnostics.push(`resource ${row.id} has no license evidence`)
  }
  for (const row of families) {
    if (!stateIn(row.support, report.stateVocabularies.familySupport)) diagnostics.push(`family ${row.id} has invalid support state`)
    if (!Array.isArray(row.applicableRenderOptions)
      || !unique(row.applicableRenderOptions)
      || row.applicableRenderOptions.some(field => !FAMILY_SCOPED_RENDER_OPTION_FIELDS.includes(field))) {
      diagnostics.push(`family ${row.id} has an invalid family-scoped RenderOptions declaration`)
    }
    if (row.registrationId) {
      if (!row.identity || !row.identity.id.trim() || !row.identity.version.trim()) {
        diagnostics.push(`registered family ${row.id} has no versioned identity snapshot`)
      } else {
        const expectedIdentity = row.registrationId.startsWith('family:')
          ? row.registrationId
          : `family:${row.registrationId}`
        if (row.identity.id !== expectedIdentity) {
          diagnostics.push(`registered family ${row.id} identity does not match ${row.registrationId}`)
        }
        if (!row.identity.compatibility.core?.trim()) {
          diagnostics.push(`registered family ${row.id} has no core compatibility range`)
        }
        if (!row.identity.provenance.owner?.trim() || !row.identity.provenance.source?.trim()) {
          diagnostics.push(`registered family ${row.id} has incomplete provenance`)
        }
      }
      if (!row.conformance || row.conformance.familyId !== row.registrationId) {
        diagnostics.push(`registered family ${row.id} has no matching conformance report`)
      } else {
        if (row.conformance.version !== report.contracts.familyConformance) {
          diagnostics.push(`registered family ${row.id} conformance version does not match the report contract`)
        }
        if (!row.conformance.passed) diagnostics.push(`registered family ${row.id} exposes failed conformance`)
        const resultCapabilities = row.conformance.capabilities.map(result => result.capability)
        if (!unique(resultCapabilities) || resultCapabilities.length !== FAMILY_CAPABILITY_COLUMNS.length) {
          diagnostics.push(`registered family ${row.id} has incomplete conformance cells`)
        }
        for (const result of row.conformance.capabilities) {
          if (!FAMILY_CAPABILITY_COLUMNS.includes(result.capability)) {
            diagnostics.push(`family ${row.id} has conformance for unknown capability ${String(result.capability)}`)
          }
          if (!stateIn(result.status, report.stateVocabularies.familyConformance)) {
            diagnostics.push(`family ${row.id} has invalid conformance status for ${result.capability}`)
          }
          if (result.status === 'passed' && !result.witnessId?.trim()) {
            diagnostics.push(`family ${row.id} has a passing ${result.capability} cell without a witness`)
          }
          const witnessVersion = result.witnessId
            ? /^family-(?:example|builtin-suite)@(\d+)\//.exec(result.witnessId)?.[1]
            : undefined
          if (result.status === 'passed' && Number(witnessVersion) !== report.contracts.familyConformance) {
            diagnostics.push(`family ${row.id} ${result.capability} witness does not match the conformance contract`)
          }
          if (result.status !== 'passed' && !result.diagnostic?.trim()) {
            diagnostics.push(`family ${row.id} has an unexplained ${result.capability} conformance cell`)
          }
          const claim = row.evidence.find(candidate => candidate.capability === result.capability)
          if (claim && result.declaredState !== claim.state) {
            diagnostics.push(`family ${row.id} ${result.capability} conformance disagrees with its declaration`)
          }
          if (claim?.state === 'native' && result.status !== 'passed') {
            diagnostics.push(`family ${row.id} ${result.capability} native declaration has no passed witness`)
          }
          if (claim?.state !== 'native' && result.status !== 'unverified-extension') {
            diagnostics.push(`family ${row.id} ${result.capability} non-native declaration has an executable result`)
          }
        }
      }
      const liveDescriptor = liveDescriptorById.get(row.registrationId as FamilyDescriptor['id'])
      const expectedRenderOptions = liveDescriptor
        ? applicableFamilyScopedRenderOptions(liveDescriptor)
        : []
      if (JSON.stringify(row.applicableRenderOptions) !== JSON.stringify(expectedRenderOptions)) {
        diagnostics.push(`registered family ${row.id} family-scoped RenderOptions do not match its descriptor authority`)
      }
    } else if (row.identity || row.conformance) {
      diagnostics.push(`unregistered family ${row.id} exposes registration identity or conformance`)
    }
    if (!row.registrationId
      && Array.isArray(row.applicableRenderOptions)
      && row.applicableRenderOptions.length > 0) {
      diagnostics.push(`unregistered family ${row.id} exposes family-scoped RenderOptions`)
    }
    if (!unique(row.semanticRoles)) diagnostics.push(`family ${row.id} has duplicate semantic roles`)
    const sceneCells = new Set<string>()
    for (const cell of row.scenePrimitiveEvidence) {
      const key = `${cell.role}\u0000${cell.primitive}`
      if (sceneCells.has(key)) diagnostics.push(`family ${row.id} repeats Scene cell ${cell.role}/${cell.primitive}`)
      sceneCells.add(key)
      if (!row.semanticRoles.includes(cell.role)) diagnostics.push(`family ${row.id} has Scene evidence for undeclared role ${cell.role}`)
      if (!scene.primitives.includes(cell.primitive)) diagnostics.push(`family ${row.id} has Scene evidence for unknown primitive ${cell.primitive}`)
      if (!stateIn(cell.applicability, report.stateVocabularies.familySceneApplicability)) {
        diagnostics.push(`family ${row.id} has invalid applicability for ${cell.role}/${cell.primitive}`)
      }
      if (!scene.realizations.includes(cell.realization)) diagnostics.push(`family ${row.id} has invalid realization for ${cell.role}/${cell.primitive}`)
      if (cell.evidence.length === 0 || cell.evidence.some(path => !path.trim())) {
        diagnostics.push(`family ${row.id} has ungrounded Scene evidence for ${cell.role}/${cell.primitive}`)
      }
      if (!unique(cell.evidence)) diagnostics.push(`family ${row.id} repeats Scene evidence for ${cell.role}/${cell.primitive}`)
      if (cell.applicability === 'applicable' && cell.realization === 'unsupported') {
        diagnostics.push(`family ${row.id} marks applicable Scene cell ${cell.role}/${cell.primitive} unsupported`)
      }
      if (cell.applicability === 'not-applicable' && (cell.realization !== 'unsupported' || !cell.diagnostic?.trim())) {
        diagnostics.push(`family ${row.id} does not explicitly diagnose negative Scene cell ${cell.role}/${cell.primitive}`)
      }
    }
    for (const role of row.semanticRoles) {
      for (const primitive of scene.primitives) {
        if (!sceneCells.has(`${role}\u0000${primitive}`)) diagnostics.push(`family ${row.id} lacks Scene cell ${role}/${primitive}`)
      }
    }
    const evidenceCapabilities = row.evidence.map(claim => claim.capability)
    if (!unique(evidenceCapabilities)) diagnostics.push(`family ${row.id} has duplicate capability evidence`)
    for (const claim of row.evidence) {
      if (!FAMILY_CAPABILITY_COLUMNS.includes(claim.capability)) {
        diagnostics.push(`family ${row.id} has evidence for unknown capability ${String(claim.capability)}`)
      }
      if (!stateIn(claim.state, report.stateVocabularies.familyCapability)) {
        diagnostics.push(`family ${row.id} has invalid evidence state for ${claim.capability}`)
      }
      if (claim.evidence.length === 0 || claim.evidence.some(path => !path.trim())) {
        diagnostics.push(`family ${row.id} has ungrounded evidence for ${claim.capability}`)
      }
      if (!unique(claim.evidence)) diagnostics.push(`family ${row.id} repeats evidence for ${claim.capability}`)
    }
    if (!hasExactKeys(row.capabilities, FAMILY_CAPABILITY_COLUMNS)) {
      diagnostics.push(`family ${row.id} capability keys do not exactly match the family-capability authority`)
    }
    for (const column of FAMILY_CAPABILITY_COLUMNS) {
      if (!stateIn(row.capabilities[column], report.stateVocabularies.familyCapability)) {
        diagnostics.push(`family ${row.id} has invalid ${column} state`)
      }
      const claim = row.evidence.find(candidate => candidate.capability === column)
      if (row.registrationId && !claim) diagnostics.push(`family ${row.id} lacks evidence for ${column}`)
      const conformance = row.conformance?.capabilities.find(result => result.capability === column)
      const expectedState = claim?.state === 'native' && conformance?.status !== 'passed'
        ? 'diagnosed'
        : claim?.state
      if (claim && row.capabilities[column] !== expectedState) {
        diagnostics.push(`family ${row.id} ${column} state does not match declaration plus conformance`)
      }
    }
    if (!row.registrationId) {
      if (JSON.stringify(row.capabilities) !== JSON.stringify(UNREGISTERED_FAMILY_CAPABILITY_STATES)) {
        diagnostics.push(`unregistered family ${row.id} does not match the canonical processing capability contract`)
      }
      const syntaxProcessing = syntax.families.find(candidate =>
        candidate.familyId === row.id && candidate.dimensionId === 'processing')?.processing
      if (JSON.stringify(syntaxProcessing) !== JSON.stringify(row.capabilities)) {
        diagnostics.push(`unregistered family ${row.id} disagrees with the syntax processing projection`)
      }
    }
    if ((row.support === 'native' || row.support === 'partial-native' || row.support === 'extension') && !row.registrationId) {
      diagnostics.push(`supported family ${row.id} has no registered descriptor`)
    }
    if ((row.support === 'unsupported' || row.support === 'inventory-only') && row.registrationId) {
      diagnostics.push(`non-native upstream family ${row.id} is claimed by ${row.registrationId}`)
    }
    if (!row.registrationId && row.evidence.length > 0) diagnostics.push(`unregistered family ${row.id} has descriptor evidence`)
    if (!row.registrationId && row.scenePrimitiveEvidence.length > 0) diagnostics.push(`unregistered family ${row.id} has Scene primitive evidence`)
  }

  const expectedCounts = {
    sharedRequestFieldCount: request.filter(row => row.kind === 'shared').length,
    sharedRequestSurfaceCellCount: request
      .filter(row => row.kind === 'shared')
      .reduce((count, row) => count + Object.keys(row.surfaces ?? {}).length, 0),
    hostOnlyRequestFieldCount: request.filter(row => row.kind === 'host-only').length,
    portableOutputOptionFieldCount: outputOptions.filter(row => row.scope === 'portable').length,
    nativeHostOnlyOutputOptionFieldCount: outputOptions.filter(row => row.scope === 'native-host-only').length,
    registeredBackendCount: backends.length,
    outputCount: outputs.length,
    resourceCount: resources.length,
    registeredFamilyCount: families.filter(row => row.registrationId !== undefined).length,
    upstreamPublicFamilyCount: families.filter(row => row.source !== 'extension').length,
    upstreamNativeHeaderCount: families.flatMap(row => row.headers).filter(header => header.status === 'native').length,
    upstreamUnsupportedHeaderCount: families.flatMap(row => row.headers).filter(header => header.status === 'unsupported').length,
    upstreamInventoryOnlyHeaderCount: families.flatMap(row => row.headers).filter(header => header.status === 'inventory-only').length,
    scenePrimitiveCount: scene.primitives.length,
    sceneRoleCount: scene.roles.length,
    syntaxDimensionCount: syntax.dimensions.length,
    syntaxFamilyDimensionCount: syntax.families.length,
    syntaxFeatureClassificationCount: syntax.features.length,
    syntaxAbsentCount: syntax.features.filter(row => row.state === 'absent').length
      + syntax.families.filter(row => row.state === 'absent').length
      + syntax.families.reduce((count, row) => count + (row.processing
        ? Object.values(row.processing).filter(state => state === 'absent').length
        : 0), 0),
    evidenceSystemCount: report.evidence.systems.length,
    retiredAuthorityCount: report.retiredAuthorities.length,
  }
  for (const [key, expected] of Object.entries(expectedCounts)) {
    if (report.summary[key as keyof typeof expectedCounts] !== expected) diagnostics.push(`summary ${key} is stale`)
  }
  const expectedSemanticCounts = {
    syntaxFeatureCount: UPSTREAM_MERMAID_MANIFEST.semanticInventory.syntaxFeatures.length,
    exampleCount: UPSTREAM_MERMAID_MANIFEST.semanticInventory.examples.length,
    configKeyCount: UPSTREAM_MERMAID_MANIFEST.semanticInventory.configKeys.length,
    themeVariableCount: UPSTREAM_MERMAID_MANIFEST.semanticInventory.themeVariables.length,
  }
  for (const [key, expected] of Object.entries(expectedSemanticCounts)) {
    if (report.upstream.semanticInventory[key as keyof typeof expectedSemanticCounts] !== expected) {
      diagnostics.push(`upstream semantic inventory ${key} is stale`)
    }
  }
  if (JSON.stringify(report.upstream.semanticInventory.sourceArtifacts) !== JSON.stringify(
    UPSTREAM_MERMAID_MANIFEST.semanticInventory.sourceArtifacts.map(artifact => ({
      id: artifact.id,
      kind: artifact.kind,
      path: artifact.path,
      sha256: artifact.sha256,
      ...(artifact.upstreamRevision ? { upstreamRevision: artifact.upstreamRevision } : {}),
    })),
  )) diagnostics.push('upstream semantic source artifacts are stale')
  if (!Object.values(report.forwardCompatibility).every(contract => contract.sourcePreserved)) {
    diagnostics.push('a forward-compatibility diagnostic does not preserve authored source')
  }
  if (report.forwardCompatibility.unknownHeader.classification !== 'unknown') diagnostics.push('unknown-header policy is not explicit')
  if (report.forwardCompatibility.unsupportedHeader.classification !== 'unsupported') diagnostics.push('unsupported-header policy is not explicit')
  if (report.forwardCompatibility.inventoryOnlyHeader.classification !== 'inventory-only') diagnostics.push('inventory-only policy is not explicit')
  for (const system of report.evidence.systems) {
    if (!system.authority || !system.freshnessGate) diagnostics.push(`evidence system ${system.id} is incomplete`)
  }
  for (const authority of report.retiredAuthorities) {
    if (!authority.replacement || authority.evidence.length === 0) diagnostics.push(`retired authority ${authority.id} lacks replacement evidence`)
  }

  const fresh = createSectionACapabilityReport()
  if (JSON.stringify(report) !== JSON.stringify(fresh)) diagnostics.push('report does not match live contract authorities')
  return diagnostics
}

function md(value: unknown): string {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

const RENDER_TRANSPORT_SURFACE_MARKDOWN_LABELS = Object.freeze({
  library: 'Library',
  cli: 'CLI',
  codeMode: 'Code Mode',
  localMcp: 'Local MCP',
  hostedMcp: 'Hosted MCP',
  editor: 'Editor',
  website: 'Website build',
} as const satisfies Readonly<Record<RenderTransportSurface, string>>)

const FAMILY_CAPABILITY_MARKDOWN_LABELS = Object.freeze({
  detection: 'Detect',
  'source-preservation': 'Preserve',
  parse: 'Parse',
  serialize: 'Serialize',
  mutation: 'Mutate',
  verify: 'Verify',
  layout: 'Layout',
  scene: 'Scene',
  svg: 'SVG',
  terminal: 'Terminal',
} as const satisfies Readonly<Record<FamilyCapability, string>>)

function markdownTableRow(cells: readonly unknown[]): string {
  return `| ${cells.map(md).join(' | ')} |`
}

function markdownTableDivider(columnCount: number): string {
  return `|${Array.from({ length: columnCount }, () => '---').join('|')}|`
}

function outputTransportSummary(transport: RenderOutputTransports[keyof RenderOutputTransports]): string {
  const selection = transport.selector ? ` (${transport.selector})` : ''
  const reason = transport.reason ? ` — ${transport.reason}` : ''
  return `${transport.availability}: ${transport.entrypoint}${selection}${reason}`
}

function requestSurfaceSummary(claim: SharedRenderOptionSurfaceClaim): string {
  if (claim.state === 'host-enforced') return `${claim.state} (= ${String(claim.enforcedValue)})`
  if (claim.state === 'unavailable') return `${claim.state} — ${claim.reason}`
  return claim.state
}

/** Human projection of the exact machine-readable report. */
export function sectionACapabilityReportMarkdown(report: SectionACapabilityReport = createSectionACapabilityReport()): string {
  const out: string[] = []
  out.push('# Section A capability report')
  out.push('')
  out.push('> Generated by `sectionACapabilityReportMarkdown` from live registries and manifests plus the curated consolidation-characterization evidence named in the machine report. Do not edit by hand.')
  out.push('')
  out.push(`Report digest: \`${report.digest}\`.`)
  out.push('')
  out.push('## Summary')
  out.push('')
  out.push('| Measure | Count |')
  out.push('|---|---:|')
  for (const [name, count] of Object.entries(report.summary)) out.push(`| ${md(name)} | ${count} |`)
  out.push('')
  out.push('## Contract versions')
  out.push('')
  out.push('| Contract | Version |')
  out.push('|---|---|')
  for (const [name, version] of Object.entries(report.contracts)) out.push(`| ${md(name)} | ${md(Array.isArray(version) ? version.join(', ') : version)} |`)
  out.push('')
  out.push('## State vocabularies')
  out.push('')
  out.push('| Dimension | Values |')
  out.push('|---|---|')
  for (const [name, values] of Object.entries(report.stateVocabularies)) out.push(`| ${md(name)} | ${md(values.join(', '))} |`)
  out.push('')
  out.push('## Request matrix')
  out.push('')
  out.push('| Field | Kind | Transport | Receipt | Schema |')
  out.push('|---|---|---|---|---|')
  for (const row of report.matrices.request) out.push(`| ${md(row.field)} | ${row.kind} | ${row.transport} | ${row.receipt} | ${row.schema} |`)
  out.push('')
  out.push('### Shared-field × surface policy')
  out.push('')
  out.push('A state applies where the field is meaningful to an available output; output and terminal applicability remain in their own matrices. `host-enforced` means the product accepts the canonical field but replaces weaker caller input with a stricter host-owned value. One evidence list per surface grounds the matrix without repeating identical paths in every cell.')
  out.push('')
  const requestSurfaceHeaders = [
    'Field',
    ...RENDER_TRANSPORT_SURFACES.map(surface => RENDER_TRANSPORT_SURFACE_MARKDOWN_LABELS[surface]),
  ]
  out.push(markdownTableRow(requestSurfaceHeaders))
  out.push(markdownTableDivider(requestSurfaceHeaders.length))
  for (const row of report.matrices.request.filter(row => row.kind === 'shared')) {
    out.push(markdownTableRow([
      row.field,
      ...RENDER_TRANSPORT_SURFACES.map(surface => requestSurfaceSummary(row.surfaces![surface])),
    ]))
  }
  out.push('')
  out.push('#### Surface-policy evidence')
  out.push('')
  out.push('| Product | Evidence |')
  out.push('|---|---|')
  for (const surface of RENDER_TRANSPORT_SURFACES) {
    out.push(`| ${surface} | ${md(report.evidence.requestSurfaces[surface].join(', '))} |`)
  }
  out.push('')
  out.push('## Output-option matrix')
  out.push('')
  out.push('| Output | Field | Scope | Input | Policy | Receipt | Schema |')
  out.push('|---|---|---|---|---|---|---|')
  for (const row of report.matrices.outputOptions) {
    out.push(`| ${row.output} | ${md(row.field)} | ${row.scope} | ${row.input} | ${row.policy} | ${row.receipt} | ${row.schema} |`)
  }
  out.push('')
  out.push('## Backend matrix')
  out.push('')
  out.push('Every first-party primitive row below is the result of an exact executable claim witness against the registered backend. StyleBackend ends at secured SVG; native and browser PNG projection are downstream adapter gates, not inferred backend claims.')
  out.push('')
  out.push('| Backend | Version | Registration | Scene input | Claim status | SVG conformance | Primitives | Claims | Roles |')
  out.push('|---|---|---|---|---|---|---:|---:|---:|')
  for (const row of report.matrices.backends) {
    out.push(`| ${md(row.id)} | ${md(row.version)} | ${row.registration} | ${row.sceneInput} | ${row.claimStatus} | ${row.conformance.passed ? `${row.conformanceKind} passed` : `${row.conformanceKind} failed`} | ${row.primitiveIds.length} | ${row.claims.length} | ${row.rolePolicyIds.length} |`)
  }
  out.push('')
  out.push('### Backend executable conformance')
  out.push('')
  out.push('| Backend | Fixture | Direct output | Passed claims | Unverified extension claims | Checks |')
  out.push('|---|---|---|---:|---:|---|')
  for (const row of report.matrices.backends) {
    const passed = row.claims.filter(claim => claim.status === 'passed').length
    const unverified = row.claims.filter(claim => claim.status === 'unverified-extension').length
    out.push(`| ${md(row.id)} | ${md(row.conformance.fixtureId)} | ${md(row.conformance.directOutputs.join(', '))} | ${passed}/${row.claims.length} | ${unverified} | ${md(row.conformance.checks.map(check => `${check.id}:${check.passed ? 'pass' : 'fail'}`).join(', '))} |`)
  }
  out.push('')
  out.push('### Backend primitive claims')
  out.push('')
  out.push('| Backend | Primitive | Feature | Operation | Realization | Result | Executable witness | Observation / limitation |')
  out.push('|---|---|---|---|---|---|---|---|')
  for (const row of report.matrices.backends) {
    for (const claim of row.claims) {
      const detail = [claim.observation, claim.limitation, claim.diagnostic].filter(Boolean).join(' — ')
      out.push(`| ${md(row.id)} | ${md(claim.primitive)} | ${md(claim.feature)} | ${md(claim.operation)} | ${md(claim.realization)} | ${md(claim.status)} | ${md(claim.witnessId ?? '—')} | ${md(detail || '—')} |`)
    }
  }
  out.push('')
  out.push('## Output matrix')
  out.push('')
  out.push('This matrix covers render outputs only; hosted non-render tools such as `mutate` and `build` remain in the MCP tool registry.')
  out.push('')
  const outputHeaders = [
    'Output',
    'Availability',
    ...RENDER_TRANSPORT_SURFACES.map(surface => RENDER_TRANSPORT_SURFACE_MARKDOWN_LABELS[surface]),
    'Security',
    'Color',
    'Terminal',
    'Evidence',
  ]
  out.push(markdownTableRow(outputHeaders))
  out.push(markdownTableDivider(outputHeaders.length))
  for (const row of report.matrices.outputs) {
    out.push(markdownTableRow([
      row.id,
      row.availability,
      ...RENDER_TRANSPORT_SURFACES.map(surface => outputTransportSummary(row.transports[surface])),
      row.security,
      row.color,
      row.terminal,
      row.evidence.join(', '),
    ]))
  }
  out.push('')
  out.push('### Output transport evidence')
  out.push('')
  out.push('| Output | Product | State | Entry point | Evidence |')
  out.push('|---|---|---|---|---|')
  for (const row of report.matrices.outputs) {
    for (const surface of RENDER_TRANSPORT_SURFACES) {
      const transport = row.transports[surface]
      out.push(`| ${row.id} | ${surface} | ${transport.availability} | ${md(outputTransportSummary(transport))} | ${md(transport.evidence.join(', '))} |`)
    }
  }
  out.push('')
  out.push('## Installed resource matrix')
  out.push('')
  out.push('| Resource | Version | Path | Media type | Bytes | Required | Network | License | SHA-256 |')
  out.push('|---|---|---|---|---:|---|---|---|---|')
  for (const row of report.matrices.resources) {
    out.push(`| ${md(row.id)} | ${md(row.version)} | ${md(row.path)} | ${md(row.mediaType)} | ${row.bytes} | ${row.required} | ${row.network} | ${md(`${row.license.spdx} (${row.license.noticePath})`)} | ${md(row.sha256)} |`)
  }
  out.push('')
  out.push('## Family matrix')
  out.push('')
  const familyHeaders = [
    'Family',
    'Support',
    'Registration',
    'Version',
    'Compatibility',
    'Headers',
    'Family-scoped RenderOptions',
    ...FAMILY_CAPABILITY_COLUMNS.map(capability => FAMILY_CAPABILITY_MARKDOWN_LABELS[capability]),
  ]
  out.push(markdownTableRow(familyHeaders))
  out.push(markdownTableDivider(familyHeaders.length))
  for (const row of report.matrices.families) {
    const c = row.capabilities
    const headers = row.headers.map(header => `${header.value} (${header.status})`).join(', ')
    const compatibility = row.identity
      ? Object.entries(row.identity.compatibility).map(([contract, range]) => `${contract}:${range}`).join(', ')
      : '—'
    out.push(markdownTableRow([
      row.id,
      row.support,
      row.registrationId ?? '—',
      row.identity?.version ?? '—',
      compatibility,
      headers,
      row.applicableRenderOptions.join(', ') || '—',
      ...FAMILY_CAPABILITY_COLUMNS.map(capability => c[capability]),
    ]))
  }
  out.push('')
  out.push('### Family executable conformance')
  out.push('')
  out.push('A `native` family cell requires both a native descriptor declaration and a passed canonical-example witness. Extensions are staged and rolled back if any native witness fails or changes across the two deterministic runs.')
  out.push('')
  out.push('| Family | Capability | Declaration | Result | Witness / diagnostic |')
  out.push('|---|---|---|---|---|')
  for (const row of report.matrices.families) {
    for (const result of row.conformance?.capabilities ?? []) {
      out.push(`| ${md(row.id)} | ${result.capability} | ${result.declaredState} | ${result.status} | ${md(result.witnessId ?? result.diagnostic ?? '—')} |`)
    }
  }
  out.push('')
  out.push('### Family semantic-role / Scene-primitive evidence')
  out.push('')
  out.push('Each descriptor declares only its positive role/primitive realizations. The registry expands that authority across all core primitives, so every negative cell is explicit and diagnosed; conformance fixtures exercise the exact positive set.')
  out.push('')
  out.push('| Family | Role | Applicable realizations | Explicitly not applicable | Evidence |')
  out.push('|---|---|---|---|---|')
  for (const row of report.matrices.families) {
    for (const role of row.semanticRoles) {
      const cells = row.scenePrimitiveEvidence.filter(cell => cell.role === role)
      const applicable = cells
        .filter(cell => cell.applicability === 'applicable')
        .map(cell => `${cell.primitive} (${cell.realization})`)
      const negative = cells
        .filter(cell => cell.applicability === 'not-applicable')
        .map(cell => cell.primitive)
      const evidence = [...new Set(cells.flatMap(cell => cell.evidence))]
      out.push(`| ${md(row.id)} | ${md(role)} | ${md(applicable.join(', '))} | ${md(negative.join(', '))} | ${md(evidence.join(', '))} |`)
    }
  }
  out.push('')
  out.push('## Syntax capability ledger')
  out.push('')
  out.push('Stable feature IDs are projected from the pinned upstream manifest; stable dimension IDs come from the syntax contract. A native feature state is scoped to its one classified dimension and is not a blanket family-parity claim. Official-document-only constructs remain source-preserved until executable evidence promotes them. CI rejects every missing row and every `absent` state.')
  out.push('')
  out.push('### Stable syntax dimensions')
  out.push('')
  out.push('| Dimension ID | Label | Contract |')
  out.push('|---|---|---|')
  for (const dimension of report.matrices.syntax.dimensions) {
    out.push(`| ${md(dimension.id)} | ${md(dimension.label)} | ${md(dimension.description)} |`)
  }
  out.push('')
  out.push('### Family / syntax-dimension classifications')
  out.push('')
  out.push('| Family | Registration | Dimension | State | Features | Feature states | Processing projection | Evidence | Diagnostic |')
  out.push('|---|---|---|---|---:|---|---|---|---|')
  for (const row of report.matrices.syntax.families) {
    const counts = row.featureStateCounts
    const stateCounts = `native=${counts.native}, source-preserved=${counts['source-preserved']}, diagnosed=${counts.diagnosed}, not-applicable=${counts['not-applicable']}`
    const processing = row.processing
      ? FAMILY_CAPABILITY_COLUMNS.map(capability => `${capability}=${row.processing![capability]}`).join(', ')
      : '—'
    const evidence = row.evidence.map(item => `${item.source}#${item.locator}`).join(', ')
    out.push(`| ${md(row.familyId)} | ${md(row.registrationId ?? '—')} | ${md(row.dimensionId)} | ${row.state} | ${row.featureCount} | ${md(stateCounts)} | ${md(processing)} | ${md(evidence)} | ${md(row.diagnostic ?? '—')} |`)
  }
  out.push('')
  out.push('### Pinned syntax-feature classifications')
  out.push('')
  out.push('| Feature ID | Families | Dimension | State | Upstream status | Artifact | Rule | Evidence | Diagnostic |')
  out.push('|---|---|---|---|---|---|---|---|---|')
  for (const row of report.matrices.syntax.features) {
    out.push(`| ${md(row.featureId)} | ${md(row.familyIds.join(', '))} | ${md(row.dimensionId)} | ${row.state} | ${row.upstreamStatus} | ${md(`${row.artifactId}@${row.fingerprint}`)} | ${md(row.classificationRuleId)} | ${md(row.evidence.join(', '))} | ${md(row.diagnostic ?? '—')} |`)
  }
  out.push('')
  out.push('## Scene declarations')
  out.push('')
  out.push(`Primitives: ${md(report.matrices.scene.primitives.join(', '))}.`)
  out.push('')
  out.push(`Operations: ${md(report.matrices.scene.operations.join(', '))}.`)
  out.push('')
  out.push(`Features: ${md(report.matrices.scene.features.join(', '))}.`)
  out.push('')
  out.push(`Realizations: ${md(report.matrices.scene.realizations.join(', '))}.`)
  out.push('')
  out.push('| Role | Applicable marks | DOM identity | Relation | Sketch | Text halo |')
  out.push('|---|---|---|---|---|---|')
  for (const role of report.matrices.scene.roles) {
    out.push(`| ${md(role.id)} | ${md(role.applicableKinds.join(', '))} | ${role.domIdentity} | ${role.relation} | ${role.sketch} | ${role.textHalo} |`)
  }
  out.push('')
  out.push('## Upstream semantic inventory')
  out.push('')
  out.push('| Dimension | Entries |')
  out.push('|---|---:|')
  out.push(`| syntax features and accounted divergences | ${report.upstream.semanticInventory.syntaxFeatureCount} |`)
  out.push(`| harvested examples from official docs and pinned corpora | ${report.upstream.semanticInventory.exampleCount} |`)
  out.push(`| config key paths | ${report.upstream.semanticInventory.configKeyCount} |`)
  out.push(`| theme variables | ${report.upstream.semanticInventory.themeVariableCount} |`)
  out.push('')
  out.push('| Source | Kind | Path | Upstream revision | SHA-256 |')
  out.push('|---|---|---|---|---|')
  for (const source of report.upstream.semanticInventory.sourceArtifacts) {
    out.push(`| ${md(source.id)} | ${md(source.kind)} | ${md(source.path)} | ${md(source.upstreamRevision ?? 'package/artifact pin')} | ${md(source.sha256)} |`)
  }
  out.push('')
  out.push('## Forward compatibility')
  out.push('')
  out.push('| Case | Diagnostic | Classification | Source preserved |')
  out.push('|---|---|---|---|')
  for (const [name, contract] of Object.entries(report.forwardCompatibility)) {
    out.push(`| ${md(name)} | ${md(contract.code)} | ${md(contract.classification)} | ${contract.sourcePreserved} |`)
  }
  out.push('')
  out.push('## Existing evidence systems')
  out.push('')
  out.push('| System | Authority | Freshness gate |')
  out.push('|---|---|---|')
  for (const system of report.evidence.systems) out.push(`| ${md(system.id)} | ${md(system.authority)} | ${md(system.freshnessGate)} |`)
  out.push('')
  out.push('## Retired authorities')
  out.push('')
  out.push('| Retired authority | Replacement | Evidence |')
  out.push('|---|---|---|')
  for (const authority of report.retiredAuthorities) {
    out.push(`| ${md(authority.id)} | ${md(authority.replacement)} | ${md(authority.evidence.join(', '))} |`)
  }
  out.push('')
  return out.join('\n')
}
