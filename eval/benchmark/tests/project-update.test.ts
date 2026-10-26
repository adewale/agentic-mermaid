import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { communityCoreWorkloads, selectCommunityProjects } from '../unified/community.ts'
import { runCommunityCliCohort } from '../unified/community-cli.ts'
import { findProjectRecord, loadCurrentProjectRecords, type ProjectBenchmarkIdentity, type ProjectBenchmarkRecord } from '../portable/project-records.ts'
import { renderProjectRecords, runRetainedCommunityCliSuite, updateProjectMarkdown, updateProjectRecords } from '../unified/project-update.ts'
import type { CommunityNode } from '../unified/community-types.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'community-updates-'))
  directories.push(directory)
  const store = join(directory, 'store'),
    measurements: string[] = []
  const identity = (project: string, version = 1): ProjectBenchmarkIdentity => ({ project, artifact: { version }, protocol: { context: 'same-protocol.json', adapter: project }, measurement: { rounds: 1 } })
  const request = (project: string, version = 1) => ({
    identity: identity(project, version),
    measure: async (): Promise<ProjectBenchmarkRecord> => {
      measurements.push(project)
      const evidenceDirectory = join(directory, project.replaceAll('/', '-'), String(version))
      mkdirSync(evidenceDirectory, { recursive: true })
      writeFileSync(join(evidenceDirectory, 'result.json'), '{"status":"passed"}')
      return {
        schemaVersion: 1,
        id: `${project}-${version}`,
        identity: identity(project, version),
        startedAt: '2026-10-25T00:00:00Z',
        finishedAt: '2026-10-25T00:01:00Z',
        status: 'passed',
        evidenceDirectory,
        evidenceFiles: ['result.json'],
        observations: [{ suite: 'community', surface: 'node:public-api', runtime: 'Node', family: 'flowchart', caseId: 'not-a-core-case', operation: 'render', format: 'svg', mode: 'feature-corpus-qualification', status: 'passed', metrics: { implementation: project } }],
        gaps: [],
      }
    },
  })
  return { directory, store, identity, request, measurements }
}
test('unchanged projects never reach the measurement callback; updating one preserves its peer', async () => {
  const f = fixture()
  await updateProjectRecords(f.store, [f.request('owner/first'), f.request('owner/peer')])
  const peer = findProjectRecord(f.store, f.identity('owner/peer'))
  const unchanged = await updateProjectRecords(f.store, [f.request('owner/first'), f.request('owner/peer')])
  expect(unchanged.map(update => update.action)).toEqual(['reused', 'reused'])
  expect(f.measurements).toEqual(['owner/first', 'owner/peer'])
  await updateProjectRecords(f.store, [f.request('owner/first', 2)])
  expect(f.measurements).toEqual(['owner/first', 'owner/peer', 'owner/first'])
  expect(findProjectRecord(f.store, f.identity('owner/peer'))).toEqual(peer)
  expect(loadCurrentProjectRecords(f.store).map(record => record.id)).toEqual(['owner/first-2', 'owner/peer-1'])
  await updateProjectRecords(f.store, [f.request('owner/first')])
  expect(loadCurrentProjectRecords(f.store)[0]!.id).toBe('owner/first-1')
  expect(f.measurements).toHaveLength(3)
})
test('refuses duplicate project jobs and measurement results for another identity', async () => {
  const f = fixture(),
    request = f.request('owner/first')
  await expect(updateProjectRecords(f.store, [request, request])).rejects.toThrow('Duplicate project')
  expect(f.measurements).toHaveLength(0)
  await expect(updateProjectRecords(f.store, [{ ...request, measure: f.request('owner/other').measure }])).rejects.toThrow('different project/protocol')
  expect(loadCurrentProjectRecords(f.store)).toEqual([])
})
test('project selection rejects unknown and repeated IDs before preparation', () => {
  const nodes = ['owner/first', 'owner/peer'].map(id => ({ id, outputs: ['svg'], roles: [] }))
  expect(selectCommunityProjects(nodes, ['owner/first'])).toEqual([nodes[0]!])
  expect(() => selectCommunityProjects(nodes, ['missing'])).toThrow('unique known')
  expect(() => selectCommunityProjects(nodes, ['owner/first', 'owner/first'])).toThrow('unique known')
})
test('Markdown retains historical prose and measurement dates and updates just its marked section', async () => {
  const f = fixture()
  await updateProjectRecords(f.store, [f.request('owner/first')])
  const path = join(f.directory, 'rankings.md'),
    population = [{ id: 'owner/first', roles: [], outputs: ['svg'] }]
  writeFileSync(path, '# Historical snapshot\n\nDo not rewrite this dated table.\n')
  updateProjectMarkdown(path, loadCurrentProjectRecords(f.store), population)
  const first = readFileSync(path, 'utf8')
  expect(first).toStartWith('# Historical snapshot\n\nDo not rewrite this dated table.')
  expect(first).toContain('2026-10-25T00:01:00Z')
  updateProjectMarkdown(path, loadCurrentProjectRecords(f.store), population)
  expect(readFileSync(path, 'utf8')).toBe(first)
  writeFileSync(path, '<!-- community-project-records:end -->\n<!-- community-project-records:start -->')
  expect(() => updateProjectMarkdown(path, loadCurrentProjectRecords(f.store), population)).toThrow('end precedes')
})
test('different project adapters share a comparison cohort, while differing protocols remain separate', async () => {
  const f = fixture()
  await updateProjectRecords(f.store, [f.request('owner/first'), f.request('owner/peer')])
  const records = loadCurrentProjectRecords(f.store)
  const population: CommunityNode[] = records.map(record => ({ id: record.identity.project, roles: [], outputs: ['svg'] }))
  const same = renderProjectRecords(records, population)
  expect(same.match(/### Comparable cohort/g)).toHaveLength(1)
  records[1] = { ...records[1]!, identity: { ...records[1]!.identity, protocol: { context: 'changed.json' } } }
  expect(renderProjectRecords(records, population).match(/### Comparable cohort/g)).toHaveLength(2)
})
test('retained CLI results must belong to this controller invocation', async () => {
  const f = fixture(),
    out = join(f.directory, 'community-cli'),
    source = join(f.directory, 'community')
  mkdirSync(source)
  writeFileSync(join(source, 'retained-cli-suite.json'), JSON.stringify({ id: 'community-cli', status: 'passed', startedAt: 'old', finishedAt: 'old', observations: [], gaps: [] }))
  writeFileSync(join(source, 'project-update-manifest.json'), JSON.stringify({ invocationId: 'previous-controller' }))
  const options = { out, root: f.directory, profile: 'smoke' as const, rounds: 1, communityInvocationId: 'new-controller' }
  expect((await runRetainedCommunityCliSuite(options)).status).toBe('blocked')
  expect((await runRetainedCommunityCliSuite({ ...options, communityInvocationId: undefined })).status).toBe('blocked')
  expect((await runRetainedCommunityCliSuite({ ...options, communityInvocationId: 'previous-controller' })).status).toBe('passed')
})
test('forced measurements retain new attempts without changing previous observations', async () => {
  const f = fixture(),
    request = f.request('owner/first')
  await updateProjectRecords(f.store, [request])
  const before = findProjectRecord(f.store, request.identity)!
  const fresh = await request.measure()
  fresh.id = 'forced-attempt'
  fresh.evidenceDirectory = join(f.directory, 'forced-evidence')
  mkdirSync(fresh.evidenceDirectory)
  writeFileSync(join(fresh.evidenceDirectory, 'result.json'), '{"status":"passed"}')
  const updates = await updateProjectRecords(f.store, [{ identity: request.identity, measure: async () => fresh }], true)
  expect(updates[0]!.action).toBe('measured')
  expect(loadCurrentProjectRecords(f.store)[0]!.id).toBe('forced-attempt')
  expect(before.id).toBe('owner/first-1')
  expect(before.observations).toEqual(fresh.observations)
})
test('an API-only project has no CLI resource prerequisite or latency measurement', async () => {
  const f = fixture(),
    run = join(f.directory, 'prepared')
  mkdirSync(run)
  writeFileSync(join(run, 'community-prepared.json'), JSON.stringify([{ node: { id: 'owner/api', roles: [], outputs: ['svg'], benchmark: { adapter: 'published-extra', outputs: ['svg'] } }, artifact: { kind: 'node', version: '1.0' } }]))
  writeFileSync(join(run, 'community-inputs.json'), JSON.stringify({ workloads: communityCoreWorkloads() }))
  const result = await runCommunityCliCohort({ run, out: join(f.directory, 'cli'), target: process.cwd(), packageRoot: process.cwd(), rounds: 1, observerExecutable: join(f.directory, 'missing-observer') })
  expect(result.status).toBe('passed')
  expect(result.latencyMeasured).toBe(false)
  expect(result.observations).toEqual([])
  expect(result.diagnostics.map(row => row.status)).toEqual(['not-applicable'])
  expect(result.ranks).toEqual([])
})
