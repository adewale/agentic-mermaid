import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { stableDigest } from './prepare-skill-evidence.ts'
import type { ExecutionReceipt } from './run-codex-evidence.ts'

export interface MaterializationResult {
  runDir: string
  originalBytes: number
  materializedBytes: number
  changed: boolean
}

export interface MaterializationReceipt {
  schemaVersion: 2
  runsRoot: string
  traceCount: number
  materializedCount: number
  alreadyCompleteCount: number
  traceDigest: string
  outputDigest: string
  harnessOutputDigest: string
  execution: {
    receiptDigest: string
    receipt: ExecutionReceipt
  }
  runs: Array<{
    runDir: string
    materialized: boolean
    traceDigest: string
    outputDigest: string
    harnessOutputDigest: string
  }>
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function tracePaths(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap(entry => {
      const path = join(root, entry.name)
      return entry.isDirectory() ? tracePaths(path) : entry.isFile() && entry.name === 'trace.jsonl' ? [path] : []
    })
    .sort()
}

function treeDigest(paths: string[], root: string): string {
  const hash = createHash('sha256')
  for (const path of paths) hash.update(relative(root, path)).update('\0').update(readFileSync(path)).update('\0')
  return `sha256:${hash.digest('hex')}`
}

function fileDigest(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

function recordDigest(records: MaterializationReceipt['runs'], field: 'harnessOutputDigest'): string {
  const hash = createHash('sha256')
  for (const record of records) hash.update(record.runDir).update('\0').update(record[field]).update('\0')
  return `sha256:${hash.digest('hex')}`
}

/** Extract the last complete Codex assistant message from immutable JSONL. */
export function finalCodexMessage(traceText: string): string {
  let answer = ''
  for (const [index, line] of traceText.split('\n').entries()) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch (error) {
      throw new Error(`invalid trace JSON on line ${index + 1}: ${String(error)}`)
    }
    if (!record || typeof record !== 'object') continue
    const event = record as { type?: unknown; item?: unknown }
    if (event.type !== 'item.completed' || !event.item || typeof event.item !== 'object') continue
    const item = event.item as { type?: unknown; text?: unknown }
    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) answer = item.text
  }
  if (!answer) throw new Error('trace contains no completed agent_message')
  return answer
}

/**
 * Replace a harness-truncated output only when it is an exact prefix of the
 * full trace message. This refuses ambiguous rewrites and preserves the
 * original adapter artifact for auditability.
 */
export function materializeRunOutput(runDir: string): MaterializationResult {
  const tracePath = join(runDir, 'trace.jsonl')
  const outputPath = join(runDir, 'output.md')
  if (!existsSync(outputPath)) throw new Error(`missing output.md beside ${tracePath}`)
  const answer = finalCodexMessage(readFileSync(tracePath, 'utf8'))
  const current = readFileSync(outputPath, 'utf8')
  const originalBytes = Buffer.byteLength(current)
  const materializedBytes = Buffer.byteLength(answer)
  const backupPath = join(runDir, 'output.harness.md')
  if (current === answer) {
    if (existsSync(backupPath)) {
      const backup = readFileSync(backupPath, 'utf8')
      if (backup === answer || !answer.startsWith(backup)) {
        throw new Error(`stale or invalid harness backup in ${runDir}`)
      }
    }
    return { runDir, originalBytes, materializedBytes, changed: false }
  }
  if (!answer.startsWith(current)) {
    throw new Error(`refusing non-prefix output rewrite in ${runDir}`)
  }
  if (existsSync(backupPath)) {
    throw new Error(`refusing reused run directory with an existing harness backup in ${runDir}`)
  }
  copyFileSync(outputPath, backupPath)
  writeFileSync(outputPath, answer)
  return { runDir, originalBytes, materializedBytes, changed: true }
}

export function materializeCodexOutputs(runsRoot: string, executionReceipt: ExecutionReceipt): { results: MaterializationResult[]; receipt: MaterializationReceipt } {
  const resolvedRoot = resolve(runsRoot)
  if (executionReceipt.exitCode !== 0) throw new Error('execution receipt records a failed runner')
  if (executionReceipt.schemaVersion >= 2) {
    if (!executionReceipt.taskResults) throw new Error('execution receipt has no per-task result validation')
    if (executionReceipt.taskResults.failures.length > 0 || executionReceipt.taskResults.completeCount !== executionReceipt.taskResults.expectedCount) {
      throw new Error('execution receipt records incomplete task results')
    }
  }
  if (resolve(executionReceipt.runsRoot) !== resolvedRoot) throw new Error('execution receipt runsRoot does not match materialization root')
  const traces = tracePaths(resolvedRoot)
  if (!traces.length) throw new Error(`no trace.jsonl files under ${runsRoot}`)
  const results = traces.map(path => materializeRunOutput(dirname(path)))
  const outputs = traces.map(path => join(dirname(path), 'output.md'))
  const runs = traces.map((tracePath, index) => {
    const runDir = dirname(tracePath)
    const outputPath = outputs[index]!
    const backupPath = join(runDir, 'output.harness.md')
    const materialized = existsSync(backupPath)
    return {
      runDir: relative(resolvedRoot, runDir),
      materialized,
      traceDigest: fileDigest(tracePath),
      outputDigest: fileDigest(outputPath),
      harnessOutputDigest: fileDigest(materialized ? backupPath : outputPath),
    }
  })
  return {
    results,
    receipt: {
      schemaVersion: 2,
      runsRoot: resolvedRoot,
      traceCount: traces.length,
      materializedCount: runs.filter(run => run.materialized).length,
      alreadyCompleteCount: runs.filter(run => !run.materialized).length,
      traceDigest: treeDigest(traces, resolvedRoot),
      outputDigest: treeDigest(outputs, resolvedRoot),
      harnessOutputDigest: recordDigest(runs, 'harnessOutputDigest'),
      execution: { receiptDigest: stableDigest(executionReceipt), receipt: executionReceipt },
      runs,
    },
  }
}

if (import.meta.main) {
  const runsOption = option('--runs')
  const executionReceiptOption = option('--execution-receipt')
  if (!runsOption || !executionReceiptOption) throw new Error('usage: bun run scripts/eval/materialize-codex-output.ts --runs PATH --execution-receipt execution.json [--receipt receipt.json]')
  const runsRoot = resolve(runsOption)
  const executionReceipt = JSON.parse(readFileSync(resolve(executionReceiptOption), 'utf8')) as ExecutionReceipt
  const { results, receipt } = materializeCodexOutputs(runsRoot, executionReceipt)
  const receiptPath = option('--receipt')
  if (receiptPath) writeFileSync(resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`Materialized ${receipt.materializedCount}/${results.length} Codex outputs from full traces (${receipt.alreadyCompleteCount} already complete)`)
}
