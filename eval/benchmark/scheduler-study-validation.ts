import type { PerformanceReport } from './performance-gates.ts'
import type { PeerTrackObservation } from './peer-tracks.ts'

export interface SchedulerStudyReport extends Omit<PerformanceReport, 'policy' | 'config' | 'pins' | 'tracks'> {
  policy: PerformanceReport['policy'] & { sceneAssertions?: string; nodeExposeGc?: boolean; finalUntimedGc?: boolean }
  config: PerformanceReport['config'] & { workloads?: { svg?: string[] } }
  pins: Array<PerformanceReport['pins'][number] & { identity?: { kind?: string; sha256?: string; integrity?: string } }>
  tracks: Omit<PerformanceReport['tracks'], 'observations'> & { observations: PeerTrackObservation[] }
}
export interface SchedulerStudyDesign {
  sourceRevision: string; harnessRevision: string; order: string[]; workloads: string[]; rounds: number
  clocksPerCaseSideRound: number; allocationProbesPerCaseSideRound: number
}
export interface RuntimeStudyProfile {
  workloads: readonly string[]; rounds: number; clocks: number; allocationProbes: number
  phase: string; consumer: string; cache: string; schedule: string; harnessRevision: string
  baselineArchive: string; candidateArchive: string
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Shared packed-report admission for the two bounded studies. Packed archive
 * SRI belongs to identity.integrity; the top-level field is registry-peer SRI. */
export function validateRuntimeStudyReport(report: SchedulerStudyReport, exit: number, profile: RuntimeStudyProfile) {
  const peers = ['agentic', 'agentic-baseline'], rows = report.tracks?.observations ?? [], settings = report.tracksConfig ?? {} as NonNullable<PerformanceReport['tracksConfig']>
  const key = (row: { peer: string; round: number; workload: string; phase: string; consumer: string }) => JSON.stringify([row.peer, row.round, row.workload, row.phase, row.consumer])
  const keys = peers.flatMap(peer => Array.from({ length: profile.rounds }, (_, round) => profile.workloads.map(workload => key({ peer, round, workload, phase: profile.phase, consumer: profile.consumer })))).flat().sort()
  const pins = report.pins ?? []
  const checks = {
    enrollment: equal(rows.map(key).sort(), keys),
    completed: exit === 0 && report.status === 'completed',
    method: settings.schedule === profile.schedule && equal(report.tracks?.phases, [profile.phase]) && equal(report.tracks?.consumers, [profile.consumer]) && report.tracks?.contractVersion === 'semantic-peer-v1',
    inputs: equal(Object.keys(settings.inputs as object ?? {}).sort(), [...profile.workloads].sort()) && equal(report.config.workloads?.svg, profile.workloads) && report.config.rounds === profile.rounds,
    harness: settings.harnessRevision === profile.harnessRevision && settings.harnessDirty === false && /^[a-f0-9]{40}$/.test(profile.harnessRevision),
    sampling: settings.allocationSamples === profile.allocationProbes && (profile.phase === 'first-use' ? settings.coldSamples : settings.samples) === profile.clocks && settings.consumption === 'indexed-utf8-checksum-v1' && settings.warmupSources === 'fresh-edit-ordinals-v1',
    policy: report.policy.elkCache === profile.cache && report.policy.sceneAssertions === 'off' && report.policy.nodeExposeGc === true && report.policy.finalUntimedGc === true && report.policy.executionEnvironment?.experiments === null && Object.keys(report.policy.aplEnvironment ?? {}).length === 0,
    archives: equal(pins.map(pin => pin.peer).sort(), [...peers].sort()) && pins.every(pin => pin.identity?.kind === 'tarball' && pin.identity.sha256 === (pin.peer === 'agentic' ? profile.candidateArchive : profile.baselineArchive) && /^sha512-[A-Za-z0-9+/]+=*$/.test(pin.identity.integrity ?? '')) && (profile.baselineArchive !== profile.candidateArchive || pins[0]?.identity?.integrity === pins[1]?.identity?.integrity),
    runtime: pins.every(pin => /^[a-f0-9]{64}$/.test(pin.runtimeDependencySha256 ?? '')) && pins[0]?.runtimeDependencySha256 === pins[1]?.runtimeDependencySha256,
    observations: rows.every(row => row.status === 'ok' && row.semantic?.ok === true && row.semantic.failures.length === 0 && row.callSamplesMs.length === profile.clocks && row.callSamplesMs.every(value => Number.isFinite(value) && value > 0) && row.allocationSamplesBytes.length === profile.allocationProbes && row.allocationSamplesBytes.every(value => Number.isFinite(value) && value >= 0) && row.calls.length === profile.clocks + (profile.phase === 'first-use' ? profile.allocationProbes + 1 : 0) && row.calls.every(call => call.status === 'ok' && call.semantic?.ok === true && Number.isFinite(call.consumedBytes) && call.consumedBytes! > 0 && Number.isInteger(call.checksum) && call.checksum! >= 0 && call.checksum! <= 0xffffffff) && equal(row.calls.flatMap(call => call.status === 'ok' && call.elapsedMs !== undefined ? [call.elapsedMs] : []), row.callSamplesMs) && row.diagnostics.status === 'observed' && row.diagnostics.complete === true && (profile.phase === 'first-use' || row.warmup?.complete === true && row.warmup.calls >= 20 && row.warmup.elapsedMs >= 1000)),
  }
  return { valid: Object.values(checks).every(Boolean), checks, clocks: rows.reduce((n, row) => n + row.callSamplesMs.length, 0), probes: rows.reduce((n, row) => n + row.allocationSamplesBytes.length, 0), completedDiagnostics: rows.filter(row => row.diagnostics?.complete).length }
}

export function runtimeStudyFingerprint(report: SchedulerStudyReport, omitSchedule = false) {
  const settings = { ...report.tracksConfig }
  if (omitSchedule) delete settings.schedule
  const e = report.environment
  return JSON.stringify({ settings, policy: report.policy, timing: report.config.timing, version: report.tracks?.contractVersion, environment: { node: e.node, cpu: e.cpu, cpus: e.logicalCpus, platform: e.platform, arch: e.arch, os: e.osRelease, hostname: e.hostname }, pins: report.pins.map(pin => ({ peer: pin.peer, graph: pin.runtimeDependencySha256 })) })
}

export function studyArchiveIntegritiesAgree(reports: SchedulerStudyReport[]) {
  const byArchive = new Map<string, string>()
  for (const report of reports) for (const pin of report.pins) {
    const sha = pin.identity?.sha256, integrity = pin.identity?.integrity
    if (!sha || !integrity || byArchive.has(sha) && byArchive.get(sha) !== integrity) return false
    byArchive.set(sha, integrity)
  }
  return true
}

/** Enrollment only; a complete scheduling study is never a numeric pass. */
export function validateSchedulerStudy(design: SchedulerStudyDesign, archive: string, entries: Array<{ id: string; report: SchedulerStudyReport; execution: { exit: number; schedule: string } }>) {
  const reports = entries.map(({ id, report, execution }) => {
    const schedule = id.startsWith('paired-') ? 'paired-cold-ordinal-v1' : 'peer-block-v1'
    const result = validateRuntimeStudyReport(report, execution.exit, { workloads: design.workloads, rounds: design.rounds, clocks: design.clocksPerCaseSideRound, allocationProbes: design.allocationProbesPerCaseSideRound, phase: 'first-use', consumer: 'svg-utf8', cache: 'on', schedule, harnessRevision: design.harnessRevision, baselineArchive: archive, candidateArchive: archive })
    return { id, runId: report.runId, complete: result.valid && execution.schedule === schedule && /^[a-f0-9]{40}$/.test(design.sourceRevision), checks: result.checks, clocks: result.clocks, probes: result.probes, completedDiagnostics: result.completedDiagnostics }
  })
  const matchingReports = equal(entries.map(entry => entry.id), design.order) && reports.every(report => typeof report.runId === 'string' && report.runId.length > 0) && new Set(reports.map(report => report.runId)).size === design.order.length && entries.length === design.order.length && new Set(entries.map(entry => runtimeStudyFingerprint(entry.report, true))).size === 1 && studyArchiveIntegritiesAgree(entries.map(entry => entry.report))
  return { complete: matchingReports && reports.every(report => report.complete), matchingReports, performanceQualified: false, scope: 'partial diagnostic same-archive controls', reports }
}
