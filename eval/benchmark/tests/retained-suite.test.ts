import { afterEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { protocolIdentity } from '../unified/protocol-identity.ts'
import { publicationResult, runRetainedSuite } from '../unified/retained-suite.ts'
import { loadCurrentProjectRecords, projectRecordPath, readBenchmarkResult, readBenchmarkDocument, readProjectBenchmarkRecord, stableValue } from '../portable/project-records.ts'
import type { UnifiedSuiteResult } from '../unified/types.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'retained-suite-'))
  directories.push(path)
  return path
}
const result = (): UnifiedSuiteResult => ({ id: 'fixture', status: 'passed', startedAt: '2026-10-25T00:00:00.000Z', finishedAt: '2026-10-25T00:00:01.000Z', observations: [{ suite: 'fixture', surface: 'public-api', runtime: 'node', family: 'flowchart', caseId: 'authored', operation: 'render', format: 'svg', mode: 'first-result', status: 'passed', samplesMs: [2] }], gaps: [] })

test('publication preserves raw clocks, separates actual samples and metadata, and rejects duplicated clocks', () => {
  const raw = result()
  raw.observations[0]!.metrics = { round: 1, sample: 1 }
  raw.observations.push({ ...raw.observations[0]!, metrics: { round: 1, sample: 2 } })
  const info = { ...raw.observations[0]!, samplesMs: undefined, mode: 'download-closure' }
  raw.observations.push(info, info)
  const before = JSON.stringify(raw)
  const published = publicationResult(raw, 'pele')
  expect(JSON.stringify(raw)).toBe(before)
  expect(new Set(published.observations.map(row => row.metrics!.metricId)).size).toBe(4)
  expect(published.observations.every(row => row.metrics!.implementation === 'pele')).toBe(true)
  expect(published.observations.map(row => row.samplesMs)).toEqual([[2], [2], undefined, undefined])
  raw.observations.push({ ...raw.observations[0]! })
  expect(() => publicationResult(raw, 'pele')).toThrow('Duplicate measured sample coordinates')
  raw.observations.pop()
  const resource = { ...raw.observations[0]!, samplesMs: undefined, mode: 'fresh-process-resource-paired-control' }
  raw.observations.push(resource)
  expect(publicationResult(raw, 'pele').observations).toHaveLength(5)
  raw.observations.push(resource)
  expect(() => publicationResult(raw, 'pele')).toThrow('Duplicate measured sample coordinates')
})

test('explicit recovery publishes completed matching raw evidence without measuring; cancellation or changed identity cannot recover', async () => {
  const root = directory()
  const out = join(root, 'out')
  const attempt = join(out, 'attempts/completed')
  mkdirSync(attempt, { recursive: true })
  const identity = { project: 'pele', lane: 'startup', protocol: 'v1', artifact: 'original', measurement: 'node' }
  const rawBytes = JSON.stringify(result(), null, 4) + '\n'
  const reset = (state = 'incomplete') => {
    writeFileSync(join(attempt, 'identity.json'), JSON.stringify(identity))
    writeFileSync(join(attempt, 'result.json'), rawBytes)
    const error = 'Error: Invalid benchmark record store: duplicate observation identity'
    writeFileSync(join(out, 'cache.json'), JSON.stringify({ project: 'pele', lane: 'startup', pendingAttempt: 'completed', state, published: false, error }))
    writeFileSync(join(attempt, 'publication-failure.json'), JSON.stringify({ attempt: 'completed', identity, stage: 'publication', state, error }))
  }
  const options = { out, records: join(root, 'records'), resumeAttempt: attempt, identity: () => identity, measure: async () => { throw Error('Must not remeasure') } }
  reset('cancelled')
  await expect(runRetainedSuite(options)).rejects.toThrow('attempt-bound')
  reset()
  writeFileSync(join(attempt, 'publication-failure.json'), JSON.stringify({ attempt: 'different', identity, stage: 'publication', state: 'incomplete', error: 'Error: Invalid benchmark record store: duplicate observation identity' }))
  await expect(runRetainedSuite(options)).rejects.toThrow('attempt-bound')
  reset()
  const eligibleCache = readFileSync(join(out, 'cache.json'), 'utf8')
  await expect(runRetainedSuite({ ...options, identity: () => ({ ...identity, artifact: 'changed' }) })).rejects.toThrow('attempt-bound')
  expect(readFileSync(join(out, 'cache.json'), 'utf8')).toBe(eligibleCache)
  expect(existsSync(join(root, 'records/current.json'))).toBe(false)
  const recovered = await runRetainedSuite(options)
  expect(readFileSync(join(attempt, 'raw-result.json'), 'utf8')).toBe(rawBytes)
  expect(existsSync(join(attempt, 'identity.json'))).toBe(true)
  expect(recovered.observations[0]!.samplesMs).toEqual([2])
  expect(recovered.startedAt).toBe(result().startedAt)
  expect(loadCurrentProjectRecords(options.records)[0]!.id).toBe('completed')
  const reused = await runRetainedSuite({ ...options, resumeAttempt: undefined })
  expect(reused).toEqual(recovered)
})

test('retained selected-project results reuse clocks and dates; changed identity only measures that project', async () => {
  const root = directory()
  const records = join(root, 'records')
  let calls = 0
  let version = '1.0.0'
  const run = (project: string) => runRetainedSuite({ out: join(root, project), records, identity: () => ({ project, lane: 'startup', protocol: 'v1', artifact: { version }, measurement: { samples: 5 } }), measure: async () => { calls++; return result() } })
  const first = await run('pele')
  await run('peer')
  const repeated = await run('pele')
  expect(calls).toBe(2)
  expect(repeated).toEqual(first)
  expect(JSON.parse(readFileSync(join(root, 'pele/cache.json'), 'utf8')).reused).toBe(true)
  const peerId = loadCurrentProjectRecords(records).find(record => record.identity.project === 'peer')!.id
  version = '1.0.1'
  await run('pele')
  expect(calls).toBe(3)
  expect(loadCurrentProjectRecords(records).find(record => record.identity.project === 'peer')!.id).toBe(peerId)
})

test('changed owning observations cannot be reused and do not replace the published pointer', async () => {
  const root = directory()
  const options = { out: join(root, 'out'), records: join(root, 'records'), identity: () => ({ project: 'pele', lane: 'startup', protocol: 'v1', artifact: 'shipped-byte-proof', measurement: 'node' }), measure: async () => result() }
  await runRetainedSuite(options)
  const original = loadCurrentProjectRecords(options.records)[0]!
  const payload = join(original.evidenceDirectory, 'result.json.gz'), bytes = readFileSync(payload), index = readFileSync(join(options.records, 'current.json'), 'utf8')
  writeFileSync(payload, Buffer.concat([bytes, Buffer.from('corruption')]))
  await expect(runRetainedSuite(options)).rejects.toThrow('canonical output differs')
  expect(readFileSync(join(options.records, 'current.json'), 'utf8')).toBe(index)
  expect(() => loadCurrentProjectRecords(options.records)).toThrow('canonical output differs')
  writeFileSync(payload, bytes)
  expect(loadCurrentProjectRecords(options.records)[0]!.id).toBe(original.id)
  expect(JSON.parse(readFileSync(join(options.out, 'result.json'), 'utf8')).status).toBe('incomplete')
})

test('identity changes during collection retain incomplete evidence without publishing', async () => {
  const root = directory()
  let artifact = 'original'
  await expect(runRetainedSuite({ out: join(root, 'out'), records: join(root, 'records'), identity: () => ({ project: 'pele', lane: 'startup', protocol: 'v1', artifact, measurement: 'node' }), measure: async () => { artifact = 'changed'; return result() } })).rejects.toThrow('identity changed')
  expect(existsSync(join(root, 'records/current.json'))).toBe(false)
  expect(JSON.parse(readFileSync(join(root, 'out/cache.json'), 'utf8')).published).toBe(false)
})

test('cancellation during final identity validation cannot publish a completed measurement', async () => {
  const root = directory()
  let measured = false
  const identity = () => {
    if (measured) process.emit('SIGTERM')
    return { project: 'pele', lane: 'startup', protocol: 'v1', artifact: 'same', measurement: 'node' }
  }
  await expect(runRetainedSuite({ out: join(root, 'out'), records: join(root, 'records'), identity, measure: async () => { measured = true; return result() } })).rejects.toThrow('cancelled by SIGTERM')
  expect(existsSync(join(root, 'records/current.json'))).toBe(false)
  expect(JSON.parse(readFileSync(join(root, 'out/cache.json'), 'utf8')).state).toBe('cancelled')
  const cache = JSON.parse(readFileSync(join(root, 'out/cache.json'), 'utf8')), payload = join(root, 'out/attempts', cache.pendingAttempt, 'result.json.gz')
  expect(readBenchmarkResult(payload).observations[0]!.samplesMs).toEqual([2])
  expect(existsSync(join(root, 'out/attempts', cache.pendingAttempt, 'identity.json'))).toBe(true)
  await expect(runRetainedSuite({ out: join(root, 'out'), records: join(root, 'records'), resumeAttempt: join(root, 'out/attempts', cache.pendingAttempt), identity: () => ({ project: 'pele', lane: 'startup', protocol: 'v1', artifact: 'same', measurement: 'node' }), measure: async () => { throw Error('Cancelled output must not remeasure') } })).rejects.toThrow('attempt-bound')
})

test('an artifact change during cached-evidence validation cannot activate the cached result', async () => {
  const root = directory()
  let changed = false
  let checkingReuse = false
  let identityCalls = 0
  const options = {
    out: join(root, 'out'), records: join(root, 'records'),
    identity: () => { if (checkingReuse && ++identityCalls === 2) changed = true; return { project: 'pele', lane: 'startup', protocol: 'v1', artifact: changed ? 'changed' : 'same', measurement: 'node' } },
    measure: async () => result(),
  }
  await runRetainedSuite(options)
  checkingReuse = true
  await expect(runRetainedSuite(options)).rejects.toThrow('changed while validating retained evidence')
  expect(JSON.parse(readFileSync(join(root, 'out/cache.json'), 'utf8')).state).toBe('incomplete')
})

test('producer identity follows runtime dependencies and spawned roots without binding reports or type-only imports', () => {
  const root = directory()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.name', 'Benchmark fixture')
  git('config', 'user.email', 'benchmark@example.invalid')
  writeFileSync(join(root, 'entry.ts'), "import { work } from './work.js'; import type { T } from './types.ts'; export const run=work;\n")
  writeFileSync(join(root, 'work.ts'), 'export function work(){return 1}\n')
  writeFileSync(join(root, 'types.ts'), 'export type T=string\n')
  writeFileSync(join(root, 'worker.mjs'), 'export const worker=true\n')
  writeFileSync(join(root, 'report.ts'), 'export const heading="report"\n')
  git('add', '.')
  git('commit', '-qm', 'Fixture sources')
  const before = protocolIdentity(root, ['entry.ts', 'worker.mjs'])
  writeFileSync(join(root, 'report.ts'), 'export const heading="changed report"\n')
  writeFileSync(join(root, 'types.ts'), 'export type T=number\n')
  expect(protocolIdentity(root, ['entry.ts', 'worker.mjs'])).toEqual(before)
  writeFileSync(join(root, 'work.ts'), 'export function work(){return 2}\n')
  expect(() => protocolIdentity(root, ['entry.ts', 'worker.mjs'])).toThrow('Commit measurement producers')
  git('add', 'work.ts')
  git('commit', '-qm', 'Changed producer')
  expect(protocolIdentity(root, ['entry.ts', 'worker.mjs'])).not.toEqual(before)
  mkdirSync(join(root, 'untracked'))
  writeFileSync(join(root, 'untracked/new.ts'), 'export const newWork=1\n')
  expect(() => protocolIdentity(root, ['untracked/new.ts'])).toThrow('Uncommitted')
})


test('new retained attempts store observations once and resolve both compressed and reference result APIs', async () => {
  const root = directory(), out = join(root, 'out'), records = join(root, 'records')
  const actual = await runRetainedSuite({ out, records, identity: () => ({ project: 'pele', lane: 'startup', protocol: 'v1', artifact: 'same', measurement: 'node' }), measure: async () => ({ ...result(), artifacts: undefined }) })
  const record = loadCurrentProjectRecords(records)[0]!, payload = join(record.evidenceDirectory, 'result.json.gz')
  expect(existsSync(join(record.evidenceDirectory, 'raw-result.json'))).toBe(false)
  expect(existsSync(join(record.evidenceDirectory, 'identity.json'))).toBe(false)
  expect(existsSync(join(record.evidenceDirectory, 'result.json'))).toBe(false)
  expect(JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')).observations).toBeUndefined()
  expect(JSON.parse(readFileSync(projectRecordPath(records, record.identity.project, record.id), 'utf8')).observations).toBeUndefined()
  expect(readBenchmarkResult(payload)).toEqual(actual)
  expect(readBenchmarkResult(join(record.evidenceDirectory, 'result.json'))).toEqual(actual)
  expect(readBenchmarkResult(join(out, 'result.json'))).toEqual(actual)
  expect(readBenchmarkDocument(join(out, 'result.json'))).toEqual(actual)
  expect(readBenchmarkDocument(payload)).toEqual(record)
})

test('completed canonical output can recover publication without being rewritten or measured again', async () => {
  const root = directory(), out = join(root, 'out'), records = join(root, 'records')
  mkdirSync(records); writeFileSync(join(records, '.writer.lock'), 'another writer')
  let calls = 0
  const options = { out, records, identity: () => ({ project: 'pele', lane: 'startup', protocol: 'v1', artifact: 'same', measurement: 'node' }), measure: async () => { calls++; return result() } }
  await expect(runRetainedSuite(options)).rejects.toThrow()
  const cache = JSON.parse(readFileSync(join(out, 'cache.json'), 'utf8')), attempt = join(out, 'attempts', cache.pendingAttempt), payload = join(attempt, 'result.json.gz'), before = readFileSync(payload)
  expect(existsSync(join(attempt, 'identity.json'))).toBe(true)
  rmSync(join(records, '.writer.lock'))
  const originalFailure = readFileSync(join(attempt, 'publication-failure.json'), 'utf8'), originalCache = readFileSync(join(out, 'cache.json'), 'utf8'), altered = readProjectBenchmarkRecord(payload)
  altered.observations[0]!.samplesMs = [0.1]
  writeFileSync(payload, gzipSync(Buffer.from(JSON.stringify(altered))))
  await expect(runRetainedSuite({ ...options, resumeAttempt: attempt })).rejects.toThrow('canonical output differs')
  expect(existsSync(join(records, 'current.json'))).toBe(false)
  expect(readFileSync(join(attempt, 'publication-failure.json'), 'utf8')).toBe(originalFailure)
  expect(readFileSync(join(out, 'cache.json'), 'utf8')).toBe(originalCache)
  writeFileSync(payload, before)
  const recovered = await runRetainedSuite({ ...options, resumeAttempt: attempt })
  expect(calls).toBe(1)
  expect(readFileSync(payload)).toEqual(before)
  expect(existsSync(join(attempt, 'identity.json'))).toBe(false)
  expect(recovered.startedAt).toBe(result().startedAt)
  expect(readBenchmarkResult(join(out, 'result.json'))).toEqual(recovered)
})

test('an actual legacy inline record reuses original results without migration or remeasurement', async () => {
  const root = directory(), out = join(root, 'out'), records = join(root, 'records'), attempt = join(out, 'attempts', 'legacy')
  mkdirSync(attempt, { recursive: true })
  const identity = { project: 'pele', lane: 'startup', protocol: 'v1', artifact: 'same', measurement: 'node' }, original = publicationResult(result(), 'pele'), { observations, ...provenance } = original
  const record = { schemaVersion: 1, id: 'legacy', identity, startedAt: original.startedAt, finishedAt: original.finishedAt, status: original.status, evidenceDirectory: attempt, evidenceFiles: ['result.json'], observations, gaps: [], provenance }
  const recordFile = projectRecordPath(records, 'pele', 'legacy'); mkdirSync(join(records, 'projects', Buffer.from('pele').toString('base64url')), { recursive: true })
  const bytes = JSON.stringify(record, null, 4) + '\n'; writeFileSync(recordFile, bytes); writeFileSync(join(attempt, 'result.json'), JSON.stringify(original)); writeFileSync(join(records, 'current.json'), JSON.stringify({ schemaVersion: 1, projects: [{ project: 'pele', lane: 'startup', current: 'legacy', history: ['legacy'] }] }))
  const reused = await runRetainedSuite({ out, records, identity: () => identity, measure: async () => { throw Error('Legacy measurement must not run') } })
  expect(stableValue(reused)).toBe(stableValue(original))
  expect(readFileSync(recordFile, 'utf8')).toBe(bytes)
  expect(existsSync(join(attempt, 'result.json.gz'))).toBe(false)
  expect(JSON.parse(readFileSync(join(out, 'cache.json'), 'utf8'))).toMatchObject({ reused: true, recordId: 'legacy', startedAt: original.startedAt, finishedAt: original.finishedAt })
  const altered = publicationResult(result(), 'pele'); altered.observations[0]!.samplesMs = [0.1]
  writeFileSync(join(attempt, 'result.json'), JSON.stringify(altered))
  await expect(runRetainedSuite({ out, records, identity: () => identity, measure: async () => { throw Error('Corrupted legacy evidence must not remeasure') } })).rejects.toThrow('owning benchmark result differs')
  expect(readFileSync(recordFile, 'utf8')).toBe(bytes)
})


for (const cached of [false, true]) test(`queued OS cancellation during ${cached ? 'cached' : 'fresh'} identity validation is delivered before publication`, async () => {
  const root = directory(), out = join(root, 'out'), records = join(root, 'records')
  let checking = false, calls = 0
  const identity = () => { if (checking && ++calls === 2) process.kill(process.pid, 'SIGTERM'); return { project: 'pele', lane: 'startup', protocol: 'v1', artifact: 'same', measurement: 'node' } }
  const options = { out, records, identity, measure: async () => result() }, harmless = () => {}
  // Keep the test process alive if an incorrect implementation removes its
  // cancellation listener before the queued OS signal is delivered.
  process.on('SIGTERM', harmless)
  try {
    if (cached) await runRetainedSuite(options)
    checking = true
    await expect(runRetainedSuite(options)).rejects.toThrow('cancelled by SIGTERM')
    expect(JSON.parse(readFileSync(join(out, 'cache.json'), 'utf8')).state).toBe('cancelled')
    expect(loadCurrentProjectRecords(records)).toHaveLength(cached ? 1 : 0)
  } finally { await new Promise<void>(resolve => setImmediate(resolve)); process.off('SIGTERM', harmless) }
})


test('a failure receipt anchors the original completed output rather than corruption discovered at publication', async () => {
  const root = directory(), out = join(root, 'out'), records = join(root, 'records')
  let admissions = 0, originalOutput: Buffer | undefined
  const data = { project: 'pele', lane: 'startup', protocol: 'v1', artifact: 'same', measurement: 'node' }
  const identity = () => {
    if (++admissions === 2) {
      const cache = JSON.parse(readFileSync(join(out, 'cache.json'), 'utf8')), payload = join(out, 'attempts', cache.pendingAttempt, 'result.json.gz')
      originalOutput = readFileSync(payload)
      const changed = readProjectBenchmarkRecord(payload); changed.observations[0]!.samplesMs = [0.1]
      writeFileSync(payload, gzipSync(Buffer.from(JSON.stringify(changed))))
    }
    return data
  }
  const options = { out, records, identity, measure: async () => result() }
  await expect(runRetainedSuite(options)).rejects.toThrow('canonical payload differs')
  const cache = JSON.parse(readFileSync(join(out, 'cache.json'), 'utf8')), attempt = join(out, 'attempts', cache.pendingAttempt)
  expect(existsSync(join(records, 'current.json'))).toBe(false)
  await expect(runRetainedSuite({ ...options, identity: () => data, resumeAttempt: attempt, measure: async () => { throw Error('Do not remeasure corrupted output') } })).rejects.toThrow('canonical output differs')
  writeFileSync(join(attempt, 'result.json.gz'), originalOutput!)
  const recovered = await runRetainedSuite({ ...options, identity: () => data, resumeAttempt: attempt, measure: async () => { throw Error('Do not remeasure repaired original output') } })
  expect(recovered.observations[0]!.samplesMs).toEqual([2])
})
