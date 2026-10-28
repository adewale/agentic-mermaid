// Finder-only evidence from fast-check itself, rather than Bun's display log.
import fc from 'fast-check'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const directory = process.env.CONTRACT_DISCOVERY_DIR
if (!directory) throw new Error('Set CONTRACT_DISCOVERY_DIR for contract discovery evidence')
mkdirSync(directory, { recursive: true })
const root = resolve(import.meta.dir, '../..')

fc.configureGlobal({
  ...fc.readConfigureGlobal(),
  reporter(details) {
    const callsite = new Error().stack?.match(/(?:\s|\()([^()\n]+\.test\.[cm]?[jt]s):(\d+):(\d+)/)
    const error = details.errorInstance
    appendFileSync(join(directory, 'properties.jsonl'), JSON.stringify({
      commit: process.env.GITHUB_SHA ?? 'local', bun: Bun.version, fastCheck: fc.__version,
      file: callsite ? relative(root, callsite[1]!.trim()) : undefined,
      line: callsite ? Number(callsite[2]) : undefined,
      failed: details.failed, interrupted: details.interrupted,
      seed: details.seed, path: details.counterexamplePath,
      runs: details.numRuns, skips: details.numSkips, shrinks: details.numShrinks,
      ...(details.counterexample === null ? {} : { counterexample: fc.stringify(details.counterexample) }),
      ...(error === null ? {} : { error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) }),
    }) + '\n')
    // A captured failure must still fail the owning test and workflow.
    if (details.failed) throw new Error(fc.defaultReportMessage(details) ?? 'Property failed', { cause: error })
  },
})
