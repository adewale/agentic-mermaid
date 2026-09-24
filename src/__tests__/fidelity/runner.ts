import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  FIDELITY_DISPOSITIONS,
  FIDELITY_SURFACES,
  type FidelityCaseDefinition,
  type FidelityCaseResult,
  type FidelityDiagnosticExpectation,
  type FidelityInputFile,
  type FidelityJson,
  type FidelityObservations,
  type FidelityReceiptResult,
  type FidelityRevisionAcknowledgement,
  type FidelitySurface,
  type FidelitySurfaceObservation,
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
    return `{${Object.keys(record)
      .sort()
      .filter(key => record[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalFidelityJson(record[key])}`)
      .join(',')}}`
  }
  throw new TypeError(`fidelity result contains non-JSON value: ${typeof value}`)
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function orderedExpected(expected: FidelityCaseDefinition['expected']): Partial<Record<FidelitySurface, (typeof FIDELITY_DISPOSITIONS)[number]>> {
  const output: Partial<Record<FidelitySurface, (typeof FIDELITY_DISPOSITIONS)[number]>> = {}
  for (const surface of FIDELITY_SURFACES) {
    const disposition = expected[surface]
    if (disposition) output[surface] = disposition
  }
  return output
}

function sortedDiagnostics(diagnostics: readonly FidelityDiagnosticExpectation[] = []): FidelityDiagnosticExpectation[] {
  const surfaceOrder = new Map(FIDELITY_SURFACES.map((surface, index) => [surface, index]))
  return [...diagnostics].sort((a, b) => surfaceOrder.get(a.surface)! - surfaceOrder.get(b.surface)! || compareCodePointStrings(a.code, b.code))
}

function normalizeObservation(observation: FidelitySurfaceObservation): FidelitySurfaceObservation {
  return {
    ...observation,
    diagnosticCodes: sortedUnique(observation.diagnosticCodes),
    semantics: JSON.parse(canonicalFidelityJson(observation.semantics)) as FidelityJson,
  }
}

function orderedObservations(observations: FidelityObservations): FidelityObservations {
  const output: FidelityObservations = {}
  for (const surface of FIDELITY_SURFACES) {
    const observation = observations[surface]
    if (observation) output[surface] = normalizeObservation(observation)
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
    if (!SHA_PATTERN.test(acknowledgement.artifactRevision)) {
      issues.push(`${acknowledgement.id}: artifact revision is not a full Git SHA`)
    }
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
        issues.push(`${acknowledgement.id}: ${artifactId} no longer has a revision split`)
      }
      if (artifact.upstreamRevision !== acknowledgement.artifactRevision) {
        issues.push(`${acknowledgement.id}: ${artifactId} revision does not match ${acknowledgement.artifactRevision}`)
      }
    }
  }

  for (const artifact of manifest.semanticInventory.sourceArtifacts) {
    if (!artifact.upstreamRevision || artifact.upstreamRevision === manifest.provenance.commit) continue
    if (!coveredArtifacts.has(artifact.id)) {
      issues.push(`${artifact.id}: unacknowledged revision split ${artifact.upstreamRevision} != ${manifest.provenance.commit}`)
    }
  }
  return issues
}

export function validateFidelityRegistry(cases: readonly FidelityCaseDefinition[], manifest: UpstreamMermaidManifest = UPSTREAM_MERMAID_MANIFEST, acknowledgements: readonly FidelityRevisionAcknowledgement[] = FIDELITY_REVISION_ACKNOWLEDGEMENTS): string[] {
  const issues = validateRevisionAcknowledgements(manifest, acknowledgements)
  const caseIds = new Set<string>()
  const features = new Map(manifest.semanticInventory.syntaxFeatures.map(feature => [feature.id, feature]))
  const artifacts = new Map(manifest.semanticInventory.sourceArtifacts.map(artifact => [artifact.id, artifact]))

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
      if (!feature.families.includes(fidelityCase.family)) {
        issues.push(`${fidelityCase.id}: feature ${fidelityCase.featureId} does not belong to family ${fidelityCase.family}`)
      }
      const artifactRevision = artifacts.get(feature.artifact)?.upstreamRevision
      if (artifactRevision && artifactRevision !== fidelityCase.upstreamRevision) {
        issues.push(`${fidelityCase.id}: case revision ${fidelityCase.upstreamRevision} does not match ${feature.artifact}@${artifactRevision}`)
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

    const expectedSurfaces = FIDELITY_SURFACES.filter(surface => fidelityCase.expected[surface] !== undefined)
    if (expectedSurfaces.length === 0) issues.push(`${fidelityCase.id}: no applicable surfaces`)
    for (const diagnostic of fidelityCase.expectedDiagnostics ?? []) {
      if (!fidelityCase.expected[diagnostic.surface]) {
        issues.push(`${fidelityCase.id}: diagnostic ${diagnostic.code} targets omitted surface ${diagnostic.surface}`)
      }
      if (!diagnostic.code.trim()) issues.push(`${fidelityCase.id}: empty diagnostic code`)
    }
  }
  return issues.sort()
}

function freshnessFiles(caseFiles: readonly string[]): FidelityInputFile[] {
  return sortedUnique([...INFRASTRUCTURE_FILES, ...caseFiles]).map(path => ({
    path: relative(REPO, path),
    sha256: sha256(readFileSync(path)),
  }))
}

function expectedDiagnosticCodes(fidelityCase: FidelityCaseDefinition, surface: FidelitySurface): string[] {
  return sortedUnique((fidelityCase.expectedDiagnostics ?? []).filter(diagnostic => diagnostic.surface === surface).map(diagnostic => diagnostic.code))
}

function observerFailure(fidelityCase: FidelityCaseDefinition, reason: string): FidelityObservations {
  const expectedSurfaces = FIDELITY_SURFACES.filter(surface => fidelityCase.expected[surface] !== undefined)
  const blockedBy = expectedSurfaces[0] ?? 'agent'
  const observations: FidelityObservations = {}
  for (const surface of expectedSurfaces) {
    observations[surface] = {
      status: 'blocked',
      blockedBy,
      diagnosticCodes: ['RECEIPT_OBSERVER_FAILED'],
      semantics: { reason },
    }
  }
  return observations
}

async function runCase(fidelityCase: FidelityCaseDefinition): Promise<FidelityCaseResult> {
  const issues: string[] = []
  let observations: FidelityObservations
  try {
    observations = orderedObservations(await fidelityCase.observe())
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    observations = observerFailure(fidelityCase, reason)
    issues.push(`observer failed: ${reason}`)
  }

  for (const surface of FIDELITY_SURFACES) {
    const expected = fidelityCase.expected[surface]
    const observation = observations[surface]
    if (!expected) {
      if (observation) issues.push(`${surface}: observation exists for an omitted surface`)
      continue
    }
    if (!observation) {
      issues.push(`${surface}: applicable surface was omitted instead of observed or blocked`)
      continue
    }
    if (observation.status === 'blocked') {
      issues.push(`${surface}: blocked by ${observation.blockedBy}`)
      continue
    }
    if (observation.disposition !== expected) {
      issues.push(`${surface}: expected ${expected}, observed ${observation.disposition}`)
    }
    const expectedCodes = expectedDiagnosticCodes(fidelityCase, surface)
    const actualCodes = sortedUnique(observation.diagnosticCodes)
    if (JSON.stringify(actualCodes) !== JSON.stringify(expectedCodes)) {
      issues.push(`${surface}: expected diagnostics ${JSON.stringify(expectedCodes)}, observed ${JSON.stringify(actualCodes)}`)
    }
  }

  if (fidelityCase.assertSemantics) {
    try {
      fidelityCase.assertSemantics(observations)
    } catch (error) {
      issues.push(`semantic assertion failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    id: fidelityCase.id,
    family: fidelityCase.family,
    featureId: fidelityCase.featureId,
    sourceSha256: sha256(fidelityCase.source),
    upstreamReference: fidelityCase.upstreamReference,
    upstreamRevision: fidelityCase.upstreamRevision,
    expected: orderedExpected(fidelityCase.expected),
    expectedDiagnostics: sortedDiagnostics(fidelityCase.expectedDiagnostics),
    observations,
    passed: issues.length === 0,
    issues,
  }
}

export async function runFidelityCases(cases: readonly FidelityCaseDefinition[], caseFiles: readonly string[], manifest: UpstreamMermaidManifest = UPSTREAM_MERMAID_MANIFEST, acknowledgements: readonly FidelityRevisionAcknowledgement[] = FIDELITY_REVISION_ACKNOWLEDGEMENTS): Promise<FidelityReceiptResult> {
  const validationIssues = validateFidelityRegistry(cases, manifest, acknowledgements)
  if (validationIssues.length > 0) {
    throw new Error(`Invalid fidelity registry:\n${validationIssues.map(issue => `- ${issue}`).join('\n')}`)
  }
  const files = freshnessFiles(caseFiles)
  const results: FidelityCaseResult[] = []
  for (const fidelityCase of [...cases].sort((a, b) => compareCodePointStrings(a.id, b.id))) {
    results.push(await runCase(fidelityCase))
  }
  const observations = results.flatMap(result => Object.values(result.observations))
  return {
    schemaVersion: 1,
    upstream: {
      package: 'mermaid',
      version: manifest.provenance.version,
      manifestRevision: manifest.provenance.commit,
      inventorySha256: manifest.provenance.inventorySha256,
      revisionAcknowledgements: [...acknowledgements]
        .map(acknowledgement => ({
          ...acknowledgement,
          artifactIds: [...acknowledgement.artifactIds].sort(),
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
    },
  }
}
