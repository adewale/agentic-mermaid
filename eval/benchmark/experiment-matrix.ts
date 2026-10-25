import './ci-policy-enforce.ts'
// Fresh-process, sequential feature screening. Finalists still need the full
// canonical release/browser/peer/micro suites; this is not their replacement.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PERFORMANCE_EXPERIMENTS, type PerformanceExperiment } from '../../src/experimental-performance.ts'
import { ROOT, workingRevision, extractRevisionTree } from './revision-tree.ts'
import { median } from './bench-stats.ts'
const options = new Map<string, string>()
const allowed = new Set(['out', 'rounds', 'samples', 'runtime', 'phase', 'configs', 'broad', 'allocation', 'png', 'cache', 'baseline-ref', 'paired', 'warmup', 'warmup-ms', 'gc'])
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i]!, value = process.argv[i + 1], key = flag.slice(2)
  if (!flag.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--') || options.has(key)) throw Error(`Invalid matrix option ${flag}`)
  options.set(key, value)
}
const integer = (key: string, fallback: number) => { const n = Number(options.get(key) ?? fallback); if (!Number.isSafeInteger(n) || n < 1) throw Error(`Invalid ${key}`); return n }
const out = resolve(options.get('out') ?? 'bench-report/experiments'), rounds = integer('rounds', 3), samples = integer('samples', 3)
const warmup = integer('warmup', 1), warmupMs = Number(options.get('warmup-ms') ?? 0)
if (!Number.isSafeInteger(warmupMs) || warmupMs < 0) throw Error('Invalid warmup-ms')
const requestedGc = options.get('gc') ?? 'checkpoint'
if (requestedGc !== 'natural' && requestedGc !== 'checkpoint') throw Error('--gc must be natural or checkpoint')
const gcMode: 'natural' | 'checkpoint' = requestedGc
const memoryCheckpoint = gcMode === 'natural' ? 'uncollected' : 'forced'
const allocation = options.get('allocation') === '1'
if (gcMode === 'natural' && allocation) throw Error('--gc natural cannot use --allocation 1; measure allocation in a separate checkpoint run')
const runtime = options.get('runtime') ?? 'node'
if (runtime !== 'node' && runtime !== 'bun') throw Error('--runtime must be node or bun')
const cache = options.get('cache') ?? 'off'
if (cache !== 'on' && cache !== 'off') throw Error('--cache must be on or off')
const pairedOption = options.get('paired') ?? '0'
if (pairedOption !== '0' && pairedOption !== '1') throw Error('--paired must be 0 or 1')
const paired = pairedOption === '1'
const phase = options.get('phase') ?? 'singles'
interface Config { id: string; features: PerformanceExperiment[]; source: 'baseline' | 'candidate' }
let requestedConfigs: unknown
if (options.has('configs')) requestedConfigs = JSON.parse(readFileSync(resolve(options.get('configs')!), 'utf8'))
else if (phase === 'singles') requestedConfigs = [{ id: 'baseline', features: [] }, ...PERFORMANCE_EXPERIMENTS.map(name => ({ id: name, features: [name] }))]
else if (phase === 'ablation') requestedConfigs = [{ id: 'baseline', features: [] }, { id: 'all', features: [...PERFORMANCE_EXPERIMENTS] },
  ...PERFORMANCE_EXPERIMENTS.map(name => ({ id: `without-${name}`, features: PERFORMANCE_EXPERIMENTS.filter(f => f !== name) }))]
else throw Error('--phase must be singles or ablation, or supply --configs')
if (!Array.isArray(requestedConfigs)) throw Error('Configurations must be an array')
const ids = new Set<string>()
const configs: Config[] = requestedConfigs.map(value => {
  if (!value || typeof value !== 'object') throw Error('Invalid configuration')
  const config = value as { id?: unknown; features?: unknown; source?: unknown }
  if (typeof config.id !== 'string' || !/^[a-z0-9_-]+$/.test(config.id) || ids.has(config.id)
    || !Array.isArray(config.features) || config.features.some(f => !PERFORMANCE_EXPERIMENTS.includes(f))
    || new Set(config.features).size !== config.features.length) throw Error(`Invalid config ${String(config.id)}`)
  const source = config.source ?? (config.id === 'baseline' ? 'baseline' : 'candidate')
  if (source !== 'baseline' && source !== 'candidate') throw Error(`Invalid source for config ${config.id}`)
  if (config.id === 'baseline' && source !== 'baseline') throw Error('The reserved baseline must use baseline source')
  if (source === 'baseline' && config.features.length !== 0) throw Error('Baseline source configurations must have no experimental flags')
  ids.add(config.id)
  return { id: config.id, features: config.features as PerformanceExperiment[], source }
})
if (!configs.some(c => c.id === 'baseline')) configs.unshift({ id: 'baseline', features: [], source: 'baseline' })
mkdirSync(out, { recursive: true })
const buildDir = join(ROOT, 'node_modules/.cache/flagged-performance')
mkdirSync(buildDir, { recursive: true })
const bundle = join(buildDir, 'worker.mjs')
const dependencies = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies)
const build = spawnSync(process.execPath, ['build', join(import.meta.dir, 'experiment-worker.ts'), '--target=node', '--format=esm',
  ...dependencies.flatMap(name => ['--external', name]), '--outfile', bundle], { cwd: ROOT, stdio: 'inherit' })
if (build.status !== 0) throw Error('Worker build failed')
const builtRevision = workingRevision()
let baselineBundle: string | undefined, baselineRevision: string | undefined
if (options.has('baseline-ref')) {
  const baselineTree = extractRevisionTree(options.get('baseline-ref')!, mkdtempSync(join(buildDir, 'revision-')), 'baseline')
  baselineRevision = baselineTree.revision; baselineBundle = join(buildDir, 'baseline-worker.mjs')
  const compiled = spawnSync(process.execPath, ['build', join(baselineTree.root, 'eval/benchmark/experiment-worker.ts'), '--target=node', '--format=esm',
    ...dependencies.flatMap(name => ['--external', name]), '--outfile', baselineBundle], { cwd: ROOT, stdio: 'inherit' })
  if (compiled.status !== 0) throw Error('Baseline worker build failed')
}
interface WorkerRow { id: string; output?: string; ok: boolean; medianMs?: number; witness?: string; allocationBytes?: number; error?: string }
interface Reference { runId: string; outputFile: string; source: 'baseline'; sourceRevision: string }
interface Run {
  runId: string; config: string; round: number; role: 'measurement' | 'reference'; source: Config['source']; sourceRevision: string
  outputFile: string; sequence: number; pairedFor?: string; pairId?: string; pairOrder?: string; comparisonReference?: Reference
  gcMode: 'natural' | 'checkpoint'; memoryCheckpoint: 'uncollected' | 'forced'
  rows?: WorkerRow[]; maxRssKiB?: number; finalMemory?: { heapUsed: number }; failed?: string
}
const runs: Run[] = []
const baselineConfig = configs.find(config => config.id === 'baseline')!
const referenceRevision = baselineRevision ?? builtRevision
const describeReference = (config: Config, round: number): Reference => ({
  runId: `${runtime}:${round}:${config.id}:${paired && config.id !== 'baseline' ? 'reference' : 'measurement'}`,
  outputFile: `${runtime}-${config.id}-${round}${paired && config.id !== 'baseline' ? '-reference' : ''}.json`,
  source: 'baseline', sourceRevision: referenceRevision,
})
function runWorker(config: Config, round: number, context: {
  pairedFor?: string; pairId?: string; pairOrder?: string; comparisonReference?: Reference
} = {}): void {
  const role = context.pairedFor ? 'reference' : 'measurement'
  const key = context.pairedFor ?? config.id
  const outputFile = `${runtime}-${key}-${round}${role === 'reference' ? '-reference' : ''}.json`
  const metadata: Run = {
    runId: `${runtime}:${round}:${key}:${role}`, config: config.id, round, role,
    source: config.source, sourceRevision: config.source === 'baseline' ? referenceRevision : builtRevision,
    outputFile, sequence: runs.length + 1, gcMode, memoryCheckpoint, ...context,
  }
  console.log(`${runtime} ${phase} ${round}/${rounds}: ${key}${role === 'reference' ? ' reference' : ''} (${config.source})`)
  const path = join(out, outputFile), job = join(out, 'job.json')
  rmSync(path, { force: true })
  writeFileSync(job, JSON.stringify({ out: path, samples, warmup, warmupMs, gcMode, broad: options.get('broad') === '1', allocation, png: options.get('png') === '1' }))
  const workerBundle = config.source === 'baseline' ? baselineBundle ?? bundle : bundle
  const started = performance.now()
  const child = spawnSync(runtime === 'bun' ? process.execPath : 'node', [...(gcMode === 'checkpoint' ? ['--expose-gc'] : []), workerBundle, job], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, AGENTIC_MERMAID_EXPERIMENTS: config.features.join(','), AGENTIC_MERMAID_ELK_CACHE: cache === 'on' ? '1' : '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' },
  })
  let result: Run
  if (child.status !== 0) {
    result = { ...metadata, failed: child.error?.message || child.stderr || `exited with ${child.status ?? child.signal ?? 'unknown status'}` }
  } else {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'))
      if (!value || !Array.isArray(value.rows)) throw Error('Worker result has no case rows')
      result = { ...value, ...metadata }
    } catch (error) { result = { ...metadata, failed: `Invalid worker result: ${String(error)}` } }
  }
  const evidence = { ...result, workerBundle, processWallMs: performance.now() - started,
    processExit: { status: child.status, signal: child.signal } }
  writeFileSync(path, JSON.stringify(evidence, null, 2))
  runs.push(evidence)
  writeFileSync(join(out, 'progress.json'), JSON.stringify({ revision: builtRevision, baselineRevision, runtime, cache, paired, gcMode, memoryCheckpoint, rounds, samples, warmup, warmupMs, configs, runs }, null, 2))
}
for (let round = 1; round <= rounds; round++) for (const config of round % 2 ? configs : [...configs].reverse()) {
  if (!paired || config.id === 'baseline') {
    runWorker(config, round, config.id === 'baseline' ? {} : { comparisonReference: describeReference(baselineConfig, round) })
    continue
  }
  const pairId = `${runtime}:${round}:${config.id}`
  const pairOrder = round % 2 ? 'reference-candidate' : 'candidate-reference'
  const reference = () => runWorker(baselineConfig, round, { pairedFor: config.id, pairId, pairOrder })
  const candidate = () => runWorker(config, round, { pairId, pairOrder, comparisonReference: describeReference(config, round) })
  if (round % 2) { reference(); candidate() } else { candidate(); reference() }
}
const summaries = configs.map(config => {
  const selected = runs.filter(r => r.role === 'measurement' && r.config === config.id)
  const comparisons = Array.from({ length: rounds }, (_, index) => {
    const measured = selected.find(run => run.round === index + 1)
    const referenceId = measured?.comparisonReference?.runId ?? describeReference(baselineConfig, index + 1).runId
    return { round: index + 1, measured, reference: runs.find(run => run.runId === referenceId) }
  })
  const references = comparisons.flatMap(pair => pair.reference ? [pair.reference] : [])
  const cases = [...new Set(comparisons.flatMap(pair => [...(pair.reference?.rows ?? []), ...(pair.measured?.rows ?? [])].map(row => row.id)))]
  const matched = cases.map(id => {
    const pairedRows = comparisons.map(pair => ({ round: pair.round,
      measured: pair.measured?.failed ? undefined : pair.measured?.rows?.find(row => row.id === id),
      reference: pair.reference?.failed ? undefined : pair.reference?.rows?.find(row => row.id === id) }))
    const valid = (row: WorkerRow | undefined) => row?.ok && Number.isFinite(row.medianMs) && row.medianMs! > 0
    const complete = pairedRows.every(pair => valid(pair.measured) && valid(pair.reference))
    const ratios = complete ? pairedRows.map(pair => pair.measured!.medianMs! / pair.reference!.medianMs!) : []
    const identical = complete && pairedRows.every(pair => typeof pair.measured!.witness === 'string' && pair.measured!.witness === pair.reference!.witness)
    return { id, output: pairedRows[0]?.measured?.output ?? pairedRows[0]?.reference?.output, complete, identical,
      medianMs: complete ? median(pairedRows.map(pair => pair.measured!.medianMs!)) : undefined,
      referenceMedianMs: complete ? median(pairedRows.map(pair => pair.reference!.medianMs!)) : undefined,
      medianRatio: ratios.length ? median(ratios) : undefined, ratios,
      allocationBytes: pairedRows.every(pair => pair.measured?.allocationBytes !== undefined) ? median(pairedRows.map(pair => pair.measured!.allocationBytes!)) : undefined,
      errors: pairedRows.flatMap(pair => [
        ...(!pair.measured?.ok ? [`round ${pair.round} candidate: ${pair.measured?.error ?? 'missing or failed process'}`] : []),
        ...(!pair.reference?.ok ? [`round ${pair.round} reference: ${pair.reference?.error ?? 'missing or failed process'}`] : []),
      ]) }
  })
  const eligible = matched.filter(row => row.complete)
  const complete = selected.length === rounds && comparisons.every(pair => pair.measured && !pair.measured.failed && pair.reference && !pair.reference.failed)
    && cases.length > 0 && eligible.length === cases.length
  const geomean = (rows: typeof eligible) => rows.length ? Math.exp(rows.reduce((n, r) => n + Math.log(r.medianRatio!), 0) / rows.length) : undefined
  return { ...config, gcMode, memoryCheckpoint, completedRounds: selected.filter(r => !r.failed).length, complete, matched, eligibleCases: eligible.length, totalCases: cases.length,
    comparisonReferences: comparisons.map(pair => ({ round: pair.round, candidateRunId: pair.measured?.runId, referenceRunId: pair.reference?.runId })),
    svgRatio: complete ? geomean(eligible.filter(r => r.output === 'svg')) : undefined, allRatio: complete ? geomean(eligible) : undefined,
    maxRssKiB: complete && selected.every(r => r.maxRssKiB !== undefined) ? median(selected.map(r => r.maxRssKiB!)) : undefined,
    referenceMaxRssKiB: complete && references.every(r => r.maxRssKiB !== undefined) ? median(references.map(r => r.maxRssKiB!)) : undefined,
    ...(gcMode === 'checkpoint' ? {
      retainedHeapBytes: complete && selected.every(r => r.finalMemory) ? median(selected.map(r => r.finalMemory!.heapUsed)) : undefined,
      referenceRetainedHeapBytes: complete && references.every(r => r.finalMemory) ? median(references.map(r => r.finalMemory!.heapUsed)) : undefined,
    } : {}) }
})
writeFileSync(join(out, 'summary.json'), JSON.stringify({ diagnostic: true, revision: builtRevision, baselineRevision, runtime, cache, paired, gcMode, memoryCheckpoint, rounds, samples, warmup, warmupMs, configs, summaries,
  method: `Fresh sequential processes, reversed config order alternate rounds; ${paired ? 'each non-baseline configuration has an adjacent fresh reference, with reference/candidate order reversed on alternate rounds' : 'one reference per round shared by configurations'}; at least ${warmup} warm calls and ${warmupMs}ms warm-up per case, followed by sequential within-process samples. Public render return plus output byte-length checking is timed; receipt cases include JSON serialization. Complete-output hashing and validation are outside timing. Ratios resolve each configuration's recorded comparison reference in the same round. Baseline-source empty-flag configurations permit fresh-process A/A controls. SVG equality is diagnostic: indexed-layout deliberately changes eligible geometry. All failures retained and incomplete aggregates withheld. GC mode ${gcMode}: ${gcMode === 'natural' ? 'no forced collection or allocation probes; raw heap checkpoints are uncollected and retained-heap summaries are omitted' : 'forced GC checkpoints; optional V8 allocation probes'}. RSS is the whole-worker maximum, not per-render peak/native allocation. Screening is not an exhaustive global-optimum proof.` }, null, 2))
console.log(summaries.map(s => ({ id: s.id, complete: s.complete, gcMode, memoryCheckpoint, svgRatio: s.svgRatio, allRatio: s.allRatio,
  ...(gcMode === 'checkpoint' ? { retainedHeapBytes: s.retainedHeapBytes } : {}), maxRssKiB: s.maxRssKiB })))
