// Construct-level fidelity receipt contract for issue #248.
//
// This remains test-only. Public capability reports consume only the compact
// generated shadow projection, never executable functions or raw observations.

export const FIDELITY_DISPOSITIONS = Object.freeze(['native', 'source-preserved', 'diagnosed', 'absent'] as const)

export type FidelityDisposition = (typeof FIDELITY_DISPOSITIONS)[number]

export const FIDELITY_SURFACES = Object.freeze(['agent', 'render', 'serialize', 'mutate'] as const)

export type FidelitySurface = (typeof FIDELITY_SURFACES)[number]

export type FidelityJson = null | boolean | number | string | readonly FidelityJson[] | { readonly [key: string]: FidelityJson }

export interface FidelityDiagnosticExpectation {
  surface: FidelitySurface
  code: string
}

export interface FidelityRevisionCompatibility {
  manifestRevision: string
  rationale: string
  evidence: readonly string[]
}

export interface FidelityCase {
  id: string
  family: string
  featureId: string
  source: string
  upstreamReference: string
  upstreamRevision: string
  revisionCompatibility?: FidelityRevisionCompatibility
  expected: Partial<Record<FidelitySurface, FidelityDisposition>>
  expectedDiagnostics?: readonly FidelityDiagnosticExpectation[]
}

export interface ObservedFidelitySurface {
  status: 'observed'
  disposition: FidelityDisposition
  diagnosticCodes: readonly string[]
  semantics: FidelityJson
}

export interface BlockedFidelitySurface {
  status: 'blocked'
  blockedBy: FidelitySurface
  diagnosticCodes: readonly string[]
  semantics: FidelityJson
}

export type FidelitySurfaceObservation = ObservedFidelitySurface | BlockedFidelitySurface

export type FidelityObservations = Partial<Record<FidelitySurface, FidelitySurfaceObservation>>

export interface FidelityCaseDefinition extends FidelityCase {
  observe: () => FidelityObservations | Promise<FidelityObservations>
  assertSemantics?: (observations: FidelityObservations) => void
}

export interface FidelityRevisionAcknowledgement {
  id: string
  manifestRevision: string
  artifactRevision: string
  artifactIds: readonly string[]
  rationale: string
  evidence: readonly string[]
}

export interface FidelityInputFile {
  path: string
  sha256: string
}

export interface FidelityCaseResult {
  id: string
  family: string
  featureId: string
  sourceSha256: string
  upstreamReference: string
  upstreamRevision: string
  expected: Partial<Record<FidelitySurface, FidelityDisposition>>
  expectedDiagnostics: readonly FidelityDiagnosticExpectation[]
  observations: FidelityObservations
  passed: boolean
  issues: readonly string[]
}

export interface FidelityReceiptResult {
  schemaVersion: 1
  upstream: {
    package: 'mermaid'
    version: string
    manifestRevision: string
    inventorySha256: string
    revisionAcknowledgements: readonly FidelityRevisionAcknowledgement[]
  }
  freshness: {
    inputSha256: string
    files: readonly FidelityInputFile[]
  }
  cases: readonly FidelityCaseResult[]
  summary: {
    caseCount: number
    passedCaseCount: number
    failedCaseCount: number
    observedSurfaceCount: number
    blockedSurfaceCount: number
  }
}

export interface FidelityShadowFeature {
  featureId: string
  family: string
  disposition: FidelityDisposition
  caseIds: readonly string[]
  surfaces: Partial<Record<FidelitySurface, FidelityDisposition>>
}

export interface FidelityCapabilityShadow {
  schemaVersion: 1
  mode: 'shadow'
  publicClaimsChanged: false
  upstreamRevision: string
  receiptInputSha256: string
  receiptResultSha256: string
  summary: {
    caseCount: number
    featureCount: number
    dispositions: Readonly<Record<FidelityDisposition, number>>
  }
  features: readonly FidelityShadowFeature[]
}
