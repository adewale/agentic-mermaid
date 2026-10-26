import { readBenchmarkDocument } from '../portable/project-records.ts'
/** The user-requested maintained Markdown snapshot. Raw artifacts stay ignored. */

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
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
  version?: string
  variantOf?: string
  surface: string
  output: string
  qualified: boolean
  perRoundMs: (number | null)[]
  medianMs: number | null
  family?: string
  independentMeasurement?: boolean
  evidenceImplementation?: string
}
export interface ScorecardSelection {
  communityRun?: string
  invocationCorrection?: string
  referenceCorrection?: string
  allowCommunityTargetChange?: boolean
  currentRun?: string
  additionalRun?: string
  cliNativeProof?: string
  historicalPrs?: string
  currentInvocationRun?: string
  currentInvocationAssets?: string
  currentDaveRun?: string
  familyCorrection?: string
  cliResourceRun?: string
  suiteRuns?: string[]
}
function args() {
  const m = new Map<string, string>()
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i]!
    if (k === '--allow-community-target-change') {
      m.set(k, 'true')
      continue
    }
    const v = process.argv[++i]
    if (
      ![
        '--run',
        '--prs',
        '--output',
        '--community-run',
        '--invocation-correction',
        '--reference-correction',
        '--current-run',
        '--additional-run',
        '--cli-native-proof',
        '--historical-prs',
        '--current-invocation-run',
        '--current-invocation-assets',
        '--current-dave-run',
        '--family-correction',
        '--cli-resource-run',
        '--suite-run',
      ].includes(k) ||
      !v
    )
      throw Error('Use --run DIRECTORY [--prs DIRECTORY] [--output FILE] [--community-run DIRECTORY] [--invocation-correction FILE] [--reference-correction FILE] [--current-run DIRECTORY] [--additional-run DIRECTORY]')
    if (k === '--suite-run') m.set(k, JSON.stringify([...JSON.parse(m.get(k) ?? '[]'), resolve(v)]))
    else m.set(k, resolve(v))
  }
  if (!m.has('--run')) throw Error('--run is required')
  if (m.has('--allow-community-target-change') && !m.has('--community-run')) throw Error('--allow-community-target-change requires --community-run')
  return m
}
function find(root: string, name: string): string | undefined {
  for (const path of [join(root, name), join(root, 'community', name), join(root, 'suites/community', name)]) if (existsSync(path)) return path
  return undefined
}
export function updateCommunityScorecard(run: string, output: string, prs?: string, selection: ScorecardSelection = {}): void {
  const validationArgs = [join(import.meta.dir, 'charts.py'), '--run', run, '--validate-only']
  if (selection.allowCommunityTargetChange) validationArgs.push('--allow-community-target-change')
  for (const [flag, value] of [
    ['--prs', prs],
    ['--community-run', selection.communityRun],
    ['--invocation-correction', selection.invocationCorrection],
    ['--reference-correction', selection.referenceCorrection],
    ['--current-run', selection.currentRun],
    ['--additional-run', selection.additionalRun],
    ['--cli-native-proof', selection.cliNativeProof],
    ['--historical-prs', selection.historicalPrs],
    ['--current-invocation-run', selection.currentInvocationRun],
    ['--current-invocation-assets', selection.currentInvocationAssets],
    ['--current-dave-run', selection.currentDaveRun],
    ['--family-correction', selection.familyCorrection],
    ['--cli-resource-run', selection.cliResourceRun],
  ])
    if (value) validationArgs.push(flag!, value)
  for (const directory of selection.suiteRuns ?? []) validationArgs.push('--suite-run', directory)
  const admission = JSON.parse(execFileSync(process.env.PYTHON_BINARY ?? 'python3', validationArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }))
  if (admission.protocol !== 'unified-report-selection-v1') throw Error('Unknown shared report-selection admission protocol')
  const ledger = readBenchmarkDocument(join(run, 'report.json'))
  const communityRoot = admission.communityDirectory as string
  const ranksFile = find(communityRoot, 'community-ranks.json'),
    resultsFile = find(communityRoot, 'community-result.json')
  if (!ranksFile || !resultsFile) throw Error('Completed community ranks/result artifacts are required; incomplete runs cannot erase the maintained snapshot')
  const scores = readBenchmarkDocument(ranksFile) as { startedAt: string; rounds: number; ranks: Rank[]; familyRanks?: Rank[]; catalogNodes: number; comparatorNodes: number; artifacts: { node: { id: string; benchmark?: unknown }; artifact?: { version: string }; error?: string }[]; gaps: string[] }
  const results = readBenchmarkDocument(resultsFile) as { startedAt: string; finishedAt: string; observations: BenchmarkObservation[]; gaps: string[] }
  if (results.startedAt !== scores.startedAt || !Number.isFinite(Date.parse(results.finishedAt)) || Date.parse(results.finishedAt) < Date.parse(scores.startedAt)) throw Error('Community ranks and result must belong to the same completed run')
  const cliFile = admission.cliSupplement ? join(admission.cliSupplement.directory, 'ranks.json') : join(dirname(ranksFile), '../community-cli/ranks.json')
  let cli: any
  if (existsSync(cliFile)) {
    cli = readBenchmarkDocument(cliFile)
    const rawFile = join(dirname(cliFile), 'community-cli-result.json'),
      raw = readBenchmarkDocument(rawFile)
    const originalInputs = readBenchmarkDocument(join(dirname(ranksFile), 'community-inputs.json')).workloads.filter((w: any) => w.features.includes('core-graph-batch'))
    if (
      !cli.finishedAt ||
      cli.finishedAt !== raw.finishedAt ||
      cli.startedAt !== raw.startedAt ||
      cli.rounds !== raw.rounds ||
      realpathSync(cli.evidence?.sourceRun ?? '') !== realpathSync(dirname(ranksFile)) ||
      JSON.stringify(cli.evidence?.cohort) !== JSON.stringify(originalInputs) ||
      JSON.stringify(cli.ranks) !== JSON.stringify(raw.ranks)
    )
      throw Error('Supplemental CLI ranks do not match their completed raw result and exact frozen core cohort')
    for (const rank of cli.ranks as Rank[])
      if (rank.qualified && (rank.perRoundMs.length !== cli.rounds || rank.perRoundMs.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0) || typeof rank.medianMs !== 'number' || !Number.isFinite(rank.medianMs) || rank.medianMs <= 0)) throw Error('Supplemental CLI rank has invalid timing admission')
    scores.ranks = [...scores.ranks.filter(r => r.surface !== 'cli:end-to-end'), ...cli.ranks]
    scores.familyRanks = [...(scores.familyRanks ?? []).filter(r => r.surface !== 'cli:end-to-end'), ...(admission.cliSupplement?.familyRanks ?? [])]
    if (admission.cliSupplement?.resourceCorrection) {
      const resources = readBenchmarkDocument(join(admission.cliSupplement.resourceCorrection.directory, 'ranks.json'))
      cli.resourceRanks = resources.resourceRanks
      cli.evidence.resourceObserver = resources.evidence.resourceObserver
    }
  }
  const lines = [
    '# Mermaid community benchmark ranking',
    '',
    `Updated from community evidence **${scores.startedAt} → ${results.finishedAt}**. Separate measurement and composition windows are identified below.`,
    '',
    'This is a maintained snapshot requested by the project owner. Refresh it with:',
    '',
    '```sh',
    `bun run bench:scorecard -- --run ${run}${prs ? ` --prs ${prs}` : ''}${selection.communityRun ? ` --community-run ${selection.communityRun}` : ''}${selection.allowCommunityTargetChange ? ' --allow-community-target-change' : ''}${selection.invocationCorrection ? ` --invocation-correction ${selection.invocationCorrection}` : ''}${selection.referenceCorrection ? ` --reference-correction ${selection.referenceCorrection}` : ''}${selection.currentRun ? ` --current-run ${selection.currentRun}` : ''}${selection.additionalRun ? ` --additional-run ${selection.additionalRun}` : ''}${selection.cliNativeProof ? ` --cli-native-proof ${selection.cliNativeProof}` : ''}${selection.historicalPrs ? ` --historical-prs ${selection.historicalPrs}` : ''}${selection.currentInvocationRun ? ` --current-invocation-run ${selection.currentInvocationRun}` : ''}${selection.currentInvocationAssets ? ` --current-invocation-assets ${selection.currentInvocationAssets}` : ''}${selection.currentDaveRun ? ` --current-dave-run ${selection.currentDaveRun}` : ''}${selection.familyCorrection ? ` --family-correction ${selection.familyCorrection}` : ''}${selection.cliResourceRun ? ` --cli-resource-run ${selection.cliResourceRun}` : ''}${(selection.suiteRuns ?? []).map(directory => ` --suite-run ${directory}`).join('')}`,
    '```',
    '',
    `The JSON community catalog enrolls **${scores.catalogNodes} nodes**, with **${scores.comparatorNodes} configured candidates**. Configuration is not a working-API claim. Actual acquisition, unsupported operations, host failures and source-evidence aliases remain visible; none become passing renderer results by enrollment alone.`,
    '',
    '## Comparison policy',
    '',
    '- Every API/CLI/browser boundary has its own rank; there is no invented weighted overall winner.',
    '- SVG/PNG/parser core: six identical inputs across five families. Terminal core: three identical inputs across two families.',
    '- Every required input must qualify in every round. Rejected, missing-label, unsupported and blocked results are retained; none become zero-cost wins.',
    '- Harness validation/assertions and transport are outside plain API clocks; engine-owned layout, serialization and encoding remain included when part of the public operation. Fully consumed receipts and transport/CLI costs are distinct invocation benchmarks.',
    '- Feature-corpus attempts, family-balanced coverage, and pinned-Mermaid same-case scores accompany speed; existential text presence is not complete semantic/visual fidelity.',
    '',
    '## Stack ranks',
    '',
  ]
  lines.splice(4, 0, `Original full-run ledger: **${escape(ledger.status)}**, ${escape(ledger.startedAt)} → ${escape(ledger.finishedAt)}; target \`${escape(ledger.targetRevision)}\`. Explicit scoped replays below do not rewrite that aggregate status.`, '')
  for (const [kind, evidence] of [
    ['Community replay', admission.communityReplay],
    ['Invocation correction', admission.invocationCorrection],
    ['Reference baseline correction', admission.referenceCorrection],
  ] as const) {
    if (evidence)
      lines.push(
        `**${kind}:** ${escape(evidence.qualificationChange ?? evidence.protocolChange ?? 'Reviewed positive-eligibility protocol repair; diagnostic inputs remain retained separately.')} Evidence: ${escape(evidence.explicitCorrectionFile ?? evidence.directory)}; completed ${escape(evidence.finishedAt ?? evidence.correctedFinishedAt ?? evidence.correction?.finishedAt)}. Original ledger remains unchanged; this is not a product improvement or a new full run.`,
        '',
      )
  }
  if (admission.communityReplay?.targetAdvance) {
    const advance = admission.communityReplay.targetAdvance
    lines.push(
      `**Community-only target advance:** \`${escape(advance.from.revision)}\` → \`${escape(advance.to.revision)}\`, measured ${escape(admission.communityReplay.startedAt)} → ${escape(admission.communityReplay.finishedAt)}. New actual target tarball SHA256: \`${escape(advance.to.candidateSha256)}\`. Every original invocation, pinned-reference correction and owning suite keeps its separately recorded older target. The expanded population/protocol and changed product prevent attributing the difference to a single optimization.`,
      '',
    )
  }
  if (admission.communityReplay?.composition) {
    const composition = admission.communityReplay.composition
    lines.push(
      '',
      `**Explicit community qualification composition:** original non-SVG/non-IR measurements ${escape(composition.original.startedAt)} → ${escape(composition.original.finishedAt)}; fresh SVG/React Flow qualification measurements ${escape(composition.repair.startedAt)} → ${escape(composition.repair.finishedAt)}. Composed ${escape(composition.composedAt)}. Engine bytes, target, pins and literal sources remain fixed. This repairs benchmark qualification and does not measure product speed improvement. Original raw ledgers remain unchanged.`,
      '',
    )
  }
  if (admission.cliSupplement?.nativeBinding)
    lines.push(
      '',
      `**Native CLI source binding:** a clean-source rebuild of ${escape(admission.cliSupplement.nativeBinding.sourceRevision)} reproduced the exact previously measured executable SHA256 ${escape(admission.cliSupplement.nativeBinding.executableSha256)}. The post-latency proof adds source provenance; no timing row changes. Proof: ${escape(admission.cliSupplement.nativeBinding.proofFile)}.`,
      '',
    )
  if (admission.cliSupplement?.resourceCorrection)
    lines.push(
      '',
      `**Explicit fixed-work CLI resource observation:** ${escape(admission.cliSupplement.resourceCorrection.policy)} ${escape(admission.cliSupplement.resourceCorrection.startedAt)} → ${escape(admission.cliSupplement.resourceCorrection.finishedAt)}; ${admission.cliSupplement.resourceCorrection.freshQualifiedResourceRanks} qualified resource cohorts. Actual observer ${escape(admission.cliSupplement.resourceCorrection.observer.path)} with recorded byte identity/version. Old missing-observer rows remain at their original paths.`,
      '',
    )
  const groups = new Map<string, Rank[]>()
  for (const rank of scores.ranks) {
    const key = `${rank.surface} / ${rank.output}`
    groups.set(key, [...(groups.get(key) ?? []), rank])
  }
  for (const [key, rows] of groups) {
    lines.push(`### ${escape(key)}`, '', '| Rank | Implementation | Version | Fixed core batch, ms | Observed round range, ms |', '|---:|---|---|---:|---:|')
    let rank = 0
    for (const row of rows.sort((a, b) => (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity))) {
      const version = row.version ?? scores.artifacts.find(a => a.node.id === (row.variantOf ?? row.implementation))?.artifact?.version,
        values = row.perRoundMs.filter((v): v is number => typeof v === 'number')
      lines.push(
        `| ${row.qualified ? ++rank : 'N/A'} | ${escape(row.implementation)}${row.independentMeasurement === false ? ` (shared evidence: ${escape(row.evidenceImplementation)})` : ''} | ${escape(version)} | ${row.qualified ? number(row.medianMs) : 'Unqualified'} | ${values.length ? `${number(Math.min(...values))}–${number(Math.max(...values))}` : '—'} |`,
      )
    }
    lines.push('')
  }
  if (scores.familyRanks?.length) {
    lines.push(
      '## Conditional family stack ranks',
      '',
      'These reuse only the existing fixed core: flowchart has two inputs, other SVG/parser families one; terminal flowchart two and sequence one. Every required input must qualify in every round. This supports narrow tools without implying complete family functionality.',
      '',
      '| Family | Boundary / output | Rank | Implementation | Qualified family core, ms | Evidence |',
      '|---|---|---:|---|---:|---|',
    )
    const familyGroups = new Map<string, Rank[]>()
    for (const row of scores.familyRanks) {
      const key = [row.family, row.surface, row.output].join('|')
      familyGroups.set(key, [...(familyGroups.get(key) ?? []), row])
    }
    for (const rows of familyGroups.values()) {
      let rank = 0
      for (const row of rows.sort((a, b) => (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity)))
        lines.push(
          `| ${escape(row.family)} | ${escape(row.surface)} / ${escape(row.output)} | ${row.qualified ? ++rank : 'N/A'} | ${escape(row.implementation)} | ${row.qualified ? number(row.medianMs) : 'Unqualified'} | ${row.independentMeasurement === false ? `shared: ${escape(row.evidenceImplementation)}` : 'independent attempt'} |`,
        )
    }
    lines.push('')
  }
  if (cli)
    lines.push(
      `CLI ranks use the separate fresh matched cohort **${cli.startedAt} → ${cli.finishedAt}**, with ${cli.rounds} rounds. Agentic Mermaid #node-cli/#native-cli are invocation variants of one catalog tool. The supplemental phase adds no broad feature-coverage claims. Original API/browser timings retain their own phase.`,
      '',
    )
  lines.push(
    '## Observed feature-corpus coverage',
    '',
    'These are operation-specific outcomes, not a universal fidelity score. SVG/terminal qualification checks output envelopes and authored labels; parser/IR/source operations retain their own scopes. A diagnostic operation may complete with rejection findings; diagnostic acceptance is shown separately and is not an independently established feature oracle.',
    '',
    '| Implementation | Surface | Format | Operation-complete / attempted observations | Families with operation completion | Diagnostic accepted / completed with acceptance recorded |',
    '|---|---|---|---:|---:|---:|',
  )
  const coverage = new Map<string, BenchmarkObservation[]>()
  const featureIds = new Set<string>(
    readBenchmarkDocument(join(dirname(ranksFile), 'community-inputs.json'))
      .workloads.filter((w: any) => !w.features.includes('core-graph-batch'))
      .map((w: any) => w.id),
  )
  for (const row of results.observations.filter(r => featureIds.has(r.caseId) && r.family !== '*' && r.status !== 'not-applicable')) {
    const key = [row.metrics?.implementation, row.surface, row.format].join('|')
    coverage.set(key, [...(coverage.get(key) ?? []), row])
  }
  for (const [key, rows] of coverage) {
    const [id, surface, format] = key.split('|')
    const diagnostics = rows.filter(row => row.status === 'passed' && typeof row.metrics?.accepted === 'boolean')
    lines.push(
      `| ${escape(id)} | ${escape(surface)} | ${escape(format)} | ${rows.filter(r => r.status === 'passed').length} / ${rows.length} | ${new Set(rows.filter(r => r.status === 'passed').map(r => r.family)).size} | ${diagnostics.length ? `${diagnostics.filter(row => row.metrics?.accepted === true).length} / ${diagnostics.length}` : 'N/A'} |`,
    )
  }
  lines.push(
    '',
    '## Delivery and scoped memory diagnostics',
    '',
    'Community API process.resourceUsage().maxRSS peaks are excluded as uninterpretable: identical parent/fork high-water values recur across independent worker implementations. Raw values remain unchanged. The displayed endRssBytes uses actual after-loop process.memoryUsage().rss, a resident snapshot including runtime/harness; it is not peak, allocation or a leak measurement.',
    '',
    'Each runtime, boundary, output, round, worker attempt and attempted portfolio stays separate. In the feature-once replay, round-one full963-input work is never pooled with later six-core-input work; the original repeated-feature protocol retains its actual per-round counts. Browser V8 heap excludes WASM/native/GPU memory; process RSS includes runtime, caches and qualification. Missing metrics are unmeasured, not zero; these are not equal-work efficiency or leak ranks.',
    '',
    '| Implementation | Runtime / boundary / output | Round / attempt | Portfolio inputs / features | Metric | Value | Scope |',
    '|---|---|---|---|---|---:|---|',
  )
  const diagnostics = new Map<string, { row: BenchmarkObservation; metric: string; value: number }>()
  const portfolioKey = (row: BenchmarkObservation) => [row.metrics?.implementation, row.runtime, row.surface, row.format, row.metrics?.round, row.metrics?.workerAttempt].join('|')
  const portfolios = new Map<string, Set<string>>()
  for (const row of results.observations.filter(row => featureIds.has(row.caseId) || row.caseId.startsWith('core:'))) {
    const key = portfolioKey(row)
    const cases = portfolios.get(key) ?? new Set<string>()
    cases.add(row.caseId)
    portfolios.set(key, cases)
  }
  for (const row of results.observations) {
    for (const metric of ['gzipBytes', 'jsHeapUsedBytes', 'endRssBytes']) {
      if ((metric === 'gzipBytes' && (row.operation !== 'delivery' || row.status !== 'passed')) || (metric === 'jsHeapUsedBytes' && (row.operation !== 'memory' || row.status !== 'passed'))) continue
      const value = row.metrics?.[metric]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const key = [row.metrics?.implementation, row.runtime, row.surface, row.format, row.metrics?.round, row.metrics?.workerAttempt, row.metrics?.portfolioCaseCount, row.metrics?.featureCases, row.metrics?.renderedOutput, metric].join('|')
      const prior = diagnostics.get(key)
      if (!prior || prior.value < value) diagnostics.set(key, { row, metric, value })
    }
  }
  for (const { row, metric, value } of diagnostics.values()) {
    const cases = portfolios.get(portfolioKey(row))
    const inputCount = row.metrics?.portfolioCaseCount ?? (cases ? `${cases.size} observed case rows` : 'unrecorded')
    const featureCount = row.metrics?.featureCases ?? (cases ? [...cases].filter(id => featureIds.has(id)).length : 'unrecorded')
    lines.push(
      `| ${escape(row.metrics?.implementation)} | ${escape(row.runtime)} / ${escape(row.surface)} / ${escape(row.format)} | ${escape(row.metrics?.round)} / ${escape(row.metrics?.workerAttempt)} | ${escape(inputCount)} / ${escape(featureCount)} | ${escape(metric)} | ${number(value / (metric === 'gzipBytes' ? 1024 : 1024 ** 2), 1)} ${metric === 'gzipBytes' ? 'KiB' : 'MiB'} | ${metric === 'gzipBytes' ? `through attempted portfolio; ${escape(row.metrics?.requests)} requests` : metric === 'jsHeapUsedBytes' ? 'forced-GC browser V8 heap' : 'after-loop current resident RSS snapshot; not peak; runtime/harness/failed attempts included'} |`,
    )
  }
  lines.push(
    '',
    '## Catalog operation outcomes',
    '',
    'Counts retain actual capability and operation outcomes. Not-applicable and unsupported results are distinct from failures; acquisition/configuration is not a positive test.',
    '',
    '| Implementation | Boundary | Output | Operation | Status | Observations |',
    '|---|---|---|---|---|---:|',
  )
  const outcomes = new Map<string, number>()
  for (const row of results.observations) {
    const key = [row.metrics?.implementation, row.surface, row.format, row.operation, row.status].map(escape).join(' | ')
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1)
  }
  for (const [key, count] of outcomes) lines.push(`| ${key} | ${count} |`)
  if (cli) {
    lines.push(
      '',
      '## Fixed-work CLI child resources',
      '',
      'One separately instrumented GNU-time pass follows all uninstrumented CLI latency rounds. Peak RSS is the maximum per-case child value; CPU sums fresh-process cases. These values include runtime/shared code and are not PSS, allocation or leak measurements. CPU fields have 10 ms reporting grain; the conservative allowance is not a confidence interval.',
      '',
      '| Implementation | Output | Required cases | Peak child RSS, MiB | Reported user + system CPU, ms | Conservative CPU interval, ms |',
      '|---|---|---:|---:|---:|---:|',
    )
    for (const row of cli.resourceRanks ?? []) {
      const qualified = row.qualified === true
      lines.push(
        `| ${escape(row.implementation)} | ${escape(row.output)} | ${row.requiredCaseIds?.length ?? '—'} | ${qualified ? number(row.peakRssBytes / 1024 ** 2, 1) : 'N/A'} | ${qualified ? (row.cpuBelowResolution ? `< ${number(row.totalCpuUpperBoundMs, 0)} (censored)` : number(row.totalCpuMs, 0)) : 'N/A'} | ${qualified ? `${number(row.totalCpuLowerBoundMs, 0)}–${number(row.totalCpuUpperBoundMs, 0)}` : 'N/A'} |`,
      )
    }
    lines.push(
      '',
      '### CLI executable file scopes',
      '',
      'Executable bytes are delivery identities, not equal-work memory or complete tool package sizes. Python and other interpreted programs use external runtimes; their interpreter bytes are not a compiled tool payload. Original recorded scope remains in raw evidence. Dynamic libraries, source/dependency download closures and complete installation sizes are unmeasured here.',
      '',
      '| Implementation | Variant | Executable file, MiB | Scope |',
      '|---|---|---:|---|',
    )
    for (const variant of cli.evidence?.variants ?? []) {
      const artifact = variant.prepared?.artifact ?? {},
        delivery = variant.identity?.delivery ?? {},
        runtime = String(artifact.runtime ?? ''),
        interpreted = Boolean(artifact.sourceFiles?.length) && (artifact.args ?? []).some((arg: unknown) => /\.(?:py|ts|js|mjs)$/.test(String(arg))),
        scope = runtime.startsWith('node:') ? 'External Node executable; not npm delivery' : interpreted || /^(?:python|bun[: ])/i.test(runtime) ? 'External interpreter executable; not compiled tool payload' : 'Compiled executable only; external libraries/resources excluded'
      lines.push(`| ${escape(variant.prepared?.node?.id)} | ${escape(variant.variant)} | ${variant.error || typeof delivery.executableBytes !== 'number' ? 'N/A' : number(delivery.executableBytes / 1024 ** 2, 2)} | ${escape(scope)} |`)
    }
  }
  const reference = selection.referenceCorrection ?? find(run, 'reference-score-result.json') ?? find(join(run, 'pinned-reference-score'), 'reference-score-result.json')
  lines.push('', '## Pinned Mermaid same-case score', '')
  if (admission.referenceCorrection) {
    const evidence = admission.referenceCorrection.evidence
    lines.push(
      `Reviewed positive eligibility: **${evidence.eligibleInputCount} / ${evidence.rawInputCount} retained source inputs** enter this score; **${evidence.diagnosticInputCount} diagnostic-only inputs** still executed and retain replies/clocks in the companion raw and diagnostic artifacts. Eligibility was authored before engine outcomes. Original reference status remains ${escape(admission.referenceCorrection.originalSuiteStatus)}; this is a baseline protocol repair.`,
      '',
    )
  }
  if (reference) {
    const result = readBenchmarkDocument(reference) as { observations: BenchmarkObservation[]; gaps: string[] },
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
    lines.push('| Parser | Portable criteria passed / evaluated per round | All-attempt parse portfolio, ms | Shared-qualified parse portfolio, ms |', '|---|---:|---:|---:|')
    for (const engine of engines) {
      const rows = result.observations.filter(r => r.metrics?.implementation === engine),
        perRoundScores = rounds.map(round => {
          const selected = rows.filter(r => r.metrics?.round === round)
          return `${selected.reduce((n, r) => n + Number(r.metrics?.passed ?? 0), 0)} / ${selected.reduce((n, r) => n + Number(r.metrics?.criteria ?? 0), 0)}`
        }),
        scoreText = new Set(perRoundScores).size === 1 ? `${perRoundScores[0]} (each of ${rounds.length} rounds)` : perRoundScores.map((score, i) => `r${rounds[i]}: ${score}`).join('; ')
      const portfolios = rounds.map(round => {
          const selected = caseIds.map(id => rows.filter(r => r.metrics?.round === round && r.caseId === id))
          return selected.every(rs => rs.length === 1 && timed(rs[0]!)) ? selected.reduce((n, rs) => n + median(rs[0]!.samplesMs!), 0) : undefined
        }),
        matched = rounds.map(round => rows.filter(r => r.metrics?.round === round && shared.includes(r.caseId)).reduce((n, r) => n + median(r.samplesMs!), 0))
      lines.push(`| ${escape(engine)} | ${scoreText} | ${portfolios.length && portfolios.every((v): v is number => v !== undefined) ? number(median(portfolios)) : 'N/A (missing timings)'} | ${shared.length ? number(median(matched)) : '—'} |`)
    }
    lines.push(
      '',
      `${shared.length} identical cases qualified for every engine in every round. All-attempt cost includes failures and must be read alongside scores; shared-qualified cost uses only that fixed common cohort. These public-parser clocks exclude projections and IPC. Historical layout counts are not parser quantities and are explicitly unscored here; complete imported/current grammar and native-operation tests remain separate owning suites.`,
    )
  } else lines.push('Not present in the selected run; this is an explicit gap, not a passing score.')
  const originalInvocation = ledger.suites.find((suite: any) => suite.id === 'invocation')?.result
  const invocationResult = selection.invocationCorrection ? readBenchmarkDocument(selection.invocationCorrection) : originalInvocation
  lines.push(
    '',
    '## Agentic invocation outcomes',
    '',
    `Resolved main profile **${escape(ledger.profile)}**, ${escape(ledger.rounds)} rounds. ${selection.invocationCorrection ? 'Only the explicitly reconciled styles partition uses scoped rerun observations; original outside-partition rows and aggregate ledger remain unchanged.' : 'Uses the original main invocation observations.'} Counts are observations, not exhaustive operation or language-feature coverage.`,
    '',
    '| Runtime | Boundary | Operation | Passed | Failed | Blocked | Unsupported | N/A | Skipped |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|',
  )
  const invocationGroups = new Map<string, BenchmarkObservation[]>()
  for (const row of (invocationResult?.observations ?? []) as BenchmarkObservation[]) {
    const key = [row.runtime, row.surface, row.operation].map(escape).join(' | ')
    invocationGroups.set(key, [...(invocationGroups.get(key) ?? []), row])
  }
  for (const [key, rows] of invocationGroups) lines.push(`| ${key} | ${['passed', 'failed', 'blocked', 'unsupported', 'not-applicable', 'skipped'].map(status => rows.filter(row => row.status === status).length).join(' | ')} |`)
  const familyEvidence = find(join(run, 'family'), 'family-feature-coverage.json')
  if (familyEvidence) {
    const family = readBenchmarkDocument(familyEvidence) as { familyCoverage: { family: string; inputs: number; passed: number; failed: number; advertisedOperations: string[]; observedOperations: string[]; unexercisedOperations: string[] }[] }
    const advertised = family.familyCoverage.reduce((n, f) => n + f.advertisedOperations.length, 0),
      observed = family.familyCoverage.reduce((n, f) => n + f.observedOperations.length, 0)
    lines.push(
      '',
      '## Agentic family functionality and operation witnesses',
      '',
      `Fresh direct-package probes observed **${observed} / ${advertised} advertised family–operation kinds**. The remaining **${advertised - observed}** have no direct generic witness in this run. The separately orchestrated owning tests exercise additional behavior, but their passes are not automatically credited as packed-package operation closure.`,
      '',
      '| Family | Owner inputs | Passed / failed observations | Direct operation kinds / advertised |',
      '|---|---:|---:|---:|',
    )
    for (const f of family.familyCoverage) lines.push(`| ${escape(f.family)} | ${f.inputs} | ${f.passed} / ${f.failed} | ${f.observedOperations.length} / ${f.advertisedOperations.length} |`)
    lines.push('', 'Counts describe fresh executable evidence, not exhaustive language-feature coverage. Historical parser/layout assertions, output envelopes, negative cases and independent rendered-label correspondence retain their separate scopes; not-applicable observations are not failures.')
  }
  if (admission.familyCorrection)
    lines.push(
      '',
      `**Explicit latest family empty-fixture correction:** ${escape(admission.familyCorrection.policy)}. ${admission.familyCorrection.targets.reduce((sum: number, target: any) => sum + target.replacementCount, 0)} independently empty SVG observations across ${admission.familyCorrection.targets.length} targets become unscored N/A using exact fresh evidence. All other original functionality observations and every performance measurement remain unchanged. Manifest: ${escape(admission.familyCorrection.manifest)}.`,
      '',
    )
  for (const [campaignLabel, campaignDirectory] of [
    ['Active PR comparisons', prs],
    ['Historical full PR snapshot', selection.historicalPrs],
  ] as const) {
    if (!campaignDirectory && campaignLabel !== 'Active PR comparisons') continue
    lines.push('', '## ' + campaignLabel, '')
    const prFile = campaignDirectory ? ['pr-ranks.json', 'rankings.json', 'report.json', 'campaign.json'].map(n => join(campaignDirectory, n)).find(existsSync) : undefined
    if (prFile) {
      const pr = readBenchmarkDocument(prFile) as {
        frozenAt?: string
        selectedCoreMetrics?: string[]
        apiOnly?: boolean
        extraCore?: any[]
        measurementConfig?: { core?: { receiptValidation?: string } }
        main?: string
        ranks?: Array<{
          id: string
          label?: string
          head?: string
          integration: string
          draft?: boolean
          sourceEvidence?: string
          buildStatus?: string
          packageGzipBytes?: number
          browserBundleGzipBytes?: number
          coverage?: { suite: string; profile?: string; rounds?: number; status: string; resultPath: string }[]
          metrics: Record<string, { medianMs?: number; pairedRatio?: number; classification?: string; status?: string }>
          metricsByCache?: Record<string, Record<string, { medianMs?: number; pairedRatio?: number; classification?: string; status?: string }>>
        }>
      }
      lines.push(
        `Frozen ${escape(pr.frozenAt)} against main \`${escape(pr.main)}\`. SVG/receipt portfolios use the same six fully consumed artifacts; import and first-SVG retain their distinct worker boundaries. Community plain-API timings above are a different boundary.`,
        '',
        'The result-cache flag is explicit: **0 = result reuse off**, **1 = result reuse enabled**; other artifact/cache defaults remain unchanged. Flag 0 is not a cold process, cold OS cache or fully uncached renderer. Receipt/edit columns use flag 1.',
        '',
        pr.apiOnly
          ? '| Candidate | Frozen head | State | SVG ratio: reuse off (0) | SVG ratio: reuse enabled (1) | SVG receipt ratio (1) | First SVG ratio (1) | Import ratio (1) | npm tarball, KiB | Shipped browser gzip, KiB |'
          : '| Candidate | Frozen head | State | SVG ratio: reuse off (0) | SVG ratio: reuse enabled (1) | SVG receipt ratio (1) | Unicode receipt ratio (1) | Verified edit ratio (1) | npm tarball, KiB | Shipped browser gzip, KiB |',
        '|---|---|---|---:|---:|---:|---:|---:|---:|---:|',
      )
      const ratio = (m: { pairedRatio?: number; classification?: string } | undefined) => (typeof m?.pairedRatio !== 'number' || !Number.isFinite(m.pairedRatio) ? 'N/A' : number(m.pairedRatio, 3) + '×' + (m.classification?.includes('variation') ? ' (tie)' : ''))
      lines.splice(
        lines.length - 2,
        0,
        `Receipt assertion boundary: ${escape(pr.measurementConfig?.core?.receiptValidation ?? 'includes-external-receipt-validation (historical worker)')}. Historical and latest receipt clocks have different assertion boundaries, so these separate snapshots do not establish a direct product cost trend. Family functionality runs once; historical rounds3 metadata records a request, not three executed functionality passes.`,
        '',
      )
      if (pr.apiOnly)
        lines.splice(
          lines.length - 2,
          0,
          `Focused API-only campaign. Selected metrics: ${escape(pr.selectedCoreMetrics?.join(', '))}. Omitted terminal/edit/PNG metrics and broad invocation suites were not executed; no full thirteen-metric comparison is implied. Family functionality executes one pass; three performance rounds were requested separately. Historical family metadata also requested three rounds but did not repeat functionality checks.`,
          '',
        )
      for (const r of [...(pr.ranks ?? [])].sort((a, b) => (a.metrics.svg?.pairedRatio ?? Infinity) - (b.metrics.svg?.pairedRatio ?? Infinity))) {
        const exploratory = ['conflicting-head', 'branch-base'].includes(r.integration)
        lines.push(
          `| ${escape(r.label ?? r.id)} | \`${escape(r.head?.slice(0, 12))}\` | ${escape(r.integration)}${r.draft ? ' · draft' : ''}${r.sourceEvidence && r.sourceEvidence !== r.id ? ' · evidence ' + escape(r.sourceEvidence) : ''} | ${exploratory ? 'Exploratory' : ratio(r.metricsByCache?.['0']?.svg)} | ${exploratory ? 'Exploratory' : ratio(r.metricsByCache?.['1']?.svg ?? r.metrics.svg)} | ${exploratory ? 'Exploratory' : ratio(r.metrics.svgReceipt)} | ${exploratory ? 'Exploratory' : ratio(pr.apiOnly ? r.metrics.firstSvg : r.metrics.unicodeReceipt)} | ${exploratory ? 'Exploratory' : ratio(pr.apiOnly ? r.metrics.import : r.metrics.agent)} | ${r.packageGzipBytes ? number(r.packageGzipBytes / 1024, 1) : 'N/A'} | ${r.browserBundleGzipBytes ? number(r.browserBundleGzipBytes / 1024, 1) : 'N/A'} |`,
        )
      }
      if (pr.extraCore?.length) {
        lines.push('', '### Supplemental cases outside the six-core aggregate', '', '| Candidate | State | Case | Metric | Result reuse flag | Status | Paired ratio |', '|---|---|---|---|---:|---|---:|')
        for (const row of pr.extraCore) lines.push(`| ${escape(row.target)} | ${escape(row.integration)} | ${escape(row.caseId)} | ${escape(row.metric)} | ${escape(row.cache)} | ${escape(row.status)} | ${ratio(row)} |`)
        lines.push('', 'These separately paired source cases can reveal work hidden by the common core. They do not change its cohort, denominator or aggregate stack rank.')
      }
      lines.push(
        '',
        '### Candidate functionality and editor delivery',
        '',
        'Lifecycle and invocation counts describe their own checks; they are not portable-parser fidelity scores. N/A observations are excluded from the scored denominator. Initial editor bytes are an observed requested-file closure compressed with gzip, distinct from the complete shipped IIFE.',
        '',
        '| Candidate | Family lifecycle passed / scored | Invocation passed / scored | Invocation profile / rounds | Initial editor gzip, KiB | Through-family editor gzip, KiB |',
        '|---|---:|---:|---|---:|---:|',
      )
      for (const r of pr.ranks ?? []) {
        const load = (suite: string) => {
          const entry = r.coverage?.find(c => c.suite === suite)
          if (!entry?.resultPath || !existsSync(entry.resultPath)) return undefined
          const correction = admission.familyCorrection?.targets.find((target: any) => realpathSync(target.originalResultPath) === realpathSync(entry.resultPath))
          return readBenchmarkDocument(correction?.correctedResultPath ?? entry.resultPath) as { observations: BenchmarkObservation[] }
        }
        const count = (suite: string) => {
          const result = load(suite)
          if (!result) return 'Not selected / unavailable'
          const harness = result.observations.filter(row => String(row.detail ?? '').includes('Strict SVG XML qualification requires the saxes benchmark dependency'))
          const scored = result.observations.filter(row => row.status !== 'not-applicable' && row.status !== 'skipped' && !harness.includes(row))
          return `${scored.filter(row => row.status === 'passed').length} / ${scored.length}${harness.length ? '; ' + harness.length + ' harness-blocked/unscored' : ''}`
        }
        const invocation = load('invocation'),
          configuration = r.coverage?.find(c => c.suite === 'invocation'),
          delivery = invocation?.observations.filter(row => row.surface === 'browser:editor' && row.operation === 'download-closure' && row.status === 'passed') ?? []
        const payload = (key: string) => {
          const values = delivery.map(row => row.metrics?.[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
          return values.length ? number(median(values) / 1024, 1) : 'N/A'
        }
        lines.push(`| ${escape(r.label ?? r.id)} [${escape(r.id)} · ${escape(r.integration)} · ${escape(r.head?.slice(0, 12))}] | ${count('family')} | ${count('invocation')} | ${escape(configuration?.profile)} / ${configuration?.rounds ?? '—'} | ${payload('initialGzipBytes')} | ${payload('gzipBytes')} |`)
      }
      lines.push('', `Full per-metric rows, fresh bracketing controls, broad family/invocation results and artifact identities: [PR campaign evidence](${escape(relative(dirname(output), prFile))}). Source-conflicting heads and own bases stay exploratory; no merge readiness is implied.`)
    } else lines.push('No PR campaign supplied to this snapshot. Refresh with `--prs` after running `bench:prs`; historical PR scores are not relabeled as current.')
  }
  lines.push(
    '',
    '## Original suite ledger',
    '',
    'Original statuses and clocks remain the source of truth for the complete orchestration. Scoped protocol repairs above do not turn this into a newly passing full run. Owning test counts refer to actual independent process summaries, not stored witness metadata.',
    '',
    '| Suite | Status | Complete wall time, s | Owning tests pass / fail / skip |',
    '|---|---|---:|---|',
  )
  for (const suite of ledger.suites) {
    const score = suite.result?.observations?.find((row: BenchmarkObservation) => row.operation === 'owning-tests')?.metrics
    lines.push(`| ${escape(suite.id)} | ${escape(suite.status)} | ${typeof suite.elapsedMs === 'number' ? number(suite.elapsedMs / 1000, 1) : 'N/A'} | ${score ? `${escape(score.passed)} / ${escape(score.failed)} / ${escape(score.skipped)}` : 'N/A'} |`)
  }
  if (admission.currentRun && selection.currentRun) {
    const current = admission.currentRun
    const dave = readBenchmarkDocument(join(selection.currentRun, 'dave/browser-report.json'))
    const reference = readBenchmarkDocument(current.reference.resultFile) as { observations: BenchmarkObservation[] }
    lines.push(
      '',
      '## Separate current-main Dave and parser evidence',
      '',
      `Target \`${escape(current.targetRevision)}\`, measured **${escape(current.startedAt)} → ${escape(current.finishedAt)}**. Actual candidate tarball SHA256: \`${escape(current.candidateSha256)}\`. This supplemental run does not relabel the original full suite ledger or its older-target corrections.`,
      '',
      '### Dave exact pinned corpus',
      '',
      'All 1095 original source occurrences, unchanged browser and clock policy, three rounds. Complete attempt costs include failures and cannot reward fast rejection. Actual comparator versions are read from admitted identities and must agree throughout this comparison set.',
      '',
      '| Implementation | Version | Accepted / 1095 | Median complete attempt portfolio, ms |',
      '|---|---|---:|---:|',
    )
    for (const engine of dave.engines) {
      const identity = dave.identities.find((row: any) => row.label === engine.label)
      const values = engine.attemptMs as number[]
      lines.push(`| ${escape(engine.label)} | ${escape(identity?.version)} | ${engine.accepted} / ${engine.population} | ${values.length === 3 && values.every(v => Number.isFinite(v) && v > 0) ? number(median(values)) : 'N/A'} |`)
    }
    lines.push('', '| Comparator | Shared-success inputs | Agentic / comparator cost |', '|---|---:|---:|')
    for (const row of dave.matched) lines.push(`| ${escape(row.comparator)} | ${row.inputIds.length} | ${number(median(row.candidateMs.map((value: number, i: number) => value / row.comparatorMs[i])), 3)}× |`)
    lines.push(
      '',
      'Each comparator has its own exact shared-success cohort; ratios below 1 favor Agentic. No common overall cross-tool rank is inferred.',
      '',
      '### Current target on the same pinned parser positives',
      '',
      `${current.reference.eligibleInputCount} eligible positives; all ${current.reference.rawInputCount} raw sources retained, including ${current.reference.diagnosticInputCount} diagnostic-only cases. Identical literal sources, independently expected criteria, reviewed eligibility and Mermaid/parser/DOM pins are verified against original frozen evidence.`,
      '',
      '| Parser | Portable criteria passed / evaluated per round | Shared-qualified cases | Shared-qualified parse portfolio, ms |',
      '|---|---:|---:|---:|',
    )
    const rows = reference.observations
    const engines = [...new Set(rows.map(row => String(row.metrics?.implementation)))]
    const rounds = [...new Set(rows.map(row => Number(row.metrics?.round)))].sort()
    const ids = [...new Set(rows.map(row => row.caseId))]
    const shared = ids.filter(id =>
      engines.every(engine =>
        rounds.every(round => {
          const values = rows.filter(row => row.caseId === id && row.metrics?.implementation === engine && row.metrics?.round === round)
          return values.length === 1 && values[0]!.status === 'passed' && timed(values[0]!)
        }),
      ),
    )
    for (const engine of engines) {
      const own = rows.filter(row => row.metrics?.implementation === engine)
      const scores = rounds.map(round => {
        const selected = own.filter(row => row.metrics?.round === round)
        return `${selected.reduce((sum, row) => sum + Number(row.metrics?.passed ?? 0), 0)} / ${selected.reduce((sum, row) => sum + Number(row.metrics?.criteria ?? 0), 0)}`
      })
      const costs = rounds.map(round => own.filter(row => row.metrics?.round === round && shared.includes(row.caseId)).reduce((sum, row) => sum + median(row.samplesMs!), 0))
      lines.push(`| ${escape(engine)} | ${new Set(scores).size === 1 ? `${scores[0]} (each of ${rounds.length} rounds)` : scores.join('; ')} | ${shared.length} | ${shared.length ? number(median(costs)) : 'N/A'} |`)
    }
    lines.push('', 'Parser clocks exclude semantic projections, assertions and transport. Shared-success cost requires both engines in every round; unscored historical layout counts and diagnostic-only cases are excluded. The old-target baseline repair and the actual current product are separate measurements.')
  }
  if (admission.additionalRun && selection.additionalRun) {
    const extra = admission.additionalRun
    lines.push(
      '',
      '## Additional maintained target-owned suites',
      '',
      `Completed ${escape(extra.startedAt)} → ${escape(extra.finishedAt)} against \`${escape(extra.targetRevision)}\`, archive SHA256 \`${escape(extra.candidateSha256)}\`. Actual owning source Git objects are verified. This separate ledger does not merge ranks, overwrite original statuses or relabel other suites as current.`,
      `Actual qualification status: **${escape(extra.qualificationStatus)}**. ${escape(extra.qualificationPolicy)} Actual baseline ${escape(extra.baseline.version)} at ${escape(extra.baseline.revision)}, SHA256 ${escape(extra.baseline.sha256)}. The historical anchor constant does not identify this supplied baseline.`,
      '',
      '| Suite | Status | Complete wall time, s | Owning source Git blob | Observations passed / failed / blocked / N/A |',
      '|---|---|---:|---|---|',
    )
    for (const suite of extra.suites)
      lines.push(
        `| ${escape(suite.id)} | ${escape(suite.status)} | ${typeof suite.elapsedMs === 'number' ? number(suite.elapsedMs / 1000, 1) : 'N/A'} | \`${escape(suite.sourceGitBlob)}\` | ${['passed', 'failed', 'blocked', 'not-applicable'].map(status => suite.observations.filter((row: any) => row.status === status).length).join(' / ')} |`,
      )
    for (const suite of extra.suites) {
      if (suite.qualification)
        lines.push(
          '',
          `Owning status **${escape(suite.qualification.status)}**, complete=${escape(suite.qualification.complete)}, performanceQualified=${escape(suite.gates?.performanceQualified)}; original outer ledger status ${escape(suite.recordedStatus)} is retained. A completed process is not calibrated qualification.`,
        )
      const gates = suite.observations.filter((row: any) => row.operation === 'qualification-status')
      if (gates.length) lines.push('', `Actual qualification/completion evidence for **${escape(suite.id)}**:`, '', '```json', JSON.stringify(gates, null, 2), '```')
      if (suite.prerequisites?.length || suite.gaps?.length) lines.push('', ...[...(suite.prerequisites ?? []), ...(suite.gaps ?? [])].map((gap: unknown) => `- ${escape(gap)}`))
    }
    lines.push('', `Full owning reports, gates and artifacts: [additional suite ledger](${escape(relative(dirname(output), join(selection.additionalRun, 'report.md')))}). Missing or insufficient qualification stays explicit; process completion alone is not a passing gate.`)
  }
  if (admission.currentInvocationRun) {
    const latest = admission.currentInvocationRun
    if (latest.daveDisplayCorrection)
      lines.push(
        '',
        `**Explicit latest Dave display correction:** ${escape(latest.daveDisplayCorrection.policy)} Original status ${escape(latest.daveDisplayCorrection.originalStatus)} at ${escape(latest.daveDisplayCorrection.originalDirectory)}; fresh Dave evidence ${escape(latest.daveDisplayCorrection.replacementDirectory)}.`,
        '',
      )
    lines.push(
      '',
      '## Independent latest invocation: ' + latest.attemptCensus.completeness,
      '',
      `Target ${escape(latest.targetRevision)}; ${escape(latest.startedAt)} → ${escape(latest.finishedAt)}, full profile / three rounds. Actual target archive SHA256 ${escape(latest.candidateSha256)}. ${escape(latest.policy)}`,
      '',
      '| Representative inputs | Observations | Passed | Failed | Blocked | N/A | Result |',
      '|---:|---:|---:|---:|---:|---:|---|',
      `| ${latest.representativeCases} | ${latest.observations} | ${latest.counts.passed ?? 0} | ${latest.counts.failed ?? 0} | ${latest.counts.blocked ?? 0} | ${latest.counts['not-applicable'] ?? 0} | ${escape(latest.resultStatus)} |`,
      '',
      `Actual repaired library XML qualifier: ${escape(latest.qualificationDependencies.nodeXmlParser.name)} ${escape(latest.qualificationDependencies.nodeXmlParser.version)}. This latest target is independent from the older community/Dave/parser snapshots and original corrected invocation counts. Raw evidence: ${escape(latest.resultFile)}.`,
    )
  }
  if (admission.currentInvocationRun) {
    const latest = admission.currentInvocationRun
    lines.push(
      '',
      `Actual execution census: **${escape(latest.attemptCensus.completeness)}**. ${escape(latest.attemptCensus.scope)} Public function exports without direct operation witnesses remain explicitly unmeasured: ${latest.attemptCensus.publicFunctionsWithoutDirectWitness.length} export/runtime/round groups; full names are retained in admitted chart data.`,
      '',
      ...latest.attemptCensus.gaps.map((gap: unknown) => `- ${escape(gap)}`),
    )
    lines.push(
      '',
      `Separately built native/site source proof: ${escape(latest.assetsProof.file)}. Native executable SHA256 ${escape(latest.assetsProof.native.sha256)}; ${latest.assetsProof.websiteFiles} admitted built website files. npm archive identity alone does not identify the compiled executable.`,
      '',
      '### Latest pinned Dave and parser evidence',
      '',
      '| Dave engine | Accepted / identical occurrences | Median full attempt cost, ms |',
      '|---|---:|---:|',
    )
    const dave = readBenchmarkDocument(latest.daveFile)
    for (const engine of dave.engines) lines.push(`| ${escape(engine.label)} | ${engine.accepted} / ${engine.population} | ${number(median(engine.attemptMs))} |`)
    lines.push('', '| Dave matched comparator | Identical shared-qualified occurrences | Candidate / comparator median ratio |', '|---|---:|---:|')
    for (const row of dave.matched ?? []) lines.push(`| ${escape(row.comparator)} | ${row.inputIds?.length ?? 'N/A'} | ${number(row.medianRatio, 3)}× |`)
    lines.push(
      '',
      'Dave attempt costs include each engine’s own accepted/rejected workload. Only matched-pair portfolios support a speed ratio. Actual tool versions must agree across the admitted comparison set; clocks and public boundaries remain separate.',
      '',
      '| Parser | Portable criteria passed / scored in each round | Eligible positive cases |',
      '|---|---|---:|',
    )
    const reference = readBenchmarkDocument(latest.referenceScore.resultFile) as { observations: BenchmarkObservation[] }
    const rounds = [...new Set(reference.observations.map(row => Number(row.metrics?.round)))].sort()
    const engines = [...new Set(reference.observations.map(row => String(row.metrics?.implementation)))]
    const cases = [...new Set(reference.observations.map(row => row.caseId))]
    const shared = cases.filter(id => engines.every(engine => rounds.every(round => reference.observations.some(row => row.caseId === id && row.metrics?.implementation === engine && row.metrics?.round === round && row.status === 'passed' && row.samplesMs?.length))))
    for (const engine of engines) {
      const scored = rounds.map(round => {
        const rows = reference.observations.filter(row => row.metrics?.implementation === engine && row.metrics?.round === round)
        return `${rows.reduce((sum, row) => sum + Number(row.metrics?.passed ?? 0), 0)} / ${rows.reduce((sum, row) => sum + Number(row.metrics?.criteria ?? 0), 0)}`
      })
      lines.push(`| ${escape(engine)} | ${scored.join('; ')} | ${latest.referenceScore.evidence.eligibleInputCount} |`)
    }
    lines.push('', `Shared-qualified parser cohort: ${shared.length} identical positive cases, both engines and every round.`, '', '| Parser | Median public parse portfolio, ms |', '|---|---:|')
    for (const engine of engines) {
      const costs = rounds.map(round => reference.observations.filter(row => row.metrics?.implementation === engine && row.metrics?.round === round && shared.includes(row.caseId)).reduce((sum, row) => sum + median(row.samplesMs!), 0))
      lines.push(`| ${escape(engine)} | ${shared.length ? number(median(costs)) : 'N/A'} |`)
    }
    lines.push(
      '',
      `Retained raw inputs ${latest.referenceScore.evidence.rawInputCount}; reviewed diagnostics ${latest.referenceScore.evidence.diagnosticInputCount} remain outside positive scoring. Current Mermaid reference ${escape(latest.referenceScore.evidence.currentReference.version)} at ${escape(latest.referenceScore.evidence.currentReference.commit)}. Imported historical fixture pins remain separate. Parser timing uses shared-qualified cases separately from assertions/semantic scoring; see the latest standalone charts and raw result.`,
    )
  }
  if (admission.suiteRuns?.length) {
    lines.push(
      '',
      '## Independent owning and environment corrections',
      '',
      'These ledgers preserve their actual driver/target revision, fixture scope, statuses and process wall times. They do not overwrite the original suite ledger or change comparative ranks.',
      '',
      '| Suite | Driver revision | Target revision | Status | Process wall, s | Owning tests pass / fail / skip |',
      '|---|---|---|---|---:|---|',
    )
    for (const extra of admission.suiteRuns) {
      for (const suite of extra.suites) {
        const counts = suite.owningTests?.[0]
        lines.push(
          `| ${escape(suite.id)} | ${escape(extra.driverRevision)}${extra.driverDirty ? ' (dirty harness recorded)' : ''} | ${escape(extra.targetRevision)} | ${escape(suite.status)} | ${number(suite.elapsedMs / 1000, 1)} | ${counts ? `${escape(counts.passed)} / ${escape(counts.failed)} / ${escape(counts.skipped)}` : 'N/A'} |`,
        )
      }
      if (extra.fixture) lines.push('', `Frozen ownership fixture: ${escape(extra.fixture.directory)}. ${escape(extra.fixture.scope)}. Page artifact identities remain in the admitted report metadata.`)
      lines.push('', `Raw independent ledger: ${escape(extra.directory)}; ${escape(extra.startedAt)} → ${escape(extra.finishedAt)}.`)
    }
  }
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
  updateCommunityScorecard(a.get('--run')!, a.get('--output') ?? resolve('docs/community-benchmark-ranking.md'), a.get('--prs'), {
    communityRun: a.get('--community-run'),
    invocationCorrection: a.get('--invocation-correction'),
    referenceCorrection: a.get('--reference-correction'),
    allowCommunityTargetChange: a.get('--allow-community-target-change') === 'true',
    currentRun: a.get('--current-run'),
    additionalRun: a.get('--additional-run'),
    cliNativeProof: a.get('--cli-native-proof'),
    historicalPrs: a.get('--historical-prs'),
    currentInvocationRun: a.get('--current-invocation-run'),
    currentInvocationAssets: a.get('--current-invocation-assets'),
    currentDaveRun: a.get('--current-dave-run'),
    familyCorrection: a.get('--family-correction'),
    cliResourceRun: a.get('--cli-resource-run'),
    suiteRuns: JSON.parse(a.get('--suite-run') ?? '[]'),
  })
}
