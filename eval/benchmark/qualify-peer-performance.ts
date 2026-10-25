import './ci-policy-enforce.ts'
// Serial runner: use the maintained peer adapters/protocol, not another timer.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performanceMarkdown, performanceScorecard, PERFORMANCE_POLICY, type PerformanceReport, type PerformanceScope } from './performance-gates.ts'
import { PEER_CONSUMERS, PEER_PHASES } from './peer-tracks.ts'
import { PEER_TRACK_SCHEDULES } from './peer-track-schedule.ts'
import { ROOT } from './revision-tree.ts'
import { assertMatchedAgenticRuntimes, frozenRuntimePolicy, installAgenticRuntime } from './release-baseline.ts'

const args = process.argv.slice(2)
const option = (name: string, fallback?: string) => {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(`Missing value for ${name}`)
  return args[i + 1]!
}
const candidate = resolve(option('--candidate-tarball') ?? '')
const baseline = resolve(option('--baseline-tarball') ?? '')
if (!option('--candidate-tarball') || !option('--baseline-tarball')) throw new Error('Provide --candidate-tarball and --baseline-tarball')
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const candidateSha = digest(candidate), baselineSha = digest(baseline)
for (const [flag, actual] of [['--candidate-sha256', candidateSha], ['--baseline-sha256', baselineSha]] as const) if (!option(flag) || option(flag) !== actual) throw new Error(`${flag} must match the verified archive`)
const cache = option('--elk-cache', 'off')!
if (!['on', 'off'].includes(cache)) throw new Error('--elk-cache must be on or off')
const schedule = option('--track-schedule', 'peer-block-v1')!
if (!(PEER_TRACK_SCHEDULES as readonly string[]).includes(schedule)) throw new Error('--track-schedule must be a known peer schedule')
const rounds = Number(option('--rounds', '5'))
if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer')
const phase = option('--phase'), consumer = option('--consumer')
if ((phase === undefined) !== (consumer === undefined)) throw new Error('Provide both --phase and --consumer for a qualification shard')
if (phase !== undefined && (!(PEER_PHASES as readonly string[]).includes(phase) || !(PEER_CONSUMERS as readonly string[]).includes(consumer!))) throw new Error('Unknown qualification phase or consumer')
const scope = phase === undefined ? undefined : { phase, consumer } as PerformanceScope
const out = resolve(option('--out', 'bench-report/semantic-performance')!)
const runtimeSource = resolve(option('--runtime-source', ROOT)!)
mkdirSync(out, { recursive: true })
const receipt: { status: string; complete: boolean; scopeComplete: boolean; scope: PerformanceScope | null; historicalAnchor: string; candidateSha: string; baselineSha: string; cache: string; schedule: string; rounds: number; quick: boolean; steps: object[] } = {
  status: 'incomplete', complete: false, scopeComplete: false, scope: scope ?? null, historicalAnchor: PERFORMANCE_POLICY.historicalAnchor, candidateSha, baselineSha, cache, schedule, rounds, quick: args.includes('--quick'), steps: [],
}
const save = () => writeFileSync(join(out, 'qualification-status.json'), `${JSON.stringify(receipt, null, 2)}\n`)
save()
async function run(name: string, aa: boolean): Promise<PerformanceReport> {
  const json = join(out, `${name}.json`)
  const command = ['run', 'eval/benchmark/peer-bench.ts', '--peers', 'agentic,beautiful,zombie,pele', '--tracks', scope?.phase ?? 'all', ...(scope ? ['--track-consumers', scope.consumer] : []), '--track-schedule', schedule, '--rounds', String(rounds), '--elk-cache', cache,
    '--candidate-tarball', aa ? baseline : candidate, '--candidate-sha256', aa ? baselineSha : candidateSha,
    '--baseline-tarball', baseline, '--baseline-sha256', baselineSha, '--runtime-source', runtimeSource, '--json', json, '--markdown', join(out, `${name}.md`), ...(args.includes('--quick') ? ['--quick'] : [])]
  const started = new Date().toISOString()
  const exit = await new Promise<number | null>((done, reject) => {
    const child = spawn(process.versions.bun ? process.execPath : 'bun', command, { cwd: ROOT, stdio: 'inherit', detached: process.platform !== 'win32' })
    const deadline = setTimeout(() => {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    }, 90 * 60_000)
    child.once('error', error => { clearTimeout(deadline); reject(error) })
    child.once('close', code => { clearTimeout(deadline); done(code) })
  })
  receipt.steps.push({ name, command, started, finished: new Date().toISOString(), exit })
  save()
  if (exit !== 0) throw new Error(`${name} did not complete; retained report/worker receipts are not a pass`)
  return JSON.parse(readFileSync(json, 'utf8')) as PerformanceReport
}
try {
  // Verify both comparison archives before even the first A/A timing. Each
  // independent run repeats this preflight for its own fresh installations.
  const scratch = mkdtempSync(join(tmpdir(), 'am-qualification-acquisition-'))
  try {
    const policy = frozenRuntimePolicy(runtimeSource)
    const runtimes = [baseline, candidate].map((archive, i) => installAgenticRuntime(archive, join(scratch, String(i)), policy, join(out, 'acquisition'), i ? 'candidate' : 'baseline', `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`).runtime)
    assertMatchedAgenticRuntimes(runtimes)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
  // Independent processes and report IDs; no reused partial controls.
  const controls = [await run('aa-1', true), await run('aa-2', true)]
  const comparison = await run('candidate', false)
  const score = performanceScorecard(comparison, controls, scope)
  writeFileSync(join(out, 'gates.json'), `${JSON.stringify(score, null, 2)}\n`)
  writeFileSync(join(out, 'gates.md'), performanceMarkdown(score))
  receipt.status = score.status
  receipt.complete = scope === undefined
  receipt.scopeComplete = true
  save()
  console.log(`Semantic performance qualification: ${score.status}; historical anchor remains ${receipt.historicalAnchor}`)
  if (!score.ok) process.exitCode = 1
} catch (error) {
  receipt.status = 'incomplete'
  save()
  throw error
}
