import { expect, test } from 'bun:test'
import { emptyTrackObservation } from '../../eval/benchmark/peer-tracks.ts'
import { validateSchedulerStudy, type SchedulerStudyDesign, type SchedulerStudyReport } from '../../eval/benchmark/scheduler-study-validation.ts'

const design: SchedulerStudyDesign = { sourceRevision: 'a'.repeat(40), harnessRevision: 'b'.repeat(40), order: ['blocked-aa1', 'paired-aa1', 'paired-aa2', 'blocked-aa2'], workloads: ['case'], rounds: 1, clocksPerCaseSideRound: 1, allocationProbesPerCaseSideRound: 1 }
const archive = 'c'.repeat(64)
function entries() {
  return design.order.map(id => {
    const schedule = id.startsWith('paired-') ? 'paired-cold-ordinal-v1' : 'peer-block-v1'
    const report: SchedulerStudyReport = {
      runId: id, status: 'completed', environment: { node: 'v24.19.0', hostname: 'one-host', cpu: 'cpu', platform: 'linux', arch: 'x64' },
      policy: { elkCache: 'on', sceneAssertions: 'off', nodeExposeGc: true, finalUntimedGc: true, executionEnvironment: { experiments: null, nodeOptions: null, bunOptions: null, nodeEnv: null, timezone: null } },
      config: { rounds: 1, timing: {}, workloads: { svg: ['case'] } },
      tracksConfig: { samples: 201, coldSamples: 1, allocationSamples: 1, schedule, inputs: { case: { source: 'fixed source', expected: ['label'] } }, harnessRevision: design.harnessRevision, harnessDirty: false, consumption: 'indexed-utf8-checksum-v1', warmupSources: 'fresh-edit-ordinals-v1' },
      pins: ['agentic', 'agentic-baseline'].map(peer => ({ peer, identity: { kind: 'tarball', sha256: archive, integrity: 'sha512-fixed' }, runtimeDependencySha256: 'd'.repeat(64) })),
      tracks: { schemaVersion: 1, contractVersion: 'semantic-peer-v1', cohort: [], phases: ['first-use'], consumers: ['svg-utf8'], observations: ['agentic', 'agentic-baseline'].map(peer => {
        const row = emptyTrackObservation(peer, 0, 'case', 'first-use', 'svg-utf8')
        row.status = 'ok'
        row.semantic = { ok: true, checks: ['bounded structure'], unsupported: [], failures: [] }
        row.calls = Array.from({ length: 3 }, (_, index) => ({ index, variant: 0, status: 'ok', ...(index === 0 ? { elapsedMs: 1 } : {}), consumedBytes: 42, checksum: 9, semantic: row.semantic }))
        row.callSamplesMs = [1]
        row.allocationSamplesBytes = [100]
        row.diagnostics = { status: 'observed', complete: true, counts: {}, events: [] }
        return row
      }) },
    }
    return { id, report, execution: { exit: 0, schedule } }
  })
}

test('fixed-study completeness binds enrollment and controls while retaining a diagnostic-only result', () => {
  const result = validateSchedulerStudy(design, archive, entries())
  expect(result.complete).toBe(true)
  expect(result.performanceQualified).toBe(false)
})

test.each(['duplicate-row', 'wrong-schedule', 'wrong-cache', 'wrong-archive', 'dirty-harness', 'changed-input', 'changed-runtime', 'missing-id', 'missing-diagnostic', 'registry-sri-instead-of-packed'] as const)('fixed-study completeness rejects %s without relying on totals', fault => {
  const input = entries(), report = input[1]!.report
  if (fault === 'duplicate-row') report.tracks.observations[1] = structuredClone(report.tracks.observations[0]!)
  if (fault === 'wrong-schedule') report.tracksConfig!.schedule = 'peer-block-v1'
  if (fault === 'wrong-cache') report.policy.elkCache = 'off'
  if (fault === 'wrong-archive') report.pins[0]!.identity!.sha256 = 'e'.repeat(64)
  if (fault === 'dirty-harness') report.tracksConfig!.harnessDirty = true
  if (fault === 'changed-input') report.tracksConfig!.inputs = { case: { source: 'substituted source', expected: ['label'] } }
  if (fault === 'changed-runtime') report.pins[0]!.runtimeDependencySha256 = 'e'.repeat(64)
  if (fault === 'missing-id') report.runId = ''
  if (fault === 'registry-sri-instead-of-packed') { report.pins[0]!.integrity = report.pins[0]!.identity!.integrity; delete report.pins[0]!.identity!.integrity }
  if (fault === 'missing-diagnostic') report.tracks.observations[0]!.diagnostics.complete = false
  expect(validateSchedulerStudy(design, archive, input).complete).toBe(false)
})
