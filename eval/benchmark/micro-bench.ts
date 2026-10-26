import './ci-policy-enforce.ts'
// Hotspot micro-benchmarks: per-stage timings of the warm render pipeline.
//
//   bun run bench:micro                          # every case, Bun on source
//   bun run bench:micro --filter '^scene:'       # cases whose id matches
//   bun run bench:micro --runtime node           # bundle, then time under Node/V8
//   bun run bench:micro --baseline main          # compare with another git revision
//   bun run bench:micro --aa                     # fresh children, one identical worker
//   bun run bench:micro --list
//
// Options: --samples N (12), --min-sample-ms N (25), --max-case-ms N (8000),
// --warmup-ms N (250), --rounds N (1, or 3 with --baseline/--aa), --json PATH,
// --fail-above RATIO, --elk-cache off|on (off).
//
// Each round runs every selected case in one fresh child process per side;
// sides alternate order between rounds. A baseline is the revision's `src/`
// extracted with `git archive` into a temporary directory, timed with the
// current cases and the current node_modules, so the comparison isolates
// production source. Cases missing at the baseline are reported, not fatal.
// A stage case that records the input an earlier stage of its own revision
// built for it reports "inputs differ" instead of a ratio when the two sides'
// inputs differ. --aa instead prepares the candidate once and reuses its exact
// root/revision/runner for both labels; it cannot be combined with --baseline.
// Under Node, allocation per call is estimated from GC boundaries (as in the
// release benchmark). Shared or loaded machines inflate absolute numbers: an
// A/A run of identical source on a shared 4-vCPU sandbox spread 0.82–1.11×
// with the defaults, while allocation per call repeated to three digits.
// Treat small timing ratios as noise, and confirm with `bench:release`.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, release, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { allocationProbe, median } from './bench-stats.ts'
import { type MicroCase, microCases } from './micro-bench-cases.ts'
import { extractRevisionTree, ROOT, shortRevision, workingRevision } from './revision-tree.ts'

interface Options {
  filter?: RegExp
  samples: number
  minSampleMs: number
  maxCaseMs: number
  warmupMs: number
}

interface CaseResult {
  id: string
  error?: string
  iterations?: number
  samplesMs?: number[]
  medianMs?: number
  madMs?: number
  /** A stage case's input, compared across sides before a ratio is shown. */
  input?: string
  allocBytesPerCall?: number
  /** Optional all-return output/receipt evidence, outside measurement. */
  evidence?: unknown
  captureBatchSize?: number
  warmCalls?: number
  warmupMs?: number
}

interface Side {
  label: 'candidate' | 'baseline'
  root: string
  revision: string
  runner: string[]
  elkCache: 'off' | 'on'
}

const SCRIPT_PATH = 'eval/benchmark/micro-bench.ts'

function parseArgs(argv: readonly string[]): Map<string, string> {
  const flags = new Set(['list', 'child', 'aa'])
  const valued = new Set(['filter', 'samples', 'min-sample-ms', 'max-case-ms', 'warmup-ms', 'runtime', 'baseline', 'rounds', 'json', 'fail-above', 'out', 'elk-cache'])
  const options = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!.replace(/^--/, '')
    if (flags.has(key)) options.set(key, 'true')
    else if (valued.has(key) && argv[i + 1] !== undefined) options.set(key, argv[++i]!)
    else throw new Error(`Unknown or incomplete option ${argv[i]}`)
  }
  return options
}

function positive(options: Map<string, string>, key: string, fallback: number): number {
  const value = Number(options.get(key) ?? fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${key} must be a positive number`)
  return value
}

// ---------------------------------------------------------------------------
// Child: time cases in this process
// ---------------------------------------------------------------------------

async function measure(entry: MicroCase, options: Options, allocation: Awaited<ReturnType<typeof allocationProbe>>): Promise<CaseResult> {
  const prepared = await entry.setup()
  const call = typeof prepared === 'function' ? prepared : prepared.call
  if (typeof prepared !== 'function') prepared.beforeCall?.()
  const first = call()
  if (entry.check && !entry.check(first)) throw new Error('sanity check failed on the first result')
  if (typeof prepared !== 'function' && prepared.consume) {
    const consume = prepared.consume
    consume(first)
    let sink: unknown = first
    const batchSize = prepared.captureBatchSize ?? 1
    // Only opted-in cases capture every return. The array is bounded by 64
    // slots/about 1Mi code units at the reference artifact size, outside clocks.
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64) throw new Error('invalid output capture batch size')
    if (prepared.beforeCall && batchSize !== 1) throw new Error('per-call preparation needs single-return capture')
    const timed = async (calls: number, allocating = false): Promise<number> => {
      let total = 0
      for (let done = 0; done < calls; done += batchSize) {
        const outputs = new Array<unknown>(Math.min(batchSize, calls - done))
        prepared.beforeCall?.()
        const invoke = () => { for (let index = 0; index < outputs.length; index++) outputs[index] = call() }
        if (allocating) total += await allocation!(invoke)
        else {
          const start = performance.now()
          invoke()
          total += performance.now() - start
        }
        // Validation, serialization and array allocation never enter the clock
        // or GCProfiler callback. Stores and per-batch clocks are added work.
        for (const output of outputs) consume(output)
        sink = outputs.at(-1)
      }
      return total
    }
    let warmCalls = 0, warmMs = 0
    while (warmCalls < 3 || warmMs < options.warmupMs) {
      warmMs += await timed(1)
      warmCalls++
    }
    const perCall = warmMs / warmCalls
    const iterations = Math.max(1, Math.ceil(options.minSampleMs / Math.max(perCall, 1e-6)))
    const affordable = Math.floor(options.maxCaseMs / Math.max(perCall * iterations, 1e-6))
    const sampleCount = Math.max(Math.min(3, options.samples), Math.min(options.samples, affordable))
    const samplesMs: number[] = []
    for (let sample = 0; sample < sampleCount; sample++) samplesMs.push(await timed(iterations) / iterations)
    const allocBytesPerCall = allocation ? await timed(iterations, true) / iterations : undefined
    ;(globalThis as { __microBenchSink?: unknown }).__microBenchSink = sink
    const medianMs = median(samplesMs)
    return {
      id: entry.id, iterations, samplesMs, medianMs,
      madMs: median(samplesMs.map(value => Math.abs(value - medianMs))),
      ...(allocBytesPerCall === undefined ? {} : { allocBytesPerCall }),
      input: prepared.input,
      evidence: prepared.evidence,
      captureBatchSize: batchSize,
      warmCalls,
      warmupMs: warmMs,
    }
  }
  let sink: unknown = first
  const warmStart = performance.now()
  let warmCalls = 0
  while (warmCalls < 3 || performance.now() - warmStart < options.warmupMs) {
    sink = call()
    warmCalls++
  }
  const perCall = (performance.now() - warmStart) / warmCalls
  const iterations = Math.max(1, Math.ceil(options.minSampleMs / Math.max(perCall, 1e-6)))
  const affordable = Math.floor(options.maxCaseMs / Math.max(perCall * iterations, 1e-6))
  const sampleCount = Math.max(Math.min(3, options.samples), Math.min(options.samples, affordable))
  const samplesMs: number[] = []
  for (let sample = 0; sample < sampleCount; sample++) {
    const start = performance.now()
    for (let i = 0; i < iterations; i++) sink = call()
    samplesMs.push((performance.now() - start) / iterations)
  }
  const allocBytesPerCall = allocation
    ? (await allocation(() => {
        for (let i = 0; i < iterations; i++) sink = call()
      })) / iterations
    : undefined
  ;(globalThis as { __microBenchSink?: unknown }).__microBenchSink = sink
  const medianMs = median(samplesMs)
  return {
    id: entry.id,
    iterations,
    samplesMs,
    medianMs,
    madMs: median(samplesMs.map(value => Math.abs(value - medianMs))),
    ...(allocBytesPerCall === undefined ? {} : { allocBytesPerCall }),
    ...(typeof prepared === 'function' ? {} : { input: prepared.input }),
  }
}

async function runChild(options: Options, out: string): Promise<void> {
  const allocation = await allocationProbe()
  const results: CaseResult[] = []
  for (const entry of microCases().filter(entry => !options.filter || options.filter.test(entry.id))) {
    try {
      results.push(await measure(entry, options, allocation))
    } catch (error) {
      results.push({ id: entry.id, error: error instanceof Error ? error.message.split('\n')[0]! : String(error) })
    }
  }
  writeFileSync(out, JSON.stringify(results))
}

// ---------------------------------------------------------------------------
// Parent: prepare sides, interleave rounds, report
// ---------------------------------------------------------------------------

// Like the published build: runtime dependencies stay external, everything
// else (including roughjs, whose extensionless subpath Node cannot resolve) is
// bundled.
function bundleForNode(root: string, outfile: string): string {
  mkdirSync(dirname(outfile), { recursive: true })
  const dependencies = Object.keys((JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies)
  const result = spawnSync('bun', ['build', join(root, SCRIPT_PATH), '--target=node', '--format=esm', ...dependencies.flatMap(name => ['--external', name]), '--outfile', outfile], { stdio: ['ignore', 'ignore', 'inherit'] })
  if (result.status !== 0) throw new Error(`bun build failed for ${root}`)
  return outfile
}

// Node resolves the bundle's external packages from its own location, so each
// bundle lives beside a node_modules: a per-run directory in the repository's
// cache for the candidate, the extracted tree (with its node_modules link) for
// a baseline.
function prepareSide(label: Side['label'], root: string, revision: string, runtime: string, candidateBundleDir: string): Omit<Side, 'elkCache'> {
  const script = join(root, SCRIPT_PATH)
  const bundle = label === 'candidate' ? join(candidateBundleDir, 'candidate.mjs') : join(root, 'micro-bench.node.mjs')
  const runner = runtime === 'node' ? ['node', bundleForNode(root, bundle)] : ['bun', script]
  return { label, root, revision, runner }
}

function runSide(side: Side, passthrough: string[], scratch: string, round: number): Map<string, CaseResult> {
  const out = join(scratch, `${side.label}-${round}.json`)
  const [command, ...args] = side.runner
  // Disable caching by default to time ELK itself; opt in explicitly when
  // measuring the normal warm pipeline. Both revisions use the same policy.
  const result = spawnSync(command!, [...args, '--child', '--out', out, ...passthrough], { cwd: side.root, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: side.elkCache === 'on' ? '1' : '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
  if (result.status !== 0) throw new Error(`${side.label} round ${round + 1} exited with ${result.status ?? result.signal}`)
  return new Map((JSON.parse(readFileSync(out, 'utf8')) as CaseResult[]).map(entry => [entry.id, entry]))
}

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—'
  if (ms >= 100) return `${ms.toFixed(0)} ms`
  if (ms >= 1) return `${ms.toFixed(2)} ms`
  if (ms >= 0.001) return `${(ms * 1000).toFixed(1)} µs`
  return `${(ms * 1e6).toFixed(0)} ns`
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.has('aa') && args.has('baseline')) throw new Error('--aa and --baseline are mutually exclusive')
  const options: Options = {
    ...(args.has('filter') ? { filter: new RegExp(args.get('filter')!) } : {}),
    samples: positive(args, 'samples', 12),
    minSampleMs: positive(args, 'min-sample-ms', 25),
    maxCaseMs: positive(args, 'max-case-ms', 8000),
    warmupMs: positive(args, 'warmup-ms', 250),
  }
  if (args.has('child')) return runChild(options, args.get('out')!)
  if (args.has('list')) {
    for (const entry of microCases().filter(entry => !options.filter || options.filter.test(entry.id))) console.log(`${entry.id.padEnd(36)} ${entry.description}`)
    return
  }

  const runtime = args.get('runtime') ?? 'bun'
  if (runtime !== 'bun' && runtime !== 'node') throw new Error('--runtime must be bun or node')
  const baselineRef = args.get('baseline')
  const elkCache = args.get('elk-cache') ?? 'off'
  if (elkCache !== 'off' && elkCache !== 'on') throw new Error('--elk-cache must be off or on')
  const identicalWorkerAA = args.has('aa')
  const comparison = identicalWorkerAA || !!baselineRef
  const comparisonMode = identicalWorkerAA ? 'identical-worker-aa' : baselineRef ? 'revision' : 'single'
  const rounds = positive(args, 'rounds', comparison ? 3 : 1)
  const passthrough = ['filter', 'samples', 'min-sample-ms', 'max-case-ms', 'warmup-ms'].flatMap(key => (args.has(key) ? [`--${key}`, args.get(key)!] : []))
  const scratch = mkdtempSync(join(tmpdir(), 'agentic-mermaid-micro-'))
  mkdirSync(join(ROOT, 'node_modules/.cache'), { recursive: true })
  const candidateBundleDir = mkdtempSync(join(ROOT, 'node_modules/.cache/agentic-mermaid-micro-'))
  const cleanUp = () => {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(candidateBundleDir, { recursive: true, force: true })
  }
  // An interrupt skips `finally`.
  process.once('SIGINT', () => {
    cleanUp()
    process.exit(130)
  })
  try {
    const candidate: Side = { ...prepareSide('candidate', ROOT, workingRevision(), runtime, candidateBundleDir), elkCache }
    const sides: Side[] = [candidate]
    if (identicalWorkerAA) {
      // Reuse the same prepared artifact and module root, not a second bundle
      // of equal source. runSide still starts a fresh child for each label.
      sides.push({ ...candidate, label: 'baseline' })
    } else if (baselineRef) {
      const baseline = extractRevisionTree(baselineRef, scratch, 'baseline', 'eval/benchmark/micro-bench-cases.ts')
      sides.push({ ...prepareSide('baseline', baseline.root, baseline.revision, runtime, candidateBundleDir), elkCache })
    }
    const perRound: Array<Record<string, Map<string, CaseResult>>> = []
    for (let round = 0; round < rounds; round++) {
      const order = round % 2 === 0 ? sides : [...sides].reverse()
      const results: Record<string, Map<string, CaseResult>> = {}
      for (const side of order) {
        console.error(`round ${round + 1}/${rounds}: ${side.label} (${shortRevision(side.revision)})`)
        results[side.label] = runSide(side, passthrough, scratch, round)
      }
      perRound.push(results)
    }

    const ids = microCases()
      .map(entry => entry.id)
      .filter(id => perRound[0]!.candidate!.has(id))
    const summary = ids.map(id => {
      const rows = (label: Side['label']) => perRound.map(round => round[label]?.get(id)).filter((entry): entry is CaseResult => entry !== undefined)
      const pick = (label: Side['label']) => {
        const entries = rows(label)
        const ok = entries.filter(entry => entry.medianMs !== undefined)
        if (!entries.length) return undefined
        if (ok.length !== entries.length) return { error: entries.find(entry => entry.error)?.error ?? 'failed' }
        const alloc = ok.map(entry => entry.allocBytesPerCall).filter((value): value is number => value !== undefined)
        return {
          medianMs: median(ok.map(entry => entry.medianMs!)),
          noise: median(ok.map(entry => entry.madMs! / entry.medianMs!)),
          ...(alloc.length ? { allocBytesPerCall: median(alloc) } : {}),
          rounds: ok.map(entry => entry.medianMs!),
        }
      }
      const candidate = pick('candidate')
      const baseline = pick('baseline')
      const ratios = perRound
        .map(round => {
          const after = round.candidate?.get(id)?.medianMs
          const before = round.baseline?.get(id)?.medianMs
          return after !== undefined && before !== undefined && before > 0 ? after / before : undefined
        })
        .filter((value): value is number => value !== undefined)
      // A stage fed by an earlier stage of its own revision is compared only
      // when both sides were handed the same input.
      const inputsDiffer = perRound.some(round => {
        const after = round.candidate?.get(id)?.input
        const before = round.baseline?.get(id)?.input
        return after !== undefined && before !== undefined && after !== before
      })
      const ratio = inputsDiffer || !ratios.length ? undefined : median(ratios)
      return { id, candidate, baseline, inputsDiffer, ratio }
    })

    const header = ['case', 'candidate', '±', ...(comparison ? ['baseline', 'ratio'] : []), ...(runtime === 'node' ? ['alloc/call'] : [])]
    const table = summary.map(row => {
      const c = row.candidate && 'medianMs' in row.candidate ? row.candidate : undefined
      const b = row.baseline && 'medianMs' in row.baseline ? row.baseline : undefined
      const failed = row.candidate && 'error' in row.candidate ? `error: ${row.candidate.error}` : undefined
      return [
        row.id,
        failed ?? formatMs(c?.medianMs),
        c ? `${(100 * c.noise).toFixed(0)}%` : '',
        ...(comparison ? [b ? formatMs(b.medianMs) : row.baseline && 'error' in row.baseline ? 'unavailable' : '—', row.inputsDiffer ? 'inputs differ' : row.ratio === undefined ? '' : `${row.ratio.toFixed(2)}×`] : []),
        ...(runtime === 'node' ? [formatBytes(c?.allocBytesPerCall)] : []),
      ]
    })
    const widths = header.map((title, column) => Math.max(title.length, ...table.map(row => row[column]!.length)))
    console.log(`\n${header.map((title, column) => title.padEnd(widths[column]!)).join('  ')}`)
    for (const row of table) console.log(row.map((cell, column) => (column === 0 || cell.startsWith('error') ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!))).join('  '))

    if (args.has('json')) {
      const report = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        runtime,
        comparisonMode,
        harness: { root: ROOT, revision: workingRevision(), script: SCRIPT_PATH },
        environment: { runtimeVersion: runtime === 'node' ? execFileSync('node', ['--version'], { encoding: 'utf8' }).trim() : `bun ${process.versions.bun}`, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
        sides: sides.map(side => ({ label: side.label, revision: side.revision,
          runnerProvenance: { workingDirectory: side.root, argv: side.runner,
            reusesCandidate: identicalWorkerAA && side.label === 'baseline' },
        })),
        config: { ...options, filter: options.filter?.source, rounds, elkCache, flags: { AGENTIC_MERMAID_ELK_CACHE: elkCache === 'off' ? '0' : '1', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('APL_'))) } },
        rawRounds: perRound.map((round, index) => ({ round: index + 1, ...Object.fromEntries(Object.entries(round).map(([side, cases]) => [side, Object.fromEntries(cases)])) })),
        results: summary,
      }
      writeFileSync(args.get('json')!, `${JSON.stringify(report, null, 2)}\n`)
    }
    const threshold = args.has('fail-above') ? positive(args, 'fail-above', 1) : undefined
    const failures = summary.filter(row => (row.candidate && 'error' in row.candidate) || (threshold !== undefined && row.ratio !== undefined && row.ratio > threshold))
    if (failures.length) {
      console.error(`\n${failures.length} case(s) failed${threshold === undefined ? '' : ` or exceeded ${threshold}× baseline`}: ${failures.map(row => row.id).join(', ')}`)
      process.exitCode = 1
    }
    const uncompared = threshold === undefined ? [] : summary.filter(row => row.inputsDiffer)
    if (uncompared.length) console.error(`\nNot compared with --fail-above (inputs differ): ${uncompared.map(row => row.id).join(', ')}`)
  } finally {
    cleanUp()
  }
}

await main()
