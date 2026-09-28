// Nightly finder report: turns a failing random-seed property sweep log into
// one issue body, so a counterexample found off the PR gate is never lost.
// The decision logic is a pure function unit-tested in
// src/__tests__/nightly-finder-report.test.ts; nightly-finder.yml posts the
// result with the GitHub CLI.

export const FINDER_ISSUE_TITLE = 'Nightly finder: random-seed property counterexamples'

export interface FinderReport {
  failingTests: string[]
  /** fast-check reproduction lines (`seed: …, path: …`) and counterexamples. */
  reproductions: string[]
  body: string
}

const FAIL_LINE = /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/
const REPRO_LINE = /\{\s*seed:\s*-?\d+,\s*path:\s*"[^"]*"|Counterexample:|Property failed after/

export function finderReport(log: string, runUrl: string): FinderReport {
  const lines = log.split(/\r?\n/)
  const failingTests = [...new Set(lines.flatMap(line => {
    const match = FAIL_LINE.exec(line.trim())
    return match ? [match[1]!] : []
  }))]
  const reproductions = [...new Set(lines.map(line => line.trim()).filter(line => REPRO_LINE.test(line)))]
    .map(line => line.length > 400 ? `${line.slice(0, 400)}…` : line)
  const body = [
    `The nightly random-seed sweep failed: ${runUrl}`,
    '',
    '### Failing tests',
    ...(failingTests.length ? failingTests.map(name => `- ${name}`) : ['- (no `(fail)` lines found; see the run log)']),
    '',
    '### Reproduction',
    ...(reproductions.length ? ['```', ...reproductions, '```'] : ['No fast-check seed line was captured; the failure may be a timeout or a non-property test.']),
    '',
    'Reproduce with `AM_FC_SEED=<seed> bun test <file>` (docs/testing-strategy.md, seed policy).',
    'When the counterexample is real, fix it and keep it forever as a fast-check `examples` entry',
    'on the property, because seeds and paths do not survive fast-check upgrades.',
  ].join('\n')
  return { failingTests, reproductions, body }
}

if (import.meta.main) {
  const [logPath] = process.argv.slice(2)
  if (!logPath) throw new Error('Usage: bun run scripts/ci/nightly-finder-report.ts <sweep.log>')
  const runUrl = process.env.RUN_URL ?? '(run URL unavailable)'
  process.stdout.write(finderReport(await Bun.file(logPath).text(), runUrl).body + '\n')
}
