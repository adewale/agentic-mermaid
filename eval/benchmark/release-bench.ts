// Release benchmark: performance, memory and correctness of a built candidate
// package, compared with a baseline package (normally the last npm release),
// measured in alternating fresh Node processes on the same machine.
//
//   bun run bench:release -- --baseline-npm latest
//   bun run bench:release -- --baseline ../agentic-mermaid-main [--rounds 1]
//
// Inputs: every official Mermaid syntax fence (all families, including the
// ones we only diagnose) plus generated large diagrams per layout family.
// Writes report.json and report.md to --out and exits non-zero when a gate
// fails. Nothing here is committed: baselines are measured, never stored.

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { extractOfficialCorpus } from '../shared/official-fences.ts'
import { releaseBenchCases } from './release-bench-cases.ts'

interface Input { id: string; family: string; source: string; kind: 'corpus' | 'scaling' }
type Outcome = { ok: true; output: string } | { ok: false; error: string }
interface TimeResult {
  importMs: number
  firstRenderMs: number
  results: { id: string; svg: Outcome; ascii: { ok: boolean }; deterministic: boolean; ms: number }[]
}
interface MemoryResult {
  perInput: { id: string; allocatedBytes: number; peakHeapBytes: number }[]
  passAllocatedBytes: number
  passPeakHeapBytes: number
  retainedGrowthBytes: number
  peakRssBytes: number
}
interface EngineRun { label: string; version: string; time: TimeResult; memory: MemoryResult }

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

function packageAt(dir: string, label: string): { label: string; entry: string; version: string } {
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

function runWorker(out: string, entry: string, mode: 'time' | 'memory', inputs: Input[], reps: number): unknown {
  const job = join(out, `job-${mode}.json`)
  const result = join(out, `result-${mode}.json`)
  writeFileSync(job, JSON.stringify({ entry, mode, inputs, reps }))
  const flags = mode === 'memory' ? ['--expose-gc'] : []
  const run = spawnSync('node', [...flags, '--no-warnings', WORKER, job, result], { stdio: 'inherit', timeout: 60 * 60 * 1000 })
  if (run.status !== 0) throw new Error(`benchmark worker (${mode}) exited with ${run.status ?? run.signal}`)
  return JSON.parse(readFileSync(result, 'utf8'))
}

/** Interleave engines round by round so drift on the runner hits both alike;
 * keep each input's fastest median and the first round's correctness record. */
function measure(out: string, engines: { label: string; entry: string; version: string }[], inputs: Input[], rounds: number, reps: number): EngineRun[] {
  const times = new Map<string, TimeResult[]>()
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? engines : [...engines].reverse()
    for (const engine of order) {
      console.log(`round ${round + 1}/${rounds}: timing ${engine.label} ${engine.version}`)
      const list = times.get(engine.label) ?? []
      list.push(runWorker(out, engine.entry, 'time', inputs, reps) as TimeResult)
      times.set(engine.label, list)
    }
  }
  return engines.map(engine => {
    console.log(`memory: ${engine.label} ${engine.version}`)
    const runs = times.get(engine.label)!
    const first = runs[0]!
    return {
      label: engine.label,
      version: engine.version,
      time: {
        importMs: Math.min(...runs.map(run => run.importMs)),
        firstRenderMs: Math.min(...runs.map(run => run.firstRenderMs)),
        results: first.results.map((result, index) => ({ ...result, ms: Math.min(...runs.map(run => run.results[index]!.ms)) })),
      },
      memory: runWorker(out, engine.entry, 'memory', inputs, reps) as MemoryResult,
    }
  })
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
const ms = (value: number) => value < 10 ? `${value.toFixed(2)} ms` : `${value.toFixed(0)} ms`
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const ratio = (candidate: number, baseline: number) => baseline > 0 ? candidate / baseline : 1
const times = (value: number) => `${value.toFixed(2)}×`

interface Check { name: string; ok: boolean; detail: string }

function report(inputs: Input[], runs: EngineRun[]): { checks: Check[]; markdown: string; summary: unknown } {
  const candidate = runs.at(-1)!
  const baseline = runs.length > 1 ? runs[0]! : undefined
  const byId = (run: EngineRun) => new Map(run.time.results.map(result => [result.id, result]))
  const memById = (run: EngineRun) => new Map(run.memory.perInput.map(result => [result.id, result]))
  const cand = byId(candidate)
  const base = baseline ? byId(baseline) : undefined
  const checks: Check[] = []

  // Correctness.
  const nondeterministic = inputs.filter(input => !cand.get(input.id)!.deterministic).map(input => input.id)
  checks.push({ name: 'Deterministic output', ok: nondeterministic.length === 0, detail: nondeterministic.join(', ') || 'every SVG and ASCII render repeats byte for byte' })
  const unparsable = inputs.filter(input => {
    const svg = cand.get(input.id)!.svg
    if (!svg.ok || parsesAsSvg(svg.output)) return false
    const before = base?.get(input.id)?.svg
    return !before?.ok || parsesAsSvg(before.output)
  }).map(input => input.id)
  checks.push({ name: 'SVG parses (resvg)', ok: unparsable.length === 0, detail: unparsable.join(', ') || 'every rendered SVG parses' })
  if (base) {
    const lostSvg = inputs.filter(input => base.get(input.id)!.svg.ok && !cand.get(input.id)!.svg.ok).map(input => input.id)
    const lostAscii = inputs.filter(input => base.get(input.id)!.ascii.ok && !cand.get(input.id)!.ascii.ok).map(input => input.id)
    checks.push({ name: 'No lost SVG renders', ok: lostSvg.length === 0, detail: lostSvg.map(id => `${id}: ${(cand.get(id)!.svg as { error: string }).error}`).join('; ') || 'none' })
    checks.push({ name: 'No lost ASCII renders', ok: lostAscii.length === 0, detail: lostAscii.join(', ') || 'none' })
  }

  // Performance.
  const corpus = inputs.filter(input => input.kind === 'corpus')
  const scaling = inputs.filter(input => input.kind === 'scaling')
  const total = (run: Map<string, { ms: number }>, list: Input[]) => sum(list.map(input => run.get(input.id)!.ms))
  if (base) {
    const corpusRatio = ratio(total(cand, corpus), total(base, corpus))
    checks.push({ name: `Corpus render time ≤ ${GATES.corpusSlowdown}× baseline`, ok: corpusRatio <= GATES.corpusSlowdown, detail: times(corpusRatio) })
    const slowCases = scaling.filter(input => ratio(cand.get(input.id)!.ms, base.get(input.id)!.ms) > GATES.caseSlowdown)
    checks.push({ name: `Each large case ≤ ${GATES.caseSlowdown}× baseline`, ok: slowCases.length === 0, detail: slowCases.map(input => `${input.id} ${times(ratio(cand.get(input.id)!.ms, base.get(input.id)!.ms))}`).join(', ') || 'all within' })
  }

  // Memory.
  if (baseline) {
    const allocationRatio = ratio(candidate.memory.passAllocatedBytes, baseline.memory.passAllocatedBytes)
    const rssRatio = ratio(candidate.memory.peakRssBytes, baseline.memory.peakRssBytes)
    checks.push({ name: `Allocation per pass ≤ ${GATES.allocationGrowth}× baseline`, ok: allocationRatio <= GATES.allocationGrowth, detail: times(allocationRatio) })
    checks.push({ name: `Peak RSS ≤ ${GATES.rssGrowth}× baseline`, ok: rssRatio <= GATES.rssGrowth, detail: times(rssRatio) })
  }
  checks.push({
    name: `Retained heap growth per pass ≤ ${mb(GATES.retainedGrowthBytes)}`,
    ok: candidate.memory.retainedGrowthBytes <= GATES.retainedGrowthBytes,
    detail: mb(candidate.memory.retainedGrowthBytes),
  })

  // Markdown.
  const engines = runs.map(run => `${run.label} ${run.version}`)
  const md: string[] = []
  const ok = checks.every(check => check.ok)
  md.push(`# Release benchmark: ${ok ? 'pass' : 'FAIL'}`, '')
  md.push(`Engines: ${engines.join(' vs ')}. Inputs: ${corpus.length} official syntax fences across ${new Set(corpus.map(input => input.family)).size} families, ${scaling.length} generated large diagrams. Node ${process.versions.node}.`, '')
  md.push('| Gate | Result | Detail |', '|---|---|---|')
  for (const check of checks) md.push(`| ${check.name} | ${check.ok ? 'pass' : '**FAIL**'} | ${check.detail.replace(/\|/g, '\\|')} |`)

  const columns = (run: EngineRun, list: Input[]) => {
    const results = byId(run)
    const memory = memById(run)
    return {
      rendered: list.filter(input => results.get(input.id)!.svg.ok).length,
      ms: total(results, list),
      allocated: sum(list.map(input => memory.get(input.id)!.allocatedBytes)),
      peak: Math.max(...list.map(input => memory.get(input.id)!.peakHeapBytes)),
    }
  }
  const families = [...new Set(corpus.map(input => input.family))].sort()
  md.push('', '## Corpus by family', '')
  const header = runs.length > 1
    ? ['Family', 'Fences', 'Rendered (base → cand)', 'Changed SVGs', 'Time (base → cand)', 'Speed-up', 'Allocated (base → cand)']
    : ['Family', 'Fences', 'Rendered', 'Time', 'Allocated']
  md.push(`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`)
  for (const family of [...families, 'all']) {
    const list = family === 'all' ? corpus : corpus.filter(input => input.family === family)
    const c = columns(candidate, list)
    const name = family === 'all' ? '**all**' : family
    if (baseline && base) {
      const b = columns(baseline, list)
      const changed = list.filter(input => {
        const before = base.get(input.id)!.svg
        const after = cand.get(input.id)!.svg
        return before.ok !== after.ok || (before.ok && after.ok && before.output !== after.output)
      }).length
      md.push(`| ${name} | ${list.length} | ${b.rendered} → ${c.rendered} | ${changed} | ${ms(b.ms)} → ${ms(c.ms)} | ${times(ratio(b.ms, c.ms))} | ${mb(b.allocated)} → ${mb(c.allocated)} |`)
    } else {
      md.push(`| ${name} | ${list.length} | ${c.rendered} | ${ms(c.ms)} | ${mb(c.allocated)} |`)
    }
  }

  md.push('', '## Large generated diagrams', '')
  md.push(baseline
    ? '| Case | Time (base → cand) | Speed-up | Allocated (base → cand) | Peak heap (base → cand) | SVG changed |\n|---|---|---|---|---|---|'
    : '| Case | Time | Allocated | Peak heap |\n|---|---|---|---|')
  for (const input of scaling) {
    const c = columns(candidate, [input])
    if (baseline && base) {
      const b = columns(baseline, [input])
      const before = base.get(input.id)!.svg
      const after = cand.get(input.id)!.svg
      const changed = before.ok !== after.ok || (before.ok && after.ok && before.output !== after.output)
      md.push(`| ${input.id} | ${ms(b.ms)} → ${ms(c.ms)} | ${times(ratio(b.ms, c.ms))} | ${mb(b.allocated)} → ${mb(c.allocated)} | ${mb(b.peak)} → ${mb(c.peak)} | ${changed ? 'yes' : 'no'} |`)
    } else {
      md.push(`| ${input.id} | ${ms(c.ms)} | ${mb(c.allocated)} | ${mb(c.peak)} |`)
    }
  }

  md.push('', '## Process', '')
  md.push(`| Metric | ${engines.join(' | ')} |`, `|---|${engines.map(() => '---').join('|')}|`)
  md.push(`| Import | ${runs.map(run => ms(run.time.importMs)).join(' | ')} |`)
  md.push(`| First render | ${runs.map(run => ms(run.time.firstRenderMs)).join(' | ')} |`)
  md.push(`| Allocated per corpus+cases pass | ${runs.map(run => mb(run.memory.passAllocatedBytes)).join(' | ')} |`)
  md.push(`| Peak heap during pass | ${runs.map(run => mb(run.memory.passPeakHeapBytes)).join(' | ')} |`)
  md.push(`| Retained heap growth per pass | ${runs.map(run => mb(run.memory.retainedGrowthBytes)).join(' | ')} |`)
  md.push(`| Peak RSS | ${runs.map(run => mb(run.memory.peakRssBytes)).join(' | ')} |`)
  md.push('', 'Times are the fastest per-input median across interleaved rounds. Allocation is V8 heap allocated between GCs, measured in a separate process.')

  const summary = {
    ok,
    checks,
    engines: runs.map(run => ({
      label: run.label,
      version: run.version,
      importMs: run.time.importMs,
      firstRenderMs: run.time.firstRenderMs,
      corpusMs: total(byId(run), corpus),
      cases: Object.fromEntries(scaling.map(input => [input.id, byId(run).get(input.id)!.ms])),
      memory: { ...run.memory, perInput: undefined },
    })),
  }
  return { checks, markdown: md.join('\n') + '\n', summary }
}

const options = args()
const out = resolve(options.get('out') ?? join(ROOT, 'bench-report'))
mkdirSync(out, { recursive: true })
const rounds = Number(options.get('rounds') ?? 3)
const reps = Number(options.get('reps') ?? 5)
const engines = [] as { label: string; entry: string; version: string }[]
const baselineDir = options.get('baseline') ?? (options.has('baseline-npm') ? installFromNpm(options.get('baseline-npm')!) : undefined)
if (baselineDir) engines.push(packageAt(resolve(baselineDir), 'baseline'))
engines.push(packageAt(resolve(options.get('candidate') ?? ROOT), 'candidate'))

const inputs: Input[] = [
  ...extractOfficialCorpus().map(fence => ({ ...fence, kind: 'corpus' as const })),
  ...releaseBenchCases().map(benchCase => ({ ...benchCase, kind: 'scaling' as const })),
]
const runs = measure(out, engines, inputs, rounds, reps)
const { checks, markdown, summary } = report(inputs, runs)
writeFileSync(join(out, 'report.json'), JSON.stringify(summary, null, 2))
writeFileSync(join(out, 'report.md'), markdown)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
console.log(markdown)
if (!checks.every(check => check.ok)) process.exit(1)
