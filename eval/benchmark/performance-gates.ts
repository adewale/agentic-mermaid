// Release regressions and peer competitiveness are deliberately separate.
// Numeric decisions are blocking only after repeated, same-runner A/A controls.
import { cpus } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { median } from './bench-stats.ts'
import type { PeerPhase, PeerConsumer } from './peer-tracks.ts'
import { PEER_FROZEN_COHORT, PEER_PHASES, PEER_CONSUMERS, PEER_EXPECTED_LABELS } from './peer-tracks.ts'

export const PERFORMANCE_POLICY = {
  version: 'semantic-peer-v1',
  historicalAnchor: 'a9d1551da27ddab542a1ae96329464ad65725448',
  cohort: PEER_FROZEN_COHORT,
  fullAgenticCoverage: Object.freeze(Object.keys(PEER_EXPECTED_LABELS)),
  scaling: ['tree100', 'mesh100'],
  phases: PEER_PHASES,
  consumers: PEER_CONSUMERS,
  competitivePeers: ['beautiful', 'pele'],
  minimumControlRuns: 2,
  minimumRounds: 5,
  minimumTailCallsPerRound: 20,
  minimumAllocationSamplesPerRound: 3,
  // Hard noise ceilings prevent a noisy control from manufacturing a loose gate.
  maximumControlSpread: { p50: 1.15, p95: 1.25, allocation: 1.10 },
  targets: { p50: 1.05, p95: 1.10, allocation: 1.05 },
  competitiveTargets: { p50: 1, p95: 1, allocation: 1 },
  calibrationMargin: 1.02,
} as const

type Metric = 'p50' | 'p95' | 'allocation'
interface Observation {
  peer: string; round: number; workload: string; phase: string; consumer: string
  status: string; callSamplesMs: number[]; allocationSamplesBytes: number[]
  semantic: { ok: boolean; checks: string[]; unsupported: string[]; failures: string[] }
  diagnostics: { status: string; complete?: boolean; counts: Record<string, number> }
}
export interface PerformanceReport {
  status: string; runId: string; policy: { elkCache: string; aplEnvironment?: Record<string, string>; executionEnvironment?: ReturnType<typeof import('./peer-tracks.ts').peerExecutionEnvironment> }
  environment: { node?: string; cpu?: string; logicalCpus?: number; platform?: string; arch?: string; osRelease?: string; hostname?: string }
  config: { rounds: number; timing: unknown }
  tracksConfig?: { samples: number; allocationSamples: number; [key: string]: unknown }
  pins: Array<{ peer: string; integrity?: string; source?: unknown; runtimeDependencySha256?: string; identity?: { sha256?: string } }>
  tracks: { phases?: readonly string[]; consumers?: readonly string[]; schemaVersion: number; contractVersion: string; cohort: readonly string[]; observations: Observation[] }
}
interface Check { name: string; ok: boolean; detail?: string }
interface NumericGate {
  workload: string; phase: string; consumer: string; metric: Metric; peer?: string
  status: 'pass' | 'fail' | 'uncalibrated' | 'unavailable'
  blocking: boolean; ratio?: number; target: number; budget?: number; controls: number[]; reason?: string
}
const positive = (x: number) => Number.isFinite(x) && x > 0
const nonnegative = (x: number) => Number.isFinite(x) && x >= 0
const percentile95 = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * .95) - 1]!
const key = (o: Observation) => `${o.peer}\0${o.round}\0${o.workload}\0${o.phase}\0${o.consumer}`
const fingerprint = (r: PerformanceReport) => {
  const e = r.environment
  return JSON.stringify({ node: e?.node, cpu: e?.cpu, cpus: e?.logicalCpus, platform: e?.platform, arch: e?.arch, os: e?.osRelease, hostname: e?.hostname, policy: r.policy, timing: r.config?.timing, tracksConfig: r.tracksConfig, version: r.tracks?.contractVersion })
}
const at = (r: PerformanceReport, peer: string, round: number, workload: string, phase: string, consumer: string) => r.tracks.observations.find(o => o.peer === peer && o.round === round && o.workload === workload && o.phase === phase && o.consumer === consumer)

function metricValue(o: Observation | undefined, metric: Metric, cold = false, requireSemantic = true): number | undefined {
  if (!o || o.status !== 'ok' || (requireSemantic && !o.semantic?.ok) || o.semantic?.failures?.length) return undefined
  const values = metric === 'allocation' ? o.allocationSamplesBytes : o.callSamplesMs
  const minimum = metric === 'allocation' ? PERFORMANCE_POLICY.minimumAllocationSamplesPerRound : metric === 'p95' ? PERFORMANCE_POLICY.minimumTailCallsPerRound : cold ? 1 : PERFORMANCE_POLICY.minimumTailCallsPerRound
  if (!Array.isArray(values) || values.length < minimum || !values.every(metric === 'allocation' ? nonnegative : positive)) return undefined
  const value = metric === 'p95' ? percentile95(values) : median(values)
  // Zero allocation estimates remain visible in raw reports; they cannot form a ratio.
  return positive(value) ? value : undefined
}

function ratios(report: PerformanceReport, numerator: string, denominator: string, workload: string, phase: string, consumer: string, metric: Metric, requireSemantic = true): number[] | undefined {
  const values: number[] = []
  for (let round = 0; round < report.config.rounds; round++) {
    const a = metricValue(at(report, numerator, round, workload, phase, consumer), metric, phase === 'first-use', requireSemantic)
    const b = metricValue(at(report, denominator, round, workload, phase, consumer), metric, phase === 'first-use', requireSemantic)
    if (a === undefined || b === undefined) return undefined
    values.push(a / b)
  }
  return values
}

export interface PerformanceScope { phase: PeerPhase; consumer: PeerConsumer }

export interface RegressionCellRequest extends PerformanceScope { workload: string; metric: Metric }

/** Shared arithmetic for declared cells, not population or diagnostic admission.
 * Callers retain their own scope/quality checks; unavailable cells are never dropped. */
export function regressionCells(candidate: PerformanceReport, controls: readonly PerformanceReport[], requests: readonly RegressionCellRequest[]) {
  const policy = PERFORMANCE_POLICY
  const keys = new Set<string>()
  for (const request of requests) {
    const id = JSON.stringify([request.workload, request.phase, request.consumer, request.metric])
    if (!request.workload || !(PEER_PHASES as readonly string[]).includes(request.phase) || !(PEER_CONSUMERS as readonly string[]).includes(request.consumer)
      || !Object.prototype.hasOwnProperty.call(policy.targets, request.metric) || keys.has(id)) throw new Error('Unknown or duplicate regression cell request')
    keys.add(id)
  }
  const validControls = controls.length >= policy.minimumControlRuns && new Set(controls.map(r => r.runId)).size === controls.length && controls.every(r =>
    r.status === 'completed' && r.config.rounds >= policy.minimumRounds && fingerprint(r) === fingerprint(candidate) && r.tracks?.contractVersion === policy.version &&
    JSON.stringify(r.tracks?.cohort) === JSON.stringify(policy.cohort) && new Set(r.tracks.observations.map(key)).size === r.tracks.observations.length &&
    /^[a-f0-9]{64}$/.test(r.pins.find(p => p.peer === 'agentic')?.identity?.sha256 ?? '') &&
    r.pins.find(p => p.peer === 'agentic')?.identity?.sha256 === r.pins.find(p => p.peer === 'agentic-baseline')?.identity?.sha256 &&
    r.pins.find(p => p.peer === 'agentic')?.identity?.sha256 === candidate.pins.find(p => p.peer === 'agentic-baseline')?.identity?.sha256) &&
    candidate.config.rounds >= policy.minimumRounds && !!candidate.environment.hostname &&
    /^[a-f0-9]{40}$/.test(String(candidate.tracksConfig?.harnessRevision ?? '')) && candidate.tracksConfig?.harnessDirty === false &&
    (candidate.tracksConfig?.samples ?? 0) >= policy.minimumTailCallsPerRound &&
    (candidate.tracksConfig?.allocationSamples ?? 0) >= policy.minimumAllocationSamplesPerRound
  const calibrationReason = validControls ? undefined : 'Need at least two distinct completed same-runner/contract/policy A/A reports, each ≥5 rounds, using the exact comparison baseline archive'
  const expectedControls = controls.reduce((sum, r) => sum + r.config.rounds, 0)
  const cells: Array<{ gate: NumericGate; controlSpread: number; improvementFloor: number | undefined }> = []
  for (const { workload, phase, consumer, metric } of requests) {
    const controlRatios = validControls ? controls.flatMap(r => ratios(r, 'agentic', 'agentic-baseline', workload, phase, consumer, metric) ?? []) : []
    const spread = controlRatios.length ? Math.max(...controlRatios.map(r => Math.max(r, 1 / r))) : Infinity
    const calibrated = validControls && candidate.config.rounds >= policy.minimumRounds && controlRatios.length === expectedControls && spread <= policy.maximumControlSpread[metric]
    const budget = calibrated ? Math.max(policy.targets[metric], spread * policy.calibrationMargin) : undefined
    const result = ratios(candidate, 'agentic', 'agentic-baseline', workload, phase, consumer, metric)
    const ratio = result ? median(result) : undefined
    const reason = calibrationReason ?? (!calibrated ? 'Insufficient per-call/allocation observations or A/A spread exceeds the predeclared noise ceiling' : ratio === undefined ? 'Missing, failed or zero-denominator metric' : undefined)
    const gate: NumericGate = { workload, phase, consumer, metric, status: !calibrated ? 'uncalibrated' : ratio === undefined ? 'unavailable' : ratio <= budget! ? 'pass' : 'fail', blocking: calibrated, ratio, target: policy.targets[metric], budget, controls: controlRatios, ...(reason ? { reason } : {}) }
    cells.push({ gate, controlSpread: spread, improvementFloor: calibrated ? 1 / (spread * policy.calibrationMargin) : undefined })
  }
  return { calibration: { validControls, reason: calibrationReason }, expectedControls, cells }
}

/** Fail-closed completeness/semantic checks, separate from noisy numeric gates. */
export function performanceScorecard(candidate: PerformanceReport, controls: readonly PerformanceReport[], scope?: PerformanceScope) {
  const policy = PERFORMANCE_POLICY
  if (scope && (!(PEER_PHASES as readonly string[]).includes(scope.phase) || !(PEER_CONSUMERS as readonly string[]).includes(scope.consumer))) throw new Error('Unknown semantic performance shard')
  const phases: readonly string[] = scope ? [scope.phase] : policy.phases
  const consumers: readonly string[] = scope ? [scope.consumer] : policy.consumers
  const observations = candidate.tracks?.observations ?? []
  const checks: Check[] = []
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail ? { detail } : {}) })
  check('Completed track report', candidate.status === 'completed' && Array.isArray(candidate.tracks?.observations))
  check('Immutable semantic cohort and contract', candidate.tracks?.contractVersion === policy.version && JSON.stringify(candidate.tracks?.cohort) === JSON.stringify(policy.cohort))
  check('Declared execution scope matches every report', !scope || [candidate, ...controls].every(r => JSON.stringify(r.tracks?.phases) === JSON.stringify(phases) && JSON.stringify(r.tracks?.consumers) === JSON.stringify(consumers) && r.tracks.observations.every(o => o.phase === scope.phase && o.consumer === scope.consumer)))
  check('Unique observation keys', new Set(observations.map(key)).size === observations.length)
  check('No APL experiment overrides', Object.keys(candidate.policy?.aplEnvironment ?? {}).length === 0)
  check('Execution feature/runtime settings are recorded', !!candidate.policy?.executionEnvironment && controls.every(r => !!r.policy?.executionEnvironment))
  check('Default production experiment selection', candidate.policy?.executionEnvironment?.experiments === null && controls.every(r => r.policy?.executionEnvironment?.experiments === null))
  const allPeers = ['agentic', 'agentic-baseline', ...policy.competitivePeers]
  const missing: string[] = [], invalid: string[] = []
  for (const peer of allPeers) for (let round = 0; round < candidate.config.rounds; round++) for (const workload of policy.cohort) for (const phase of phases) for (const consumer of consumers) {
    const row = observations.find(o => key(o) === key({ peer, round, workload, phase, consumer } as Observation))
    const id = [peer, round, workload, phase, consumer].join('/')
    if (!row) { missing.push(id); continue }
    // Third-party APIs do not promise Agentic's receipt contract.
    if (consumer === 'receipt-json-utf8' && !peer.startsWith('agentic') && row.status === 'unsupported') continue
    const semanticUnavailable = !peer.startsWith('agentic') && row.semantic?.unsupported?.length && !row.semantic?.failures?.length
    if (row.status !== 'ok' || (!row.semantic?.ok && !semanticUnavailable) || row.semantic.failures?.length || !row.semantic.checks?.length || !row.callSamplesMs?.length || !row.callSamplesMs.every(positive)) invalid.push(id)
  }
  check('Every fixed-cohort phase/consumer/round is enrolled', missing.length === 0, missing.join(', '))
  check('Required semantic observations succeed', invalid.length === 0, invalid.join(', '))
  const fullMissing: string[] = []
  for (let round = 0; round < candidate.config.rounds; round++) for (const workload of policy.fullAgenticCoverage) for (const phase of phases) for (const consumer of consumers) {
    const o = at(candidate, 'agentic', round, workload, phase, consumer)
    if (!o || o.status !== 'ok' || !o.semantic?.ok || !o.callSamplesMs?.length || !o.callSamplesMs.every(positive)) fullMissing.push([round, workload, phase, consumer].join('/'))
  }
  check('All 14 Agentic SVG/receipt workloads remain enrolled', fullMissing.length === 0, fullMissing.join(', '))
  const scalingMissing: string[] = []
  for (const peer of ['agentic', 'agentic-baseline']) for (let round = 0; round < candidate.config.rounds; round++) for (const workload of policy.scaling) for (const phase of phases) for (const consumer of consumers) {
    const o = at(candidate, peer, round, workload, phase, consumer)
    if (!o || o.status !== 'ok' || !o.semantic?.ok || !o.callSamplesMs?.length || !o.callSamplesMs.every(positive)) scalingMissing.push([peer, round, workload, phase, consumer].join('/'))
  }
  check('Every Agentic scaling track succeeds', scalingMissing.length === 0, scalingMissing.join(', '))
  const agenticDiagnostics = observations.filter(o => o.peer === 'agentic' && o.status === 'ok')
  check('Actual candidate cache/fallback diagnostic replays complete', agenticDiagnostics.length > 0 && agenticDiagnostics.every(o => o.diagnostics?.status === 'observed' && o.diagnostics.complete === true))
  if ([candidate, ...controls].some(r => r.tracksConfig?.consumption === 'indexed-utf8-checksum-v1')) {
    check('Indexed consumer protocol matches every side', [candidate, ...controls].every(r => r.tracksConfig?.consumption === 'indexed-utf8-checksum-v1'))
    const truncated = [candidate, ...controls].flatMap(r => r.tracks.observations.filter(o => {
      if (o.status !== 'ok') return false
      const planned = o.phase === 'first-use' ? r.tracksConfig?.coldSamples : r.tracksConfig?.samples
      return typeof planned !== 'number' || !Number.isInteger(planned) || planned <= 0 || o.callSamplesMs.length !== planned
    }).map(o => `${r.runId}/${key(o)}`))
    check('Declared indexed timing populations complete', truncated.length === 0, truncated.join(', '))
  }

  const graph = (r: PerformanceReport, peer: string) => r.pins.find(p => p.peer === peer)?.runtimeDependencySha256
  const graphValid = (s: string | undefined) => /^[a-f0-9]{64}$/.test(s ?? '')
  const baselineGraph = graph(candidate, 'agentic-baseline')
  check('Resolved runtime dependency graphs match all Agentic sides and controls', graphValid(baselineGraph) && graph(candidate, 'agentic') === baselineGraph && controls.every(r => graph(r, 'agentic') === baselineGraph && graph(r, 'agentic-baseline') === baselineGraph))
  const controlFailures: string[] = []
  for (const r of controls) for (const peer of allPeers) for (let round = 0; round < r.config.rounds; round++) for (const workload of [...policy.fullAgenticCoverage, ...policy.scaling]) for (const phase of phases) for (const consumer of consumers) {
    if (!peer.startsWith('agentic') && (consumer === 'receipt-json-utf8' || !(policy.cohort as readonly string[]).includes(workload))) continue
    const o = at(r, peer, round, workload, phase, consumer)
    const minimumCalls = phase === 'first-use' ? 1 : Math.min(policy.minimumTailCallsPerRound, r.tracksConfig?.samples ?? policy.minimumTailCallsPerRound)
    if (!o || o.status !== 'ok' || o.semantic?.failures?.length || (peer.startsWith('agentic') && !o.semantic?.ok) || !o.callSamplesMs?.length || !o.callSamplesMs.every(positive) ||
      o.callSamplesMs.length < minimumCalls || (phase !== 'first-use' && (!o.allocationSamplesBytes || o.allocationSamplesBytes.length < policy.minimumAllocationSamplesPerRound || !o.allocationSamplesBytes.every(nonnegative)))) controlFailures.push([r.runId, peer, round, workload, phase, consumer].join('/'))
  }
  check('Required A/A observations complete without errors', controlFailures.length === 0 && controls.length >= policy.minimumControlRuns, controlFailures.join(', '))

  const requests: RegressionCellRequest[] = []
  for (const workload of [...policy.fullAgenticCoverage, ...policy.scaling]) for (const phase of phases) for (const consumer of consumers) for (const metric of ['p50', 'p95', 'allocation'] as const) {
    requests.push({ workload, phase: phase as PeerPhase, consumer: consumer as PeerConsumer, metric })
  }
  const regression = regressionCells(candidate, controls, requests)
  const { validControls, reason: calibrationReason } = regression.calibration
  const expectedControls = regression.expectedControls
  const gates: NumericGate[] = []
  for (const { gate, controlSpread: spread } of regression.cells) {
    const { workload, phase, consumer, metric } = gate
    const calibrated = gate.blocking
    const reason = gate.reason
    gates.push(gate)
    if (consumer === 'receipt-json-utf8' || !(policy.cohort as readonly string[]).includes(workload)) continue
    for (const peer of policy.competitivePeers) {
      const paired = ratios(candidate, 'agentic', peer, workload, phase, consumer, metric)
      const peerRatio = paired ? median(paired) : undefined
      const baselinePeerRatios = validControls ? controls.flatMap(r => ratios(r, 'agentic', peer, workload, phase, consumer, metric) ?? []) : []
      const centre = baselinePeerRatios.length ? median(baselinePeerRatios) : 0
      const peerSpread = centre > 0 ? Math.max(...baselinePeerRatios.map(r => Math.max(r / centre, centre / r))) : Infinity
      const pin = (r: PerformanceReport) => r.pins.find(p => p.peer === peer)
      const pinMatches = controls.every(r => pin(r)?.integrity && pin(r)?.integrity === pin(candidate)?.integrity && JSON.stringify(pin(r)?.source) === JSON.stringify(pin(candidate)?.source) && graphValid(graph(r, peer)) && graph(r, peer) === graph(candidate, peer))
      const peerCalibrated = calibrated && pinMatches && baselinePeerRatios.length === expectedControls && peerSpread <= policy.maximumControlSpread[metric]
      const peerBudget = peerCalibrated ? Math.max(policy.competitiveTargets[metric], Math.max(spread, peerSpread) * policy.calibrationMargin) : undefined
      const unavailableSemantics = [...new Set([candidate, ...controls].flatMap(report => report.tracks.observations.filter(row => row.peer === peer && row.workload === workload && row.phase === phase && row.consumer === consumer && !row.semantic?.ok).flatMap(row => row.semantic?.unsupported ?? [])))]
      gates.push({ workload, phase, consumer, metric, peer, status: !peerCalibrated ? 'uncalibrated' : peerRatio === undefined ? 'unavailable' : peerRatio <= peerBudget! ? 'pass' : 'fail', blocking: peerCalibrated, ratio: peerRatio, target: policy.competitiveTargets[metric], budget: peerBudget, controls: baselinePeerRatios, ...(!peerCalibrated ? { reason: unavailableSemantics.length ? `Rendered semantic contract unavailable: ${unavailableSemantics.join('; ')}` : reason ?? 'Peer controls are missing, pins differ or paired variation exceeds the noise ceiling' } : {}) })
    }
  }
  const fullCoverage = Object.fromEntries([...new Set(observations.map(o => o.peer))].map(peer => [peer, Object.fromEntries(['ok', 'unsupported', 'lost-labels', 'error'].map(status => [status, observations.filter(o => o.peer === peer && o.status === status).length]))]))
  const peerCohortSummary = consumers.includes('svg-utf8') ? policy.competitivePeers.flatMap(peer => phases.flatMap(phase => (['p50', 'p95', 'allocation'] as const).map(metric => {
    const perCase = policy.cohort.map(workload => {
      const paired = ratios(candidate, 'agentic', peer, workload, phase, 'svg-utf8', metric, false)
      return { workload, ratio: paired ? median(paired) : undefined }
    })
    const complete = perCase.every(row => row.ratio !== undefined)
    const semanticComplete = policy.cohort.every(workload => ratios(candidate, 'agentic', peer, workload, phase, 'svg-utf8', metric) !== undefined)
    return { peer, phase, metric, cohort: policy.cohort, complete, semanticComplete, labelCheckedRatio: complete ? Math.exp(perCase.reduce((sum, row) => sum + Math.log(row.ratio!), 0) / policy.cohort.length) : undefined, perCase }
  }))) : []
  const scalingGrowth: NumericGate[] = []
  for (const [small, large] of [['tree50', 'tree100'], ['mesh50', 'mesh100']]) for (const phase of phases) for (const consumer of consumers) for (const metric of ['p50', 'p95', 'allocation'] as const) {
    const growth = (r: PerformanceReport) => {
      const s = ratios(r, 'agentic', 'agentic-baseline', small!, phase, consumer, metric)
      const l = ratios(r, 'agentic', 'agentic-baseline', large!, phase, consumer, metric)
      return s && l ? l.map((v, i) => v / s[i]!) : undefined
    }
    const aa = validControls ? controls.flatMap(r => growth(r) ?? []) : []
    const spread = aa.length ? Math.max(...aa.map(r => Math.max(r, 1 / r))) : Infinity
    const calibrated = validControls && aa.length === controls.reduce((sum, r) => sum + r.config.rounds, 0) && spread <= policy.maximumControlSpread[metric]
    const ab = growth(candidate), ratio = ab ? median(ab) : undefined
    const budget = calibrated ? Math.max(policy.targets[metric], spread * policy.calibrationMargin) : undefined
    scalingGrowth.push({ workload: `${large}/${small}`, phase, consumer, metric, ratio, target: policy.targets[metric], budget, controls: aa, blocking: calibrated,
      status: !calibrated ? 'uncalibrated' : ratio === undefined ? 'unavailable' : ratio <= budget! ? 'pass' : 'fail' })
  }
  const semanticCoverage = Object.fromEntries([...new Set(observations.map(o => o.peer))].map(peer => {
    const rows = observations.filter(o => o.peer === peer)
    return [peer, { verified: rows.filter(o => o.semantic?.ok).length, unavailable: rows.filter(o => !o.semantic?.ok && !o.semantic?.failures?.length).length, failures: rows.filter(o => o.semantic?.failures?.length).length,
      checks: [...new Set(rows.flatMap(o => o.semantic?.checks ?? []))], unsupported: [...new Set(rows.flatMap(o => o.semantic?.unsupported ?? []))] }]
  }))
  const cacheDiagnostics = observations.map(o => {
    const owners: Record<string, { hit: number; miss: number; bypass: number; storeSkipped: number; hitRate?: number }> = {}
    const fallbacks: Record<string, number> = {}
    for (const [event, count] of Object.entries(o.diagnostics?.counts ?? {})) {
      const [kind, owner, outcome, ...reason] = event.split(':')
      if (kind === 'cache' && owner) {
        const counter = owners[owner] ??= { hit: 0, miss: 0, bypass: 0, storeSkipped: 0 }
        if (outcome === 'hit' || outcome === 'miss' || outcome === 'bypass') counter[outcome] += count
        if (outcome === 'store-skipped') counter.storeSkipped += count
      }
      if (kind === 'fallback') fallbacks[[owner, outcome, ...reason].filter(Boolean).join(':')] = count
    }
    for (const counter of Object.values(owners)) if (counter.hit + counter.miss) counter.hitRate = counter.hit / (counter.hit + counter.miss)
    const observed = o.diagnostics?.status === 'observed' && o.diagnostics?.complete === true
    return { peer: o.peer, round: o.round, workload: o.workload, phase: o.phase, consumer: o.consumer, status: o.diagnostics?.status ?? 'unobserved', complete: o.diagnostics?.complete === true, owners, fallbacks,
      observedFallbackCount: observed ? Object.values(fallbacks).reduce((sum, count) => sum + count, 0) : null }
  })
  const allGates = [...gates, ...scalingGrowth]
  const blockingFailure = checks.some(c => !c.ok) || allGates.some(g => g.blocking && (g.status === 'fail' || g.status === 'unavailable'))
  return { schemaVersion: 1, contract: policy, executionScope: scope ?? null, campaignComplete: scope === undefined, scopeQualified: !blockingFailure && allGates.every(g => g.status === 'pass'), status: blockingFailure ? 'failed' : allGates.some(g => !g.blocking) ? 'uncalibrated' : 'passed', ok: !blockingFailure, performanceQualified: !scope && !blockingFailure && allGates.every(g => g.status === 'pass'), checks,
    releaseRegression: gates.filter(g => !g.peer), peerCompetitiveness: gates.filter(g => g.peer), peerCohortSummary, coverage: fullCoverage, semanticCoverage, cacheDiagnostics,
    calibration: { validControls, reason: calibrationReason, controlRuns: controls.map(r => r.runId), fingerprint: fingerprint(candidate) },
    scaling: { workloads: policy.scaling, growth: scalingGrowth, policy: 'Larger tree/mesh cases have separate targets and a normalized doubled-size cost-ratio gate. Neither is an asymptotic complexity proof. Canonical release scaling coverage remains separate.' },
    limits: 'Semantic checks establish the declared output contract, not aesthetic equivalence. Peers without observable authored endpoints/identities retain label-checked timings but cannot pass semantic performance gates. Allocation estimates exclude native/WASM memory. First-use tails need at least 20 fresh-process calls per round; cold allocation needs three separate first-render probes and cold diagnostics need their own successful fresh-worker replay. Cache hit rates count actual hits/(hits+misses), excluding bypass, from separate untimed replays; uninstrumented peers remain unobserved and fallback coverage is limited to the named owners. Uncalibrated checks cannot establish readiness.' }
}

export interface SemanticPerformanceShard {
  cache: string
  scope: PerformanceScope
  scopeComplete: boolean
  candidateSha: string
  baselineSha: string
  candidate?: PerformanceReport
  controls?: PerformanceReport[]
  evidence?: string
  error?: string
}

function identity(report: PerformanceReport): string {
  const settings: Record<string, unknown> = { ...report.tracksConfig }
  delete settings.phases
  delete settings.consumers
  const policy: Record<string, unknown> = { ...report.policy }
  delete policy.elkCache
  return JSON.stringify({ settings, policy, timing: report.config.timing, rounds: report.config.rounds,
    node: report.environment.node, platform: report.environment.platform, arch: report.environment.arch,
    pins: [...report.pins].sort((a, b) => a.peer.localeCompare(b.peer)).map(pin => ({ peer: pin.peer, integrity: pin.integrity,
      source: pin.source, runtimeDependencySha256: pin.runtimeDependencySha256, archive: pin.identity?.sha256 })) })
}

export function aggregateSemanticPerformance(shards: readonly SemanticPerformanceShard[]) {
  const expected = ['off', 'on'].flatMap(cache => PEER_PHASES.flatMap(phase => PEER_CONSUMERS.map(consumer => `${cache}/${phase}/${consumer}`)))
  const key = (shard: SemanticPerformanceShard) => `${shard.cache}/${shard.scope?.phase}/${shard.scope?.consumer}`
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = []
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail ? { detail } : {}) })
  check('Every cache/phase/consumer shard is present exactly once', shards.length === expected.length && expected.every(id => shards.filter(s => key(s) === id).length === 1), shards.map(key).join(', '))
  check('No unexpected shard can replace required evidence', shards.every(s => expected.includes(key(s))))
  const scores: Array<{ cache: string; scope: PerformanceScope; environment: PerformanceReport['environment']; runId: string; controlRunIds: string[]; evidence?: string; score: ReturnType<typeof performanceScorecard> }> = []
  let commonIdentity: string | undefined
  const runIds = new Set<string>()
  for (const shard of shards) {
    const label = key(shard), candidate = shard.candidate, controls = shard.controls
    const completed = shard.scopeComplete && !!candidate && candidate.status === 'completed' && controls?.length === PERFORMANCE_POLICY.minimumControlRuns && controls.every(r => r.status === 'completed')
    check(`${label}: all three reports completed`, !!completed, shard.error)
    if (!completed || !candidate || !controls || !expected.includes(label)) continue
    const readable = [candidate, ...controls].every(r => r.policy && r.config && r.environment && Array.isArray(r.pins) && r.pins.every(p => p && typeof p.peer === 'string') && Array.isArray(r.tracks?.observations))
    check(`${label}: reports retain their protocol metadata`, readable)
    if (!readable) continue
    const inputs = candidate.tracksConfig?.inputs as Record<string, { source?: unknown; expected?: unknown }> | undefined
    check(`${label}: complete authored input identity is retained`, !!inputs && [...PERFORMANCE_POLICY.fullAgenticCoverage, ...PERFORMANCE_POLICY.scaling].every(id => typeof inputs[id]?.source === 'string' && inputs[id]!.source !== '' && Array.isArray(inputs[id]?.expected) && (inputs[id]!.expected as unknown[]).length > 0))
    check(`${label}: cache lane is actual`, [candidate, ...controls].every(r => r.policy.elkCache === shard.cache))
    check(`${label}: archived bytes match the qualification receipt`, /^[a-f0-9]{64}$/.test(shard.candidateSha) && /^[a-f0-9]{64}$/.test(shard.baselineSha)
      && candidate.pins.find(p => p.peer === 'agentic')?.identity?.sha256 === shard.candidateSha
      && candidate.pins.find(p => p.peer === 'agentic-baseline')?.identity?.sha256 === shard.baselineSha)
    for (const report of [candidate, ...controls]) {
      check(`${label}: report ${report.runId} has its own process identity`, !!report.runId && !runIds.has(report.runId))
      runIds.add(report.runId)
    }
    const signature = identity(candidate)
    commonIdentity ??= signature
    check(`${label}: archive, peer, harness, inputs and execution settings match the campaign`, signature === commonIdentity)
    check(`${label}: peer identities match both controls`, candidate.pins.filter(p => !p.peer.startsWith('agentic')).every(p => controls.every(r => {
      const actual = r.pins.find(other => other.peer === p.peer)
      return !!actual && actual.integrity === p.integrity && actual.runtimeDependencySha256 === p.runtimeDependencySha256 && JSON.stringify(actual.source) === JSON.stringify(p.source)
    })))
    try {
      const score = performanceScorecard(candidate, controls, shard.scope)
      check(`${label}: enrollment, source and calibration contracts hold`, score.checks.every(c => c.ok), score.checks.filter(c => !c.ok).map(c => c.name).join('; '))
      check(`${label}: controls stayed with their own runner`, score.calibration.validControls)
      scores.push({ cache: shard.cache, scope: shard.scope, environment: candidate.environment, runId: candidate.runId,
        controlRunIds: controls.map(r => r.runId), evidence: shard.evidence, score })
    } catch (error) {
      check(`${label}: readable scoped evidence`, false, String(error))
    }
  }
  const campaignComplete = checks.every(c => c.ok) && scores.length === expected.length
  const failed = !campaignComplete || scores.some(s => !s.score.ok)
  const performanceQualified = campaignComplete && scores.every(s => s.score.scopeQualified)
  return { schemaVersion: 1, contract: PERFORMANCE_POLICY, campaignComplete, performanceQualified, ok: !failed,
    status: failed ? 'failed' : performanceQualified ? 'passed' : 'uncalibrated', checks, shards: scores,
    limits: 'Each ratio and cohort mean belongs to one shard and its own same-runner controls. No timings, hostnames or controls are pooled across machines. All16 cache/phase/consumer shards are required. An uncalibrated cell is not a pass.' }
}


export function performanceMarkdown(score: ReturnType<typeof performanceScorecard>): string {
  const lines = ['# Calibrated semantic performance gates', ...(score.executionScope ? ['', `Execution shard: ${score.executionScope.phase} / ${score.executionScope.consumer}. Shard qualified: ${score.scopeQualified}. Full qualification requires the complete aggregate.`] : []), '', `Status: **${score.status}**. Performance qualified: **${score.performanceQualified}**.`, '',
    'Release regressions and peer competitiveness have separate scorecards. Ratios are Agentic/comparator; lower is better. Every fixed case remains in the denominator. Uncalibrated rows are advisory, not passes.', '', '## Completeness and semantics', '',
    ...score.checks.map(c => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`)]
  for (const [title, gates] of [['Release regression', score.releaseRegression], ['Peer competitiveness', score.peerCompetitiveness], ['Scaling growth (candidate size ratio / baseline size ratio)', score.scaling.growth]] as const) {
    lines.push('', `## ${title}`, '', '| Workload | Phase | Consumer | Comparator | Metric | Ratio | Target | Calibrated budget | Decision |', '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |')
    for (const g of gates) lines.push(`| ${g.workload} | ${g.phase} | ${g.consumer} | ${g.peer ?? 'baseline'} | ${g.metric} | ${g.ratio?.toFixed(4) ?? '—'} | ${g.target.toFixed(2)} | ${g.budget?.toFixed(4) ?? '—'} | ${g.status}${g.blocking ? ' (blocking)' : ''} |`)
  }
  lines.push('', '## Fixed seven-case peer scorecard', '', 'Geometric mean of per-case median same-round Agentic/peer ratios; all seven cases required. Label-checked scores remain distinct from semantic qualification and never shrink to the successful intersection.', '', '| Peer | Phase | Metric | Agentic / peer | All seven semantic contracts observable |', '| --- | --- | --- | ---: | --- |')
  for (const row of score.peerCohortSummary) lines.push(`| ${row.peer} | ${row.phase} | ${row.metric} | ${row.labelCheckedRatio?.toFixed(4) ?? 'unavailable'} | ${row.semanticComplete} |`)
  lines.push('', '## Semantic observability', '', '| Peer | Verified rows | Unavailable rows | Failed rows | Unavailable contracts |', '| --- | ---: | ---: | ---: | --- |')
  for (const [peer, row] of Object.entries(score.semanticCoverage)) lines.push(`| ${peer} | ${row.verified} | ${row.unavailable} | ${row.failures} | ${row.unsupported.join('; ')} |`)
  lines.push('', '## Observed cache hits and fallbacks', '', 'Separate untimed replays, with a fresh first-render worker for cold diagnostics. Peers without the diagnostic seam remain unobserved. Per-owner counts and hit rates, bypasses, skipped stores and fallback reasons are retained per case/phase/round in gates.json and the raw worker reports.', '')
  const observed = score.cacheDiagnostics.filter(r => r.peer === 'agentic' && r.status === 'observed' && r.complete)
  lines.push(`Successful observed Agentic replays: ${observed.length}; fallback events at the instrumented owners: ${observed.length ? observed.reduce((sum, row) => sum + (row.observedFallbackCount ?? 0), 0) : 'unobserved'}.`, '')
  const events = new Map<string, number>()
  for (const row of score.cacheDiagnostics.filter(r => r.peer === 'agentic')) {
    for (const [owner, count] of Object.entries(row.owners)) for (const kind of ['hit', 'miss', 'bypass', 'storeSkipped'] as const) events.set(`${owner}/${kind}`, (events.get(`${owner}/${kind}`) ?? 0) + count[kind])
    for (const [reason, count] of Object.entries(row.fallbacks)) events.set(`fallback/${reason}`, (events.get(`fallback/${reason}`) ?? 0) + count)
  }
  lines.push('| Actual event | Count |', '| --- | ---: |', ...[...events].map(([event, count]) => `| ${event} | ${count} |`))
  lines.push('', score.limits, '')
  return lines.join('\n')
}

if (import.meta.main) {
  const args = process.argv.slice(2), get = (flag: string) => args[args.indexOf(flag) + 1]
  if (!args.includes('--candidate') || !args.includes('--controls') || !args.includes('--out')) throw new Error('Use --candidate report.json --controls aa1.json,aa2.json --out path-prefix')
  const read = (p: string) => JSON.parse(readFileSync(resolve(p), 'utf8')) as PerformanceReport
  const score = performanceScorecard(read(get('--candidate')!), get('--controls')!.split(',').map(read))
  writeFileSync(`${get('--out')}.json`, `${JSON.stringify(score, null, 2)}\n`)
  writeFileSync(`${get('--out')}.md`, performanceMarkdown(score))
  console.log(`Semantic performance: ${score.status}; ${score.peerCompetitiveness.filter(g => g.blocking && g.status === 'fail').length} blocking peer misses; machine ${cpus()[0]?.model}`)
  if (!score.ok) process.exitCode = 1
}
