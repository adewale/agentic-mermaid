/** The user-requested maintained Markdown snapshot. Raw artifacts stay ignored. */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { BenchmarkObservation } from './types.ts'
const escape = (v: unknown) =>
  String(v ?? '—')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
const number = (v: unknown, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—')
const timed = (r: BenchmarkObservation) => !!r.samplesMs?.length && r.samplesMs.every(v => Number.isFinite(v) && v > 0)
const median = (xs: number[]) => {
  const a = [...xs].sort((a, b) => a - b)
  return a.length % 2 ? a[a.length >> 1]! : (a[(a.length >> 1) - 1]! + a[a.length >> 1]!) / 2
}
interface Rank {
  implementation: string
  surface: string
  output: string
  qualified: boolean
  perRoundMs: (number | null)[]
  medianMs: number | null
}
function args() {
  const m = new Map<string, string>()
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i]!,
      v = process.argv[i + 1]
    if (!['--run', '--prs', '--output'].includes(k) || !v) throw Error('Use --run DIRECTORY [--prs DIRECTORY] [--output FILE]')
    m.set(k, resolve(v))
  }
  if (!m.has('--run')) throw Error('--run is required')
  return m
}
function find(root: string, name: string): string | undefined {
  for (const path of [join(root, name), join(root, 'community', name), join(root, 'suites/community', name)]) if (existsSync(path)) return path
  return undefined
}
export function updateCommunityScorecard(run: string, output: string, prs?: string): void {
  const ranksFile = find(run, 'community-ranks.json'),
    resultsFile = find(run, 'community-result.json')
  if (!ranksFile || !resultsFile) throw Error('Completed community ranks/result artifacts are required; incomplete runs cannot erase the maintained snapshot')
  const scores = JSON.parse(readFileSync(ranksFile, 'utf8')) as { startedAt: string; rounds: number; ranks: Rank[]; catalogNodes: number; comparatorNodes: number; artifacts: { node: { id: string }; artifact?: { version: string }; error?: string }[]; gaps: string[] }
  const results = JSON.parse(readFileSync(resultsFile, 'utf8')) as { startedAt: string; finishedAt: string; observations: BenchmarkObservation[]; gaps: string[] }
  if (results.startedAt !== scores.startedAt || !Number.isFinite(Date.parse(results.finishedAt)) || Date.parse(results.finishedAt) < Date.parse(scores.startedAt)) throw Error('Community ranks and result must belong to the same completed run')
  const lines = [
    '# Mermaid community benchmark ranking',
    '',
    `Updated from fresh run **${scores.startedAt} → ${results.finishedAt}**.`,
    '',
    'This is a maintained snapshot requested by the project owner. Refresh it with:',
    '',
    '```sh',
    `bun run bench:scorecard -- --run ${run}${prs ? ` --prs ${prs}` : ''}`,
    '```',
    '',
    `The JSON community catalog enrolls **${scores.catalogNodes} nodes**, with **${scores.comparatorNodes} declared comparator implementations**. Metadata-only forks/wrappers remain visible as not applicable; they do not become measured renderer results.`,
    '',
    '## Comparison policy',
    '',
    '- Every API/CLI/browser boundary has its own rank; there is no invented weighted overall winner.',
    '- SVG/PNG/parser core: six identical inputs across five families. Terminal core: three identical inputs across two families.',
    '- Every required input must qualify in every round. Rejected, missing-label, unsupported and blocked results are retained; none become zero-cost wins.',
    '- API validation, assertions and encoding are outside plain API clocks. Fully consumed receipts and transport/CLI costs are distinct invocation benchmarks.',
    '- Feature-corpus attempts, family-balanced coverage, and pinned-Mermaid same-case scores accompany speed; existential text presence is not complete semantic/visual fidelity.',
    '',
    '## Stack ranks',
    '',
  ]
  const groups = new Map<string, Rank[]>()
  for (const rank of scores.ranks) {
    const key = `${rank.surface} / ${rank.output}`
    groups.set(key, [...(groups.get(key) ?? []), rank])
  }
  for (const [key, rows] of groups) {
    lines.push(`### ${escape(key)}`, '', '| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |', '|---:|---|---|---:|---:|')
    let rank = 0
    for (const row of rows.sort((a, b) => (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity))) {
      const version = scores.artifacts.find(a => a.node.id === row.implementation)?.artifact?.version,
        values = row.perRoundMs.filter((v): v is number => typeof v === 'number')
      lines.push(`| ${row.qualified ? ++rank : 'N/A'} | ${escape(row.implementation)} | ${escape(version)} | ${row.qualified ? number(row.medianMs) : 'Unqualified'} | ${values.length ? `${number(Math.min(...values))}–${number(Math.max(...values))}` : '—'} |`)
    }
    lines.push('')
  }
  lines.push('## Observed feature-corpus coverage', '', '| Implementation | Surface | Format | Qualified / attempted observations | Families with a qualified observation |', '|---|---|---|---:|---:|')
  const coverage = new Map<string, BenchmarkObservation[]>()
  for (const row of results.observations.filter(r => !r.caseId.startsWith('core:') && r.family !== '*' && r.status !== 'not-applicable')) {
    const key = [row.metrics?.implementation, row.surface, row.format].join('|')
    coverage.set(key, [...(coverage.get(key) ?? []), row])
  }
  for (const [key, rows] of coverage) {
    const [id, surface, format] = key.split('|')
    lines.push(`| ${escape(id)} | ${escape(surface)} | ${escape(format)} | ${rows.filter(r => r.status === 'passed').length} / ${rows.length} | ${new Set(rows.filter(r => r.status === 'passed').map(r => r.family)).size} |`)
  }
  const reference = find(run, 'reference-score-result.json') ?? find(join(run, 'pinned-reference-score'), 'reference-score-result.json')
  lines.push('', '## Pinned Mermaid same-case score', '')
  if (reference) {
    const result = JSON.parse(readFileSync(reference, 'utf8')) as { observations: BenchmarkObservation[]; gaps: string[] },
      engines = [...new Set(result.observations.map(r => String(r.metrics?.implementation)))]
    const caseIds = [...new Set(result.observations.map(r => r.caseId))],
      rounds = [...new Set(result.observations.map(r => Number(r.metrics?.round)))],
      shared = caseIds.filter(id =>
        engines.every(engine =>
          rounds.every(round =>
            (() => {
              const rows = result.observations.filter(r => r.caseId === id && r.metrics?.implementation === engine && r.metrics?.round === round)
              return rows.length === 1 && rows[0]!.status === 'passed' && timed(rows[0]!)
            })(),
          ),
        ),
      )
    lines.push('| Parser | Passed portable criteria / evaluated | All-attempt parse portfolio, ms | Shared-qualified parse portfolio, ms |', '|---|---:|---:|---:|')
    for (const engine of engines) {
      const rows = result.observations.filter(r => r.metrics?.implementation === engine),
        passed = rows.reduce((n, r) => n + Number(r.metrics?.passed ?? 0), 0),
        total = rows.reduce((n, r) => n + Number(r.metrics?.criteria ?? 0), 0)
      const portfolios = rounds.map(round => {
          const selected = caseIds.map(id => rows.filter(r => r.metrics?.round === round && r.caseId === id))
          return selected.every(rs => rs.length === 1 && timed(rs[0]!)) ? selected.reduce((n, rs) => n + median(rs[0]!.samplesMs!), 0) : undefined
        }),
        matched = rounds.map(round => rows.filter(r => r.metrics?.round === round && shared.includes(r.caseId)).reduce((n, r) => n + median(r.samplesMs!), 0))
      lines.push(`| ${escape(engine)} | ${passed} / ${total} | ${portfolios.length && portfolios.every((v): v is number => v !== undefined) ? number(median(portfolios)) : 'N/A (missing timings)'} | ${shared.length ? number(median(matched)) : '—'} |`)
    }
    lines.push(
      '',
      `${shared.length} identical cases qualified for every engine in every round. All-attempt cost includes failures and must be read alongside scores; shared-qualified cost uses only that fixed common cohort. These public-parser clocks exclude projections and IPC. Historical layout counts are not parser quantities and are explicitly unscored here; complete imported/current grammar and native-operation tests remain separate owning suites.`,
    )
  } else lines.push('Not present in the selected run; this is an explicit gap, not a passing score.')
  lines.push('', '## Active PR comparisons', '')
  const prFile = prs ? ['pr-ranks.json', 'rankings.json', 'report.json', 'campaign.json'].map(n => join(prs, n)).find(existsSync) : undefined
  if (prFile) {
    const pr = JSON.parse(readFileSync(prFile, 'utf8')) as {
      frozenAt?: string
      main?: string
      ranks?: Array<{ id: string; label?: string; head?: string; integration: string; draft?: boolean; sourceEvidence?: string; buildStatus?: string; browserBundleGzipBytes?: number; metrics: Record<string, { medianMs?: number; pairedRatio?: number; classification?: string; status?: string }> }>
    }
    lines.push(
      `Frozen ${escape(pr.frozenAt)} against main \`${escape(pr.main)}\`. Rows use the same six-case fully consumed artifact protocol; community plain-API timings above are a different boundary.`,
      '',
      '| Candidate | Frozen head | State | SVG paired ratio | SVG receipt paired ratio | Unicode receipt paired ratio | Verified edit paired ratio | Shipped browser gzip, KiB |',
      '|---|---|---|---:|---:|---:|---:|---:|',
    )
    const ratio = (m: { pairedRatio?: number; classification?: string } | undefined) => (typeof m?.pairedRatio !== 'number' || !Number.isFinite(m.pairedRatio) ? 'N/A' : number(m.pairedRatio, 3) + '×' + (m.classification?.includes('variation') ? ' (tie)' : ''))
    for (const r of [...(pr.ranks ?? [])].sort((a, b) => (a.metrics.svg?.pairedRatio ?? Infinity) - (b.metrics.svg?.pairedRatio ?? Infinity))) {
      const exploratory = ['conflicting-head', 'branch-base'].includes(r.integration)
      lines.push(
        `| ${escape(r.label ?? r.id)} | \`${escape(r.head?.slice(0, 12))}\` | ${escape(r.integration)}${r.draft ? ' · draft' : ''}${r.sourceEvidence && r.sourceEvidence !== r.id ? ' · evidence ' + escape(r.sourceEvidence) : ''} | ${exploratory ? 'Exploratory' : ratio(r.metrics.svg)} | ${exploratory ? 'Exploratory' : ratio(r.metrics.svgReceipt)} | ${exploratory ? 'Exploratory' : ratio(r.metrics.unicodeReceipt)} | ${exploratory ? 'Exploratory' : ratio(r.metrics.agent)} | ${r.browserBundleGzipBytes ? number(r.browserBundleGzipBytes / 1024, 1) : 'N/A'} |`,
      )
    }
    lines.push('', `Full per-metric rows, fresh bracketing controls, broad family/invocation results and artifact identities: [PR campaign evidence](${escape(relative(dirname(output), prFile))}). Source-conflicting heads and own bases stay exploratory; no merge readiness is implied.`)
  } else lines.push('No PR campaign supplied to this snapshot. Refresh with `--prs` after running `bench:prs`; historical PR scores are not relabeled as current.')
  const actualGaps = [...new Set([...scores.gaps, ...results.gaps])]
  lines.push(
    '',
    '## Remaining gaps and limits',
    '',
    ...actualGaps.map(g => `- ${escape(g)}`),
    '',
    'Blocked comparator acquisition:',
    '',
    ...scores.artifacts.filter(a => !a.artifact && a.error).map(a => `- **${escape(a.node.id)}:** ${escape(a.error)}`),
    '',
    `Raw source of truth: ${escape(run)}. Re-run the benchmark commands to refresh; do not hand-edit numbers or reuse old clocks as new evidence.`,
    '',
  )
  const temporary = output + '.tmp'
  writeFileSync(temporary, lines.join('\n'))
  renameSync(temporary, output)
}
if (import.meta.main) {
  const a = args()
  updateCommunityScorecard(a.get('--run')!, a.get('--output') ?? resolve('docs/community-benchmark-ranking.md'), a.get('--prs'))
}
