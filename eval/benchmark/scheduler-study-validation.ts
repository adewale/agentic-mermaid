import type { PerformanceReport } from './performance-gates.ts'
import type { PeerTrackObservation } from './peer-tracks.ts'

export interface SchedulerStudyReport extends Omit<PerformanceReport, 'policy' | 'config' | 'pins' | 'tracks'> {
  policy: PerformanceReport['policy'] & { sceneAssertions?: string; nodeExposeGc?: boolean; finalUntimedGc?: boolean }
  config: PerformanceReport['config'] & { workloads?: { svg?: string[] } }
  pins: Array<PerformanceReport['pins'][number] & { identity?: { kind?: string; sha256?: string } }>
  tracks: Omit<PerformanceReport['tracks'], 'observations'> & { observations: PeerTrackObservation[] }
}

export interface SchedulerStudyDesign {
  sourceRevision: string
  harnessRevision: string
  order: string[]
  workloads: string[]
  rounds: number
  clocksPerCaseSideRound: number
  allocationProbesPerCaseSideRound: number
}

/** Validate enrollment and identity only; a complete study is never a numeric pass. */
export function validateSchedulerStudy(design: SchedulerStudyDesign, archive: string, entries: Array<{ id: string; report: SchedulerStudyReport; execution: { exit: number; schedule: string } }>) {
  const peers = ['agentic', 'agentic-baseline']
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const fingerprints: string[] = []
  const reports = entries.map(({ id, report, execution }) => {
    const checks: Record<string, boolean> = {}
    const rows = report.tracks?.observations ?? []
    const schedule = id.startsWith('paired-') ? 'paired-cold-ordinal-v1' : 'peer-block-v1'
    const settings = report.tracksConfig ?? {} as NonNullable<PerformanceReport['tracksConfig']>
    const key = (row: { peer: string; round: number; workload: string; phase: string; consumer: string }) => JSON.stringify([row.peer, row.round, row.workload, row.phase, row.consumer])
    const expectedKeys = peers.flatMap(peer => Array.from({ length: design.rounds }, (_, round) => design.workloads.map(workload => key({ peer, round, workload, phase: 'first-use', consumer: 'svg-utf8' })))).flat().sort()
    checks.enrollment = equal(rows.map(key).sort(), expectedKeys)
    checks.completed = execution.exit === 0 && report.status === 'completed'
    checks.method = execution.schedule === schedule && settings.schedule === schedule && equal(report.tracks?.phases, ['first-use']) && equal(report.tracks?.consumers, ['svg-utf8']) && report.tracks?.contractVersion === 'semantic-peer-v1'
    checks.inputs = equal(Object.keys(settings.inputs as object ?? {}).sort(), [...design.workloads].sort()) && equal(report.config.workloads?.svg, design.workloads) && report.config.rounds === design.rounds
    checks.harness = settings.harnessRevision === design.harnessRevision && settings.harnessDirty === false && /^[a-f0-9]{40}$/.test(design.sourceRevision)
    checks.sampling = settings.coldSamples === design.clocksPerCaseSideRound && settings.allocationSamples === design.allocationProbesPerCaseSideRound && settings.consumption === 'indexed-utf8-checksum-v1' && settings.warmupSources === 'fresh-edit-ordinals-v1'
    checks.policy = report.policy.elkCache === 'on' && report.policy.sceneAssertions === 'off' && report.policy.nodeExposeGc === true && report.policy.finalUntimedGc === true && report.policy.executionEnvironment?.experiments === null && Object.keys(report.policy.aplEnvironment ?? {}).length === 0
    const pins = report.pins ?? []
    checks.archives = equal(pins.map(pin => pin.peer).sort(), [...peers].sort()) && pins.every(pin => pin.identity?.kind === 'tarball' && pin.identity.sha256 === archive && /^sha512-/.test(pin.integrity ?? '')) && pins[0]?.integrity === pins[1]?.integrity
    checks.runtime = pins.every(pin => /^[a-f0-9]{64}$/.test(pin.runtimeDependencySha256 ?? '')) && pins[0]?.runtimeDependencySha256 === pins[1]?.runtimeDependencySha256
    checks.observations = rows.every(row => row.status === 'ok' && row.semantic?.ok === true && row.semantic.failures.length === 0 && row.callSamplesMs.length === design.clocksPerCaseSideRound && row.callSamplesMs.every(value => Number.isFinite(value) && value > 0) && row.allocationSamplesBytes.length === design.allocationProbesPerCaseSideRound && row.allocationSamplesBytes.every(value => Number.isFinite(value) && value >= 0) && row.calls.length === design.clocksPerCaseSideRound + design.allocationProbesPerCaseSideRound + 1 && row.calls.filter(call => call.elapsedMs !== undefined).length === design.clocksPerCaseSideRound && row.calls.every(call => call.status === 'ok') && row.diagnostics.status === 'observed' && row.diagnostics.complete === true)
    const { schedule: _schedule, ...commonSettings } = settings
    const environment = report.environment
    fingerprints.push(JSON.stringify({ settings: commonSettings, policy: report.policy, timing: report.config.timing, version: report.tracks?.contractVersion, environment: { node: environment.node, cpu: environment.cpu, cpus: environment.logicalCpus, platform: environment.platform, arch: environment.arch, os: environment.osRelease, hostname: environment.hostname }, pins: pins.map(pin => ({ peer: pin.peer, archive: pin.identity?.sha256, integrity: pin.integrity, graph: pin.runtimeDependencySha256 })) }))
    return { id, runId: report.runId, complete: Object.values(checks).every(Boolean), checks, clocks: rows.reduce((n, row) => n + row.callSamplesMs.length, 0), probes: rows.reduce((n, row) => n + row.allocationSamplesBytes.length, 0), completedDiagnostics: rows.filter(row => row.diagnostics?.complete).length }
  })
  const matchingReports = equal(entries.map(entry => entry.id), design.order) && reports.every(report => typeof report.runId === 'string' && report.runId.length > 0) && new Set(reports.map(report => report.runId)).size === design.order.length && fingerprints.length === design.order.length && new Set(fingerprints).size === 1
  return { complete: matchingReports && reports.every(report => report.complete), matchingReports, performanceQualified: false, scope: 'partial diagnostic same-archive controls', reports }
}
