import { availableParallelism, cpus, totalmem } from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { benchmarkSuites, type SuiteDefinition, type SuiteOptions } from './suites.ts'
import { type SuiteExecution, type UnifiedReport, writeUnifiedReport } from './report.ts'
import type { BenchmarkObservation, UnifiedSuiteResult } from './types.ts'

const DRIVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const now = () => new Date().toISOString()
const readJson = (file: string): any => JSON.parse(readFileSync(file, 'utf8'))
const cleanText = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')
const bun = () => (process.versions.bun ? process.execPath : (process.env.BUN_BIN ?? 'bun'))

export interface RunnerOptions extends SuiteOptions {
  selected?: string[]
  timeoutMs: number
  list: boolean
  allowIncomplete: boolean
}
export function parseOptions(argv: string[]): RunnerOptions {
  const flags = new Set(['--list', '--allow-incomplete'])
  const allowed = new Set([
    'profile',
    'suites',
    'out',
    'rounds',
    'timeout-ms',
    'target',
    'package-root',
    'site',
    'ownership-site',
    'executable',
    'candidate-tarball',
    'candidate-sha256',
    'baseline',
    'baseline-ref',
    'baseline-npm',
    'baseline-tarball',
    'baseline-sha256',
    'baseline-lock',
    'bezel-dir',
    'mermaid-dir',
    'reference-dir',
    'live-provider',
    'live-model',
    'community-artifacts',
    'community-prepared',
    'community-inputs',
    'community-browser-prepared',
    'community-artifact-policy',
    'community-coverage',
  ])
  const options = new Map<string, string>()
  const seen = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    if (seen.has(flag)) throw new Error(`Duplicate option ${flag}`)
    seen.add(flag)
    if (flags.has(flag)) {
      options.set(flag.slice(2), 'true')
      continue
    }
    const key = flag.slice(2),
      value = argv[++i]
    if (!flag.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--')) throw new Error(`Invalid option ${flag}; use --help`)
    options.set(key, value)
  }
  const profile = options.get('profile') ?? 'smoke'
  if (profile !== 'smoke' && profile !== 'full') throw new Error('--profile must be smoke or full')
  const positive = (key: string, fallback: number) => {
    const value = Number(options.get(key) ?? fallback)
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${key} must be a positive integer`)
    return value
  }
  const path = (key: string) => (options.has(key) ? resolve(options.get(key)!) : undefined)
  const selected = options.get('suites')?.split(',')
  if (selected?.some(id => !id) || (selected && new Set(selected).size !== selected.length)) throw new Error('--suites needs unique nonempty comma-separated IDs')
  for (const name of ['candidate-sha256', 'baseline-sha256']) {
    const digest = options.get(name)
    if (digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`--${name} must be a lowercase SHA-256 artifact digest`)
    if (digest !== undefined && !options.has(name.replace('sha256', 'tarball'))) throw new Error(`--${name} requires its tarball path`)
  }
  if (options.has('baseline') && options.has('baseline-npm')) throw new Error('Use --baseline directory or --baseline-npm selector, not both')
  if (options.has('baseline-lock') && options.has('baseline-tarball')) throw new Error('Use --baseline-lock or --baseline-tarball, not both')
  const communityPolicy = options.get('community-artifact-policy') ?? 'latest',
    communityCoverage = options.get('community-coverage') ?? 'once'
  if (!['frozen', 'latest'].includes(communityPolicy) || !['once', 'repeated'].includes(communityCoverage)) throw Error('Invalid community artifact or coverage policy')
  const liveProvider = options.get('live-provider')
  if (liveProvider && !['anthropic', 'openai-compatible'].includes(liveProvider)) throw new Error('--live-provider must be anthropic or openai-compatible')
  return {
    root: path('target') ?? DRIVER,
    harnessRoot: DRIVER,
    packageRoot: path('package-root'),
    out: path('out') ?? resolve('bench-report/unified'),
    profile,
    rounds: positive('rounds', profile === 'smoke' ? 1 : 3),
    timeoutMs: positive('timeout-ms', profile === 'full' ? 4 * 60 * 60_000 : 30 * 60_000),
    selected,
    list: options.has('list'),
    allowIncomplete: options.has('allow-incomplete'),
    executable: path('executable'),
    site: path('site'),
    ownershipSite: path('ownership-site'),
    candidateTarball: path('candidate-tarball'),
    candidateSha256: options.get('candidate-sha256'),
    baseline: path('baseline'),
    baselineRef: options.get('baseline-ref'),
    baselineNpm: options.get('baseline-npm'),
    baselineTarball: path('baseline-tarball'),
    baselineSha256: options.get('baseline-sha256'),
    baselineLock: path('baseline-lock'),
    bezelDir: path('bezel-dir'),
    mermaidDir: path('mermaid-dir'),
    referenceDir: path('reference-dir'),
    liveProvider,
    liveModel: options.get('live-model'),
    communityArtifacts: path('community-artifacts'),
    communityPreparedFile: path('community-prepared'),
    communityInputsFile: path('community-inputs'),
    communityBrowserPreparedFile: path('community-browser-prepared'),
    communityArtifactPolicy: communityPolicy as 'frozen' | 'latest',
    communityCoverageOnce: communityCoverage === 'once',
  }
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
  for (const name of readdirSync(directory).filter(name => /(?:report|summary|editor-preview|editor-session|ownership|renderer-profile|qualification-status|gates)\.json$/.test(name))) {
    const file = join(directory, name)
    if (!statSync(file).isFile() || statSync(file).mtimeMs < notBefore - 1) continue
    artifacts.push(file)
    try {
      const value = readJson(file)
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const checks = Array.isArray(value.checks) ? value.checks.filter((check: any) => check.ok === false) : []
      if (value.status === 'failed' || value.ok === false || checks.length) {
        status = 'failed'
        gaps.push(`${name} declares failed qualification${checks.length ? ': ' + checks.map((check: any) => check.name ?? 'unnamed gate').join(', ') : ''}`)
      } else if (['incomplete', 'running', 'started'].includes(value.status)) {
        status ??= 'blocked'
        gaps.push(`${name} declares ${value.status}; process completion is not complete benchmark evidence`)
      }
    } catch (error) {
      status = 'failed'
      gaps.push(`Cannot read fresh owning report ${name}: ${String(error)}`)
    }
  }
  return { status, gaps, artifacts }
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
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch {}
  }
  let force: ReturnType<typeof setTimeout> | undefined
  const terminate = (signal: NodeJS.Signals) => {
    kill(signal)
    force ??= setTimeout(() => kill('SIGKILL'), 2000)
  }
  const onTerm = () => {
    cancelledSignal = 'SIGTERM'
    terminate('SIGTERM')
  }
  const onInt = () => {
    cancelledSignal = 'SIGINT'
    terminate('SIGINT')
  }
  process.once('SIGTERM', onTerm)
  process.once('SIGINT', onInt)
  const timer = setTimeout(() => {
    timedOut = true
    terminate('SIGTERM')
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
  process.off('SIGTERM', onTerm)
  process.off('SIGINT', onInt)
  await new Promise<void>(done => stream.end(done))
  return { ...result, elapsedMs: performance.now() - started, tail, timedOut, launchError, cancelledSignal }
}
async function runInternal(id: string, options: SuiteOptions): Promise<UnifiedSuiteResult> {
  const entry: Record<string, readonly [string, string]> = {
    family: ['family-suite.ts', 'runFamilySuite'],
    invocation: ['invocation.ts', 'runInvocationSuite'],
    community: ['community.ts', 'runCommunitySuite'],
    'pinned-reference-score': ['reference-score.ts', 'runReferenceScoreSuite'],
    'community-cli': ['community-cli.ts', 'runCommunityCliSuite'],
  }
  const [file, name] = entry[id] ?? []
  if (!file || !name) throw new Error(`No internal suite ${id}`)
  const module = await import(pathToFileURL(join(options.harnessRoot, 'eval/benchmark/unified', file)).href)
  if (typeof module[name] !== 'function') throw new Error(`${file} does not export ${name}`)
  return module[name](options)
}

/** The subprocess boundary prevents one failed or instrumented suite from
 * contaminating the next suite's runtime. Timers never run concurrently. */
export async function runUnified(options: RunnerOptions): Promise<UnifiedReport> {
  const catalog = benchmarkSuites(options),
    unknown = options.selected?.filter(id => !catalog.some(suite => suite.id === id))
  if (unknown?.length) throw new Error(`Unknown suites: ${unknown.join(', ')}`)
  if (options.list) throw new Error('Use benchmarkSuites() for read-only listing')
  mkdirSync(options.out, { recursive: true })
  const selected = new Set(options.selected ?? catalog.filter(suite => suite.automatic !== false && (options.profile === 'full' || suite.smoke)).map(suite => suite.id))
  const report: UnifiedReport = {
    schemaVersion: 1,
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
    const execution: SuiteExecution = { id: suite.id, title: suite.title, source: suite.source, policy: suite.policy, target: suite.target ?? (suite.kind === 'internal' ? 'candidate' : 'driver'), status: 'skipped', selected: selected.has(suite.id), prerequisites: suite.prerequisites, ...(suite.pin ? { pin: suite.pin } : {}) }
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
    const command = suite.kind === 'internal' ? ['bun', 'run', join(options.harnessRoot, 'eval/benchmark/unified/run.ts'), '--worker-suite', suite.id, '--worker-job', jobPath] : suite.command!
    if (suite.kind === 'internal' && existsSync(internalResult)) renameSync(internalResult, internalResult + `.previous-${Date.now()}`)
    if (suite.kind === 'internal') writeFileSync(jobPath, JSON.stringify({ ...options, out: suiteOut, resultPath: internalResult }, null, 2) + '\n')
    execution.command = command
    execution.workingDirectory = suite.cwd ?? options.harnessRoot
    execution.environment = suite.environment
    execution.log = `${suite.id.replaceAll(':', '-')}/run.log`
    console.log(`unified: ${suite.id} (${suite.kind === 'internal' ? options.root : suite.cwd ?? options.harnessRoot})`)
    const env: NodeJS.ProcessEnv = { ...process.env, AM_BENCH_SUITE_OUT: suiteOut, AM_FC_SEED: process.env.AM_FC_SEED ?? '7', ...suite.environment }
    if (options.mermaidDir) env.MERMAID_UPSTREAM_DIR = options.mermaidDir
    if (options.referenceDir) env.MERMAID_REFERENCE_DIR = options.referenceDir
    const startedAt = now(),
      evidenceNotBefore = Date.now(),
      run = await subprocess(command, suite.cwd ?? options.harnessRoot, env, join(options.out, execution.log), options.timeoutMs)
    cancelledSignal = run.cancelledSignal
    Object.assign(execution, { elapsedMs: run.elapsedMs, exitCode: run.code, signal: run.signal, timedOut: run.timedOut })
    execution.status = run.code === 0 && !run.timedOut && !run.launchError && !run.cancelledSignal ? 'passed' : 'failed'
    if (suite.kind === 'internal' && existsSync(internalResult)) {
      const result = readJson(internalResult) as UnifiedSuiteResult
      if (!Array.isArray(result.observations) || !Array.isArray(result.gaps)) throw new Error(`${suite.id} returned an invalid result envelope`)
      execution.result = result
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
          ...(run.cancelledSignal ? [`Controller received ${run.cancelledSignal}; forwarded to the active process group`] : []),
          ...(suite.kind === 'test' && !counts ? ['Owning test counts unavailable; inspect the run log'] : []),
          ...(suite.kind === 'script' ? ['Process completion is recorded; detailed per-input qualification remains in the owning suite artifacts.'] : []),
        ],
        artifacts: [execution.log, ...owning.artifacts],
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
    if (argv.length !== 4 || argv[0] !== '--worker-suite' || argv[2] !== '--worker-job' || !argv[1] || !argv[3]) throw new Error('Invalid internal suite worker invocation')
    const options = readJson(argv[3]) as SuiteOptions & { resultPath: string }
    try {
      const result = await runInternal(argv[1], options)
      writeFileSync(options.resultPath, JSON.stringify(result, null, 2) + '\n')
      process.exitCode = result.status === 'failed' ? 1 : result.status === 'blocked' ? 2 : 0
    } catch (error) {
      const result: UnifiedSuiteResult = { id: argv[1], status: 'failed', startedAt: now(), finishedAt: now(), observations: [], gaps: [String(error)] }
      writeFileSync(options.resultPath, JSON.stringify(result, null, 2) + '\n')
      console.error(error)
      process.exitCode = 1
    }
    return
  }
  if (argv.includes('--help')) {
    console.log(
      'bun run bench [--profile smoke|full] [--list] [--suites ID,...] [--out DIR] [--rounds N]\n  --target CHECKOUT --package-root INSTALLED_PACKAGE\n  --candidate-tarball FILE --candidate-sha256 HEX\n  --baseline DIRECTORY | --baseline-npm SELECTOR; --baseline-ref GIT_REF\n  --baseline-tarball FILE --baseline-sha256 HEX | --baseline-lock FILE\n  --site WEBSITE_PUBLIC --ownership-site FROZEN_ORIGINAL_CANDIDATE_DIR --executable CHROMIUM --bezel-dir VERIFIED_WRAPPER\n  --mermaid-dir PINNED_SOURCE --reference-dir INDEPENDENT_INSTALL\n  --community-artifacts PEER_ADAPTER_MANIFEST\n  --live-provider anthropic|openai-compatible --live-model MODEL\n  --timeout-ms N --allow-incomplete\nSmoke enrolls every family in bounded adapters; full selects every maintained suite, including Dave, current-reference tests and historical imported corpora. Missing prerequisites remain blocked. Exit: 0 complete, 1 failed, 2 incomplete. --allow-incomplete permits blocked suites but never failures.',
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
