import { afterEach, describe, expect, test } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activateProjectRecord, findProjectRecord, inspectCurrentProjectRecords, loadCurrentProjectRecords, type ProjectBenchmarkIdentity, type ProjectBenchmarkRecord, projectRecordPath, readProjectBenchmarkRecord, readBenchmarkDocument, readBenchmarkResult, writeBenchmarkDocument, publishProjectRecord, stableValue } from '../portable/project-records.ts'

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
  test('different benchmark lanes retain independent current records for the same project', () => {
    const f = fixture(),
      community = f.record('community-first')
    const portable = { ...f.record('portable-first'), identity: { ...f.identity(), lane: 'portable-svg' } }
    publishProjectRecord(f.store, community)
    publishProjectRecord(f.store, portable)
    expect(findProjectRecord(f.store, community.identity)?.id).toBe('community-first')
    expect(findProjectRecord(f.store, { ...community.identity, lane: 'community' })?.id).toBe('community-first')
    expect(findProjectRecord(f.store, portable.identity)?.id).toBe('portable-first')
    const portableNext = { ...portable, id: 'portable-next', identity: { ...portable.identity, artifact: { version: 'next' } } }
    publishProjectRecord(f.store, portableNext)
    expect(loadCurrentProjectRecords(f.store).map(record => record.id)).toEqual(['community-first', 'portable-next'])
    activateProjectRecord(f.store, portable)
    expect(loadCurrentProjectRecords(f.store).map(record => record.id)).toEqual(['community-first', 'portable-first'])
  })
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
    const orphan = projectRecordPath(f.store, 'owner/tool', 'second'), orphanBytes = readFileSync(orphan, 'utf8')
    publishProjectRecord(f.store, f.record('second'))
    expect(readFileSync(orphan, 'utf8')).toBe(orphanBytes)
    expect(loadCurrentProjectRecords(f.store)[0]?.id).toBe('second')
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
  test('new entries reference one compressed canonical record and reject changed payload bytes', () => {
    const f = fixture(), record = f.record('compressed')
    record.observations[0]!.detail = 'retained measurement output '.repeat(2000)
    publishProjectRecord(f.store, record)
    const file = projectRecordPath(f.store, 'owner/tool', record.id), bytes = readFileSync(file, 'utf8'), pointer = JSON.parse(bytes)
    expect(pointer).toMatchObject({ schemaVersion: 2, kind: 'project-benchmark-record-reference' })
    expect(bytes.length).toBeLessThan(1024)
    expect(pointer.observations).toBeUndefined()
    expect(pointer.identity).toBeUndefined()
    expect(pointer.payload.bytes).toBeLessThan(JSON.stringify(record).length / 10)
    expect(readProjectBenchmarkRecord(file)).toEqual(record)
    expect(readProjectBenchmarkRecord(pointer.payload.path)).toEqual(record)
    expect(readBenchmarkDocument(pointer.payload.path)).toEqual(record)
    expect(readBenchmarkDocument(file)).toEqual(record)
    expect(() => writeBenchmarkDocument(pointer.payload.path.slice(0, -3), { changed: true })).toThrow('immutable measurement record')
    expect(findProjectRecord(f.store, f.identity())).toEqual(record)
    const index = readFileSync(join(f.store, 'current.json'), 'utf8')
    const altered = readProjectBenchmarkRecord(pointer.payload.path)
    altered.observations[0]!.samplesMs = [0.1, 2, 3]
    writeFileSync(pointer.payload.path, gzipSync(Buffer.from(JSON.stringify(altered))))
    expect(readProjectBenchmarkRecord(pointer.payload.path).observations[0]!.samplesMs).toEqual([0.1, 2, 3])
    expect(() => findProjectRecord(f.store, f.identity())).toThrow('canonical output differs')
    expect(readFileSync(join(f.store, 'current.json'), 'utf8')).toBe(index)
  })

  test('derived documents share the gzip/reference codec without imposing a suite schema or changing legacy JSON', () => {
    const f = fixture(), legacy = join(f.evidence, 'legacy.json'), document = join(f.evidence, 'summary.json')
    const value = { schemaVersion: 1, identity: { project: 'document-reader' }, counts: [1, 2], label: 'λ🙂' }, bytes = JSON.stringify(value, null, 4) + '\n'
    writeFileSync(legacy, bytes)
    expect(readBenchmarkDocument(legacy)).toEqual(value)
    writeBenchmarkDocument(document, value)
    expect(readBenchmarkDocument(document)).toEqual(value)
    expect(readBenchmarkDocument(document + '.gz')).toEqual(value)
    expect(() => readBenchmarkResult(document)).toThrow('file has no benchmark result')
    expect(JSON.parse(readFileSync(document, 'utf8')).observations).toBeUndefined()
    const altered = { ...value, counts: [0.1, 2] }
    writeFileSync(document + '.gz', gzipSync(Buffer.from(JSON.stringify(altered))))
    expect(() => readBenchmarkDocument(document)).toThrow('canonical output differs')
    writeBenchmarkDocument(document, altered)
    expect(readBenchmarkDocument(document)).toEqual(altered)
    expect(readFileSync(legacy, 'utf8')).toBe(bytes)
    const exported = join(f.evidence, 'exported'); mkdirSync(exported)
    const copy = join(exported, 'summary.json'); copyFileSync(document, copy); copyFileSync(document + '.gz', copy + '.gz')
    rmSync(document); rmSync(document + '.gz')
    expect(JSON.parse(readFileSync(copy, 'utf8')).payload.path).toBe('summary.json.gz')
    expect(readBenchmarkDocument(copy)).toEqual(altered)
    const copiedReference = readFileSync(copy, 'utf8'), unsafe = JSON.parse(copiedReference); unsafe.payload.path = '../exported/summary.json.gz'
    writeFileSync(copy, JSON.stringify(unsafe))
    expect(() => readBenchmarkDocument(copy)).toThrow('invalid output reference')
    writeFileSync(copy, copiedReference)
    writeFileSync(copy + '.gz', gzipSync(Buffer.from(JSON.stringify(value))))
    expect(() => readBenchmarkDocument(copy)).toThrow('canonical output differs')
  })

})
