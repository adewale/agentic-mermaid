import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { basename, join, resolve } from 'node:path'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { activateProjectRecord, findProjectRecord, publishProjectRecord, readBenchmarkResult, readProjectBenchmarkRecord, writeProjectBenchmarkRecord, writeBenchmarkResultReference, projectRecordPath, stableValue, type ProjectBenchmarkIdentity, type ProjectBenchmarkRecord } from '../portable/project-records.ts'
import type { UnifiedSuiteResult } from './types.ts'

const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const metadata = ({ observations: _observations, ...result }: UnifiedSuiteResult) => result

export interface RetainedSuiteOptions {
  out: string
  records: string
  force?: boolean
  /** Explicitly publish a completed attempt whose publication alone failed. */
  resumeAttempt?: string
  /** Re-evaluated after collection so changed artifacts cannot be published. */
  identity: () => ProjectBenchmarkIdentity
  measure: (directory: string) => Promise<UnifiedSuiteResult>
}

/** Publication adds ownership and row identity without changing sampler evidence.
 * Repeated clocks must have distinct experimental coordinates, not just row IDs. */
export function publicationResult(raw: UnifiedSuiteResult, project: string): UnifiedSuiteResult {
  const seen = new Set<string>()
  return { ...raw, observations: raw.observations.map((row, index) => {
    if (row.samplesMs?.length || row.operation === 'heap-checkpoint' || row.mode.includes('resource')) {
      const coordinate = stableValue([row.suite, row.surface, row.runtime, row.family, row.caseId, row.operation, row.format, row.mode,
        ...['round', 'sample', 'requestedOperation', 'resourcePass', 'checkpoint'].map(key => row.metrics?.[key] ?? null)])
      if (seen.has(coordinate)) throw Error('Duplicate measured sample coordinates; row IDs cannot qualify repeated clocks')
      seen.add(coordinate)
    }
    return { ...row, metrics: { ...row.metrics, implementation: project, project, metricId: `observation-${index + 1}` } }
  }) }
}

/** One immutable attempt per selected project and lane. Reusing an attempt
 * validates its owning observations and preserves original measurement dates. */
export async function runRetainedSuite(options: RetainedSuiteOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const identity = options.identity()
  if (options.resumeAttempt && options.force) throw Error('Completed-attempt recovery cannot force a new measurement')
  mkdirSync(options.out, { recursive: true })
  mkdirSync(options.records, { recursive: true })
  const lock = join(options.records, Buffer.from(`${identity.project}:${identity.lane ?? 'community'}`).toString('base64url') + '.lock')
  const fd = openSync(lock, 'wx')
  let cancelled: string | undefined
  let published = false
  let anchoredRecovery = false
  let completedOutput: ReturnType<typeof writeProjectBenchmarkRecord> | undefined
  let pendingAttempt: string | undefined
  let attemptDirectory: string | undefined
  let stage: 'collection' | 'publication' = 'collection'
  const interrupt = () => { cancelled = 'SIGINT' }
  const terminate = () => { cancelled = 'SIGTERM' }
  const active = () => { if (cancelled) throw Error(`Benchmark cancelled by ${cancelled}; no completed attempt may be published`) }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    writeFileSync(fd, JSON.stringify({ project: identity.project, lane: identity.lane, pid: process.pid }))
    const retained = options.force || options.resumeAttempt ? undefined : findProjectRecord(options.records, identity)
    active()
    if (retained) {
      const result = readBenchmarkResult(retained)
      const current = options.identity()
      await new Promise<void>(resolve => setImmediate(resolve))
      active()
      if (stableValue(current) !== stableValue(identity)) throw Error('Measurement identity changed while validating retained evidence')
      activateProjectRecord(options.records, retained)
      write(join(options.out, 'cache.json'), { project: identity.project, lane: identity.lane, reused: true, recordId: retained.id, startedAt: retained.startedAt, finishedAt: retained.finishedAt, evidenceDirectory: retained.evidenceDirectory })
      writeBenchmarkResultReference(join(options.out, 'result.json'), projectRecordPath(options.records, retained.identity.project, retained.id))
      return result
    }
    const id = options.resumeAttempt ? basename(resolve(options.resumeAttempt)) : randomUUID()
    const directory = resolve(options.out, 'attempts', id), payload = join(directory, 'result.json.gz')
    let raw: UnifiedSuiteResult, completed: ProjectBenchmarkRecord | undefined
    if (options.resumeAttempt) {
      if (resolve(options.resumeAttempt) !== directory) throw Error('Recovery attempt must belong to the selected project output directory')
      const cache = read(join(options.out, 'cache.json')) as { project?: string; lane?: string; state?: string; published?: boolean; pendingAttempt?: string; error?: string }
      const receipt = existsSync(join(directory, 'publication-failure.json')) ? read(join(directory, 'publication-failure.json')) as Record<string, unknown> : undefined
      anchoredRecovery = receipt?.schemaVersion === 2 && receipt.kind === 'benchmark-result-reference'
      if (cache.project !== identity.project || cache.lane !== identity.lane || cache.state !== 'incomplete' || cache.published !== false || cache.pendingAttempt !== id || !receipt || receipt.attempt !== id || receipt.stage !== 'publication' || receipt.state !== 'incomplete' || receipt.error !== cache.error || (!anchoredRecovery && stableValue(receipt.identity) !== stableValue(identity))) throw Error('Recovery requires an attempt-bound publication failure receipt; cancelled or unbound evidence cannot recover')
      if (stableValue(read(join(directory, 'identity.json'))) !== stableValue(identity)) throw Error('Recovery measurement identity differs from the current requested identity')
      if (anchoredRecovery) {
        if ((receipt!.payload as { path?: string } | undefined)?.path !== payload) throw Error('Recovery output reference belongs to a different attempt')
        readBenchmarkResult(join(directory, 'publication-failure.json'))
      }
      if (existsSync(payload)) {
        completed = readProjectBenchmarkRecord(payload)
        if (completed.id !== id || resolve(completed.evidenceDirectory) !== directory || stableValue(completed.identity) !== stableValue(identity)) throw Error('Recovery canonical payload belongs to a different attempt or identity')
        raw = readBenchmarkResult(completed)
        const legacySource = existsSync(join(directory, 'raw-result.json')) ? join(directory, 'raw-result.json') : join(directory, 'result.json')
        if (!anchoredRecovery && existsSync(legacySource) && stableValue(publicationResult(readBenchmarkResult(legacySource), identity.project)) !== stableValue(raw)) throw Error('Recovery canonical payload differs from preserved legacy evidence')
      } else {
        const original = join(directory, existsSync(join(directory, 'raw-result.json')) ? 'raw-result.json' : 'result.json')
        raw = readBenchmarkResult(original)
        // Legacy recovery preserves original bytes before adopting canonical storage.
        if (!existsSync(join(directory, 'raw-result.json'))) writeFileSync(join(directory, 'raw-result.json'), readFileSync(original))
      }
      if (!['passed', 'failed', 'blocked'].includes(raw.status) || !Array.isArray(raw.observations) || !raw.observations.length || !Number.isFinite(Date.parse(raw.startedAt)) || Date.parse(raw.finishedAt) < Date.parse(raw.startedAt) || !Number.isFinite(Date.parse(raw.finishedAt))) throw Error('Recovery requires a completed sampler result with ordered timestamps')
    } else {
      mkdirSync(directory, { recursive: true })
      pendingAttempt = id
      attemptDirectory = directory
      write(join(directory, 'identity.json'), identity)
      write(join(options.out, 'cache.json'), { project: identity.project, lane: identity.lane, state: 'running', pendingAttempt: id, published: false })
      write(join(options.out, 'result.json'), { status: 'running', project: identity.project, pendingAttempt: id })
      raw = await options.measure(directory)
    }
    let result: UnifiedSuiteResult
    try { result = publicationResult(raw, identity.project) }
    catch (error) {
      // Failed normalization still retains its one diagnostic sampler payload.
      if (!options.resumeAttempt) writeFileSync(join(directory, 'sampler-result.json.gz'), gzipSync(Buffer.from(JSON.stringify(raw))))
      throw error
    }
    const files = (path: string): string[] => readdirSync(join(directory, path), { withFileTypes: true }).flatMap(entry => {
      const child = path ? `${path}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw Error('Evidence symlinks cannot establish retained benchmark ownership')
      return entry.isDirectory() ? files(child) : entry.isFile() ? [child] : []
    })
    const record: ProjectBenchmarkRecord = completed ?? {
      schemaVersion: 1,
      id,
      identity,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      status: result.status === 'failed' || result.observations.some(row => row.status === 'failed') ? 'failed' : result.status === 'passed' && !result.observations.some(row => row.status === 'blocked') ? 'passed' : 'blocked',
      evidenceDirectory: directory,
      evidenceFiles: [...new Set([...files('').filter(path => options.resumeAttempt || path !== 'identity.json'), 'result.json.gz'])],
      observations: result.observations,
      gaps: result.gaps,
      provenance: metadata(result),
    }
    completedOutput = writeProjectBenchmarkRecord(payload, record)
    active()
    assertBenchmarkExecutionAllowed()
    const current = options.identity()
    // Deliver OS cancellation queued during compression/admission before publish.
    await new Promise<void>(resolve => setImmediate(resolve))
    active()
    if (stableValue(current) !== stableValue(identity)) throw Error('Measurement identity changed; retaining the attempt without publishing a reusable record')
    pendingAttempt = id
    attemptDirectory = directory
    stage = 'publication'
    if (anchoredRecovery && stableValue(readBenchmarkResult(join(directory, 'publication-failure.json'))) !== stableValue(result)) throw Error('Recovery output changed before publication')
    publishProjectRecord(options.records, record, { payloadFile: payload })
    published = true
    // Only new completed attempts replace this temporary admission receipt.
    // Failed attempts and legacy recovery keep their original identity bytes.
    if (!record.evidenceFiles.includes('identity.json') && existsSync(join(directory, 'identity.json'))) unlinkSync(join(directory, 'identity.json'))
    write(join(options.out, 'cache.json'), { project: identity.project, lane: identity.lane, reused: false, recordId: id, startedAt: record.startedAt, finishedAt: record.finishedAt, evidenceDirectory: directory })
    writeBenchmarkResultReference(join(options.out, 'result.json'), projectRecordPath(options.records, record.identity.project, record.id))
    return result
  } catch (error) {
    // A rejected recovery request must not erase the eligible attempt's receipt
    // or pointer; the user can correct its path/settings and retry publication.
    if (options.resumeAttempt && !attemptDirectory) throw error
    const state = cancelled ? 'cancelled' : 'incomplete'
    if (attemptDirectory && !published) {
      const failure = join(attemptDirectory, 'publication-failure.json'), metadata = { attempt: pendingAttempt, stage, state, error: String(error) }
      // New failures bind the completed OUTPUT bytes, not just its identity.
      // Existing legacy recovery receipts keep their original identity format.
      if (completedOutput && (!options.resumeAttempt || anchoredRecovery)) write(failure, { ...metadata, schemaVersion: 2, kind: 'benchmark-result-reference', payload: completedOutput })
      else write(failure, { ...metadata, identity })
    }
    write(join(options.out, 'cache.json'), { project: identity.project, lane: identity.lane, pendingAttempt, state, published, error: String(error) })
    write(join(options.out, 'result.json'), { status: cancelled ? 'cancelled' : 'incomplete', project: identity.project, published, error: String(error) })
    throw error
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
    closeSync(fd)
    if (existsSync(lock)) unlinkSync(lock)
  }
}
