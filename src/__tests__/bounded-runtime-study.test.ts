import { expect, test } from 'bun:test'
import { boundedRuntimeScorecard, boundedRuntimeSelection, BOUNDED_RUNTIME_WORKLOADS } from '../../eval/benchmark/bounded-runtime-study.ts'
import { emptyTrackObservation } from '../../eval/benchmark/peer-tracks.ts'
import type { SchedulerStudyReport } from '../../eval/benchmark/scheduler-study-validation.ts'

const baseline = 'a'.repeat(64), candidate = 'b'.repeat(64), harness = 'c'.repeat(40), graph = 'd'.repeat(64)
type Scope = Parameters<typeof boundedRuntimeScorecard>[1]
const standard: Scope = { phase: 'warm-new-source', consumer: 'svg-utf8', cache: 'off' }
function entries(scope: Scope = standard, allocation = 80) {
  return ['aa-1', 'aa-2', 'candidate'].map(id => {
    const cold = scope.phase === 'first-use', count = cold ? 21 : 201
    const report: SchedulerStudyReport = { runId: id, status: 'completed', environment: { node: 'v24.19.0', cpu: 'cpu', hostname: 'same-host' },
      config: { rounds: 5, timing: {}, workloads: { svg: [...BOUNDED_RUNTIME_WORKLOADS] } },
      policy: { elkCache: scope.cache, sceneAssertions: 'off', nodeExposeGc: true, finalUntimedGc: true, executionEnvironment: { experiments: null, nodeOptions: null, bunOptions: null, nodeEnv: null, timezone: null } },
      tracksConfig: { samples: 201, coldSamples: 21, allocationSamples: 3, harnessRevision: harness, harnessDirty: false, schedule: 'peer-block-v1', consumption: 'indexed-utf8-checksum-v1', warmupSources: 'fresh-edit-ordinals-v1', inputs: Object.fromEntries(BOUNDED_RUNTIME_WORKLOADS.map(id => [id, { source: `source:${id}`, expected: ['label'] }])) },
      pins: ['agentic', 'agentic-baseline'].map(peer => ({ peer, runtimeDependencySha256: graph, identity: { kind: 'tarball', sha256: id === 'candidate' && peer === 'agentic' ? candidate : baseline, integrity: 'sha512-fixed' } })),
      tracks: { schemaVersion: 1, contractVersion: 'semantic-peer-v1', cohort: [], phases: [scope.phase], consumers: [scope.consumer], observations: [] },
    }
    for (const peer of ['agentic', 'agentic-baseline']) for (let round = 0; round < 5; round++) for (const workload of BOUNDED_RUNTIME_WORKLOADS) {
      const row = emptyTrackObservation(peer, round, workload, scope.phase, scope.consumer)
      row.semantic = { ok: true, checks: ['authored text and geometry'], failures: [], unsupported: [] }
      row.callSamplesMs = Array(count).fill(1)
      row.calls = Array.from({ length: cold ? 25 : count }, (_, index) => ({ index, variant: 0, status: 'ok', ...(index < count ? { elapsedMs: 1 } : {}), consumedBytes: 10, checksum: 42, semantic: row.semantic }))
      row.allocationSamplesBytes = Array(3).fill(id === 'candidate' && peer === 'agentic' ? allocation : 100)
      row.diagnostics = { status: 'observed', complete: true, counts: {}, events: [] }
      if (!cold) row.warmup = { calls: 20, elapsedMs: 1000, complete: true }
      report.tracks.observations.push(row)
    }
    return { id, report, exit: 0 }
  })
}
const score = (scope: Scope = standard, allocation = 80) => boundedRuntimeScorecard(entries(scope, allocation), scope, baseline, candidate, harness, 'peer-block-v1')

test('bounded assessment distinguishes a calibrated improvement from a budget pass', () => {
  const result = score()
  expect(result.complete).toBe(true)
  expect(result.performanceQualified).toBe(false)
  expect(result.cells.filter(cell => cell.metric === 'allocation').every(cell => cell.improvement && cell.ratio === .8)).toBe(true)
  expect(score(standard, 99).cells.filter(cell => cell.metric === 'allocation').every(cell => cell.status === 'pass' && !cell.improvement)).toBe(true)
})

test.each(['duplicate', 'wrong-pin', 'different-host', 'curated-clock', 'missing-byte-consumer', 'missing-warmup'] as const)('bounded assessment fails closed on %s', fault => {
  const input = entries(), report = input[1]!.report, row = report.tracks.observations[0]!
  if (fault === 'duplicate') report.tracks.observations[1] = structuredClone(row)
  if (fault === 'wrong-pin') report.pins[0]!.identity!.sha256 = candidate
  if (fault === 'different-host') report.environment.hostname = 'other-host'
  if (fault === 'curated-clock') row.callSamplesMs[0] = .01
  if (fault === 'missing-byte-consumer') row.calls[0]!.consumedBytes = undefined
  if (fault === 'missing-warmup') row.warmup!.complete = false
  expect(boundedRuntimeScorecard(input, standard, baseline, candidate, harness, 'peer-block-v1').complete).toBe(false)
})

test('noisy controls and zero allocation stay uncalibrated without hiding a candidate regression', () => {
  const input = entries()
  input[0]!.report.tracks.observations[0]!.allocationSamplesBytes.fill(200)
  input[2]!.report.tracks.observations[0]!.allocationSamplesBytes.fill(1000)
  const noisy = boundedRuntimeScorecard(input, standard, baseline, candidate, harness, 'peer-block-v1')
  expect(noisy.complete).toBe(true)
  expect(noisy.cells.find(cell => cell.workload === 'flow5' && cell.metric === 'allocation')!.status).toBe('uncalibrated')
  const zeros = entries()
  for (const entry of zeros) for (const row of entry.report.tracks.observations) row.allocationSamplesBytes.fill(0)
  expect(boundedRuntimeScorecard(zeros, standard, baseline, candidate, harness, 'peer-block-v1').cells.filter(cell => cell.metric === 'allocation').every(cell => cell.status === 'uncalibrated' && !cell.improvement)).toBe(true)
  expect(score(standard, 120).cells.filter(cell => cell.metric === 'allocation').every(cell => cell.status === 'fail')).toBe(true)
})

test('selection requires every fixed scope and the frozen primary improvement; retention remains provisional', () => {
  const scopes: Scope[] = ['warm-new-source', 'exact-repeat'].flatMap(phase => ['svg-utf8', 'receipt-json-utf8'].flatMap(consumer => ['off', 'on'].map(cache => ({ phase, consumer, cache } as Scope))))
  const cards = scopes.map(scope => score(scope))
  const selected = boundedRuntimeSelection('warm-a', cards)
  expect(selected.complete).toBe(true)
  expect(selected.provisionalKeep).toBe(true)
  expect(selected.performanceQualified).toBe(false)
  expect(boundedRuntimeSelection('warm-a', cards.slice(1)).complete).toBe(false)
  expect(boundedRuntimeSelection('warm-a', scopes.map(scope => score(scope, 99))).provisionalKeep).toBe(false)
  const adverse = [...cards.slice(0, -1), score(scopes.at(-1)!, 120)]
  expect(boundedRuntimeSelection('warm-a', adverse).provisionalKeep).toBe(false)
})

test('cold-only B improvement needs the ON direction and a complete warm receipt guard', () => {
  const scopes: Scope[] = ['svg-utf8', 'receipt-json-utf8'].flatMap(consumer => ['off', 'on'].map(cache => ({ phase: 'first-use', consumer, cache } as Scope)))
  scopes.push({ phase: 'exact-repeat', consumer: 'receipt-json-utf8', cache: 'on' })
  const cards = scopes.map(scope => score(scope))
  expect(boundedRuntimeSelection('cold-b', cards).provisionalKeep).toBe(true)
  const noDirection = cards.map(card => card.scope.phase === 'first-use' && card.scope.consumer === 'svg-utf8' && card.scope.cache === 'on' ? score(card.scope, 100) : card)
  expect(boundedRuntimeSelection('cold-b', noDirection).provisionalKeep).toBe(false)
  expect(boundedRuntimeSelection('cold-b', cards.slice(0, 4)).complete).toBe(false)
})
