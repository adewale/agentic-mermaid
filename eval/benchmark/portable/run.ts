import { gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAMILY_SUPPORT_PROTOCOL, familySupportProbe, portableCases, PORTABLE_COHORT_PROTOCOL, type PortableCase, type PortableCohort } from './cohorts.ts'
import { environmentIdentity } from './environment.ts'
import { artifactIdentity, byteDigest, harnessIdentity, portableDirectory, readJson, resolveArtifact } from './artifacts.ts'
import { activateProjectRecord, findProjectRecord, inspectCurrentProjectRecords, publishProjectRecord, writeProjectBenchmarkRecord, stableValue, type ProjectBenchmarkIdentity, type ProjectBenchmarkRecord } from './project-records.ts'
import { assertPortableRunning, PortableCancelled, resetPortableCancellation, measurePortableProject, terminatePortableWorkers } from './execution.ts'
import { PORTABLE_MEASUREMENT_PROTOCOL, type PortableArtifact, type PortableJob, type PortableWorkerResult, type Replica } from './protocol.ts'
import { portableMarkdown, portableSummary } from './report.ts'
import type { BenchmarkObservation } from './observation.ts'
import type { UsageEvidence } from './costs.ts'
import { assertBenchmarkToolVersion } from '../tool-versions.ts'
import { defaultTimeObserver } from './time-observer.ts'

export interface PortableOptions {
  project: string
  artifactRoot: string
  adapter: PortableArtifact['adapter']
  entry?: string
  node: string
  out: string
  records: string
  rounds: number
  samples: number
  coldSamples: number
  minSampleMs: number
  preparationConcurrency: number
  maximumControlSpread: number
  cohorts?: PortableCohort[]
  observer?: string
  usage?: string
  cpuHourUsd?: number
  force: boolean
  plan: boolean
  allowPartial: boolean
}
export { assertBenchmarkExecutionAllowed as assertPortableLocal } from './ci-policy.ts'
import { assertBenchmarkExecutionAllowed as assertPortableLocal } from './ci-policy.ts'
export function parsePortableOptions(argv: string[]): PortableOptions {
  const flags = new Set(['--force', '--plan', '--allow-partial']),
    values = new Map<string, string>()
  const allowed = new Set(['project', 'artifact-root', 'adapter', 'entry', 'node', 'out', 'records', 'rounds', 'samples', 'cold-samples', 'min-sample-ms', 'preparation-concurrency', 'maximum-control-spread', 'cohort', 'observer', 'usage', 'cpu-hour-usd'])
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!
    if (values.has(flag)) throw Error('Duplicate option ' + flag)
    if (flags.has(flag)) {
      values.set(flag, 'true')
      continue
    }
    const value = argv[++index]
    if (!flag.startsWith('--') || !allowed.has(flag.slice(2)) || !value || value.startsWith('--')) throw Error('Invalid portable option ' + flag)
    values.set(flag, value)
  }
  for (const key of ['--project', '--artifact-root']) if (!values.has(key)) throw Error('Required ' + key)
  const integer = (key: string, fallback: number) => {
    const value = Number(values.get(key) ?? fallback)
    if (!Number.isSafeInteger(value) || value < 1) throw Error(key + ' needs a positive integer')
    return value
  }
  const decimal = (key: string, fallback: number) => {
    const value = Number(values.get(key) ?? fallback)
    if (!Number.isFinite(value) || value < 0) throw Error(key + ' needs a finite nonnegative number')
    return value
  }
  const adapter = values.get('--adapter') ?? 'pele'
  if (!['pele', 'agentic', 'beautiful', 'ondine'].includes(adapter)) throw Error('Unsupported public Node SVG adapter')
  const cohorts = values.has('--cohort') ? (values.get('--cohort')!.split(',') as PortableCohort[]) : undefined
  if (cohorts?.some(cohort => !['family', 'scaling', 'adversarial', 'invalid'].includes(cohort)) || (cohorts && new Set(cohorts).size !== cohorts.length)) throw Error('Unknown or repeated cohort')
  return {
    project: values.get('--project')!,
    artifactRoot: resolve(values.get('--artifact-root')!),
    adapter: adapter as PortableArtifact['adapter'],
    entry: values.get('--entry'),
    node: values.get('--node') ?? process.env.NODE_BIN ?? 'node',
    out: resolve(values.get('--out') ?? 'bench-report/portable'),
    records: resolve(values.get('--records') ?? 'bench-report/project-records'),
    rounds: integer('--rounds', 5),
    samples: integer('--samples', 31),
    coldSamples: integer('--cold-samples', 20),
    minSampleMs: decimal('--min-sample-ms', 2),
    preparationConcurrency: integer('--preparation-concurrency', 8),
    maximumControlSpread: decimal('--maximum-control-spread', 0.25),
    cohorts,
    observer: values.has('--observer') ? resolve(values.get('--observer')!) : defaultTimeObserver(),
    usage: values.has('--usage') ? resolve(values.get('--usage')!) : undefined,
    cpuHourUsd: values.has('--cpu-hour-usd') ? decimal('--cpu-hour-usd', 0) : undefined,
    force: values.has('--force'),
    plan: values.has('--plan'),
    allowPartial: values.has('--allow-partial'),
  }
}
const now = () => new Date().toISOString()
const writeJson = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const jsonValue = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function observerIdentity(path?: string) {
  if (!path) return { status: 'unavailable', path: null, detail: 'No GNU time configured or found (/usr/bin/time, gtime on PATH); current API snapshots still execute' }
  const version = execFileSync(path, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
  if (!/GNU\s*Time/i.test(version)) throw Error('Resource observer must be GNU time')
  return { status: 'available', path, version, sha256: byteDigest(path) }
}

function listFiles(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? listFiles(join(directory, entry.name), root) : entry.isFile() ? [relative(root, join(directory, entry.name))] : []))
    .sort()
}
function observations(project: string, cases: PortableCase[], results: PortableWorkerResult[]): BenchmarkObservation[] {
  const rejected = new Map(results.filter(result => result.mode === 'probe' && result.status === 'unsupported').map(result => [result.family, result]))
  // Cases of a rejected family were never run; each keeps one unsupported row naming the probe.
  const unrun = cases.flatMap<BenchmarkObservation>(testCase => {
    const probe = rejected.get(testCase.family)
    return probe ? [{ suite: 'portable-community', surface: 'node:public-svg', runtime: `node:${probe.runtime.node}`, family: testCase.family, caseId: testCase.id, format: 'svg', operation: 'render', mode: 'family-unsupported', status: 'unsupported', detail: `Not run: the renderer rejected ${probe.caseId}: ${probe.error}`, metrics: { implementation: project } }] : []
  })
  return [...results.flatMap<BenchmarkObservation>(result => {
    const status = result.status === 'partial' ? ('blocked' as const) : result.status
    const metrics = { implementation: project, round: result.round, replica: result.replica, sample: result.sample, accepted: result.qualification?.accepted ?? null, semanticComplete: result.qualification?.semanticComplete ?? false }
    const base = { suite: 'portable-community', surface: 'node:public-svg', runtime: `node:${result.runtime.node}`, family: result.family, caseId: result.caseId, format: 'svg', status, detail: result.qualification?.scope ?? result.error }
    if (result.mode === 'probe') return [{ ...base, operation: 'family-support', mode: 'probe', detail: result.error, metrics: { ...metrics, metricId: `probe:${result.family}` } }]
    if (result.mode === 'baseline' || result.mode === 'memory' || result.mode === 'retention') return [{ ...base, operation: 'resource-diagnostic', mode: result.mode, metrics: { ...metrics, metricId: `${result.mode}:${result.round}:${result.replica}:${result.sample}` } }]
    return Object.entries(result.tracks).map(([track, samples]) => ({ ...base, operation: 'render', mode: `${result.replica}:${track}`, samplesMs: samples, metrics: { ...metrics, metricId: `${track}:${result.round}:${result.replica}:${result.sample}` } }))
  }), ...unrun]
}
export async function runPortable(options: PortableOptions) {
  assertPortableLocal()
  resetPortableCancellation()
  const testCases = portableCases(options.cohorts),
    artifact = resolveArtifact(options.project, options.artifactRoot, options.adapter, options.node, options.entry)
  assertBenchmarkToolVersion(options.project, artifact.version, 'portable SVG artifact')
  if (!testCases.length) throw Error('No selected cases')
  const sampling = {
    rounds: options.rounds,
    samples: options.samples,
    coldSamples: options.coldSamples,
    minSampleMs: options.minSampleMs,
    preparationConcurrency: options.preparationConcurrency,
    maximumControlSpread: options.maximumControlSpread,
    order: 'rotate A0/A1/B by round and case; all warm jobs, then all cold jobs, then serial memory/baseline jobs',
    controls: 'A0/A1/B are the exact same admitted artifact, not three tool versions',
    warmScope: 'Per-call means from batches bounded by minSampleMs or256calls; every distinct immutable SVG is checked outside clocks, byte-identical admitted returns reuse qualification; individual first-use samples are fresh processes',
    commentVariantScope: 'Trailing comment changes only source bytes, never semantic graph; this is a cache-key diagnostic',
    coldScope: 'Concurrent import preparation behind an idle barrier; one measured API call at a time and complete child exit before the next',
    memoryScope: 'Separate serial fresh processes; API snapshots precede qualification, GNU time describes the whole worker',
    retentionCalls: [0, 10, 100, 1000],
  }
  const identity: ProjectBenchmarkIdentity = jsonValue({
    project: options.project,
    lane: 'portable-svg',
    protocol: { measurement: PORTABLE_MEASUREMENT_PROTOCOL, cohort: PORTABLE_COHORT_PROTOCOL, harness: harnessIdentity(), cases: testCases, familySupport: { protocol: FAMILY_SUPPORT_PROTOCOL, probes: [...new Set(testCases.map(testCase => testCase.family))].flatMap(family => familySupportProbe(family) ?? []) } },
    artifact: artifactIdentity(artifact),
    measurement: { sampling: Object.fromEntries(Object.entries(sampling).filter(([key]) => key !== 'maximumControlSpread')), environment: environmentIdentity(options.node), observer: observerIdentity(options.observer) },
  })
  const assertIdentityStable = () => {
    if (stableValue(artifactIdentity(artifact)) !== stableValue(identity.artifact) || stableValue(environmentIdentity(options.node)) !== stableValue((identity.measurement as any).environment) || stableValue(observerIdentity(options.observer)) !== stableValue((identity.measurement as any).observer))
      throw Error('Artifact/runtime/resource observer changed; no completed record is activated or published')
  }
  mkdirSync(options.out, { recursive: true })
  mkdirSync(options.records, { recursive: true })
  const lock = join(options.records, 'portable-campaign.lock'),
    fd = openSync(lock, 'wx')
  let published = false
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, project: options.project, startedAt: now() }))
    const retained = options.force ? undefined : findProjectRecord(options.records, identity)
    const action = retained ? 'reused' : 'measure'
    if (options.plan) return { action, project: options.project, record: retained?.id ?? null, sampling, cases: testCases.length }
    let record: ProjectBenchmarkRecord
    if (retained) {
      // The owning result payload must still agree with the immutable record.
      const resultFile = join(retained.evidenceDirectory, 'results.json'), observationFile = join(retained.evidenceDirectory, 'observations.json')
      if (existsSync(resultFile) && stableValue(readJson(resultFile)) !== stableValue((retained.provenance as { results: unknown }).results)) throw Error('Retained worker results differ from the immutable project record')
      if (existsSync(observationFile) && stableValue(readJson(observationFile)) !== stableValue(retained.observations)) throw Error('Retained raw observation envelope differs from its record')
      assertIdentityStable()
      await new Promise<void>(resolve => setImmediate(resolve))
      assertPortableRunning()
      activateProjectRecord(options.records, retained)
      record = retained
    } else {
      const startedAt = now(),
        id = randomUUID(),
        directory = join(options.out, 'attempts', id)
      writeFileSync(join(options.out, 'report.json'), JSON.stringify({ status: 'running', project: options.project, startedAt, pendingAttempt: id, previousRecordRetained: true }) + '\n')
      mkdirSync(directory, { recursive: true })
      mkdirSync(join(directory, 'svg'))
      writeJson(join(directory, 'invocation.json'), { options, artifact, sampling, identity, startedAt })
      const results: PortableWorkerResult[] = []
      const retain = (result: PortableWorkerResult) => {
        results.push(result)
        appendFileSync(join(directory, 'workers.jsonl.gz'), gzipSync(Buffer.from(JSON.stringify(result) + '\n')))
      }
      await measurePortableProject(artifact, testCases, options, directory, retain)
      assertIdentityStable()
      const actualObservations = observations(options.project, testCases, results)
      const finishedAt = now()
      record = {
        schemaVersion: 1,
        id,
        identity,
        startedAt,
        finishedAt,
        status: results.some(result => result.status === 'failed') ? 'failed' : results.some(result => result.status === 'partial' || result.status === 'blocked') ? 'blocked' : 'passed',
        evidenceDirectory: directory,
        evidenceFiles: [...listFiles(directory).filter(file => !['workers.jsonl.gz', 'invocation.json'].includes(file)), 'result.json.gz'],
        observations: actualObservations,
        gaps: [...new Set(results.flatMap(result => result.qualification?.unmeasuredScopes.filter(scope => !scope.startsWith('Repeated passing')) ?? []))],
        provenance: { workerProtocol: PORTABLE_MEASUREMENT_PROTOCOL, sampler: sampling, artifact, results },
      }
      const payloadFile = join(directory, 'result.json.gz')
      writeProjectBenchmarkRecord(payloadFile, record)
      // Let queued cancellation signals run after compression, before publication.
      await new Promise<void>(resolve => setImmediate(resolve))
      assertPortableRunning()
      publishProjectRecord(options.records, record, { payloadFile })
      published = true
      rmSync(join(directory, 'workers.jsonl.gz'), { force: true })
      rmSync(join(directory, 'invocation.json'), { force: true })
    }
    const results = (record.provenance as { results: PortableWorkerResult[] }).results
    if (!Array.isArray(results)) throw Error('Retained portable record has no worker results')
    const summary = portableSummary(testCases, results, { ...options, usage: options.usage ? (readJson(options.usage) as UsageEvidence) : undefined })
    const report = {
      schemaVersion: 1,
      protocol: PORTABLE_MEASUREMENT_PROTOCOL,
      status: summary.status === 'failed' ? 'failed' : summary.status !== 'measured' || summary.counts.completeSemanticCases !== summary.counts.positiveCases ? 'incomplete' : 'passed',
      project: options.project,
      version: artifact.version,
      artifact: identity.artifact,
      sampling,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      evidenceDirectory: record.evidenceDirectory,
      recordId: record.id,
      reused: !!retained,
      summary,
    }
    assertPortableRunning()
    writeFileSync(join(options.out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    writeFileSync(join(options.out, 'report.md'), portableMarkdown(report))
    const current = inspectCurrentProjectRecords(options.records)
    writeFileSync(
      join(options.out, 'projects.json'),
      JSON.stringify(
        current.map(item => ({ project: item.record.identity.project, lane: item.record.identity.lane ?? 'community', recordId: item.record.id, status: item.record.status, measuredAt: item.record.finishedAt, evidenceRetained: item.evidenceRetained })),
        null,
        2,
      ) + '\n',
    )
    return report
  } catch (error) {
    if (!options.plan) writeFileSync(join(options.out, 'report.json'), JSON.stringify({ status: error instanceof PortableCancelled ? 'cancelled' : 'incomplete', project: options.project, finishedAt: now(), error: String(error), completedRecordPublished: published }) + '\n')
    throw error
  } finally {
    closeSync(fd)
    unlinkSync(lock)
  }
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(
      'node portable/run.ts --project obsidianmd/pele --artifact-root INSTALLED_PACKAGE [--adapter pele|agentic|beautiful|ondine] [--out DIR] [--records DIR] [--rounds 5 --samples 31 --cold-samples 20] [--cohort family,scaling,adversarial,invalid] [--observer GNU_TIME] [--usage OBSERVED_USAGE_JSON] [--cpu-hour-usd RATE] [--plan] [--force] [--allow-partial]\nDefaults: five rounds,31 warm sample means,20 fresh processes per replica/round/case. Imported cold workers prepare concurrently then API calls execute serially behind a barrier. No CI execution and no paid/provider calls. Compiled run.mjs works without a source checkout or Git.',
    )
    return
  }
  const options = parsePortableOptions(argv)
  const cleanup = () => {
    terminatePortableWorkers()
    process.exitCode = 130
  }
  process.once('SIGINT', cleanup)
  process.once('SIGTERM', cleanup)
  try {
    const result = await runPortable(options)
    console.log(JSON.stringify('summary' in result ? { project: result.project, reused: result.reused, recordId: result.recordId, status: result.summary.status, counts: result.summary.counts, report: join(options.out, 'report.md') } : result, null, 2))
    if ('summary' in result) process.exitCode = result.summary.status === 'failed' ? 1 : !options.allowPartial && (result.summary.status !== 'measured' || result.summary.counts.completeSemanticCases !== result.summary.counts.positiveCases) ? 2 : 0
  } catch (error) {
    if (error instanceof PortableCancelled) {
      process.exitCode = 130
      console.error(error.message)
    } else throw error
  } finally {
    process.off('SIGINT', cleanup)
    process.off('SIGTERM', cleanup)
  }
}
// Compare real paths: a kit reached through a symlink (macOS /tmp, /var) must still run.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) await main()
