// Grammar finder report: turns a rolling-seed grammar run's summary into one
// issue comment listing the silent reads the issue does not already hold, so a
// source Mermaid rejects and ours reads without a word is never lost.
// nightly-finder.yml posts it with the GitHub CLI; an empty body means nothing new.

export const GRAMMAR_FINDER_ISSUE_TITLE = 'Grammar finder: sources Mermaid rejects that ours reads silently'

interface SilentRead {
  family: string
  id: string
  /** The reduced source as a JSON string, blank and invisible characters escaped. */
  spelled: string
  mermaid: string
  ours: { native: string; envelope: string; read: string }
  verify: string[]
  occurrences: number
}

/** The part of eval/mermaid-modern-compat/grammar-run.ts's summary.json this reads. */
export interface GrammarSummary {
  seed: number
  mutationsPerFamily: number
  silentReads: { definition: string; total: number; byFamily: Record<string, { corpus: number; mutations: number }>; examples: SilentRead[] }
}

const LIMIT = 60_000
const block = (text: string, info = ''): string => {
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(run => run[0].length + 1)))
  return `${fence}${info}\n${text}\n${fence}`
}

export function grammarFinderReport(summary: GrammarSummary, prior: string, runUrl: string): string {
  // A source's spelling names it exactly, blanks and line ends included, and
  // is how the issue lists it, so an earlier listing is found verbatim.
  const fresh = summary.silentReads.examples.filter(example => !prior.includes(example.spelled))
  if (!fresh.length) return ''
  const sections = fresh.map(example =>
    [
      `### ${example.family}: \`${example.id}\``,
      `${example.occurrences} reduced input(s) gave this source. As a JSON string:`,
      block(example.spelled, 'json'),
      `Ours reads it (${example.ours.native} natively; envelope ${example.ours.envelope}) as:`,
      block(example.ours.read),
      'Mermaid says:',
      block(example.mermaid),
      `verify: ${example.verify.join(', ') || 'no findings'}`,
    ].join('\n'),
  )
  const head = [
    `The rolling-seed grammar finder found ${fresh.length} new silent read(s) with seed \`${summary.seed}\` and ${summary.mutationsPerFamily} mutations per family: ${runUrl}`,
    '',
    `${summary.silentReads.definition} Counts in this run, including reads listed before:`,
    '',
    '| Family | Corpus | Mutations |',
    '| --- | ---: | ---: |',
    ...Object.entries(summary.silentReads.byFamily).map(([family, counts]) => `| ${family} | ${counts.corpus} | ${counts.mutations} |`),
    '',
  ].join('\n')
  const tail = [
    '',
    `Reproduce a run with \`bun run eval:mermaid-grammar --families <family> --seed ${summary.seed} --fuzz ${summary.mutationsPerFamily}\`; the run's artifact holds each unreduced input.`,
    'Judge each read for how likely an author is to write it before fixing it. A fix keeps the reading and has verify report `UNSUPPORTED_SYNTAX`, or records a divergence (CLAUDE.md, "Mermaid is our input language, not our spec").',
  ].join('\n')
  let body = head
  let listed = 0
  for (const section of sections) {
    if (body.length + section.length + tail.length > LIMIT) break
    body += `\n${section}\n`
    listed++
  }
  if (listed < sections.length) body += `\n${sections.length - listed} more new silent read(s) did not fit; see the run's artifact.\n`
  return body + tail
}

if (import.meta.main) {
  const [summaryPath, priorPath] = process.argv.slice(2)
  if (!summaryPath) throw new Error('Usage: bun run scripts/ci/grammar-finder-report.ts <summary.json> [prior-issue.md]')
  const summary = (await Bun.file(summaryPath).json()) as GrammarSummary
  const prior = priorPath ? await Bun.file(priorPath).text() : ''
  const body = grammarFinderReport(summary, prior, process.env.RUN_URL ?? '(run URL unavailable)')
  if (body) process.stdout.write(`${body}\n`)
}
