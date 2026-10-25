import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertBenchmarkSetVersions, assertBenchmarkToolVersion } from '../tool-versions.ts'
import { writeUnifiedReport, type UnifiedReport } from '../unified/report.ts'
import { runRetainedUpstreamTestSuite } from '../unified/retained-campaigns.ts'

test('a benchmark set admits the same tool release across runtimes and rejects a different release', () => {
  expect(assertBenchmarkSetVersions([
    { tool: 'pele', version: '1.9.0', source: 'Dave' },
    { tool: 'obsidianmd/pele', version: '1.9.0', source: 'Node startup' },
    { tool: 'obsidianmd/pele', version: '1.9.0', source: 'Bun startup' },
  ])).toHaveLength(1)
  expect(() => assertBenchmarkToolVersion('pele', '1.6.0', 'Dave')).toThrow('requires obsidianmd/pele 1.9.0')
  expect(() => assertBenchmarkSetVersions([
    { tool: 'example/renderer', version: '2.0.0', source: 'library' },
    { tool: 'example/renderer', version: '2.1.0', source: 'browser' },
  ])).toThrow('Mixed tool versions')
  expect(() => assertBenchmarkSetVersions([{ tool: 'example/renderer', version: '', source: 'CLI' }])).toThrow('Missing artifact version')
  for (const [name, project] of [['bezel', 'crabtalk/bezel'], ['beautiful-mermaid', 'lukilabs/beautiful-mermaid']]) expect(() => assertBenchmarkSetVersions([
    { tool: name!, version: '1.0.0', source: 'peer' },
    { tool: project!, version: '1.1.0', source: 'community' },
  ])).toThrow('Mixed tool versions')
})

test('mixed actual tool releases cannot replace an existing unified report', () => {
  const out = mkdtempSync(join(tmpdir(), 'tool-version-report-'))
  const existing = '{"previous":"reviewed"}\n'
  writeFileSync(join(out, 'report.json'), existing)
  const report: UnifiedReport = {
    schemaVersion: 1, startedAt: '2026-10-25T00:00:00Z', profile: 'smoke', rounds: 1,
    driverRoot: '/driver', targetRoot: '/candidate', driverDirty: false, targetDirty: false, status: 'passed', policy: 'fixture',
    suites: ['2.0.0', '2.1.0'].map((version, index) => ({
      id: `suite-${index}`, title: 'fixture', source: 'fixture', policy: 'fixture', target: 'driver', status: 'passed', selected: true, prerequisites: [],
      result: { id: `suite-${index}`, startedAt: '2026-10-25T00:00:00Z', finishedAt: '2026-10-25T00:00:01Z', status: 'passed', gaps: [], observations: [{
        suite: `suite-${index}`, surface: 'public-api', runtime: 'node', family: 'flowchart', caseId: 'authored', operation: 'render', format: 'svg', mode: 'first-result', status: 'passed', metrics: { implementation: 'example/renderer', version },
      }] },
    })),
  }
  try {
    expect(() => writeUnifiedReport(out, report)).toThrow('Mixed tool versions')
    expect(readFileSync(join(out, 'report.json'), 'utf8')).toBe(existing)
    report.suites = [report.suites[0]!]
    delete report.suites[0]!.result!.observations[0]!.metrics!.version
    expect(() => writeUnifiedReport(out, report)).toThrow('Missing artifact version')
    expect(readFileSync(join(out, 'report.json'), 'utf8')).toBe(existing)
    const evidence = join(out, 'family-proof')
    mkdirSync(evidence)
    const support = join(evidence, 'required-family-support.json')
    writeFileSync(support, JSON.stringify({ project: 'example/renderer' }))
    writeFileSync(join(evidence, 'identity.json'), JSON.stringify({ project: 'example/renderer', lane: 'required-family-admission', artifact: { artifact: { version: '2.0.0' }, packageMetadata: { name: 'renderer', version: '2.0.0' } } }))
    report.suites[0]!.result!.artifacts = [support]
    expect(() => writeUnifiedReport(out, report)).not.toThrow()
    const admitted = readFileSync(join(out, 'report.json'), 'utf8')
    writeFileSync(join(evidence, 'identity.json'), JSON.stringify({ project: 'someone/else', lane: 'required-family-admission', artifact: { artifact: { version: '2.0.0' } } }))
    expect(() => writeUnifiedReport(out, report)).toThrow('owning project/lane')
    expect(readFileSync(join(out, 'report.json'), 'utf8')).toBe(admitted)
  } finally { rmSync(out, { recursive: true, force: true }) }
})

test('explicit candidate and baseline variants keep their own identities without weakening peer pins', () => {
  expect(assertBenchmarkSetVersions([
    { tool: 'adewale/agentic-mermaid', version: '0.4.1', source: 'baseline', variant: 'baseline' },
    { tool: 'adewale/agentic-mermaid', version: '0.4.2', source: 'candidate', variant: 'candidate' },
  ])).toHaveLength(2)
  expect(() => assertBenchmarkSetVersions([{ tool: 'pele', version: '1.6.0', source: 'browser', variant: 'renamed' }])).toThrow('requires obsidianmd/pele 1.9.0')
  expect(() => assertBenchmarkSetVersions([
    { tool: 'agentic-mermaid', version: '0.4.2', source: 'startup' },
    { tool: 'adewale/agentic-mermaid', version: '0.4.3', source: 'Dave', variant: 'candidate' },
  ])).toThrow('Mixed tool versions')
  expect(() => assertBenchmarkSetVersions([
    { tool: 'agentic', version: '0.4.2', source: 'startup' },
    { tool: 'adewale/agentic-mermaid', version: '0.4.3', source: 'docs' },
  ])).toThrow('Mixed tool versions')
})

test('an inherited Pele root cannot execute a different release under the selected artifact identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tool-version-roots-'))
  const previous = process.env.PELE_BENCHMARK_ROOT
  const selected = join(root, 'selected')
  const inherited = join(root, 'inherited')
  mkdirSync(selected); mkdirSync(inherited)
  writeFileSync(join(selected, 'package.json'), JSON.stringify({ name: 'pele', version: '1.9.0' }))
  writeFileSync(join(inherited, 'package.json'), JSON.stringify({ name: 'pele', version: '1.6.0' }))
  process.env.PELE_BENCHMARK_ROOT = inherited
  try {
    await expect(runRetainedUpstreamTestSuite({ root: process.cwd(), harnessRoot: process.cwd(), out: join(root, 'out'), benchmarkRecordStore: join(root, 'records'), rounds: 1, profile: 'smoke', portableArtifactRoot: selected, communityProjects: ['obsidianmd/pele'] })).rejects.toThrow('PELE_BENCHMARK_ROOT conflicts')
    expect(existsSync(join(root, 'records'))).toBe(false)
  } finally {
    if (previous === undefined) delete process.env.PELE_BENCHMARK_ROOT
    else process.env.PELE_BENCHMARK_ROOT = previous
    rmSync(root, { recursive: true, force: true })
  }
})
