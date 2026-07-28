import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { stableDigest } from './prepare-skill-evidence.ts'
import type { ExecutionReceipt } from './run-codex-evidence.ts'

interface ResultRow {
  case_id: string
  variant: 'with_skill' | 'without_skill'
  run_number: number
  kind: string
  domain: string
  difficulty: string
  trigger_type: string
  objective_pass_rate: number | null
  missing_output: boolean
  run_base: string
  deferred_judge_tasks?: number
  metadata?: Record<string, unknown>
}

interface BenchmarkReport {
  results: ResultRow[]
}
interface Pricing {
  input: number
  cachedInput: number
  output: number
  source: string
  checkedAt: string
}
interface ComparisonPolicy {
  baseline: string
  candidate: string
  design?: string
  requireSameWorkspace?: boolean
  requireSameFixtures?: boolean
  requireSameStimuli?: boolean
  requireSameSchedule?: boolean
  requireSameTreatmentPaths?: boolean
  requireDifferentTreatments?: boolean
  requireSameManifest?: boolean
}
interface Cohort {
  comparison: ComparisonPolicy
  behavior: { cases: string[]; minimumRunsPerVariant: number; releaseRunsPerVariant?: number }
  executor: Record<string, unknown>
  pricingUsdPerMillionTokens: Pricing
}

interface Usage {
  input: number
  cachedInput: number
  output: number
}
interface ManifestDigests {
  baseline: string
  candidate: string
}
interface PreparationReceipt {
  workspaceRoot: string
  workspaceDigest: string
  fixtureDigest: string
  treatmentDigest: string
  stimulusDigest: string
  scheduleDigest: string
  treatmentPaths: string[]
  taskCount: number
  preparedTasksDigest: string
}
interface PreparationReceipts {
  baseline: PreparationReceipt
  candidate: PreparationReceipt
}
interface PreparedTaskDigests {
  baseline: string
  candidate: string
}
interface OutputMaterializationReceipt {
  schemaVersion: number
  runsRoot: string
  traceCount: number
  materializedCount: number
  alreadyCompleteCount: number
  traceDigest: string
  outputDigest: string
  harnessOutputDigest: string
  execution: {
    receiptDigest: string
    receipt: ExecutionReceipt
  }
  runs: Array<{
    runDir: string
    materialized: boolean
    traceDigest: string
    outputDigest: string
    harnessOutputDigest: string
  }>
}
interface OutputMaterializationReceipts {
  baseline: OutputMaterializationReceipt
  candidate: OutputMaterializationReceipt
}
interface RunRootOverrides {
  baseline: string
  candidate: string
}
export type EvidenceProfile = 'iteration' | 'release'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? null
}

function usageFromTrace(runBase: string): Usage {
  const path = join(runBase, 'trace.jsonl')
  const usage: Usage = { input: 0, cachedInput: 0, output: 0 }
  if (!existsSync(path)) return usage
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const child of value) visit(child)
        return
      }
      if (!value || typeof value !== 'object') return
      const object = value as Record<string, unknown>
      const input = object.input_tokens ?? object.prompt_tokens
      const cached = object.cached_input_tokens ?? object.cached_tokens
      const output = object.output_tokens ?? object.completion_tokens
      if (typeof input === 'number') usage.input = Math.max(usage.input, input)
      if (typeof cached === 'number') usage.cachedInput = Math.max(usage.cachedInput, cached)
      if (typeof output === 'number') usage.output = Math.max(usage.output, output)
      for (const child of Object.values(object)) visit(child)
    }
    visit(record)
  }
  return usage
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function difference(after: number | null, before: number | null): number | null {
  return after === null || before === null ? null : after - before
}

export function manifestDigest(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

function fileDigest(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

function treeDigest(paths: string[], root: string): string {
  const hash = createHash('sha256')
  for (const path of [...paths].sort()) hash.update(relative(root, path)).update('\0').update(readFileSync(path)).update('\0')
  return `sha256:${hash.digest('hex')}`
}

function compareCodePointStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function harnessRecordDigest(records: OutputMaterializationReceipt['runs']): string {
  const hash = createHash('sha256')
  for (const record of [...records].sort((left, right) => compareCodePointStrings(left.runDir, right.runDir))) {
    hash.update(record.runDir).update('\0').update(record.harnessOutputDigest).update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function runsPerVariant(cohort: Cohort, profile: EvidenceProfile): number {
  if (profile === 'iteration') return cohort.behavior.minimumRunsPerVariant
  const runs = cohort.behavior.releaseRunsPerVariant
  if (!Number.isInteger(runs) || (runs ?? 0) < cohort.behavior.minimumRunsPerVariant) {
    throw new Error('release profile requires releaseRunsPerVariant >= minimumRunsPerVariant')
  }
  return runs!
}

function summarizeRows(rows: ResultRow[], pricing: Pricing): object {
  const usage = rows.map(row => usageFromTrace(row.run_base))
  const elapsed = rows.map(row => Number(row.metadata?.elapsed_ms)).filter(Number.isFinite)
  const input = usage.reduce((sum, value) => sum + value.input, 0)
  const cachedInput = usage.reduce((sum, value) => sum + value.cachedInput, 0)
  const output = usage.reduce((sum, value) => sum + value.output, 0)
  const uncachedInput = Math.max(0, input - cachedInput)
  return {
    runs: rows.length,
    missingOutputs: rows.filter(row => row.missing_output).length,
    timeouts: rows.filter(row => row.metadata?.timeout === true).length,
    meanObjectivePassRate: mean(rows.map(row => row.objective_pass_rate).filter((value): value is number => typeof value === 'number')),
    allGradedAssertionsPassRate: mean(rows.map(row => (row.objective_pass_rate === 1 ? 1 : 0))),
    deferredSemanticJudgeRows: rows.filter(row => (row.deferred_judge_tasks ?? 0) > 0).length,
    latencyMs: { median: quantile(elapsed, 0.5), p95: quantile(elapsed, 0.95) },
    tokens: { input, cachedInput, uncachedInput, output },
    estimatedCostUsd: (uncachedInput * pricing.input + cachedInput * pricing.cachedInput + output * pricing.output) / 1_000_000,
  }
}

function summarizeOne(report: BenchmarkReport, cohort: Cohort, repetitions: number): object {
  const selected = new Set(cohort.behavior.cases)
  const rows = report.results.filter(row => selected.has(row.case_id))
  const expected = cohort.behavior.cases.length * 2 * repetitions
  if (rows.length !== expected) throw new Error(`expected ${expected} cohort results, found ${rows.length}`)
  const expectedKeys = new Set<string>()
  for (const caseId of cohort.behavior.cases) {
    for (const variant of ['with_skill', 'without_skill']) {
      for (let run = 1; run <= repetitions; run++) expectedKeys.add(`${caseId}/${variant}/${run}`)
    }
  }
  const actualKeys = rows.map(row => `${row.case_id}/${row.variant}/${row.run_number}`)
  if (new Set(actualKeys).size !== actualKeys.length) throw new Error('cohort contains duplicate case/variant/run rows')
  const unexpected = actualKeys.filter(key => !expectedKeys.has(key))
  const missing = [...expectedKeys].filter(key => !actualKeys.includes(key))
  if (unexpected.length || missing.length) throw new Error(`cohort run matrix mismatch; missing=${missing.join(',') || 'none'} unexpected=${unexpected.join(',') || 'none'}`)
  if (rows.some(row => row.missing_output)) throw new Error('cohort contains missing outputs')
  if (rows.some(row => row.metadata?.timeout === true)) throw new Error('cohort contains timeouts')
  if (rows.some(row => typeof row.objective_pass_rate !== 'number')) throw new Error('cohort contains ungraded objective rates')
  const variants = Object.fromEntries(
    (['with_skill', 'without_skill'] as const).map(variant => [
      variant,
      summarizeRows(
        rows.filter(row => row.variant === variant),
        cohort.pricingUsdPerMillionTokens,
      ),
    ]),
  )
  const slices: Record<string, unknown> = {}
  for (const field of ['case_id', 'domain', 'difficulty', 'trigger_type'] as const) {
    slices[field] = Object.fromEntries(
      [...new Set(rows.map(row => row[field]))].sort().map(value => [
        value,
        Object.fromEntries(
          (['with_skill', 'without_skill'] as const).map(variant => [
            variant,
            summarizeRows(
              rows.filter(row => row[field] === value && row.variant === variant),
              cohort.pricingUsdPerMillionTokens,
            ),
          ]),
        ),
      ]),
    )
  }
  const withSkillRate = (variants.with_skill as { meanObjectivePassRate: number | null }).meanObjectivePassRate
  const withoutSkillRate = (variants.without_skill as { meanObjectivePassRate: number | null }).meanObjectivePassRate
  const withSkillAllGraded = (variants.with_skill as { allGradedAssertionsPassRate: number | null }).allGradedAssertionsPassRate
  const withoutSkillAllGraded = (variants.without_skill as { allGradedAssertionsPassRate: number | null }).allGradedAssertionsPassRate
  const absolute = withSkillRate === null || withoutSkillRate === null ? null : withSkillRate - withoutSkillRate
  const headroom = withoutSkillRate === null ? null : 1 - withoutSkillRate
  const normalized = absolute === null || headroom === null ? null : headroom > 0 ? absolute / headroom : absolute === 0 ? 0 : null
  const allGradedAssertionsAbsolute = withSkillAllGraded === null || withoutSkillAllGraded === null ? null : withSkillAllGraded - withoutSkillAllGraded
  const allGradedAssertionsHeadroom = withoutSkillAllGraded === null ? null : 1 - withoutSkillAllGraded
  const allGradedAssertionsNormalized = allGradedAssertionsAbsolute === null || allGradedAssertionsHeadroom === null ? null : allGradedAssertionsHeadroom > 0 ? allGradedAssertionsAbsolute / allGradedAssertionsHeadroom : allGradedAssertionsAbsolute === 0 ? 0 : null
  return {
    variants,
    treatmentGain: { absolute, normalized, allGradedAssertionsAbsolute, allGradedAssertionsNormalized },
    slices,
    imperfectPositiveRows: rows.filter(row => row.variant === 'with_skill' && row.kind !== 'negative' && (row.objective_pass_rate ?? 0) < 1).map(row => ({ case_id: row.case_id, variant: row.variant, run: row.run_number, passRate: row.objective_pass_rate })),
    negativeBehaviorViolations: rows.filter(row => row.variant === 'with_skill' && row.kind === 'negative' && (row.objective_pass_rate ?? 0) < 1).map(row => ({ case_id: row.case_id, variant: row.variant, run: row.run_number, passRate: row.objective_pass_rate })),
  }
}

function causalChecks(policy: ComparisonPolicy, manifests?: ManifestDigests, receipts?: PreparationReceipts): Record<string, boolean | null> {
  const checks = {
    sameWorkspace: receipts ? receipts.baseline.workspaceRoot === receipts.candidate.workspaceRoot && receipts.baseline.workspaceDigest === receipts.candidate.workspaceDigest : null,
    sameFixtures: receipts ? receipts.baseline.fixtureDigest === receipts.candidate.fixtureDigest : null,
    sameStimuli: receipts ? receipts.baseline.stimulusDigest === receipts.candidate.stimulusDigest : null,
    sameSchedule: receipts ? receipts.baseline.scheduleDigest === receipts.candidate.scheduleDigest : null,
    sameTreatmentPaths: receipts ? JSON.stringify(receipts.baseline.treatmentPaths) === JSON.stringify(receipts.candidate.treatmentPaths) : null,
    differentTreatments: receipts ? receipts.baseline.treatmentDigest !== receipts.candidate.treatmentDigest : null,
    sameManifest: manifests ? manifests.baseline === manifests.candidate : null,
  }
  const required: Array<[boolean | undefined, keyof typeof checks]> = [
    [policy.requireSameWorkspace, 'sameWorkspace'],
    [policy.requireSameFixtures, 'sameFixtures'],
    [policy.requireSameStimuli, 'sameStimuli'],
    [policy.requireSameSchedule, 'sameSchedule'],
    [policy.requireSameTreatmentPaths, 'sameTreatmentPaths'],
    [policy.requireDifferentTreatments, 'differentTreatments'],
    [policy.requireSameManifest, 'sameManifest'],
  ]
  for (const [enabled, name] of required) {
    if (!enabled) continue
    if (checks[name] === null) throw new Error(`causal comparison requires evidence for ${name}`)
    if (checks[name] !== true) throw new Error(`causal comparison failed ${name}`)
  }
  if (receipts && receipts.baseline.taskCount !== receipts.candidate.taskCount) throw new Error('causal comparison has different prepared task counts')
  return checks
}

function validatePreparationReceipts(receipts: PreparationReceipts | undefined, taskDigests: PreparedTaskDigests | undefined): void {
  if (!receipts && !taskDigests) return
  if (!receipts || !taskDigests) throw new Error('preparation receipts and prepared task digests must be supplied together')
  for (const name of ['baseline', 'candidate'] as const) {
    if (receipts[name].preparedTasksDigest !== taskDigests[name]) {
      throw new Error(`${name} preparation receipt does not match prepared tasks`)
    }
  }
}

function validateOutputReceipts(receipts: OutputMaterializationReceipts | undefined, reports: { baseline: BenchmarkReport; candidate: BenchmarkReport }, selectedCases: Set<string>, expectedRuns: number, cohort: Cohort, preparationReceipts?: PreparationReceipts, runRootOverrides?: RunRootOverrides): void {
  if (!receipts) return
  for (const name of ['baseline', 'candidate'] as const) {
    const receipt = receipts[name]
    const rows = reports[name].results.filter(row => selectedCases.has(row.case_id))
    if (receipt.schemaVersion !== 2) throw new Error(`${name} output receipt must use schemaVersion 2`)
    if (receipt.traceCount !== expectedRuns) throw new Error(`${name} output receipt expected ${expectedRuns} traces, found ${receipt.traceCount}`)
    if (receipt.materializedCount + receipt.alreadyCompleteCount !== receipt.traceCount) throw new Error(`${name} output receipt has inconsistent counts`)
    if (receipt.runs.length !== expectedRuns) throw new Error(`${name} output receipt expected ${expectedRuns} run records, found ${receipt.runs.length}`)
    if (new Set(receipt.runs.map(run => run.runDir)).size !== receipt.runs.length) throw new Error(`${name} output receipt has duplicate run records`)
    for (const field of ['traceDigest', 'outputDigest', 'harnessOutputDigest'] as const) {
      if (!/^sha256:[0-9a-f]{64}$/.test(receipt[field])) throw new Error(`${name} output receipt has invalid ${field}`)
    }
    const root = resolve(receipt.runsRoot)
    const filesRoot = resolve(runRootOverrides?.[name] ?? root)
    const reportRoot = runRootOverrides ? filesRoot : root
    const execution = receipt.execution
    if (!execution || execution.receiptDigest !== stableDigest(execution.receipt)) throw new Error(`${name} output receipt has an invalid execution receipt digest`)
    if (execution.receipt.exitCode !== 0) throw new Error(`${name} execution receipt records a failed runner`)
    if (execution.receipt.schemaVersion >= 2) {
      const taskResults = execution.receipt.taskResults
      if (!taskResults || taskResults.failures.length > 0 || taskResults.completeCount !== taskResults.expectedCount) {
        throw new Error(`${name} execution receipt records incomplete task results`)
      }
    }
    if (resolve(execution.receipt.runsRoot) !== root) throw new Error(`${name} execution receipt runsRoot mismatch`)
    if (preparationReceipts && execution.receipt.tasksDigest !== preparationReceipts[name].preparedTasksDigest) {
      throw new Error(`${name} execution receipt does not match prepared tasks`)
    }
    const activeProfile = typeof cohort.executor.activeProfile === 'string' ? cohort.executor.activeProfile : undefined
    const profiles = cohort.executor.profiles && typeof cohort.executor.profiles === 'object' ? (cohort.executor.profiles as Record<string, Record<string, unknown>>) : undefined
    const expectedModel = activeProfile ? profiles?.[activeProfile]?.model : cohort.executor.model
    for (const [field, expected] of [
      ['runner', cohort.executor.runner],
      ['runnerVersion', cohort.executor.runnerVersion],
      ['model', expectedModel],
      ['reasoningEffort', cohort.executor.reasoningEffort],
    ] as const) {
      if (typeof expected === 'string' && execution.receipt[field] !== expected) {
        throw new Error(`${name} execution receipt ${field} does not match cohort executor`)
      }
    }
    const expectedRunDirs = new Set<string>()
    for (const row of rows) {
      const runBase = resolve(row.run_base)
      const runDir = relative(reportRoot, runBase)
      if (!runDir || runDir === '..' || runDir.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(runDir)) {
        throw new Error(`${name} report run is outside output receipt root: ${row.run_base}`)
      }
      expectedRunDirs.add(runDir)
      const record = receipt.runs.find(value => value.runDir === runDir)
      if (!record) throw new Error(`${name} output receipt has no record for ${runDir}`)
      const relocatedRunBase = join(filesRoot, runDir)
      const tracePath = join(relocatedRunBase, 'trace.jsonl')
      const outputPath = join(relocatedRunBase, 'output.md')
      const backupPath = join(relocatedRunBase, 'output.harness.md')
      if (!existsSync(tracePath) || !existsSync(outputPath)) throw new Error(`${name} output receipt files are missing for ${runDir}`)
      const materialized = existsSync(backupPath)
      const actual = {
        traceDigest: fileDigest(tracePath),
        outputDigest: fileDigest(outputPath),
        harnessOutputDigest: fileDigest(materialized ? backupPath : outputPath),
      }
      if (record.materialized !== materialized) throw new Error(`${name} output receipt materialization state changed for ${runDir}`)
      for (const field of ['traceDigest', 'outputDigest', 'harnessOutputDigest'] as const) {
        if (record[field] !== actual[field]) throw new Error(`${name} output receipt ${field} mismatch for ${runDir}`)
      }
    }
    const extras = receipt.runs.filter(run => !expectedRunDirs.has(run.runDir))
    if (extras.length) throw new Error(`${name} output receipt contains runs absent from the report: ${extras.map(run => run.runDir).join(',')}`)
    const tracePaths = receipt.runs.map(run => join(filesRoot, run.runDir, 'trace.jsonl'))
    const outputPaths = receipt.runs.map(run => join(filesRoot, run.runDir, 'output.md'))
    if (receipt.traceDigest !== treeDigest(tracePaths, filesRoot)) throw new Error(`${name} output receipt aggregate traceDigest mismatch`)
    if (receipt.outputDigest !== treeDigest(outputPaths, filesRoot)) throw new Error(`${name} output receipt aggregate outputDigest mismatch`)
    if (receipt.harnessOutputDigest !== harnessRecordDigest(receipt.runs)) throw new Error(`${name} output receipt aggregate harnessOutputDigest mismatch`)
  }
}

function relocateReportRuns(report: BenchmarkReport, name: keyof RunRootOverrides, receipts?: OutputMaterializationReceipts, overrides?: RunRootOverrides): BenchmarkReport {
  if (!receipts || !overrides) return report
  const originalRoot = resolve(receipts[name].runsRoot)
  const relocatedRoot = resolve(overrides[name])
  const inside = (root: string, path: string): string | null => {
    const child = relative(root, path)
    return child && child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(child) ? child : null
  }
  return {
    results: report.results.map(row => {
      const runBase = resolve(row.run_base)
      const originalChild = inside(originalRoot, runBase)
      if (originalChild) return { ...row, run_base: join(relocatedRoot, originalChild) }
      return row
    }),
  }
}

export function summarizeComparison(
  before: BenchmarkReport,
  after: BenchmarkReport,
  cohort: Cohort,
  manifestDigests?: ManifestDigests,
  preparationReceipts?: PreparationReceipts,
  outputMaterializationReceipts?: OutputMaterializationReceipts,
  preparedTaskDigests?: PreparedTaskDigests,
  profile: EvidenceProfile = 'iteration',
  runRootOverrides?: RunRootOverrides,
): object {
  const repetitions = runsPerVariant(cohort, profile)
  const checks = causalChecks(cohort.comparison, manifestDigests, preparationReceipts)
  validatePreparationReceipts(preparationReceipts, preparedTaskDigests)
  const expectedRuns = cohort.behavior.cases.length * 2 * repetitions
  const selectedCases = new Set(cohort.behavior.cases)
  const effectiveBefore = relocateReportRuns(before, 'baseline', outputMaterializationReceipts, runRootOverrides)
  const effectiveAfter = relocateReportRuns(after, 'candidate', outputMaterializationReceipts, runRootOverrides)
  validateOutputReceipts(outputMaterializationReceipts, { baseline: effectiveBefore, candidate: effectiveAfter }, selectedCases, expectedRuns, cohort, preparationReceipts, runRootOverrides)
  const baseline = summarizeOne(effectiveBefore, cohort, repetitions) as {
    variants: Record<string, { meanObjectivePassRate: number | null; allGradedAssertionsPassRate: number | null }>
    treatmentGain: { absolute: number | null; normalized: number | null; allGradedAssertionsAbsolute: number | null; allGradedAssertionsNormalized: number | null }
  }
  const candidate = summarizeOne(effectiveAfter, cohort, repetitions) as {
    variants: Record<string, { meanObjectivePassRate: number | null; allGradedAssertionsPassRate: number | null }>
    treatmentGain: { absolute: number | null; normalized: number | null; allGradedAssertionsAbsolute: number | null; allGradedAssertionsNormalized: number | null }
  }
  const deltas = Object.fromEntries(['with_skill', 'without_skill'].map(variant => [variant, difference(candidate.variants[variant]?.meanObjectivePassRate ?? null, baseline.variants[variant]?.meanObjectivePassRate ?? null)]))
  const allGradedAssertionsDeltas = Object.fromEntries(['with_skill', 'without_skill'].map(variant => [variant, difference(candidate.variants[variant]?.allGradedAssertionsPassRate ?? null, baseline.variants[variant]?.allGradedAssertionsPassRate ?? null)]))
  return {
    schemaVersion: 2,
    evidenceProfile: profile,
    runsPerVariant: repetitions,
    comparison: cohort.comparison,
    executor: cohort.executor,
    manifestDigests: manifestDigests ?? null,
    reportDigests: { baseline: stableDigest(before), candidate: stableDigest(after) },
    preparationReceipts: preparationReceipts ?? null,
    outputMaterializationReceipts: outputMaterializationReceipts ?? null,
    causalChecks: checks,
    pricing: cohort.pricingUsdPerMillionTokens,
    expectedRunsPerTreatment: expectedRuns,
    baseline,
    candidate,
    objectivePassRateDelta: deltas,
    allGradedAssertionsPassRateDelta: allGradedAssertionsDeltas,
    treatmentGainDelta: {
      absolute: difference(candidate.treatmentGain.absolute, baseline.treatmentGain.absolute),
      normalized: difference(candidate.treatmentGain.normalized, baseline.treatmentGain.normalized),
      allGradedAssertionsAbsolute: difference(candidate.treatmentGain.allGradedAssertionsAbsolute, baseline.treatmentGain.allGradedAssertionsAbsolute),
      allGradedAssertionsNormalized: difference(candidate.treatmentGain.allGradedAssertionsNormalized, baseline.treatmentGain.allGradedAssertionsNormalized),
    },
  }
}

if (import.meta.main) {
  const beforePath = option('--before')
  const afterPath = option('--after')
  const beforeManifestPath = option('--before-manifest')
  const afterManifestPath = option('--after-manifest')
  const beforeReceiptPath = option('--before-receipt')
  const afterReceiptPath = option('--after-receipt')
  const beforeOutputReceiptPath = option('--before-output-receipt')
  const afterOutputReceiptPath = option('--after-output-receipt')
  const beforeTasksPath = option('--before-tasks')
  const afterTasksPath = option('--after-tasks')
  const profile = option('--profile')
  const beforeRunsRoot = option('--before-runs-root')
  const afterRunsRoot = option('--after-runs-root')
  const cohortPath = option('--cohort') ?? join(import.meta.dir, '../../eval/skill-evidence/release-cohort.json')
  const outPath = option('--out')
  if (
    !beforePath ||
    !afterPath ||
    !beforeManifestPath ||
    !afterManifestPath ||
    !beforeReceiptPath ||
    !afterReceiptPath ||
    !beforeOutputReceiptPath ||
    !afterOutputReceiptPath ||
    !beforeTasksPath ||
    !afterTasksPath ||
    !outPath ||
    (profile !== 'iteration' && profile !== 'release') ||
    Boolean(beforeRunsRoot) !== Boolean(afterRunsRoot)
  )
    throw new Error(
      'usage: summarize-skill-evidence.ts --before report.json --after report.json --before-manifest baseline.json --after-manifest candidate.json --before-receipt baseline-receipt.json --after-receipt candidate-receipt.json --before-output-receipt baseline-output.json --after-output-receipt candidate-output.json --before-tasks baseline.jsonl --after-tasks candidate.jsonl --profile iteration|release --out comparison.json [--cohort release-cohort.json] [--before-runs-root PATH --after-runs-root PATH]',
    )
  const taskDigest = (path: string): string =>
    stableDigest(
      readFileSync(resolve(path), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line)),
    )
  const report = summarizeComparison(
    JSON.parse(readFileSync(resolve(beforePath), 'utf8')),
    JSON.parse(readFileSync(resolve(afterPath), 'utf8')),
    JSON.parse(readFileSync(resolve(cohortPath), 'utf8')),
    { baseline: manifestDigest(resolve(beforeManifestPath)), candidate: manifestDigest(resolve(afterManifestPath)) },
    { baseline: JSON.parse(readFileSync(resolve(beforeReceiptPath), 'utf8')), candidate: JSON.parse(readFileSync(resolve(afterReceiptPath), 'utf8')) },
    { baseline: JSON.parse(readFileSync(resolve(beforeOutputReceiptPath), 'utf8')), candidate: JSON.parse(readFileSync(resolve(afterOutputReceiptPath), 'utf8')) },
    { baseline: taskDigest(beforeTasksPath), candidate: taskDigest(afterTasksPath) },
    profile,
    beforeRunsRoot && afterRunsRoot ? { baseline: resolve(beforeRunsRoot), candidate: resolve(afterRunsRoot) } : undefined,
  )
  writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote ${resolve(outPath)}`)
}
