import { createHash } from 'node:crypto'
import { FIDELITY_DISPOSITIONS, FIDELITY_SURFACES, type FidelityCapabilityShadow, type FidelityDisposition, type FidelityReceiptResult, type FidelityShadowFeature, type FidelitySurface } from './contract.ts'
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

function leastCapable(a: FidelityDisposition | undefined, b: FidelityDisposition): FidelityDisposition {
  if (!a) return b
  return DISPOSITION_RANK[b] > DISPOSITION_RANK[a] ? b : a
}

/** Compact, shadow-only projection. Existing public reports do not consume it. */
export function projectFidelityCapabilityShadow(receipt: FidelityReceiptResult): FidelityCapabilityShadow {
  if (receipt.summary.failedCaseCount > 0 || receipt.cases.some(result => !result.passed)) {
    throw new Error('Cannot project capability shadow from failing fidelity receipts')
  }

  const features = new Map<string, FidelityShadowFeature>()
  for (const result of receipt.cases) {
    const existing = features.get(result.featureId)
    if (existing && existing.family !== result.family) {
      throw new Error(`${result.featureId}: receipt cases disagree on family`)
    }
    const surfaces: Partial<Record<FidelitySurface, FidelityDisposition>> = existing ? { ...existing.surfaces } : {}
    for (const surface of FIDELITY_SURFACES) {
      const observation = result.observations[surface]
      if (!observation || observation.status !== 'observed') continue
      surfaces[surface] = leastCapable(surfaces[surface], observation.disposition)
    }
    const dispositions = Object.values(surfaces)
    if (dispositions.length === 0) throw new Error(`${result.featureId}: no observed surfaces`)
    const disposition = dispositions.reduce<FidelityDisposition>((current, value) => leastCapable(current, value), 'native')
    features.set(result.featureId, {
      featureId: result.featureId,
      family: result.family,
      disposition,
      caseIds: [...(existing?.caseIds ?? []), result.id].sort(),
      surfaces,
    })
  }

  const projected = [...features.values()]
    .sort((a, b) => compareCodePointStrings(a.featureId, b.featureId))
    .map(feature => ({
      ...feature,
      surfaces: Object.fromEntries(FIDELITY_SURFACES.filter(surface => feature.surfaces[surface] !== undefined).map(surface => [surface, feature.surfaces[surface]!])) as Partial<Record<FidelitySurface, FidelityDisposition>>,
    }))
  const dispositions = Object.fromEntries(FIDELITY_DISPOSITIONS.map(disposition => [disposition, 0])) as Record<FidelityDisposition, number>
  for (const feature of projected) dispositions[feature.disposition]++

  return {
    schemaVersion: 1,
    mode: 'shadow',
    publicClaimsChanged: false,
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
