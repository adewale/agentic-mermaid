import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  fidelityFeatureSatisfiesSyntaxParity,
  type FidelityCapabilityReport,
  type FidelityDisposition,
} from '../../fidelity-capability-contract.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../upstream-mermaid-manifest.ts'
import { observeJourneyExtensionReceipt } from '../journey-extension-receipt.ts'
import type { FidelityReceiptResult } from './contract.ts'
import { projectFidelityCapabilityReport } from './projector.ts'
import { discoverFidelityRegistry, type DiscoveredFidelityRegistry } from './registry.ts'
import { runFidelityCases } from './runner.ts'

// The raw execution result stays in memory. Only these compact projections are
// committed, and the fidelity unit test regenerates and compares them.

export const FIDELITY_ARTIFACT_ROOT = join(import.meta.dir, '..', '..', '..')
export const FIDELITY_CAPABILITY_REPORT_PATH = 'docs/project/fidelity-capability-report.json'
export const AGENTIC_EXTENSION_RECEIPTS_PATH = 'docs/project/agentic-extension-receipts.json'
export const FAMILY_CITIZENSHIP_MATRIX_PATH = 'docs/contributing/diagram-family-citizenship.matrix.json'

export interface FidelityRun {
  registry: DiscoveredFidelityRegistry
  receipt: FidelityReceiptResult
}

let fidelityRun: Promise<FidelityRun> | undefined

/** Discover and execute every checked-in case exactly once per process. */
export function runFidelityRegistryOnce(): Promise<FidelityRun> {
  fidelityRun ??= (async () => {
    const registry = await discoverFidelityRegistry()
    return { registry, receipt: await runFidelityCases(registry.cases) }
  })()
  return fidelityRun
}

export function failedFidelityCases(receipt: FidelityReceiptResult): string[] {
  return receipt.cases.filter(result => !result.passed).map(result => `${result.id}: ${result.issues.join('; ')}`)
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

interface CitizenshipCell {
  status: 'satisfied' | 'exception'
  evidence: string[]
  tracked?: string[]
  note?: string
}

interface CitizenshipMatrix {
  schemaVersion: number
  updated: string
  families: Record<string, { cells: Record<string, CitizenshipCell> }>
}

/** Project the syntax-parity cell from executable receipts. Every manifest
 * feature for a built-in family must have a native receipt or a narrowly
 * validated security/offline divergence before syntax parity is satisfied. */
export function projectFidelityCitizenship(
  source: string,
  report: FidelityCapabilityReport,
): string {
  const matrix = JSON.parse(source) as CitizenshipMatrix
  const receipts = new Map(report.features.map(feature => [feature.featureId, feature]))
  const manifestFeatures = UPSTREAM_MERMAID_MANIFEST.semanticInventory.syntaxFeatures
  matrix.schemaVersion = 3
  matrix.updated = '2026-09-24'
  for (const [familyId, family] of Object.entries(matrix.families)) {
    const features = manifestFeatures.filter(feature => feature.families.includes(familyId))
    const counts: Record<FidelityDisposition, number> = {
      native: 0,
      'source-preserved': 0,
      diagnosed: 0,
      absent: 0,
    }
    let receipted = 0
    let acceptedDivergence = 0
    let satisfiedFeatureCount = 0
    for (const feature of features) {
      const receipt = receipts.get(feature.id)
      if (!receipt || receipt.family !== familyId) {
        counts.absent++
        continue
      }
      receipted++
      counts[receipt.disposition]++
      if (fidelityFeatureSatisfiesSyntaxParity(receipt)) {
        satisfiedFeatureCount++
        if (receipt.disposition !== 'native') acceptedDivergence++
      }
    }
    const satisfied = features.length > 0 && satisfiedFeatureCount === features.length
    const cell: CitizenshipCell = {
      status: satisfied ? 'satisfied' : 'exception',
      evidence: [FIDELITY_CAPABILITY_REPORT_PATH],
      note: `Receipt-derived Mermaid 11.16 coverage: ${receipted}/${features.length} features receipted; parity-satisfying=${satisfiedFeatureCount} (native=${counts.native}, accepted-security/offline-divergence=${acceptedDivergence}), source-preserved=${counts['source-preserved']}, diagnosed=${counts.diagnosed}, absent-or-unreceipted=${counts.absent}.`,
      ...(satisfied ? {} : { tracked: ['#248'] }),
    }
    family.cells.mermaidSyntaxParity = cell
  }
  return json(matrix)
}

export interface GeneratedFidelityArtifact {
  /** Repository-relative path of the committed artifact. */
  path: string
  content: string
}

/** The committed projections of a passing in-memory run. */
export function generatedFidelityArtifacts(receipt: FidelityReceiptResult): readonly GeneratedFidelityArtifact[] {
  const failures = failedFidelityCases(receipt)
  if (failures.length > 0) throw new Error(`Fidelity cases failed:\n${failures.join('\n')}`)
  const capability = projectFidelityCapabilityReport(receipt)
  return [
    { path: FIDELITY_CAPABILITY_REPORT_PATH, content: json(capability) },
    { path: AGENTIC_EXTENSION_RECEIPTS_PATH, content: json({ schemaVersion: 1, extensions: [observeJourneyExtensionReceipt()] }) },
    {
      path: FAMILY_CITIZENSHIP_MATRIX_PATH,
      content: projectFidelityCitizenship(readFileSync(join(FIDELITY_ARTIFACT_ROOT, FAMILY_CITIZENSHIP_MATRIX_PATH), 'utf8'), capability),
    },
  ]
}
