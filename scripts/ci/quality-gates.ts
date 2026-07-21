#!/usr/bin/env bun

export interface QualityCheck {
  id: string
  label: string
  command: string[]
}

export const EVIDENCE_CHECKS: readonly QualityCheck[] = [
  {
    id: 'linkrank-feedback-packing',
    label: 'Issue #87 link-rank visual evidence',
    command: ['bun', 'run', 'gallery:linkrank-feedback-packing:check'],
  },
  {
    id: 'mermaid-docs',
    label: 'Mermaid documentation showcase receipt',
    command: ['bun', 'run', 'gallery:mermaid-docs:check'],
  },
  {
    id: 'mindmap-gitgraph',
    label: 'Mindmap/GitGraph gallery receipt',
    command: ['bun', 'run', 'gallery:mindmap-gitgraph:check'],
  },
  {
    id: 'palette-harmony',
    label: 'Optional palette harmony evidence',
    command: ['bun', 'run', 'gallery:palette-harmony:check'],
  },
  {
    id: 'palette-performance',
    label: 'Palette performance provenance',
    command: ['bun', 'run', 'benchmark:palette:check'],
  },
  {
    id: 'palette-rollout',
    label: 'Controlled palette rollout evidence',
    command: ['bun', 'run', 'gallery:palette-rollout:check'],
  },
  {
    id: 'pie-highlight',
    label: 'Pie highlightSlice evidence',
    command: ['bun', 'run', 'gallery:pie-highlight:check'],
  },
  {
    id: 'section-b',
    label: 'Section B visual evidence',
    command: ['bun', 'run', 'gallery:section-b:check'],
  },
]

export const QUALITY_CHECKS: readonly QualityCheck[] = [
  { id: 'install', label: 'Install locked dependencies', command: ['bun', 'install', '--frozen-lockfile'] },
  { id: 'dependency-audit', label: 'Reject high or critical dependency advisories', command: ['bun', 'run', 'audit:dependencies'] },
  { id: 'font-subsets', label: 'Regenerate and byte-verify canonical Inter subsets', command: ['bun', 'run', 'scripts/site/subset-website-inter-fonts.ts', '--check'] },
  { id: 'website', label: 'Verify website and Worker artifacts', command: ['bun', 'run', 'website:check'] },
  { id: 'evidence', label: 'Check all generated evidence receipts and provenance', command: ['bun', 'run', 'evidence:check'] },
  { id: 'sketch', label: 'Run sketch prototype style checks', command: ['bun', 'run', 'sketch:check'] },
  { id: 'rendered-corpora', label: 'Audit rendered corpora and family structural evidence', command: ['bun', 'run', 'audit:ugly'] },
  { id: 'lint', label: 'Lint TypeScript and repository contracts', command: ['bun', 'run', 'lint'] },
  { id: 'typecheck', label: 'Type check', command: ['bun', 'run', 'typecheck'] },
  { id: 'hero', label: 'Check README hero image freshness', command: ['bun', 'run', 'hero:check'] },
  { id: 'golden-drift', label: 'Enforce reviewed golden snapshot drift', command: ['bun', 'run', 'scripts/ci/golden-drift.ts'] },
]

export type CheckRunner = (check: QualityCheck) => number

export function collectFailedChecks(checks: readonly QualityCheck[], run: CheckRunner): QualityCheck[] {
  const failures: QualityCheck[] = []
  for (const check of checks) if (run(check) !== 0) failures.push(check)
  return failures
}

function runCheck(check: QualityCheck): number {
  const grouped = process.env.GITHUB_ACTIONS === 'true'
  process.stdout.write(`${grouped ? `::group::${check.label}` : `\n==> ${check.label}`}\n`)
  const result = Bun.spawnSync(check.command, {
    cwd: process.cwd(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (grouped) process.stdout.write('::endgroup::\n')
  return result.exitCode
}

function reportFailures(suite: string, failures: readonly QualityCheck[]): never {
  const summary = failures.map(check => `${check.id} (${check.command.join(' ')})`).join(', ')
  if (process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::error title=${suite} failures::${summary}\n`)
  }
  process.stderr.write(`\n${suite} failed in ${failures.length} check${failures.length === 1 ? '' : 's'}:\n`)
  for (const check of failures) process.stderr.write(`- ${check.label}: ${check.command.join(' ')}\n`)
  process.exit(1)
}

if (import.meta.main) {
  const evidenceOnly = process.argv.includes('--evidence-only')
  const suite = evidenceOnly ? 'Evidence freshness audit' : 'Quality suite'
  const failures = collectFailedChecks(evidenceOnly ? EVIDENCE_CHECKS : QUALITY_CHECKS, runCheck)
  if (failures.length > 0) reportFailures(suite, failures)
  process.stdout.write(`\n${suite} passed (${(evidenceOnly ? EVIDENCE_CHECKS : QUALITY_CHECKS).length} checks).\n`)
}
