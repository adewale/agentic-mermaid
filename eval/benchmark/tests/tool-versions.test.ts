import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertBenchmarkSetVersions, assertBenchmarkToolVersion } from '../tool-versions.ts'
import { writeUnifiedReport, type UnifiedReport } from '../unified/report.ts'

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
})
