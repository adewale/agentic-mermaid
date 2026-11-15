#!/usr/bin/env bun

export interface QualityCheck {
  id: string
  label: string
  command: string[]
  /** A local tool the check needs. CI always runs the check; the pre-push
   * command skips it, visibly, when the tool is unavailable. */
  requires?: 'docker' | 'chromium'
}

export const QUALITY_CHECKS: readonly QualityCheck[] = [
  { id: 'install', label: 'Install locked dependencies', command: ['bun', 'install', '--frozen-lockfile'] },
  { id: 'dependency-audit', label: 'Reject high or critical dependency advisories', command: ['bun', 'run', 'audit:dependencies'] },
  { id: 'font-subsets', label: 'Regenerate and byte-verify canonical Inter subsets', command: ['bun', 'run', 'scripts/site/subset-website-inter-fonts.ts', '--check'], requires: 'docker' },
  // This must precede website:check: the website demo intentionally performs
  // a write-mode lazy build, which would otherwise repair stale committed
  // catalog/descriptors before CI inspected them.
  { id: 'browser-family-catalog', label: 'Verify the committed lazy browser family catalog', command: ['bun', 'run', 'check:browser-families'] },
  { id: 'website', label: 'Verify website and Worker artifacts', command: ['bun', 'run', 'website:check'] },
  // The lazy bundle's graph and size budgets are judged once, here, on the
  // bundle website:check has just built. `bun run build` only builds it, so
  // the unit shards, E2E lanes and release jobs that build it no longer each
  // report the same overrun.
  { id: 'browser-lazy', label: 'Verify the lazy browser bundle graph and size budgets', command: ['bun', 'run', 'check:browser-lazy'] },
  { id: 'rendered-corpora', label: 'Audit rendered corpora and family structural evidence', command: ['bun', 'run', 'audit:ugly'] },
  { id: 'lint', label: 'Lint TypeScript', command: ['bun', 'run', 'lint:biome'] },
  { id: 'typecheck', label: 'Type check', command: ['bun', 'run', 'typecheck'] },
]

// `bun run check:pre-push` runs the same gates before a push, so the push is
// not their first run. It leaves the install to the developer (run it after
// changing the lockfile) and adds the website payload budgets, which the
// payload E2E lane checks with Chromium.
export const PRE_PUSH_CHECKS: readonly QualityCheck[] = [
  ...QUALITY_CHECKS.filter(check => check.id !== 'install'),
  { id: 'website-payload', label: 'Verify website payload request graphs and budgets', command: ['bun', 'run', 'website:payload:check'], requires: 'chromium' },
]

const TOOL_PROBES: Record<NonNullable<QualityCheck['requires']>, { command: string[]; install: string }> = {
  docker: { command: ['docker', 'info'], install: 'start Docker' },
  chromium: { command: ['bun', '-e', 'import { chromium } from "playwright"; await (await chromium.launch()).close()'], install: 'run `bunx playwright install chromium`' },
}

function toolAvailable(tool: NonNullable<QualityCheck['requires']>): boolean {
  try {
    return Bun.spawnSync(TOOL_PROBES[tool].command, { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0
  } catch {
    return false
  }
}

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
  const prePush = process.argv.includes('--pre-push')
  const suite = prePush ? 'Pre-push checks' : 'Quality suite'
  const skipped: string[] = []
  const checks = prePush ? PRE_PUSH_CHECKS.filter(check => {
    if (!check.requires || toolAvailable(check.requires)) return true
    skipped.push(`${check.label}: skipped because ${check.requires} is unavailable (${TOOL_PROBES[check.requires].install}); CI still runs it`)
    return false
  }) : QUALITY_CHECKS
  for (const line of skipped) process.stdout.write(`\n==> ${line}\n`)
  const failures = collectFailedChecks(checks, runCheck)
  if (failures.length > 0) reportFailures(suite, failures)
  process.stdout.write(`\n${suite} passed (${checks.length} checks${skipped.length ? `, ${skipped.length} skipped` : ''}).\n`)
}
