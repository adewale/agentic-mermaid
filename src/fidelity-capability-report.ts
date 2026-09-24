import rawReport from '../docs/project/fidelity-capability-report.json'
import {
  FIDELITY_CAPABILITY_REPORT_SCHEMA_VERSION,
  FIDELITY_DISPOSITIONS,
  FIDELITY_SURFACES,
  type FidelityCapabilityFeature,
  type FidelityCapabilityReport,
  type FidelityCapabilitySurface,
  type FidelityDisposition,
  type FidelitySurface,
} from './fidelity-capability-contract.ts'
import { compareCodePointStrings } from './shared/deterministic-order.ts'
import {
  UPSTREAM_MERMAID_MANIFEST,
  type UpstreamMermaidManifest,
} from './upstream-mermaid-manifest.ts'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isDisposition(value: unknown): value is FidelityDisposition {
  return typeof value === 'string' && FIDELITY_DISPOSITIONS.includes(value as FidelityDisposition)
}

function validateSurface(value: unknown, context: string): string[] {
  if (isDisposition(value)) return []
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'notApplicable')) {
    return [`${context}: invalid capability surface`]
  }
  const rationales = value.notApplicable
  if (!Array.isArray(rationales) || rationales.length === 0
    || rationales.some(rationale => typeof rationale !== 'string' || !rationale.trim())) {
    return [`${context}: not-applicable surface lacks a rationale`]
  }
  if (new Set(rationales).size !== rationales.length) {
    return [`${context}: not-applicable rationales are duplicated`]
  }
  return []
}

/** Validate the generated compact projection before any public report uses it. */
export function validateFidelityCapabilityReport(
  value: unknown,
  manifest: UpstreamMermaidManifest = UPSTREAM_MERMAID_MANIFEST,
): string[] {
  if (!isRecord(value)) return ['fidelity capability report is not an object']
  const issues: string[] = []
  if (value.schemaVersion !== FIDELITY_CAPABILITY_REPORT_SCHEMA_VERSION) issues.push('fidelity capability report schema is stale')
  if (value.mode !== 'public' || value.publicClaimsChanged !== true) issues.push('fidelity capability report is not the public claim authority')
  if (value.upstreamRevision !== manifest.provenance.commit) issues.push('fidelity capability report upstream revision is stale')
  if (typeof value.receiptInputSha256 !== 'string' || !SHA256_PATTERN.test(value.receiptInputSha256)) issues.push('fidelity capability report input digest is invalid')
  if (typeof value.receiptResultSha256 !== 'string' || !SHA256_PATTERN.test(value.receiptResultSha256)) issues.push('fidelity capability report result digest is invalid')
  if (!isRecord(value.summary)) issues.push('fidelity capability report summary is invalid')
  if (!Array.isArray(value.features)) return [...issues, 'fidelity capability report features are invalid'].sort(compareCodePointStrings)

  const manifestFeatures = new Map(manifest.semanticInventory.syntaxFeatures.map(feature => [feature.id, feature]))
  const ids = new Set<string>()
  const dispositionCounts = Object.fromEntries(FIDELITY_DISPOSITIONS.map(disposition => [disposition, 0])) as Record<FidelityDisposition, number>
  let caseCount = 0
  for (const rawFeature of value.features) {
    if (!isRecord(rawFeature) || typeof rawFeature.featureId !== 'string') {
      issues.push('fidelity capability report contains an invalid feature row')
      continue
    }
    const context = rawFeature.featureId
    if (ids.has(context)) issues.push(`${context}: duplicate fidelity capability feature`)
    ids.add(context)
    const manifestFeature = manifestFeatures.get(context)
    if (!manifestFeature) issues.push(`${context}: fidelity capability feature is absent from the pinned manifest`)
    if (typeof rawFeature.family !== 'string' || !manifestFeature?.families.includes(rawFeature.family)) {
      issues.push(`${context}: fidelity capability family does not match the pinned manifest`)
    }
    if (!isDisposition(rawFeature.disposition)) {
      issues.push(`${context}: invalid fidelity capability disposition`)
    } else {
      dispositionCounts[rawFeature.disposition]++
    }
    if (!Array.isArray(rawFeature.caseIds) || rawFeature.caseIds.length === 0
      || rawFeature.caseIds.some(caseId => typeof caseId !== 'string' || !caseId.trim())) {
      issues.push(`${context}: fidelity capability feature lacks case ids`)
    } else {
      caseCount += rawFeature.caseIds.length
      if (new Set(rawFeature.caseIds).size !== rawFeature.caseIds.length) issues.push(`${context}: fidelity case ids are duplicated`)
      if (JSON.stringify(rawFeature.caseIds) !== JSON.stringify([...rawFeature.caseIds].sort(compareCodePointStrings))) {
        issues.push(`${context}: fidelity case ids are out of order`)
      }
    }
    if (!isRecord(rawFeature.surfaces)) {
      issues.push(`${context}: fidelity capability surfaces are invalid`)
      continue
    }
    const surfaces = rawFeature.surfaces
    const surfaceKeys = Object.keys(surfaces)
    if (JSON.stringify(surfaceKeys) !== JSON.stringify(FIDELITY_SURFACES)) issues.push(`${context}: fidelity capability surfaces are incomplete or out of order`)
    for (const surface of FIDELITY_SURFACES) {
      issues.push(...validateSurface(surfaces[surface], `${context}/${surface}`))
    }
    if (!isRecord(rawFeature.diagnostics)) {
      issues.push(`${context}: fidelity capability diagnostics are invalid`)
    } else {
      const diagnosticKeys = Object.keys(rawFeature.diagnostics)
      if (diagnosticKeys.some(key => !FIDELITY_SURFACES.includes(key as FidelitySurface))) {
        issues.push(`${context}: fidelity capability diagnostics contain an unknown surface`)
      }
      for (const surface of FIDELITY_SURFACES) {
        const codes = rawFeature.diagnostics[surface]
        if (codes !== undefined && (!Array.isArray(codes) || codes.length === 0
          || codes.some(code => typeof code !== 'string' || !code.trim())
          || new Set(codes).size !== codes.length
          || JSON.stringify(codes) !== JSON.stringify([...codes].sort(compareCodePointStrings)))) {
          issues.push(`${context}/${surface}: fidelity capability diagnostic codes are invalid`)
        }
        if (surfaces[surface] === 'diagnosed' && !Array.isArray(codes)) {
          issues.push(`${context}/${surface}: diagnosed capability lacks a diagnostic code`)
        }
      }
    }
    const applicable = FIDELITY_SURFACES.flatMap(surface => {
      const cell = surfaces[surface]
      return isDisposition(cell) ? [cell] : []
    })
    const rank: Record<FidelityDisposition, number> = { native: 0, 'source-preserved': 1, diagnosed: 2, absent: 3 }
    const aggregate = applicable.reduce<FidelityDisposition>(
      (current, disposition) => rank[disposition] > rank[current] ? disposition : current,
      'native',
    )
    if (applicable.length === 0 || rawFeature.disposition !== aggregate) issues.push(`${context}: aggregate fidelity disposition is stale`)
  }

  if (JSON.stringify(value.features.map(feature => isRecord(feature) ? feature.featureId : ''))
    !== JSON.stringify([...ids].sort(compareCodePointStrings))) {
    issues.push('fidelity capability features are out of order')
  }
  if (isRecord(value.summary)) {
    if (value.summary.featureCount !== value.features.length) issues.push('fidelity capability feature count is stale')
    if (value.summary.caseCount !== caseCount) issues.push('fidelity capability case count is stale')
    if (!isRecord(value.summary.dispositions)
      || JSON.stringify(value.summary.dispositions) !== JSON.stringify(dispositionCounts)) {
      issues.push('fidelity capability disposition counts are stale')
    }
  }
  return issues.sort(compareCodePointStrings)
}

const validationIssues = validateFidelityCapabilityReport(rawReport)
if (validationIssues.length > 0) {
  throw new Error(`Invalid generated fidelity capability report:\n${validationIssues.join('\n')}`)
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export const FIDELITY_CAPABILITY_REPORT = deepFreeze(rawReport) as Readonly<FidelityCapabilityReport>

const FEATURE_BY_ID = new Map(FIDELITY_CAPABILITY_REPORT.features.map(feature => [feature.featureId, feature]))

export function fidelityCapabilityFeature(featureId: string): Readonly<FidelityCapabilityFeature> | undefined {
  return FEATURE_BY_ID.get(featureId)
}

export type {
  FidelityCapabilityFeature,
  FidelityCapabilityReport,
  FidelityCapabilitySurface,
  FidelityDisposition,
  FidelitySurface,
}
