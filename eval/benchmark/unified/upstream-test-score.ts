import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { admitCurrentReference } from '../../mermaid-modern-compat/reference.ts'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult } from './types.ts'
import { inventoryUpstreamTests } from './upstream-test-inventory.ts'

export const UPSTREAM_TEST_SCORE_PRODUCERS = ['eval/benchmark/unified/upstream-test-score.ts', 'eval/benchmark/unified/upstream-test-worker.mjs', 'eval/benchmark/unified/upstream-test-assertions.mjs', 'eval/benchmark/unified/upstream-test-inventory.ts', 'eval/mermaid-modern-compat/corpus.ts'] as const

interface CallbackRow {
  family: string
  path: string
  name: string
  status: 'passed' | 'failed' | 'unavailable' | 'skipped-upstream'
  assertions: Array<{ passed: boolean; matcher: string; actual?: unknown; expected?: unknown }>
  sources: string[]
  targetRejections?: number
  requestedParseCalls?: number
  preparedParseCalls?: number
  preparationReplays?: number
  error?: string
  unavailable?: string[]
}
interface WorkerResult {
  engine: string
  invocationId?: string
  artifact?: unknown
  blocked?: string
  callbacks?: CallbackRow[]
  publicSources?: Array<{ source: string; accepted: boolean | null; error: string | null; timing: { publicApiMs: number; calls: number; boundary: string } | null }>
  replay?: Array<{ id: string; family: string; accepted: boolean | null; error: string | null; unavailable: string | null }>
  workflow: { workerWallMs: number; fullProcessWallMs?: number; initializationMs?: number; boundary?: string }
}

export async function runUpstreamTestScoreSuite(options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const startedAt = new Date().toISOString(),
    driver = options.harnessRoot ?? options.root,
    target = options.packageRoot ?? options.root
  const upstream = options.mermaidDir ?? process.env.MERMAID_UPSTREAM_DIR ?? resolve(driver, '../mermaid'),
    reference = options.referenceDir ?? process.env.MERMAID_REFERENCE_DIR ?? resolve(driver, '../mermaid-reference')
  const observations: BenchmarkObservation[] = [],
    gaps: string[] = []
  mkdirSync(options.out, { recursive: true })
  const oracleDir = join(driver, 'eval/mermaid-upstream-suite-bench')
  const ledger = JSON.parse(readFileSync(join(oracleDir, 'mindmap-gitgraph-f3dea583.json'), 'utf8')) as { upstream: { commit: string; files: Array<{ family: string; path: string; sha256: string }> }; blocks: Array<{ classification: string }>; accounting: unknown }
  const historicalFiles = ledger.upstream.files.map(file => ({ family: file.family, relativePath: file.path, path: join(oracleDir, 'upstream-f3dea583', file.path.split('/').at(-1)!), expectedSha256: file.sha256 }))
  for (const file of historicalFiles) if (createHash('sha256').update(readFileSync(file.path)).digest('hex') !== file.expectedSha256) return { id: 'upstream-test-assertions', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, gaps: [`Pinned upstream spec bytes differ: ${file.path}`] }
  let provenance: ReturnType<typeof admitCurrentReference> | undefined, inventory: ReturnType<typeof inventoryUpstreamTests> | undefined
  try {
    provenance = admitCurrentReference(upstream, reference)
    inventory = inventoryUpstreamTests(upstream)
    writeFileSync(join(options.out, 'upstream-test-inventory.json'), JSON.stringify({ provenance, ...inventory }, null, 2))
  } catch (error) {
    gaps.push(`Current upstream inventory/reference admission unavailable: ${String(error)}`)
  }
  if (!provenance || !inventory) return { id: 'upstream-test-assertions', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, gaps }
  const files = historicalFiles.map(file => ({ family: file.family, path: join(upstream, file.relativePath), relativePath: file.relativePath, historicalByteEquivalent: readFileSync(file.path).equals(readFileSync(join(upstream, file.relativePath))) }))
  const coveredPaths = new Set(files.map(file => file.relativePath))
  const unprojectedFamilyFiles = inventory.files.filter(file => ['mindmap', 'gitgraph'].includes(file.family) && !coveredPaths.has(file.path))
  const pele = process.env.PELE_BENCHMARK_ROOT ?? (options.portableProject === 'obsidianmd/pele' ? options.portableArtifactRoot : undefined)
  const engines = [
    { engine: 'agentic', project: 'adewale/agentic-mermaid', artifactRoot: target, entry: 'dist/agent-core.js' },
    { engine: 'pele', project: 'obsidianmd/pele', artifactRoot: pele, entry: 'dist/pele.js' },
    { engine: 'mermaid', project: 'mermaid-js/mermaid', artifactRoot: provenance ? reference : undefined, entry: 'node_modules/mermaid/package.json' },
  ].filter(engine => !options.communityProjects || options.communityProjects.includes(engine.project))
  const results: WorkerResult[] = [],
    artifacts = ['upstream-test-assertions-report.json', 'upstream-test-assertions-report.md', ...(inventory ? ['upstream-test-inventory.json'] : [])]
  for (const engine of engines) {
    if (!engine.artifactRoot || !existsSync(join(engine.artifactRoot, engine.entry))) {
      observations.push({
        suite: 'upstream-test-assertions',
        surface: `${engine.engine}:public-parser`,
        runtime: 'Node',
        format: 'structured',
        mode: 'original-callback-through-public-model',
        family: '*',
        caseId: 'artifact-admission',
        operation: 'original-upstream-assertions',
        status: 'blocked',
        detail: `Actual ${engine.engine} artifact unavailable; set ${engine.engine === 'pele' ? 'PELE_BENCHMARK_ROOT' : 'the declared artifact/reference path'}`,
      })
      continue
    }
    const output = join(options.out, `${engine.engine}-upstream-test-worker.json`),
      job = join(options.out, `${engine.engine}-upstream-test-job.json`),
      invocationId = randomUUID()
    rmSync(output, { force: true })
    writeFileSync(job, JSON.stringify({ engine: engine.engine, invocationId, artifactRoot: engine.artifactRoot, files, output, replaySources: inventory?.literals.map(input => ({ id: input.id, source: input.source, family: input.provenance[0]!.familyHint })) ?? [] }))
    const processStarted = performance.now()
    const child = spawnSync(options.nodeExecutable ?? process.env.NODE_BIN ?? 'node', [join(dirname(fileURLToPath(import.meta.url)), 'upstream-test-worker.mjs'), job], { cwd: driver, encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
    const fullProcessWallMs = performance.now() - processStarted
    if (child.error || child.status !== 0 || !existsSync(output)) {
      observations.push({
        suite: 'upstream-test-assertions',
        surface: `${engine.engine}:public-parser`,
        runtime: 'Node',
        format: 'structured',
        mode: 'original-callback-through-public-model',
        family: '*',
        caseId: 'worker-execution',
        operation: 'original-upstream-assertions',
        status: 'blocked',
        detail: `Worker did not complete successfully; any written JSON is diagnostic only: ${String(child.error?.message ?? child.stderr ?? child.status)}`,
      })
      artifacts.push(`${engine.engine}-upstream-test-job.json`, ...(existsSync(output) ? [`${engine.engine}-upstream-test-worker.json`] : []))
      continue
    }
    let result: WorkerResult
    try {
      result = JSON.parse(readFileSync(output, 'utf8')) as WorkerResult
      if (result.invocationId !== invocationId || result.engine !== engine.engine || !Array.isArray(result.callbacks) || !result.callbacks.length) throw new Error('Worker receipt does not belong to this invocation or has no callback evidence')
    } catch (error) {
      observations.push({ suite: 'upstream-test-assertions', surface: `${engine.engine}:public-parser`, runtime: 'Node', format: 'structured', mode: 'original-callback-through-public-model', family: '*', caseId: 'worker-publication', operation: 'original-upstream-assertions', status: 'blocked', detail: String(error) })
      artifacts.push(`${engine.engine}-upstream-test-job.json`, `${engine.engine}-upstream-test-worker.json`)
      continue
    }
    result.workflow.fullProcessWallMs = fullProcessWallMs
    writeFileSync(output, JSON.stringify(result, null, 2))
    results.push(result)
    artifacts.push(`${engine.engine}-upstream-test-worker.json`, `${engine.engine}-upstream-test-job.json`)
    if (result.blocked)
      observations.push({ suite: 'upstream-test-assertions', surface: `${engine.engine}:public-parser`, runtime: 'Node', format: 'structured', mode: 'original-callback-through-public-model', family: '*', caseId: 'worker-admission', operation: 'original-upstream-assertions', status: 'blocked', detail: result.blocked })
    for (const [index, row] of (result.callbacks ?? []).entries())
      observations.push({
        suite: 'upstream-test-assertions',
        surface: `${engine.engine}:public-parser`,
        runtime: 'Node',
        format: 'structured',
        mode: 'original-callback-through-public-model',
        family: row.family,
        caseId: `${row.family}:${index}:${row.name}`,
        operation: 'original-upstream-assertions',
        status: row.status === 'unavailable' ? 'blocked' : row.status === 'skipped-upstream' ? 'not-applicable' : row.status,
        findings: row.assertions.filter(assertion => !assertion.passed).map(assertion => `${assertion.matcher}: expected ${JSON.stringify(assertion.expected)}, observed ${JSON.stringify(assertion.actual)}`),
        metrics: {
          implementation: engine.engine,
          executedAssertions: row.assertions.length,
          passedAssertions: row.assertions.filter(assertion => assertion.passed).length,
          targetRejections: row.targetRejections ?? 0,
          requestedParseCalls: row.requestedParseCalls ?? 0,
          preparedParseCalls: row.preparedParseCalls ?? 0,
          preparationReplays: row.preparationReplays ?? 0,
          upstreamCommit: provenance.commit,
          scope: 'Original assertion callback through reviewed public-model facade; unavailable/private APIs never count as expected rejections. No API speed rank.',
        },
        detail: row.error ?? row.unavailable?.join('; '),
      })
    for (const row of result.replay ?? [])
      observations.push({
        suite: 'upstream-source-replay',
        surface: `${engine.engine}:public-parser`,
        runtime: 'Node',
        format: 'structured',
        mode: 'original-callback-through-public-model',
        family: row.family,
        caseId: row.id,
        operation: 'unscored-upstream-literal-replay',
        status: row.unavailable ? 'blocked' : 'not-applicable',
        metrics: { implementation: engine.engine, observedAccepted: row.accepted, positiveAssertionCredit: false },
        detail: row.unavailable ?? row.error ?? 'Observed public acceptance only; no original assertion was executed for this source',
      })
    for (const file of unprojectedFamilyFiles)
      observations.push({
        suite: 'upstream-test-unprojected',
        surface: `${engine.engine}:public-parser`,
        runtime: 'Node',
        format: 'structured',
        mode: 'original-callback-through-public-model',
        family: file.family,
        caseId: file.path,
        operation: 'unprojected-upstream-declarations',
        status: 'blocked',
        metrics: { implementation: engine.engine, declarations: file.declarations.length, executedCallbacks: 0, positiveAssertionCredit: false },
        detail: 'Current pinned private DB/layout/color test file is inventoried but has no reviewed public-model assertion adapter',
      })
  }
  gaps.push(
    'This executes the current pinned main Mindmap/GitGraph spec callbacks through public adapters, not Mermaid’s full upstream suite. Other current family DB/layout/color declarations remain explicitly unprojected, as does the wider census.',
    'Historical ledger blocks, actual expanded callbacks and executed assertions are different units. Failed callbacks stop at their first assertion; executed assertions are not a fixed score denominator.',
    'Original callbacks run through public-model DB facades, not original private Mermaid parsers/DBs. Private config/logging, unsupported projections and skipped tests remain unavailable/not applicable, including inside expected-error callbacks.',
    'Worker wall time includes preparation, imports, adapters, facade replays and assertions. Per-preparation public API clocks are single-process uncalibrated diagnostics, not same-upstream-runner time or a speedup score.',
    'The retained normalized JSON incorrectly expects an empty-string cherry-pick tag. Original upstream spec line960 asserts an empty array; the original callback is executed without changing either historical file.',
  )
  const evidence = {
    historicalLedger: {
      commit: ledger.upstream.commit,
      blocks: ledger.blocks.length,
      accounting: ledger.accounting,
      classifications: Object.fromEntries([...new Set(ledger.blocks.map(block => block.classification))].map(classification => [classification, ledger.blocks.filter(block => block.classification === classification).length])),
    },
    sourceFiles: files,
    historicalSourceFiles: historicalFiles,
    currentUpstream: provenance,
    currentAssertionScope: { files: files.length, declarations: inventory.files.filter(file => coveredPaths.has(file.path)).reduce((sum, file) => sum + file.declarations.length, 0), unprojectedFamilyFiles: unprojectedFamilyFiles.map(file => ({ path: file.path, declarations: file.declarations.length })) },
    currentInventory: inventory.counts,
    results: results.map(result => ({
      engine: result.engine,
      artifact: result.artifact,
      callbacks: result.callbacks?.length ?? 0,
      statuses: Object.fromEntries(['passed', 'failed', 'unavailable', 'skipped-upstream'].map(status => [status, result.callbacks?.filter(row => row.status === status).length ?? 0])),
      requestedParseCalls: result.callbacks?.reduce((sum, row) => sum + (row.requestedParseCalls ?? 0), 0) ?? 0,
      preparedParseCalls: result.callbacks?.reduce((sum, row) => sum + (row.preparedParseCalls ?? 0), 0) ?? 0,
      workflow: result.workflow,
    })),
  }
  const report = { protocol: 'original-upstream-public-assertions-v1', evidence, observations, gaps }
  writeFileSync(join(options.out, 'upstream-test-assertions-report.json'), JSON.stringify(report, null, 2))
  writeFileSync(
    join(options.out, 'upstream-test-assertions-report.md'),
    [
      '# Current pinned upstream assertion subset',
      '',
      `Mermaid ${provenance.version} at ${provenance.commit}: ${evidence.currentAssertionScope.declarations} declarations in two main Mindmap/GitGraph specs; callback/table expansions are counted separately. ${unprojectedFamilyFiles.reduce((sum, file) => sum + file.declarations.length, 0)} additional family declarations remain unprojected.`,
      '',
      `Historical ledger retained separately: ${ledger.blocks.length} blocks at ${ledger.upstream.commit}. Current/vendored source byte equivalence is recorded explicitly.`,
      '',
      '| Engine | Passed callbacks | Failed | Unavailable | Upstream skipped | Prepared public calls | Full process wall ms |',
      '|---|---:|---:|---:|---:|---:|---:|',
      ...evidence.results.map(row => `| ${row.engine} | ${row.statuses.passed} | ${row.statuses.failed} | ${row.statuses.unavailable} | ${row.statuses['skipped-upstream']} | ${row.preparedParseCalls} | ${(row.workflow.fullProcessWallMs ?? row.workflow.workerWallMs).toFixed(2)} |`),
      '',
      ...gaps.map(gap => `- ${gap}`),
      '',
    ].join('\n'),
  )
  return { id: 'upstream-test-assertions', status: observations.some(row => row.status === 'failed') ? 'failed' : observations.some(row => row.status === 'blocked') ? 'blocked' : 'passed', startedAt, finishedAt: new Date().toISOString(), observations, gaps, artifacts }
}
