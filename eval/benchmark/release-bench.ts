// Compare built packages in alternating fresh Node processes. Publication runs
// use --candidate-tarball: the measured bytes are the bytes queued for npm.
// Reports are generated evidence, never committed baselines.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { extractOfficialCorpus, officialCorpusInventory } from '../shared/official-fences.ts'
import { releaseBenchCases } from './release-bench-cases.ts'
import { agentEditCase, layoutCacheEnvironment } from './release-bench-fidelity.ts'
import { resolveBaseline } from './release-baseline.ts'
import type { BenchInput, LayoutCache, LayoutMode, LayoutObservation, MemoryResult, Outcome, OutputFingerprint, QualityObservation, TimeResult } from './release-bench-types.ts'

export interface Input extends BenchInput {
  kind: 'corpus' | 'scaling' | 'workflow'
}
export interface Group {
  name: string
  inputs: Input[]
  budgetMs: number
}
interface Identity {
  kind: 'directory' | 'npm' | 'tarball'
  requested: string
  sha256?: string
  integrity?: string
}
interface Engine {
  label: string
  entry: string
  version: string
  identity: Identity
  layoutMode?: LayoutMode
  layoutCache?: LayoutCache
  consumeReceipt?: boolean
}
interface Rendered {
  svg: Outcome
  ascii: OutputFingerprint
  deterministic: boolean
  validSvg: boolean
  mediansMs: number[]
  samplesMs: number[][]
  missingSvgLabels: string[]
  layout?: LayoutObservation
  asciiLayout?: LayoutObservation
  quality?: QualityObservation
}
export interface EngineRun extends Engine {
  node?: string
  importMs: number[]
  firstRenderMs: number[]
  firstRender?: OutputFingerprint
  firstLayout?: LayoutObservation
  coldDeterministic: boolean
  results: Map<string, Rendered>
  memory: Map<string, MemoryResult & { inputIds: string[] }>
  failures: Map<string, string>
}
interface Check {
  name: string
  ok: boolean | null
  detail: string
}
const ROOT = resolve(import.meta.dir, '..', '..')
const WORKER = join(import.meta.dir, 'release-bench-worker.ts')
const GATES = { corpusSlowdown: 1.25, familySlowdown: 1.5, caseSlowdown: 1.5, allocationGrowth: 1.25, rssGrowth: 1.25, retainedGrowthBytes: 16 * 1024 * 1024 }
const CORPUS_BUDGET_MS = 30 * 60 * 1000
const CASE_BUDGET_MS = 10 * 60 * 1000
const DEFAULT_BUDGET_MS = 70 * 60 * 1000

export function releaseBenchArgs(argv = process.argv.slice(2)): Map<string, string> {
  const allowed = new Set(['out', 'rounds', 'reps', 'budget-ms', 'baseline', 'baseline-npm', 'baseline-lock', 'candidate', 'candidate-tarball', 'candidate-sha256', 'case', 'layout-modes', 'layout-cache', 'layout-reference'])
  const options = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!.slice(2)
    const value = argv[++i]
    if (!argv[i - 1]!.startsWith('--') || !allowed.has(key)) throw new Error(`Unknown option ${argv[i - 1]}`)
    if (!value || value.startsWith('--') || options.has(key)) throw new Error(`Provide one value for --${key}`)
    options.set(key, value)
  }
  for (const [a, b] of [
    ['baseline', 'baseline-npm'],
    ['candidate', 'candidate-tarball'],
  ] as const) {
    if (options.has(a) && options.has(b)) throw new Error(`Use only one of --${a} and --${b}`)
  }
  if (options.has('candidate-sha256') && (!options.has('candidate-tarball') || !/^[a-f0-9]{64}$/.test(options.get('candidate-sha256')!))) {
    throw new Error('--candidate-sha256 requires --candidate-tarball and a lowercase SHA-256 digest')
  }
  if (options.has('baseline-lock') && !options.has('baseline-npm')) throw new Error('--baseline-lock requires --baseline-npm')
  if (options.has('layout-modes')) {
    const modes = options.get('layout-modes')!.split(',').map(value => value.trim())
    if (modes.some(mode => !['elk', 'agentic', 'agentic-with-elk'].includes(mode)) || new Set(modes).size !== modes.length) {
      throw new Error('--layout-modes requires distinct comma-separated elk,agentic,agentic-with-elk modes')
    }
    options.set('layout-modes', modes.join(','))
  }
  if (options.has('layout-cache') && (!options.has('layout-modes') || !['off', 'normal'].includes(options.get('layout-cache')!))) {
    throw new Error('--layout-cache requires --layout-modes and one of off|normal')
  }
  if (options.has('layout-reference') && (!options.has('layout-modes') || !['separate', 'shared'].includes(options.get('layout-reference')!))) {
    throw new Error('--layout-reference requires --layout-modes and one of separate|shared')
  }
  return options
}

/** Each arm has its own matched population; a partial owned backend cannot
 * shrink the ELK/fallback arm's memory or release-gate population. */
export function layoutComparisons(engines: Engine[], modes: LayoutMode[], cache: LayoutCache) {
  const candidate = engines.at(-1)!
  const reference: Engine = { ...candidate, label: 'elk-reference', layoutMode: 'elk', layoutCache: cache, consumeReceipt: true }
  const plans = [{
    name: 'elk-aa', advisory: false,
    engines: [reference, { ...reference, label: 'elk-aa' }],
  }]
  for (const mode of modes) {
    if (mode === 'elk') continue // The same-artifact A/A pair is the ELK arm.
    plans.push({ name: mode, advisory: mode === 'agentic', engines: [reference, { ...reference, label: mode, layoutMode: mode }] })
  }
  if (engines.length > 1) plans.push({
    name: 'external-baseline', advisory: false,
    // Earlier releases cannot admit the new selector; their established
    // default is compared with this package's explicit ELK path.
    engines: [{ ...engines[0]!, consumeReceipt: true, layoutCache: cache }, { ...reference, label: 'candidate-elk' }],
  })
  return plans
}

export function layoutCoverage(inputs: Input[], run: EngineRun) {
  const statuses = inputs.map(input => {
    const result = run.results.get(input.id)
    const decisions = result?.layout?.decisions ?? []
    const status = !result ? 'unmeasured' : !result.svg.ok ? result.svg.category ?? 'error'
      : decisions.some(decision => decision.requested === 'agentic' && decision.selected === 'elk') ? 'elk-fallback'
        : decisions.some(decision => decision.selected === 'agentic') ? 'agentic'
          : decisions.length ? 'elk' : 'not-applicable'
    return { id: input.id, family: input.family, status }
  })
  return { enrolled: inputs.length, statuses, byFamily: [...new Set(inputs.map(input => input.family))].sort().map(family => ({
    family, enrolled: statuses.filter(row => row.family === family).length,
    counts: Object.fromEntries([...new Set(statuses.map(row => row.status))].map(status => [status, statuses.filter(row => row.family === family && row.status === status).length])),
  })), quality: {
    measured: inputs.filter(input => run.results.get(input.id)?.quality?.status === 'measured').length,
    unavailable: inputs.filter(input => run.results.get(input.id)?.quality?.status === 'unavailable').length,
    scope: 'separate public layout after timing; unavailable dimensions are explicit',
  }, eligibility: 'reported by typed declines and actual decisions, not inferred as production share' }
}

/** The strict arm's full-coverage/speed gates are advisory while support is
 * partial. New defects, content loss and incomplete measurement still fail. */
export function strictLayoutHealthy(inputs: Input[], runs: EngineRun[], rounds: number): boolean {
  const baseline = runs[0]!, candidate = runs.at(-1)!
  if (runs.some(run => run.failures.size > 0 || !run.coldDeterministic)) return false
  return inputs.every(input => {
    const result = candidate.results.get(input.id), before = baseline.results.get(input.id)
    if (!result || !before || result.mediansMs.length !== rounds || before.mediansMs.length !== rounds
      || !result.deterministic || !before.deterministic || result.missingSvgLabels.length) return false
    if (result.svg.ok && !result.validSvg && !(before.svg.ok && !before.validSvg)) return false
    const acceptable = (current: OutputFingerprint, prior: OutputFingerprint) => current.ok
      || current.category === 'unsupported' || current.category === 'candidate-rejected' || (!prior.ok && same(current, prior))
    return acceptable(fingerprint(result.svg), fingerprint(before.svg)) && acceptable(result.ascii, before.ascii)
  })
}
function positive(options: Map<string, string>, key: string, fallback: number): number {
  const value = Number(options.get(key) ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${key} must be a positive integer`)
  return value
}
function packageAt(dir: string, label: string, identity: Identity): Engine {
  const entry = join(dir, 'dist', 'index.js')
  if (!existsSync(entry)) throw new Error(`${label}: ${entry} does not exist; build the package first`)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string }
  if (pkg.name !== 'agentic-mermaid') throw new Error(`${label}: expected agentic-mermaid, got ${pkg.name}`)
  return { label, entry, version: pkg.version, identity }
}
const fingerprint = (outcome: Outcome): OutputFingerprint => {
  const text = outcome.ok ? outcome.output : outcome.error
  return { ok: outcome.ok, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text),
    ...(!outcome.ok ? { error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}), ...(outcome.category ? { category: outcome.category } : {}) } : {}) }
}
const same = (a: OutputFingerprint, b: OutputFingerprint) => a.ok === b.ok && a.sha256 === b.sha256 && a.bytes === b.bytes
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const ratio = (a: number | undefined, b: number | undefined) => (a !== undefined && b !== undefined && b > 0 ? a / b : undefined)
const ms = (n: number | undefined) => (n === undefined ? '—' : `${n.toFixed(n < 10 ? 2 : 0)} ms`)
const mb = (n: number | undefined) => (n === undefined ? '—' : `${(n / 1024 / 1024).toFixed(1)} MiB`)
const times = (n: number | undefined) => (n === undefined ? '—' : `${n.toFixed(2)}×`)
function parsesAsSvg(svg: string): boolean {
  try {
    new Resvg(svg, { font: { loadSystemFonts: false } })
    return true
  } catch {
    return false
  }
}
function successful(run: EngineRun, input: Input, rounds: number): boolean {
  const result = run.results.get(input.id)
  return !!result?.svg.ok && result.validSvg && result.deterministic && !result.missingSvgLabels.length && result.mediansMs.length === rounds
}

export type MeasurementWorker = (run: EngineRun, mode: 'time' | 'memory', group: Group, round?: number) => TimeResult | MemoryResult | undefined

function freshRuns(engines: Engine[]): EngineRun[] {
  return engines.map(engine => ({ ...engine, importMs: [], firstRenderMs: [], coldDeterministic: true, results: new Map(), memory: new Map(), failures: new Map() }))
}

function measurementWorker(out: string, reps: number, deadline: number): MeasurementWorker {
  const record = (value: unknown) => appendFileSync(join(out, 'samples.jsonl'), `${JSON.stringify(value)}\n`)
  function worker(run: EngineRun, mode: 'time' | 'memory', group: Group, round?: number): TimeResult | MemoryResult | undefined {
    const budgetMs = Math.min(group.budgetMs, deadline - Date.now())
    let reason: string | undefined, workerWallMs: number | undefined
    if (budgetMs <= 0) reason = 'overall benchmark budget exhausted'
    else {
      const job = join(out, 'job.json')
      const result = join(out, 'result.json')
      rmSync(result, { force: true })
      rmSync(`${result}.progress.json`, { force: true })
      writeFileSync(job, JSON.stringify({ entry: run.entry, mode, inputs: group.inputs, reps, layoutMode: run.layoutMode, layoutCache: run.layoutCache, consumeReceipt: run.consumeReceipt,
        collectQuality: run.consumeReceipt && mode === 'time' && round === 1 }))
      // Time ELK rather than a cached result, and renders as users get them.
      const workerStart = performance.now()
      const child = spawnSync('node', [...(mode === 'memory' ? ['--expose-gc'] : []), '--no-warnings', WORKER, job, result], { stdio: 'inherit', timeout: budgetMs, killSignal: 'SIGKILL', env: {
        ...process.env, AGENTIC_MERMAID_ELK_CACHE: run.layoutCache === 'normal' ? '1' : '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0',
      } })
      workerWallMs = performance.now() - workerStart
      if (child.status === 0) {
        const value = JSON.parse(readFileSync(result, 'utf8')) as TimeResult | MemoryResult
        const evidence =
          mode === 'time'
            ? {
                ...value,
                results: (value as TimeResult).results.map(({ svg, ...rest }) => ({ ...rest, svg: fingerprint(svg) })),
              }
            : value
        record({ engine: run.label, group: group.name, mode, round, inputIds: group.inputs.map(input => input.id), workerBudgetMs: budgetMs, workerWallMs, value: evidence })
        return value
      }
      reason = child.error?.message ?? `exited with ${child.status ?? child.signal}`
      let progress: unknown
      try { progress = JSON.parse(readFileSync(`${result}.progress.json`, 'utf8')) } catch { /* Early startup failure may precede the first breadcrumb. */ }
      if (progress && typeof progress === 'object' && 'stage' in progress && typeof progress.stage === 'string') {
        const inputId = 'inputId' in progress && typeof progress.inputId === 'string' ? ` (${progress.inputId})` : ''
        reason += `; last worker stage: ${progress.stage}${inputId}; result ${existsSync(result) ? 'written' : 'missing'}`
      }

    }
    run.failures.set(`${mode}:${group.name}`, reason)
    record({ engine: run.label, group: group.name, mode, round, workerBudgetMs: Math.max(0, budgetMs), workerWallMs, failure: reason })
    return undefined
  }
  return worker
}

function measureTiming(runs: EngineRun[], groups: Group[], rounds: number, deadline: number, worker: MeasurementWorker, rotate = false): void {
  for (let round = 0; round < rounds; round++) {
    const order = rotate ? runs.slice(round % runs.length).concat(runs.slice(0, round % runs.length))
      : round % 2 === 0 ? runs : [...runs].reverse()
    for (const group of groups) {
      for (const run of order) {
        if (run.failures.has(`time:${group.name}`)) continue
        console.log(`round ${round + 1}/${rounds}: ${run.label} ${run.version} ${group.name}`)
        const value = worker(run, 'time', group, round + 1) as TimeResult | undefined
        if (!value) continue
        run.node = value.node
        run.importMs.push(value.importMs)
        run.firstRenderMs.push(value.firstRenderMs)
        run.coldDeterministic &&= !run.firstRender || same(run.firstRender, value.firstRender)
        run.firstRender ??= value.firstRender
        if (run.firstLayout && value.firstLayout) run.coldDeterministic &&= same(run.firstLayout.receipt, value.firstLayout.receipt)
        run.firstLayout ??= value.firstLayout
        for (const { id, svg, ascii, deterministic, ms: elapsed, samplesMs, missingSvgLabels, layout, asciiLayout, quality } of value.results) {
          const previous = run.results.get(id)
          if (previous) {
            previous.deterministic &&= deterministic && same(fingerprint(previous.svg), fingerprint(svg)) && same(previous.ascii, ascii)
            if (layout && previous.layout) previous.deterministic &&= same(layout.receipt, previous.layout.receipt)
            if (asciiLayout && previous.asciiLayout) previous.deterministic &&= same(asciiLayout.receipt, previous.asciiLayout.receipt)
            previous.mediansMs.push(elapsed)
            previous.samplesMs.push(samplesMs)
            previous.missingSvgLabels = [...new Set([...previous.missingSvgLabels, ...missingSvgLabels])]
            if (quality) previous.quality = quality
          } else run.results.set(id, { svg, ascii, deterministic, validSvg: svg.ok && parsesAsSvg(svg.output), mediansMs: [elapsed], samplesMs: [samplesMs], missingSvgLabels, ...(layout ? { layout } : {}), ...(asciiLayout ? { asciiLayout } : {}), ...(quality ? { quality } : {}) })
        }
      }
    }
    if (Date.now() >= deadline || runs.every(run => groups.every(group => run.failures.has(`time:${group.name}`)))) break
  }
}

function measureMemory(runs: EngineRun[], groups: Group[], rounds: number, worker: MeasurementWorker): void {
  // A fresh memory process sees only the common, stable successful population.
  // Unsupported inputs and newly supported families cannot skew its caches/RSS.
  for (const group of groups) {
    const inputs = group.inputs.filter(input => runs.every(run => successful(run, input, rounds)))
    if (!inputs.length) continue
    for (const run of runs) {
      console.log(`memory: ${run.label} ${run.version} ${group.name} (${inputs.length} shared inputs)`)
      const value = worker(run, 'memory', { ...group, inputs }) as MemoryResult | undefined
      if (value) run.memory.set(group.name, { ...value, inputIds: inputs.map(input => input.id) })
    }
  }
  const candidate = runs.at(-1)!
  const corpus = groups.find(group => group.name === 'corpus')
  const candidateInputs = corpus?.inputs.filter(input => successful(candidate, input, rounds)) ?? []
  const matchedCount = corpus?.inputs.filter(input => runs.every(run => successful(run, input, rounds))).length ?? 0
  if (corpus && candidateInputs.length && candidateInputs.length !== matchedCount) {
    console.log(`memory: candidate ${candidate.version} full successful corpus (${candidateInputs.length} inputs)`)
    const value = worker(candidate, 'memory', { ...corpus, name: 'candidate-corpus', inputs: candidateInputs }) as MemoryResult | undefined
    if (value) candidate.memory.set('candidate-corpus', { ...value, inputIds: candidateInputs.map(input => input.id) })
  }
}

function cleanMeasurement(out: string): void {
  rmSync(join(out, 'job.json'), { force: true })
  rmSync(join(out, 'result.json'), { force: true })
}

function measure(out: string, engines: Engine[], groups: Group[], rounds: number, reps: number, deadline: number): EngineRun[] {
  const runs = freshRuns(engines), worker = measurementWorker(out, reps, deadline)
  measureTiming(runs, groups, rounds, deadline, worker)
  measureMemory(runs, groups, rounds, worker)
  cleanMeasurement(out)
  return runs
}

/** One fresh reference observation can serve both independent comparisons.
 * Memory is still paired separately: a strict decline must never narrow A/A
 * or fallback coverage, and failed observations are never retried. */
export function measureLayoutComparisons(
  out: string, plans: ReturnType<typeof layoutComparisons>, groups: Group[], rounds: number, reps: number, deadline: number,
  execute?: MeasurementWorker,
): Array<{ name: string; runs: EngineRun[] }> {
  mkdirSync(out, { recursive: true })
  const engines = [...new Set(plans.flatMap(plan => plan.engines))]
  if (new Set(engines.map(engine => engine.label)).size !== engines.length) throw new Error('Layout arm labels must be unique')
  appendFileSync(join(out, 'samples.jsonl'), `${JSON.stringify({ protocol: 'shared-layout-reference@1', engines, rounds, reps, timingOrder: 'rotating-fresh-arms', memoryReuse: 'identical-ordered-populations', failurePolicy: 'no-retry' })}\n`)
  const runs = freshRuns(engines), worker = execute ?? measurementWorker(out, reps, deadline)
  measureTiming(runs, groups, rounds, deadline, worker, true)
  const byEngine = new Map(engines.map((engine, index) => [engine, runs[index]!]))
  const memory = new Map<string, { value?: MemoryResult; failure?: string }>()
  const pairedWorker: MeasurementWorker = (run, mode, group, round) => {
    if (mode === 'time') return worker(run, mode, group, round)
    const key = JSON.stringify([run.label, group.name, group.inputs.map(input => input.id)])
    const prior = memory.get(key)
    if (prior) {
      if (prior.failure) run.failures.set(`memory:${group.name}`, prior.failure)
      appendFileSync(join(out, 'samples.jsonl'), `${JSON.stringify({ engine: run.label, group: group.name, mode: 'memory-reuse', inputIds: group.inputs.map(input => input.id), failure: prior.failure })}\n`)
      return prior.value
    }
    const value = worker(run, mode, group) as MemoryResult | undefined
    const failure = value ? undefined : run.failures.get(`memory:${group.name}`) ?? 'memory worker returned no result'
    if (failure) run.failures.set(`memory:${group.name}`, failure)
    memory.set(key, { value, failure })
    return value
  }
  const pairs = plans.map(plan => {
    const pair = plan.engines.map(engine => {
      const run = byEngine.get(engine)!
      return { ...run, memory: new Map(), failures: new Map(run.failures) }
    })
    measureMemory(pair, groups, rounds, pairedWorker)
    return { name: plan.name, runs: pair }
  })
  cleanMeasurement(out)
  return pairs
}

export function report(inputs: Input[], groups: Group[], runs: EngineRun[], rounds: number, control = false) {
  const limits = control ? { ...GATES, corpusSlowdown: 1.1, familySlowdown: 1.1, caseSlowdown: 1.1, allocationGrowth: 1.1, rssGrowth: 1.1 } : GATES
  const outside = (value: number, limit: number): boolean => value > limit || (control && value < 1 / limit)
  const bound = (subject: string, limit: number): string => control ? `${subject} within reciprocal ${limit}×` : `${subject} ≤ ${limit}× baseline`
  const candidate = runs.at(-1)!
  const baseline = runs.length > 1 ? runs[0]! : undefined
  const measured = (list: Input[]) => list.filter(input => runs.every(run => run.results.get(input.id)?.mediansMs.length === rounds))
  const shared = (list: Input[]) => list.filter(input => runs.every(run => successful(run, input, rounds)))
  // Aggregate the same rep/round before comparing engines. A sum of independent
  // per-input medians is not an observed corpus pass and loses round covariance.
  const roundTotals = (run: EngineRun, list: Input[]) => list.length ? Array.from({ length: rounds }, (_, round) => {
    const samples = list.map(input => run.results.get(input.id)!.samplesMs[round]!)
    return median(samples[0]!.map((_, rep) => sum(samples.map(values => values[rep]!))))!
  }) : []
  const total = (run: EngineRun, list: Input[]) => list.length ? median(roundTotals(run, list)) : undefined
  const timeRatio = (list: Input[]) => baseline && list.length ? median(roundTotals(candidate, list).map((value, round) => value / roundTotals(baseline, list)[round]!)) : undefined
  const corpus = inputs.filter(input => input.kind === 'corpus')
  const scaling = inputs.filter(input => input.kind !== 'corpus')
  const checks: Check[] = []
  const addRatio = (name: string, value: number | undefined, limit: number) => checks.push({ name, ok: value === undefined ? null : !outside(value, limit), detail: value === undefined ? 'not compared: no matched measurement' : times(value) })
  const incomplete = inputs.filter(input => candidate.results.get(input.id)?.mediansMs.length !== rounds)
  checks.push({ name: 'Every candidate measurement completes', ok: candidate.failures.size === 0 && !incomplete.length, detail: [...candidate.failures].map(([group, reason]) => `${group}: ${reason}`).join('; ') || `${inputs.length - incomplete.length}/${inputs.length} inputs completed ${rounds} rounds` })
  checks.push({ name: 'Cold SVG render succeeds', ok: candidate.firstRender?.ok === true, detail: candidate.firstRender?.error ?? (candidate.firstRender?.ok ? 'flowchart rendered' : 'not measured') })
  const unstable = [...candidate.results].filter(([, result]) => !result.deterministic).map(([id]) => id)
  checks.push({ name: 'Deterministic SVG and ASCII output', ok: candidate.coldDeterministic && !unstable.length, detail: unstable.join(', ') || (candidate.coldDeterministic ? 'all repeats and fresh processes agree' : 'cold renders differ between processes') })
  const invalid = [...candidate.results].filter(([id, result]) => result.svg.ok && !result.validSvg && !(baseline?.results.get(id)?.svg.ok && !baseline.results.get(id)!.validSvg)).map(([id]) => id)
  checks.push({ name: 'No newly invalid SVGs (resvg)', ok: !invalid.length, detail: invalid.join(', ') || 'none; existing baseline parse failures are excluded from comparisons' })
  const missingContent = [...candidate.results].filter(([, result]) => result.missingSvgLabels.length)
  checks.push({ name: 'Expected SVG labels survive rendering', ok: !missingContent.length, detail: missingContent.map(([id, result]) => `${id}: ${result.missingSvgLabels.join(', ')}`).join('; ') || 'all enrolled label assertions pass' })
  const failedWorkloads = scaling.filter(input => !successful(candidate, input, rounds))
  checks.push({ name: 'Every scaling and agent workflow succeeds', ok: !failedWorkloads.length, detail: failedWorkloads.map(input => input.id).join(', ') || `${scaling.length} workloads passed` })
  if (baseline) {
    const incompleteBaseline = inputs.filter(input => baseline.results.get(input.id)?.mediansMs.length !== rounds)
    checks.push({ name: 'Every required baseline measurement completes', ok: baseline.failures.size === 0 && !incompleteBaseline.length, detail: [...baseline.failures].map(([group, reason]) => `${group}: ${reason}`).join('; ') || `${inputs.length - incompleteBaseline.length}/${inputs.length} inputs completed ${rounds} rounds` })
    checks.push({ name: 'Baseline has comparable successful SVG measurements', ok: shared(inputs).length > 0 && (!corpus.length || shared(corpus).length > 0), detail: `${shared(inputs).length}/${inputs.length} total; ${shared(corpus).length}/${corpus.length} corpus inputs compared` })
    for (const format of ['svg', 'ascii'] as const) {
      const lost = measured(inputs).filter(input => baseline.results.get(input.id)![format].ok && !candidate.results.get(input.id)![format].ok)
      checks.push({ name: `No lost ${format.toUpperCase()} renders`, ok: !lost.length, detail: lost.map(input => input.id).join(', ') || 'none' })
    }
    addRatio(bound('Corpus render time', limits.corpusSlowdown), timeRatio(shared(corpus)), limits.corpusSlowdown)
    const slowFamilies = [...new Set(corpus.map(input => input.family))].filter(family => {
      const list = shared(corpus.filter(input => input.family === family))
      return list.length && outside(timeRatio(list)!, limits.familySlowdown)
    })
    checks.push({ name: bound('Each compared family', limits.familySlowdown), ok: !slowFamilies.length, detail: slowFamilies.join(', ') || 'no family regression on shared successes' })
    const comparable = shared(scaling)
    const slow = comparable.filter(input => outside(timeRatio([input])!, limits.caseSlowdown))
    checks.push({ name: bound('Each large case', limits.caseSlowdown), ok: comparable.length ? !slow.length : null, detail: `${comparable.length}/${scaling.length} compared${slow.length ? `; slow: ${slow.map(input => input.id).join(', ')}` : ''}` })
    const before = baseline.memory.get('corpus')
    const after = candidate.memory.get('corpus')
    if (shared(corpus).length) checks.push({ name: 'Required matched corpus memory measurements complete', ok: !!before && !!after, detail: before && after ? `${before.inputIds.length} shared inputs` : 'incomplete: missing baseline or candidate memory observations' })
    addRatio(bound('Corpus allocation', limits.allocationGrowth), ratio(after?.passAllocatedBytes, before?.passAllocatedBytes), limits.allocationGrowth)
    addRatio(bound('Corpus peak RSS', limits.rssGrowth), ratio(after?.peakRssBytes, before?.peakRssBytes), limits.rssGrowth)
  }
  if (control) {
    const sameOutput = (a: Outcome, b: Outcome): boolean => a.ok ? b.ok && a.output === b.output : !b.ok && a.error === b.error && a.code === b.code
    const sameReceipt = (a?: LayoutObservation, b?: LayoutObservation): boolean => a && b ? same(a.receipt, b.receipt) : a === b
    const different = inputs.filter(input => {
      const a = baseline?.results.get(input.id), b = candidate.results.get(input.id)
      return !a || !b || !sameOutput(a.svg, b.svg) || !same(a.ascii, b.ascii)
        || !sameReceipt(a.layout, b.layout) || !sameReceipt(a.asciiLayout, b.asciiLayout)
    }).map(input => input.id)
    checks.push({ name: 'ELK A/A uses one artifact with identical output and receipts',
      ok: runs.length === 2 && baseline?.entry === candidate.entry && Boolean(baseline?.firstRender && candidate.firstRender && same(baseline.firstRender, candidate.firstRender)) && !different.length,
      detail: different.join(', ') || 'same entry, cold output, SVG/ASCII and complete receipt fingerprints' })
  }
  const memory = candidate.memory.get('candidate-corpus') ?? candidate.memory.get('corpus')
  checks.push({
    name: `Retained heap growth per corpus pass ≤ ${mb(GATES.retainedGrowthBytes)}`,
    ok: memory ? memory.retainedGrowthBytes <= GATES.retainedGrowthBytes : null,
    detail: memory ? `${mb(memory.retainedGrowthBytes)} across ${memory.inputIds.length} successful candidate inputs` : 'not measured: no successful corpus inputs',
  })
  const ok = checks.every(check => check.ok !== false)
  const md = [`# Release benchmark: ${ok ? 'pass' : 'FAIL'}`, '', `Engines: ${runs.map(run => `${run.label} ${run.version}`).join(' vs ')}. Inputs: ${corpus.length} distinct official examples and ${scaling.length} scaling/agent workloads. Full upstream fence accounting is in corpus.json; browser/competitor results are advisory in browser-report.md.`, '', '| Gate | Result | Detail |', '|---|---|---|']
  for (const check of checks) md.push(`| ${check.name} | ${check.ok === null ? 'not compared' : check.ok ? 'pass' : '**FAIL**'} | ${check.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
  if (baseline?.failures.size) md.push('', `Baseline measurements unavailable: ${[...baseline.failures].map(([group, reason]) => `${group}: ${reason}`).join('; ')}.`, '')
  if (candidate.consumeReceipt) {
    const coverage = layoutCoverage(inputs, candidate)
    md.push('', `Layout arm: ${candidate.layoutMode ?? 'legacy default'}; geometry cache: ${candidate.layoutCache ?? 'off'}. Timed operations include the public SVG receipt, complete UTF-8 SVG encoding and JSON receipt serialization. Quality observations rerun the public layout projection after all timing in round one; they are not the retained timed SVG. ${coverage.quality.measured}/${inputs.length} quality projections measured; ${coverage.quality.unavailable} explicitly unavailable. Full preference scores are not exposed by this public projection.`, '',
      '| Family | Enrolled | Actual outcomes |', '|---|---:|---|')
    for (const row of coverage.byFamily) md.push(`| ${row.family} | ${row.enrolled} | ${Object.entries(row.counts).map(([status, count]) => `${status}: ${count}`).join('; ')} |`)
    if (baseline) {
      const valueOf = (run: EngineRun, input: Input, field: string): number | undefined => {
        const quality = run.results.get(input.id)?.quality
        if (quality?.status !== 'measured' || !quality.metrics || typeof quality.metrics !== 'object') return undefined
        const metrics = quality.metrics as Record<string, unknown>
        const value = field === 'labelConflicts' && metrics.labelConflicts && typeof metrics.labelConflicts === 'object'
          ? (metrics.labelConflicts as Record<string, unknown>).total
          : (field === 'opposingOverlaps' || field === 'parallelOverlaps') && metrics.routeOverlaps && typeof metrics.routeOverlaps === 'object'
            ? (metrics.routeOverlaps as Record<string, unknown>)[field === 'opposingOverlaps' ? 'opposing' : 'parallel'] : metrics[field]
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined
      }
      const pairedQuality = shared(inputs).filter(input => baseline.results.get(input.id)?.quality?.status === 'measured' && candidate.results.get(input.id)?.quality?.status === 'measured')
      const changed = pairedQuality.filter(input => ['edgeCrossings', 'labelConflicts', 'opposingOverlaps', 'parallelOverlaps', 'labelLegibility', 'minimumNodeSpacing', 'aspectRatio'].some(field => valueOf(baseline, input, field) !== valueOf(candidate, input, field)))
      const shown = [...pairedQuality.filter(input => input.kind !== 'corpus'), ...changed.filter(input => input.kind === 'corpus')].slice(0, 25)
      md.push('', '## Separate public-layout quality observations', '', `${pairedQuality.length}/${inputs.length} matched successful inputs have quality vectors in both arms; ${changed.length} differ on the fields below. Showing up to 25 scaling/changed inputs; complete per-input vectors and unavailable reasons remain in report.json. These projections rerun layout after timing and do not establish human preference.`, '',
        '| Input | Proper crossings | Padded label conflicts | Opposing / same-endpoint shared spans | Label fit fraction | Minimum node gap | Aspect ratio |', '|---|---:|---:|---|---:|---:|---:|')
      for (const input of shown) {
        const pair = (field: string) => [valueOf(baseline, input, field), valueOf(candidate, input, field)].map(value => value === undefined ? 'unavailable' : Number.isInteger(value) ? String(value) : value.toFixed(3)).join(' → ')
        md.push(`| ${input.id} | ${pair('edgeCrossings')} | ${pair('labelConflicts')} | ${pair('opposingOverlaps')} / ${pair('parallelOverlaps')} | ${pair('labelLegibility')} | ${pair('minimumNodeSpacing')} | ${pair('aspectRatio')} |`)
      }
    }
  }
  md.push(
    '',
    '## Matched successful SVG renders',
    '',
    'All time, allocation and RSS comparisons use the same stable, parseable SVG inputs in both engines. Rejections are excluded. Counts of rendered SVGs include every measured input; newly supported inputs are reported without a speed comparison.',
    '',
    '| Family / case | Measured | SVG renders (base → cand) | Changed SVGs | Compared | Time (base → cand) | Speed-up | Allocated (base → cand) |',
    '|---|---|---|---|---|---|---|---|',
  )
  const allocation = (run: EngineRun, list: Input[]) => {
    const heaps = [...run.memory.values()].flatMap(value => value.perInput)
    const selected = list.map(input => heaps.find(heap => heap.id === input.id))
    return selected.length && selected.every(Boolean) ? sum(selected.map(heap => heap!.allocatedBytes)) : undefined
  }
  const row = (name: string, list: Input[]) => {
    const comparable = shared(list)
    const rendered = (run: EngineRun | undefined) => (run ? list.filter(input => run.results.get(input.id)?.svg.ok).length : '—')
    const changed = baseline
      ? measured(list).filter(input => {
          const before = baseline.results.get(input.id)!.svg
          const after = candidate.results.get(input.id)!.svg
          return (before.ok || after.ok) && !same(fingerprint(before), fingerprint(after))
        }).length
      : '—'
    md.push(
      `| ${name} | ${measured(list).length}/${list.length} | ${rendered(baseline)} → ${rendered(candidate)} | ${changed} | ${comparable.length} | ${baseline ? ms(total(baseline, comparable)) : '—'} → ${ms(total(candidate, comparable))} | ${baseline ? times(timeRatio(comparable) === undefined ? undefined : 1 / timeRatio(comparable)!) : '—'} | ${baseline ? mb(allocation(baseline, comparable)) : '—'} → ${mb(allocation(candidate, comparable))} |`,
    )
  }
  for (const family of [...new Set(corpus.map(input => input.family))].sort())
    row(
      family,
      corpus.filter(input => input.family === family),
    )
  if (corpus.length) row('**all corpus**', corpus)
  for (const input of scaling) row(input.id, [input])
  const commonCorpus = shared(corpus)
  md.push('', '## Paired corpus rounds', '', '| Round | Baseline | Candidate | Candidate / baseline |', '|---|---:|---:|---:|')
  const beforeRounds = baseline ? roundTotals(baseline, commonCorpus) : []
  const afterRounds = roundTotals(candidate, commonCorpus)
  afterRounds.forEach((value, round) => md.push(`| ${round + 1} | ${ms(beforeRounds[round])} | ${ms(value)} | ${times(ratio(value, beforeRounds[round]))} |`))
  const contributors = commonCorpus.map(input => ({ id: input.id, family: input.family, medianMs: total(candidate, [input])!, baselineMs: baseline ? total(baseline, [input]) : undefined })).sort((a, b) => b.medianMs - a.medianMs).slice(0, 10)
  const latency = runs.map(run => {
    const values = commonCorpus.flatMap(input => run.results.get(input.id)!.samplesMs.flat()).sort((a, b) => a - b)
    return { engine: run.label, samples: values.length, p50Ms: median(values), p95Ms: values[Math.ceil(values.length * 0.95) - 1], maxMs: values.at(-1) }
  })
  md.push('', 'Matched-corpus call latency (same input population; distribution across examples/repeats, not a confidence interval):', '', '| Engine | Samples | p50 | p95 | Max |', '|---|---:|---:|---:|---:|')
  for (const row of latency) md.push(`| ${row.engine} | ${row.samples} | ${ms(row.p50Ms)} | ${ms(row.p95Ms)} | ${ms(row.maxMs)} |`)
  md.push('', '## Largest candidate time contributors', '', '| Input | Candidate median | Baseline median |', '|---|---:|---:|')
  for (const input of contributors) md.push(`| ${input.id} | ${ms(input.medianMs)} | ${ms(input.baselineMs)} |`)
  md.push('', '## Fresh processes and memory', '', `| Metric | ${runs.map(run => `${run.label} ${run.version}`).join(' | ')} |`, `|---|${runs.map(() => '---').join('|')}|`)
  const metric = (name: string, values: string[]) => md.push(`| ${name} | ${values.join(' | ')} |`)
  metric(
    'Import (median)',
    runs.map(run => ms(median(run.importMs))),
  )
  metric(
    'First SVG render after import (median)',
    runs.map(run => ms(median(run.firstRenderMs))),
  )
  for (const group of [...groups, { name: 'candidate-corpus' }]) {
    if (!runs.some(run => run.memory.has(group.name))) continue
    metric(
      `${group.name}: measured inputs`,
      runs.map(run => String(run.memory.get(group.name)?.inputIds.length ?? '—')),
    )
    for (const [key, label] of [
      ['passAllocatedBytes', 'allocated / pass'],
      ['passPeakHeapBytes', 'peak heap during pass'],
      ['retainedGrowthBytes', 'retained heap / pass'],
      ['peakRssBytes', 'whole worker peak RSS'],
    ] as const)
      metric(
        `${group.name}: ${label}`,
        runs.map(run => mb(run.memory.get(group.name)?.[key])),
      )
  }
  md.push(
    '',
    'Times aggregate each observed rep over the matched inputs, take its within-process median, and report the median across interleaved rounds. Ratios pair the same round before taking their median. All SVG/ASCII correctness passes precede warm timings. Cold measurements include import and first render separately, without process launch or a cold filesystem. Memory comparisons use separate fresh processes restricted to the matched inputs; an additional candidate corpus pass includes newly supported inputs for the absolute retained-heap gate. Allocation and peak heap are V8 estimates sampled at GC boundaries. Retained heap covers one settled pass. Whole-worker RSS includes import, warm-up and measurement. ASCII is checked for correctness, not timed. The agent workload measures parse, mutate, verify, serialize, re-parse, fact checks and SVG render together. Full samples, output fingerprints, package identities and machine metadata accompany this report.',
  )
  return {
    ok,
    markdown: `${md.join('\n')}\n`,
    summary: {
      ok,
      status: 'completed',
      checks,
      pairedCorpus: { inputIds: commonCorpus.map(input => input.id), baselineMs: beforeRounds, candidateMs: afterRounds, candidateOverBaseline: timeRatio(commonCorpus) },
      largestContributors: contributors,
      matchedLatency: latency,
      groups: groups.map(group => ({ name: group.name, inputIds: group.inputs.map(input => input.id), comparedInputIds: shared(group.inputs).map(input => input.id) })),
      engines: runs.map(run => ({
        label: run.label,
        version: run.version,
        identity: run.identity,
        ...(run.consumeReceipt ? { layoutMode: run.layoutMode ?? 'legacy-default', layoutCache: run.layoutCache ?? 'off', cacheEnvironment: layoutCacheEnvironment(run.layoutCache ?? 'off'), outputConsumption: 'svg-utf8-and-full-receipt-json', layoutCoverage: layoutCoverage(inputs, run) } : {}),
        node: run.node,
        importMs: run.importMs,
        firstRenderMs: run.firstRenderMs,
        firstRender: run.firstRender,
        ...(run.firstLayout ? { firstLayout: run.firstLayout } : {}),
        coldDeterministic: run.coldDeterministic,
        results: Object.fromEntries([...run.results].map(([id, { svg, ...result }]) => [id, { ...result, svg: { ...fingerprint(svg), ...(!svg.ok ? { error: svg.error } : {}) } }])),
        memory: Object.fromEntries(run.memory),
        failures: Object.fromEntries(run.failures),
      })),
    },
  }
}

function main() {
  const options = releaseBenchArgs()
  const rounds = positive(options, 'rounds', 3)
  const reps = positive(options, 'reps', 5)
  const budgetMs = positive(options, 'budget-ms', DEFAULT_BUDGET_MS)
  const all: Input[] = [...extractOfficialCorpus().map(fence => ({ ...fence, kind: 'corpus' as const })), ...releaseBenchCases().map(input => ({ ...input, kind: 'scaling' as const })), { ...agentEditCase, kind: 'workflow' }]
  const selected = options.get('case')?.split(',')
  if (selected?.some(id => !all.some(input => input.id === id))) throw new Error('--case must name an existing input ID (comma-separated)')
  const inputs = selected ? all.filter(input => selected.includes(input.id)) : all
  const corpus = inputs.filter(input => input.kind === 'corpus')
  const groups: Group[] = [...(corpus.length ? [{ name: 'corpus', inputs: corpus, budgetMs: CORPUS_BUDGET_MS }] : []), ...inputs.filter(input => input.kind !== 'corpus').map(input => ({ name: input.id, inputs: [input], budgetMs: CASE_BUDGET_MS }))]
  const out = resolve(options.get('out') ?? join(ROOT, 'bench-report'))
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'corpus.json'), `${JSON.stringify(officialCorpusInventory(), null, 2)}\n`)
  const startedAt = new Date().toISOString()
  // Leave time to finalize reports before the workflow's outer timeout.
  const deadline = Date.now() + budgetMs
  const modes = options.get('layout-modes')?.split(',') as LayoutMode[] | undefined
  const layoutCache = (options.get('layout-cache') ?? 'off') as LayoutCache
  const metadata = { startedAt, sourceRevision: process.env.GITHUB_SHA, config: { rounds, reps, budgetMs, gates: GATES, ...(modes ? { layoutModes: modes, layoutReference: options.get('layout-reference') ?? 'separate', layoutCache, cacheEnvironment: layoutCacheEnvironment(layoutCache) } : {}) }, environment: { node: process.versions.node, bun: process.versions.bun, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    cpuQuota: existsSync('/sys/fs/cgroup/cpu.max') ? readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : undefined,
    memoryLimit: existsSync('/sys/fs/cgroup/memory.max') ? readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() : undefined } }
  writeFileSync(join(out, 'samples.jsonl'), `${JSON.stringify({ ...metadata, status: 'started' })}\n`)
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...metadata, ok: false, status: 'running' }, null, 2))
  writeFileSync(join(out, 'report.md'), '# Release benchmark: incomplete\n')
  const temporary: string[] = []
  function install(spec: string, label: string, identity: Identity, prefix?: string): Engine {
    const dir = prefix ?? mkdtempSync(join(tmpdir(), 'am-bench-'))
    if (!prefix) temporary.push(dir)
    const remaining = Math.min(5 * 60 * 1000, deadline - Date.now())
    if (remaining <= 0) throw new Error('Overall benchmark budget exhausted during package installation')
    const result = spawnSync('npm', ['install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', spec], { stdio: 'inherit', timeout: remaining, killSignal: 'SIGKILL' })
    if (result.status !== 0) throw new Error(`${label}: npm install failed: ${result.error?.message ?? result.status ?? result.signal}`)
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')) as { packages: Record<string, { integrity?: string }> }
    const integrity = lock.packages['node_modules/agentic-mermaid']?.integrity
    if (identity.integrity && identity.integrity !== integrity) throw new Error(`${label}: installed package integrity differs from the locked identity`)
    return packageAt(join(dir, 'node_modules', 'agentic-mermaid'), label, { ...identity, integrity })
  }
  try {
    const engines: Engine[] = []
    const baseline = options.get('baseline')
    const npm = options.get('baseline-npm')
    if (baseline) engines.push(packageAt(resolve(baseline), 'baseline', { kind: 'directory', requested: resolve(baseline) }))
    else if (npm) {
      const locked = resolveBaseline(npm, resolve(options.get('baseline-lock') ?? join(out, 'baseline.json')))
      engines.push(install(`agentic-mermaid@${locked.version}`, 'baseline', { kind: 'npm', requested: npm, integrity: locked.integrity }))
    }
    const tarball = options.get('candidate-tarball')
    if (tarball) {
      const bytes = readFileSync(resolve(tarball))
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (options.has('candidate-sha256') && options.get('candidate-sha256') !== sha256) throw new Error('Candidate tarball SHA-256 does not match the verified publication artifact')
      const dir = mkdtempSync(join(tmpdir(), 'am-bench-candidate-'))
      temporary.push(dir)
      const staged = join(dir, 'package.tgz')
      writeFileSync(staged, bytes)
      engines.push(install(staged, 'candidate', { kind: 'tarball', requested: resolve(tarball), sha256, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }, dir))
    } else {
      const dir = resolve(options.get('candidate') ?? ROOT)
      engines.push(packageAt(dir, 'candidate', { kind: 'directory', requested: dir }))
    }
    appendFileSync(join(out, 'samples.jsonl'), `${JSON.stringify({ engines })}\n`)
    if (modes) {
      const plans = layoutComparisons(engines, modes, layoutCache)
      const shared = options.get('layout-reference') === 'shared'
        ? measureLayoutComparisons(join(out, 'shared-reference'), plans, groups, rounds, reps, deadline) : undefined
      const comparisons = plans.map((plan, index) => {
        const directory = join(out, plan.name)
        mkdirSync(directory, { recursive: true })
        writeFileSync(join(directory, 'samples.jsonl'), `${JSON.stringify({ ...metadata, comparison: plan.name, engines: plan.engines })}\n`)
        const runs = shared ? shared[index]!.runs : measure(directory, plan.engines, groups, rounds, reps, deadline)
        if (shared) appendFileSync(join(directory, 'samples.jsonl'), `${JSON.stringify({ sharedSamples: '../shared-reference/samples.jsonl', timingOrder: 'rotating-fresh-arms', memoryPopulation: 'independently-paired', referenceReuse: true })}\n`)
        const result = report(inputs, groups, runs, rounds, plan.name === 'elk-aa')
        const healthy = plan.advisory ? strictLayoutHealthy(inputs, runs, rounds) : result.ok
        const markdown = plan.advisory ? `Strict Agentic support is partial: full-coverage and performance gates below are advisory. Measurement, content, determinism and unexpected-error checks ${healthy ? 'pass' : 'FAIL'}.\n\n${result.markdown}` : result.markdown
        const summary = { ...metadata, ...result.summary, comparison: plan.name, ...(plan.name === 'elk-aa' ? { control: { symmetric: true, ratioLimit: 1.1 } } : {}), gatePolicy: plan.name === 'elk-aa' ? 'symmetric-elk-aa-control' : plan.advisory ? 'partial-support-advisory' : 'existing-release-gates', requiredChecksPass: healthy }
        writeFileSync(join(directory, 'report.json'), JSON.stringify(summary, null, 2))
        writeFileSync(join(directory, 'report.md'), markdown)
        return { name: plan.name, advisory: plan.advisory, ok: healthy, summary, markdown }
      })
      const ok = comparisons.every(result => result.ok)
      const markdown = [`# Layout backend comparison: ${ok ? 'pass' : 'FAIL'}`, '',
        shared
          ? 'Fresh arms rotate within each input group. One explicit ELK reference serves the A/A and native comparisons; memory is paired independently, with reuse only for the identical engine and ordered population. Failed observations are retained without retries.'
          : 'Each arm runs in its own adjacent, counterbalanced pair against explicit ELK from the same package.',
        'ELK A/A is a control, not a divisor. Strict declines cannot shrink A/A or fallback coverage. Every enrolled input and typed outcome is retained. Public quality vectors come from separately labelled layout reruns after timing; unavailable dimensions and workflows are explicit. No human visual preference study is implied.', '',
        ...comparisons.map(result => `## ${result.name}${result.advisory ? ' (partial-support advisory)' : ''}\n\n${result.markdown}`),
      ].join('\n')
      writeFileSync(join(out, 'report.json'), JSON.stringify({ ...metadata, finishedAt: new Date().toISOString(), ok, status: 'completed', comparisons: comparisons.map(({ markdown: _markdown, ...value }) => value) }, null, 2))
      writeFileSync(join(out, 'report.md'), markdown)
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
      console.log(markdown)
      if (!ok) process.exitCode = 1
      return
    }
    const runs = measure(out, engines, groups, rounds, reps, deadline)
    const result = report(inputs, groups, runs, rounds)
    writeFileSync(join(out, 'report.json'), JSON.stringify({ ...metadata, finishedAt: new Date().toISOString(), ...result.summary }, null, 2))
    writeFileSync(join(out, 'report.md'), result.markdown)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown)
    console.log(result.markdown)
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    writeFileSync(join(out, 'report.json'), JSON.stringify({ ...metadata, ok: false, status: 'failed', error: reason }, null, 2))
    writeFileSync(join(out, 'report.md'), `# Release benchmark: FAIL\n\n${reason}\n`)
    throw error
  } finally {
    for (const dir of temporary) rmSync(dir, { recursive: true, force: true })
  }
}
if (import.meta.main) main()
