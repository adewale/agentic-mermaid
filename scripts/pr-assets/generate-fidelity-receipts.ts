import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FIDELITY_ARTIFACT_ROOT,
  generatedFidelityArtifacts,
  runFidelityRegistryOnce,
} from '../../src/__tests__/fidelity/artifacts.ts'

// Writes the committed projections of the in-memory fidelity run. The raw
// receipt is never written; `src/__tests__/fidelity-receipts.test.ts` performs
// the same regeneration and byte comparison as `--check`.

const check = process.argv.includes('--check')
const { receipt } = await runFidelityRegistryOnce()
let stale = false
for (const { path, content } of generatedFidelityArtifacts(receipt)) {
  const absolute = join(FIDELITY_ARTIFACT_ROOT, path)
  if (check) {
    let current = ''
    try {
      current = readFileSync(absolute, 'utf8')
    } catch {
      // A missing generated artifact is stale by definition.
    }
    if (current !== content) {
      stale = true
      process.stderr.write(`${path} is stale; run \`bun run fidelity:receipts\`.\n`)
    }
  } else {
    writeFileSync(absolute, content)
    process.stdout.write(`Wrote ${absolute}\n`)
  }
}
if (stale) process.exitCode = 1
