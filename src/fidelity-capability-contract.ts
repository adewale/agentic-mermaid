// Compact public construct-fidelity capability contract for issue #248.
//
// Executable case definitions and raw observations remain test-only. Runtime
// discovery consumes only this generated, JSON-safe projection.

export const FIDELITY_CAPABILITY_REPORT_SCHEMA_VERSION = 3 as const

export const FIDELITY_DISPOSITIONS = Object.freeze(['native', 'source-preserved', 'diagnosed', 'absent'] as const)

export type FidelityDisposition = (typeof FIDELITY_DISPOSITIONS)[number]

export const FIDELITY_SURFACES = Object.freeze(['agent', 'render', 'serialize', 'mutate'] as const)

export type FidelitySurface = (typeof FIDELITY_SURFACES)[number]

export const FIDELITY_ACCEPTED_DIVERGENCE_POLICIES = Object.freeze(['security', 'offline'] as const)

export type FidelityAcceptedDivergencePolicy = (typeof FIDELITY_ACCEPTED_DIVERGENCE_POLICIES)[number]

export type FidelityCapabilitySurface = FidelityDisposition | { notApplicable: readonly string[] }

export interface FidelityAcceptedDivergence {
  caseId: string
  policy: FidelityAcceptedDivergencePolicy
  rationale: string
  surfaces: readonly FidelitySurface[]
  diagnosticCodes: Partial<Record<FidelitySurface, readonly string[]>>
}

export interface FidelityCapabilityFeature {
  featureId: string
  family: string
  disposition: FidelityDisposition
  caseIds: readonly string[]
  surfaces: Record<FidelitySurface, FidelityCapabilitySurface>
  diagnostics: Partial<Record<FidelitySurface, readonly string[]>>
  acceptedDivergences: readonly FidelityAcceptedDivergence[]
}

export interface FidelityCapabilityReport {
  schemaVersion: typeof FIDELITY_CAPABILITY_REPORT_SCHEMA_VERSION
  mode: 'public'
  publicClaimsChanged: true
  upstreamRevision: string
  receiptInputSha256: string
  receiptResultSha256: string
  summary: {
    caseCount: number
    featureCount: number
    dispositions: Readonly<Record<FidelityDisposition, number>>
  }
  features: readonly FidelityCapabilityFeature[]
}

/** True only when every applicable surface is native or is a narrowly
 * declared, named security/offline diagnostic. Callers must validate untrusted
 * reports before using this projection. */
export function fidelityFeatureSatisfiesSyntaxParity(feature: FidelityCapabilityFeature): boolean {
  const acceptedSurfaces = new Set(feature.acceptedDivergences.flatMap(divergence => divergence.surfaces))
  return FIDELITY_SURFACES.every(surface => {
    const cell = feature.surfaces[surface]
    if (typeof cell !== 'string') return true
    return cell === 'native' || (cell === 'diagnosed' && acceptedSurfaces.has(surface))
  })
}
