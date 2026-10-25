import { afterEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { protocolIdentity } from '../unified/protocol-identity.ts'
import { publicationResult, runRetainedSuite } from '../unified/retained-suite.ts'
import { loadCurrentProjectRecords } from '../unified/project-records.ts'
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
    writeFileSync(join(out, 'cache.json'), JSON.stringify({ project: 'pele', lane: 'startup', state, published: false, error: 'Error: Invalid benchmark record store: duplicate observation identity' }))
  }
  const options = { out, records: join(root, 'records'), resumeAttempt: attempt, identity: () => identity, measure: async () => { throw Error('Must not remeasure') } }
  reset('cancelled')
  await expect(runRetainedSuite(options)).rejects.toThrow('rejected only by')
  reset()
  await expect(runRetainedSuite({ ...options, identity: () => ({ ...identity, artifact: 'changed' }) })).rejects.toThrow('identity differs')
  expect(existsSync(join(root, 'records/current.json'))).toBe(false)
  reset()
  const recovered = await runRetainedSuite(options)
  expect(readFileSync(join(attempt, 'raw-result.json'), 'utf8')).toBe(rawBytes)
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
  const changed = result()
  changed.observations[0]!.samplesMs = [0.1]
  writeFileSync(join(original.evidenceDirectory, 'result.json'), JSON.stringify(changed))
  await expect(runRetainedSuite(options)).rejects.toThrow('differs from its immutable project record')
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
