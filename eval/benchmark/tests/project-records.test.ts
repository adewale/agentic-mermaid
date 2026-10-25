import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activateProjectRecord, findProjectRecord, inspectCurrentProjectRecords, loadCurrentProjectRecords, type ProjectBenchmarkIdentity, type ProjectBenchmarkRecord, publishProjectRecord, stableValue } from '../unified/project-records.ts'

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mermaid-project-records-'))
  temporary.push(root)
  const evidence = join(root, 'evidence')
  mkdirSync(evidence)
  writeFileSync(join(evidence, 'community-result.json'), '{"status":"passed"}')
  const identity = (project = 'owner/tool'): ProjectBenchmarkIdentity => ({
    project,
    protocol: { gitTree: 'reviewed-protocol-object' },
    artifact: { version: '1.0', integrity: 'shipped-bytes' },
    measurement: { runtime: 'Node24', rounds: 3 },
  })
  const record = (id: string, project = 'owner/tool'): ProjectBenchmarkRecord => ({
    schemaVersion: 1,
    id,
    identity: identity(project),
    startedAt: '2026-10-25T00:00:00Z',
    finishedAt: '2026-10-25T00:01:00Z',
    status: 'passed',
    evidenceDirectory: evidence,
    evidenceFiles: ['community-result.json'],
    observations: [
      {
        suite: 'community',
        surface: 'node:public-api',
        runtime: 'Node',
        family: 'flowchart',
        caseId: 'core:flow5',
        operation: 'render',
        format: 'svg',
        mode: 'core-api-repeat',
        status: 'passed',
        samplesMs: [1, 2, 3],
        metrics: { implementation: project, round: 1 },
      },
    ],
    gaps: [],
  })
  return { store: join(root, 'store'), evidence, identity, record }
}
describe('immutable project benchmark records', () => {
  test('reuses the same full identity and invalidates artifact, protocol and measurement changes', () => {
    const f = fixture(),
      attempt = f.record('first')
    publishProjectRecord(f.store, attempt)
    expect(findProjectRecord(f.store, f.identity())).toEqual(attempt)
    for (const key of ['artifact', 'protocol', 'measurement'] as const)
      expect(
        findProjectRecord(f.store, {
          ...f.identity(),
          [key]: { changed: true },
        }),
      ).toBeUndefined()
    expect(stableValue({ z: 1, a: { y: 2, x: 3 } })).toBe(stableValue({ a: { x: 3, y: 2 }, z: 1 }))
  })
  test('updates one project without rewriting another project or erasing history', () => {
    const f = fixture()
    publishProjectRecord(f.store, f.record('one'))
    publishProjectRecord(f.store, f.record('two', 'peer/tool'))
    const before = readFileSync(join(f.store, 'current.json'), 'utf8')
    const newer = {
      ...f.record('three'),
      identity: { ...f.identity(), artifact: { version: '2.0' } },
    }
    publishProjectRecord(f.store, newer)
    expect(loadCurrentProjectRecords(f.store).map(record => [record.identity.project, record.id])).toEqual([
      ['owner/tool', 'three'],
      ['peer/tool', 'two'],
    ])
    expect(findProjectRecord(f.store, f.identity())?.id).toBe('one')
    expect(findProjectRecord(f.store, f.identity('peer/tool'))?.id).toBe('two')
    expect(JSON.parse(before).projects[1]).toEqual(JSON.parse(readFileSync(join(f.store, 'current.json'), 'utf8')).projects[1])
  })
  test('reactivates an earlier version without rewriting attempts or duplicating history', () => {
    const f = fixture(),
      first = f.record('version-one'),
      second = { ...f.record('version-two'), identity: { ...f.identity(), artifact: { version: '2.0' } } }
    publishProjectRecord(f.store, first)
    publishProjectRecord(f.store, second)
    publishProjectRecord(f.store, f.record('peer', 'peer/tool'))
    const directory = join(f.store, 'projects', Buffer.from('owner/tool').toString('base64url'))
    const before = Object.fromEntries(readdirSync(directory).map(file => [file, readFileSync(join(directory, file), 'utf8')]))
    activateProjectRecord(f.store, findProjectRecord(f.store, f.identity())!)
    expect(loadCurrentProjectRecords(f.store).map(record => record.id)).toEqual(['version-one', 'peer'])
    const index = JSON.parse(readFileSync(join(f.store, 'current.json'), 'utf8'))
    expect(index.projects[0].history).toEqual(['version-one', 'version-two'])
    expect(Object.fromEntries(readdirSync(directory).map(file => [file, readFileSync(join(directory, file), 'utf8')]))).toEqual(before)
    expect(() => activateProjectRecord(f.store, { ...first, gaps: ['modified'] })).toThrow('immutable attempt')
    expect(() => activateProjectRecord(f.store, { ...first, id: 'unpublished' })).toThrow('unpublished attempt')
    expect(loadCurrentProjectRecords(f.store)[0]?.id).toBe('version-one')
    activateProjectRecord(f.store, second)
    expect(loadCurrentProjectRecords(f.store)[0]?.id).toBe('version-two')
  })
  test('retains failed results without treating them as passes', () => {
    const f = fixture(),
      record = f.record('failed')
    record.status = 'failed'
    record.observations[0]!.status = 'failed'
    record.gaps = ['lost authored label']
    publishProjectRecord(f.store, record)
    expect(findProjectRecord(f.store, f.identity())?.status).toBe('failed')
    expect(loadCurrentProjectRecords(f.store)[0]?.gaps).toEqual(['lost authored label'])
    record.id = 'contradiction'
    record.status = 'passed'
    expect(() => publishProjectRecord(f.store, record)).toThrow('contains failed or blocked')
  })
  test('missing retained evidence cannot be reused or ranked', () => {
    const f = fixture()
    publishProjectRecord(f.store, f.record('first'))
    rmSync(join(f.evidence, 'community-result.json'))
    expect(existsSync(f.evidence)).toBe(true)
    expect(findProjectRecord(f.store, f.identity())).toBeUndefined()
    expect(() => loadCurrentProjectRecords(f.store)).toThrow('retained evidence is missing')
  })
  test('reports missing peer evidence while allowing an independent project update', () => {
    const f = fixture(),
      peerEvidence = join(f.evidence, 'peer')
    mkdirSync(peerEvidence)
    writeFileSync(join(peerEvidence, 'community-result.json'), '{"status":"passed"}')
    publishProjectRecord(f.store, f.record('selected-first'))
    publishProjectRecord(f.store, { ...f.record('peer-first', 'peer/tool'), evidenceDirectory: peerEvidence })
    rmSync(join(peerEvidence, 'community-result.json'))
    publishProjectRecord(f.store, f.record('selected-updated'))
    expect(inspectCurrentProjectRecords(f.store).map(({ record, evidenceRetained }) => [record.id, evidenceRetained])).toEqual([
      ['selected-updated', true],
      ['peer-first', false],
    ])
    expect(findProjectRecord(f.store, f.identity())?.id).toBe('selected-updated')
    expect(findProjectRecord(f.store, f.identity('peer/tool'))).toBeUndefined()
    expect(() => loadCurrentProjectRecords(f.store)).toThrow('retained evidence is missing')
  })
  test('immutable collisions and a concurrent writer leave the published index unchanged', () => {
    const f = fixture()
    publishProjectRecord(f.store, f.record('first'))
    const index = readFileSync(join(f.store, 'current.json'), 'utf8')
    expect(() => publishProjectRecord(f.store, f.record('first'))).toThrow()
    expect(readFileSync(join(f.store, 'current.json'), 'utf8')).toBe(index)
    expect(existsSync(join(f.store, '.writer.lock'))).toBe(false)
    writeFileSync(join(f.store, '.writer.lock'), 'another writer')
    expect(() => publishProjectRecord(f.store, f.record('second'))).toThrow()
    expect(readFileSync(join(f.store, 'current.json'), 'utf8')).toBe(index)
    expect(readFileSync(join(f.store, '.writer.lock'), 'utf8')).toBe('another writer')
  })
  test('project paths are collision free and cannot escape the record store', () => {
    const f = fixture()
    for (const project of ['a/b', 'a_b', '../escape', '__proto__']) publishProjectRecord(f.store, f.record('attempt', project))
    expect(loadCurrentProjectRecords(f.store).map(record => record.identity.project)).toEqual(['a/b', 'a_b', '../escape', '__proto__'])
    expect(readdirSync(join(f.store, 'projects'))).toHaveLength(4)
    expect(() =>
      publishProjectRecord(f.store, {
        ...f.record('escape'),
        evidenceFiles: ['../outside.json'],
      }),
    ).toThrow('unique relative file paths')
  })
  test('a failed index publication retains the previous snapshot and releases the writer lock', () => {
    const f = fixture()
    publishProjectRecord(f.store, f.record('first'))
    const index = readFileSync(join(f.store, 'current.json'), 'utf8'),
      obstacle = join(f.store, `.current-${process.pid}.pending`)
    mkdirSync(obstacle)
    expect(() => publishProjectRecord(f.store, f.record('second'))).toThrow()
    expect(readFileSync(join(f.store, 'current.json'), 'utf8')).toBe(index)
    expect(existsSync(join(f.store, '.writer.lock'))).toBe(false)
    expect(loadCurrentProjectRecords(f.store)[0]?.id).toBe('first')
    rmSync(obstacle, { recursive: true })
    publishProjectRecord(f.store, f.record('third'))
    expect(loadCurrentProjectRecords(f.store)[0]?.id).toBe('third')
  })
  test('truncated evidence, mismatched identities and duplicate rows are rejected', () => {
    const f = fixture(),
      record = f.record('first')
    record.observations.push(record.observations[0]!)
    expect(() => publishProjectRecord(f.store, record)).toThrow('duplicate observation')
    record.observations.pop()
    record.observations[0]!.metrics!.implementation = 'other/tool'
    expect(() => publishProjectRecord(f.store, record)).toThrow('belongs to another')
    record.observations[0]!.metrics!.implementation = 'owner/tool'
    publishProjectRecord(f.store, record)
    const directory = join(f.store, 'projects', Buffer.from('owner/tool').toString('base64url'))
    writeFileSync(join(directory, readdirSync(directory)[0]!), '{"schemaVersion":1')
    expect(() => findProjectRecord(f.store, f.identity())).toThrow()
  })
})
