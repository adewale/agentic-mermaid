import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BenchmarkObservation, BenchmarkStatus, UnifiedSuiteResult } from './types.ts'
import { assertBenchmarkSetVersions } from '../tool-versions.ts'

export interface SuiteExecution {
  id: string
  title: string
  source: string
  policy: string
  target: 'driver' | 'candidate'
  status: BenchmarkStatus
  selected: boolean
  elapsedMs?: number
  exitCode?: number | null
  signal?: string | null
  timedOut?: boolean
  command?: string[]
  workingDirectory?: string
  environment?: Record<string, string>
  log?: string
  prerequisites: string[]
  pin?: unknown
  result?: UnifiedSuiteResult
}
export interface UnifiedReport {
  schemaVersion: 1
  startedAt: string
  finishedAt?: string
  profile: string
  rounds: number
  driverRoot: string
  targetRoot: string
  packageRoot?: string
  driverRevision?: string
  targetRevision?: string
  driverDirty: boolean | null
  targetDirty: boolean | null
  machine?: Record<string, string | number | null>
  status: 'running' | 'passed' | 'failed' | 'incomplete'
  policy: string
  suites: SuiteExecution[]
}
const escape = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
const number = (value: number | undefined): string => (value === undefined ? '—' : value.toFixed(1))

const implementationOf = (row: BenchmarkObservation): string => (typeof row.metrics?.implementation === 'string' && row.metrics.implementation.trim() ? row.metrics.implementation : typeof row.metrics?.project === 'string' && row.metrics.project.trim() ? row.metrics.project : 'agentic-mermaid')

/** Rows are enrollment/execution evidence, not a guessed feature percentage. */
export function coverageRows(observations: readonly BenchmarkObservation[]) {
  const groups = new Map<string, { suite: string; implementation: string; surface: string; runtime: string; family: string; operation: string; format: string; mode: string; statuses: Partial<Record<BenchmarkStatus, number>>; cases: Set<string> }>()
  for (const row of observations) {
    const implementation = implementationOf(row)
    const key = JSON.stringify([row.suite, implementation, row.surface, row.runtime, row.family, row.operation, row.format, row.mode])
    const group = groups.get(key) ?? { suite: row.suite, implementation, surface: row.surface, runtime: row.runtime, family: row.family, operation: row.operation, format: row.format, mode: row.mode, statuses: {}, cases: new Set<string>() }
    group.statuses[row.status] = (group.statuses[row.status] ?? 0) + 1
    group.cases.add(row.caseId)
    groups.set(key, group)
  }
  return [...groups.values()].map(row => ({ ...row, cases: row.cases.size }))
}
export function writeUnifiedReport(out: string, report: UnifiedReport): void {
  const observations = report.suites.flatMap(suite => suite.result?.observations ?? [])
  assertBenchmarkSetVersions([
    ...report.suites.flatMap(suite => suite.selected ? suite.result?.toolVersions ?? [] : []),
    ...observations.flatMap(row => typeof row.metrics?.implementation === 'string' && typeof row.metrics.version === 'string' ? [{
      tool: typeof row.metrics.variantOf === 'string' ? row.metrics.variantOf : row.metrics.implementation,
      version: row.metrics.version, source: `${row.suite}/${row.surface}`,
      ...(typeof row.metrics.variant === 'string' ? { variant: row.metrics.variant } : {}),
    }] : []),
  ])
  const coverage = coverageRows(observations)
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(out, 'coverage.json'), JSON.stringify({ scope: 'Executed observations only; a missing cell is unmeasured, never an inferred pass.', rows: coverage }, null, 2) + '\n')
  const csv = (values: unknown[]) => values.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')
  const coverageCsv = [
    ['suite', 'implementation', 'surface', 'runtime', 'family', 'operation', 'format', 'mode', 'cases', 'passed', 'failed', 'unsupported', 'blocked', 'not_applicable', 'skipped'],
    ...coverage.map(row => [row.suite, row.implementation, row.surface, row.runtime, row.family, row.operation, row.format, row.mode, row.cases, row.statuses.passed ?? 0, row.statuses.failed ?? 0, row.statuses.unsupported ?? 0, row.statuses.blocked ?? 0, row.statuses['not-applicable'] ?? 0, row.statuses.skipped ?? 0]),
  ]
  writeFileSync(join(out, 'coverage.csv'), coverageCsv.map(csv).join('\n') + '\n')
  const observationCsv = [
    ['suite', 'implementation', 'surface', 'runtime', 'family', 'case_id', 'operation', 'format', 'mode', 'status', 'samples_ms', 'bytes', 'metrics', 'findings', 'detail'],
    ...observations.map(row => [row.suite, implementationOf(row), row.surface, row.runtime, row.family, row.caseId, row.operation, row.format, row.mode, row.status, JSON.stringify(row.samplesMs ?? []), row.bytes, JSON.stringify(row.metrics ?? {}), JSON.stringify(row.findings ?? []), row.detail]),
  ]
  writeFileSync(join(out, 'observations.csv'), observationCsv.map(csv).join('\n') + '\n')
  const lines = [
    '# Unified Agentic Mermaid benchmark',
    '',
    `Status: **${report.status}**. Profile: **${report.profile}**; rounds requested: ${report.rounds}.`,
    '',
    `Driver: \`${report.driverRevision ?? 'unavailable'}\` (${report.driverDirty ? 'uncommitted changes present' : 'clean or unavailable'}). Target: \`${report.targetRevision ?? 'unavailable'}\`.`,
    '',
    report.policy,
    '',
    '| Suite | Target | Status | Wall ms | Tests pass/fail/skip | Evidence / reason |',
    '|---|---|---|---:|---|---|',
  ]
  for (const suite of report.suites) {
    const score = suite.result?.observations.find(row => row.operation === 'owning-tests')?.metrics
    const tests = score ? `${score.passed ?? '—'} / ${score.failed ?? '—'} / ${score.skipped ?? '—'}` : '—'
    const details = [...suite.prerequisites, ...(suite.result?.gaps ?? [])].join('; ')
    lines.push(`| ${escape(suite.id)} | ${suite.target} | ${suite.status} | ${number(suite.elapsedMs)} | ${tests} | ${suite.log ? `[log](${escape(suite.log)})` : ''} ${escape(details)} |`)
  }
  const gaps = report.suites.flatMap(suite => [...suite.prerequisites, ...(suite.result?.gaps ?? [])].map(detail => ({ suite: suite.id, detail })))
  lines.push('', '## Remaining scope and blocked work', '', ...gaps.map(gap => `- **${gap.suite}:** ${gap.detail}`))
  if (!gaps.length) lines.push('No runner-reported gaps. This is not a proof of exhaustive language functionality; inspect each suite’s declared feature and oracle scope.')
  lines.push('', '## Executed coverage', '', '| Suite | Implementation | Surface | Family | Operation | Format | Mode | Cases | Passed | Failed | Unsupported | Blocked | N/A |', '|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|')
  for (const row of coverage)
    lines.push(
      `| ${escape(row.suite)} | ${escape(row.implementation)} | ${escape(row.surface)} | ${escape(row.family)} | ${escape(row.operation)} | ${escape(row.format)} | ${escape(row.mode)} | ${row.cases} | ${row.statuses.passed ?? 0} | ${row.statuses.failed ?? 0} | ${row.statuses.unsupported ?? 0} | ${row.statuses.blocked ?? 0} | ${row.statuses['not-applicable'] ?? 0} |`,
    )
  lines.push(
    '',
    'Test totals are read from fresh owning-test logs. Test process wall time includes setup, instrumentation and reference IPC; it is not a pure-parser cross-engine speed ratio. Dedicated paired reference and Dave results keep their own clocks, pinned artifacts and case denominators.',
    '',
    'Instrumentation, V8 allocation, RSS, fully consumed receipt cost, browser delivery/paint, CLI process latency and provider usage are separate measurements. Unsupported/blocked/skipped results never become zero-time wins. Cohorts and protocols must match before ranking.',
    '',
  )
  writeFileSync(join(out, 'report.md'), lines.join('\n'))
}
