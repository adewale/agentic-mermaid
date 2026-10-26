import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { selectsCoreFidelity } from '../fidelity/selection.ts'
import type { UnifiedRunOptions, UnifiedSuiteResult } from './types.ts'

/** Native Node owns public-model execution. The Bun campaign driver does not
 * silently stand in for the caller's selected Node runtime. */
export async function runMermaidFidelitySuite(options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString()
  if (!selectsCoreFidelity(options.communityProjects)) return { id: 'mermaid-fidelity', startedAt, finishedAt: startedAt, status: 'not-applicable', observations: [], artifacts: [], gaps: ['No core public-model project was selected; the native worker and its filesystem/runtime prerequisites were not prepared.'] }
  const root = options.harnessRoot ?? options.root, invocationId = randomUUID(), output = join(options.out, 'node-fidelity-result.json'), job = join(options.out, 'node-fidelity-job.json')
  mkdirSync(options.out, { recursive: true }); rmSync(output, { force: true })
  writeFileSync(job, JSON.stringify({ invocationId, options, output }))
  const child = spawnSync(options.nodeExecutable ?? 'node', [join(root, 'eval/benchmark/fidelity/worker.mjs'), job], { cwd: root, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 4 * 1024 * 1024 })
  if (child.error || ![0, 1].includes(child.status ?? -1) || !existsSync(output)) throw Error('Native fidelity worker did not complete: ' + String(child.error ?? child.stderr))
  const result = JSON.parse(readFileSync(output, 'utf8'))
  if (result.invocationId !== invocationId || !Array.isArray(result.result?.observations)) throw Error('Native fidelity worker receipt does not belong to this invocation')
  return result.result
}
