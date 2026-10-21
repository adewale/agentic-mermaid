// Keep complete finder evidence per run; notify the collector only when a
// property it has not already recorded fails. Repeated counterexamples remain
// available in the artifact without generating another issue notification.

export const FINDER_ISSUE_TITLE = 'Nightly finder: random-seed property counterexamples'

interface FinderFailure {
  test: string
  file?: string
  seed?: number
  path?: string
  reproductions: string[]
}

export interface FinderReport {
  failingTests: string[]
  reproductions: string[]
  failures: FinderFailure[]
  body: string
}

const FAIL_LINE = /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/
const REPRO_LINE = /\{\s*seed:\s*-?\d+,\s*path:\s*"[^"]*"|Counterexample:|Property failed after/

export function finderReport(log: string, runUrl: string, prior = ''): FinderReport {
  const failures = new Map<string, FinderFailure>()
  let file: string | undefined
  let pending: string[] = []
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim()
    const heading = /^(?:##\[group\])?((?:src|eval)\/[^:]+\.test\.[cm]?[jt]s):$/.exec(line)
    if (heading) { file = heading[1]; pending = []; continue }
    const match = FAIL_LINE.exec(line)
    if (!match) { pending.push(line); continue }
    const test = match[1]!
    // Bun prints a second failure summary at the end. Keep the original
    // block, whose file and reproduction context are still in scope.
    if (!failures.has(test)) {
      const reproduction = [...new Set(pending.filter(line => REPRO_LINE.test(line) && !line.startsWith('::error')))]
      const seed = /\{\s*seed:\s*(-?\d+),\s*path:\s*"([^"]*)"/.exec(reproduction.join('\n'))
      failures.set(test, { test, ...(file ? { file } : {}), ...(seed ? { seed: Number(seed[1]), path: seed[2] } : {}), reproductions: reproduction })
    }
    pending = []
  }
  const all = [...failures.values()]
  const known = new Set<string>()
  for (const match of prior.matchAll(/<!-- nightly-finder-test (.*?) -->/g)) {
    try { known.add(JSON.parse(match[1]!)) } catch { /* Ignore unrelated or incomplete comments. */ }
  }
  // Older reports have no marker; their failing-test bullets still identify
  // the property. Notification deduplication never discards run evidence.
  const fresh = all.filter(failure => !known.has(failure.test) && !prior.split('\n').some(line => line.trim() === `- ${failure.test}`))
  const body = fresh.length ? [
    `The nightly finder found ${fresh.length} newly reported failing ${fresh.length === 1 ? 'property' : 'properties'}: ${runUrl}`,
    '',
    'These are triage candidates, not confirmed product defects. The run’s `property-finder-evidence` artifact retains the complete log and JSON reproductions, including repeats.',
    '',
    '### Failing tests',
    ...fresh.map(failure => `- ${failure.test}`),
    '',
    ...fresh.flatMap(failure => [
      `### ${failure.file ?? 'Unlocated test'} — ${failure.test}`,
      ...(failure.seed !== undefined && failure.file ? [
        '', '```sh',
        `AM_FC_SEED=${failure.seed} AM_FC_NUM_RUNS=300 bun test --timeout 120000 ${failure.file}`,
        '```',
      ] : ['', 'No fast-check seed was captured; inspect the full run log for an assertion, timeout or setup failure.']),
      '',
      '<!-- nightly-finder-test ' + JSON.stringify(failure.test).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') + ' -->',
      '',
    ]),
    'Keep confirmed reduced inputs as fast-check `examples` at the owning boundary. Check existing backlog entries before treating a repeated report as new work.',
  ].join('\n') : ''
  if (!all.length) return { failingTests: [], reproductions: [], failures: [], body: prior.includes('<!-- nightly-finder-unlocated -->') ? '' : `The random-seed sweep failed without a captured test failure: ${runUrl}\n\nInspect the complete log in the \`property-finder-evidence\` artifact; this may be a timeout or instrumentation failure.\n\n<!-- nightly-finder-unlocated -->` }
  return { failingTests: all.map(failure => failure.test), reproductions: all.flatMap(failure => failure.reproductions), failures: all, body }
}

if (import.meta.main) {
  const [logPath, priorPath, reportPath] = process.argv.slice(2)
  if (!logPath) throw new Error('Usage: bun run scripts/ci/nightly-finder-report.ts <sweep.log> [prior.md] [report.json]')
  const runUrl = process.env.RUN_URL ?? '(run URL unavailable)'
  const report = finderReport(await Bun.file(logPath).text(), runUrl, priorPath ? await Bun.file(priorPath).text() : '')
  if (reportPath) await Bun.write(reportPath, JSON.stringify({ runUrl, commit: process.env.GITHUB_SHA, ...report }, null, 2) + '\n')
  if (report.body) process.stdout.write(report.body + '\n')
}
