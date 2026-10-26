/** Explicit, reporting-only replacement of a narrowly rerun style-oracle partition. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { BenchmarkObservation, UnifiedSuiteResult } from './types.ts'
import { readBenchmarkResult } from '../portable/project-records.ts'

const SURFACE = 'library:./svg/styles'
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const fileIdentity = (path: string) => ({ path: realpathSync(path), sha256: sha(readFileSync(path)) })
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
function key(row: BenchmarkObservation): string {
  if (!Number.isSafeInteger(row.metrics?.round) || Number(row.metrics?.round) < 1) throw Error('Style observation has no positive round')
  return JSON.stringify([row.suite, row.surface, row.runtime, row.metrics!.round, row.family, row.caseId, row.operation, row.format, row.mode])
}
function index(rows: BenchmarkObservation[]) {
  const map = new Map<string, BenchmarkObservation>()
  for (const row of rows) {
    const id = key(row)
    if (map.has(id)) throw Error('Duplicate style observation key: ' + id)
    map.set(id, row)
  }
  return map
}
function jobsFor(resultPath: string) {
  const library = join(dirname(resultPath), 'library')
  if (!existsSync(library)) throw Error('Original worker job evidence missing: ' + library)
  const jobs = readdirSync(library)
    .filter(name => name.endsWith('.job.json'))
    .map(name => ({ path: join(library, name), job: read(join(library, name)) }))
    .filter(entry => entry.job.exportName === './svg/styles')
  if (!jobs.length) throw Error('No actual ./svg/styles worker jobs found')
  for (const { job } of jobs) if (job.full !== true || !Array.isArray(job.workloads) || !job.workloads.length || !existsSync(job.entry) || !existsSync(job.root)) throw Error('Only full-profile actual packed style jobs can be reconciled')
  const root = realpathSync(jobs[0]!.job.root),
    cohort = jobs[0]!.job.workloads
  if (jobs.some(({ job }) => realpathSync(job.root) !== root || !same(job.workloads, cohort))) throw Error('Worker jobs disagree on packed target or exact workload cohort')
  const signatures = jobs
    .map(({ job }) => {
      const raw = read(job.out) as { rows: BenchmarkObservation[]; error?: string }
      if (raw.error || !Array.isArray(raw.rows)) throw Error('Worker job did not produce complete raw evidence: ' + job.out)
      const runtimes = [...new Set(raw.rows.map(row => row.runtime))]
      if (runtimes.length !== 1) throw Error('Worker raw evidence does not identify exactly one actual runtime')
      return { runtime: runtimes[0]!, round: job.round }
    })
    .sort((a, b) => a.runtime.localeCompare(b.runtime) || a.round - b.round)
  if (new Set(signatures.map(value => JSON.stringify(value))).size !== signatures.length) throw Error('Duplicate worker runtime/round jobs')
  const runtimeNames = [...new Set(signatures.map(value => value.runtime))].sort(),
    rounds = [...new Set(signatures.map(value => value.round))].sort((a, b) => a - b)
  if (runtimeNames.length !== 3 || !same(rounds, [1, 2, 3]) || signatures.length !== 9) throw Error('Correction requires the complete three actual runtimes × three rounds protocol')
  return { root, cohort, signatures, runtimeNames, rounds, jobs: jobs.map(({ path }) => path), worker: fileIdentity(join(library, 'installed-library-worker.mjs')), qualifier: fileIdentity(join(library, 'artifact-qualifier.mjs')) }
}
interface Options {
  original: string
  correction: string
  campaign: string
  out: string
  protocolChange: string
}
export function reconcileInvocation(options: Options) {
  if (!options.protocolChange.trim()) throw Error('A human-readable protocol correction is required')
  const original = readBenchmarkResult(options.original),
    correction = readBenchmarkResult(options.correction)
  if (original.id !== 'invocation' || correction.id !== 'invocation' || !original.finishedAt || !correction.finishedAt || !Array.isArray(original.observations) || !Array.isArray(correction.observations)) throw Error('Both inputs must be completed invocation suite envelopes')
  const oldRows = original.observations.filter(row => row.surface === SURFACE),
    newRows = correction.observations.filter(row => row.surface === SURFACE)
  if (!oldRows.length || newRows.length !== correction.observations.length) throw Error('Correction must exclusively contain the affected style surface')
  if (newRows.some(row => row.status !== 'passed' || row.samplesMs?.some(value => !Number.isFinite(value) || value <= 0))) throw Error('Every corrected style observation must pass with valid timing samples where measured')
  const oldIndex = index(oldRows),
    newIndex = index(newRows)
  if (oldIndex.size !== newIndex.size || [...oldIndex.keys()].some(id => !newIndex.has(id))) throw Error('Corrected style runtime/round/case/operation/format/mode keys do not exactly match the original partition')
  const before = jobsFor(options.original),
    after = jobsFor(options.correction)
  if (before.root !== after.root || !same(before.cohort, after.cohort) || !same(before.signatures, after.signatures)) throw Error('Correction changes target, workload content, runtime versions, profile or rounds')
  const campaign = read(options.campaign) as { frozenAt: string; targets: Array<{ id: string; revision: string; packageRoot?: string; tarball?: string; tarballSha256?: string }> }
  const target = campaign.targets.find(entry => entry.packageRoot && realpathSync(entry.packageRoot) === before.root)
  if (!target?.tarball || !target.tarballSha256 || sha(readFileSync(target.tarball)) !== target.tarballSha256) throw Error('Packed target cannot be bound to the frozen candidate tarball identity')
  // Verify current executable package JS against the actual, digest-admitted npm archive.
  // Hashes here identify shipped compiled artifacts, never a synthetic source-code identity.
  const archiveNames = execFileSync('tar', ['-tzf', target.tarball], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(name => name === 'package/package.json' || /^package\/dist\/.*\.[cm]?js$/.test(name))
  if (!archiveNames.length) throw Error('Frozen archive contains no executable package artifacts')
  const compiledArtifacts = archiveNames.map(name => {
    const packed = execFileSync('tar', ['-xOzf', target.tarball!, name], { maxBuffer: 64 * 1024 * 1024 }),
      path = join(before.root, name.slice('package/'.length))
    if (!existsSync(path) || !readFileSync(path).equals(packed)) throw Error('Packed runtime differs from frozen npm archive: ' + path)
    return { path, sha256: sha(packed), bytes: packed.length }
  })
  mkdirSync(options.out, { recursive: true })
  const normalizedPath = join(options.out, 'invocation-corrected.json'),
    manifestPath = join(options.out, 'reconciliation.json'),
    markdownPath = join(options.out, 'RECONCILIATION.md')
  if ([normalizedPath, manifestPath, markdownPath].some(existsSync)) throw Error('Correction output already contains evidence; choose a fresh --out')
  const observations = original.observations.map(row => (row.surface === SURFACE ? newIndex.get(key(row))! : row))
  const result: UnifiedSuiteResult = {
    ...original,
    status: observations.some(row => row.status === 'failed') ? 'failed' : observations.some(row => row.status === 'blocked') ? 'blocked' : 'passed',
    observations,
    gaps: [...original.gaps, `Reporting correction: ${options.protocolChange}; see ${manifestPath}. Original raw ledger is preserved.`],
    artifacts: [...(original.artifacts ?? []), manifestPath, options.correction],
  }
  const git = (args: string[]) => execFileSync('git', args, { cwd: resolve(import.meta.dir, '../../..'), encoding: 'utf8' }).trim()
  const manifest = {
    id: 'invocation-style-oracle-reconciliation',
    createdAt: new Date().toISOString(),
    protocolChange: options.protocolChange,
    scope: SURFACE,
    original: { ...fileIdentity(options.original), startedAt: original.startedAt, finishedAt: original.finishedAt, status: original.status },
    correction: { ...fileIdentity(options.correction), startedAt: correction.startedAt, finishedAt: correction.finishedAt, status: correction.status },
    normalized: { path: normalizedPath, status: result.status },
    target: { id: target.id, revision: target.revision, packageRoot: before.root, tarball: target.tarball, sha256: target.tarballSha256, campaign: options.campaign, frozenAt: campaign.frozenAt, compiledArtifacts },
    profile: 'full',
    runtimes: before.runtimeNames,
    rounds: before.rounds,
    jobs: { original: before.jobs, correction: after.jobs },
    harnessArtifacts: { original: { worker: before.worker, qualifier: before.qualifier }, correction: { worker: after.worker, qualifier: after.qualifier } },
    cohort: before.cohort.map((workload: { id: string; family: string; expectedLabels?: string[] }) => ({ id: workload.id, family: workload.family, independentLabelCount: workload.expectedLabels?.length ?? 0 })),
    counts: { original: original.observations.length, corrected: observations.length, replaced: newRows.length, retainedOriginal: observations.length - newRows.length, originalPartitionFailed: oldRows.filter(row => row.status === 'failed').length, correctedPartitionPassed: newRows.length },
    driver: { head: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain=v1', '--untracked-files=all']) },
    policy:
      'Only exact matching style partition keys are replaced with newly measured corrected-protocol observations. No prior style timing is relabelled or reused. Other observations retain original protocol/timestamps; this is an explicitly mixed-run reporting ledger, not a new full run. Original aggregate reports and raw evidence are never overwritten.',
  }
  writeFileSync(normalizedPath, JSON.stringify(result, null, 2))
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  writeFileSync(
    markdownPath,
    [
      `# Invocation style qualification correction`,
      '',
      options.protocolChange,
      '',
      `Original: [raw ledger](${options.original}) (${original.status}; finished ${original.finishedAt}).`,
      `Correction: [scoped rerun](${options.correction}) (${correction.status}; finished ${correction.finishedAt}).`,
      `Reporting ledger: [corrected invocation](${normalizedPath}) (${result.status}).`,
      '',
      `Replaced ${newRows.length} observations on ${SURFACE}; preserved ${observations.length - newRows.length} original observations.`,
      `Protocol: full; runtimes ${before.runtimeNames.join(', ')}; rounds ${before.rounds.join(', ')}; ${before.cohort.length} identical family cases.`,
      `Frozen package: ${target.id} at ${target.revision}; archive SHA256 ${target.tarballSha256}.`,
      '',
      manifest.policy,
      '',
      `Machine-readable checks: [reconciliation.json](${manifestPath}).`,
      '',
    ].join('\n'),
  )
  return { result, manifest, normalizedPath, manifestPath, markdownPath }
}
if (import.meta.main) {
  const values = new Map<string, string>()
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index]!,
      value = process.argv[index + 1]
    if (!['--original', '--correction', '--campaign', '--out', '--protocol-change'].includes(name) || !value || value.startsWith('--') || values.has(name)) throw Error('Usage: reconcile-invocation.ts --original FILE --correction FILE --campaign FILE --out FRESH_DIR --protocol-change TEXT')
    values.set(name, value)
  }
  for (const name of ['--original', '--correction', '--campaign', '--out', '--protocol-change']) if (!values.has(name)) throw Error('Missing required ' + name)
  const result = reconcileInvocation({ original: resolve(values.get('--original')!), correction: resolve(values.get('--correction')!), campaign: resolve(values.get('--campaign')!), out: resolve(values.get('--out')!), protocolChange: values.get('--protocol-change')! })
  console.log(JSON.stringify({ status: result.result.status, result: result.normalizedPath, manifest: result.manifestPath, replaced: result.manifest.counts.replaced }))
}
