import { describe, expect, test } from 'bun:test'
import { PERFORMANCE_POLICY as policy, performanceScorecard, type PerformanceReport } from '../../eval/benchmark/performance-gates.ts'

const beforeSha = 'a'.repeat(64), afterSha = 'b'.repeat(64)
function report(id: string, aa = false): PerformanceReport {
  const observations: PerformanceReport['tracks']['observations'] = []
  for (const peer of ['agentic', 'agentic-baseline', ...policy.competitivePeers]) for (let round = 0; round < 5; round++) for (const workload of [...policy.fullAgenticCoverage, ...policy.scaling]) for (const phase of policy.phases) for (const consumer of policy.consumers) {
    const unsupported = consumer === 'receipt-json-utf8' && !peer.startsWith('agentic')
    observations.push({ peer, round, workload, phase, consumer, status: unsupported ? 'unsupported' : 'ok', callSamplesMs: Array(31).fill(1), allocationSamplesBytes: [100, 100, 100],
      semantic: { ok: !unsupported, checks: unsupported ? [] : ['labels', 'xml', 'authored structure'], failures: [], unsupported: unsupported ? ['no receipt API'] : [] }, diagnostics: { status: peer === 'agentic' ? 'observed' : 'unobserved', complete: true, counts: {} } })
  }
  return { status: 'completed', runId: id, config: { rounds: 5, timing: { warmupMs: 250 } }, policy: { elkCache: 'off', aplEnvironment: {} },
    environment: { node: '24.19.0', cpu: 'test', hostname: 'same-runner', platform: 'linux', arch: 'x64', logicalCpus: 4 },
    pins: [{ peer: 'agentic', runtimeDependencySha256: beforeSha, identity: { sha256: aa ? beforeSha : afterSha } }, { peer: 'agentic-baseline', runtimeDependencySha256: beforeSha, identity: { sha256: beforeSha } }, ...policy.competitivePeers.map(peer => ({ peer, runtimeDependencySha256: beforeSha, integrity: 'sha512-pinned', source: { version: '1' } }))],
    tracksConfig: { samples: 31, allocationSamples: 3, sourceSha256: 'source-contract' }, tracks: { schemaVersion: 1, contractVersion: policy.version, cohort: policy.cohort, observations } }
}
const setup = () => ({ candidate: report('ab'), controls: [report('aa1', true), report('aa2', true)] })

describe('calibrated semantic performance decisions', () => {
  test('doubled-size growth has its own gate even when each large case stays within budget', () => {
    const { candidate, controls } = setup()
    for (const row of candidate.tracks.observations) if (row.peer === 'agentic' && row.phase === 'exact-repeat' && row.consumer === 'svg-utf8') {
      if (row.workload === 'tree50') row.callSamplesMs.fill(.9)
      if (row.workload === 'tree100') row.callSamplesMs.fill(1.04)
    }
    const result = performanceScorecard(candidate, controls)
    expect(result.releaseRegression.filter(g => g.workload === 'tree100' && g.metric === 'p50').every(g => g.status === 'pass')).toBe(true)
    expect(result.scaling.growth.find(g => g.workload === 'tree100/tree50' && g.phase === 'exact-repeat' && g.consumer === 'svg-utf8' && g.metric === 'p50')?.status).toBe('fail')
    expect(result.ok).toBe(false)
  })

  test('unobservable peer semantics cannot pass gates or hide the fixed label-checked scorecard', () => {
    const { candidate, controls } = setup()
    for (const r of [candidate, ...controls]) for (const row of r.tracks.observations) if (row.peer === 'pele' && row.consumer === 'svg-utf8') {
      row.semantic.ok = false
      row.semantic.unsupported = ['peer does not expose authored directed endpoints']
      row.callSamplesMs.fill(.1)
    }
    const result = performanceScorecard(candidate, controls)
    const score = result.peerCohortSummary.find(s => s.peer === 'pele' && s.phase === 'exact-repeat' && s.metric === 'p50')!
    expect(score.complete).toBe(true)
    expect(score.semanticComplete).toBe(false)
    expect(score.labelCheckedRatio).toBeCloseTo(10)
    expect(result.peerCompetitiveness.filter(g => g.peer === 'pele').every(g => !g.blocking && g.status === 'uncalibrated')).toBe(true)
    expect(result.performanceQualified).toBe(false)
  })

  test('complete identical observations qualify both separate scorecards', () => {
    const { candidate, controls } = setup(), result = performanceScorecard(candidate, controls)
    expect(result.ok).toBe(true)
    expect(result.performanceQualified).toBe(true)
    expect(result.releaseRegression.every(g => g.status === 'pass')).toBe(true)
    expect(result.peerCompetitiveness.every(g => g.status === 'pass')).toBe(true)
  })

  test('fast release comparison cannot hide poor peer competitiveness', () => {
    const { candidate, controls } = setup()
    for (const row of candidate.tracks.observations) if (row.peer === 'beautiful') row.callSamplesMs.fill(.1)
    const result = performanceScorecard(candidate, controls)
    expect(result.releaseRegression.every(g => g.status === 'pass')).toBe(true)
    expect(result.peerCompetitiveness.some(g => g.peer === 'beautiful' && g.metric === 'p50' && g.status === 'fail' && g.blocking)).toBe(true)
    expect(result.ok).toBe(false)
  })

  test('per-call p95 catches a tail regression hidden by an unchanged median', () => {
    const { candidate, controls } = setup()
    for (const row of candidate.tracks.observations) if (row.peer === 'agentic' && row.workload === 'mesh100') row.callSamplesMs.splice(29, 2, 10, 10)
    const result = performanceScorecard(candidate, controls)
    expect(result.releaseRegression.find(g => g.workload === 'mesh100' && g.metric === 'p50')?.status).toBe('pass')
    expect(result.releaseRegression.find(g => g.workload === 'mesh100' && g.metric === 'p95')?.status).toBe('fail')
    expect(result.ok).toBe(false)
  })

  test('missing or invalid semantic cases cannot shrink the fixed cohort', () => {
    for (const failure of ['missing', 'lost-labels', 'semantic'] as const) {
      const { candidate, controls } = setup()
      const row = candidate.tracks.observations.find(o => o.peer === 'pele' && o.workload === 'state80')!
      if (failure === 'missing') candidate.tracks.observations.splice(candidate.tracks.observations.indexOf(row), 1)
      if (failure === 'lost-labels') row.status = failure
      if (failure === 'semantic') row.semantic.ok = false
      expect(performanceScorecard(candidate, controls).ok).toBe(false)
    }
  })

  test('noisy controls cannot create generous blocking budgets or count as passes', () => {
    const { candidate, controls } = setup()
    for (const row of controls[0]!.tracks.observations) if (row.peer === 'agentic') row.callSamplesMs.fill(2)
    const result = performanceScorecard(candidate, controls)
    expect(result.status).toBe('uncalibrated')
    expect(result.performanceQualified).toBe(false)
    expect(result.releaseRegression.filter(g => g.metric !== 'allocation').every(g => g.status === 'uncalibrated' && !g.blocking && g.budget === undefined)).toBe(true)
  })

  test('calibration binds runner, archive, cache mode and independent run IDs', () => {
    for (const change of ['host', 'archive', 'cache', 'duplicate'] as const) {
      const { candidate, controls } = setup()
      if (change === 'host') controls[0]!.environment.hostname = 'other-runner'
      if (change === 'archive') controls[0]!.pins[0]!.identity!.sha256 = afterSha
      if (change === 'cache') controls[0]!.policy.elkCache = 'on'
      if (change === 'duplicate') controls[1]!.runId = controls[0]!.runId
      const result = performanceScorecard(candidate, controls)
      expect(result.calibration.validControls).toBe(false)
      expect(result.performanceQualified).toBe(false)
      expect(result.releaseRegression.every(g => !g.blocking)).toBe(true)
    }
  })

  test('cold one-call tails and zero allocation retain unavailable calibration', () => {
    const { candidate, controls } = setup()
    for (const r of [candidate, ...controls]) for (const row of r.tracks.observations) if (row.phase === 'first-use') {
      row.callSamplesMs = [1]
      row.allocationSamplesBytes = [0, 0, 0]
    }
    const result = performanceScorecard(candidate, controls)
    expect(result.releaseRegression.filter(g => g.phase === 'first-use' && g.metric !== 'p50').every(g => g.status === 'uncalibrated')).toBe(true)
    expect(result.performanceQualified).toBe(false)
  })

  test('observed cache reporting is required and duplicate rows are rejected', () => {
    const { candidate, controls } = setup()
    const warm = candidate.tracks.observations.find(o => o.phase === 'exact-repeat' && o.peer === 'agentic')!
    warm.diagnostics.status = 'unobserved'
    expect(performanceScorecard(candidate, controls).ok).toBe(false)
    warm.diagnostics.status = 'observed'
    candidate.tracks.observations.push(candidate.tracks.observations[0]!)
    expect(performanceScorecard(candidate, controls).ok).toBe(false)
  })

  test('allocation is a separate gate and peer pin changes invalidate calibration', () => {
    const { candidate, controls } = setup()
    for (const row of candidate.tracks.observations) if (row.peer === 'agentic') row.allocationSamplesBytes.fill(150)
    const result = performanceScorecard(candidate, controls)
    expect(result.releaseRegression.find(g => g.metric === 'p50')?.status).toBe('pass')
    expect(result.releaseRegression.find(g => g.metric === 'allocation')?.status).toBe('fail')
    candidate.pins.find(p => p.peer === 'pele')!.integrity = 'sha512-other'
    expect(performanceScorecard(candidate, controls).peerCompetitiveness.filter(g => g.peer === 'pele').every(g => !g.blocking)).toBe(true)
  })

  test('a failed A/A observation cannot turn a tenfold warm regression into successful qualification', () => {
    const { candidate, controls } = setup()
    const matching = (row: PerformanceReport['tracks']['observations'][number]) =>
      row.peer === 'agentic' && row.workload === 'flow5' && row.phase === 'warm-new-source' && row.consumer === 'svg-utf8'
    for (const row of candidate.tracks.observations.filter(matching)) row.callSamplesMs.fill(10)
    controls[0]!.tracks.observations.find(matching)!.status = 'error'
    const result = performanceScorecard(candidate, controls)
    // Missing controls cannot calibrate this cell. That remains visible, while
    // the incomplete control makes the overall qualification fail closed.
    expect(result.releaseRegression.find(g => g.workload === 'flow5' && g.phase === 'warm-new-source' && g.consumer === 'svg-utf8' && g.metric === 'p50')?.status).toBe('uncalibrated')
    expect(result.ok).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.performanceQualified).toBe(false)
  })

  test('equal archive pins cannot hide different resolved runtime graphs on either Agentic side', () => {
    for (const side of ['candidate', 'baseline', 'control-candidate', 'control-baseline'] as const) {
      const { candidate, controls } = setup()
      const changed = side.startsWith('control-') ? controls[0]! : candidate
      const peer = side === 'candidate' || side === 'control-candidate' ? 'agentic' : 'agentic-baseline'
      changed.pins.find(pin => pin.peer === peer)!.runtimeDependencySha256 = 'c'.repeat(64)
      const result = performanceScorecard(candidate, controls)
      expect(result.ok).toBe(false)
      expect(result.status).toBe('failed')
      expect(result.performanceQualified).toBe(false)
    }
  })

  test('an observed scope cannot qualify a diagnostic replay that fails after the support signal', () => {
    const { candidate, controls } = setup()
    const row = candidate.tracks.observations.find(o => o.peer === 'agentic' && o.phase === 'exact-repeat')!
    row.diagnostics = { status: 'observed', complete: false, counts: { 'scope:graphical': 1 } }
    const result = performanceScorecard(candidate, controls)
    expect(result.ok).toBe(false)
    expect(result.status).toBe('failed')
    expect(result.performanceQualified).toBe(false)
    row.diagnostics.complete = true
    expect(performanceScorecard(candidate, controls).ok).toBe(true)
  })
})
