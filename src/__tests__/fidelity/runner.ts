import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  FIDELITY_ACCEPTED_DIVERGENCE_POLICIES,
  FIDELITY_DISPOSITIONS,
  FIDELITY_SURFACES,
  type ClassifiedFidelityObservations,
  type FidelityCaseDefinition,
  type FidelityCaseResult,
  type FidelityDisposition,
  type FidelityEvidence,
  type FidelityInputFile,
  type FidelityJson,
  type FidelityReceiptResult,
  type FidelityRevisionAcknowledgement,
  type FidelitySurface,
  type FidelitySurfaceEvidence,
  type FidelitySurfaceExpectation,
  type ObservedFidelitySurfaceEvidence,
  type RecordedFidelitySurfaceExpectation,
} from './contract.ts'
import { FIDELITY_REVISION_ACKNOWLEDGEMENTS } from './revision-compatibility.ts'
import { UPSTREAM_MERMAID_MANIFEST, type UpstreamMermaidManifest } from '../../upstream-mermaid-manifest.ts'
import { compareCodePointStrings } from '../../shared/deterministic-order.ts'

const REPO = resolve(import.meta.dir, '..', '..', '..')
const SHA_PATTERN = /^[0-9a-f]{40}$/
const CASE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const INFRASTRUCTURE_FILES = [
  resolve(import.meta.dir, 'contract.ts'),
  resolve(import.meta.dir, 'registry.ts'),
  resolve(import.meta.dir, 'revision-compatibility.ts'),
  resolve(import.meta.dir, 'runner.ts'),
  resolve(import.meta.dir, 'projector.ts'),
  resolve(REPO, 'src', 'fidelity-capability-contract.ts'),
  resolve(REPO, 'src', 'fidelity-capability-report.ts'),
  resolve(REPO, 'scripts', 'pr-assets', 'generate-fidelity-receipts.ts'),
]

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalFidelityJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('fidelity JSON numbers must be finite')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalFidelityJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('fidelity JSON objects must be plain records')
    }
    const undefinedKey = Object.keys(record).find(key => record[key] === undefined)
    if (undefinedKey !== undefined) throw new TypeError(`fidelity JSON property ${JSON.stringify(undefinedKey)} is undefined`)
    return `{${Object.keys(record)
      .sort(compareCodePointStrings)
      .map(key => `${JSON.stringify(key)}:${canonicalFidelityJson(record[key])}`)
      .join(',')}}`
  }
  throw new TypeError(`fidelity result contains non-JSON value: ${typeof value}`)
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePointStrings)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const unknown = Object.keys(record).filter(key => !allowed.includes(key)).sort(compareCodePointStrings)
  if (unknown.length > 0) throw new TypeError(`${context}: unknown fields ${unknown.join(', ')}`)
}

function normalizedDiagnosticCodes(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || value.some(code => typeof code !== 'string' || !code.trim())) {
    throw new TypeError(`${context}: diagnosticCodes must contain nonempty strings`)
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${context}: diagnosticCodes contains duplicates`)
  return sortedUnique(value as string[])
}

function isDisposition(value: unknown): value is FidelityDisposition {
  return typeof value === 'string' && FIDELITY_DISPOSITIONS.includes(value as FidelityDisposition)
}

function normalizeEvidence(value: unknown, context: string): FidelitySurfaceEvidence {
  if (!isRecord(value)) throw new TypeError(`${context}: observation must be an object`)
  if (value.status === 'observed') {
    hasOnlyKeys(value, ['status', 'diagnosticCodes', 'semantics'], context)
    return {
      status: 'observed',
      diagnosticCodes: normalizedDiagnosticCodes(value.diagnosticCodes, context),
      semantics: JSON.parse(canonicalFidelityJson(value.semantics)) as FidelityJson,
    }
  }
  if (value.status === 'blocked') {
    hasOnlyKeys(value, ['status', 'blockedBy', 'diagnosticCodes', 'semantics'], context)
    if (!FIDELITY_SURFACES.includes(value.blockedBy as FidelitySurface)) {
      throw new TypeError(`${context}: blockedBy is not a fidelity surface`)
    }
    return {
      status: 'blocked',
      blockedBy: value.blockedBy as FidelitySurface,
      diagnosticCodes: normalizedDiagnosticCodes(value.diagnosticCodes, context),
      semantics: JSON.parse(canonicalFidelityJson(value.semantics)) as FidelityJson,
    }
  }
  throw new TypeError(`${context}: status must be observed or blocked`)
}

function orderedEvidence(value: unknown): FidelityEvidence {
  if (!isRecord(value)) throw new TypeError('observer result must be an object')
  const unknownSurfaces = Object.keys(value).filter(key => !FIDELITY_SURFACES.includes(key as FidelitySurface))
  if (unknownSurfaces.length > 0) throw new TypeError(`observer result has unknown surfaces: ${unknownSurfaces.sort(compareCodePointStrings).join(', ')}`)
  const output: FidelityEvidence = {}
  for (const surface of FIDELITY_SURFACES) {
    if (value[surface] !== undefined) output[surface] = normalizeEvidence(value[surface], surface)
  }
  return output
}

function acknowledgementByArtifact(acknowledgements: readonly FidelityRevisionAcknowledgement[]): Map<string, FidelityRevisionAcknowledgement> {
  const output = new Map<string, FidelityRevisionAcknowledgement>()
  for (const acknowledgement of acknowledgements) {
    for (const artifactId of acknowledgement.artifactIds) {
      if (!output.has(artifactId)) output.set(artifactId, acknowledgement)
    }
  }
  return output
}

function validateRevisionAcknowledgements(manifest: UpstreamMermaidManifest, acknowledgements: readonly FidelityRevisionAcknowledgement[]): string[] {
  const issues: string[] = []
  const acknowledgementIds = new Set<string>()
  const coveredArtifacts = new Map<string, string>()
  const artifacts = new Map(manifest.semanticInventory.sourceArtifacts.map(artifact => [artifact.id, artifact]))

  for (const acknowledgement of acknowledgements) {
    if (acknowledgementIds.has(acknowledgement.id)) issues.push(`duplicate revision acknowledgement id ${acknowledgement.id}`)
    acknowledgementIds.add(acknowledgement.id)
    if (acknowledgement.manifestRevision !== manifest.provenance.commit) {
      issues.push(`${acknowledgement.id}: manifest revision does not match ${manifest.provenance.commit}`)
    }
    if (acknowledgement.artifactRevision !== 'unversioned' && !SHA_PATTERN.test(acknowledgement.artifactRevision)) {
      issues.push(`${acknowledgement.id}: artifact revision is neither a full Git SHA nor unversioned`)
    }
    if (acknowledgement.usage !== 'historical-only') issues.push(`${acknowledgement.id}: acknowledgement usage must be historical-only`)
    if (!acknowledgement.rationale.trim()) issues.push(`${acknowledgement.id}: rationale is empty`)
    if (acknowledgement.evidence.length === 0) issues.push(`${acknowledgement.id}: evidence is empty`)
    if (acknowledgement.artifactIds.length === 0) issues.push(`${acknowledgement.id}: artifactIds is empty`)

    for (const artifactId of acknowledgement.artifactIds) {
      const artifact = artifacts.get(artifactId)
      if (!artifact) {
        issues.push(`${acknowledgement.id}: unknown artifact ${artifactId}`)
        continue
      }
      if (coveredArtifacts.has(artifactId)) {
        issues.push(`${artifactId}: covered by both ${coveredArtifacts.get(artifactId)} and ${acknowledgement.id}`)
      }
      coveredArtifacts.set(artifactId, acknowledgement.id)
      if (artifact.upstreamRevision === manifest.provenance.commit) {
        issues.push(`${acknowledgement.id}: ${artifactId} no longer needs historical quarantine`)
      }
      if (artifact.upstreamRevision && artifact.upstreamRevision !== acknowledgement.artifactRevision) {
        issues.push(`${acknowledgement.id}: ${artifactId} revision does not match ${acknowledgement.artifactRevision}`)
      }
    }
  }

  for (const artifact of manifest.semanticInventory.sourceArtifacts) {
    if (artifact.upstreamRevision === manifest.provenance.commit) continue
    if (!coveredArtifacts.has(artifact.id)) {
      issues.push(
        artifact.upstreamRevision
          ? `${artifact.id}: unacknowledged revision split ${artifact.upstreamRevision} != ${manifest.provenance.commit}`
          : `${artifact.id}: missing upstream revision without historical-only acknowledgement`,
      )
    }
  }
  return issues
}

function validateExpectation(fidelityCase: FidelityCaseDefinition, surface: FidelitySurface, value: unknown): string[] {
  const prefix = `${fidelityCase.id}: ${surface}`
  if (!isRecord(value)) return [`${prefix}: expectation is missing or invalid`]
  if (value.applicability === 'not-applicable') {
    const issues: string[] = []
    const unknown = Object.keys(value).filter(key => !['applicability', 'rationale'].includes(key))
    if (unknown.length > 0) issues.push(`${prefix}: not-applicable expectation has unknown fields ${unknown.sort(compareCodePointStrings).join(', ')}`)
    if (typeof value.rationale !== 'string' || !value.rationale.trim()) issues.push(`${prefix}: not-applicable rationale is empty`)
    return issues
  }
  if (value.applicability !== 'applicable') return [`${prefix}: applicability must be applicable or not-applicable`]
  const issues: string[] = []
  const unknown = Object.keys(value).filter(key => !['applicability', 'disposition', 'diagnosticCodes', 'evaluate'].includes(key))
  if (unknown.length > 0) issues.push(`${prefix}: applicable expectation has unknown fields ${unknown.sort(compareCodePointStrings).join(', ')}`)
  if (!isDisposition(value.disposition)) issues.push(`${prefix}: invalid disposition ${String(value.disposition)}`)
  if (typeof value.evaluate !== 'function') issues.push(`${prefix}: executable semantic evaluator is required`)
  try {
    const diagnosticCodes = normalizedDiagnosticCodes(value.diagnosticCodes ?? [], prefix)
    if (value.disposition === 'diagnosed' && diagnosticCodes.length === 0) {
      issues.push(`${prefix}: diagnosed disposition requires at least one diagnostic code`)
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error))
  }
  return issues
}

function validateAcceptedDivergence(fidelityCase: FidelityCaseDefinition): string[] {
  const value = fidelityCase.acceptedDivergence
  if (value === undefined) return []
  const prefix = `${fidelityCase.id}: accepted divergence`
  if (!isRecord(value)) return [`${prefix} is invalid`]
  const issues: string[] = []
  const unknown = Object.keys(value).filter(key => !['policy', 'rationale', 'surfaces'].includes(key))
  if (unknown.length > 0) issues.push(`${prefix} has unknown fields ${unknown.sort(compareCodePointStrings).join(', ')}`)
  if (!FIDELITY_ACCEPTED_DIVERGENCE_POLICIES.includes(value.policy as never)) {
    issues.push(`${prefix} policy must be security or offline`)
  }
  if (typeof value.rationale !== 'string' || !value.rationale.trim()) issues.push(`${prefix} rationale is empty`)
  if (!Array.isArray(value.surfaces) || value.surfaces.length === 0) {
    issues.push(`${prefix} surfaces must be nonempty`)
    return issues
  }
  const surfaces = value.surfaces as unknown[]
  if (new Set(surfaces).size !== surfaces.length) issues.push(`${prefix} surfaces contain duplicates`)
  if (surfaces.some(surface => !FIDELITY_SURFACES.includes(surface as FidelitySurface))) {
    issues.push(`${prefix} contains an unknown surface`)
  }
  const ordered = FIDELITY_SURFACES.filter(surface => surfaces.includes(surface))
  if (JSON.stringify(surfaces) !== JSON.stringify(ordered)) issues.push(`${prefix} surfaces are out of order`)
  for (const surface of ordered) {
    const expectation = fidelityCase.expected[surface]
    if (expectation?.applicability !== 'applicable' || expectation.disposition !== 'diagnosed'
      || (expectation.diagnosticCodes?.length ?? 0) === 0) {
      issues.push(`${prefix} surface ${surface} must be an applicable diagnosed expectation with a named diagnostic`)
    }
  }
  return issues
}

export function validateFidelityRegistry(
  cases: readonly FidelityCaseDefinition[],
  manifest: UpstreamMermaidManifest = UPSTREAM_MERMAID_MANIFEST,
  acknowledgements: readonly FidelityRevisionAcknowledgement[] = FIDELITY_REVISION_ACKNOWLEDGEMENTS,
): string[] {
  const issues = validateRevisionAcknowledgements(manifest, acknowledgements)
  const caseIds = new Set<string>()
  const features = new Map(manifest.semanticInventory.syntaxFeatures.map(feature => [feature.id, feature]))
  const artifacts = new Map(manifest.semanticInventory.sourceArtifacts.map(artifact => [artifact.id, artifact]))
  const quarantinedArtifacts = acknowledgementByArtifact(acknowledgements)

  for (const fidelityCase of cases) {
    if (!CASE_ID_PATTERN.test(fidelityCase.id)) issues.push(`${fidelityCase.id}: invalid case id`)
    if (caseIds.has(fidelityCase.id)) issues.push(`${fidelityCase.id}: duplicate case id`)
    caseIds.add(fidelityCase.id)
    if (!fidelityCase.source.trim()) issues.push(`${fidelityCase.id}: source is empty`)
    if (!fidelityCase.upstreamReference.trim()) issues.push(`${fidelityCase.id}: upstream reference is empty`)
    if (!SHA_PATTERN.test(fidelityCase.upstreamRevision)) issues.push(`${fidelityCase.id}: upstream revision is not a full Git SHA`)

    const feature = features.get(fidelityCase.featureId)
    if (!feature) {
      issues.push(`${fidelityCase.id}: unknown feature id ${fidelityCase.featureId}`)
    } else {
      if (feature.families.length !== 1) {
        issues.push(`${fidelityCase.id}: multi-family feature ${fidelityCase.featureId} cannot back a receipt until per-family projection is representable`)
      }
      if (!feature.families.includes(fidelityCase.family)) {
        issues.push(`${fidelityCase.id}: feature ${fidelityCase.featureId} does not belong to family ${fidelityCase.family}`)
      }
      const artifact = artifacts.get(feature.artifact)
      const quarantine = quarantinedArtifacts.get(feature.artifact)
      if (quarantine) {
        issues.push(`${fidelityCase.id}: feature artifact ${feature.artifact} is ${quarantine.usage} and cannot back a current receipt`)
      } else if (!artifact?.upstreamRevision) {
        issues.push(`${fidelityCase.id}: feature artifact ${feature.artifact} has no immutable revision`)
      } else if (artifact.upstreamRevision !== fidelityCase.upstreamRevision) {
        issues.push(`${fidelityCase.id}: case revision ${fidelityCase.upstreamRevision} does not match ${feature.artifact}@${artifact.upstreamRevision}`)
      }
    }

    if (fidelityCase.upstreamRevision === manifest.provenance.commit) {
      if (fidelityCase.revisionCompatibility) issues.push(`${fidelityCase.id}: stale revision compatibility declaration`)
    } else {
      const compatibility = fidelityCase.revisionCompatibility
      if (!compatibility) {
        issues.push(`${fidelityCase.id}: unacknowledged case revision split ${fidelityCase.upstreamRevision} != ${manifest.provenance.commit}`)
      } else {
        if (compatibility.manifestRevision !== manifest.provenance.commit) {
          issues.push(`${fidelityCase.id}: compatibility manifest revision does not match ${manifest.provenance.commit}`)
        }
        if (!compatibility.rationale.trim()) issues.push(`${fidelityCase.id}: compatibility rationale is empty`)
        if (compatibility.evidence.length === 0) issues.push(`${fidelityCase.id}: compatibility evidence is empty`)
      }
    }

    if (!isRecord(fidelityCase.expected)) {
      issues.push(`${fidelityCase.id}: expected surface map is invalid`)
    } else {
      const unknownSurfaces = Object.keys(fidelityCase.expected).filter(key => !FIDELITY_SURFACES.includes(key as FidelitySurface))
      if (unknownSurfaces.length > 0) issues.push(`${fidelityCase.id}: expected map has unknown surfaces ${unknownSurfaces.sort(compareCodePointStrings).join(', ')}`)
      for (const surface of FIDELITY_SURFACES) issues.push(...validateExpectation(fidelityCase, surface, fidelityCase.expected[surface]))
    }
    issues.push(...validateAcceptedDivergence(fidelityCase))
  }
  return issues.sort(compareCodePointStrings)
}

function freshnessFiles(caseFiles: readonly string[], acknowledgements: readonly FidelityRevisionAcknowledgement[]): FidelityInputFile[] {
  const acknowledgementEvidence = acknowledgements.flatMap(acknowledgement => acknowledgement.evidence.map(path => resolve(REPO, path)))
  return sortedUnique([...INFRASTRUCTURE_FILES, ...caseFiles, ...acknowledgementEvidence]).map(path => ({
    path: relative(REPO, path),
    sha256: sha256(readFileSync(path)),
  }))
}

function recordedExpected(expected: Record<FidelitySurface, FidelitySurfaceExpectation>): Record<FidelitySurface, RecordedFidelitySurfaceExpectation> {
  return Object.fromEntries(
    FIDELITY_SURFACES.map(surface => {
      const expectation = expected[surface]
      return expectation.applicability === 'not-applicable'
        ? [surface, { applicability: 'not-applicable', rationale: expectation.rationale }]
        : [surface, { applicability: 'applicable', disposition: expectation.disposition, diagnosticCodes: sortedUnique(expectation.diagnosticCodes ?? []) }]
    }),
  ) as Record<FidelitySurface, RecordedFidelitySurfaceExpectation>
}

function observerFailure(fidelityCase: FidelityCaseDefinition, reason: string): FidelityEvidence {
  const evidence: FidelityEvidence = {}
  for (const surface of FIDELITY_SURFACES) {
    if (fidelityCase.expected[surface].applicability === 'not-applicable') continue
    evidence[surface] = {
      status: 'blocked',
      blockedBy: surface,
      diagnosticCodes: ['RECEIPT_OBSERVER_FAILED'],
      semantics: { reason },
    }
  }
  return evidence
}

async function runCase(fidelityCase: FidelityCaseDefinition): Promise<FidelityCaseResult> {
  const issues: string[] = []
  let evidence: FidelityEvidence
  try {
    evidence = orderedEvidence(await fidelityCase.observe())
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    evidence = observerFailure(fidelityCase, reason)
    issues.push(`observer failed: ${reason}`)
  }

  const observations: ClassifiedFidelityObservations = {}
  for (const surface of FIDELITY_SURFACES) {
    const expectation = fidelityCase.expected[surface]
    const observation = evidence[surface]
    if (expectation.applicability === 'not-applicable') {
      if (observation) issues.push(`${surface}: observation exists for a not-applicable surface`)
      continue
    }
    if (!observation) {
      issues.push(`${surface}: applicable surface was omitted instead of observed or blocked`)
      continue
    }
    if (observation.status === 'blocked') {
      observations[surface] = observation
      issues.push(`${surface}: blocked by ${observation.blockedBy}`)
      continue
    }

    let disposition: FidelityDisposition = 'absent'
    try {
      const evaluated = expectation.evaluate(observation, evidence)
      if (!isDisposition(evaluated)) throw new TypeError(`evaluator returned invalid disposition ${String(evaluated)}`)
      disposition = evaluated
    } catch (error) {
      issues.push(`${surface}: semantic evaluator failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    observations[surface] = { ...observation, disposition }
    if (disposition === 'diagnosed' && observation.diagnosticCodes.length === 0) {
      issues.push(`${surface}: diagnosed observation requires at least one diagnostic code`)
    }
    if (disposition !== expectation.disposition) {
      issues.push(`${surface}: expected ${expectation.disposition}, observed ${disposition}`)
    }
    const expectedCodes = sortedUnique(expectation.diagnosticCodes ?? [])
    if (JSON.stringify(observation.diagnosticCodes) !== JSON.stringify(expectedCodes)) {
      issues.push(`${surface}: expected diagnostics ${JSON.stringify(expectedCodes)}, observed ${JSON.stringify(observation.diagnosticCodes)}`)
    }
  }

  return {
    id: fidelityCase.id,
    family: fidelityCase.family,
    featureId: fidelityCase.featureId,
    sourceSha256: sha256(fidelityCase.source),
    upstreamReference: fidelityCase.upstreamReference,
    upstreamRevision: fidelityCase.upstreamRevision,
    ...(fidelityCase.acceptedDivergence
      ? {
          acceptedDivergence: {
            policy: fidelityCase.acceptedDivergence.policy,
            rationale: fidelityCase.acceptedDivergence.rationale,
            surfaces: FIDELITY_SURFACES.filter(surface => fidelityCase.acceptedDivergence!.surfaces.includes(surface)),
          },
        }
      : {}),
    expected: recordedExpected(fidelityCase.expected),
    observations,
    passed: issues.length === 0,
    issues,
  }
}

export async function runFidelityCases(
  cases: readonly FidelityCaseDefinition[],
  caseFiles: readonly string[],
  manifest: UpstreamMermaidManifest = UPSTREAM_MERMAID_MANIFEST,
  acknowledgements: readonly FidelityRevisionAcknowledgement[] = FIDELITY_REVISION_ACKNOWLEDGEMENTS,
): Promise<FidelityReceiptResult> {
  const validationIssues = validateFidelityRegistry(cases, manifest, acknowledgements)
  if (validationIssues.length > 0) {
    throw new Error(`Invalid fidelity registry:\n${validationIssues.map(issue => `- ${issue}`).join('\n')}`)
  }
  const files = freshnessFiles(caseFiles, acknowledgements)
  const results: FidelityCaseResult[] = []
  for (const fidelityCase of [...cases].sort((a, b) => compareCodePointStrings(a.id, b.id))) {
    results.push(await runCase(fidelityCase))
  }
  const observations = results.flatMap(result => Object.values(result.observations))
  return {
    schemaVersion: 2,
    upstream: {
      package: 'mermaid',
      version: manifest.provenance.version,
      manifestRevision: manifest.provenance.commit,
      inventorySha256: manifest.provenance.inventorySha256,
      revisionAcknowledgements: [...acknowledgements]
        .map(acknowledgement => ({
          ...acknowledgement,
          artifactIds: [...acknowledgement.artifactIds].sort(compareCodePointStrings),
          evidence: [...acknowledgement.evidence],
        }))
        .sort((a, b) => compareCodePointStrings(a.id, b.id)),
    },
    freshness: {
      inputSha256: sha256(
        canonicalFidelityJson({
          files,
          inventorySha256: manifest.provenance.inventorySha256,
          revisionAcknowledgements: acknowledgements,
        }),
      ),
      files,
    },
    cases: results,
    summary: {
      caseCount: results.length,
      passedCaseCount: results.filter(result => result.passed).length,
      failedCaseCount: results.filter(result => !result.passed).length,
      observedSurfaceCount: observations.filter(observation => observation?.status === 'observed').length,
      blockedSurfaceCount: observations.filter(observation => observation?.status === 'blocked').length,
      notApplicableSurfaceCount: results.flatMap(result => Object.values(result.expected)).filter(expectation => expectation.applicability === 'not-applicable').length,
    },
  }
}
