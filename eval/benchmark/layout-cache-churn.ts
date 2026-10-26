import { assertBenchmarkExecutionAllowed } from './ci-policy.ts'
// Separate bounded memory/churn experiment; never a renderer timing benchmark.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { artifactIdentity } from './layout-runtime-differential.ts'
import { cacheChurnGenerator, cacheChurnPopulation } from './cache-churn-population.ts'
import { layoutCacheEnvironment } from './release-bench-fidelity.ts'
import type { LayoutCache, MemoryResult } from './release-bench-types.ts'

type Observation = { population: number; round: number; arm: string; status: string; result?: MemoryResult; failure?: string }
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

export function churnRatios(rows: readonly Observation[], population: number, numerator: string, denominator: string, metric: keyof MemoryResult) {
  const rounds = Array.from({ length: 3 }, (_, index) => {
    const find = (arm: string) => rows.find(row => row.population === population && row.round === index + 1 && row.arm === arm && row.status === 'ok')?.result?.[metric]
    const a = find(numerator), b = find(denominator)
    return typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null
  })
  const valid = rounds.filter((value): value is number => value !== null).sort((a, b) => a - b)
  return { rounds, validRounds: valid.length, complete: valid.length === 3, median: valid.length ? valid[Math.floor(valid.length / 2)] : null }
}

function main() {
  const options = new Map<string, string>()
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1]
    if (!key || !['--candidate', '--baseline', '--out', '--population', '--layout-cache', '--budget-ms', '--diagnostic-source'].includes(key) || !value || options.has(key)) throw new Error(`Invalid argument ${key}`)
    options.set(key, value)
  }
  for (const key of ['--candidate', '--out', '--layout-cache']) if (!options.has(key)) throw new Error(`${key} is required`)
  if (options.has('--budget-ms') && options.get('--budget-ms') !== '480000') throw new Error('--budget-ms is fixed at480000 for the whole cache regime')
  const cache = options.get('--layout-cache')! as LayoutCache
  if (!['off', 'normal'].includes(cache)) throw new Error('--layout-cache requires off|normal')
  const populations = (options.get('--population') ?? '96,129,256').split(',').map(Number)
  if (new Set(populations).size !== populations.length || populations.some(count => ![96, 129, 256].includes(count))) throw new Error('Choose distinct populations from96,129,256')
  const out = resolve(options.get('--out')!)
  if (existsSync(out) && readdirSync(out).length) throw new Error(`Refusing nonempty output directory ${out}`)
  const candidate = artifactIdentity(options.get('--candidate')!), baseline = options.has('--baseline') ? artifactIdentity(options.get('--baseline')!) : undefined
  const arms = [
    { label: 'elk-reference', artifact: candidate, layoutMode: 'elk' },
    { label: 'elk-aa', artifact: candidate, layoutMode: 'elk' },
    { label: 'agentic', artifact: candidate, layoutMode: 'agentic' },
    { label: 'agentic-with-elk', artifact: candidate, layoutMode: 'agentic-with-elk' },
    ...(baseline ? [{ label: 'native23', artifact: baseline, layoutMode: 'agentic' }, { label: 'native23-aa', artifact: baseline, layoutMode: 'agentic' }] : []),
  ]
  mkdirSync(out, { recursive: true })
  const started = Date.now(), deadline = started + 480000, observations: Observation[] = []
  const diagnostic: Array<{ population: number; failure?: string; exitCode?: number | null; signal?: string | null; error?: string; stderr?: string | null; report?: string }> = []
  const metadata = { protocol: 'bounded-cache-churn@2', sourceRevision: process.env.GITHUB_SHA, startedAt: new Date(started).toISOString(),
    config: { populations, rounds: 3, layoutCache: cache, cacheEnvironment: layoutCacheEnvironment(cache), budgetMs: 480000, failurePolicy: 'no-retry; one shared deadline', arms },
    population: populations.map(count => { const inputs = cacheChurnPopulation(count); return { count, generator: cacheChurnGenerator(count), digest: sha(JSON.stringify(inputs)), inputs } }),
    worker: { path: join(import.meta.dir, 'release-bench-worker.ts'), sha256: sha(readFileSync(join(import.meta.dir, 'release-bench-worker.ts'), 'utf8')) },
    environment: { node: process.versions.node, bun: process.versions.bun, platform: process.platform, arch: process.arch },
    limitations: ['Memory-only: no call-latency claim.', 'Historical96 source generator is unchanged;129/256 use a declared new monotonic-width generator and cannot inherit historical96 comparison claims.',
      'Distinct source IDs do not establish distinct measured geometry. Actual key cardinality and evictions require the separately labelled source probe.',
      'RSS covers the worker lifetime; heap is estimated at GC boundaries; retained growth is one settled pass.',
      'Source hit counters are advisory and never combined with packaged memory estimates.'] }
  const save = (status: string, extra: Record<string, unknown> = {}) => writeFileSync(join(out, 'report.json'), `${JSON.stringify({ ...metadata, status, observations, diagnostic, ...extra }, null, 2)}\n`)
  save('running')
  try {
    for (const count of populations) for (let round = 1; round <= 3; round++) {
      const order = arms.slice((round - 1) % arms.length).concat(arms.slice(0, (round - 1) % arms.length))
      for (const arm of order) {
        const prefix = join(out, `${count}-${round}-${arm.label}`), row: Observation = { population: count, round, arm: arm.label, status: 'running' }
        observations.push(row); save('running')
        const job = { entry: arm.artifact.entry, mode: 'memory', inputs: cacheChurnPopulation(count), reps: 25, layoutMode: arm.layoutMode, layoutCache: cache, consumeReceipt: true }
        writeFileSync(`${prefix}.job.json`, JSON.stringify(job))
        const remaining = deadline - Date.now()
        if (remaining <= 0) { row.status = 'budget-exhausted'; row.failure = 'Shared cache-regime budget exhausted before launch'; save('running'); continue }
        const child = spawnSync('node', ['--expose-gc', '--no-warnings', metadata.worker.path, `${prefix}.job.json`, `${prefix}.json`], {
          cwd: resolve(import.meta.dir, '../..'), encoding: 'utf8', timeout: remaining, killSignal: 'SIGKILL', env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
        Object.assign(row, { exitCode: child.status, signal: child.signal, stderr: child.stderr, stdout: child.stdout })
        row.status = child.status === 0 ? 'ok' : child.error && 'code' in child.error && child.error.code === 'ETIMEDOUT' ? 'timeout' : 'worker-failed'
        if (child.status === 0) {
          try {
            const result = JSON.parse(readFileSync(`${prefix}.json`, 'utf8')) as MemoryResult
            if (result.perInput.length !== count || new Set(result.perInput.map(input => input.id)).size !== count) throw new Error('Incomplete memory population')
            row.result = result
          } catch (error) { row.status = 'result-invalid'; row.failure = String(error) }
        } else {
          row.failure = `${child.error?.message ?? `exit ${child.status ?? child.signal}`}: ${child.stderr}`
          if (existsSync(`${prefix}.json.progress.json`)) Object.assign(row, { lastProgress: JSON.parse(readFileSync(`${prefix}.json.progress.json`, 'utf8')) })
        }
        save('running')
      }
    }
    if (options.has('--diagnostic-source')) for (const count of populations) {
      const remaining = deadline - Date.now(), target = join(out, `source-counts-${count}`)
      // Leave the helper time to kill/reap its own child before the enclosing
      // process deadline; do not orphan a diagnostic render on outer timeout.
      if (remaining <= 5000) { diagnostic.push({ population: count, failure: 'shared cache-regime budget lacks source-probe teardown reserve' }); save('running'); continue }
      const child = spawnSync(process.execPath, [join(import.meta.dir, 'cache-churn-source.ts'), '--source-root', resolve(options.get('--diagnostic-source')!),
        '--out', target, '--population', String(count), '--layout-cache', cache, '--budget-ms', String(remaining - 5000)], {
        cwd: resolve(import.meta.dir, '../..'), encoding: 'utf8', timeout: remaining, killSignal: 'SIGKILL' })
      diagnostic.push({ population: count, exitCode: child.status, signal: child.signal, error: child.error?.message, stderr: child.stderr, report: join(target, 'report.json') }); save('running')
    }
    const metrics = ['passAllocatedBytes', 'passPeakHeapBytes', 'peakRssBytes', 'retainedGrowthBytes'] as const
    const pairs = [['elk-aa', 'elk-aa', 'elk-reference'], ['agentic-elk', 'agentic', 'elk-reference'], ['fallback-elk', 'agentic-with-elk', 'elk-reference'],
      ...(baseline ? [['native23-aa', 'native23-aa', 'native23'], ['native24-native23', 'agentic', 'native23']] : [])]
    const summary = populations.map(population => ({ population, comparisons: pairs.map(([name, numerator, denominator]) => ({ name,
      metrics: Object.fromEntries(metrics.map(metric => [metric, churnRatios(observations, population, numerator!, denominator!, metric)])) })) }))
    const finalCandidate = artifactIdentity(candidate.directory), finalBaseline = baseline ? artifactIdentity(baseline.directory) : undefined
    const artifactsUnchanged = candidate.sha256 === finalCandidate.sha256 && baseline?.sha256 === finalBaseline?.sha256
    const ok = artifactsUnchanged && observations.every(row => row.status === 'ok') && diagnostic.every(row => 'exitCode' in row && row.exitCode === 0)
    save('completed', { ok, summary, artifactsUnchanged }); if (!ok) process.exitCode = 1
  } catch (error) { save('failed', { ok: false, error: String(error) }); throw error }
}

if (import.meta.main) {
  assertBenchmarkExecutionAllowed()
  main()
}
