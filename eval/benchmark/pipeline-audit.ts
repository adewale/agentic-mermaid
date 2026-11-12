import 'trident/ci-policy-enforce.ts'
// Profile current public SVG renders by stage; community end-to-end timings
// remain in bench:peers, so no peer's internal stages are guessed.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cpus } from 'node:os'
import { MICRO_WORKLOADS } from './micro-bench-cases.ts'
import { ROOT, workingRevision } from './revision-tree.ts'
import type { RenderStage, RenderStageSample } from '../../src/render-stages.ts'

const options = new Map<string, string>()
const allowed = new Set(['out', 'rounds', 'reps', 'cache'])
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i]!, key = flag.slice(2), value = process.argv[i + 1]
  if (!flag.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--') || options.has(key)) throw new Error(`Invalid pipeline audit option: ${flag}`)
  options.set(key, value)
}
const rounds = Number(options.get('rounds') ?? 3), reps = Number(options.get('reps') ?? 5)
if (![rounds, reps].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('--rounds and --reps must be positive integers')
const cache = options.get('cache') ?? 'off'
if (cache !== 'on' && cache !== 'off') throw new Error('--cache must be on or off')
const out = resolve(options.get('out') ?? `bench-report/pipeline-${cache}`)
mkdirSync(out, { recursive: true })
// Put the bundle beside node_modules, just like bench:micro; Node must be able
// to resolve external runtime dependencies from the generated worker.
const buildDir = join(ROOT, 'node_modules/.cache/pipeline-audit')
mkdirSync(buildDir, { recursive: true })
const bundle = join(buildDir, 'worker.mjs')
const dependencies = Object.keys((JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies)
const build = spawnSync(process.execPath, ['build', join(import.meta.dir, 'pipeline-audit-worker.ts'), '--target=node', '--format=esm',
  ...dependencies.flatMap(name => ['--external', name]), '--outfile', bundle], { cwd: ROOT, stdio: 'inherit' })
if (build.status !== 0) throw new Error('Pipeline worker build failed')
const job = join(out, 'job.json'), output = join(out, 'samples.json')
writeFileSync(job, JSON.stringify({ rounds, reps, inputs: Object.entries(MICRO_WORKLOADS).map(([id, source]) => ({ id, source })), output, profile: join(out, 'pipeline.cpuprofile') }))
const child = spawnSync('node', [bundle, job], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: cache === 'on' ? '1' : '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' },
})
if (child.status !== 0) throw new Error(`Pipeline worker exited ${child.status ?? child.signal}`)
interface Sample { id: string; round: number; totalMs: number; error?: string; stages: RenderStageSample[] }
const raw = JSON.parse(readFileSync(output, 'utf8')) as { samples: Sample[]; runtime: Record<string, string> }
const cases = Object.keys(MICRO_WORKLOADS).map(id => {
  const samples = raw.samples.filter(sample => sample.id === id)
  const good = samples.filter(sample => !sample.error)
  const totalMs = good.reduce((n, sample) => n + sample.totalMs, 0)
  const stages: Partial<Record<RenderStage, { inclusiveMs: number; exclusiveMs: number }>> = {}
  let rootMs = 0
  for (const sample of good) {
    // Samples arrive in completion order. Accumulate only immediate children
    // at each depth, so repeated stage names and separate roots stay distinct.
    const children: number[] = []
    for (const span of sample.stages) {
      const value = stages[span.stage] ??= { inclusiveMs: 0, exclusiveMs: 0 }
      value.inclusiveMs += span.ms
      value.exclusiveMs += span.ms - (children[span.depth] ?? 0)
      children[span.depth] = 0
      if (span.depth === 0) rootMs += span.ms
      else children[span.depth - 1] = (children[span.depth - 1] ?? 0) + span.ms
    }
  }
  return { id, completed: good.length, attempted: samples.length, meanMs: totalMs / good.length,
    stages: Object.fromEntries(Object.entries(stages).map(([stage, ms]) => [stage, {
      meanMs: ms.exclusiveMs / good.length, inclusiveMeanMs: ms.inclusiveMs / good.length, fraction: ms.exclusiveMs / totalMs,
    }])),
    otherMeanMs: (totalMs - rootMs) / good.length, errors: samples.filter(sample => sample.error).map(sample => sample.error) }
})
const report = { diagnostic: true, revision: workingRevision(), cpu: cpus()[0]?.model, cache, rounds, reps, runtime: raw.runtime,
  note: 'Stage clocks and Node CPU sampling add overhead. CPU profile excludes imports and warm-up. Stage columns are exclusive; JSON also retains inclusive means. Other is elapsed time outside root spans. No visual-fidelity or peer-stage claim.', cases }
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
const lines = ['# Current pipeline stages (diagnostic)', '', `Source ${report.revision}; ELK result cache ${cache}; ${rounds} rounds × ${reps} renders per workload.`, '',
  '| Workload | Total ms | Request | Layout | Graph prep | Agentic | ELK | Scene | Drawing | Paint proof | SVG security | Backend | Other |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
for (const row of cases) {
  const stage = (name: RenderStage) => (row.stages[name]?.meanMs ?? 0).toFixed(3)
  lines.push(`| ${row.id} | ${row.meanMs.toFixed(3)} | ${stage('request')} | ${stage('layout')} | ${stage('graph-preparation')} | ${stage('agentic')} | ${stage('elk')} | ${stage('scene')} | ${stage('drawing')} | ${stage('paint-certification')} | ${stage('svg-security')} | ${stage('backend')} | ${row.otherMeanMs.toFixed(3)} |`)
}
lines.push('', report.note, '')
writeFileSync(join(out, 'report.md'), lines.join('\n'))
console.log(lines.join('\n'))
