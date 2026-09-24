import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FidelityCapabilityReport, FidelityDisposition } from '../../src/fidelity-capability-contract.ts'
import { projectFidelityCapabilityReport } from '../../src/__tests__/fidelity/projector.ts'
import { discoverFidelityRegistry } from '../../src/__tests__/fidelity/registry.ts'
import { runFidelityCases } from '../../src/__tests__/fidelity/runner.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../src/upstream-mermaid-manifest.ts'

const ROOT = join(import.meta.dir, '..', '..')
const RECEIPT_OUTPUT = join(ROOT, 'src', '__tests__', 'fidelity', 'generated-receipt.json')
const CAPABILITY_OUTPUT = join(ROOT, 'docs', 'project', 'fidelity-capability-report.json')
const CITIZENSHIP_OUTPUT = join(ROOT, 'docs', 'contributing', 'diagram-family-citizenship.matrix.json')

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
 * feature for a built-in family must have a native receipt before the family
 * can regain a satisfied syntax-parity claim. */
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
    for (const feature of features) {
      const receipt = receipts.get(feature.id)
      if (!receipt || receipt.family !== familyId) {
        counts.absent++
        continue
      }
      receipted++
      counts[receipt.disposition]++
    }
    const satisfied = features.length > 0 && counts.native === features.length
    const cell: CitizenshipCell = {
      status: satisfied ? 'satisfied' : 'exception',
      evidence: ['docs/project/fidelity-capability-report.json'],
      note: `Receipt-derived Mermaid 11.16 coverage: ${receipted}/${features.length} features receipted; native=${counts.native}, source-preserved=${counts['source-preserved']}, diagnosed=${counts.diagnosed}, absent-or-unreceipted=${counts.absent}.`,
      ...(satisfied ? {} : { tracked: ['#248'] }),
    }
    family.cells.mermaidSyntaxParity = cell
  }
  return json(matrix)
}

async function generatedArtifacts(): Promise<readonly [string, string][]> {
  const registry = await discoverFidelityRegistry()
  const receipt = await runFidelityCases(registry.cases, registry.caseFiles)
  if (receipt.summary.failedCaseCount > 0) {
    const failures = receipt.cases.filter(result => !result.passed).map(result => `${result.id}: ${result.issues.join('; ')}`)
    throw new Error(`Fidelity cases failed:\n${failures.join('\n')}`)
  }
  const capability = projectFidelityCapabilityReport(receipt)
  return [
    [RECEIPT_OUTPUT, json(receipt)],
    [CAPABILITY_OUTPUT, json(capability)],
    [CITIZENSHIP_OUTPUT, projectFidelityCitizenship(readFileSync(CITIZENSHIP_OUTPUT, 'utf8'), capability)],
  ]
}

const check = process.argv.includes('--check')
const artifacts = await generatedArtifacts()
let stale = false
for (const [path, content] of artifacts) {
  if (check) {
    let current = ''
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      // A missing generated artifact is stale by definition.
    }
    if (current !== content) {
      stale = true
      process.stderr.write(`${path.slice(ROOT.length + 1)} is stale; run \`bun run fidelity:receipts\`.\n`)
    }
  } else {
    writeFileSync(path, content)
    process.stdout.write(`Wrote ${path}\n`)
  }
}
if (stale) process.exitCode = 1
