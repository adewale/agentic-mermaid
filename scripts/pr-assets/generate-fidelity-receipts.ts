import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectFidelityCapabilityShadow } from '../../src/__tests__/fidelity/projector.ts'
import { discoverFidelityRegistry } from '../../src/__tests__/fidelity/registry.ts'
import { runFidelityCases } from '../../src/__tests__/fidelity/runner.ts'

const ROOT = join(import.meta.dir, '..', '..')
const RECEIPT_OUTPUT = join(ROOT, 'src', '__tests__', 'fidelity', 'generated-receipt.json')
const SHADOW_OUTPUT = join(ROOT, 'docs', 'project', 'fidelity-capability-shadow.json')

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function generatedArtifacts(): Promise<readonly [string, string][]> {
  const registry = await discoverFidelityRegistry()
  const receipt = await runFidelityCases(registry.cases, registry.caseFiles)
  if (receipt.summary.failedCaseCount > 0) {
    const failures = receipt.cases.filter(result => !result.passed).map(result => `${result.id}: ${result.issues.join('; ')}`)
    throw new Error(`Fidelity cases failed:\n${failures.join('\n')}`)
  }
  return [
    [RECEIPT_OUTPUT, json(receipt)],
    [SHADOW_OUTPUT, json(projectFidelityCapabilityShadow(receipt))],
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
