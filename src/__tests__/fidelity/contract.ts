// Construct-level fidelity receipt contract for issue #248.
//
// This remains test-only. Public capability reports consume only the compact
// generated shadow projection, never executable functions or raw observations.

export const FIDELITY_DISPOSITIONS = Object.freeze(['native', 'source-preserved', 'diagnosed', 'absent'] as const)

export type FidelityDisposition = (typeof FIDELITY_DISPOSITIONS)[number]

export const FIDELITY_SURFACES = Object.freeze(['agent', 'render', 'serialize', 'mutate'] as const)

export type FidelitySurface = (typeof FIDELITY_SURFACES)[number]

export type FidelityJson = null | boolean | number | string | readonly FidelityJson[] | { readonly [key: string]: FidelityJson }

export interface FidelityRevisionCompatibility {
  manifestRevision: string
  rationale: string
  evidence: readonly string[]
}

export interface ObservedFidelitySurfaceEvidence {
  status: 'observed'
  diagnosticCodes: readonly string[]
  semantics: FidelityJson
}

export interface BlockedFidelitySurface {
  status: 'blocked'
  blockedBy: FidelitySurface
  diagnosticCodes: readonly string[]
  semantics: FidelityJson
}

export type FidelitySurfaceEvidence = ObservedFidelitySurfaceEvidence | BlockedFidelitySurface

export type FidelityEvidence = Partial<Record<FidelitySurface, FidelitySurfaceEvidence>>

export interface ApplicableFidelitySurfaceExpectation {
  applicability: 'applicable'
  disposition: FidelityDisposition
  diagnosticCodes?: readonly string[]
  /** Derive the disposition from raw production evidence; throw if its semantic shape is invalid. */
  evaluate: (evidence: ObservedFidelitySurfaceEvidence, allEvidence: FidelityEvidence) => FidelityDisposition
}

export interface NotApplicableFidelitySurfaceExpectation {
  applicability: 'not-applicable'
  rationale: string
}

export type FidelitySurfaceExpectation = ApplicableFidelitySurfaceExpectation | NotApplicableFidelitySurfaceExpectation

export type FidelityExpectations = Record<FidelitySurface, FidelitySurfaceExpectation>

export interface FidelityCase {
  id: string
  family: string
  featureId: string
  source: string
  upstreamReference: string
  upstreamRevision: string
  revisionCompatibility?: FidelityRevisionCompatibility
  expected: FidelityExpectations
}

export interface FidelityCaseDefinition extends FidelityCase {
  observe: () => FidelityEvidence | Promise<FidelityEvidence>
}

export interface FidelityRevisionAcknowledgement {
  id: string
  manifestRevision: string
  artifactRevision: string | 'unversioned'
  artifactIds: readonly string[]
  usage: 'historical-only'
  rationale: string
  evidence: readonly string[]
}

export interface FidelityInputFile {
  path: string
  sha256: string
}

export interface ClassifiedObservedFidelitySurface extends ObservedFidelitySurfaceEvidence {
  disposition: FidelityDisposition
}

export type ClassifiedFidelitySurfaceObservation = ClassifiedObservedFidelitySurface | BlockedFidelitySurface

export type ClassifiedFidelityObservations = Partial<Record<FidelitySurface, ClassifiedFidelitySurfaceObservation>>

export type RecordedFidelitySurfaceExpectation =
  | {
      applicability: 'applicable'
      disposition: FidelityDisposition
      diagnosticCodes: readonly string[]
    }
  | NotApplicableFidelitySurfaceExpectation

export interface FidelityCaseResult {
  id: string
  family: string
  featureId: string
  sourceSha256: string
  upstreamReference: string
  upstreamRevision: string
  expected: Record<FidelitySurface, RecordedFidelitySurfaceExpectation>
  observations: ClassifiedFidelityObservations
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
    notApplicableSurfaceCount: number
  }
}

export type FidelityShadowSurface = FidelityDisposition | { notApplicable: readonly string[] }

export interface FidelityShadowFeature {
  featureId: string
  family: string
  disposition: FidelityDisposition
  caseIds: readonly string[]
  surfaces: Record<FidelitySurface, FidelityShadowSurface>
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
