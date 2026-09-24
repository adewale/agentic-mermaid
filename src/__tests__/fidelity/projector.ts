import { createHash } from 'node:crypto'
import {
  FIDELITY_DISPOSITIONS,
  FIDELITY_SURFACES,
  type FidelityAcceptedDivergence,
  type FidelityCapabilityFeature,
  type FidelityCapabilityReport,
  type FidelityCapabilitySurface,
  type FidelityCapabilityCaseEvidence,
  type FidelityDisposition,
  type FidelityReceiptResult,
  type FidelitySurface,
} from './contract.ts'
import { FIDELITY_CAPABILITY_REPORT_SCHEMA_VERSION } from '../../fidelity-capability-contract.ts'
import { canonicalFidelityJson } from './runner.ts'
import { compareCodePointStrings } from '../../shared/deterministic-order.ts'

const DISPOSITION_RANK: Readonly<Record<FidelityDisposition, number>> = Object.freeze({
  native: 0,
  'source-preserved': 1,
  diagnosed: 2,
  absent: 3,
})

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isDisposition(value: unknown): value is FidelityDisposition {
  return typeof value === 'string' && FIDELITY_DISPOSITIONS.includes(value as FidelityDisposition)
}

function leastCapable(a: FidelityDisposition | undefined, b: FidelityDisposition): FidelityDisposition {
  if (!isDisposition(b)) throw new TypeError(`Unknown fidelity disposition ${String(b)}`)
  if (!a) return b
  if (!isDisposition(a)) throw new TypeError(`Unknown fidelity disposition ${String(a)}`)
  return DISPOSITION_RANK[b] > DISPOSITION_RANK[a] ? b : a
}

interface FeatureAccumulator {
  featureId: string
  family: string
  caseIds: string[]
  dispositions: Partial<Record<FidelitySurface, FidelityDisposition>>
  diagnostics: Partial<Record<FidelitySurface, string[]>>
  notApplicable: Partial<Record<FidelitySurface, string[]>>
  caseEvidence: FidelityCapabilityCaseEvidence[]
  acceptedDivergences: FidelityAcceptedDivergence[]
}

function validateSurfaceKeys(value: object, context: string): void {
  const unknown = Object.keys(value).filter(key => !FIDELITY_SURFACES.includes(key as FidelitySurface))
  if (unknown.length > 0) throw new TypeError(`${context} has unknown surfaces ${unknown.sort(compareCodePointStrings).join(', ')}`)
}

/** Compact public projection. Raw observations and executable evaluators stay test-only. */
export function projectFidelityCapabilityReport(receipt: FidelityReceiptResult): FidelityCapabilityReport {
  if (receipt.summary.failedCaseCount > 0 || receipt.cases.some(result => !result.passed)) {
    throw new Error('Cannot project capability report from failing fidelity receipts')
  }

  const features = new Map<string, FeatureAccumulator>()
  for (const result of receipt.cases) {
    validateSurfaceKeys(result.expected, `${result.id}: expected`)
    validateSurfaceKeys(result.observations, `${result.id}: observations`)
    const existing = features.get(result.featureId)
    if (existing && existing.family !== result.family) {
      throw new Error(`${result.featureId}: receipt cases disagree on family`)
    }
    const feature: FeatureAccumulator = existing ?? {
      featureId: result.featureId,
      family: result.family,
      caseIds: [],
      dispositions: {},
      diagnostics: {},
      notApplicable: {},
      caseEvidence: [],
      acceptedDivergences: [],
    }
    feature.caseIds.push(result.id)

    const caseSurfaces: Partial<Record<FidelitySurface, FidelityCapabilitySurface>> = {}
    const caseDiagnostics: Partial<Record<FidelitySurface, readonly string[]>> = {}
    for (const surface of FIDELITY_SURFACES) {
      const expectation = result.expected[surface]
      if (!expectation) throw new TypeError(`${result.id}: ${surface} expectation is undeclared`)
      const observation = result.observations[surface]
      if (expectation.applicability === 'not-applicable') {
        if (!expectation.rationale.trim()) throw new TypeError(`${result.id}: ${surface} not-applicable rationale is empty`)
        if (observation) throw new TypeError(`${result.id}: ${surface} has evidence despite being not-applicable`)
        const rationales = feature.notApplicable[surface] ?? []
        rationales.push(expectation.rationale)
        feature.notApplicable[surface] = rationales
        caseSurfaces[surface] = { notApplicable: [expectation.rationale] }
        continue
      }
      if (expectation.applicability !== 'applicable' || !isDisposition(expectation.disposition)) {
        throw new TypeError(`${result.id}: ${surface} has invalid expected disposition`)
      }
      if (!Array.isArray(expectation.diagnosticCodes) || expectation.diagnosticCodes.some(code => typeof code !== 'string' || !code.trim())) {
        throw new TypeError(`${result.id}: ${surface} has invalid expected diagnostics`)
      }
      if (expectation.disposition === 'diagnosed' && expectation.diagnosticCodes.length === 0) {
        throw new TypeError(`${result.id}: ${surface} diagnosed expectation has no diagnostic code`)
      }
      if (!observation || observation.status !== 'observed') {
        throw new TypeError(`${result.id}: ${surface} lacks classified observed evidence`)
      }
      if (!isDisposition(observation.disposition)) {
        throw new TypeError(`${result.id}: ${surface} has invalid observed disposition`)
      }
      if (!Array.isArray(observation.diagnosticCodes) || observation.diagnosticCodes.some(code => typeof code !== 'string' || !code.trim())) {
        throw new TypeError(`${result.id}: ${surface} has invalid observed diagnostics`)
      }
      if (observation.disposition === 'diagnosed' && observation.diagnosticCodes.length === 0) {
        throw new TypeError(`${result.id}: ${surface} diagnosed observation has no diagnostic code`)
      }
      caseSurfaces[surface] = observation.disposition
      if (observation.diagnosticCodes.length > 0) caseDiagnostics[surface] = [...observation.diagnosticCodes]
      feature.dispositions[surface] = leastCapable(feature.dispositions[surface], observation.disposition)
      const diagnosticCodes = feature.diagnostics[surface] ?? []
      diagnosticCodes.push(...observation.diagnosticCodes)
      feature.diagnostics[surface] = diagnosticCodes
    }
    if (Object.keys(caseSurfaces).length !== FIDELITY_SURFACES.length) {
      throw new TypeError(`${result.id}: case evidence does not cover every fidelity surface`)
    }
    feature.caseEvidence.push({
      caseId: result.id,
      surfaces: caseSurfaces as Record<FidelitySurface, FidelityCapabilitySurface>,
      diagnostics: caseDiagnostics,
    })
    if (result.acceptedDivergence) {
      const diagnosticCodes = Object.fromEntries(result.acceptedDivergence.surfaces.map(surface => {
        const observation = result.observations[surface]
        if (!observation || observation.status !== 'observed' || observation.disposition !== 'diagnosed'
          || observation.diagnosticCodes.length === 0) {
          throw new TypeError(`${result.id}: accepted divergence ${surface} lacks diagnosed observed evidence`)
        }
        return [surface, [...observation.diagnosticCodes]]
      })) as Partial<Record<FidelitySurface, readonly string[]>>
      feature.acceptedDivergences.push({
        caseId: result.id,
        policy: result.acceptedDivergence.policy,
        rationale: result.acceptedDivergence.rationale,
        surfaces: [...result.acceptedDivergence.surfaces],
        diagnosticCodes,
      })
    }
    features.set(result.featureId, feature)
  }

  const projected: FidelityCapabilityFeature[] = [...features.values()]
    .sort((a, b) => compareCodePointStrings(a.featureId, b.featureId))
    .map(feature => {
      const surfaces = Object.fromEntries(
        FIDELITY_SURFACES.map(surface => {
          const disposition = feature.dispositions[surface]
          if (disposition) return [surface, disposition]
          const rationales = [...new Set(feature.notApplicable[surface] ?? [])].sort(compareCodePointStrings)
          if (rationales.length === 0) throw new TypeError(`${feature.featureId}: ${surface} has no applicability decision`)
          return [surface, { notApplicable: rationales } satisfies FidelityCapabilitySurface]
        }),
      ) as Record<FidelitySurface, FidelityCapabilitySurface>
      const applicable = Object.values(feature.dispositions)
      if (applicable.length === 0) throw new Error(`${feature.featureId}: no applicable surfaces`)
      const disposition = applicable.reduce<FidelityDisposition>((current, value) => leastCapable(current, value), 'native')
      const diagnostics = Object.fromEntries(
        FIDELITY_SURFACES.flatMap(surface => {
          const codes = [...new Set(feature.diagnostics[surface] ?? [])].sort(compareCodePointStrings)
          return codes.length > 0 ? [[surface, codes] as const] : []
        }),
      ) as Partial<Record<FidelitySurface, readonly string[]>>
      return {
        featureId: feature.featureId,
        family: feature.family,
        disposition,
        caseIds: feature.caseIds.sort(compareCodePointStrings),
        surfaces,
        diagnostics,
        caseEvidence: feature.caseEvidence.sort((a, b) => compareCodePointStrings(a.caseId, b.caseId)),
        acceptedDivergences: feature.acceptedDivergences.sort((a, b) => compareCodePointStrings(a.caseId, b.caseId)),
      }
    })
  const dispositions = Object.fromEntries(FIDELITY_DISPOSITIONS.map(disposition => [disposition, 0])) as Record<FidelityDisposition, number>
  for (const feature of projected) dispositions[feature.disposition]++

  return {
    schemaVersion: FIDELITY_CAPABILITY_REPORT_SCHEMA_VERSION,
    mode: 'public',
    publicClaimsChanged: true,
    upstreamRevision: receipt.upstream.manifestRevision,
    receiptInputSha256: receipt.freshness.inputSha256,
    receiptResultSha256: sha256(canonicalFidelityJson(receipt)),
    summary: {
      caseCount: receipt.summary.caseCount,
      featureCount: projected.length,
      dispositions,
    },
    features: projected,
  }
}
