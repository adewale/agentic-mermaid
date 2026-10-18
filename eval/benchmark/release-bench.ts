// Release benchmark: performance, memory and correctness of a built candidate
// package, compared with a baseline package (normally the last npm release),
// measured in alternating fresh Node processes on the same machine.
//
//   bun run bench:release --baseline-npm latest
//   bun run bench:release --baseline ../agentic-mermaid-main [--rounds 1 --reps 1]
//
// Inputs: every official Mermaid syntax fence (all families, including the
// ones we only diagnose) plus generated large diagrams per layout family. The
// corpus runs in one process; each large case runs in its own, under a time
// budget, so one pathological case cannot stall or starve the rest. A baseline
// that runs out of budget is reported; a candidate that does fails.
// Writes report.json and report.md to --out and exits non-zero when a gate
// fails. Nothing here is committed: baselines are measured, never stored.

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { extractOfficialCorpus } from '../shared/official-fences.ts'
import { releaseBenchCases } from './release-bench-cases.ts'

interface Input { id: string; family: string; source: string; kind: 'corpus' | 'scaling' }
interface Group { name: string; inputs: Input[]; budgetMs: number }
interface Engine { label: string; entry: string; version: string }
type Outcome = { ok: true; output: string } | { ok: false; error: string }
interface Rendered { svg: Outcome; ascii: { ok: boolean }; deterministic: boolean; ms: number }
interface TimeResult {
  node: string
  importMs: number
  firstRenderMs: number
  results: (Rendered & { id: string })[]
}
interface MemoryResult {
  perInput: { id: string; allocatedBytes: number; peakHeapBytes: number }[]
  passAllocatedBytes: number
  passPeakHeapBytes: number
  retainedGrowthBytes: number
  peakRssBytes: number
}
interface EngineRun {
  label: string
  version: string
  node?: string
  importMs?: number
  firstRenderMs?: number
  results: Map<string, Rendered>
  heap: Map<string, { allocatedBytes: number; peakHeapBytes: number; peakRssBytes: number }>
  corpusMemory?: Omit<MemoryResult, 'perInput'>
  /** Groups that ran out of budget or crashed, with the reason. */
  failures: Map<string, string>
}

const ROOT = resolve(import.meta.dir, '..', '..')
const WORKER = join(import.meta.dir, 'release-bench-worker.ts')

// Gates. Timing ratios compare min-of-medians across interleaved rounds, so
// they tolerate runner noise; anything past them is a real regression.
const GATES = {
  corpusSlowdown: 1.25,
  caseSlowdown: 1.5,
  allocationGrowth: 1.25,
  rssGrowth: 1.25,
  retainedGrowthBytes: 16 * 1024 * 1024,
}
const CORPUS_BUDGET_MS = 30 * 60 * 1000
const CASE_BUDGET_MS = 10 * 60 * 1000

function args(): Map<string, string> {
  const out = new Map<string, string>()
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`)
    out.set(key.slice(2), argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[++i]!)
  }
  return out
}

function packageAt(dir: string, label: string): Engine {
  const entry = join(dir, 'dist', 'index.js')
  if (!existsSync(entry)) throw new Error(`${label}: ${entry} does not exist; build the package first`)
  const version = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version
  return { label, entry, version }
}

function installFromNpm(spec: string): string {
  const prefix = mkdtempSync(join(tmpdir(), 'am-bench-baseline-'))
  const result = spawnSync('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', `agentic-mermaid@${spec}`], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`npm install agentic-mermaid@${spec} failed`)
  return join(prefix, 'node_modules', 'agentic-mermaid')
}

function runWorker(out: string, engine: Engine, mode: 'time' | 'memory', group: Group, reps: number): { ok: true; value: unknown } | { ok: false; reason: string } {
  const job = join(out, `job-${mode}.json`)
  const result = join(out, `result-${mode}.json`)
  rmSync(result, { force: true })
  writeFileSync(job, JSON.stringify({ entry: engine.entry, mode, inputs: group.inputs, reps }))
  const flags = mode === 'memory' ? ['--expose-gc'] : []
  const run = spawnSync('node', [...flags, '--no-warnings', WORKER, job, result], { stdio: 'inherit', timeout: group.budgetMs })
  if (run.status === 0) return { ok: true, value: JSON.parse(readFileSync(result, 'utf8')) }
  const reason = run.signal === 'SIGTERM' ? `exceeded ${group.budgetMs / 60000} min` : `exited with ${run.status ?? run.signal}`
  console.log(`  ${engine.label} ${group.name} (${mode}): ${reason}`)
  return { ok: false, reason }
}

/** Interleave engines round by round so drift on the runner hits both alike;
 * keep each input's fastest median and the first round's correctness record. */
function measure(out: string, engines: Engine[], groups: Group[], rounds: number, reps: number): EngineRun[] {
  const runs = new Map(engines.map(engine => [engine.label, {
    label: engine.label,
    version: engine.version,
    results: new Map(),
    heap: new Map(),
    failures: new Map(),
  } as EngineRun]))
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? engines : [...engines].reverse()
    for (const group of groups) {
      for (const engine of order) {
        const run = runs.get(engine.label)!
        if (run.failures.has(group.name)) continue
        console.log(`round ${round + 1}/${rounds}: ${engine.label} ${engine.version} ${group.name}`)
        const timed = runWorker(out, engine, 'time', group, reps)
        if (!timed.ok) {
          run.failures.set(group.name, timed.reason)
          for (const input of group.inputs) run.results.delete(input.id)
          continue
        }
        const value = timed.value as TimeResult
        run.node = value.node
        if (group.name === 'corpus') {
          run.importMs = Math.min(run.importMs ?? Infinity, value.importMs)
          run.firstRenderMs = Math.min(run.firstRenderMs ?? Infinity, value.firstRenderMs)
        }
        for (const { id, ...rendered } of value.results) {
          const previous = run.results.get(id)
          run.results.set(id, previous ? { ...previous, ms: Math.min(previous.ms, rendered.ms) } : rendered)
        }
      }
    }
  }
  for (const engine of engines) {
    const run = runs.get(engine.label)!
    for (const group of groups) {
      if (run.failures.has(group.name)) continue
      console.log(`memory: ${engine.label} ${engine.version} ${group.name}`)
      const measured = runWorker(out, engine, 'memory', group, reps)
      if (!measured.ok) {
        run.failures.set(group.name, `memory: ${measured.reason}`)
        continue
      }
      const { perInput, ...pass } = measured.value as MemoryResult
      for (const { id, ...heap } of perInput) run.heap.set(id, { ...heap, peakRssBytes: pass.peakRssBytes })
      if (group.name === 'corpus') run.corpusMemory = pass
    }
  }
  return engines.map(engine => runs.get(engine.label)!)
}

function parsesAsSvg(svg: string): boolean {
  try {
    new Resvg(svg, { font: { loadSystemFonts: false } })
    return true
  } catch {
    return false
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const ms = (value: number | undefined) => value === undefined ? '—' : value < 10 ? `${value.toFixed(2)} ms` : `${value.toFixed(0)} ms`
const mb = (bytes: number | undefined) => bytes === undefined ? '—' : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const ratio = (candidate: number, baseline: number) => baseline > 0 ? candidate / baseline : 1
const times = (value: number | undefined) => value === undefined ? '—' : `${value.toFixed(2)}×`
const sameSvg = (a: Outcome, b: Outcome) => a.ok === b.ok && (!a.ok || a.output === (b as typeof a).output)

interface Check { name: string; ok: boolean; detail: string }

function report(inputs: Input[], groups: Group[], runs: EngineRun[]): { checks: Check[]; markdown: string; summary: unknown } {
  const candidate = runs.at(-1)!
  const baseline = runs.length > 1 ? runs[0]! : undefined
  const corpus = inputs.filter(input => input.kind === 'corpus')
  const scaling = inputs.filter(input => input.kind === 'scaling')
  const measured = (list: Input[]) => list.filter(input => candidate.results.has(input.id) && (!baseline || baseline.results.has(input.id)))
  // Timing compares like with like: an input one engine renders and the other
  // rejects is a correctness difference (gated above), not a speed one.
  const comparable = (list: Input[]) => measured(list).filter(input => baseline!.results.get(input.id)!.svg.ok === candidate.results.get(input.id)!.svg.ok)
  const total = (run: EngineRun, list: Input[]) => sum(list.map(input => run.results.get(input.id)!.ms))
  const checks: Check[] = []

  // Correctness.
  const failed = [...candidate.failures].map(([group, reason]) => `${group}: ${reason}`)
  checks.push({ name: 'Every input completes', ok: failed.length === 0, detail: failed.join('; ') || 'within budget' })
  const nondeterministic = [...candidate.results].filter(([, result]) => !result.deterministic).map(([id]) => id)
  checks.push({ name: 'Deterministic output', ok: nondeterministic.length === 0, detail: nondeterministic.join(', ') || 'every SVG and ASCII render repeats byte for byte' })
  const unparsable = [...candidate.results].filter(([id, result]) => {
    if (!result.svg.ok || parsesAsSvg(result.svg.output)) return false
    const before = baseline?.results.get(id)?.svg
    return !before?.ok || parsesAsSvg(before.output)
  }).map(([id]) => id)
  checks.push({ name: 'SVG parses (resvg)', ok: unparsable.length === 0, detail: unparsable.join(', ') || 'every rendered SVG parses' })
  if (baseline) {
    const both = measured(inputs)
    const lostSvg = both.filter(input => baseline.results.get(input.id)!.svg.ok && !candidate.results.get(input.id)!.svg.ok)
    const lostAscii = both.filter(input => baseline.results.get(input.id)!.ascii.ok && !candidate.results.get(input.id)!.ascii.ok)
    checks.push({ name: 'No lost SVG renders', ok: lostSvg.length === 0, detail: lostSvg.map(input => `${input.id}: ${(candidate.results.get(input.id)!.svg as { error: string }).error}`).join('; ') || 'none' })
    checks.push({ name: 'No lost ASCII renders', ok: lostAscii.length === 0, detail: lostAscii.map(input => input.id).join(', ') || 'none' })
  }

  // Performance.
  if (baseline) {
    const shared = comparable(corpus)
    if (measured(corpus).length === corpus.length) {
      const corpusRatio = ratio(total(candidate, shared), total(baseline, shared))
      const excluded = corpus.length - shared.length
      checks.push({
        name: `Corpus render time ≤ ${GATES.corpusSlowdown}× baseline`,
        ok: corpusRatio <= GATES.corpusSlowdown,
        detail: `${times(corpusRatio)}${excluded > 0 ? ` over ${shared.length} fences both engines handle alike` : ''}`,
      })
    }
    const slow = comparable(scaling).filter(input => ratio(candidate.results.get(input.id)!.ms, baseline.results.get(input.id)!.ms) > GATES.caseSlowdown)
    const unmeasured = scaling.filter(input => candidate.results.has(input.id) && !baseline.results.has(input.id))
    const unlike = measured(scaling).filter(input => !comparable([input]).length)
    checks.push({
      name: `Each large case ≤ ${GATES.caseSlowdown}× baseline`,
      ok: slow.length === 0,
      detail: [
        slow.map(input => `${input.id} ${times(ratio(candidate.results.get(input.id)!.ms, baseline.results.get(input.id)!.ms))}`).join(', ') || 'all within',
        ...(unmeasured.length > 0 ? [`baseline did not finish ${unmeasured.map(input => input.id).join(', ')}`] : []),
        ...(unlike.length > 0 ? [`rendered by one engine only ${unlike.map(input => input.id).join(', ')}`] : []),
      ].join('; '),
    })
  }

  // Memory.
  if (baseline?.corpusMemory && candidate.corpusMemory) {
    const allocationRatio = ratio(candidate.corpusMemory.passAllocatedBytes, baseline.corpusMemory.passAllocatedBytes)
    const rssRatio = ratio(candidate.corpusMemory.peakRssBytes, baseline.corpusMemory.peakRssBytes)
    checks.push({ name: `Corpus allocation ≤ ${GATES.allocationGrowth}× baseline`, ok: allocationRatio <= GATES.allocationGrowth, detail: times(allocationRatio) })
    checks.push({ name: `Corpus peak RSS ≤ ${GATES.rssGrowth}× baseline`, ok: rssRatio <= GATES.rssGrowth, detail: times(rssRatio) })
  }
  if (candidate.corpusMemory) {
    checks.push({
      name: `Retained heap growth per pass ≤ ${mb(GATES.retainedGrowthBytes)}`,
      ok: candidate.corpusMemory.retainedGrowthBytes <= GATES.retainedGrowthBytes,
      detail: mb(candidate.corpusMemory.retainedGrowthBytes),
    })
  }

  // Markdown.
  const engines = runs.map(run => `${run.label} ${run.version}`)
  const md: string[] = []
  const ok = checks.every(check => check.ok)
  md.push(`# Release benchmark: ${ok ? 'pass' : 'FAIL'}`, '')
  md.push(`Engines: ${engines.join(' vs ')}. Inputs: ${corpus.length} official syntax fences across ${new Set(corpus.map(input => input.family)).size} families, ${scaling.length} generated large diagrams. Node ${[...new Set(runs.map(run => run.node))].join(', ')}.`, '')
  md.push('| Gate | Result | Detail |', '|---|---|---|')
  for (const check of checks) md.push(`| ${check.name} | ${check.ok ? 'pass' : '**FAIL**'} | ${check.detail.replace(/\|/g, '\\|')} |`)

  const column = (run: EngineRun, list: Input[]) => list.every(input => run.results.has(input.id))
    ? {
        rendered: list.filter(input => run.results.get(input.id)!.svg.ok).length,
        ms: total(run, list),
        allocated: list.every(input => run.heap.has(input.id)) ? sum(list.map(input => run.heap.get(input.id)!.allocatedBytes)) : undefined,
        peak: list.every(input => run.heap.has(input.id)) ? Math.max(...list.map(input => run.heap.get(input.id)!.peakHeapBytes)) : undefined,
        rss: list.every(input => run.heap.has(input.id)) ? Math.max(...list.map(input => run.heap.get(input.id)!.peakRssBytes)) : undefined,
      }
    : undefined
  const changedCount = (list: Input[]) => baseline
    ? measured(list).filter(input => !sameSvg(baseline.results.get(input.id)!.svg, candidate.results.get(input.id)!.svg)).length
    : 0

  md.push('', '## Corpus by family', '')
  const families = [...new Set(corpus.map(input => input.family))].sort()
  if (baseline) {
    md.push('| Family | Fences | Rendered (base → cand) | Changed SVGs | Time (base → cand) | Speed-up | Allocated (base → cand) |', '|---|---|---|---|---|---|---|')
  } else {
    md.push('| Family | Fences | Rendered | Time | Allocated |', '|---|---|---|---|---|')
  }
  for (const family of [...families, 'all']) {
    const list = family === 'all' ? corpus : corpus.filter(input => input.family === family)
    const c = column(candidate, list)
    const name = family === 'all' ? '**all**' : family
    if (baseline) {
      const b = column(baseline, list)
      md.push(`| ${name} | ${list.length} | ${b?.rendered ?? '—'} → ${c?.rendered ?? '—'} | ${changedCount(list)} | ${ms(b?.ms)} → ${ms(c?.ms)} | ${b && c ? times(ratio(b.ms, c.ms)) : '—'} | ${mb(b?.allocated)} → ${mb(c?.allocated)} |`)
    } else {
      md.push(`| ${name} | ${list.length} | ${c?.rendered ?? '—'} | ${ms(c?.ms)} | ${mb(c?.allocated)} |`)
    }
  }

  md.push('', '## Large generated diagrams', '')
  md.push(baseline
    ? '| Case | Time (base → cand) | Speed-up | Allocated (base → cand) | Peak heap (base → cand) | Peak RSS (base → cand) | SVG changed |\n|---|---|---|---|---|---|---|'
    : '| Case | Time | Allocated | Peak heap | Peak RSS |\n|---|---|---|---|---|')
  for (const input of scaling) {
    const c = column(candidate, [input])
    if (baseline) {
      const b = column(baseline, [input])
      const changed = b && c ? (changedCount([input]) > 0 ? 'yes' : 'no') : '—'
      const bTime = b ? ms(b.ms) : `did not finish (${baseline.failures.get(input.id)})`
      md.push(`| ${input.id} | ${bTime} → ${ms(c?.ms)} | ${b && c ? times(ratio(b.ms, c.ms)) : '—'} | ${mb(b?.allocated)} → ${mb(c?.allocated)} | ${mb(b?.peak)} → ${mb(c?.peak)} | ${mb(b?.rss)} → ${mb(c?.rss)} | ${changed} |`)
    } else {
      md.push(`| ${input.id} | ${ms(c?.ms)} | ${mb(c?.allocated)} | ${mb(c?.peak)} | ${mb(c?.rss)} |`)
    }
  }

  md.push('', '## Corpus process', '')
  md.push(`| Metric | ${engines.join(' | ')} |`, `|---|${engines.map(() => '---').join('|')}|`)
  md.push(`| Import | ${runs.map(run => ms(run.importMs)).join(' | ')} |`)
  md.push(`| First render | ${runs.map(run => ms(run.firstRenderMs)).join(' | ')} |`)
  md.push(`| Allocated per corpus pass | ${runs.map(run => mb(run.corpusMemory?.passAllocatedBytes)).join(' | ')} |`)
  md.push(`| Peak heap during pass | ${runs.map(run => mb(run.corpusMemory?.passPeakHeapBytes)).join(' | ')} |`)
  md.push(`| Retained heap growth per pass | ${runs.map(run => mb(run.corpusMemory?.retainedGrowthBytes)).join(' | ')} |`)
  md.push(`| Peak RSS | ${runs.map(run => mb(run.corpusMemory?.peakRssBytes)).join(' | ')} |`)
  md.push('', 'Times are the fastest per-input median across interleaved rounds. Allocation is V8 heap allocated between GCs, measured in separate processes; each large case runs in its own process.')

  const summary = {
    ok,
    checks,
    groups: groups.map(group => group.name),
    engines: runs.map(run => ({
      label: run.label,
      version: run.version,
      node: run.node,
      importMs: run.importMs,
      firstRenderMs: run.firstRenderMs,
      corpusMs: column(run, corpus)?.ms,
      cases: Object.fromEntries(scaling.map(input => [input.id, run.results.get(input.id)?.ms ?? null])),
      corpusMemory: run.corpusMemory,
      failures: Object.fromEntries(run.failures),
    })),
  }
  return { checks, markdown: md.join('\n') + '\n', summary }
}

const options = args()
const out = resolve(options.get('out') ?? join(ROOT, 'bench-report'))
mkdirSync(out, { recursive: true })
const rounds = Number(options.get('rounds') ?? 3)
const reps = Number(options.get('reps') ?? 5)
const engines: Engine[] = []
const baselineDir = options.get('baseline') ?? (options.has('baseline-npm') ? installFromNpm(options.get('baseline-npm')!) : undefined)
if (baselineDir) engines.push(packageAt(resolve(baselineDir), 'baseline'))
engines.push(packageAt(resolve(options.get('candidate') ?? ROOT), 'candidate'))

const corpusInputs = extractOfficialCorpus().map(fence => ({ ...fence, kind: 'corpus' as const }))
const caseInputs = releaseBenchCases().map(benchCase => ({ ...benchCase, kind: 'scaling' as const }))
const groups: Group[] = [
  { name: 'corpus', inputs: corpusInputs, budgetMs: CORPUS_BUDGET_MS },
  ...caseInputs.map(input => ({ name: input.id, inputs: [input], budgetMs: CASE_BUDGET_MS })),
]
const inputs: Input[] = [...corpusInputs, ...caseInputs]
const runs = measure(out, engines, groups, rounds, reps)
const { checks, markdown, summary } = report(inputs, groups, runs)
writeFileSync(join(out, 'report.json'), JSON.stringify(summary, null, 2))
writeFileSync(join(out, 'report.md'), markdown)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
console.log(markdown)
if (!checks.every(check => check.ok)) process.exit(1)
