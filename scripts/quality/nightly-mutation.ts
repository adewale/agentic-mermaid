#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import type { BuiltinFamilyId } from '../../src/agent/families.ts'

const ROOT = resolve(import.meta.dir, '../..')
const VALID_MUTANT_STATUSES = new Set(['Killed', 'Timeout', 'Survived', 'NoCoverage'])
const DETECTED_MUTANT_STATUSES = new Set(['Killed', 'Timeout'])
const EXCLUDED_MUTANT_STATUSES = new Set(['CompileError', 'RuntimeError', 'Ignored'])
const MAX_NIGHTLY_MATRIX_JOBS = 128

export interface StrykerConfig {
  mutate?: string[]
  thresholds?: { break?: number; [key: string]: unknown }
  reporters?: string[]
  jsonReporter?: { fileName?: string }
  tempDirName?: string
  [key: string]: unknown
}

export interface NightlyLane {
  id: string
  config: string
  timeout: number
  maxLinesPerShard?: number
  families: readonly BuiltinFamilyId[]
}

export interface MutationPlanItem {
  name: string
  lane: string
  config: string
  timeout: number
  mutate: string[]
  report: string
}

export interface Mutant {
  status: string
  mutatorName?: string
  replacement?: string
  location?: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
}

export interface MutationReport {
  schemaVersion?: string
  config?: {
    mutate?: string[]
    thresholds?: { break?: number }
    jsonReporter?: { fileName?: string }
  }
  files: Record<string, { mutants: Mutant[] }>
}

export interface MutationScore {
  detected: number
  valid: number
  excluded: number
  unknown: number
  score: number
}

interface MutationOracleSummary {
  lane: string
  full: number
  shardMutants: number
  missing: number
  extra: number
  exact: boolean
  reportMutants?: number
  missingReportMutants?: number
  extraReportMutants?: number
  reportExact?: boolean
}

/**
 * One schedule authority. Configs continue to own their source/test declarations
 * and aggregate break floors; this list owns only orchestration and sharding.
 */
export const NIGHTLY_MUTATION_LANES: readonly NightlyLane[] = [
  { id: 'routes', config: 'stryker.routes.config.json', timeout: 180, maxLinesPerShard: 525, families: ['flowchart'] },
  { id: 'route-certificates', config: 'stryker.route-certificates.config.mjs', timeout: 45, families: [] },
  { id: 'subgraph-routing', config: 'stryker.subgraph-routing.config.mjs', timeout: 60, families: [] },
  { id: 'state', config: 'stryker.state.config.json', timeout: 90, maxLinesPerShard: 600, families: ['state'] },
  { id: 'sequence', config: 'stryker.sequence.config.json', timeout: 90, families: ['sequence'] },
  { id: 'timeline', config: 'stryker.timeline.config.json', timeout: 90, families: ['timeline'] },
  { id: 'class', config: 'stryker.class.config.json', timeout: 90, families: ['class'] },
  { id: 'er', config: 'stryker.er.config.json', timeout: 90, families: ['er'] },
  { id: 'journey', config: 'stryker.journey.config.json', timeout: 90, families: ['journey'] },
  { id: 'pie', config: 'stryker.pie.config.json', timeout: 90, families: ['pie'] },
  { id: 'quadrant', config: 'stryker.quadrant.config.json', timeout: 90, families: ['quadrant'] },
  { id: 'gantt', config: 'stryker.gantt.config.json', timeout: 120, maxLinesPerShard: 700, families: ['gantt'] },
  { id: 'mindmap', config: 'stryker.mindmap.config.json', timeout: 90, families: ['mindmap'] },
  { id: 'gitgraph', config: 'stryker.gitgraph.config.json', timeout: 90, families: ['gitgraph'] },
  { id: 'families', config: 'stryker.families.config.json', timeout: 120, maxLinesPerShard: 900, families: ['xychart', 'architecture', 'mindmap', 'gitgraph'] },
]

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export async function loadStrykerConfig(path: string, root = ROOT): Promise<StrykerConfig> {
  const absolute = resolve(root, path)
  if (extname(absolute) === '.json') return JSON.parse(readFileSync(absolute, 'utf8')) as StrykerConfig
  const module = await import(`${pathToFileURL(absolute).href}?nightly=${Date.now()}-${Math.random()}`) as { default?: StrykerConfig }
  if (!module.default) throw new Error(`${path}: expected a default-exported Stryker config`)
  return module.default
}

export interface MutationTarget {
  file: string
  start: number
  end: number
}

export function parseMutationTarget(spec: string, root = ROOT): MutationTarget {
  if (/[*?\[\]{}]/.test(spec)) {
    throw new Error(`${spec}: nightly mutation targets must name concrete files, not globs`)
  }
  if (/:\d+:\d+-\d+:\d+$/.test(spec)) {
    throw new Error(`${spec}: nightly mutation targets do not support column coordinates`)
  }
  const match = /^(.*?)(?::(\d+)-(\d+))?$/.exec(spec)
  if (!match) throw new Error(`Invalid mutation target: ${spec}`)
  const file = match[1]!
  const absolute = join(root, file)
  if (!existsSync(absolute)) throw new Error(`Mutation target does not exist: ${file}`)
  const lineCount = readFileSync(absolute, 'utf8').split(/\r?\n/).length
  const start = match[2] ? Number(match[2]) : 1
  const end = match[3] ? Number(match[3]) : lineCount
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lineCount) {
    throw new Error(`Mutation target is outside ${file}'s 1-${lineCount} line range: ${spec}`)
  }
  return { file, start, end }
}

function formatMutationTarget(target: MutationTarget): string {
  return `${target.file}:${target.start}-${target.end}`
}

/**
 * Pack complete top-level TypeScript statements. A declaration larger than the
 * target stays whole in one oversize shard; cutting it would silently omit any
 * mutant whose AST spans the boundary.
 */
export function shardMutationTargets(specs: readonly string[], maxLines: number, root = ROOT): string[][] {
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new Error(`maxLines must be a positive integer, got ${maxLines}`)
  const units: MutationTarget[] = []
  for (const spec of specs) {
    const target = parseMutationTarget(spec, root)
    if (spec !== target.file) {
      throw new Error(`${spec}: AST-safe nightly sharding requires a bare whole-file target without line or column ranges`)
    }
    const sourceText = readFileSync(join(root, target.file), 'utf8')
    const lineCount = sourceText.split(/\r?\n/).length
    if (target.start !== 1 || target.end !== lineCount) {
      throw new Error(`${spec}: AST-safe nightly sharding requires a whole-file mutation target`)
    }
    const source = ts.createSourceFile(target.file, sourceText, ts.ScriptTarget.Latest, true)
    let start = 1
    for (const statement of source.statements) {
      const end = source.getLineAndCharacterOfPosition(statement.end).line + 1
      if (end >= start) units.push({ file: target.file, start, end })
      start = Math.max(start, end + 1)
    }
    if (start <= lineCount) {
      const last = units.at(-1)
      if (last?.file === target.file) last.end = lineCount
      else units.push({ file: target.file, start, end: lineCount })
    }
  }

  const shards: string[][] = []
  let shard: MutationTarget[] = []
  let used = 0
  const flush = () => {
    if (shard.length > 0) shards.push(shard.map(formatMutationTarget))
    shard = []
    used = 0
  }

  for (const unit of units) {
    const length = unit.end - unit.start + 1
    if (shard.length > 0 && used + length > maxLines) flush()
    const previous = shard.at(-1)
    if (previous?.file === unit.file && previous.end + 1 === unit.start) previous.end = unit.end
    else shard.push({ ...unit })
    used += length
  }
  flush()
  return shards
}

export async function buildNightlyMutationPlan(root = ROOT): Promise<MutationPlanItem[]> {
  const plan: MutationPlanItem[] = []
  for (const lane of NIGHTLY_MUTATION_LANES) {
    const config = await loadStrykerConfig(lane.config, root)
    if (!config.mutate?.length) throw new Error(`${lane.config}: mutate must contain at least one target`)
    for (const target of config.mutate) parseMutationTarget(target, root)
    if (!config.reporters?.includes('json') || !config.jsonReporter?.fileName) {
      throw new Error(`${lane.config}: nightly lanes require a named JSON reporter`)
    }
    if (typeof config.thresholds?.break !== 'number' || config.thresholds.break <= 0) {
      throw new Error(`${lane.config}: nightly lanes require a positive aggregate thresholds.break floor`)
    }
    const shards = lane.maxLinesPerShard
      ? shardMutationTargets(config.mutate, lane.maxLinesPerShard, root)
      : [[...config.mutate]]
    for (let index = 0; index < shards.length; index++) {
      const name = shards.length === 1 ? lane.id : `${lane.id}-shard-${index + 1}-of-${shards.length}`
      plan.push({
        name,
        lane: lane.id,
        config: lane.config,
        timeout: lane.timeout,
        mutate: shards[index]!,
        report: `${name}-mutation.json`,
      })
    }
  }
  // Stay well below GitHub's 256-job matrix limit while leaving ordinary
  // source growth room; max-parallel in the workflow bounds concurrent cost.
  if (plan.length > MAX_NIGHTLY_MATRIX_JOBS) {
    throw new Error(`Nightly mutation matrix has ${plan.length} jobs; repository safety cap is ${MAX_NIGHTLY_MATRIX_JOBS}`)
  }
  if (new Set(plan.map(item => item.name)).size !== plan.length) throw new Error('Nightly mutation plan names must be unique')
  if (new Set(plan.map(item => item.report)).size !== plan.length) throw new Error('Nightly mutation report names must be unique')
  return plan
}

function allFilesBelow(path: string): string[] {
  if (!existsSync(path)) return []
  const out: string[] = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) out.push(...allFilesBelow(child))
    else if (entry.isFile()) out.push(child)
  }
  return out
}

export function mutationScore(reports: readonly MutationReport[]): MutationScore {
  let detected = 0
  let valid = 0
  let excluded = 0
  let unknown = 0
  for (const report of reports) {
    for (const file of Object.values(report.files ?? {})) {
      for (const mutant of file.mutants ?? []) {
        if (DETECTED_MUTANT_STATUSES.has(mutant.status)) detected++
        if (VALID_MUTANT_STATUSES.has(mutant.status)) valid++
        if (EXCLUDED_MUTANT_STATUSES.has(mutant.status)) excluded++
        else if (!VALID_MUTANT_STATUSES.has(mutant.status)) unknown++
      }
    }
  }
  return { detected, valid, excluded, unknown, score: valid === 0 ? 0 : detected / valid * 100 }
}

async function runPlanItem(name: string): Promise<void> {
  const plan = await buildNightlyMutationPlan()
  const item = plan.find(candidate => candidate.name === name)
  if (!item) throw new Error(`Unknown nightly mutation plan item: ${name}`)
  const base = await loadStrykerConfig(item.config)
  const tempConfig = join(ROOT, `.stryker-nightly-${safeName(name)}-${process.pid}.config.json`)
  const config: StrykerConfig = {
    ...base,
    _comment: `Generated for nightly shard ${name}; ${item.config} remains the aggregate score authority.`,
    mutate: item.mutate,
    thresholds: { ...base.thresholds, break: 0 },
    jsonReporter: { ...base.jsonReporter, fileName: `reports/mutation/${item.report}` },
    tempDirName: `.stryker-tmp-nightly-${safeName(name)}`,
    cleanTempDir: 'always',
  }
  writeFileSync(tempConfig, `${JSON.stringify(config, null, 2)}\n`)
  try {
    const result = spawnSync('npx', ['stryker', 'run', relative(ROOT, tempConfig)], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${name}: Stryker exited with status ${result.status}`)
    const report = join(ROOT, 'reports/mutation', item.report)
    if (!existsSync(report)) throw new Error(`${name}: Stryker completed without ${relative(ROOT, report)}`)
  } finally {
    rmSync(tempConfig, { force: true })
  }
}

function targetContainsLocation(target: MutationTarget, location: NonNullable<Mutant['location']>): boolean {
  // Both Mutation Testing Elements report locations and Stryker mutate ranges
  // are one-based. The instrumentation oracle normalizes its internal offsets
  // before comparing them with these reports.
  return location.start.line >= target.start && location.end.line <= target.end
}

function compareExpectedMutants(
  lane: NightlyLane,
  config: StrykerConfig,
  items: readonly MutationPlanItem[],
  reports: readonly MutationReport[],
  root = ROOT,
): MutationOracleSummary {
  const reported = reports.flatMap(report => Object.entries(report.files ?? {}).flatMap(([file, entry]) =>
    (entry.mutants ?? []).map(mutant => ({
      file,
      mutant: {
        location: mutant.location,
        mutatorName: mutant.mutatorName,
        replacement: mutant.replacement,
      },
    }))))
  const mutator = config.mutator as { excludedMutations?: string[] } | undefined
  const oracle = spawnSync('node', [join(root, 'scripts/quality/mutation-shard-oracle.mjs')], {
    cwd: root,
    input: JSON.stringify({
      root,
      lanes: [{
        id: lane.id,
        full: config.mutate,
        excludedMutations: mutator?.excludedMutations ?? [],
        shards: items.map(item => item.mutate),
        reported,
      }],
    }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  })
  if (oracle.error) throw oracle.error
  if (oracle.status !== 0) {
    throw new Error(`${lane.id}: mutation instrumentation oracle failed: ${oracle.stderr.trim() || `exit ${oracle.status}`}`)
  }
  const summaries = JSON.parse(oracle.stdout) as MutationOracleSummary[]
  if (summaries.length !== 1 || summaries[0]?.lane !== lane.id) {
    throw new Error(`${lane.id}: mutation instrumentation oracle returned an invalid summary`)
  }
  return summaries[0]
}

export function validateMutationReport(item: MutationPlanItem, report: MutationReport, root = ROOT): string[] {
  const failures: string[] = []
  if (!/^1(?:\.(?:0|[1-9]\d*)){0,2}$/.test(report.schemaVersion ?? '')) {
    failures.push(`${item.name}: unsupported report schema ${String(report.schemaVersion)}`)
  }
  if (JSON.stringify(report.config?.mutate) !== JSON.stringify(item.mutate)) {
    failures.push(`${item.name}: report mutate scope does not match the plan`)
  }
  if (report.config?.thresholds?.break !== 0) failures.push(`${item.name}: shard report was not run with break=0`)
  if (basename(report.config?.jsonReporter?.fileName ?? '') !== item.report) {
    failures.push(`${item.name}: report filename provenance does not match ${item.report}`)
  }

  const targets = item.mutate.map(spec => parseMutationTarget(spec, root))
  for (const [file, { mutants }] of Object.entries(report.files ?? {})) {
    const fileTargets = targets.filter(target => target.file === file)
    if (fileTargets.length === 0) {
      failures.push(`${item.name}: report contains unplanned file ${file}`)
      continue
    }
    for (const mutant of mutants) {
      if (!mutant.location) {
        failures.push(`${item.name}: ${file} mutant is missing a source location`)
        continue
      }
      if (!fileTargets.some(target => targetContainsLocation(target, mutant.location!))) {
        failures.push(`${item.name}: ${file} mutant lies outside its planned source scope`)
      }
    }
  }
  return failures
}

async function verifyReports(reportRoot: string): Promise<void> {
  const plan = await buildNightlyMutationPlan()
  const reportPaths = allFilesBelow(resolve(ROOT, reportRoot)).filter(path => path.endsWith('.json'))
  const byName = new Map<string, string[]>()
  for (const path of reportPaths) byName.set(basename(path), [...(byName.get(basename(path)) ?? []), path])

  const rows: string[] = []
  const failures: string[] = []
  for (const lane of NIGHTLY_MUTATION_LANES) {
    const items = plan.filter(item => item.lane === lane.id)
    const reports: MutationReport[] = []
    const validationFailures: string[] = []
    for (const item of items) {
      const matches = byName.get(item.report) ?? []
      if (matches.length !== 1) {
        failures.push(`${lane.id}: expected exactly one ${item.report}, found ${matches.length}`)
        continue
      }
      const report = JSON.parse(readFileSync(matches[0]!, 'utf8')) as MutationReport
      validationFailures.push(...validateMutationReport(item, report))
      reports.push(report)
    }
    const config = await loadStrykerConfig(lane.config)
    failures.push(...validationFailures)
    const oracle = compareExpectedMutants(lane, config, items, reports)
    const floor = config.thresholds!.break!
    const result = mutationScore(reports)
    const complete = reports.length === items.length
    const passes = complete
      && validationFailures.length === 0
      && oracle.reportExact === true
      && result.valid > 0
      && result.unknown === 0
      && result.score >= floor
    rows.push(`| ${lane.id} | ${items.length} | ${result.detected}/${result.valid} | ${result.excluded} | ${result.score.toFixed(2)}% | ${floor.toFixed(2)}% | ${passes ? 'pass' : 'fail'} |`)
    if (complete && result.valid === 0) failures.push(`${lane.id}: reports contain no valid mutants`)
    if (result.unknown > 0) failures.push(`${lane.id}: reports contain ${result.unknown} pending or unknown-status mutants`)
    if (oracle.reportExact !== true) {
      failures.push(`${lane.id}: uploaded reports differ from instrumentation (${oracle.missingReportMutants ?? oracle.full} missing, ${oracle.extraReportMutants ?? 0} extra mutants)`)
    }
    if (complete && result.valid > 0 && result.score < floor) {
      failures.push(`${lane.id}: ${result.score.toFixed(2)}% is below ${floor.toFixed(2)}%`)
    }
  }

  const summary = [
    '## Nightly mutation score ratchet',
    '',
    '| Lane | Shards | Detected/valid | Excluded | Score | Floor | Result |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    '',
  ].join('\n')
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' })
  if (failures.length > 0) throw new Error(`Nightly mutation verification failed:\n- ${failures.join('\n- ')}`)
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2)
  if (command === 'matrix') {
    const include = (await buildNightlyMutationPlan()).map(({ name, timeout }) => ({ name, timeout }))
    console.log(`matrix=${JSON.stringify({ include })}`)
    return
  }
  if (command === 'run' && argument) {
    await runPlanItem(argument)
    return
  }
  if (command === 'verify' && argument) {
    await verifyReports(argument)
    return
  }
  throw new Error('Usage: nightly-mutation.ts matrix | run <plan-item> | verify <report-directory>')
}

if (import.meta.main) await main()
