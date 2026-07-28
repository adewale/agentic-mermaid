import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

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
  metadata?: Record<string, unknown>
}

interface BenchmarkReport { results: ResultRow[] }
interface Pricing { input: number; cachedInput: number; output: number; source: string; checkedAt: string }
interface Cohort {
  comparison: { baseline: string; candidate: string }
  behavior: { cases: string[]; minimumRunsPerVariant: number }
  executor: Record<string, unknown>
  pricingUsdPerMillionTokens: Pricing
}

interface Usage { input: number; cachedInput: number; output: number }
interface ManifestDigests { baseline: string; candidate: string }

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
    try { record = JSON.parse(line) } catch { continue }
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { for (const child of value) visit(child); return }
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
    latencyMs: { median: quantile(elapsed, 0.5), p95: quantile(elapsed, 0.95) },
    tokens: { input, cachedInput, uncachedInput, output },
    estimatedCostUsd: (uncachedInput * pricing.input + cachedInput * pricing.cachedInput + output * pricing.output) / 1_000_000,
  }
}

function summarizeOne(report: BenchmarkReport, cohort: Cohort): object {
  const selected = new Set(cohort.behavior.cases)
  const rows = report.results.filter(row => selected.has(row.case_id))
  const expected = cohort.behavior.cases.length * 2 * cohort.behavior.minimumRunsPerVariant
  if (rows.length !== expected) throw new Error(`expected ${expected} cohort results, found ${rows.length}`)
  const expectedKeys = new Set<string>()
  for (const caseId of cohort.behavior.cases) {
    for (const variant of ['with_skill', 'without_skill']) {
      for (let run = 1; run <= cohort.behavior.minimumRunsPerVariant; run++) expectedKeys.add(`${caseId}/${variant}/${run}`)
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
  const variants = Object.fromEntries((['with_skill', 'without_skill'] as const).map(variant => [variant, summarizeRows(rows.filter(row => row.variant === variant), cohort.pricingUsdPerMillionTokens)]))
  const slices: Record<string, unknown> = {}
  for (const field of ['case_id', 'domain', 'difficulty', 'trigger_type'] as const) {
    slices[field] = Object.fromEntries([...new Set(rows.map(row => row[field]))].sort().map(value => [value, Object.fromEntries((['with_skill', 'without_skill'] as const).map(variant => [variant, summarizeRows(rows.filter(row => row[field] === value && row.variant === variant), cohort.pricingUsdPerMillionTokens)]))]))
  }
  const withSkillRate = (variants.with_skill as { meanObjectivePassRate: number | null }).meanObjectivePassRate
  const withoutSkillRate = (variants.without_skill as { meanObjectivePassRate: number | null }).meanObjectivePassRate
  const absolute = withSkillRate === null || withoutSkillRate === null ? null : withSkillRate - withoutSkillRate
  const headroom = withoutSkillRate === null ? null : 1 - withoutSkillRate
  const normalized = absolute === null || headroom === null ? null : headroom > 0 ? absolute / headroom : absolute === 0 ? 0 : null
  return {
    variants,
    treatmentGain: { absolute, normalized },
    slices,
    falseNegatives: rows.filter(row => row.variant === 'with_skill' && row.kind !== 'negative' && (row.objective_pass_rate ?? 0) < 1).map(row => ({ case_id: row.case_id, variant: row.variant, run: row.run_number, passRate: row.objective_pass_rate })),
    falsePositives: rows.filter(row => row.variant === 'with_skill' && row.kind === 'negative' && (row.objective_pass_rate ?? 0) < 1).map(row => ({ case_id: row.case_id, variant: row.variant, run: row.run_number, passRate: row.objective_pass_rate })),
  }
}

export function summarizeComparison(before: BenchmarkReport, after: BenchmarkReport, cohort: Cohort, manifestDigests?: ManifestDigests): object {
  const baseline = summarizeOne(before, cohort) as { variants: Record<string, { meanObjectivePassRate: number | null }>; treatmentGain: { absolute: number | null; normalized: number | null } }
  const candidate = summarizeOne(after, cohort) as { variants: Record<string, { meanObjectivePassRate: number | null }>; treatmentGain: { absolute: number | null; normalized: number | null } }
  const deltas = Object.fromEntries(['with_skill', 'without_skill'].map(variant => [variant,
    difference(candidate.variants[variant]?.meanObjectivePassRate ?? null, baseline.variants[variant]?.meanObjectivePassRate ?? null),
  ]))
  return {
    schemaVersion: 1,
    comparison: cohort.comparison,
    executor: cohort.executor,
    manifestDigests: manifestDigests ?? null,
    pricing: cohort.pricingUsdPerMillionTokens,
    expectedRunsPerCommit: cohort.behavior.cases.length * 2 * cohort.behavior.minimumRunsPerVariant,
    baseline,
    candidate,
    objectivePassRateDelta: deltas,
    treatmentGainDelta: {
      absolute: difference(candidate.treatmentGain.absolute, baseline.treatmentGain.absolute),
      normalized: difference(candidate.treatmentGain.normalized, baseline.treatmentGain.normalized),
    },
  }
}

if (import.meta.main) {
  const beforePath = option('--before')
  const afterPath = option('--after')
  const beforeManifestPath = option('--before-manifest')
  const afterManifestPath = option('--after-manifest')
  const cohortPath = option('--cohort') ?? join(import.meta.dir, '../../eval/skill-evidence/release-cohort.json')
  const outPath = option('--out')
  if (!beforePath || !afterPath || !beforeManifestPath || !afterManifestPath || !outPath) throw new Error('usage: summarize-skill-evidence.ts --before report.json --after report.json --before-manifest baseline.json --after-manifest candidate.json --out comparison.json [--cohort release-cohort.json]')
  const report = summarizeComparison(
    JSON.parse(readFileSync(resolve(beforePath), 'utf8')),
    JSON.parse(readFileSync(resolve(afterPath), 'utf8')),
    JSON.parse(readFileSync(resolve(cohortPath), 'utf8')),
    { baseline: manifestDigest(resolve(beforeManifestPath)), candidate: manifestDigest(resolve(afterManifestPath)) },
  )
  writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote ${resolve(outPath)}`)
}
