import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
  /** Re-evaluated after collection so changed artifacts cannot be published. */
  identity: () => ProjectBenchmarkIdentity
  measure: (directory: string) => Promise<UnifiedSuiteResult>
}

/** One immutable attempt per selected project and lane. Reusing an attempt
 * validates its owning observations and preserves original measurement dates. */
export async function runRetainedSuite(options: RetainedSuiteOptions): Promise<UnifiedSuiteResult> {
  assertBenchmarkExecutionAllowed()
  const identity = options.identity()
  mkdirSync(options.out, { recursive: true })
  mkdirSync(options.records, { recursive: true })
  const lock = join(options.records, Buffer.from(`${identity.project}:${identity.lane ?? 'community'}`).toString('base64url') + '.lock')
  const fd = openSync(lock, 'wx')
  let cancelled: string | undefined
  let published = false
  const interrupt = () => { cancelled = 'SIGINT' }
  const terminate = () => { cancelled = 'SIGTERM' }
  const active = () => { if (cancelled) throw Error(`Benchmark cancelled by ${cancelled}; no completed attempt may be published`) }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    writeFileSync(fd, JSON.stringify({ project: identity.project, lane: identity.lane, pid: process.pid }))
    const retained = options.force ? undefined : findProjectRecord(options.records, identity)
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
    const id = randomUUID()
    const directory = resolve(options.out, 'attempts', id)
    mkdirSync(directory, { recursive: true })
    write(join(directory, 'identity.json'), identity)
    write(join(options.out, 'cache.json'), { project: identity.project, lane: identity.lane, state: 'running', pendingAttempt: id, published: false })
    write(join(options.out, 'result.json'), { status: 'running', project: identity.project, pendingAttempt: id })
    const result = await options.measure(directory)
    active()
    assertBenchmarkExecutionAllowed()
    const current = options.identity()
    active()
    if (stableValue(current) !== stableValue(identity)) throw Error('Measurement identity changed; retaining the attempt without publishing a reusable record')
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
    write(join(options.out, 'cache.json'), { project: identity.project, lane: identity.lane, state: cancelled ? 'cancelled' : 'incomplete', published, error: String(error) })
    write(join(options.out, 'result.json'), { status: cancelled ? 'cancelled' : 'incomplete', project: identity.project, published, error: String(error) })
    throw error
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
    closeSync(fd)
    if (existsSync(lock)) unlinkSync(lock)
  }
}
