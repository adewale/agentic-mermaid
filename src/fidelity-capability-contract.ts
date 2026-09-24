// Compact public construct-fidelity capability contract for issue #248.
//
// Executable case definitions and raw observations remain test-only. Runtime
// discovery consumes only this generated, JSON-safe projection.

export const FIDELITY_CAPABILITY_REPORT_SCHEMA_VERSION = 2 as const

export const FIDELITY_DISPOSITIONS = Object.freeze(['native', 'source-preserved', 'diagnosed', 'absent'] as const)

export type FidelityDisposition = (typeof FIDELITY_DISPOSITIONS)[number]

export const FIDELITY_SURFACES = Object.freeze(['agent', 'render', 'serialize', 'mutate'] as const)

export type FidelitySurface = (typeof FIDELITY_SURFACES)[number]

export type FidelityCapabilitySurface = FidelityDisposition | { notApplicable: readonly string[] }

export interface FidelityCapabilityFeature {
  featureId: string
  family: string
  disposition: FidelityDisposition
  caseIds: readonly string[]
  surfaces: Record<FidelitySurface, FidelityCapabilitySurface>
  diagnostics: Partial<Record<FidelitySurface, readonly string[]>>
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
