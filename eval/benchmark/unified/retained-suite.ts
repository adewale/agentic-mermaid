import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { activateProjectRecord, findProjectRecord, publishProjectRecord, stableValue, type ProjectBenchmarkIdentity, type ProjectBenchmarkRecord } from './project-records.ts'
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
    if (row.samplesMs?.length) {
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
      const result = read(join(retained.evidenceDirectory, 'result.json')) as UnifiedSuiteResult
      if (stableValue(result.observations) !== stableValue(retained.observations) || stableValue(metadata(result)) !== stableValue(retained.provenance)) throw Error('Owning benchmark result differs from its immutable project record')
      const current = options.identity()
      active()
      if (stableValue(current) !== stableValue(identity)) throw Error('Measurement identity changed while validating retained evidence')
      activateProjectRecord(options.records, retained)
      write(join(options.out, 'cache.json'), { project: identity.project, lane: identity.lane, reused: true, recordId: retained.id, startedAt: retained.startedAt, finishedAt: retained.finishedAt, evidenceDirectory: retained.evidenceDirectory })
      write(join(options.out, 'result.json'), result)
      return result
    }
    const id = options.resumeAttempt ? basename(resolve(options.resumeAttempt)) : randomUUID()
    const directory = resolve(options.out, 'attempts', id)
    let raw: UnifiedSuiteResult
    if (options.resumeAttempt) {
      if (resolve(options.resumeAttempt) !== directory) throw Error('Recovery attempt must belong to the selected project output directory')
      const cache = read(join(options.out, 'cache.json')) as { project?: string; lane?: string; state?: string; published?: boolean; pendingAttempt?: string; error?: string }
      const receipt = existsSync(join(directory, 'publication-failure.json')) ? read(join(directory, 'publication-failure.json')) as Record<string, unknown> : undefined
      if (cache.project !== identity.project || cache.lane !== identity.lane || cache.state !== 'incomplete' || cache.published !== false || cache.pendingAttempt !== id || !receipt || receipt.attempt !== id || receipt.stage !== 'publication' || receipt.state !== 'incomplete' || receipt.error !== cache.error || stableValue(receipt.identity) !== stableValue(identity)) throw Error('Recovery requires an attempt-bound publication failure receipt; cancelled or unbound evidence cannot recover')
      if (stableValue(read(join(directory, 'identity.json'))) !== stableValue(identity)) throw Error('Recovery measurement identity differs from the current requested identity')
      raw = read(join(directory, existsSync(join(directory, 'raw-result.json')) ? 'raw-result.json' : 'result.json')) as UnifiedSuiteResult
      if (!['passed', 'failed', 'blocked'].includes(raw.status) || !Array.isArray(raw.observations) || !raw.observations.length || !Number.isFinite(Date.parse(raw.startedAt)) || Date.parse(raw.finishedAt) < Date.parse(raw.startedAt) || !Number.isFinite(Date.parse(raw.finishedAt))) throw Error('Recovery requires a completed sampler result with ordered timestamps')
    } else {
      mkdirSync(directory, { recursive: true })
      pendingAttempt = id
      attemptDirectory = directory
      write(join(directory, 'identity.json'), identity)
      write(join(options.out, 'cache.json'), { project: identity.project, lane: identity.lane, state: 'running', pendingAttempt: id, published: false })
      write(join(options.out, 'result.json'), { status: 'running', project: identity.project, pendingAttempt: id })
      raw = await options.measure(directory)
      write(join(directory, 'raw-result.json'), raw)
    }
    // Preserve the exact original response on recovery, including its formatting.
    if (!existsSync(join(directory, 'raw-result.json'))) writeFileSync(join(directory, 'raw-result.json'), readFileSync(join(directory, 'result.json')))
    const result = publicationResult(raw, identity.project)
    active()
    assertBenchmarkExecutionAllowed()
    const current = options.identity()
    active()
    if (stableValue(current) !== stableValue(identity)) throw Error('Measurement identity changed; retaining the attempt without publishing a reusable record')
    pendingAttempt = id
    attemptDirectory = directory
    stage = 'publication'
    write(join(directory, 'result.json'), result)
    const files = (path: string): string[] => readdirSync(join(directory, path), { withFileTypes: true }).flatMap(entry => {
      const child = path ? `${path}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw Error('Evidence symlinks cannot establish retained benchmark ownership')
      return entry.isDirectory() ? files(child) : entry.isFile() ? [child] : []
    })
    const record: ProjectBenchmarkRecord = {
      schemaVersion: 1,
      id,
      identity,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      status: result.status === 'failed' || result.observations.some(row => row.status === 'failed') ? 'failed' : result.status === 'passed' && !result.observations.some(row => row.status === 'blocked') ? 'passed' : 'blocked',
      evidenceDirectory: directory,
      evidenceFiles: files(''),
      observations: result.observations,
      gaps: result.gaps,
      provenance: metadata(result),
    }
    publishProjectRecord(options.records, record)
    published = true
    write(join(options.out, 'cache.json'), { project: identity.project, lane: identity.lane, reused: false, recordId: id, startedAt: record.startedAt, finishedAt: record.finishedAt, evidenceDirectory: directory })
    write(join(options.out, 'result.json'), result)
    return result
  } catch (error) {
    const state = cancelled ? 'cancelled' : 'incomplete'
    if (attemptDirectory && !published) write(join(attemptDirectory, 'publication-failure.json'), { attempt: pendingAttempt, identity, stage, state, error: String(error) })
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
