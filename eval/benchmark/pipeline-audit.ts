// Profile current public SVG renders by stage; community end-to-end timings
// remain in bench:peers, so no peer's internal stages are guessed.
// Narrow source attribution: --cases seq20 --profile cpu (or heap)
// --consumption svg (or receipt) --duration-ms 1500. Run each arm separately.
// Counterfactual fixed-source floor: --profile replay --replay-stages none,
// request, layout, drawing, paint-certification, svg-security, or a comma list.
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cpus } from 'node:os'
import { MICRO_WORKLOADS } from './micro-bench-cases.ts'
import { ROOT, workingRevision } from './revision-tree.ts'
import type { RenderStage } from '../../src/render-stages.ts'

const options = new Map<string, string>()
const allowed = new Set(['out', 'rounds', 'reps', 'cache', 'cases', 'profile', 'consumption', 'duration-ms', 'replay-stages'])
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i]!, key = flag.slice(2), value = process.argv[i + 1]
  if (!flag.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--') || options.has(key)) throw new Error(`Invalid pipeline audit option: ${flag}`)
  options.set(key, value)
}
const rounds = Number(options.get('rounds') ?? 3), reps = Number(options.get('reps') ?? 5)
if (![rounds, reps].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('--rounds and --reps must be positive integers')
const cache = options.get('cache') ?? 'off'
if (cache !== 'on' && cache !== 'off') throw new Error('--cache must be on or off')
const profileKind = options.get('profile') ?? 'combined'
if (!['combined', 'cpu', 'heap', 'replay'].includes(profileKind)) throw new Error('--profile must be combined, cpu, heap or replay')
const consumption = options.get('consumption') ?? 'svg'
if (!['svg', 'receipt'].includes(consumption)) throw new Error('--consumption must be svg or receipt')
const replayStages = options.has('replay-stages') && options.get('replay-stages') !== 'none' ? options.get('replay-stages')!.split(',') : []
if (new Set(replayStages).size !== replayStages.length || replayStages.some(stage => !['request', 'layout', 'drawing', 'paint-certification', 'svg-security'].includes(stage))) throw new Error('Invalid --replay-stages selection')
if (options.has('replay-stages') && profileKind !== 'replay') throw new Error('--replay-stages requires --profile replay')
if (profileKind === 'replay' && consumption !== 'svg') throw new Error('Stage replay is limited to fixed-source SVG consumption')
const durationMs = Number(options.get('duration-ms') ?? 1500)
if (!Number.isSafeInteger(durationMs) || durationMs < 1) throw new Error('--duration-ms must be a positive integer')
const workloads: Record<string, string> = { ...MICRO_WORKLOADS,
  seq300: ['sequenceDiagram', ...Array.from({ length: 300 }, (_, i) => `  P${i % 20}->>P${(i * 7 + 1) % 20}: message ${i}`)].join('\n') }
const ids = options.get('cases')?.split(',') ?? Object.keys(MICRO_WORKLOADS)
if (new Set(ids).size !== ids.length || ids.some(id => !Object.hasOwn(workloads, id))) throw new Error(`--cases must select unique workloads: ${Object.keys(workloads).join(',')}`)
if (profileKind !== 'combined' && ids.length !== 1) throw new Error('CPU/heap attribution requires exactly one --cases workload per fresh worker')
const out = resolve(options.get('out') ?? `bench-report/pipeline-${cache}`)
mkdirSync(out, { recursive: true })
// Put the bundle beside node_modules, just like bench:micro; Node must be able
// to resolve external runtime dependencies from the generated worker.
const buildDir = join(ROOT, 'node_modules/.cache/pipeline-audit')
mkdirSync(buildDir, { recursive: true })
const bundle = join(buildDir, 'worker.mjs')
const dependencies = Object.keys((JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies)
if (profileKind === 'replay') {
  // This substitution exists only in this diagnostic bundle. No production
  // switch, retained output cache, or alternative renderer is shipped.
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'pipeline-audit-worker.ts')], target: 'node', format: 'esm',
    external: dependencies, outdir: buildDir, naming: 'worker.mjs', sourcemap: 'external',
    plugins: [{ name: 'fixed-source-stage-replay', setup(builder) {
      builder.onLoad({ filter: /\/src\/render-stages\.ts$/ }, () => ({ loader: 'ts', contents: replayObserverSource(replayStages) }))
      builder.onLoad({ filter: /\/src\/scene\/native-drawing\.ts$/ }, ({ path }) => {
        const source = readFileSync(path, 'utf8'), boundary = '): NativeDrawing {'
        if (source.split(boundary).length !== 2) throw new Error('Native drawing diagnostic boundary changed')
        return { loader: 'ts', contents: source.replace(boundary, `${boundary}\n  (globalThis as any).__amStageReplay.nativeDrawing();`) }
      })
    } }] })
  if (!build.success) throw new AggregateError(build.logs, 'Replay diagnostic bundle failed')
} else {
  const build = spawnSync(process.execPath, ['build', join(import.meta.dir, 'pipeline-audit-worker.ts'), '--target=node', '--format=esm',
    '--sourcemap=external', ...dependencies.flatMap(name => ['--external', name]), '--outdir', buildDir, '--entry-naming', 'worker.mjs'], { cwd: ROOT, stdio: 'inherit' })
  if (build.status !== 0) throw new Error('Pipeline worker build failed')
}
copyFileSync(bundle, join(out, 'worker.mjs'))
copyFileSync(`${bundle}.map`, join(out, 'worker.mjs.map'))
const job = join(out, 'job.json'), output = join(out, 'samples.json')
writeFileSync(job, JSON.stringify({ rounds, reps, inputs: ids.map(id => ({ id, source: workloads[id]! })), output, profile: join(out, 'pipeline.cpuprofile'),
  profileKind, consumption, durationMs, revision: workingRevision(), sourceRoot: ROOT, replayStages }))
const child = spawnSync('node', [bundle, job], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: cache === 'on' ? '1' : '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' },
})
if (child.status !== 0) throw new Error(`Pipeline worker exited ${child.status ?? child.signal}`)
if (profileKind !== 'combined') {
  const report = JSON.parse(readFileSync(output, 'utf8'))
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, profileKind, id: ids[0], calls: report.calls, windowMs: report.windowMs,
    ...(profileKind === 'replay' ? { meanMs: report.meanMs, stageCounts: report.stageCounts } : { exclusive: report.attribution.exclusive }) }, null, 2))
  process.exit(0)
}
interface Sample { id: string; round: number; totalMs: number; error?: string; stages: Array<{ stage: RenderStage; ms: number }> }
const raw = JSON.parse(readFileSync(output, 'utf8')) as { samples: Sample[]; runtime: Record<string, string> }
const cases = ids.map(id => {
  const samples = raw.samples.filter(sample => sample.id === id)
  const good = samples.filter(sample => !sample.error)
  const totalMs = good.reduce((n, sample) => n + sample.totalMs, 0)
  const stages: Partial<Record<RenderStage, number>> = {}
  for (const sample of good) for (const stage of sample.stages) stages[stage.stage] = (stages[stage.stage] ?? 0) + stage.ms
  const measured = Object.entries(stages).filter(([stage]) => stage !== 'elk').reduce((n, [, ms]) => n + ms, 0)
  return { id, completed: good.length, attempted: samples.length, meanMs: totalMs / good.length,
    stages: Object.fromEntries(Object.entries(stages).map(([stage, ms]) => [stage, { meanMs: ms / good.length, fraction: ms / totalMs, nested: stage === 'elk' }])),
    otherMeanMs: (totalMs - measured) / good.length, errors: samples.filter(sample => sample.error).map(sample => sample.error) }
})
const report = { diagnostic: true, revision: workingRevision(), cpu: cpus()[0]?.model, cache, rounds, reps, runtime: raw.runtime,
  note: 'Stage clocks and Node CPU sampling add overhead. CPU profile excludes imports and warm-up. Layout includes parsing, repair and certification; ELK is nested, never additive. No visual-fidelity or peer-stage claim.', cases }
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
const lines = ['# Current pipeline stages (diagnostic)', '', `Source ${report.revision}; ELK result cache ${cache}; ${rounds} rounds × ${reps} renders per workload.`, '',
  '| Workload | Total ms | Request | Layout (ELK) | Scene | Drawing | Paint proof | SVG security | Backend | Other |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
for (const row of cases) {
  const stage = (name: RenderStage) => (row.stages[name]?.meanMs ?? 0).toFixed(3)
  lines.push(`| ${row.id} | ${row.meanMs.toFixed(3)} | ${stage('request')} | ${stage('layout')} (${stage('elk')}) | ${stage('scene')} | ${stage('drawing')} | ${stage('paint-certification')} | ${stage('svg-security')} | ${stage('backend')} | ${row.otherMeanMs.toFixed(3)} |`)
}
lines.push('', report.note, '')
writeFileSync(join(out, 'report.md'), lines.join('\n'))
console.log(lines.join('\n'))

function replayObserverSource(stages: string[]): string {
  return `
export type RenderStageSample = { stage: string; ms: number };
const selected = new Set(${JSON.stringify(stages)}), captured = new Map(), seen = new Set();
const counts = { calls: {}, executed: {}, replayed: {} };
const add = (group, stage) => group[stage] = (group[stage] ?? 0) + 1;
globalThis.__amStageReplay = { counts, begin: () => seen.clear(), nativeDrawing: () => add(counts.executed, 'native-drawing-body') };
export const withRenderStageObserver = (_observe, run) => run();
export function measureRenderStage(stage, run) {
  add(counts.calls, stage);
  if (!selected.has(stage)) { add(counts.executed, stage); return run(); }
  if (seen.has(stage)) throw new Error('Stage replay requires at most one selected stage occurrence per public call: ' + stage);
  seen.add(stage);
  if (captured.has(stage)) { add(counts.replayed, stage); return captured.get(stage); }
  add(counts.executed, stage);
  const value = run(); captured.set(stage, value); return value;
}`
}
