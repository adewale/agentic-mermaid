import { createHash, randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, lstatSync, linkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { BenchmarkObservation, UnifiedSuiteResult } from './observation.ts'

export interface ProjectBenchmarkIdentity {
  project: string
  lane?: string
  protocol: unknown
  artifact: unknown
  measurement: unknown
}
export interface ProjectBenchmarkRecord {
  schemaVersion: 1
  id: string
  identity: ProjectBenchmarkIdentity
  startedAt: string
  finishedAt: string
  status: 'passed' | 'failed' | 'blocked'
  evidenceDirectory: string
  evidenceFiles: string[]
  observations: BenchmarkObservation[]
  gaps: string[]
  provenance?: unknown
}
interface ProjectIndex {
  schemaVersion: 1
  projects: { project: string; lane?: string; current: string; history: string[] }[]
}
const lane = (value: { lane?: string }) => value.lane ?? 'community'
const identityKey = (identity: ProjectBenchmarkIdentity) => stableValue({ ...identity, lane: lane(identity) })

/** Compare structured identities directly; source/corpus bytes are never hashed. */
export function stableValue(value: unknown): string {
  const seen = new Set<object>()
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (!item || typeof item !== 'object' || seen.has(item) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) throw Error('Benchmark identities must contain finite, acyclic JSON values')
    seen.add(item)
    const result = Array.isArray(item)
      ? item.map(normalize)
      : Object.fromEntries(
          Object.keys(item)
            .sort()
            .map(key => [key, normalize((item as Record<string, unknown>)[key])]),
        )
    seen.delete(item)
    return result
  }
  return JSON.stringify(normalize(value))
}
const fail = (message: string): never => {
  throw Error(`Invalid benchmark record store: ${message}`)
}
function component(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160) return fail(`${name} must be a nonempty string of at most160 UTF-8 bytes`)
  return Buffer.from(value).toString('base64url')
}
export const projectRecordPath = (store: string, project: string, id: string) => join(store, 'projects', component(project, 'project'), component(id, 'record id') + '.json')
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
function validateIdentity(value: unknown): asserts value is ProjectBenchmarkIdentity {
  if (!value || typeof value !== 'object') fail('identity is missing')
  const identity = value as ProjectBenchmarkIdentity
  component(identity.project, 'project')
  if (identity.lane !== undefined) component(identity.lane, 'lane')
  for (const key of ['protocol', 'artifact', 'measurement'] as const) {
    if (!Object.hasOwn(identity, key)) fail(`identity.${key} is missing`)
    stableValue(identity[key])
  }
}
function validateRecord(value: unknown): asserts value is ProjectBenchmarkRecord {
  if (!value || typeof value !== 'object') fail('record is not an object')
  const record = value as ProjectBenchmarkRecord
  if (record.schemaVersion !== 1) fail('unsupported record schema')
  component(record.id, 'record id')
  validateIdentity(record.identity)
  const start = Date.parse(record.startedAt),
    finish = Date.parse(record.finishedAt)
  if (typeof record.startedAt !== 'string' || typeof record.finishedAt !== 'string' || !Number.isFinite(start) || !Number.isFinite(finish) || finish < start) fail('record needs ordered start/finish timestamps')
  if (!['passed', 'failed', 'blocked'].includes(record.status)) fail('record has no completed status')
  if (typeof record.evidenceDirectory !== 'string' || !isAbsolute(record.evidenceDirectory)) fail('evidenceDirectory must be absolute')
  if (!strings(record.evidenceFiles) || !record.evidenceFiles.length || new Set(record.evidenceFiles).size !== record.evidenceFiles.length || record.evidenceFiles.some(path => isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')))
    fail('evidenceFiles must contain unique relative file paths')
  if (!Array.isArray(record.observations) || !strings(record.gaps)) fail('observations or gaps are missing')
  if (record.status === 'passed' && !record.observations.length) fail('an empty attempt cannot pass')
  const keys = new Set<string>()
  for (const row of record.observations) {
    if (!row || typeof row !== 'object' || ['suite', 'surface', 'runtime', 'family', 'caseId', 'operation', 'format', 'mode'].some(key => typeof row[key as keyof BenchmarkObservation] !== 'string')) fail('observation dimensions are invalid')
    if (!['passed', 'failed', 'unsupported', 'blocked', 'not-applicable', 'skipped'].includes(row.status)) fail('observation status is invalid')
    if (row.samplesMs !== undefined && (!Array.isArray(row.samplesMs) || row.samplesMs.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0))) fail('invalid timing samples')
    if (row.bytes !== undefined && (!Number.isSafeInteger(row.bytes) || row.bytes < 0)) fail('invalid output byte count')
    if (row.metrics?.implementation && row.metrics.implementation !== record.identity.project && row.metrics.variantOf !== record.identity.project) fail('observation belongs to another project')
    const key = stableValue([row.suite, row.surface, row.runtime, row.family, row.caseId, row.operation, row.format, row.mode, row.metrics?.implementation ?? null, row.metrics?.round ?? null, row.metrics?.metricId ?? null])
    if (keys.has(key)) fail('duplicate observation identity')
    keys.add(key)
  }
  if (record.status === 'passed' && record.observations.some(row => row.status === 'failed' || row.status === 'blocked')) fail('passed record contains failed or blocked evidence')
}
function readIndex(store: string): ProjectIndex {
  const path = join(store, 'current.json')
  if (!existsSync(path)) return { schemaVersion: 1, projects: [] }
  const index = JSON.parse(readFileSync(path, 'utf8')) as ProjectIndex
  if (index.schemaVersion !== 1 || !Array.isArray(index.projects)) fail('unsupported current index')
  const seen = new Set<string>()
  for (const entry of index.projects) {
    component(entry.project, 'project')
    if (entry.lane !== undefined) component(entry.lane, 'lane')
    component(entry.current, 'record id')
    const key = stableValue([entry.project, lane(entry)])
    if (seen.has(key) || !strings(entry.history) || !entry.history.includes(entry.current) || new Set(entry.history).size !== entry.history.length) fail('invalid project history')
    seen.add(key)
    for (const id of entry.history) component(id, 'record id')
  }
  return index
}
interface OutputReference { path: string; bytes: number; sha256: string }
interface StoredRecordReference { schemaVersion: 2; kind: 'project-benchmark-record-reference'; id: string; project: string; lane?: string; payload: OutputReference }
const canonicalRecords = new WeakSet<ProjectBenchmarkRecord>()
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string): any => { const bytes = readFileSync(file); return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) }
const outputReference = (file: string): OutputReference => {
  if (!lstatSync(file).isFile()) return fail('canonical output must be a regular file, not a symlink')
  const bytes = readFileSync(file)
  return { path: resolve(file), bytes: bytes.length, sha256: digest(bytes) }
}
function verifyOutput(reference: OutputReference, ownerFile?: string): string {
  if (!reference || typeof reference.path !== 'string' || !reference.path || !Number.isSafeInteger(reference.bytes) || reference.bytes < 0 || typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sha256)) return fail('invalid output reference')
  const absolute = isAbsolute(reference.path)
  if (!absolute && (!ownerFile || basename(reference.path) !== reference.path || /[\\/]/.test(reference.path) || ['.', '..'].includes(reference.path))) return fail('invalid output reference')
  const file = absolute ? reference.path : join(dirname(resolve(ownerFile!)), reference.path), actual = outputReference(file)
  if (actual.bytes !== reference.bytes || actual.sha256 !== reference.sha256) return fail('canonical output differs from its immutable reference')
  return file
}
/** Publish a complete file without exposing a partially written destination.
 * Link is exclusive; a concurrent writer cannot replace an immutable payload. */
function immutableWrite(file: string, bytes: Buffer | string) {
  const temporary = file + '.' + randomUUID() + '.pending'
  try { writeFileSync(temporary, bytes, { flag: 'wx' }); linkSync(temporary, file) }
  finally { if (existsSync(temporary)) unlinkSync(temporary) }
}
/** One compressed observation payload. Existing completed bytes are never
 * rewritten, including on an explicit publication retry. */
export function writeProjectBenchmarkRecord(file: string, record: ProjectBenchmarkRecord): OutputReference {
  validateRecord(record)
  record = JSON.parse(JSON.stringify(record)) as ProjectBenchmarkRecord
  if (!file.endsWith('.json.gz')) return fail('new canonical record needs a .json.gz path')
  if (existsSync(file)) {
    if (stableValue(readProjectBenchmarkRecord(file)) !== stableValue(record)) return fail('canonical payload already contains a different attempt')
    return outputReference(file)
  }
  immutableWrite(file, gzipSync(Buffer.from(JSON.stringify(record))))
  return outputReference(file)
}
/** Legacy inline records remain readable. New store files are small references
 * to the one canonical gzip record in the owning evidence directory. */
export function readProjectBenchmarkRecord(file: string): ProjectBenchmarkRecord { return hydrateRecord(json(file), file) }
function hydrateRecord(stored: any, file: string): ProjectBenchmarkRecord {
  if (stored?.schemaVersion === 2 && stored.kind === 'project-benchmark-record-reference') {
    const reference = stored as StoredRecordReference, payload = verifyOutput(reference.payload), record = json(payload)
    validateRecord(record)
    if (record.id !== reference.id || record.identity.project !== reference.project || lane(record.identity) !== lane(reference)) return fail('record identity differs from its reference')
    canonicalRecords.add(record)
    return record
  }
  validateRecord(stored)
  if (file.endsWith('.gz')) canonicalRecords.add(stored)
  return stored
}
/** Resolve legacy suites, canonical records and small result references. When
 * passed a hydrated legacy record, retain its original owning-result check. */
const recordEnvelope = (value: any) => value?.schemaVersion === 1 && value.identity && Array.isArray(value.observations) && typeof value.evidenceDirectory === 'string'
/** Ordinary documents remain ordinary JSON. A typed result reference projects
 * a record to its suite result; reading the canonical record directly does not. */
export function readBenchmarkDocument(file: string): any { return resolveDocument(file, new Set(), false) }
function resolveDocument(source: string, visited: Set<string>, projectRecord: boolean): any {
  let file = source
  if (!existsSync(file) && existsSync(file + '.gz')) file += '.gz'
  const key = resolve(file)
  if (visited.has(key)) return fail('cyclic benchmark result reference')
  visited.add(key)
  const stored = json(file)
  if (stored?.schemaVersion === 2 && stored.kind === 'benchmark-result-reference') return resolveDocument(verifyOutput(stored.payload, file), visited, true)
  if (stored?.schemaVersion === 2 && stored.kind === 'project-benchmark-record-reference') { const record = hydrateRecord(stored, file); return projectRecord ? readBenchmarkResult(record) : record }
  if (projectRecord && recordEnvelope(stored)) return readBenchmarkResult(hydrateRecord(stored, file))
  return stored
}
export function readBenchmarkResult(source: string | ProjectBenchmarkRecord): UnifiedSuiteResult {
  if (typeof source !== 'string') {
    const result = { ...(source.provenance as object), observations: source.observations } as UnifiedSuiteResult
    if (!result.id || !result.status || !result.startedAt || !result.finishedAt || !Array.isArray(result.gaps)) return fail('record has no suite result metadata')
    const owning = join(source.evidenceDirectory, 'result.json')
    if (!canonicalRecords.has(source) && existsSync(owning)) {
      const original = json(owning)
      if (stableValue(original) !== stableValue(result)) return fail('owning benchmark result differs from its immutable project record')
    }
    return result
  }
  const stored = resolveDocument(source, new Set(), true)
  if (!Array.isArray(stored?.observations) || !Array.isArray(stored?.gaps)) return fail('file has no benchmark result')
  return stored as UnifiedSuiteResult
}
function mutableWrite(file: string, bytes: Buffer | string) {
  const temporary = file + '.' + randomUUID() + '.pending'
  try { writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, file) }
  finally { if (existsSync(temporary)) unlinkSync(temporary) }
}
function writeResultReference(file: string, payloadFile: string, sibling: boolean) {
  const payload = outputReference(payloadFile)
  if (sibling) payload.path = basename(payloadFile)
  mutableWrite(file, JSON.stringify({ schemaVersion: 2, kind: 'benchmark-result-reference', payload }) + '\n')
}
export function writeBenchmarkResultReference(file: string, payloadFile: string): void { writeResultReference(file, payloadFile, false) }
/** Derived reports may be regenerated. Canonical measurement records use the
 * immutable writer above and are never rewritten by this document writer. */
export function writeBenchmarkDocument(file: string, value: unknown): void {
  if (!file.endsWith('.json')) return fail('derived document destination needs a .json path')
  const payload = file + '.gz'
  for (const existing of [file, payload]) if (existsSync(existing)) {
    const document = json(existing)
    if (recordEnvelope(document) || document?.schemaVersion === 2 && document.kind === 'project-benchmark-record-reference') return fail('immutable measurement record cannot be rewritten as a derived document')
  }
  mutableWrite(payload, gzipSync(Buffer.from(JSON.stringify(value))))
  writeResultReference(file, payload, true)
}
function readRecord(store: string, project: string, id: string, expectedLane = 'community'): ProjectBenchmarkRecord {
  const record = readProjectBenchmarkRecord(projectRecordPath(store, project, id))
  if (record.id !== id || record.identity.project !== project || lane(record.identity) !== expectedLane) fail('record identity differs from its index')
  return record
}
function retained(record: ProjectBenchmarkRecord): boolean {
  return existsSync(record.evidenceDirectory) && statSync(record.evidenceDirectory).isDirectory() && record.evidenceFiles.every(file => existsSync(join(record.evidenceDirectory, file)) && statSync(join(record.evidenceDirectory, file)).isFile())
}

export function findProjectRecord(store: string, identity: ProjectBenchmarkIdentity): ProjectBenchmarkRecord | undefined {
  validateIdentity(identity)
  const entry = readIndex(store).projects.find(entry => entry.project === identity.project && lane(entry) === lane(identity))
  if (!entry) return undefined
  const key = identityKey(identity)
  for (const id of [...entry.history].reverse()) {
    const record = readRecord(store, entry.project, id, lane(entry))
    if (identityKey(record.identity) === key && retained(record)) return record
  }
  return undefined
}

function withWriterLock(store: string, action: () => void): void {
  mkdirSync(store, { recursive: true })
  const lock = join(store, '.writer.lock'),
    descriptor = openSync(lock, 'wx')
  try {
    action()
  } finally {
    closeSync(descriptor)
    unlinkSync(lock)
  }
}
function publishIndex(store: string, index: ProjectIndex): void {
  const temporary = join(store, `.current-${process.pid}.pending`),
    descriptor = openSync(temporary, 'wx')
  let published = false
  try {
    try {
      writeFileSync(descriptor, JSON.stringify(index, null, 2) + '\n')
    } finally {
      closeSync(descriptor)
    }
    renameSync(temporary, join(store, 'current.json'))
    published = true
  } finally {
    if (!published && existsSync(temporary)) unlinkSync(temporary)
  }
}

export interface RecordPublicationOptions { payloadFile?: string }
/** Only the index is mutable. New store entries reference a canonical compressed
 * record instead of copying its observations and dependency identities. */
export function publishProjectRecord(store: string, record: ProjectBenchmarkRecord, options: RecordPublicationOptions = {}): void {
  validateRecord(record)
  record = JSON.parse(JSON.stringify(record)) as ProjectBenchmarkRecord
  if (!retained(record)) fail('retained evidence directory is missing')
  withWriterLock(store, () => {
    const index = readIndex(store), destination = projectRecordPath(store, record.identity.project, record.id)
    const entry = index.projects.find(entry => entry.project === record.identity.project && lane(entry) === lane(record.identity))
    if (entry?.history.includes(record.id)) return fail('immutable attempt is already published')
    mkdirSync(dirname(destination), { recursive: true })
    if (existsSync(destination)) {
      // An exact, complete orphan from a failed index write may finish that
      // publication. A truncated or conflicting orphan cannot be overwritten.
      if (stableValue(readProjectBenchmarkRecord(destination)) !== stableValue(record)) return fail('unpublished record differs from the completed attempt')
    } else {
      const payload = options.payloadFile ?? join(record.evidenceDirectory, 'record-' + digest(gzipSync(Buffer.from(JSON.stringify(record)))) + '.json.gz')
      if (!resolve(payload).startsWith(resolve(record.evidenceDirectory) + sep)) return fail('canonical payload must belong to the evidence directory')
      if (options.payloadFile) {
        if (stableValue(readProjectBenchmarkRecord(payload)) !== stableValue(record)) return fail('canonical payload differs from the completed attempt')
      } else writeProjectBenchmarkRecord(payload, record)
      const reference: StoredRecordReference = { schemaVersion: 2, kind: 'project-benchmark-record-reference', id: record.id, project: record.identity.project, ...(record.identity.lane ? { lane: record.identity.lane } : {}), payload: outputReference(payload) }
      immutableWrite(destination, JSON.stringify(reference) + '\n')
    }
    if (entry) { entry.current = record.id; entry.history.push(record.id) }
    else index.projects.push({ project: record.identity.project, ...(record.identity.lane ? { lane: record.identity.lane } : {}), current: record.id, history: [record.id] })
    publishIndex(store, index)
  })
}

/** Reusing an earlier identity selects that exact attempt without rewriting it. */
export function activateProjectRecord(store: string, record: ProjectBenchmarkRecord): void {
  validateRecord(record)
  withWriterLock(store, () => {
    const index = readIndex(store),
      entry = index.projects.find(entry => entry.project === record.identity.project && lane(entry) === lane(record.identity))
    if (!entry || !entry.history.includes(record.id)) return fail('cannot activate an unpublished attempt')
    const stored = readRecord(store, record.identity.project, record.id, lane(record.identity))
    if (stableValue(stored) !== stableValue(record)) fail('activation differs from the immutable attempt')
    if (!retained(stored)) fail('retained evidence is missing for activation')
    if (entry.current === record.id) return
    entry.current = record.id
    publishIndex(store, index)
  })
}

export function loadCurrentProjectRecords(store: string): ProjectBenchmarkRecord[] {
  return readIndex(store).projects.map(entry => {
    const record = readRecord(store, entry.project, entry.current, lane(entry))
    if (!retained(record)) fail(`retained evidence is missing for ${entry.project}`)
    return record
  })
}

/** Retain missing-evidence entries for reporting without qualifying them for reuse. */
export function inspectCurrentProjectRecords(store: string): { record: ProjectBenchmarkRecord; evidenceRetained: boolean }[] {
  return readIndex(store).projects.map(entry => {
    const record = readRecord(store, entry.project, entry.current, lane(entry))
    return { record, evidenceRetained: retained(record) }
  })
}
