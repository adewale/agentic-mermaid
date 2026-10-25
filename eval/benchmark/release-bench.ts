import './ci-policy-enforce.ts'
// Compare built packages in alternating fresh Node processes. Publication runs
// use --candidate-tarball: the measured bytes are the bytes queued for npm.
// Reports are generated evidence, never committed baselines.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { extractOfficialCorpus, officialCorpusInventory } from '../shared/official-fences.ts'
import { releaseBenchCases } from './release-bench-cases.ts'
import { agentEditCase } from './release-bench-fidelity.ts'
import { resolveBaseline, assertHistoricalAgenticRuntimes, assertNormalizedNpmRuntimes, frozenRuntimePolicy, installAgenticRuntime, installNormalizedNpmBaseline, inspectAgenticRuntime, assertMatchedAgenticRuntimes, type BaselineLock, type RuntimeReceipt } from './release-baseline.ts'
import type { BenchInput, MemoryResult, Outcome, OutputFingerprint, TimeResult } from './release-bench-types.ts'

export interface Input extends BenchInput {
  kind: 'corpus' | 'scaling' | 'workflow'
}
export interface Group {
  name: string
  inputs: Input[]
  budgetMs: number
}
interface Identity {
  kind: 'directory' | 'npm' | 'tarball'
  requested: string
  sha256?: string
  integrity?: string
  dependencyLock?: { path: string; sha256: string }
  runtime?: RuntimeReceipt
}
interface Engine {
  label: string
  entry: string
  version: string
  identity: Identity
}
interface Rendered {
  svg: Outcome
  ascii: OutputFingerprint
  deterministic: boolean
  validSvg: boolean
  mediansMs: number[]
  samplesMs: number[][]
  missingSvgLabels: string[]
}
export interface EngineRun extends Engine {
  node?: string
  importMs: number[]
  firstRenderMs: number[]
  firstRender?: OutputFingerprint
  coldDeterministic: boolean
  results: Map<string, Rendered>
  memory: Map<string, MemoryResult & { inputIds: string[] }>
  failures: Map<string, string>
}
interface Check {
  name: string
  ok: boolean | null
  detail: string
}
const ROOT = resolve(import.meta.dir, '..', '..')
const WORKER = join(import.meta.dir, 'release-bench-worker.ts')
const GATES = { corpusSlowdown: 1.25, familySlowdown: 1.5, caseSlowdown: 1.5, allocationGrowth: 1.25, rssGrowth: 1.25, retainedGrowthBytes: 16 * 1024 * 1024 }
const CORPUS_BUDGET_MS = 30 * 60 * 1000
const CASE_BUDGET_MS = 10 * 60 * 1000
const DEFAULT_BUDGET_MS = 70 * 60 * 1000

function args(): Map<string, string> {
  const allowed = new Set(['out', 'rounds', 'reps', 'budget-ms', 'baseline', 'baseline-npm', 'baseline-lock', 'baseline-tarball', 'baseline-sha256', 'candidate', 'candidate-tarball', 'candidate-sha256', 'case', 'elk-cache', 'runtime-source', 'baseline-runtime-source', 'runtime-comparison'])
  const options = new Map<string, string>()
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!.slice(2)
    const value = argv[++i]
    if (!argv[i - 1]!.startsWith('--') || !allowed.has(key)) throw new Error(`Unknown option ${argv[i - 1]}`)
    if (!value || value.startsWith('--') || options.has(key)) throw new Error(`Provide one value for --${key}`)
    options.set(key, value)
  }
  for (const [a, b] of [
    ['baseline', 'baseline-npm'],
    ['baseline', 'baseline-tarball'],
    ['baseline-npm', 'baseline-tarball'],
    ['candidate', 'candidate-tarball'],
  ] as const) {
    if (options.has(a) && options.has(b)) throw new Error(`Use only one of --${a} and --${b}`)
  }
  const runtimeComparison = options.get('runtime-comparison') ?? 'matched'
  if (!['matched', 'historical-compound', 'normalized-npm-compound'].includes(runtimeComparison)) throw new Error('--runtime-comparison must be matched, historical-compound or normalized-npm-compound')
  if (runtimeComparison === 'normalized-npm-compound' && !options.has('baseline-npm')) throw new Error('Normalized npm comparison requires --baseline-npm; Git/directory/tarball comparisons remain strict')
  if (runtimeComparison === 'historical-compound' && (!options.has('baseline-runtime-source') || !['baseline', 'baseline-npm', 'baseline-tarball'].some(key => options.has(key)))) throw new Error('Historical comparison requires a baseline and --baseline-runtime-source')
  if (runtimeComparison !== 'historical-compound' && options.has('baseline-runtime-source')) throw new Error('--baseline-runtime-source requires historical-compound mode')
  if (options.has('baseline-tarball') !== options.has('baseline-sha256')) throw new Error('Provide both --baseline-tarball and --baseline-sha256')
  if (options.has('candidate-sha256') && (!options.has('candidate-tarball') || !/^[a-f0-9]{64}$/.test(options.get('candidate-sha256')!))) {
    throw new Error('--candidate-sha256 requires --candidate-tarball and a lowercase SHA-256 digest')
  }
  if (options.has('baseline-lock') && !options.has('baseline-npm')) throw new Error('--baseline-lock requires --baseline-npm')
  if (options.has('elk-cache') && !['on', 'off'].includes(options.get('elk-cache')!)) throw new Error('--elk-cache must be on or off')
  return options
}
function positive(options: Map<string, string>, key: string, fallback: number): number {
  const value = Number(options.get(key) ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${key} must be a positive integer`)
  return value
}
function packageAt(dir: string, label: string, identity: Identity): Engine {
  const entry = join(dir, 'dist', 'index.js')
  if (!existsSync(entry)) throw new Error(`${label}: ${entry} does not exist; build the package first`)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string }
  if (pkg.name !== 'agentic-mermaid') throw new Error(`${label}: expected agentic-mermaid, got ${pkg.name}`)
  return { label, entry, version: pkg.version, identity }
}
const fingerprint = (outcome: Outcome): OutputFingerprint => {
  const text = outcome.ok ? outcome.output : outcome.error
  return { ok: outcome.ok, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) }
}
const same = (a: OutputFingerprint, b: OutputFingerprint) => a.ok === b.ok && a.sha256 === b.sha256 && a.bytes === b.bytes
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const ratio = (a: number | undefined, b: number | undefined) => (a !== undefined && b !== undefined && b > 0 ? a / b : undefined)
const ms = (n: number | undefined) => (n === undefined ? '—' : `${n.toFixed(n < 10 ? 2 : 0)} ms`)
const mb = (n: number | undefined) => (n === undefined ? '—' : `${(n / 1024 / 1024).toFixed(1)} MiB`)
const times = (n: number | undefined) => (n === undefined ? '—' : `${n.toFixed(2)}×`)
function parsesAsSvg(svg: string): boolean {
  try {
    new Resvg(svg, { font: { loadSystemFonts: false } })
    return true
  } catch {
    return false
  }
}
function successful(run: EngineRun, input: Input, rounds: number): boolean {
  const result = run.results.get(input.id)
  return !!result?.svg.ok && result.validSvg && result.deterministic && !result.missingSvgLabels.length && result.mediansMs.length === rounds
}

function measure(out: string, engines: Engine[], groups: Group[], rounds: number, reps: number, deadline: number, elkCache: 'on' | 'off'): EngineRun[] {
  const runs: EngineRun[] = engines.map(engine => ({ ...engine, importMs: [], firstRenderMs: [], coldDeterministic: true, results: new Map(), memory: new Map(), failures: new Map() }))
  const record = (value: unknown) => appendFileSync(join(out, 'samples.jsonl'), `${JSON.stringify(value)}\n`)
  function worker(run: EngineRun, mode: 'time' | 'memory', group: Group, round?: number): TimeResult | MemoryResult | undefined {
    const budgetMs = Math.min(group.budgetMs, deadline - Date.now())
    let reason: string | undefined
    if (budgetMs <= 0) reason = 'overall benchmark budget exhausted'
    else {
      const job = join(out, 'job.json')
      const result = join(out, 'result.json')
      rmSync(result, { force: true })
      writeFileSync(job, JSON.stringify({ entry: run.entry, mode, inputs: group.inputs, reps }))
      // Default to timing ELK; cache-on measures repeated rendering as a host sees it.
      const child = spawnSync('node', [...(mode === 'memory' ? ['--expose-gc'] : []), '--no-warnings', WORKER, job, result], { stdio: 'inherit', timeout: budgetMs, killSignal: 'SIGKILL', env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: elkCache === 'on' ? '1' : '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
      if (child.status === 0) {
        const value = JSON.parse(readFileSync(result, 'utf8')) as TimeResult | MemoryResult
        const evidence =
          mode === 'time'
            ? {
                ...value,
                results: (value as TimeResult).results.map(({ svg, ...rest }) => ({ ...rest, svg: fingerprint(svg) })),
              }
            : value
        record({ engine: run.label, group: group.name, mode, round, inputIds: group.inputs.map(input => input.id), value: evidence })
        return value
      }
      reason = child.error?.message ?? `exited with ${child.status ?? child.signal}`
    }
    run.failures.set(`${mode}:${group.name}`, reason)
    record({ engine: run.label, group: group.name, mode, round, failure: reason })
    return undefined
  }
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? runs : [...runs].reverse()
    for (const group of groups) {
      for (const run of order) {
        if (run.failures.has(`time:${group.name}`)) continue
        console.log(`round ${round + 1}/${rounds}: ${run.label} ${run.version} ${group.name}`)
        const value = worker(run, 'time', group, round + 1) as TimeResult | undefined
        if (!value) continue
        run.node = value.node
        run.importMs.push(value.importMs)
        run.firstRenderMs.push(value.firstRenderMs)
        run.coldDeterministic &&= !run.firstRender || same(run.firstRender, value.firstRender)
        run.firstRender ??= value.firstRender
        for (const { id, svg, ascii, deterministic, ms: elapsed, samplesMs, missingSvgLabels } of value.results) {
          const previous = run.results.get(id)
          if (previous) {
            previous.deterministic &&= deterministic && same(fingerprint(previous.svg), fingerprint(svg)) && same(previous.ascii, ascii)
            previous.mediansMs.push(elapsed)
            previous.samplesMs.push(samplesMs)
            previous.missingSvgLabels = [...new Set([...previous.missingSvgLabels, ...missingSvgLabels])]
          } else run.results.set(id, { svg, ascii, deterministic, validSvg: svg.ok && parsesAsSvg(svg.output), mediansMs: [elapsed], samplesMs: [samplesMs], missingSvgLabels })
        }
      }
    }
    if (Date.now() >= deadline || runs.every(run => groups.every(group => run.failures.has(`time:${group.name}`)))) break
  }
  // A fresh memory process sees only the common, stable successful population.
  // Unsupported inputs and newly supported families cannot skew its caches/RSS.
  for (const group of groups) {
    const inputs = group.inputs.filter(input => runs.every(run => successful(run, input, rounds)))
    if (!inputs.length) continue
    for (const run of runs) {
      console.log(`memory: ${run.label} ${run.version} ${group.name} (${inputs.length} shared inputs)`)
      const value = worker(run, 'memory', { ...group, inputs }) as MemoryResult | undefined
      if (value) run.memory.set(group.name, { ...value, inputIds: inputs.map(input => input.id) })
    }
  }
  const candidate = runs.at(-1)!
  const corpus = groups.find(group => group.name === 'corpus')
  const candidateInputs = corpus?.inputs.filter(input => successful(candidate, input, rounds)) ?? []
  const matchedCount = corpus?.inputs.filter(input => runs.every(run => successful(run, input, rounds))).length ?? 0
  if (corpus && candidateInputs.length && candidateInputs.length !== matchedCount) {
    console.log(`memory: candidate ${candidate.version} full successful corpus (${candidateInputs.length} inputs)`)
    const value = worker(candidate, 'memory', { ...corpus, name: 'candidate-corpus', inputs: candidateInputs }) as MemoryResult | undefined
    if (value) candidate.memory.set('candidate-corpus', { ...value, inputIds: candidateInputs.map(input => input.id) })
  }
  rmSync(join(out, 'job.json'), { force: true })
  rmSync(join(out, 'result.json'), { force: true })
  return runs
}

export function report(inputs: Input[], groups: Group[], runs: EngineRun[], rounds: number) {
  const candidate = runs.at(-1)!
  const baseline = runs.length > 1 ? runs[0]! : undefined
  const measured = (list: Input[]) => list.filter(input => runs.every(run => run.results.get(input.id)?.mediansMs.length === rounds))
  const shared = (list: Input[]) => list.filter(input => runs.every(run => successful(run, input, rounds)))
  // Aggregate the same rep/round before comparing engines. A sum of independent
  // per-input medians is not an observed corpus pass and loses round covariance.
  const roundTotals = (run: EngineRun, list: Input[]) => list.length ? Array.from({ length: rounds }, (_, round) => {
    const samples = list.map(input => run.results.get(input.id)!.samplesMs[round]!)
    return median(samples[0]!.map((_, rep) => sum(samples.map(values => values[rep]!))))!
  }) : []
  const total = (run: EngineRun, list: Input[]) => list.length ? median(roundTotals(run, list)) : undefined
  const timeRatio = (list: Input[]) => baseline && list.length ? median(roundTotals(candidate, list).map((value, round) => value / roundTotals(baseline, list)[round]!)) : undefined
  const corpus = inputs.filter(input => input.kind === 'corpus')
  const scaling = inputs.filter(input => input.kind !== 'corpus')
  const checks: Check[] = []
  const completeMemory = (value: MemoryResult | undefined) => value !== undefined && [value.settledHeapBytes, value.retainedHeapBytes].every(bytes => Number.isFinite(bytes) && bytes >= 0)
  const incompleteMemory = (run: EngineRun) => [...run.memory].filter(([, value]) => !completeMemory(value)).map(([name]) => name)
  const addRatio = (name: string, value: number | undefined, limit: number) => checks.push({ name, ok: value === undefined ? null : value <= limit, detail: value === undefined ? 'not compared: no matched measurement' : times(value) })
  const incomplete = inputs.filter(input => candidate.results.get(input.id)?.mediansMs.length !== rounds)
  checks.push({
    name: 'Every candidate measurement completes',
    ok: candidate.failures.size === 0 && !incomplete.length && !incompleteMemory(candidate).length,
    detail: [...candidate.failures].map(([group, reason]) => `${group}: ${reason}`).join('; ') || (incompleteMemory(candidate).length ? `incomplete absolute heap observations: ${incompleteMemory(candidate).join(', ')}` : `${inputs.length - incomplete.length}/${inputs.length} inputs completed ${rounds} rounds`),
  })
  checks.push({ name: 'Cold SVG render succeeds', ok: candidate.firstRender?.ok === true, detail: candidate.firstRender?.error ?? (candidate.firstRender?.ok ? 'flowchart rendered' : 'not measured') })
  const unstable = [...candidate.results].filter(([, result]) => !result.deterministic).map(([id]) => id)
  checks.push({ name: 'Deterministic SVG and ASCII output', ok: candidate.coldDeterministic && !unstable.length, detail: unstable.join(', ') || (candidate.coldDeterministic ? 'all repeats and fresh processes agree' : 'cold renders differ between processes') })
  const invalid = [...candidate.results].filter(([id, result]) => result.svg.ok && !result.validSvg && !(baseline?.results.get(id)?.svg.ok && !baseline.results.get(id)!.validSvg)).map(([id]) => id)
  checks.push({ name: 'No newly invalid SVGs (resvg)', ok: !invalid.length, detail: invalid.join(', ') || 'none; existing baseline parse failures are excluded from comparisons' })
  const missingContent = [...candidate.results].filter(([, result]) => result.missingSvgLabels.length)
  checks.push({ name: 'Expected SVG labels survive rendering', ok: !missingContent.length, detail: missingContent.map(([id, result]) => `${id}: ${result.missingSvgLabels.join(', ')}`).join('; ') || 'all enrolled label assertions pass' })
  const failedWorkloads = scaling.filter(input => !successful(candidate, input, rounds))
  checks.push({ name: 'Every scaling and agent workflow succeeds', ok: !failedWorkloads.length, detail: failedWorkloads.map(input => input.id).join(', ') || `${scaling.length} workloads passed` })
  if (baseline) {
    const incompleteBaseline = inputs.filter(input => baseline.results.get(input.id)?.mediansMs.length !== rounds)
    checks.push({
      name: 'Every required baseline measurement completes',
      ok: baseline.failures.size === 0 && !incompleteBaseline.length && !incompleteMemory(baseline).length,
      detail: [...baseline.failures].map(([group, reason]) => `${group}: ${reason}`).join('; ') || (incompleteMemory(baseline).length ? `incomplete absolute heap observations: ${incompleteMemory(baseline).join(', ')}` : `${inputs.length - incompleteBaseline.length}/${inputs.length} inputs completed ${rounds} rounds`),
    })
    checks.push({ name: 'Baseline has comparable successful SVG measurements', ok: shared(inputs).length > 0 && (!corpus.length || shared(corpus).length > 0), detail: `${shared(inputs).length}/${inputs.length} total; ${shared(corpus).length}/${corpus.length} corpus inputs compared` })
    for (const format of ['svg', 'ascii'] as const) {
      const lost = measured(inputs).filter(input => baseline.results.get(input.id)![format].ok && !candidate.results.get(input.id)![format].ok)
      checks.push({ name: `No lost ${format.toUpperCase()} renders`, ok: !lost.length, detail: lost.map(input => input.id).join(', ') || 'none' })
    }
    addRatio(`Corpus render time ≤ ${GATES.corpusSlowdown}× baseline`, timeRatio(shared(corpus)), GATES.corpusSlowdown)
    const slowFamilies = [...new Set(corpus.map(input => input.family))].filter(family => {
      const list = shared(corpus.filter(input => input.family === family))
      return list.length && timeRatio(list)! > GATES.familySlowdown
    })
    checks.push({ name: `Each compared family ≤ ${GATES.familySlowdown}× baseline`, ok: !slowFamilies.length, detail: slowFamilies.join(', ') || 'no family regression on shared successes' })
    const comparable = shared(scaling)
    const slow = comparable.filter(input => timeRatio([input])! > GATES.caseSlowdown)
    checks.push({ name: `Each large case ≤ ${GATES.caseSlowdown}× baseline`, ok: comparable.length ? !slow.length : null, detail: `${comparable.length}/${scaling.length} compared${slow.length ? `; slow: ${slow.map(input => input.id).join(', ')}` : ''}` })
    const before = baseline.memory.get('corpus')
    const after = candidate.memory.get('corpus')
    if (shared(corpus).length)
      checks.push({ name: 'Required matched corpus memory measurements complete', ok: completeMemory(before) && completeMemory(after), detail: completeMemory(before) && completeMemory(after) ? `${before!.inputIds.length} shared inputs` : 'incomplete: missing baseline or candidate absolute heap observations' })
    addRatio(`Corpus allocation ≤ ${GATES.allocationGrowth}× baseline`, ratio(after?.passAllocatedBytes, before?.passAllocatedBytes), GATES.allocationGrowth)
    addRatio(`Corpus peak RSS ≤ ${GATES.rssGrowth}× baseline`, ratio(after?.peakRssBytes, before?.peakRssBytes), GATES.rssGrowth)
  }
  const memory = candidate.memory.get('candidate-corpus') ?? candidate.memory.get('corpus')
  checks.push({
    name: `Retained heap growth per corpus pass ≤ ${mb(GATES.retainedGrowthBytes)}`,
    ok: memory ? memory.retainedGrowthBytes <= GATES.retainedGrowthBytes : null,
    detail: memory ? `${mb(memory.retainedGrowthBytes)} across ${memory.inputIds.length} successful candidate inputs` : 'not measured: no successful corpus inputs',
  })
  const ok = checks.every(check => check.ok !== false)
  const md = [`# Release benchmark: ${ok ? 'pass' : 'FAIL'}`, '', `Engines: ${runs.map(run => `${run.label} ${run.version}`).join(' vs ')}. Inputs: ${corpus.length} distinct official examples and ${scaling.length} scaling/agent workloads. Full upstream fence accounting is in corpus.json; browser/competitor results are advisory in browser-report.md.`, '', '| Gate | Result | Detail |', '|---|---|---|']
  for (const check of checks) md.push(`| ${check.name} | ${check.ok === null ? 'not compared' : check.ok ? 'pass' : '**FAIL**'} | ${check.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
  if (baseline?.failures.size) md.push('', `Baseline measurements unavailable: ${[...baseline.failures].map(([group, reason]) => `${group}: ${reason}`).join('; ')}.`, '')
  md.push(
    '',
    '## Matched successful SVG renders',
    '',
    'All time, allocation and RSS comparisons use the same stable, parseable SVG inputs in both engines. Rejections are excluded. Counts of rendered SVGs include every measured input; newly supported inputs are reported without a speed comparison.',
    '',
    '| Family / case | Measured | SVG renders (base → cand) | Changed SVGs | Compared | Time (base → cand) | Speed-up | Allocated (base → cand) |',
    '|---|---|---|---|---|---|---|---|',
  )
  const allocation = (run: EngineRun, list: Input[]) => {
    const heaps = [...run.memory.values()].flatMap(value => value.perInput)
    const selected = list.map(input => heaps.find(heap => heap.id === input.id))
    return selected.length && selected.every(Boolean) ? sum(selected.map(heap => heap!.allocatedBytes)) : undefined
  }
  const row = (name: string, list: Input[]) => {
    const comparable = shared(list)
    const rendered = (run: EngineRun | undefined) => (run ? list.filter(input => run.results.get(input.id)?.svg.ok).length : '—')
    const changed = baseline
      ? measured(list).filter(input => {
          const before = baseline.results.get(input.id)!.svg
          const after = candidate.results.get(input.id)!.svg
          return (before.ok || after.ok) && !same(fingerprint(before), fingerprint(after))
        }).length
      : '—'
    md.push(
      `| ${name} | ${measured(list).length}/${list.length} | ${rendered(baseline)} → ${rendered(candidate)} | ${changed} | ${comparable.length} | ${baseline ? ms(total(baseline, comparable)) : '—'} → ${ms(total(candidate, comparable))} | ${baseline ? times(timeRatio(comparable) === undefined ? undefined : 1 / timeRatio(comparable)!) : '—'} | ${baseline ? mb(allocation(baseline, comparable)) : '—'} → ${mb(allocation(candidate, comparable))} |`,
    )
  }
  for (const family of [...new Set(corpus.map(input => input.family))].sort())
    row(
      family,
      corpus.filter(input => input.family === family),
    )
  if (corpus.length) row('**all corpus**', corpus)
  for (const input of scaling) row(input.id, [input])
  const commonCorpus = shared(corpus)
  md.push('', '## Paired corpus rounds', '', '| Round | Baseline | Candidate | Candidate / baseline |', '|---|---:|---:|---:|')
  const beforeRounds = baseline ? roundTotals(baseline, commonCorpus) : []
  const afterRounds = roundTotals(candidate, commonCorpus)
  afterRounds.forEach((value, round) => md.push(`| ${round + 1} | ${ms(beforeRounds[round])} | ${ms(value)} | ${times(ratio(value, beforeRounds[round]))} |`))
  const contributors = commonCorpus.map(input => ({ id: input.id, family: input.family, medianMs: total(candidate, [input])!, baselineMs: baseline ? total(baseline, [input]) : undefined })).sort((a, b) => b.medianMs - a.medianMs).slice(0, 10)
  const latency = runs.map(run => {
    const values = commonCorpus.flatMap(input => run.results.get(input.id)!.samplesMs.flat()).sort((a, b) => a - b)
    return { engine: run.label, samples: values.length, p50Ms: median(values), p95Ms: values[Math.ceil(values.length * 0.95) - 1], maxMs: values.at(-1) }
  })
  md.push('', 'Matched-corpus call latency (same input population; distribution across examples/repeats, not a confidence interval):', '', '| Engine | Samples | p50 | p95 | Max |', '|---|---:|---:|---:|---:|')
  for (const row of latency) md.push(`| ${row.engine} | ${row.samples} | ${ms(row.p50Ms)} | ${ms(row.p95Ms)} | ${ms(row.maxMs)} |`)
  md.push('', '## Largest candidate time contributors', '', '| Input | Candidate median | Baseline median |', '|---|---:|---:|')
  for (const input of contributors) md.push(`| ${input.id} | ${ms(input.medianMs)} | ${ms(input.baselineMs)} |`)
  md.push('', '## Fresh processes and memory', '', `| Metric | ${runs.map(run => `${run.label} ${run.version}`).join(' | ')} |`, `|---|${runs.map(() => '---').join('|')}|`)
  const metric = (name: string, values: string[]) => md.push(`| ${name} | ${values.join(' | ')} |`)
  metric(
    'Import (median)',
    runs.map(run => ms(median(run.importMs))),
  )
  metric(
    'First SVG render after import (median)',
    runs.map(run => ms(median(run.firstRenderMs))),
  )
  for (const group of [...groups, { name: 'candidate-corpus' }]) {
    if (!runs.some(run => run.memory.has(group.name))) continue
    metric(
      `${group.name}: measured inputs`,
      runs.map(run => String(run.memory.get(group.name)?.inputIds.length ?? '—')),
    )
    for (const [key, label] of [
      ['passAllocatedBytes', 'allocated / pass'],
      ['passPeakHeapBytes', 'peak heap during pass'],
      ['settledHeapBytes', 'settled heap before pass (post-GC)'],
      ['retainedHeapBytes', 'retained heap after pass (post-GC)'],
      ['retainedGrowthBytes', 'retained heap growth / pass'],
      ['peakRssBytes', 'process-lifetime peak RSS (getrusage)'],
    ] as const)
      metric(
        `${group.name}: ${label}`,
        runs.map(run => mb(run.memory.get(group.name)?.[key])),
      )
  }
  for (const group of [...groups, { name: 'candidate-corpus' }]) {
    if (!runs.some(run => run.memory.get(group.name)?.rss)) continue
    for (const [checkpoint, label] of [
      ['workerStart', 'worker entry after static imports, before job/package loading'],
      ['beforeMemoryWork', 'after package imports, before memory warmup'],
      ['afterMemoryWork', 'after memory measurement and final GC'],
    ] as const) {
      for (const [key, metricLabel] of [['currentRssBytes', 'current RSS'], ['maxRssBytes', 'process-lifetime peak RSS'], ['linuxVmHwmBytes', 'Linux current-mm VmHWM']] as const) {
        metric(`${group.name}: ${label}: ${metricLabel}`, runs.map(run => {
          const sample = run.memory.get(group.name)?.rss?.[checkpoint]
          const value = sample?.[key]
          return typeof value === 'number' ? mb(value) : sample?.linuxVmHwmUnavailableReason ?? 'not recorded'
        }))
      }
    }
  }
  md.push(
    '',
    'Times aggregate each observed rep over the matched inputs, take its within-process median, and report the median across interleaved rounds. Ratios pair the same round before taking their median. All SVG/ASCII correctness passes precede warm timings. Cold measurements include import and first render separately, without process launch or a cold filesystem. Memory comparisons use separate fresh processes restricted to the matched inputs; an additional candidate corpus pass includes newly supported inputs for the absolute retained-heap gate. Allocation and peak heap are V8 estimates sampled at GC boundaries. Settled and retained heap are absolute used heap before and after one pass, each after GC; growth is their nonnegative difference. A single memory pair does not establish a retained-heap noise floor. The backward-compatible peakRssBytes field is the process-lifetime getrusage maximum, including any inherited exec floor; its origin is not proven by these checkpoints. New receipts separately record current RSS and Linux current-mm VmHWM at worker entry after static imports, before memory warmup after package imports, and after measurement/final GC. Linux VmHWM is null with an explicit reason where unavailable; historical receipts have no checkpoints. Samples are sequential, not atomic. These resident-memory diagnostics are not allocation measurements or renderer-only peaks, and do not change any gate. A single pair does not establish an RSS noise floor; use matched A/A controls before attributing a difference. ASCII is checked for correctness, not timed. The agent workload measures parse, mutate, verify, serialize, re-parse, fact checks and SVG render together. Full samples, output fingerprints, package identities and machine metadata accompany this report.',
  )
  return {
    ok,
    markdown: `${md.join('\n')}\n`,
    summary: {
      ok,
      status: 'completed',
      checks,
      pairedCorpus: { inputIds: commonCorpus.map(input => input.id), baselineMs: beforeRounds, candidateMs: afterRounds, candidateOverBaseline: timeRatio(commonCorpus) },
      largestContributors: contributors,
      matchedLatency: latency,
      groups: groups.map(group => ({ name: group.name, inputIds: group.inputs.map(input => input.id), comparedInputIds: shared(group.inputs).map(input => input.id) })),
      engines: runs.map(run => ({
        label: run.label,
        version: run.version,
        identity: run.identity,
        node: run.node,
        importMs: run.importMs,
        firstRenderMs: run.firstRenderMs,
        firstRender: run.firstRender,
        coldDeterministic: run.coldDeterministic,
        results: Object.fromEntries([...run.results].map(([id, { svg, ...result }]) => [id, { ...result, svg: { ...fingerprint(svg), ...(!svg.ok ? { error: svg.error } : {}) } }])),
        memory: Object.fromEntries(run.memory),
        failures: Object.fromEntries(run.failures),
      })),
    },
  }
}

function main() {
  const options = args()
  const elkCache = (options.get('elk-cache') ?? 'off') as 'on' | 'off'
  const rounds = positive(options, 'rounds', 3)
  const reps = positive(options, 'reps', 5)
  const budgetMs = positive(options, 'budget-ms', DEFAULT_BUDGET_MS)
  const all: Input[] = [...extractOfficialCorpus().map(fence => ({ ...fence, kind: 'corpus' as const })), ...releaseBenchCases().map(input => ({ ...input, kind: 'scaling' as const })), { ...agentEditCase, kind: 'workflow' }]
  const selected = options.get('case')?.split(',')
  if (selected?.some(id => !all.some(input => input.id === id))) throw new Error('--case must name an existing input ID (comma-separated)')
  const inputs = selected ? all.filter(input => selected.includes(input.id)) : all
  const corpus = inputs.filter(input => input.kind === 'corpus')
  const groups: Group[] = [...(corpus.length ? [{ name: 'corpus', inputs: corpus, budgetMs: CORPUS_BUDGET_MS }] : []), ...inputs.filter(input => input.kind !== 'corpus').map(input => ({ name: input.id, inputs: [input], budgetMs: CASE_BUDGET_MS }))]
  const out = resolve(options.get('out') ?? join(ROOT, 'bench-report'))
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'corpus.json'), `${JSON.stringify(officialCorpusInventory(), null, 2)}\n`)
  const startedAt = new Date().toISOString()
  // Leave time to finalize reports before the workflow's outer timeout.
  const deadline = Date.now() + budgetMs
  const comparisonMode = options.get('runtime-comparison') ?? 'matched'
  const metadata = { runtimeComparisonMode: comparisonMode, startedAt, sourceRevision: process.env.GITHUB_SHA, config: { rounds, reps, budgetMs, gates: GATES, elkCache, sceneAssertions: 'off', aplEnvironment: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('APL_'))) }, environment: { node: execFileSync('node', ['--version'], { encoding: 'utf8' }).trim(), bun: process.versions.bun, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    cpuQuota: existsSync('/sys/fs/cgroup/cpu.max') ? readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : undefined,
    memoryLimit: existsSync('/sys/fs/cgroup/memory.max') ? readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() : undefined } }
  writeFileSync(join(out, 'samples.jsonl'), `${JSON.stringify({ ...metadata, status: 'started' })}\n`)
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...metadata, ok: false, status: 'running' }, null, 2))
  writeFileSync(join(out, 'report.md'), '# Release benchmark: incomplete\n')
  const temporary: string[] = []
  const baselineSource = options.get('baseline')
  const runtimePolicy = frozenRuntimePolicy(options.get('runtime-source') ?? (comparisonMode !== 'historical-compound' && baselineSource && existsSync(join(resolve(baselineSource), 'bun.lock')) ? baselineSource : ROOT))
  const baselinePolicy = comparisonMode === 'historical-compound' ? frozenRuntimePolicy(options.get('baseline-runtime-source')!) : runtimePolicy
  function install(spec: string, label: string, identity: Identity, prefix?: string, npmBaseline?: BaselineLock): Engine {
    const dir = prefix ?? mkdtempSync(join(tmpdir(), 'am-bench-'))
    if (!prefix) temporary.push(dir)
    const remaining = Math.min(5 * 60 * 1000, deadline - Date.now())
    if (remaining <= 0) throw new Error('Overall benchmark budget exhausted during package installation')
    const { integrity, runtime } = npmBaseline
      ? installNormalizedNpmBaseline(npmBaseline, dir, runtimePolicy, out, label, remaining)
      : installAgenticRuntime(spec, dir, label === 'baseline' ? baselinePolicy : runtimePolicy, out, label, identity.integrity, remaining)
    const bytes = readFileSync(join(dir, 'package-lock.json')), path = join(out, `${label}-${randomUUID()}.package-lock.json`)
    writeFileSync(path, bytes, { flag: 'wx' })
    const dependencyLock = { path, sha256: createHash('sha256').update(bytes).digest('hex') }
    appendFileSync(join(out, 'samples.jsonl'), `${JSON.stringify({ engine: label, dependencyLock })}\n`)
    return packageAt(join(dir, 'node_modules', 'agentic-mermaid'), label, { ...identity, integrity, dependencyLock, runtime })
  }
  try {
    const engines: Engine[] = []
    const baseline = options.get('baseline')
    const npm = options.get('baseline-npm')
    if (baseline) engines.push(packageAt(resolve(baseline), 'baseline', { kind: 'directory', requested: resolve(baseline), runtime: inspectAgenticRuntime(resolve(baseline), baselinePolicy, out, 'baseline') }))
    else if (npm) {
      const locked = resolveBaseline(npm, resolve(options.get('baseline-lock') ?? join(out, 'baseline.json')))
      engines.push(install(`agentic-mermaid@${locked.version}`, 'baseline', { kind: 'npm', requested: npm, integrity: locked.integrity }, undefined,
        comparisonMode === 'normalized-npm-compound' ? locked : undefined))
    }
    else if (options.has('baseline-tarball')) {
      const path = resolve(options.get('baseline-tarball')!), bytes = readFileSync(path)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (sha256 !== options.get('baseline-sha256')) throw new Error('Baseline tarball SHA-256 does not match the verified artifact')
      engines.push(install(path, 'baseline', { kind: 'tarball', requested: path, sha256, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }))
    }
    const tarball = options.get('candidate-tarball')
    if (tarball) {
      const bytes = readFileSync(resolve(tarball))
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (options.has('candidate-sha256') && options.get('candidate-sha256') !== sha256) throw new Error('Candidate tarball SHA-256 does not match the verified publication artifact')
      const dir = mkdtempSync(join(tmpdir(), 'am-bench-candidate-'))
      temporary.push(dir)
      const staged = join(dir, 'package.tgz')
      writeFileSync(staged, bytes)
      engines.push(install(staged, 'candidate', { kind: 'tarball', requested: resolve(tarball), sha256, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }, dir))
    } else {
      const dir = resolve(options.get('candidate') ?? ROOT)
      engines.push(packageAt(dir, 'candidate', { kind: 'directory', requested: dir, runtime: inspectAgenticRuntime(dir, runtimePolicy, out, 'candidate') }))
    }
    appendFileSync(join(out, 'samples.jsonl'), `${JSON.stringify({ engines })}\n`)
    const runtimeComparison = comparisonMode === 'historical-compound'
      ? assertHistoricalAgenticRuntimes(engines.find(engine => engine.label === 'baseline')!.identity.runtime!, engines.find(engine => engine.label === 'candidate')!.identity.runtime!)
      : comparisonMode === 'normalized-npm-compound'
        ? assertNormalizedNpmRuntimes(engines.find(engine => engine.label === 'baseline')!.identity.runtime!, engines.find(engine => engine.label === 'candidate')!.identity.runtime!)
      : (assertMatchedAgenticRuntimes(engines.map(engine => engine.identity.runtime!)), { mode: 'matched' as const })
    writeFileSync(join(out, 'runtime-comparison.json'), `${JSON.stringify(runtimeComparison, null, 2)}\n`)
    appendFileSync(join(out, 'samples.jsonl'), `${JSON.stringify({ runtimeComparison })}\n`)
    const runs = measure(out, engines, groups, rounds, reps, deadline, elkCache)
    const result = report(inputs, groups, runs, rounds)
    if (comparisonMode === 'historical-compound') result.markdown = `> Historical compound comparison: declared runtime roots differ. Shared dependency versions, integrities and edges match; this is not an isolated PR gain. See runtime-comparison.json.\n\n${result.markdown}`
    if (comparisonMode === 'normalized-npm-compound') result.markdown = `> Normalized npm compound comparison: the original verified npm archive runs under current frozen pins projected onto its compatible declared roots. This is not its original frozen dependency environment or an isolated PR gain. Shared dependency versions, integrities and edges match; all existing coverage and numeric gates remain. See runtime-comparison.json.\n\n${result.markdown}`
    result.markdown += `\nEffective policy: ELK cache **${elkCache}**; built-in Scene assertions **off**; APL environment: ${JSON.stringify(metadata.config.aplEnvironment)}.\n`
    writeFileSync(join(out, 'report.json'), JSON.stringify({ ...metadata, finishedAt: new Date().toISOString(), runtimeComparison, ...result.summary }, null, 2))
    writeFileSync(join(out, 'report.md'), result.markdown)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown)
    console.log(result.markdown)
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    writeFileSync(join(out, 'report.json'), JSON.stringify({ ...metadata, ok: false, status: 'failed', error: reason }, null, 2))
    writeFileSync(join(out, 'report.md'), `# Release benchmark: FAIL\n\n${reason}\n`)
    throw error
  } finally {
    for (const dir of temporary) rmSync(dir, { recursive: true, force: true })
  }
}
if (import.meta.main) main()
