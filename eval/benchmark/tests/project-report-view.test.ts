import { readBenchmarkDocument } from '../portable/project-records.ts'
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectReportView } from '../unified/project-report-view.ts'
import { coverageRows, type UnifiedReport, writeUnifiedReport } from '../unified/report.ts'
import type { UnifiedSuiteResult } from '../unified/types.ts'

const fixture = (): UnifiedSuiteResult => ({
  id: 'entry-startup',
  status: 'passed',
  startedAt: '2026-10-25T00:00:00.000Z',
  finishedAt: '2026-10-25T00:00:01.000Z',
  gaps: [],
  observations: [
    { suite: 'entry-startup', surface: 'library', runtime: 'Node', family: 'flowchart', caseId: 'first-result', operation: 'render', format: 'svg', mode: 'fresh-process', status: 'passed', samplesMs: [3], metrics: { implementation: 'agentic', project: 'stale/project', returnRssBytes: 100 } },
    { suite: 'entry-startup', surface: 'browser', runtime: 'Chromium', family: '*', caseId: 'delivery', operation: 'delivery', format: 'report', mode: 'observed-requests', status: 'passed' },
  ],
})

test('two retained project views keep their canonical owner without mutating cached raw evidence', () => {
  const raw = fixture()
  const before = JSON.stringify(raw)
  for (const row of raw.observations) {
    if (row.metrics) Object.freeze(row.metrics)
    Object.freeze(row)
  }
  Object.freeze(raw.observations)
  Object.freeze(raw)
  const agentic = projectReportView(raw, 'adewale/agentic-mermaid')
  const pele = projectReportView(raw, 'obsidianmd/pele')
  expect(JSON.stringify(raw)).toBe(before)
  expect(agentic).not.toBe(raw)
  expect(pele.observations).not.toBe(raw.observations)
  for (const [view, owner] of [
    [agentic, 'adewale/agentic-mermaid'],
    [pele, 'obsidianmd/pele'],
  ] as const) {
    expect(view.observations.every(row => row.metrics?.implementation === owner && row.metrics?.project === owner)).toBe(true)
    expect(view.observations[0]!.samplesMs).toEqual([3])
    expect(view.observations[0]!.metrics?.returnRssBytes).toBe(100)
    expect(view.startedAt).toBe(raw.startedAt)
    expect(view.finishedAt).toBe(raw.finishedAt)
  }
  const groups = coverageRows([...agentic.observations, ...pele.observations])
  expect(groups).toHaveLength(4)
  expect(new Set(groups.map(row => row.implementation))).toEqual(new Set(['adewale/agentic-mermaid', 'obsidianmd/pele']))
  expect(groups.every(row => row.cases === 1 && row.statuses.passed === 1)).toBe(true)
})

test('legacy project metadata is attributed consistently in coverage and exported CSV', () => {
  const raw = fixture()
  raw.observations = [{ ...raw.observations[0]!, metrics: { project: 'obsidianmd/pele' } }]
  raw.toolVersions = [{ tool: 'obsidianmd/pele', version: '1.9.0', source: 'owning artifact fixture' }]
  expect(coverageRows([fixture().observations[1]!])[0]!.implementation).toBe('unattributed')
  expect(coverageRows(raw.observations)[0]!.implementation).toBe('obsidianmd/pele')
  const out = mkdtempSync(join(tmpdir(), 'project-report-view-'))
  try {
    const report: UnifiedReport = {
      schemaVersion: 1,
      startedAt: raw.startedAt,
      finishedAt: raw.finishedAt,
      profile: 'full',
      rounds: 3,
      driverRoot: '/driver',
      targetRoot: '/target',
      driverDirty: false,
      targetDirty: false,
      status: 'passed',
      policy: 'Authored report consumer control',
      suites: [{ id: raw.id, title: raw.id, source: 'fixture', policy: 'local-only', target: 'candidate', status: 'passed', selected: true, prerequisites: [], result: raw }],
    }
    writeUnifiedReport(out, report)
    expect(existsSync(join(out, 'observations.csv'))).toBe(false)
    expect(existsSync(join(out, 'coverage.json'))).toBe(false)
    expect(readBenchmarkDocument(join(out, 'report.json')).suites[0].result.observations[0].metrics.project).toBe('obsidianmd/pele')
    report.exports = { tables: true }
    writeUnifiedReport(out, report)
    expect(readFileSync(join(out, 'coverage.csv'), 'utf8')).toContain('"entry-startup","obsidianmd/pele"')
    expect(readFileSync(join(out, 'observations.csv'), 'utf8')).toContain('"entry-startup","obsidianmd/pele"')
    expect(readFileSync(join(out, 'observations.csv'), 'utf8')).not.toContain('"agentic-mermaid"')
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
