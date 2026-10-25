import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { median } from './bench-stats.ts'
import { PERFORMANCE_POLICY } from './performance-gates.ts'
import { validateRuntimeStudyReport, runtimeStudyFingerprint, studyArchiveIntegritiesAgree, type SchedulerStudyReport } from './scheduler-study-validation.ts'
import { ROOT } from './revision-tree.ts'

export const BOUNDED_RUNTIME_WORKLOADS = ['flow5', 'seq20', 'ishikawa133'] as const
type Scope = { phase: 'first-use' | 'warm-new-source' | 'exact-repeat'; consumer: 'svg-utf8' | 'receipt-json-utf8'; cache: 'off' | 'on' }
type Entry = { id: string; report: SchedulerStudyReport; exit: number }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Partial-scope evidence uses maintained control math without relaxing full
 * scorecard enrollment. It can support selection, never global qualification. */
export function boundedRuntimeScorecard(entries: Entry[], scope: Scope, baseline: string, candidate: string, harness: string, schedule: string) {
  const checks = entries.map(({ id, report, exit }) => ({ id, runId: report.runId, ...validateRuntimeStudyReport(report, exit, { workloads: BOUNDED_RUNTIME_WORKLOADS, rounds: 5, clocks: scope.phase === 'first-use' ? 21 : 201, allocationProbes: 3, phase: scope.phase, consumer: scope.consumer, cache: scope.cache, schedule, harnessRevision: harness, baselineArchive: baseline, candidateArchive: id === 'candidate' ? candidate : baseline }) }))
  const complete = same(entries.map(entry => entry.id), ['aa-1', 'aa-2', 'candidate']) && checks.every(check => check.valid && typeof check.runId === 'string' && check.runId.length > 0) && new Set(checks.map(check => check.runId)).size === 3 && new Set(entries.map(entry => runtimeStudyFingerprint(entry.report))).size === 1 && studyArchiveIntegritiesAgree(entries.map(entry => entry.report))
  const value = (report: SchedulerStudyReport, peer: string, round: number, workload: string, metric: 'p50' | 'p95' | 'allocation') => {
    const row = report.tracks.observations.find(row => row.peer === peer && row.round === round && row.workload === workload)!
    const samples = metric === 'allocation' ? row.allocationSamplesBytes : row.callSamplesMs
    return metric === 'p95' ? [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1]! : median(samples)
  }
  const ratios = (report: SchedulerStudyReport, workload: string, metric: 'p50' | 'p95' | 'allocation') => Array.from({ length: 5 }, (_, round) => value(report, 'agentic', round, workload, metric) / value(report, 'agentic-baseline', round, workload, metric))
  const cells = complete ? BOUNDED_RUNTIME_WORKLOADS.flatMap(workload => (['p50', 'p95', 'allocation'] as const).map(metric => {
    const controls = entries.slice(0, 2).flatMap(entry => ratios(entry.report, workload, metric))
    const positive = (value: number) => Number.isFinite(value) && value > 0
    const spread = controls.every(positive) ? Math.max(...controls.map(ratio => Math.max(ratio, 1 / ratio))) : null
    const calibrated = spread !== null && spread <= PERFORMANCE_POLICY.maximumControlSpread[metric]
    const comparison = ratios(entries[2]!.report, workload, metric)
    const ratio = comparison.every(positive) ? median(comparison) : null
    const budget = calibrated ? Math.max(PERFORMANCE_POLICY.targets[metric], spread! * PERFORMANCE_POLICY.calibrationMargin) : null
    const improvementFloor = calibrated ? 1 / (spread! * PERFORMANCE_POLICY.calibrationMargin) : null
    return { workload, metric, controls, maximumSymmetricSpread: spread, calibrationCeiling: PERFORMANCE_POLICY.maximumControlSpread[metric], comparison, ratio, budget, improvementFloor, status: !calibrated || ratio === null ? 'uncalibrated' : ratio <= budget! ? 'pass' : 'fail', improvement: calibrated && ratio !== null && ratio < improvementFloor! }
  })) : []
  return { complete, performanceQualified: false, scope, identity: { baselineSha256: baseline, candidateSha256: candidate, harnessRevision: harness, schedule }, checks, cells, status: !complete ? 'incomplete' : cells.some(cell => cell.status === 'fail') ? 'failed' : cells.some(cell => cell.status === 'uncalibrated') ? 'uncalibrated' : 'passed', limits: ['Partial fixed cohort; never full release or peer qualification', 'Budget pass does not establish improvement', 'Controls bind this runner, archive, phase, consumer, cache and harness'] }
}

export function boundedRuntimeSelection(kind: 'warm-a' | 'cold-b', cards: ReturnType<typeof boundedRuntimeScorecard>[]) {
  const scopes = (kind === 'warm-a' ? ['warm-new-source', 'exact-repeat'] : ['first-use']).flatMap(phase => ['svg-utf8', 'receipt-json-utf8'].flatMap(consumer => ['off', 'on'].map(cache => `${phase}/${consumer}/${cache}`)))
  if (kind === 'cold-b') scopes.push('exact-repeat/receipt-json-utf8/on')
  const key = (card: ReturnType<typeof boundedRuntimeScorecard>) => `${card.scope.phase}/${card.scope.consumer}/${card.scope.cache}`
  const metricKeys = BOUNDED_RUNTIME_WORKLOADS.flatMap(workload => ['p50', 'p95', 'allocation'].map(metric => `${workload}/${metric}`)).sort()
  const complete = same(cards.map(key).sort(), [...scopes].sort()) && cards.every(card => card.complete && same(card.cells.map(cell => `${cell.workload}/${cell.metric}`).sort(), metricKeys)) && new Set(cards.map(card => JSON.stringify(card.identity))).size === 1
  const all = cards.flatMap(card => card.cells.map(cell => ({ scope: key(card), ...cell })))
  const failures = all.filter(cell => cell.status === 'fail'), uncalibrated = all.filter(cell => cell.status === 'uncalibrated')
  const primary = all.filter(cell => cell.metric === 'allocation' && (kind === 'warm-a'
    ? cell.scope === 'warm-new-source/svg-utf8/off' && cell.workload === 'seq20' || cell.scope === 'warm-new-source/receipt-json-utf8/off' && cell.workload === 'ishikawa133'
    : cell.scope === 'first-use/svg-utf8/off' && cell.workload === 'seq20'))
  const corroboration = kind === 'warm-a' || all.some(cell => cell.scope === 'first-use/svg-utf8/on' && cell.workload === 'seq20' && cell.metric === 'allocation' && cell.ratio !== null && cell.ratio < 1)
  const provisionalKeep = complete && failures.length === 0 && primary.some(cell => cell.improvement) && corroboration
  return { complete, kind, performanceQualified: false, provisionalKeep, decision: provisionalKeep ? 'provisionally retain pending full selected-source qualification' : 'drop; fixed keep rule not met', primary, corroboration, failures, uncalibrated, allMandatoryCellsCalibrated: complete && uncalibrated.length === 0, repeatedAcquisitionPermitted: false, limits: ['Uncalibrated cells remain unresolved and prevent full qualification', 'No full-corpus, peer or Sequence2x claim from this bounded study'] }
}

async function main() {
  const args = new Map<string, string>()
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]!, value = process.argv[i + 1]
    if (!['--baseline', '--candidate', '--baseline-sha256', '--candidate-sha256', '--runtime-source', '--phase', '--consumer', '--cache', '--out', '--schedule'].includes(key) || value === undefined || args.has(key)) throw new Error(`Invalid option ${key}`)
    args.set(key, value)
  }
  const required = (name: string) => { const value = args.get(name); if (!value) throw new Error(`Provide ${name}`); return value }
  const scope = { phase: required('--phase'), consumer: required('--consumer'), cache: required('--cache') } as Scope
  if (!['first-use', 'warm-new-source', 'exact-repeat'].includes(scope.phase) || !['svg-utf8', 'receipt-json-utf8'].includes(scope.consumer) || !['off', 'on'].includes(scope.cache)) throw new Error('Unknown bounded scope')
  const schedule = required('--schedule')
  if (!['peer-block-v1', 'paired-cold-ordinal-v1'].includes(schedule)) throw new Error('Unknown schedule')
  const baseline = resolve(required('--baseline')), candidate = resolve(required('--candidate')), runtimeSource = resolve(required('--runtime-source'))
  const baselineSha = required('--baseline-sha256'), candidateSha = required('--candidate-sha256')
  const out = resolve(required('--out'))
  if (existsSync(out)) throw new Error('Refusing existing acquisition output')
  mkdirSync(out, { recursive: true })
  const entries: Entry[] = [], executions: object[] = []
  for (const id of ['aa-1', 'aa-2', 'candidate']) {
    const json = join(out, `${id}.json`)
    const command = ['run', 'eval/benchmark/peer-bench.ts', '--peers', 'agentic', '--workloads', BOUNDED_RUNTIME_WORKLOADS.join(','), '--tracks', scope.phase, '--track-consumers', scope.consumer, '--track-schedule', schedule, '--elk-cache', scope.cache, '--rounds', '5', '--baseline-tarball', baseline, '--baseline-sha256', baselineSha, '--candidate-tarball', id === 'candidate' ? candidate : baseline, '--candidate-sha256', id === 'candidate' ? candidateSha : baselineSha, '--runtime-source', runtimeSource, '--json', json, '--markdown', join(out, `${id}.md`)]
    const started = new Date().toISOString()
    const deadlineMs = (scope.phase === 'first-use' ? 12 : 8) * 60_000
    let timedOut = false
    const exit = await new Promise<number | null>((done, reject) => {
      const child = spawn(process.execPath, command, { cwd: ROOT, stdio: 'inherit', detached: process.platform !== 'win32' })
      const deadline = setTimeout(() => {
        timedOut = true
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      }, deadlineMs)
      child.once('error', error => { clearTimeout(deadline); reject(error) })
      child.once('close', code => { clearTimeout(deadline); done(code) })
    })
    executions.push({ id, command, started, finished: new Date().toISOString(), exit, deadlineMs, timedOut })
    writeFileSync(join(out, 'execution.json'), JSON.stringify(executions, null, 2) + '\n')
    try { entries.push({ id, report: JSON.parse(readFileSync(json, 'utf8')), exit: exit ?? -1 }) } catch { /* Missing report remains an explicit completeness failure. */ }
  }
  const result = boundedRuntimeScorecard(entries, scope, baselineSha, candidateSha, process.env.GITHUB_SHA ?? '', schedule)
  writeFileSync(join(out, 'scorecard.json'), JSON.stringify(result, null, 2) + '\n')
  if (!result.complete) process.exitCode = 1
}

if (import.meta.main) await main()
