// ============================================================================
// Section A capability report.
//
// This is a projection, not another inventory. Every row is derived from a
// live contract authority: render fields/outputs, family/backend registries,
// Scene vocabularies, the pinned upstream manifest, and the existing
// consolidation-characterization index. The Markdown document is generated
// from the same JSON-safe object and guarded by a freshness test.
// ============================================================================

import './agent/families-builtin.ts'
import './render-family-hooks.ts'
import './scene/rough-backend.ts'
import './scene/hybrid-backend.ts'

import characterizationIndex from '../docs/design/system/consolidation-characterization.json'
import {
  FAMILY_CAPABILITY_COLUMNS,
  getFamily,
  isBuiltinFamilyId,
  knownFamilies,
  type FamilyCapability,
  type FamilyCapabilityEvidence,
  type FamilyDescriptor,
} from './agent/families.ts'
import {
  NON_SERIALIZABLE_RENDER_OPTION_FIELDS,
  RENDER_CONTRACT_VERSION,
  RENDER_OUTPUT_DESCRIPTORS,
  RENDER_TRANSPORT_SURFACES,
  SHARED_RENDER_OPTION_FIELDS,
  renderContractDigest,
  sharedRenderOptionsJsonSchema,
  type RenderOutputTransports,
} from './render-contract.ts'
import { RESOURCE_MANIFEST, validateResourceManifest } from './font-manifest.ts'
import { RESOURCE_MANIFEST_VERSION } from './resource-manifest.ts'
import { knownBackendDescriptors } from './scene/backend.ts'
import {
  BACKEND_CONFORMANCE_CHECK_IDS,
  BACKEND_CONFORMANCE_VERSION,
  type BackendConformanceReport,
} from './scene/backend-conformance.ts'
import {
  CORE_SCENE_FEATURES,
  CORE_SCENE_OPERATIONS,
  CORE_SCENE_PRIMITIVES,
  PRIMITIVE_REALIZATIONS,
  validatePrimitiveCapabilities,
} from './scene/capabilities.ts'
import type { PrimitiveCapabilityClaim } from './scene/capabilities.ts'
import { SCENE_CONTRACT_VERSION } from './scene/ir.ts'
import { BUILTIN_SCENE_ROLE_TRAITS } from './scene/roles.ts'
import { OUTPUT_COLOR_PROFILE } from './output-color-profile.ts'
import { OUTPUT_SECURITY_POLICY_VERSION } from './output-security.ts'
import { TERMINAL_STYLE_VERSION } from './terminal-style.ts'
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

export const SECTION_A_CAPABILITY_REPORT_SCHEMA_VERSION = 5 as const

export { FAMILY_CAPABILITY_COLUMNS }
export type FamilyCapabilityColumn = FamilyCapability
export type FamilyCapabilityState = FamilyCapabilityEvidence['state']

export const SECTION_A_CAPABILITY_STATE_VOCABULARIES = Object.freeze({
  requestKind: Object.freeze(['shared', 'host-only'] as const),
  requestTransport: Object.freeze(['accepted', 'excluded'] as const),
  requestReceipt: Object.freeze(['included', 'excluded'] as const),
  requestSchema: Object.freeze(['declared', 'not-applicable'] as const),
  backend: Object.freeze(['registered', 'scene-contracted'] as const),
  backendClaims: Object.freeze(['declared'] as const),
  backendConformance: Object.freeze(['registration-svg-smoke'] as const),
  outputAvailability: Object.freeze(['public', 'internal', 'reserved'] as const),
  outputSecurity: Object.freeze(['enforced', 'not-applicable', 'reserved'] as const),
  outputColor: Object.freeze(['srgb', 'terminal-projected', 'not-applicable', 'reserved'] as const),
  outputTerminal: Object.freeze(['projected', 'not-applicable', 'reserved'] as const),
  outputTransport: Object.freeze(['direct', 'projected', 'indirect', 'unavailable'] as const),
  resourceNetwork: Object.freeze(['forbidden'] as const),
  familySupport: Object.freeze(['native', 'partial-native', 'unsupported', 'inventory-only', 'extension'] as const),
  familyCapability: Object.freeze(['native', 'source-preserved', 'diagnosed', 'not-applicable', 'absent'] as const),
})

export type FamilySupportState = (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.familySupport)[number]

export interface SectionARequestCapabilityRow {
  field: string
  kind: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestKind)[number]
  transport: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestTransport)[number]
  receipt: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestReceipt)[number]
  schema: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.requestSchema)[number]
}

export interface SectionABackendCapabilityRow {
  id: string
  version: string
  aliases: readonly string[]
  registration: 'registered'
  sceneInput: 'scene-contracted'
  claimStatus: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.backendClaims)[number]
  conformanceKind: (typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES.backendConformance)[number]
  conformance: BackendConformanceReport
  primitiveIds: readonly string[]
  rolePolicyIds: readonly string[]
  claims: readonly PrimitiveCapabilityClaim[]
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
  headers: readonly SectionAFamilyHeaderRow[]
  aliases: readonly string[]
  semanticRoles: readonly string[]
  capabilities: Readonly<Record<FamilyCapabilityColumn, FamilyCapabilityState>>
  evidence: readonly FamilyCapabilityEvidence[]
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
    backendConformance: number
    outputColor: number
    terminalStyle: number
    resourceManifest: number
    upstreamManifest: number
    familyDescriptorVersions: readonly number[]
  }
  stateVocabularies: typeof SECTION_A_CAPABILITY_STATE_VOCABULARIES
  summary: {
    sharedRequestFieldCount: number
    hostOnlyRequestFieldCount: number
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
    backends: readonly SectionABackendCapabilityRow[]
    outputs: readonly SectionAOutputCapabilityRow[]
    resources: readonly SectionAResourceCapabilityRow[]
    families: readonly SectionAFamilyCapabilityRow[]
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
    systems: readonly SectionAEvidenceSystem[]
    contracts: readonly { id: string; surface: string; familyScope: string; evidence: readonly string[] }[]
  }
  retiredAuthorities: readonly SectionARetiredAuthority[]
  digest: string
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

function descriptorCapabilities(descriptor?: FamilyDescriptor): Readonly<Record<FamilyCapabilityColumn, FamilyCapabilityState>> {
  if (!descriptor) {
    return Object.freeze({
      detection: 'diagnosed',
      'source-preservation': 'source-preserved',
      parse: 'absent',
      serialize: 'absent',
      mutation: 'absent',
      verify: 'absent',
      layout: 'absent',
      scene: 'absent',
      svg: 'absent',
      terminal: 'absent',
    })
  }
  const declared = new Map(descriptor.capabilityEvidence.map(claim => [claim.capability, claim.state]))
  return Object.freeze(Object.fromEntries(
    FAMILY_CAPABILITY_COLUMNS.map(capability => [capability, declared.get(capability)!]),
  )) as Readonly<Record<FamilyCapabilityColumn, FamilyCapabilityState>>
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
    .filter((descriptor): descriptor is FamilyDescriptor => descriptor !== undefined)
}

function descriptorForUpstreamFamily(
  family: UpstreamFamilyDescriptor,
  descriptors: readonly FamilyDescriptor[],
): FamilyDescriptor | undefined {
  const upstreamHeaders = new Set(family.headers.map(header => header.value.trim().toLowerCase()))
  return descriptors.find(descriptor =>
    descriptor.headers.some(header => upstreamHeaders.has(header.trim().toLowerCase())))
}

function familyRows(descriptors: readonly FamilyDescriptor[]): SectionAFamilyCapabilityRow[] {
  const matched = new Set<string>()
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
      headers: family.headers.map(header => ({ value: header.value, status: header.agenticStatus })),
      aliases: descriptor ? [...descriptor.aliases].sort() : [],
      semanticRoles: descriptor ? [...descriptor.semanticRoles].sort() : [],
      capabilities: descriptorCapabilities(descriptor),
      evidence: descriptor ? [...descriptor.capabilityEvidence] : [],
    } satisfies SectionAFamilyCapabilityRow
  })
  const extensionRows = descriptors
    .filter(descriptor => !matched.has(descriptor.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(descriptor => ({
      id: descriptor.id,
      label: descriptor.label,
      source: 'extension' as const,
      maturity: descriptor.maturity,
      support: 'extension' as const,
      registrationId: descriptor.id,
      headers: descriptor.headers.map(value => ({ value, status: 'extension' as const })),
      aliases: [...descriptor.aliases].sort(),
      semanticRoles: [...descriptor.semanticRoles].sort(),
      capabilities: descriptorCapabilities(descriptor),
      evidence: [...descriptor.capabilityEvidence],
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

/** Build a fresh, deterministic and JSON-serializable snapshot of live authorities. */
export function createSectionACapabilityReport(): SectionACapabilityReport {
  const descriptors = registeredDescriptors()
  const roles = Object.entries(BUILTIN_SCENE_ROLE_TRAITS)
    .sort(([a], [b]) => a.localeCompare(b))
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
    })),
    ...NON_SERIALIZABLE_RENDER_OPTION_FIELDS.map(field => ({
      field,
      kind: 'host-only' as const,
      transport: 'excluded' as const,
      receipt: 'excluded' as const,
      schema: 'not-applicable' as const,
    })),
  ]
  const backends: SectionABackendCapabilityRow[] = knownBackendDescriptors()
    .map(descriptor => {
      const claims = descriptor.capabilities.map(claim => ({ ...claim }))
      return {
        id: descriptor.identity.id,
        version: descriptor.identity.version,
        aliases: [...descriptor.aliases].sort(),
        registration: 'registered' as const,
        sceneInput: 'scene-contracted' as const,
        claimStatus: 'declared' as const,
        conformanceKind: 'registration-svg-smoke' as const,
        // Registration reports are already deeply frozen, JSON-safe snapshots.
        conformance: descriptor.conformance,
        primitiveIds: [...new Set(claims.map(claim => claim.primitive))].sort(),
        rolePolicyIds: roles.map(role => role.id),
        claims,
        compatibility: stringRecord(descriptor.identity.compatibility),
        provenance: stringRecord(descriptor.identity.provenance),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
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
  const statuses = UPSTREAM_MERMAID_MANIFEST.families.flatMap(family => family.headers.map(header => header.agenticStatus))
  const familyDescriptorVersions = [...new Set(descriptors.map(descriptor => descriptor.contractVersion))].sort()
  const payload: Omit<SectionACapabilityReport, 'digest'> = {
    schemaVersion: SECTION_A_CAPABILITY_REPORT_SCHEMA_VERSION,
    contracts: {
      renderRequest: RENDER_CONTRACT_VERSION,
      scene: SCENE_CONTRACT_VERSION,
      outputSecurity: OUTPUT_SECURITY_POLICY_VERSION,
      backendConformance: BACKEND_CONFORMANCE_VERSION,
      outputColor: OUTPUT_COLOR_PROFILE.version,
      terminalStyle: TERMINAL_STYLE_VERSION,
      resourceManifest: RESOURCE_MANIFEST_VERSION,
      upstreamManifest: UPSTREAM_MERMAID_MANIFEST.schemaVersion,
      familyDescriptorVersions,
    },
    stateVocabularies: SECTION_A_CAPABILITY_STATE_VOCABULARIES,
    summary: {
      sharedRequestFieldCount: SHARED_RENDER_OPTION_FIELDS.length,
      hostOnlyRequestFieldCount: NON_SERIALIZABLE_RENDER_OPTION_FIELDS.length,
      registeredBackendCount: backends.length,
      outputCount: outputs.length,
      resourceCount: resources.length,
      registeredFamilyCount: descriptors.length,
      upstreamPublicFamilyCount: UPSTREAM_MERMAID_MANIFEST.families.length,
      upstreamNativeHeaderCount: statuses.filter(status => status === 'native').length,
      upstreamUnsupportedHeaderCount: statuses.filter(status => status === 'unsupported').length,
      upstreamInventoryOnlyHeaderCount: statuses.filter(status => status === 'inventory-only').length,
      scenePrimitiveCount: CORE_SCENE_PRIMITIVES.length,
      sceneRoleCount: roles.length,
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
      backends,
      outputs,
      resources,
      families,
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
      systems: CHARACTERIZATION.evidenceSystems.map(system => ({ ...system })),
      contracts: CHARACTERIZATION.contracts.map(contract => ({ ...contract, evidence: [...contract.evidence] })),
    },
    retiredAuthorities: CHARACTERIZATION.retiredAuthorities.map(authority => ({
      ...authority,
      evidence: [...authority.evidence],
    })),
  }
  return deepFreeze({ ...payload, digest: renderContractDigest(payload) }) as SectionACapabilityReport
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
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

  const { request, backends, outputs, resources, families, scene } = report.matrices
  if (!unique(request.map(row => row.field))) diagnostics.push('request matrix fields are not unique')
  if (!unique(backends.map(row => row.id))) diagnostics.push('backend matrix ids are not unique')
  if (!unique(outputs.map(row => row.id))) diagnostics.push('output matrix ids are not unique')
  if (!unique(resources.map(row => row.id))) diagnostics.push('resource matrix ids are not unique')
  if (!unique(resources.map(row => row.path))) diagnostics.push('resource matrix paths are not unique')
  if (!unique(families.map(row => row.id))) diagnostics.push('family matrix ids are not unique')
  if (!unique(scene.roles.map(row => row.id))) diagnostics.push('Scene role ids are not unique')

  for (const row of request) {
    if (!stateIn(row.kind, report.stateVocabularies.requestKind)) diagnostics.push(`request ${row.field} has invalid kind`)
    if (!stateIn(row.transport, report.stateVocabularies.requestTransport)) diagnostics.push(`request ${row.field} has invalid transport state`)
    if (!stateIn(row.receipt, report.stateVocabularies.requestReceipt)) diagnostics.push(`request ${row.field} has invalid receipt state`)
    if (!stateIn(row.schema, report.stateVocabularies.requestSchema)) diagnostics.push(`request ${row.field} has invalid schema state`)
    if (row.kind === 'shared' && (row.transport !== 'accepted' || row.receipt !== 'included' || row.schema !== 'declared')) {
      diagnostics.push(`shared request field ${row.field} is not accepted, receipted and schema-declared`)
    }
    if (row.kind === 'host-only' && (row.transport !== 'excluded' || row.receipt !== 'excluded')) {
      diagnostics.push(`host-only request field ${row.field} leaked into a transport or receipt`)
    }
  }
  for (const row of backends) {
    if (!stateIn(row.registration, report.stateVocabularies.backend) || !stateIn(row.sceneInput, report.stateVocabularies.backend)) {
      diagnostics.push(`backend ${row.id} has an invalid contract state`)
    }
    if (!stateIn(row.claimStatus, report.stateVocabularies.backendClaims)) {
      diagnostics.push(`backend ${row.id} does not identify capability claims as declarations`)
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
    if (JSON.stringify(row.conformance.inheritedOutputs) !== JSON.stringify([
      { output: 'png', via: 'canonical-secured-svg-rasterizer', directlyTested: false },
    ])) {
      diagnostics.push(`backend ${row.id} conformance does not describe PNG inheritance honestly`)
    }
    const claimValidation = validatePrimitiveCapabilities(row.claims)
    if (!claimValidation.valid) diagnostics.push(`backend ${row.id} has invalid primitive claims: ${claimValidation.diagnostics.join('; ')}`)
    if (row.claims.some(claim => claim.target !== row.id)) diagnostics.push(`backend ${row.id} has a claim for another target`)
    if (row.claims.some(claim => !claim.evidence)) diagnostics.push(`backend ${row.id} has an unevidenced primitive claim`)
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
    if (Object.keys(row.transports).length !== RENDER_TRANSPORT_SURFACES.length) {
      diagnostics.push(`output ${row.id} does not account for every product transport`)
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
    if (!unique(row.semanticRoles)) diagnostics.push(`family ${row.id} has duplicate semantic roles`)
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
    for (const column of FAMILY_CAPABILITY_COLUMNS) {
      if (!stateIn(row.capabilities[column], report.stateVocabularies.familyCapability)) {
        diagnostics.push(`family ${row.id} has invalid ${column} state`)
      }
      const claim = row.evidence.find(candidate => candidate.capability === column)
      if (row.registrationId && !claim) diagnostics.push(`family ${row.id} lacks evidence for ${column}`)
      if (claim && row.capabilities[column] !== claim.state) {
        diagnostics.push(`family ${row.id} ${column} state does not match descriptor evidence`)
      }
    }
    if ((row.support === 'native' || row.support === 'partial-native' || row.support === 'extension') && !row.registrationId) {
      diagnostics.push(`supported family ${row.id} has no registered descriptor`)
    }
    if ((row.support === 'unsupported' || row.support === 'inventory-only') && row.registrationId) {
      diagnostics.push(`non-native upstream family ${row.id} is claimed by ${row.registrationId}`)
    }
    if (!row.registrationId && row.evidence.length > 0) diagnostics.push(`unregistered family ${row.id} has descriptor evidence`)
  }

  const expectedCounts = {
    sharedRequestFieldCount: request.filter(row => row.kind === 'shared').length,
    hostOnlyRequestFieldCount: request.filter(row => row.kind === 'host-only').length,
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

function outputTransportSummary(transport: RenderOutputTransports[keyof RenderOutputTransports]): string {
  const selection = transport.selector ? ` (${transport.selector})` : ''
  const reason = transport.reason ? ` — ${transport.reason}` : ''
  return `${transport.availability}: ${transport.entrypoint}${selection}${reason}`
}

/** Human projection of the exact machine-readable report. */
export function sectionACapabilityReportMarkdown(report: SectionACapabilityReport = createSectionACapabilityReport()): string {
  const out: string[] = []
  out.push('# Section A capability report')
  out.push('')
  out.push('> Generated from live registries and manifests by `sectionACapabilityReportMarkdown`. Do not edit by hand.')
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
  out.push('## Backend matrix')
  out.push('')
  out.push('Primitive capability rows are declarations. The admission column is a bounded executable SVG smoke, while PNG inherits the admitted secured SVG through the canonical rasterizer.')
  out.push('')
  out.push('| Backend | Version | Aliases | Registration | Scene input | Claim status | SVG admission | Primitives | Claims | Roles |')
  out.push('|---|---|---|---|---|---|---|---:|---:|---:|')
  for (const row of report.matrices.backends) {
    out.push(`| ${md(row.id)} | ${md(row.version)} | ${md(row.aliases.join(', ') || '—')} | ${row.registration} | ${row.sceneInput} | ${row.claimStatus} | ${row.conformance.passed ? `${row.conformanceKind} passed` : `${row.conformanceKind} failed`} | ${row.primitiveIds.length} | ${row.claims.length} | ${row.rolePolicyIds.length} |`)
  }
  out.push('')
  out.push('### Backend registration conformance')
  out.push('')
  out.push('| Backend | Fixture | Direct output | Inherited output | Checks |')
  out.push('|---|---|---|---|---|')
  for (const row of report.matrices.backends) {
    const inherited = row.conformance.inheritedOutputs
      .map(output => `${output.output} via ${output.via} (directly tested: ${output.directlyTested})`)
      .join(', ')
    out.push(`| ${md(row.id)} | ${md(row.conformance.fixtureId)} | ${md(row.conformance.directOutputs.join(', '))} | ${md(inherited)} | ${md(row.conformance.checks.map(check => `${check.id}:${check.passed ? 'pass' : 'fail'}`).join(', '))} |`)
  }
  out.push('')
  out.push('### Backend primitive claims')
  out.push('')
  out.push('| Backend | Primitive | Feature | Operation | Realization | Evidence |')
  out.push('|---|---|---|---|---|---|')
  for (const row of report.matrices.backends) {
    for (const claim of row.claims) {
      out.push(`| ${md(row.id)} | ${md(claim.primitive)} | ${md(claim.feature)} | ${md(claim.operation)} | ${md(claim.realization)} | ${md(claim.evidence ?? '—')} |`)
    }
  }
  out.push('')
  out.push('## Output matrix')
  out.push('')
  out.push('This matrix covers render outputs only; hosted non-render tools such as `mutate` and `build` remain in the MCP tool registry.')
  out.push('')
  out.push('| Output | Availability | Library | CLI | Code Mode | Local MCP | Hosted MCP | Editor | Website build | Security | Color | Terminal | Evidence |')
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const row of report.matrices.outputs) {
    out.push(`| ${row.id} | ${row.availability} | ${md(outputTransportSummary(row.transports.library))} | ${md(outputTransportSummary(row.transports.cli))} | ${md(outputTransportSummary(row.transports.codeMode))} | ${md(outputTransportSummary(row.transports.localMcp))} | ${md(outputTransportSummary(row.transports.hostedMcp))} | ${md(outputTransportSummary(row.transports.editor))} | ${md(outputTransportSummary(row.transports.website))} | ${row.security} | ${row.color} | ${row.terminal} | ${md(row.evidence.join(', '))} |`)
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
  out.push('| Family | Support | Registration | Headers | Detect | Preserve | Parse | Serialize | Mutate | Verify | Layout | Scene | SVG | Terminal |')
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const row of report.matrices.families) {
    const c = row.capabilities
    const headers = row.headers.map(header => `${header.value} (${header.status})`).join(', ')
    out.push(`| ${md(row.id)} | ${row.support} | ${md(row.registrationId ?? '—')} | ${md(headers)} | ${c.detection} | ${c['source-preservation']} | ${c.parse} | ${c.serialize} | ${c.mutation} | ${c.verify} | ${c.layout} | ${c.scene} | ${c.svg} | ${c.terminal} |`)
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
  out.push(`| official syntax examples | ${report.upstream.semanticInventory.exampleCount} |`)
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
