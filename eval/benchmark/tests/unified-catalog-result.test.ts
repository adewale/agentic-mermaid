import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBenchmarkDocument } from 'trident/portable/project-records.ts'
import { writeUnifiedReport, type UnifiedReport } from 'trident/unified/report.ts'
import type { UnifiedSuiteResult } from 'trident/unified/types.ts'
import { catalogReleaseView } from '../unified/catalog-result.ts'

const result = (id: string, version: string): UnifiedSuiteResult => ({
  id, status: 'passed', startedAt: '2026-10-27T00:00:00Z', finishedAt: '2026-10-27T00:00:01Z', gaps: [],
  toolVersions: [{ tool: 'example/renderer', version, source: 'actual fixture package metadata' }],
  observations: [{ suite: id, surface: 'browser', runtime: 'Chromium', family: 'flowchart', caseId: 'authored', operation: 'render', format: 'svg', mode: 'public-call', status: 'passed', metrics: { implementation: 'example/renderer', round: 1 }, samplesMs: [1] }],
})
const report = (...results: UnifiedSuiteResult[]): UnifiedReport => ({
  schemaVersion: 1, startedAt: '2026-10-27T00:00:00Z', profile: 'full', rounds: 5,
  driverRoot: '/product', targetRoot: '/candidate', driverDirty: false, targetDirty: false, status: 'passed',
  policy: 'Separate explicit source candidate and independently acquired catalog releases.', exports: { tables: true },
  suites: results.map(value => ({ id: value.id, title: value.id, source: 'fixture', policy: 'actual package identity', target: 'candidate' as const, status: value.status, selected: true, prerequisites: [], result: value })),
})

test('product ledger retains candidate and catalog release identities without mutating raw records', () => {
  const out = mkdtempSync(join(tmpdir(), 'product-catalog-view-'))
  try {
    const candidate = result('source-operation', '2.0.0'), release = result('public-operation', '1.0.0')
    const before = JSON.stringify(release)
    Object.freeze(release.toolVersions![0]); Object.freeze(release.toolVersions)
    Object.freeze(release.observations[0]!.metrics); Object.freeze(release.observations[0]); Object.freeze(release.observations); Object.freeze(release)
    expect(() => writeUnifiedReport(out, report(candidate, release))).toThrow('Mixed tool versions')
    const view = catalogReleaseView(release)
    writeUnifiedReport(out, report(candidate, view))
    const saved = readBenchmarkDocument(join(out, 'report.json'))
    expect(saved.suites[0].result.toolVersions[0]).toMatchObject({ tool: 'example/renderer', version: '2.0.0' })
    expect(saved.suites[1].result.toolVersions[0]).toMatchObject({ tool: 'example/renderer', version: '1.0.0', variant: 'catalog-release' })
    expect(saved.suites[1].result.observations[0].metrics.variant).toBe('catalog-release')
    expect(readFileSync(join(out, 'observations.csv'), 'utf8')).toContain('catalog-release')
    expect(JSON.stringify(release)).toBe(before)
    // Conflicts within the same catalog comparison must still fail.
    expect(() => writeUnifiedReport(out, report(view, catalogReleaseView(result('conflicting-release', '3.0.0'))))).toThrow('Mixed tool versions')
  } finally { rmSync(out, { recursive: true, force: true }) }
})

test('catalog view preserves every project binding, explicit variant and unsupported row', () => {
  const raw = result('catalog', '1.0.0')
  raw.toolVersions!.push({ tool: 'example/other', version: '4.0.0', source: 'actual other artifact', variant: 'cli' })
  raw.observations.push({ ...raw.observations[0]!, caseId: 'other', status: 'unsupported', metrics: { project: 'example/other', variant: 'cli', runtimeExecuted: false } })
  const view = catalogReleaseView(raw)
  expect(view.toolVersions![1]).toMatchObject({ tool: 'example/other', version: '4.0.0', variant: 'catalog-release:cli' })
  expect(view.observations[1]).toMatchObject({ status: 'unsupported', metrics: { project: 'example/other', variant: 'catalog-release:cli', runtimeExecuted: false } })
  expect(view.observations[0]!.samplesMs).toEqual([1])
  expect(raw.observations[1]!.metrics!.variant).toBe('cli')
  const defaults = result('default-catalog', '1.0.0')
  defaults.toolVersions![0]!.variant = 'candidate'
  defaults.observations[0]!.metrics!.variant = 'default'
  const defaultView = catalogReleaseView(defaults)
  expect(defaultView.toolVersions![0]!.variant).toBe('catalog-release')
  expect(defaultView.observations[0]!.metrics!.variant).toBe('catalog-release')
})


test('full product controller retains real child outputs for candidate and catalog in one ledger', async () => {
  const { parseOptions, runUnified } = await import('../unified/run.ts')
  const root = mkdtempSync(join(tmpdir(), 'product-catalog-controller-'))
  try {
    for (const path of ['src/__tests__', 'docs/project', 'eval/mermaid-upstream-suite-bench', 'eval/agent-usage', 'eval/benchmark/unified']) mkdirSync(join(root, path), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {} }))
    writeFileSync(join(root, 'docs/project/upstream-mermaid-policy.json'), JSON.stringify({ pin: { version: 'fixture', commit: 'fixture' } }))
    writeFileSync(join(root, 'eval/mermaid-upstream-suite-bench/manifest.json'), JSON.stringify({ upstream: { revision: 'fixture' } }))
    const candidate = result('family', '2.0.0'), release = result('community', '1.0.0')
    writeFileSync(join(root, 'eval/benchmark/unified/run.ts'), `import {readFileSync,writeFileSync} from 'node:fs';const args=process.argv;const id=args[args.indexOf('--worker-suite')+1];const job=JSON.parse(readFileSync(args[args.indexOf('--worker-job')+1],'utf8'));const value=id==='family'?${JSON.stringify(candidate)}:${JSON.stringify(release)};writeFileSync(job.resultPath,JSON.stringify(value));`)
    const options = parseOptions(['--profile', 'full', '--rounds', '5', '--suites', 'family,community', '--out', join(root, 'out')])
    const ledger = await runUnified({ ...options, root, harnessRoot: root })
    expect(ledger.status).toBe('passed')
    const source = ledger.suites.find(suite => suite.id === 'family')!.result!
    const catalog = ledger.suites.find(suite => suite.id === 'community')!.result!
    expect(source.toolVersions![0]).toMatchObject({ version: '2.0.0' })
    expect(catalog.toolVersions![0]).toMatchObject({ version: '1.0.0', variant: 'catalog-release' })
    expect(catalog.observations[0]!.metrics!.variant).toBe('catalog-release')
    const owning = readBenchmarkDocument(join(options.out, 'community/result.json'))
    expect(owning.toolVersions[0].version).toBe('1.0.0')
    expect(owning.toolVersions[0].variant).toBeUndefined()
    expect(owning.observations[0].metrics.variant).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
