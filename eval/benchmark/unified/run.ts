import { catalogReleaseView } from './catalog-result.ts'
import { harnessFile } from 'trident/unified/harness-paths.ts'
import { readBenchmarkDocument, readBenchmarkResult, writeBenchmarkDocument } from 'trident/portable/project-records.ts'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism, cpus, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertBenchmarkExecutionAllowed } from 'trident/ci-policy.ts'
import { subprocessTreeTerminator } from 'trident/unified/process-tree.ts'
import { type SuiteExecution, type UnifiedReport, writeUnifiedReport } from 'trident/unified/report.ts'
import { benchmarkSuites, type SuiteDefinition, type SuiteOptions } from './suites.ts'
import type { BenchmarkObservation, UnifiedSuiteResult } from 'trident/unified/types.ts'
import { assertBenchmarkSetVersions, assertBenchmarkToolVersion, type BenchmarkToolVersion } from 'trident/tool-versions.ts'
import { admitSelectedArtifacts, parseOptions as parseSharedOptions, type RunnerOptions } from './options.ts'
import { communityCatalogFile, harnessRepository } from 'trident/unified/trident-paths.ts'

const DRIVER = resolve(import.meta.dirname, '../../..')
const now = () => new Date().toISOString()
const readJson = (file: string): any => JSON.parse(readFileSync(file, 'utf8'))
const cleanText = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')
const bun = () => (process.versions.bun ? process.execPath : (process.env.BUN_BIN ?? 'bun'))

export type { RunnerOptions } from './options.ts'
export function parseOptions(args: string[]): RunnerOptions {
  const options = parseSharedOptions(args)
  return { ...options, root: args.includes('--target') ? options.root : DRIVER, harnessRoot: DRIVER }
}

/** Admission precedes acquisition/cache activation and does not alter clocks. */

function owningToolVersions(value: any, source: string): BenchmarkToolVersion[] {
  if (Array.isArray(value.toolVersions)) return assertBenchmarkSetVersions(value.toolVersions)
  if (Array.isArray(value.identities)) return assertBenchmarkSetVersions(value.identities.map((entry: any) => ({ tool: entry.name, version: entry.version, source, ...(entry.name === 'agentic-mermaid' && entry.label !== 'candidate' ? { variant: entry.label } : {}) })))
  return []
}
function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}
const synthetic = (suite: SuiteDefinition, status: UnifiedSuiteResult['status'], gaps: string[], startedAt = now()): UnifiedSuiteResult => ({ id: suite.id, status, startedAt, finishedAt: now(), observations: [], gaps })

export function testCounts(text: string): Record<string, number | string | boolean | null> | undefined {
  const plain = cleanText(text),
    number = (word: string) => {
      const values = [...plain.matchAll(new RegExp(`(?:^|\\n)\\s*(\\d+) ${word}\\b`, 'g'))].map(match => Number(match[1]))
      return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined
    }
  const passed = number('pass'),
    failed = number('fail'),
    skipped = number('skip'),
    expect = [...plain.matchAll(/(?:^|\n)\s*(\d+) expect\(\) calls/g)].map(match => Number(match[1]))
  if (passed === undefined && failed === undefined && skipped === undefined) return undefined
  return { passed: passed ?? 0, failed: failed ?? 0, skipped: skipped ?? 0, ...(expect.length ? { assertions: expect.reduce((sum, value) => sum + value, 0) } : {}) }
}
function declaredReports(directory: string, notBefore: number) {
  const gaps: string[] = [],
    artifacts: string[] = []
  let status: 'failed' | 'blocked' | undefined
  const toolVersions: BenchmarkToolVersion[] = []
  for (const name of readdirSync(directory).filter(name => /(?:report|summary|editor-preview|editor-session|ownership|renderer-profile|qualification-status|gates)\.json$/.test(name))) {
    const file = join(directory, name)
    if (!statSync(file).isFile() || statSync(file).mtimeMs < notBefore - 1) continue
    artifacts.push(file)
    try {
      const value = readBenchmarkDocument(file)
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      toolVersions.push(...owningToolVersions(value, file))
      const checks = Array.isArray(value.checks) ? value.checks.filter((check: any) => check.ok === false) : []
      if (value.status === 'failed' || value.ok === false || checks.length) {
        status = 'failed'
        gaps.push(`${name} declares failed qualification${checks.length ? ': ' + checks.map((check: any) => check.name ?? 'unnamed gate').join(', ') : ''}`)
      } else if (['incomplete', 'running', 'started', 'uncalibrated'].includes(value.status)) {
        status ??= 'blocked'
        gaps.push(`${name} declares ${value.status}; process completion is not complete benchmark evidence`)
      }
    } catch (error) {
      status = 'failed'
      gaps.push(`Cannot read fresh owning report ${name}: ${String(error)}`)
    }
  }
  return { status, gaps, artifacts, toolVersions: assertBenchmarkSetVersions(toolVersions) }
}
async function subprocess(command: string[], cwd: string, env: NodeJS.ProcessEnv, logPath: string, timeoutMs: number) {
  const stream = createWriteStream(logPath),
    started = performance.now()
  let tail = '',
    timedOut = false,
    cancelledSignal: NodeJS.Signals | undefined,
    launchError: string | undefined
  const normalized = command[0] === 'bun' ? [bun(), ...command.slice(1)] : command
  const child = spawn(normalized[0]!, normalized.slice(1), { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  let spawned = false, pendingSignal: NodeJS.Signals | undefined
  let tree: ReturnType<typeof subprocessTreeTerminator> | undefined
  const fallbackKill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch { try { child.kill(signal) } catch {} }
  }
  const kill = (signal: NodeJS.Signals) => {
    if (!spawned) { if (pendingSignal !== 'SIGKILL') pendingSignal = signal; return }
    if (tree) tree.signal(signal)
    fallbackKill(signal)
  }
  // Cancellation can arrive before Bun has completed its asynchronous spawn.
  // Bind process ownership and deliver any pending signal once the PID exists.
  child.once('spawn', () => {
    spawned = true
    if (pendingSignal === 'SIGKILL' && process.platform === 'linux') fallbackKill('SIGSTOP')
    tree = child.pid ? subprocessTreeTerminator(child.pid, fallbackKill) : undefined
    if (pendingSignal) kill(pendingSignal)
  })
  let force: ReturnType<typeof setTimeout> | undefined
  const terminate = () => {
    // Stop the owned group before discovering descendants so a Bun script
    // cannot fork a detached process while cancellation is being delivered.
    if (spawned && process.platform === 'linux') fallbackKill('SIGSTOP')
    kill('SIGKILL')
    force ??= setTimeout(() => kill('SIGKILL'), 2000)
  }
  const onTerm = () => {
    cancelledSignal = 'SIGTERM'
    terminate()
  }
  const onInt = () => {
    cancelledSignal = 'SIGINT'
    terminate()
  }
  process.once('SIGTERM', onTerm)
  process.once('SIGINT', onInt)
  const timer = setTimeout(() => {
    timedOut = true
    terminate()
  }, timeoutMs)
  const append = (chunk: Buffer) => {
    stream.write(chunk)
    tail = (tail + chunk.toString()).slice(-256_000)
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(done => {
    child.once('error', error => {
      launchError = String(error)
      stream.write(launchError + '\n')
    })
    child.once('close', (code, signal) => done({ code, signal }))
  })
  clearTimeout(timer)
  if (force) {
    clearTimeout(force)
    await tree?.finish()
  }
  process.off('SIGTERM', onTerm)
  process.off('SIGINT', onInt)
  await new Promise<void>(done => stream.end(done))
  return { ...result, elapsedMs: performance.now() - started, tail, timedOut, launchError, cancelledSignal }
}
async function runInternal(id: string, options: SuiteOptions): Promise<UnifiedSuiteResult> {
  const entry: Record<string, readonly [string, string]> = {
    family: ['family-suite.ts', 'runFamilySuite'],
    invocation: ['invocation.ts', 'runInvocationSuite'],
    community: ['project-update.ts', 'runIncrementalCommunitySuite'],
    'pinned-reference-score': ['reference-score.ts', 'runReferenceScoreSuite'],
    'community-cli': ['project-update.ts', 'runRetainedCommunityCliSuite'],
    'stable-support': ['stable-support-run.ts', 'runStableSupportSuite'],
    'entry-startup': ['retained-campaigns.ts', 'runRetainedEntryStartupSuite'],
    'upstream-test-assertions': ['retained-campaigns.ts', 'runRetainedUpstreamTestSuite'],
    'mermaid-fidelity': ['fidelity-suite.ts', 'runMermaidFidelitySuite'],
    'community-fidelity': ['../fidelity/community.ts', 'runCommunityFidelitySuite'],
    'upstream-fidelity': ['upstream-fidelity.ts', 'runUpstreamFidelitySuite'],
    'upstream-original': ['upstream-fidelity-original.ts', 'runUpstreamOriginalSuite'],
    'mermaid-baseline-browser': ['mermaid-baseline.ts', 'runMermaidBrowserBaseline'],
    'mermaid-baseline-compatibility': ['mermaid-baseline.ts', 'runMermaidParserBaseline'],
  }
  const [file, name] = entry[id] ?? []
  if (!file || !name) throw new Error(`No internal suite ${id}`)
  const local = harnessFile(options.harnessRoot, 'eval/benchmark/unified', file)
  const module = await import(existsSync(local) ? pathToFileURL(local).href : import.meta.resolve('trident/' + resolve('/unified', file).slice(1)))
  if (typeof module[name] !== 'function') throw new Error(`${file} does not export ${name}`)
  return module[name](options)
}

/** The subprocess boundary prevents one failed or instrumented suite from
 * contaminating the next suite's runtime. Timers never run concurrently. */
export async function runUnified(options: RunnerOptions): Promise<UnifiedReport> {
  assertBenchmarkExecutionAllowed()
  options = { ...options, communityInvocationId: randomUUID() }
  const catalog = benchmarkSuites(options),
    unknown = options.selected?.filter(id => !catalog.some(suite => suite.id === id))
  if (unknown?.length) throw new Error(`Unknown suites: ${unknown.join(', ')}`)
  if (options.list) throw new Error('Use benchmarkSuites() for read-only listing')
  mkdirSync(options.out, { recursive: true })
  const selected = new Set(options.selected ?? catalog.filter(suite => suite.automatic !== false && (options.profile === 'full' || suite.smoke)).map(suite => suite.id))
  const report: UnifiedReport = {
    schemaVersion: 1,
    exports: { tables: Boolean(options.exportTables) },
    machine: {
      platform: process.platform,
      arch: process.arch,
      driverNode: process.versions.node,
      driverBun: process.versions.bun ?? null,
      xdgCacheHome: process.env.XDG_CACHE_HOME ?? null,
      availableParallelism: availableParallelism(),
      cpuModel: cpus()[0]?.model ?? null,
      hostMemoryBytes: totalmem(),
      cgroupCpuMax: existsSync('/sys/fs/cgroup/cpu.max') ? readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : null,
      cgroupMemoryMax: existsSync('/sys/fs/cgroup/memory.max') ? readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() : null,
    },
    startedAt: now(),
    profile: options.profile,
    rounds: options.rounds,
    driverRoot: options.harnessRoot,
    ...(existsSync(join(options.harnessRoot, '.trident-workspace.json')) ? { sourceWorkspace: readJson(join(options.harnessRoot, '.trident-workspace.json')) } : {}),
    targetRoot: options.root,
    packageRoot: options.packageRoot,
    driverRevision: git(options.harnessRoot, ['rev-parse', 'HEAD']),
    targetRevision: git(options.root, ['rev-parse', 'HEAD']),
    driverDirty: git(options.harnessRoot, ['status', '--porcelain']) === undefined ? null : Boolean(git(options.harnessRoot, ['status', '--porcelain'])),
    targetDirty: git(options.root, ['status', '--porcelain']) === undefined ? null : Boolean(git(options.root, ['status', '--porcelain'])),
    status: 'running',
    policy:
      'All selected suites execute sequentially. Each suite records its actual source, working directory and measured target. Driver-owned tests retain driver imports; target-aware internal adapters, exact-artifact comparisons and explicitly selected target-owned protocols receive their recorded candidate. Blocked and unselected suites stay in this ledger. A successful process exit does not establish qualification for every corpus row. Smoke is bounded; full selects automatic suites, with explicit orchestration entries available separately. Current independent reference and historical harvested fixtures retain distinct pins.',
    suites: [],
  }
  writeFileSync(join(options.out, 'invocation.json'), JSON.stringify({ ...options, selected: [...selected] }, null, 2) + '\n')
  let cancelledSignal: NodeJS.Signals | undefined
  for (const suite of catalog) {
    const suiteOut = join(options.out, suite.id.replaceAll(':', '-'))
    mkdirSync(suiteOut, { recursive: true })
    const execution: SuiteExecution = {
      id: suite.id,
      title: suite.title,
      source: suite.source,
      policy: suite.policy,
      target: suite.target ?? (suite.kind === 'internal' ? 'candidate' : 'driver'),
      status: 'skipped',
      selected: selected.has(suite.id),
      prerequisites: suite.prerequisites,
      ...(suite.pin ? { pin: suite.pin } : {}),
    }
    report.suites.push(execution)
    if (!execution.selected) {
      writeUnifiedReport(options.out, report)
      continue
    }
    if (cancelledSignal) {
      execution.status = 'blocked'
      execution.result = synthetic(suite, 'blocked', [`Controller received ${cancelledSignal}; later suites were not launched`])
      writeUnifiedReport(options.out, report)
      continue
    }
    if (suite.prerequisites.length) {
      execution.status = 'blocked'
      execution.result = synthetic(suite, 'blocked', suite.prerequisites)
      writeUnifiedReport(options.out, report)
      continue
    }
    const internalResult = join(suiteOut, 'result.json'),
      jobPath = join(suiteOut, 'job.json')
    const command = suite.kind === 'internal' ? ['bun', 'run', harnessFile(options.harnessRoot, 'eval/benchmark/unified/run.ts'), '--worker-suite', suite.id, '--worker-job', jobPath] : suite.command!
    if (suite.kind === 'internal' && existsSync(internalResult)) renameSync(internalResult, internalResult + `.previous-${Date.now()}`)
    if (suite.kind === 'internal') writeFileSync(jobPath, JSON.stringify({ ...options, out: suiteOut, resultPath: internalResult }, null, 2) + '\n')
    execution.command = command
    execution.workingDirectory = suite.cwd ?? options.harnessRoot
    execution.log = `${suite.id.replaceAll(':', '-')}/run.log`
    console.log(`unified: ${suite.id} (${suite.kind === 'internal' ? options.root : (suite.cwd ?? options.harnessRoot)})`)
    const env: NodeJS.ProcessEnv = { ...process.env, AM_BENCH_SUITE_OUT: suiteOut, AM_FC_SEED: process.env.AM_FC_SEED ?? '7', ...suite.environment }
    if (options.mermaidDir) env.MERMAID_UPSTREAM_DIR = options.mermaidDir
    if (options.referenceDir) env.MERMAID_REFERENCE_DIR = options.referenceDir
    execution.environment = { ...suite.environment }
    for (const key of ['AM_FC_SEED', 'AM_FC_NUM_RUNS'] as const) {
      const value = env[key]
      if (value !== undefined) execution.environment[key] = value
    }
    const startedAt = now(),
      evidenceNotBefore = Date.now(),
      run = await subprocess(command, suite.cwd ?? options.harnessRoot, env, join(options.out, execution.log), options.timeoutMs)
    cancelledSignal = run.cancelledSignal
    Object.assign(execution, { elapsedMs: run.elapsedMs, exitCode: run.code, signal: run.signal, timedOut: run.timedOut })
    execution.status = run.code === 0 && !run.timedOut && !run.launchError && !run.cancelledSignal ? 'passed' : 'failed'
    if (suite.kind === 'internal' && existsSync(internalResult)) {
      const result = readBenchmarkResult(internalResult)
      if (!Array.isArray(result.observations) || !Array.isArray(result.gaps)) throw new Error(`${suite.id} returned an invalid result envelope`)
      execution.result = ['community', 'community-cli', 'community-fidelity'].includes(suite.id) ? catalogReleaseView(result) : result
      if (execution.status === 'passed' || run.code === 2) execution.status = result.status
    } else {
      const owning = declaredReports(suiteOut, evidenceNotBefore)
      if (execution.status === 'passed' && owning.status) execution.status = owning.status
      const counts = suite.kind === 'test' ? testCounts(readFileSync(join(options.out, execution.log), 'utf8')) : undefined
      const observation: BenchmarkObservation = {
        suite: suite.id,
        surface: suite.kind === 'test' ? 'owning-tests' : 'owning-suite',
        runtime: 'bun',
        family: '*',
        caseId: suite.id,
        operation: suite.kind === 'test' ? 'owning-tests' : 'suite-process',
        format: 'report',
        mode: 'fresh-process',
        status: execution.status,
        samplesMs: [run.elapsedMs],
        metrics: { wallMs: run.elapsedMs, exitCode: run.code, ...(counts ?? {}) },
        detail: suite.policy,
      }
      execution.result = {
        id: suite.id,
        status: execution.status,
        startedAt,
        finishedAt: now(),
        observations: [observation],
        gaps: [
          ...owning.gaps,
          ...(run.timedOut ? [`Suite exceeded ${options.timeoutMs}ms; entire child process group terminated`] : []),
          ...(run.launchError ? [run.launchError] : []),
          ...(run.cancelledSignal ? [`Controller received ${run.cancelledSignal}; terminated the active benchmark process group`] : []),
          ...(suite.kind === 'test' && !counts ? ['Owning test counts unavailable; inspect the run log'] : []),
          ...(suite.kind === 'script' ? ['Process completion is recorded; detailed per-input qualification remains in the owning suite artifacts.'] : []),
        ],
        artifacts: [execution.log, ...owning.artifacts],
        toolVersions: owning.toolVersions,
      }
    }
    writeUnifiedReport(options.out, report)
  }
  report.finishedAt = now()
  const active = report.suites.filter(suite => suite.selected)
  report.status = active.some(suite => suite.status === 'failed') ? 'failed' : active.some(suite => ['blocked', 'skipped', 'unsupported'].includes(suite.status)) ? 'incomplete' : 'passed'
  writeUnifiedReport(options.out, report)
  return report
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--worker-suite')) {
    assertBenchmarkExecutionAllowed()
    if (argv.length !== 4 || argv[0] !== '--worker-suite' || argv[2] !== '--worker-job' || !argv[1] || !argv[3]) throw new Error('Invalid internal suite worker invocation')
    const options = readJson(argv[3]) as SuiteOptions & { resultPath: string }
    try {
      admitSelectedArtifacts(options)
      const result = await runInternal(argv[1], options)
      writeBenchmarkDocument(options.resultPath, result)
      process.exitCode = result.status === 'failed' ? 1 : result.status === 'blocked' ? 2 : 0
    } catch (error) {
      const result: UnifiedSuiteResult = { id: argv[1], status: 'failed', startedAt: now(), finishedAt: now(), observations: [], gaps: [String(error)] }
      writeBenchmarkDocument(options.resultPath, result)
      console.error(error)
      process.exitCode = 1
    }
    return
  }
  if (argv.includes('--help')) {
    console.log(
      'bun run bench [--profile smoke|full] [--list] [--suites ID,...] [--out DIR] [--rounds N]\n  --target CHECKOUT --package-root INSTALLED_PACKAGE\n  --candidate-tarball FILE --candidate-sha256 HEX\n  --baseline DIRECTORY | --baseline-npm SELECTOR; --baseline-ref GIT_REF\n  --baseline-tarball FILE --baseline-sha256 HEX | --baseline-lock FILE\n  --site WEBSITE_PUBLIC --ownership-site FROZEN_ORIGINAL_CANDIDATE_DIR --executable CHROMIUM --bezel-dir VERIFIED_WRAPPER\n  --mermaid-dir PINNED_SOURCE --reference-dir INDEPENDENT_INSTALL\n  --upstream-runner-root ORIGINAL_VITEST_KIT --zenuml-root PINNED_REFERENCE_ADDON\n  --community-browser-prepared FROZEN_BROWSER_MANIFEST\n  --community-artifacts PEER_ADAPTER_MANIFEST --projects OWNER/PROJECT,...\n  --benchmark-records DIR --benchmark-force\n  --benchmark-resume-attempt COMPLETED_ATTEMPT_DIR (one project and retained suite)\n  --startup-samples N --startup-surfaces library,cli,mcp,browser\n  --node-executable NODE --bun-executable BUN --startup-observer GNU_TIME --native-executable AM\n  --live-provider anthropic|openai-compatible --live-model MODEL\n  --timeout-ms N --allow-incomplete --export-tables\nSmoke enrolls every family in bounded adapters; full selects every maintained suite, including Dave, current-reference tests and historical imported corpora. Missing prerequisites remain blocked. Exit: 0 complete, 1 failed, 2 incomplete. --allow-incomplete permits blocked suites but never failures.',
    )
    return
  }
  const options = parseOptions(argv),
    suites = benchmarkSuites(options)
  const unknown = options.selected?.filter(id => !suites.some(suite => suite.id === id))
  if (unknown?.length) throw new Error(`Unknown suites: ${unknown.join(', ')}`)
  if (options.list) {
    console.log(
      JSON.stringify(
        suites.map(suite => ({ ...suite, selected: options.selected ? options.selected.includes(suite.id) : suite.automatic !== false && (options.profile === 'full' || suite.smoke) })),
        null,
        2,
      ),
    )
    return
  }
  const report = await runUnified(options)
  console.log(`Unified benchmark ${report.status}: ${join(options.out, 'report.md')}`)
  process.exitCode = report.status === 'failed' ? 1 : report.status === 'incomplete' && !options.allowIncomplete ? 2 : 0
}
if (import.meta.main) await main()
