// Fresh-process, sequential feature screening. Finalists still need the full
// canonical release/browser/peer/micro suites; this is not their replacement.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PERFORMANCE_EXPERIMENTS, type PerformanceExperiment } from '../../src/experimental-performance.ts'
import { ROOT, workingRevision, extractRevisionTree } from './revision-tree.ts'
import { median } from './bench-stats.ts'
const options = new Map<string, string>()
const allowed = new Set(['out', 'rounds', 'samples', 'runtime', 'phase', 'configs', 'broad', 'allocation', 'png', 'cache', 'baseline-ref'])
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i]!, value = process.argv[i + 1], key = flag.slice(2)
  if (!flag.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--') || options.has(key)) throw Error(`Invalid matrix option ${flag}`)
  options.set(key, value)
}
const integer = (key: string, fallback: number) => { const n = Number(options.get(key) ?? fallback); if (!Number.isSafeInteger(n) || n < 1) throw Error(`Invalid ${key}`); return n }
const out = resolve(options.get('out') ?? 'bench-report/experiments'), rounds = integer('rounds', 3), samples = integer('samples', 3)
const runtime = options.get('runtime') ?? 'node'
if (runtime !== 'node' && runtime !== 'bun') throw Error('--runtime must be node or bun')
const cache = options.get('cache') ?? 'off'
if (cache !== 'on' && cache !== 'off') throw Error('--cache must be on or off')
const phase = options.get('phase') ?? 'singles'
let configs: Array<{ id: string; features: PerformanceExperiment[] }>
if (options.has('configs')) configs = JSON.parse(readFileSync(resolve(options.get('configs')!), 'utf8'))
else if (phase === 'singles') configs = [{ id: 'baseline', features: [] }, ...PERFORMANCE_EXPERIMENTS.map(name => ({ id: name, features: [name] }))]
else if (phase === 'ablation') configs = [{ id: 'baseline', features: [] }, { id: 'all', features: [...PERFORMANCE_EXPERIMENTS] },
  ...PERFORMANCE_EXPERIMENTS.map(name => ({ id: `without-${name}`, features: PERFORMANCE_EXPERIMENTS.filter(f => f !== name) }))]
else throw Error('--phase must be singles or ablation, or supply --configs')
const ids = new Set<string>()
for (const config of configs) {
  if (!/^[a-z0-9_-]+$/.test(config.id) || ids.has(config.id) || config.features.some(f => !PERFORMANCE_EXPERIMENTS.includes(f)) || new Set(config.features).size !== config.features.length) throw Error(`Invalid config ${config.id}`)
  ids.add(config.id)
}
if (!configs.some(c => c.features.length === 0)) configs.unshift({ id: 'baseline', features: [] })
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
const runs: any[] = []
for (let round = 1; round <= rounds; round++) for (const config of round % 2 ? configs : [...configs].reverse()) {
  console.log(`${runtime} ${phase} ${round}/${rounds}: ${config.id}`)
  const path = join(out, `${runtime}-${config.id}-${round}.json`), job = join(out, 'job.json')
  writeFileSync(job, JSON.stringify({ out: path, samples, warmup: 1, broad: options.get('broad') === '1', allocation: options.get('allocation') === '1', png: options.get('png') === '1' }))
  const child = spawnSync(runtime === 'bun' ? process.execPath : 'node', ['--expose-gc', config.id === 'baseline' && baselineBundle ? baselineBundle : bundle, job], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, AGENTIC_MERMAID_EXPERIMENTS: config.features.join(','), AGENTIC_MERMAID_ELK_CACHE: cache === 'on' ? '1' : '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' },
  })
  if (child.status !== 0) { runs.push({ config: config.id, round, failed: child.error?.message ?? child.stderr ?? child.signal }); continue }
  runs.push({ config: config.id, round, ...JSON.parse(readFileSync(path, 'utf8')) })
  writeFileSync(join(out, 'progress.json'), JSON.stringify({ revision: builtRevision, baselineRevision, runtime, cache, rounds, samples, configs, runs }, null, 2))
}
const baseline = configs.find(c => c.features.length === 0)!.id
const baselineRuns = runs.filter(r => r.config === baseline && !r.failed)
const summaries = configs.map(config => {
  const selected = runs.filter(r => r.config === config.id)
  const cases = [...new Set(baselineRuns.flatMap(r => r.rows.map((row: any) => row.id)))] as string[]
  const matched = cases.map(id => {
    const rows = selected.filter(r => !r.failed).map(r => r.rows.find((row: any) => row.id === id))
    const base = baselineRuns.map(r => r.rows.find((row: any) => row.id === id))
    const complete = rows.length === rounds && base.length === rounds && rows.every(r => r?.ok) && base.every(r => r?.ok)
    const ratios = complete ? selected.map(r => r.rows.find((row: any) => row.id === id).medianMs / baselineRuns.find(b => b.round === r.round).rows.find((row: any) => row.id === id).medianMs) : []
    const identical = complete && rows.every((r, i) => r.witness === base[i].witness)
    return { id, output: rows[0]?.output ?? base[0]?.output, complete, identical, medianMs: complete ? median(rows.map(r => r.medianMs)) : undefined, medianRatio: ratios.length ? median(ratios) : undefined,
      allocationBytes: rows.every(r => r?.allocationBytes !== undefined) ? median(rows.map(r => r.allocationBytes)) : undefined, errors: rows.filter(r => !r?.ok).map(r => r?.error ?? 'missing') }
  })
  const eligible = matched.filter(row => row.complete)
  const geomean = (rows: typeof eligible) => rows.length ? Math.exp(rows.reduce((n, r) => n + Math.log(r.medianRatio!), 0) / rows.length) : undefined
  return { ...config, completedRounds: selected.filter(r => !r.failed).length, complete: eligible.length === cases.length, matched,
    svgRatio: geomean(eligible.filter(r => r.output === 'svg')), allRatio: geomean(eligible),
    maxRssKiB: selected.every(r => !r.failed) ? median(selected.map(r => r.maxRssKiB)) : undefined,
    retainedHeapBytes: selected.every(r => !r.failed) ? median(selected.map(r => r.finalMemory.heapUsed)) : undefined }
})
writeFileSync(join(out, 'summary.json'), JSON.stringify({ diagnostic: true, revision: builtRevision, baselineRevision, runtime, cache, rounds, samples, configs, summaries,
  method: 'Fresh sequential processes, reversed config order alternate rounds; one warm call and independent samples/case. Complete output byte consumption is timed. Ratios are candidate/baseline paired by round. SVG equality is diagnostic: indexed-layout deliberately changes eligible geometry. All failures retained. RSS/GC checkpoints are not exact per-render peak/native allocation. Screening is not an exhaustive global-optimum proof.' }, null, 2))
console.log(summaries.map(s => ({ id: s.id, complete: s.complete, svgRatio: s.svgRatio, allRatio: s.allRatio, retainedHeapBytes: s.retainedHeapBytes, maxRssKiB: s.maxRssKiB })))
