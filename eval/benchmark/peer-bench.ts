import './ci-policy-enforce.ts'
// Peer benchmark: the same workloads in agentic-mermaid's built package and in
// the browserless peers from eval/fork-graph, each timed in fresh processes.
//
//   bun run eval/benchmark/peer-bench.ts                     # every peer, 3 rounds
//   bun run eval/benchmark/peer-bench.ts --quick --rounds 1  # smoke run
//   bun run eval/benchmark/peer-bench.ts --peers agentic,pele --workloads flow5,tree50
//   bun run eval/benchmark/peer-bench.ts --agentic-npm 0.4.1 # add the published package
//
// Options: --peers a,b, --workloads a,b, --rounds N (3), --json PATH,
// --markdown PATH, --quick (fewer, shorter samples), --agentic-npm VERSION,
// --elk-cache on|off (off), --candidate-tarball PATH --candidate-sha256 DIGEST.
// --tracks all|first-use,warm-new-source,exact-repeat,label-edit opts into
// consumed SVG/complete receipts and per-call p50/p95 rather than legacy batches.
// --aa adds an independently installed identical agentic-baseline; alternatively
// --baseline-tarball PATH --baseline-sha256 DIGEST installs a pinned baseline.
// Durable reports default to bench-report/peer-report.{json,md}; adjacent JSONL
// files retain raw worker receipts even if the orchestrator is interrupted.
// --corpus uses every official fence occurrence (including unsupported types),
// with one warmup and three single-call samples instead of calibrated loops.
// Corpus success is nonempty output, not a semantic/visual fidelity claim.
//
// Advisory only: it replaces the dated hand-run tables in docs/comparison.md
// with a re-runnable command. The qualification wrapper can run consumed tracks
// in CI with separate calibrated gates. `agentic` is the
// local `dist/` (run `bun run build` first). Registry peers are installed at
// the exact version pinned below into
// node_modules/.cache/agentic-mermaid-peers/<name>@<version>/, with install
// scripts disabled (termaid: wheel only, into a venv there). Peer code runs
// only inside worker processes, but there with this user's privileges, and a
// peer's transitive npm dependencies resolve at install time (no lockfile).
// Pins are checked against eval/fork-graph/population.json; a mismatch is a
// printed warning.
// Sketch is fetched at its exact git commit and compiled with Go >=1.25 on PATH.
//
// Each round runs one fresh worker process per peer and output (`node`, or the
// venv's Python for termaid, or a native Go binary), alternating the order between rounds. A worker
// imports the peer (import ms, including one-time engine setup), renders each
// workload once (first-render ms) and checks its expected labels; only an
// output that keeps them is warm-measured: warm calls, iterations calibrated to
// a minimum sample length, the median of samples, and a per-workload time cap
// so a slow peer cannot stall the run. It records output bytes, V8 allocation
// per call (GC-boundary estimate as in micro-bench.ts; blind to WASM linear
// memory and native heap) and RSS after the run. Rounds combine by median;
// ratios are peer ÷ agentic per round, then the median. A shared or loaded
// machine inflates absolute numbers, so compare peers within one run.

import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, hostname, loadavg, release, tmpdir, totalmem } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodeXML } from 'entities'
import { createRequire } from 'node:module'
import type { MICRO_WORKLOADS } from './micro-bench-cases.ts'
import { allocationProbe, median } from './bench-stats.ts'
import { missingSvgLabels } from './release-bench-fidelity.ts'
import { git, ROOT } from './revision-tree.ts'
import { PEER_CONSUMERS, PEER_VARIANT_DOMAINS, PEER_FROZEN_COHORT, PEER_EXPECTED_LABELS, emptyTrackObservation, finalizeTrackObservation, parsePeerTracks, parsePeerConsumers, peerRuntimeDependencyGraph, peerExecutionEnvironment } from './peer-tracks.ts'
import type { PeerTrackObservation, PeerTrackReport } from './peer-tracks.ts'
import { measurePeerTrack } from './peer-track-worker.ts'
import type { TrackJob } from './peer-track-worker.ts'
import { frozenRuntimePolicy, installAgenticRuntime, installedNpmPackagePin, inspectAgenticRuntime, assertMatchedAgenticRuntimes, type RuntimePolicy, type RuntimeReceipt } from './release-baseline.ts'
import { assertBenchmarkSetVersions, assertBenchmarkToolVersion, benchmarkToolPins } from './tool-versions.ts'

type WorkloadId = string
type Output = 'svg' | 'terminal'
type Render = (source: string) => unknown
// Peer modules are third-party and untyped here; each adapter names the call.
type PeerModule = Record<string, any>

interface Adapter {
  /** Package export the worker imports (`.` or a subpath; a module for Python). */
  subpath: string
  /** The timed call, as the report describes it. */
  api: string
  /** Runs once in the worker after import; its time is part of import ms. */
  make?(module: PeerModule): Render | Promise<Render>
}

interface Peer {
  id: string
  source: { registry: 'local' } | { registry: 'npm' | 'pypi'; name: string; version: string } | { registry: 'git'; repo: string; commit: string; module: string }
  runtime: 'node' | 'python' | 'go'
  svg?: Adapter
  terminal?: Adapter
  /** Not run unless named in --peers. */
  optIn?: boolean
  note?: string
}

const CACHE = join(ROOT, 'node_modules/.cache/agentic-mermaid-peers')

// ---------------------------------------------------------------------------
// Peers and workloads
// ---------------------------------------------------------------------------

// Unicode box drawing without ANSI colour, so output is comparable plain text.
const TERMINAL_OPTIONS = { useAscii: false, colorMode: 'none' } as const
// beautiful-mermaid's public API, which agentic and zombie keep.
const beautifulApi = {
  svg: {
    subpath: '.',
    api: 'renderMermaidSVG(source)',
    make:
      (m: PeerModule): Render =>
      source =>
        m.renderMermaidSVG(source),
  },
  terminal: {
    subpath: '.',
    api: "renderMermaidASCII(source, { useAscii: false, colorMode: 'none' })",
    make:
      (m: PeerModule): Render =>
      source =>
        m.renderMermaidASCII(source, TERMINAL_OPTIONS),
  },
}
const mermanEngine = async (m: PeerModule) => (await m.createNodeEngine()) as { renderSvgSync(source: string): string; renderSvg(source: string): Promise<string> }

const PEERS: readonly Peer[] = [
  { id: 'agentic', source: { registry: 'local' }, runtime: 'node', ...beautifulApi },
  { id: 'beautiful', source: { registry: 'npm', name: 'beautiful-mermaid', version: '1.1.3' }, runtime: 'node', ...beautifulApi },
  {
    id: 'zombie',
    source: { registry: 'npm', name: 'zombie-mermaid', version: '5.7.1' },
    runtime: 'node',
    svg: beautifulApi.svg,
    terminal: { ...beautifulApi.terminal, subpath: './ascii', api: `zombie-mermaid/ascii ${beautifulApi.terminal.api}` },
  },
  { id: 'pele', source: { registry: 'npm', name: 'pele', version: benchmarkToolPins['obsidianmd/pele'].version }, runtime: 'node', svg: { subpath: '.', api: 'render(source).svg', make: m => source => m.render(source).svg }, note: 'returns { svg, ... }; only .svg is read' },
  {
    id: 'sketch',
    source: { registry: 'git', repo: 'https://github.com/Gaurav-Gosain/tuios', commit: '880e652ee56b1607cc454847a359703d7cdc88e6', module: 'sketch' },
    runtime: 'go',
    svg: { subpath: '.', api: 'sketch.Render(source, sketch.RenderOptions{}).Data' },
    terminal: { subpath: '.', api: 'sketch.Parse + text.Draw(Cols: 0, Color: false) + strings.Join' },
    note: 'PR #919; native in-process Go timing, static binary (no import), no V8 allocation estimate',
  },
  {
    id: 'merman',
    source: { registry: 'npm', name: '@mermanjs/node', version: '0.9.1' },
    runtime: 'node',
    svg: {
      subpath: '.',
      api: 'engine.renderSvgSync(source) after one createNodeEngine()',
      make: async m => {
        const engine = await mermanEngine(m)
        return source => engine.renderSvgSync(source)
      },
    },
    note: 'napi addon; no terminal API in @mermanjs/node',
  },
  {
    id: 'merman-async',
    source: { registry: 'npm', name: '@mermanjs/node', version: '0.9.1' },
    runtime: 'node',
    optIn: true,
    svg: {
      subpath: '.',
      api: 'await engine.renderSvg(source) (bounded queue) after one createNodeEngine()',
      make: async m => {
        const engine = await mermanEngine(m)
        return source => engine.renderSvg(source)
      },
    },
    note: 'async: each call includes the queue and a promise hop',
  },
  { id: 'mermaid-rs', source: { registry: 'npm', name: 'mermaid-wasm-renderer', version: '0.3.1' }, runtime: 'node', svg: { subpath: '.', api: 'renderSvg(source)', make: m => m.renderSvg ?? m.default.renderSvg }, note: 'mermaid-rs-renderer compiled to WASM (CommonJS)' },
  { id: 'termaid', source: { registry: 'pypi', name: 'termaid', version: '0.9.1' }, runtime: 'python', terminal: { subpath: 'termaid', api: 'termaid.render(source)' }, note: 'Python, timed in process; no allocation estimate' },
]

const NOT_COVERED = ['mermaid@12.2.0: needs a browser DOM in Node; `bun run bench:release:browser` times it in Chromium', 'Merman terminal: @mermanjs/node 0.9.1 has no ASCII API (its README puts ASCII outside the package surface)', 'Pele and mermaid-rs-renderer: no terminal output']

const range = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`)
const EXPECTED_LABELS = PEER_EXPECTED_LABELS
const WORKLOADS: Record<Output, readonly WorkloadId[]> = {
  svg: Object.keys(EXPECTED_LABELS),
  terminal: ['flow5', 'tree50', 'mesh50', 'seq20'],
}
// Requirement adapters may show the field name or paint only its value.
const SVG_LABEL_PREFIXES: Record<WorkloadId, readonly string[]> = { requirement100: ['Text: '] }

interface Timing {
  warmCalls: number
  warmupMs: number
  samples: number
  minSampleMs: number
  maxCaseMs: number
}
const TIMING: Timing = { warmCalls: 5, warmupMs: 250, samples: 12, minSampleMs: 25, maxCaseMs: 5000 }
const QUICK_TIMING: Timing = { warmCalls: 2, warmupMs: 50, samples: 5, minSampleMs: 10, maxCaseMs: 1500 }
const MIN_SAMPLES = 3

// ---------------------------------------------------------------------------
// Worker: one peer, one output, every workload, in this process
// ---------------------------------------------------------------------------

type Status = 'ok' | 'lost-labels' | 'unsupported' | 'error'
interface WorkloadResult {
  workload: string
  status: Status
  detail?: string
  missing?: number
  firstMs?: number
  outputBytes?: number
  warmCalls?: number
  iterations?: number
  samplesMs?: number[]
  medianMs?: number
  madMs?: number
  allocBytesPerCall?: number
}
interface WorkerJob {
  peer: string
  output: Output
  entry: string
  timing: Timing
  track?: TrackJob
  workloads: Array<{ id: string; source: string; expected: readonly string[]; svgLabelPrefixes?: readonly string[] }>
}
type WorkerLine = { type: 'track'; observation: PeerTrackObservation } | { type: 'progress'; workload: string; calls: number; observation: import('./peer-tracks.ts').PeerCallObservation } | { type: 'import'; importMs: number; setupMs: number } | { type: 'fatal'; error: string } | { type: 'start'; workload: string } | ({ type: 'result' } & WorkloadResult) | { type: 'end'; rssBytes?: number; peakRssBytes?: number; settledHeapBytes?: number }

const firstLine = (error: unknown) => (error instanceof Error ? `${error.name === 'Error' ? '' : `${error.name}: `}${error.message}` : String(error)).split('\n')[0]!.trim()
const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as PromiseLike<unknown> | undefined)?.then === 'function'
const textOf = (markup: string) =>
  decodeXML(markup.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

// Colour codes are removed first, or the `m` ending one would join the next label.
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
/** A whole terminal token: `Node 1` must not be found inside `Node 12`. */
const terminalLabel = (label: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u')

/** Labels a reader would see: whole <text> elements (as the release
 * benchmark checks them), each <tspan>, and each foreignObject's text and text
 * runs (Merman's HTML labels). Terminal output is checked token by token. */
function missingLabels(output: Output, rendered: string, expected: readonly string[], fieldPrefixes: readonly string[] = []): string[] {
  if (output === 'terminal') {
    const text = rendered.replace(ANSI_SGR, '')
    return expected.filter(label => !terminalLabel(label).test(text))
  }
  const missing = missingSvgLabels(rendered, expected, fieldPrefixes)
  if (!missing.length) return missing
  const seen = new Set<string>()
  for (const [, inner] of rendered.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)) seen.add(textOf(inner!))
  for (const [, inner] of rendered.matchAll(/<foreignObject\b[^>]*>([\s\S]*?)<\/foreignObject>/g)) {
    seen.add(textOf(inner!))
    for (const run of inner!.split(/<[^>]+>/)) seen.add(textOf(run))
  }
  return missing.filter(label => !seen.has(label) && !fieldPrefixes.some(prefix => seen.has(`${prefix}${label}`)))
}

async function measure(render: Render, output: Output, workload: WorkerJob['workloads'][number], timing: Timing, allocation: Awaited<ReturnType<typeof allocationProbe>>): Promise<WorkloadResult> {
  const id = workload.id
  const firstStart = performance.now()
  let first: unknown
  let isAsync = false
  try {
    first = render(workload.source)
    isAsync = isThenable(first)
    if (isAsync) first = await first
  } catch (error) {
    return { workload: id, status: 'error', detail: firstLine(error) }
  }
  const firstMs = performance.now() - firstStart
  if (typeof first !== 'string' || (output === 'svg' ? !/^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b/.test(first) : !first.trim())) return { workload: id, status: 'error', detail: `returned no ${output === 'svg' ? 'SVG string' : 'text'}`, firstMs }
  const outputBytes = Buffer.byteLength(first, 'utf8')
  type Failure = Pick<WorkloadResult, 'status' | 'detail' | 'missing'>
  // Workers run from the repository root. Resolve the native parser there so
  // the standalone worker bundle does not embed native assets.
  const Resvg = output === 'svg' ? (createRequire(join(process.cwd(), 'package.json'))('@resvg/resvg-js') as typeof import('@resvg/resvg-js')).Resvg : undefined
  const validated = new Set<string>()
  let validatedUnits = 0
  const inspect = (value: unknown): Failure | undefined => {
    if (typeof value !== 'string' || (output === 'svg' ? !/^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b/.test(value) : !value.trim())) return { status: 'error', detail: `returned no ${output === 'svg' ? 'SVG string' : 'text'}` }
    if (validated.has(value)) return undefined
    const missing = missingLabels(output, value, workload.expected, workload.svgLabelPrefixes)
    if (missing.length) return { status: 'lost-labels', missing: missing.length, detail: missing.slice(0, 3).join(', ') }
    if (output === 'svg') {
      try { new Resvg!(value, { font: { loadSystemFonts: false } }) }
      catch (error) { return { status: 'error', detail: `invalid SVG: ${firstLine(error)}` } }
    }
    // Avoid repeated parsing of identical complete strings without retaining
    // unbounded randomized peer output. Every return value is still inspected.
    if (validatedUnits + value.length <= 1024 * 1024) {
      validated.add(value)
      validatedUnits += value.length
    }
    return undefined
  }
  const firstFailure = inspect(first)
  if (firstFailure) return { workload: id, ...firstFailure, firstMs, outputBytes }
  let failure: Failure | undefined
  const inspectBatch = (outputs: unknown[]) => {
    for (const value of outputs) {
      failure = inspect(value)
      if (failure) throw new Error(failure.detail)
    }
    ;(globalThis as { __peerBenchSink?: unknown }).__peerBenchSink = outputs.at(-1)
  }
  // Capture every complete output; validation is after the clock stops. Array
  // allocation is outside timing, while storing each returned value is timed.
  const invoke = async (outputs: unknown[]): Promise<number> => {
    const start = performance.now()
    if (isAsync) for (let i = 0; i < outputs.length; i++) outputs[i] = await render(workload.source)
    else for (let i = 0; i < outputs.length; i++) outputs[i] = render(workload.source)
    return performance.now() - start
  }
  // Keep at most 64 returns (about 1 MiB at the first output's size) alive
  // per batch, and at most 1M code units in the validation reuse set. Clocks
  // and output stores are part of each batch's measured work; inspection is not.
  const batchCalls = Math.max(1, Math.min(64, Math.floor(1024 * 1024 / Math.max(1, outputBytes))))
  const timed = async (calls: number, allocating = false) => {
    const outputs = new Array<unknown>(Math.min(calls, batchCalls))
    let total = 0
    for (let done = 0; done < calls; done += outputs.length) {
      outputs.length = Math.min(batchCalls, calls - done)
      total += allocating ? await allocation!(() => invoke(outputs)) : await invoke(outputs)
      inspectBatch(outputs)
    }
    return total
  }

  try {
    const caseStart = performance.now()
    let warmCalls = 0
    let warmMs = 0
    while (warmCalls < timing.warmCalls || warmMs < timing.warmupMs) {
      warmMs += await timed(1)
      warmCalls++
      if (warmMs >= timing.maxCaseMs / 4) break
    }
    const perCall = warmMs / warmCalls
    const iterations = Math.max(1, Math.ceil(timing.minSampleMs / Math.max(perCall, 1e-6)))
    const affordable = Math.floor((timing.maxCaseMs - (performance.now() - caseStart)) / Math.max(perCall * iterations, 1e-6))
    const sampleCount = Math.max(MIN_SAMPLES, Math.min(timing.samples, affordable))
    const samplesMs: number[] = []
    for (let sample = 0; sample < sampleCount; sample++) {
      samplesMs.push((await timed(iterations)) / iterations)
      if (samplesMs.length >= MIN_SAMPLES && performance.now() - caseStart > timing.maxCaseMs) break
    }
    const allocBytesPerCall = allocation ? (await timed(iterations, true)) / iterations : undefined
    const medianMs = median(samplesMs)
    return { workload: id, status: 'ok', firstMs, outputBytes, warmCalls, iterations, samplesMs, medianMs, madMs: median(samplesMs.map(value => Math.abs(value - medianMs))), ...(allocBytesPerCall === undefined ? {} : { allocBytesPerCall }) }
  } catch (error) {
    return { workload: id, ...(failure ?? { status: 'error' as const, detail: `after the first render: ${firstLine(error)}` }), firstMs, outputBytes }
  }
}

async function runWorker(jobPath: string, outPath: string): Promise<void> {
  const job = JSON.parse(readFileSync(jobPath, 'utf8')) as WorkerJob
  const emit = (line: WorkerLine) => appendFileSync(outPath, `${JSON.stringify(line)}\n`)
  // --agentic-npm adds a peer at run time; it uses agentic's adapters.
  const peer = PEERS.find(entry => entry.id === job.peer) ?? (job.peer.startsWith('agentic-') ? PEERS[0] : undefined)
  const make = peer?.[job.output]?.make
  if (!make) throw new Error(`no ${job.output} adapter for ${job.peer}`)
  const allocation = await allocationProbe()
  let render: Render
  let receiptRender: Render | undefined
  try {
    const importStart = performance.now()
    const module = (await import(pathToFileURL(job.entry).href)) as PeerModule
    const setupStart = performance.now()
    render = await make(module)
    if (job.peer === 'agentic' || job.peer.startsWith('agentic-')) receiptRender = typeof module.renderMermaidSVGWithReceipt === 'function' ? source => module.renderMermaidSVGWithReceipt(source) : undefined
    emit({ type: 'import', importMs: setupStart - importStart, setupMs: performance.now() - setupStart })
  } catch (error) {
    emit({ type: 'fatal', error: firstLine(error) })
    process.exit(0)
  }
  for (const workload of job.workloads) {
    emit({ type: 'start', workload: workload.id })
    if (job.track) {
      const { Resvg } = createRequire(join(process.cwd(), 'package.json'))('@resvg/resvg-js') as typeof import('@resvg/resvg-js')
      const observation = await measurePeerTrack({ peer: job.peer, input: workload, track: job.track,
        render: job.track.consumer === 'svg-utf8' ? render : receiptRender, allocation,
        validate(svg, input) {
          try {
            new Resvg(svg, { font: { loadSystemFonts: false } })
            return { missing: missingLabels('svg', svg, input.expected, input.svgLabelPrefixes) }
          } catch (error) { return { missing: [], error: firstLine(error) } }
        }, progress: row => emit({ type: 'progress', workload: workload.id, calls: row.calls.length, observation: row.calls.at(-1)! }),
      })
      emit({ type: 'track', observation })
    } else emit({ type: 'result', ...(await measure(render, job.output, workload, job.timing, allocation)) })
  }
  const rssBytes = process.memoryUsage().rss
  if (!globalThis.gc) throw new Error('peer worker needs node --expose-gc')
  globalThis.gc()
  emit({ type: 'end', rssBytes, peakRssBytes: process.resourceUsage().maxRSS * 1024, settledHeapBytes: process.memoryUsage().heapUsed })
  // A peer engine (Merman's queue) may hold the event loop open.
  process.exit(0)
}

// The same protocol and timing rules for termaid, run with `python -I -c`.
const PYTHON_WORKER = String.raw`
import importlib, json, math, os, re, statistics, sys, time
job = json.load(open(sys.argv[1], encoding='utf-8'))
out = open(sys.argv[2], 'a', encoding='utf-8')
timing = job['timing']
now = time.perf_counter
def emit(line):
    out.write(json.dumps(line) + '\n')
    out.flush()
def first_line(error):
    text = str(error).strip().split('\n')[0]
    return type(error).__name__ + (': ' + text if text else '')
def elapsed(start):
    return (now() - start) * 1000
try:
    start = now()
    render = importlib.import_module(job['entry']).render
    emit({'type': 'import', 'importMs': elapsed(start), 'setupMs': 0})
except Exception as error:
    emit({'type': 'fatal', 'error': first_line(error)})
    sys.exit(0)
for workload in job['workloads']:
    wid, source = workload['id'], workload['source']
    emit({'type': 'start', 'workload': wid})
    start = now()
    try:
        first = render(source)
    except Exception as error:
        emit({'type': 'result', 'workload': wid, 'status': 'error', 'detail': first_line(error)})
        continue
    first_ms = elapsed(start)
    if not isinstance(first, str) or not first.strip():
        emit({'type': 'result', 'workload': wid, 'status': 'error', 'detail': 'returned no text', 'firstMs': first_ms})
        continue
    output_bytes = len(first.encode('utf-8'))
    text = re.sub(r'\x1b\[[0-9;]*m', '', first)
    missing = [label for label in workload['expected'] if not re.search(r'(?<!\w)' + re.escape(label) + r'(?!\w)', text)]
    if missing:
        emit({'type': 'result', 'workload': wid, 'status': 'lost-labels', 'missing': len(missing), 'detail': ', '.join(missing[:3]), 'firstMs': first_ms, 'outputBytes': output_bytes})
        continue
    checked = {first} if len(first) <= 1024 * 1024 else set()
    checked_units = len(first) if checked else 0
    batch_calls = max(1, min(64, 1024 * 1024 // max(1, output_bytes)))
    def timed(calls):
        global checked_units
        total = 0
        for done in range(0, calls, batch_calls):
            values = [None] * min(batch_calls, calls - done)
            start = now()
            for i in range(len(values)):
                values[i] = render(workload['source'])
            total += elapsed(start)
            for value in values:
                if not isinstance(value, str) or not value.strip():
                    raise ValueError('returned no text after the first render')
                if value not in checked:
                    text = re.sub(r'\x1b\[[0-9;]*m', '', value)
                    missing = [label for label in workload['expected'] if not re.search(r'(?<!\w)' + re.escape(label) + r'(?!\w)', text)]
                    if missing:
                        raise ValueError('lost labels after the first render: ' + ', '.join(missing[:3]))
                    if checked_units + len(value) <= 1024 * 1024:
                        checked.add(value)
                        checked_units += len(value)
        return total
    try:
        case_start = now()
        warm_calls, warm_ms = 0, 0.0
        while warm_calls < timing['warmCalls'] or warm_ms < timing['warmupMs']:
            warm_ms += timed(1)
            warm_calls += 1
            if warm_ms >= timing['maxCaseMs'] / 4:
                break
        per_call = warm_ms / warm_calls
        iterations = max(1, math.ceil(timing['minSampleMs'] / max(per_call, 1e-6)))
        affordable = int((timing['maxCaseMs'] - elapsed(case_start)) // max(per_call * iterations, 1e-6))
        samples = []
        for _ in range(max(${MIN_SAMPLES}, min(timing['samples'], affordable))):
            samples.append(timed(iterations) / iterations)
            if len(samples) >= ${MIN_SAMPLES} and elapsed(case_start) > timing['maxCaseMs']:
                break
        mid = statistics.median(samples)
        emit({'type': 'result', 'workload': wid, 'status': 'ok', 'firstMs': first_ms, 'outputBytes': output_bytes, 'warmCalls': warm_calls, 'iterations': iterations, 'samplesMs': samples, 'medianMs': mid, 'madMs': statistics.median([abs(value - mid) for value in samples])})
    except Exception as error:
        emit({'type': 'result', 'workload': wid, 'status': 'error', 'detail': first_line(error), 'firstMs': first_ms, 'outputBytes': output_bytes})
end = {'type': 'end'}
try:
    end['rssBytes'] = int(open('/proc/self/statm').read().split()[1]) * os.sysconf('SC_PAGE_SIZE')
except OSError:
    pass
emit(end)
`

// ---------------------------------------------------------------------------
// Parent: install, cross-check pins, run interleaved rounds, report
// ---------------------------------------------------------------------------

interface Prepared {
  peer: Peer
  label: string
  root?: string
  version: string
  integrity?: string
  python?: string
  binary?: string
  warnings: string[]
  identity?: { kind: 'tarball'; requested: string; sha256: string; integrity: string }
  installedLocks?: string[]
  dependencyLocks?: Array<{ source: string; path: string; sha256: string }>
  runtimeDependencySha256?: string
  runtime?: RuntimeReceipt
  error?: string
}
interface ProcessRecord {
  peer: string
  output: Output
  round: number
  importMs?: number
  setupMs?: number
  rssBytes?: number
  peakRssBytes?: number
  settledHeapBytes?: number
  wallMs: number
  restarts: number
  results: WorkloadResult[]
}

const UNSUPPORTED = /Invalid mermaid header|No diagram type detected|UnknownDiagramError|Unrecognized Mermaid header|(?:unsupported|inventory-only) in Agentic Mermaid|unsupported diagram|diagram type is not supported/i

function parseArgs(argv: readonly string[]): Map<string, string> {
  const flags = new Set(['quick', 'child', 'corpus', 'aa'])
  const valued = new Set(['peers', 'workloads', 'rounds', 'json', 'markdown', 'agentic-npm', 'job', 'out', 'candidate-tarball', 'candidate-sha256', 'elk-cache', 'tracks', 'track-consumers', 'baseline-tarball', 'baseline-sha256', 'runtime-source'])
  const options = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!.replace(/^--/, '')
    if (flags.has(key)) options.set(key, 'true')
    else if (valued.has(key) && argv[i + 1] !== undefined) options.set(key, argv[++i]!)
    else throw new Error(`Unknown or incomplete option ${argv[i]}`)
  }
  if (options.has('elk-cache') && !['on', 'off'].includes(options.get('elk-cache')!)) throw new Error('--elk-cache must be on or off')
  if (options.has('candidate-tarball') !== options.has('candidate-sha256')) throw new Error('Provide both --candidate-tarball and --candidate-sha256')
  if (options.has('candidate-sha256') && !/^[a-f0-9]{64}$/.test(options.get('candidate-sha256')!)) throw new Error('--candidate-sha256 must be a lowercase SHA-256 digest')
  if (options.has('baseline-tarball') !== options.has('baseline-sha256')) throw new Error('Provide both --baseline-tarball and --baseline-sha256')
  if (options.has('baseline-sha256') && !/^[a-f0-9]{64}$/.test(options.get('baseline-sha256')!)) throw new Error('--baseline-sha256 must be a lowercase SHA-256 digest')
  if (options.has('aa') && options.has('baseline-tarball')) throw new Error('--aa and --baseline-tarball are separate controls')
  parsePeerTracks(options.get('tracks'))
  parsePeerConsumers(options.get('track-consumers'))
  if (options.has('track-consumers') && !parsePeerTracks(options.get('tracks')).length) throw new Error('--track-consumers requires --tracks')
  return options
}

const pin = (peer: Peer) => (peer.source.registry === 'local' ? 'local dist/' : peer.source.registry === 'git' ? `${peer.source.repo}/${peer.source.module}@${peer.source.commit}` : `${peer.source.name}@${peer.source.version}${peer.source.registry === 'pypi' ? ' (PyPI)' : ''}`)

function installGo(source: Extract<Peer['source'], { registry: 'git' }>): { binary: string; goVersion: string } {
  const prefix = join(CACHE, `sketch@${source.commit}`)
  const checkout = join(prefix, 'repo')
  mkdirSync(prefix, { recursive: true })
  const run = (command: string, args: string[], cwd = prefix) => {
    const child = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 300_000, env: { ...process.env, GOWORK: 'off' } })
    if (child.status !== 0) throw new Error(`${command} ${args[0]} failed: ${(child.stderr || child.error?.message || child.stdout || '').trim().slice(-1000)}`)
    return child.stdout.trim()
  }
  const goVersion = run('go', ['version'])
  if (!existsSync(join(checkout, '.git'))) run('git', ['clone', '--no-checkout', '--filter=blob:none', source.repo, checkout])
  run('git', ['fetch', '--depth', '1', 'origin', source.commit], checkout)
  run('git', ['checkout', '--detach', source.commit], checkout)
  if (run('git', ['rev-parse', 'HEAD'], checkout) !== source.commit) throw new Error('Sketch checkout differs from the requested commit')
  writeFileSync(join(prefix, 'go.mod'), `module agentic-mermaid-peer\n\ngo 1.25.0\n\nrequire tuios.dev/sketch v0.0.0\nreplace tuios.dev/sketch => ${JSON.stringify(join(checkout, source.module))}\n`)
  const binary = join(prefix, process.platform === 'win32' ? 'sketch-worker.exe' : 'sketch-worker')
  run('go', ['build', '-mod=mod', '-trimpath', '-o', binary, join(ROOT, 'eval/benchmark/sketch-worker.go')])
  return { binary, goVersion }
}

/** The ESM file Node would load for `subpath` under the import condition. */
function packageEntry(root: string, subpath: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; main?: string; exports?: unknown }
  let target: unknown = typeof pkg.exports === 'string' && subpath === '.' ? pkg.exports : (pkg.exports as Record<string, unknown> | undefined)?.[subpath]
  if (target === undefined && subpath === '.') target = pkg.main
  while (target && typeof target === 'object') target = (target as Record<string, unknown>).import ?? (target as Record<string, unknown>).default
  if (typeof target !== 'string') throw new Error(`${pkg.name} has no import entry for ${subpath}`)
  return join(root, target)
}

function installNpm(name: string, version: string): { root: string; integrity: string; engines?: string; installedLocks: string[] } {
  assertBenchmarkToolVersion(name, version, 'Node peer acquisition')
  const prefix = join(CACHE, `${name}@${version}`)
  const root = join(prefix, 'node_modules', name)
  const installed = () => {
    try {
      return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version
    } catch {
      return undefined
    }
  }
  if (installed() !== version) {
    mkdirSync(prefix, { recursive: true })
    console.error(`installing ${name}@${version} into ${relative(ROOT, prefix)}`)
    const child = spawnSync('npm', ['install', '--prefix', prefix, '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', `${name}@${version}`], { encoding: 'utf8', timeout: 300_000 })
    if (child.status !== 0 || installed() !== version) throw new Error(`npm install ${name}@${version} failed: ${(child.stderr || child.error?.message || '').trim().split('\n').at(-1)}`)
  }
  const { integrity } = installedNpmPackagePin(prefix, root, name, version)
  const engines = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines?: { node?: string } }).engines?.node
  return { root, integrity, engines, installedLocks: [join(prefix, 'package-lock.json'), join(prefix, 'node_modules/.package-lock.json')].filter(existsSync) }
}

function installPypi(name: string, version: string): { python: string; pythonVersion: string } {
  const prefix = join(CACHE, `${name}@${version}`)
  const python = join(prefix, 'venv/bin/python')
  const run = (command: string, args: string[]) => spawnSync(command, args, { encoding: 'utf8', timeout: 300_000 })
  const installed = () => (existsSync(python) ? run(python, ['-I', '-c', `import importlib.metadata as m; print(m.version(${JSON.stringify(name)}))`]).stdout?.trim() : undefined)
  if (installed() !== version) {
    console.error(`installing ${name}==${version} into ${relative(ROOT, prefix)}/venv`)
    if (!existsSync(python)) {
      mkdirSync(prefix, { recursive: true })
      const venv = run('python3', ['-m', 'venv', join(prefix, 'venv')])
      if (venv.status !== 0) throw new Error(`python3 -m venv failed: ${(venv.stderr || venv.error?.message || '').trim().split('\n').at(-1)}`)
    }
    // Wheels only: no source build runs package code at install time.
    const pip = run(python, ['-I', '-m', 'pip', 'install', '--no-deps', '--disable-pip-version-check', '--no-input', '--only-binary=:all:', `${name}==${version}`])
    if (pip.status !== 0 || installed() !== version) throw new Error(`pip install ${name}==${version} failed: ${(pip.stderr || '').trim().split('\n').at(-1)}`)
  }
  return { python, pythonVersion: run(python, ['-I', '-c', 'import sys; print(sys.version.split()[0])']).stdout.trim() }
}

function populationWarnings(peer: Peer): string[] {
  if (peer.source.registry === 'local') return []
  if (peer.source.registry === 'git') {
    const source = peer.source
    const population = JSON.parse(readFileSync(join(ROOT, 'eval/fork-graph/population.json'), 'utf8')) as { nodes: Array<{ repo?: string; head?: string; benchmarkCommit?: string }> }
    return population.nodes.some(node => node.repo === source.repo && (node.benchmarkCommit ?? node.head) === source.commit) ? [] : [`${peer.id}: git pin is not recorded in population.json`]
  }
  const { registry, name, version } = peer.source
  const population = JSON.parse(readFileSync(join(ROOT, 'eval/fork-graph/population.json'), 'utf8')) as { nodes: Array<{ id: string; packages?: Array<{ registry: string; name: string; version: string }> }> }
  const recorded = population.nodes.flatMap(node => (node.packages ?? []).filter(entry => entry.registry === registry && entry.name === name).map(entry => `${entry.version} (${node.id})`))
  if (!recorded.length) return [`${peer.id}: ${name} is not in eval/fork-graph/population.json`]
  return recorded.some(entry => entry.startsWith(`${version} `)) ? [] : [`${peer.id}: pinned ${name}@${version}, but population.json records ${recorded.join(', ')}`]
}

function prepare(peer: Peer, nodeVersion: string): Prepared {
  const warnings = populationWarnings(peer)
  if (peer.source.registry === 'local') {
    if (!existsSync(join(ROOT, 'dist/index.js'))) throw new Error('dist/index.js is missing: run `bun run build` before the peer benchmark')
    const dirty = git(['status', '--porcelain', '--', 'src']).length > 0
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version
    const built = statSync(join(ROOT, 'dist/index.js')).mtime.toISOString().slice(0, 16)
    return { peer, label: `agentic-mermaid ${version} local dist (HEAD ${git(['rev-parse', '--short=12', 'HEAD'])}${dirty ? ', src dirty' : ''}, built ${built}Z)`, root: ROOT, version, warnings }
  }
  const label = pin(peer)
  const version = peer.source.registry === 'git' ? peer.source.commit : peer.source.version
  try {
    if (peer.source.registry === 'git') {
      const { binary, goVersion } = installGo(peer.source)
      return { peer, label: `${label}, ${goVersion}`, version, binary, warnings }
    }
    const { registry, name } = peer.source
    if (registry === 'pypi') {
      const { python, pythonVersion } = installPypi(name, version)
      return { peer, label: `${label}, Python ${pythonVersion}`, version, python, warnings }
    }
    const { root, integrity, engines, installedLocks } = installNpm(name, version)
    const floor = engines?.match(/^>=\s*(\d+)/)?.[1]
    if (floor && Number(nodeVersion.replace(/^v/, '').split('.')[0]) < Number(floor)) warnings.push(`${peer.id}: ${name}@${version} declares engines.node ${engines}; workers run Node ${nodeVersion}`)
    return { peer, label, root, version, warnings, installedLocks, integrity }
  } catch (error) {
    return { peer, label, version, warnings, error: firstLine(error) }
  }
}

function preparePackedCandidate(tarball: string, expectedSha: string, parent: string, policy: RuntimePolicy, out: string, label: string): Prepared {
  const bytes = readFileSync(resolve(tarball))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expectedSha) throw new Error('Candidate tarball SHA-256 does not match the verified publication artifact')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const prefix = join(parent, `candidate-${randomUUID()}`)
  mkdirSync(prefix)
  const staged = join(prefix, 'package.tgz')
  writeFileSync(staged, bytes)
  const acquired = installAgenticRuntime(staged, prefix, policy, out, label, integrity)
  const root = join(prefix, 'node_modules', 'agentic-mermaid')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string }
  const installed = installedNpmPackagePin(prefix, root, 'agentic-mermaid', pkg.version, join(prefix, 'package-lock.json'))
  if (installed.integrity !== integrity) throw new Error('Installed candidate package identity differs from the verified tarball')
  return { peer: PEERS[0]!, root, version: pkg.version, warnings: [], label: `agentic-mermaid ${pkg.version} packed SHA-256 ${sha256}`,
    identity: { kind: 'tarball', requested: resolve(tarball), sha256, integrity }, runtime: acquired.runtime, installedLocks: [join(prefix, 'package-lock.json'), join(prefix, 'node_modules/.package-lock.json')].filter(existsSync) }
}

interface WorkerRun {
  lines: WorkerLine[]
  exit?: string
  stderr: string
  wallMs: number
}

/** Runs one worker, killing it if a workload (or the import) makes no
 * progress within its limit, so one hung render cannot stall the run. */
function spawnWorker(command: readonly string[], outPath: string, limits: { importMs: number; workloadMs: number }, elkCache: 'on' | 'off'): Promise<WorkerRun> {
  writeFileSync(outPath, '', { flag: 'wx' })
  const started = performance.now()
  return new Promise(done => {
    // Default to timing ELK; cache-on measures repeated rendering as a host sees it.
    const child = spawn(command[0]!, command.slice(1), { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: elkCache === 'on' ? '1' : '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
    let stderr = ''
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })
    let killedFor: string | undefined
    let seen = 0
    let lastProgress = performance.now()
    const watchdog = setInterval(() => {
      const count = readFileSync(outPath, 'utf8').split('\n').length - 1
      if (count !== seen) {
        seen = count
        lastProgress = performance.now()
      }
      const limit = seen === 0 ? limits.importMs : limits.workloadMs
      if (performance.now() - lastProgress > limit) {
        killedFor = `killed after ${Math.round(limit / 1000)} s without progress`
        child.kill('SIGKILL')
      }
    }, 250)
    child.on('close', (code, signal) => {
      clearInterval(watchdog)
      const text = readFileSync(outPath, 'utf8')
      const lines = text
        .slice(0, text.lastIndexOf('\n') + 1)
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as WorkerLine)
      const exit = code === 0 ? undefined : (killedFor ?? `exited with ${code ?? signal}`)
      done({ lines, stderr, wallMs: performance.now() - started, ...(exit ? { exit } : {}) })
    })
  })
}

async function runProcess(prepared: Prepared, output: Output, workloads: readonly WorkloadId[], round: number, context: { scratch: string; bundle: string; timing: Timing; sources: Record<WorkloadId, string>; elkCache: 'on' | 'off'; rawSamples: string; expectedLabels: Record<string, readonly string[]> }): Promise<ProcessRecord> {
  const { peer } = prepared
  const record: ProcessRecord = { peer: peer.id, output, round, wallMs: 0, restarts: 0, results: [] }
  const adapter = peer[output]!
  if (prepared.error) {
    record.results = workloads.map(id => ({ workload: id, status: 'error', detail: prepared.error }))
    return record
  }
  const entry = peer.runtime !== 'node' ? adapter.subpath : packageEntry(prepared.root!, adapter.subpath)
  const limits = { importMs: 120_000, workloadMs: Math.max(60_000, 10 * context.timing.maxCaseMs) }
  let remaining = [...workloads]
  for (let attempt = 0; remaining.length; attempt++) {
    const base = join(context.scratch, `${peer.id}-${output}-r${round}-a${attempt}`)
    const job: WorkerJob = { peer: peer.id, output, entry, timing: context.timing, workloads: remaining.map(id => ({ id, source: context.sources[id]!, expected: context.expectedLabels[id]!, ...(SVG_LABEL_PREFIXES[id] ? { svgLabelPrefixes: SVG_LABEL_PREFIXES[id] } : {}) })) }
    writeFileSync(`${base}.job.json`, JSON.stringify(job))
    const receipts = `${context.rawSamples}.${peer.id}-${output}-r${round}-a${attempt}.jsonl`
    const command = peer.runtime === 'go' ? [prepared.binary!, `${base}.job.json`, receipts] : peer.runtime === 'python' ? [prepared.python!, '-I', '-c', PYTHON_WORKER, `${base}.job.json`, receipts] : ['node', '--expose-gc', context.bundle, '--child', '--job', `${base}.job.json`, '--out', receipts]
    const run = await spawnWorker(command, receipts, limits, context.elkCache)
    for (const line of run.lines) appendFileSync(context.rawSamples, `${JSON.stringify({ peer: peer.id, output, round, attempt, ...line })}\n`)
    record.wallMs += run.wallMs
    const imported = run.lines.find(line => line.type === 'import')
    if (attempt === 0 && imported?.type === 'import') Object.assign(record, { importMs: imported.importMs, setupMs: imported.setupMs })
    const finished = run.lines.flatMap(line => (line.type === 'result' ? [line] : []))
    for (const { type: _, ...result } of finished) record.results.push(result.status === 'error' && UNSUPPORTED.test(result.detail ?? '') ? { ...result, status: 'unsupported' } : result)
    const doneIds = new Set(finished.map(line => line.workload))
    const end = run.lines.find(line => line.type === 'end')
    if (end?.type === 'end') {
      if (peer.runtime === 'node' && [end.rssBytes, end.peakRssBytes, end.settledHeapBytes].some(bytes => typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0)) {
        throw new Error(`${peer.id}/${output}: incomplete absolute memory observations`)
      }
      if (end.rssBytes !== undefined) record.rssBytes = end.rssBytes
      if (end.peakRssBytes !== undefined) record.peakRssBytes = end.peakRssBytes
      if (end.settledHeapBytes !== undefined) record.settledHeapBytes = end.settledHeapBytes
      break
    }
    const fatal = run.lines.find(line => line.type === 'fatal')
    const reason = fatal?.type === 'fatal' ? `import failed: ${fatal.error}` : `${run.exit ?? 'worker stopped'}${run.stderr.trim() ? `: ${run.stderr.trim().split('\n').at(-1)}` : ''}`
    const stuck = run.lines.flatMap(line => (line.type === 'start' && !doneIds.has(line.workload) ? [line.workload] : []))[0]
    if (!imported || !stuck) {
      for (const id of remaining.filter(id => !doneIds.has(id))) record.results.push({ workload: id, status: 'error', detail: reason })
      break
    }
    // The workload in progress is charged with the failure; a fresh worker
    // continues with the rest, and the restart is reported.
    record.results.push({ workload: stuck, status: 'error', detail: reason })
    record.restarts++
    remaining = remaining.filter(id => !doneIds.has(id) && id !== stuck)
  }
  return record
}

/** Enhanced measurements use the same prepared packages, adapters, worker,
 * watchdog, raw receipts and provenance as the legacy peer suite. */
async function runTrackProcess(prepared: Prepared, workloads: readonly string[], track: TrackJob, context: {
  scratch: string; bundle: string; timing: Timing; sources: Record<string, string>; expectedLabels: Record<string, readonly string[]>; rawSamples: string; elkCache: 'on' | 'off'
}): Promise<PeerTrackObservation[]> {
  const rows: PeerTrackObservation[] = []
  const diagnostics = new Map<string, PeerTrackObservation['diagnostics']>()
  // Every first-use workload has its own import/process, including receipt API.
  const cold = track.phase === 'first-use'
  const groups = cold ? workloads.flatMap(id => [
    ...Array.from({ length: track.coldSamples ?? 21 }, (_, sample) => ({ ids: [id], probe: 'timing' as const, sample })),
    ...Array.from({ length: track.allocationSamples }, (_, sample) => ({ ids: [id], probe: 'allocation' as const, sample })),
    { ids: [id], probe: 'diagnostic' as const, sample: 0 },
  ]) : [{ ids: workloads, probe: undefined, sample: 0 }]
  const unavailable = new Set<string>()
  for (const { ids: group, probe, sample } of groups) {
    if (unavailable.has(group[0]!)) continue
    const key = `${prepared.peer.id}-${track.phase}-${track.consumer}-r${track.round}-${group[0]}-${probe ?? 'warm'}-${sample}`
    const failed = (id: string, status: 'error' | 'unsupported', detail: string) => {
      const row = emptyTrackObservation(prepared.peer.id, track.round, id, track.phase, track.consumer)
      row.calls.push({ index: 0, variant: 0, status, detail })
      return finalizeTrackObservation(row)
    }
    if (prepared.error || !prepared.peer.svg || prepared.peer.runtime !== 'node') {
      const detail = prepared.error ?? 'enhanced consumed/semantic protocol requires a Node SVG adapter; legacy runtime results retained separately'
      rows.push(...group.map(id => failed(id, prepared.error ? 'error' : 'unsupported', detail)))
      if (cold) unavailable.add(group[0]!)
      continue
    }
    const base = join(context.scratch, key)
    const job: WorkerJob = { peer: prepared.peer.id, output: 'svg', entry: packageEntry(prepared.root!, prepared.peer.svg.subpath), timing: context.timing, track: { ...track, coldProbe: probe },
      workloads: group.map(id => ({ id, source: context.sources[id]!, expected: context.expectedLabels[id]!, svgLabelPrefixes: SVG_LABEL_PREFIXES[id] })) }
    writeFileSync(`${base}.job.json`, JSON.stringify(job))
    const receipts = `${context.rawSamples}.${key}.jsonl`
    const run = await spawnWorker(['node', '--expose-gc', context.bundle, '--child', '--job', `${base}.job.json`, '--out', receipts], receipts, { importMs: 120_000, workloadMs: Math.max(60_000, 10 * Math.min(track.maxCaseMs, 30_000)) }, context.elkCache)
    for (const line of run.lines) appendFileSync(context.rawSamples, `${JSON.stringify({ peer: prepared.peer.id, round: track.round, phase: track.phase, consumer: track.consumer, coldProbe: probe, coldSample: sample, ...line })}\n`)
    const completed = run.lines.flatMap(line => line.type === 'track' ? [line.observation] : [])
    const imported = run.lines.find(line => line.type === 'import')
    if (track.phase === 'first-use' && imported?.type === 'import') for (const row of completed) Object.assign(row, { importMs: imported.importMs, setupMs: imported.setupMs })
    rows.push(...completed)
    if (probe === 'diagnostic') for (const row of completed) diagnostics.set(row.workload, row.diagnostics)
    if (cold && completed.some(row => row.status === 'unsupported')) unavailable.add(group[0]!)
    const fatal = run.lines.find(line => line.type === 'fatal')
    for (const id of group.filter(id => !completed.some(row => row.workload === id))) rows.push(failed(id, 'error', fatal?.type === 'fatal' ? fatal.error : run.exit ?? 'worker omitted observation'))
  }
  const observations = cold ? workloads.map(id => {
    const parts = rows.filter(row => row.workload === id)
    const row = emptyTrackObservation(prepared.peer.id, track.round, id, track.phase, track.consumer)
    row.calls = parts.flatMap(part => part.calls).map((call, index) => ({ ...call, index }))
    row.allocationSamplesBytes = parts.flatMap(part => part.allocationSamplesBytes)
    row.allocationErrors = parts.flatMap(part => part.allocationErrors ?? [])
    row.diagnostics = diagnostics.get(id) ?? row.diagnostics
    const imports = parts.flatMap(part => part.importMs === undefined ? [] : [part.importMs])
    const setups = parts.flatMap(part => part.setupMs === undefined ? [] : [part.setupMs])
    if (imports.length) row.importMs = median(imports)
    if (setups.length) row.setupMs = median(setups)
    if (!row.allocationSamplesBytes.length) row.allocationUnsupported = parts.find(part => part.allocationUnsupported)?.allocationUnsupported
    return finalizeTrackObservation(row)
  }) : rows
  for (const row of observations) appendFileSync(context.rawSamples, `${JSON.stringify({ type: 'track-observation', ...row })}\n`)
  return observations
}

// --- Report -----------------------------------------------------------------

const formatMs = (ms: number | undefined) => (ms === undefined ? '—' : ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms >= 1 ? ms.toFixed(2) : ms.toFixed(3))
const formatKiB = (bytes: number | undefined) => (bytes === undefined ? '—' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`)
const formatMiB = (bytes: number | undefined) => (bytes === undefined ? '—' : `${(bytes / 1024 / 1024).toFixed(1)}`)
const cellText = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 90)

function markdownTable(header: readonly string[], rows: readonly string[][], textColumns = 1): string {
  return [`| ${header.join(' | ')} |`, `| ${header.map((_, column) => (column < textColumns ? '---' : '---:')).join(' | ')} |`, ...rows.map(row => `| ${row.map(cellText).join(' | ')} |`)].join('\n')
}

interface Summary {
  status: Status
  detail?: string
  missing?: number
  failedRounds: number
  rounds: number
  medianMs?: number
  noise?: number
  firstMs?: number
  outputBytes?: number
  allocBytesPerCall?: number
}

function summarize(entries: readonly WorkloadResult[]): Summary | undefined {
  if (!entries.length) return undefined
  const failed = entries.filter(entry => entry.status !== 'ok')
  const ok = entries.filter(entry => entry.status === 'ok' && entry.medianMs !== undefined)
  const pick = (values: Array<number | undefined>) => {
    const present = values.filter((value): value is number => value !== undefined)
    return present.length ? median(present) : undefined
  }
  return {
    status: failed[0]?.status ?? 'ok',
    ...(failed[0]?.detail ? { detail: failed[0].detail } : {}),
    ...(failed[0]?.missing ? { missing: failed[0].missing } : {}),
    failedRounds: failed.length,
    rounds: entries.length,
    ...(failed.length ? {} : { medianMs: median(ok.map(entry => entry.medianMs!)), noise: median(ok.map(entry => entry.madMs! / entry.medianMs!)) }),
    firstMs: pick(entries.map(entry => entry.firstMs)),
    outputBytes: pick(entries.map(entry => entry.outputBytes)),
    allocBytesPerCall: pick(ok.map(entry => entry.allocBytesPerCall)),
  }
}

function statusText(summary: Summary | undefined): string {
  if (!summary) return '—'
  if (summary.status === 'ok') return `${formatMs(summary.medianMs)} ±${(100 * summary.noise!).toFixed(0)}%`
  const text = summary.status === 'unsupported' ? 'unsupported' : summary.status === 'lost-labels' ? `lost labels (${summary.missing})` : `error: ${summary.detail}`
  return summary.failedRounds < summary.rounds ? `${text} (${summary.failedRounds}/${summary.rounds} rounds)` : text
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.has('child')) return runWorker(args.get('job')!, args.get('out')!)

  // A runtime path keeps the worker bundle from walking src/ through the
  // cases' lazy imports (and emitting its native assets); workers get sources
  // from the job file.
  const { MICRO_WORKLOADS } = (await import(pathToFileURL(join(ROOT, 'eval/benchmark/micro-bench-cases.ts')).href)) as typeof import('./micro-bench-cases.ts')
  const inventory = args.has('corpus') ? ((await import(pathToFileURL(join(ROOT, 'eval/shared/official-fences.ts')).href)).officialCorpusInventory() as ReturnType<typeof import('../shared/official-fences.ts').officialCorpusInventory>) : undefined
  const sources: Record<string, string> = inventory ? Object.fromEntries(inventory.occurrences.map(input => [input.id, input.source])) : MICRO_WORKLOADS
  const expectedLabels: Record<string, readonly string[]> = inventory ? Object.fromEntries(inventory.occurrences.map(input => [input.id, []])) : EXPECTED_LABELS
  const available: Record<Output, readonly string[]> = inventory ? { svg: Object.keys(sources), terminal: Object.keys(sources) } : WORKLOADS
  const rounds = Number(args.get('rounds') ?? 3)
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer')
  const elkCache = (args.get('elk-cache') ?? 'off') as 'on' | 'off'
  if (inventory && args.has('quick')) throw new Error('--corpus and --quick are separate sampling policies')
  const timing: Timing = inventory ? { warmCalls: 1, warmupMs: 0, samples: 3, minSampleMs: 0, maxCaseMs: 5000 } : args.has('quick') ? QUICK_TIMING : TIMING
  const phases = parsePeerTracks(args.get('tracks'))
  const consumers = parsePeerConsumers(args.get('track-consumers'))
  if (inventory && phases.length) throw new Error('--tracks uses synthetic semantic contracts and cannot be combined with --corpus')
  const npmVersion = args.get('agentic-npm')
  if (npmVersion !== undefined && !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(npmVersion)) throw new Error('--agentic-npm takes an exact version such as 0.4.1')
  const catalog = [PEERS[0]!, ...(npmVersion ? [{ ...PEERS[0]!, id: 'agentic-npm', source: { registry: 'npm', name: 'agentic-mermaid', version: npmVersion } } satisfies Peer] : []), ...PEERS.slice(1), ...(args.has('aa') || args.has('baseline-tarball') ? [{ ...PEERS[0]!, id: 'agentic-baseline' }] : [])]
  const requested = args
    .get('peers')
    ?.split(',')
    .map(id => id.trim())
  for (const id of requested ?? []) {
    if (id === 'mermaid') console.error(`skipping mermaid: ${NOT_COVERED[0]}`)
    else if (!catalog.some(peer => peer.id === id)) throw new Error(`Unknown peer ${id}; choose from ${catalog.map(peer => peer.id).join(', ')}`)
  }
  const peers = catalog.filter(peer => (peer.id === 'agentic-npm' || peer.id === 'agentic-baseline') || (requested ? requested.includes(peer.id) : !peer.optIn))
  const selected = (args
    .get('workloads')
    ?.split(',')
    .map(id => id.trim()) ?? Object.keys(expectedLabels)) as WorkloadId[]
  for (const id of selected) if (!(id in expectedLabels)) throw new Error(`Unknown workload ${id}; choose from ${Object.keys(expectedLabels).join(', ')}`)
  const workloads = { svg: available.svg.filter(id => selected.includes(id)), terminal: available.terminal.filter(id => selected.includes(id)) }

  if (args.has('candidate-tarball') && !peers.some(peer => peer.id === 'agentic')) throw new Error('--candidate-tarball requires the agentic peer')
  const jsonPath = resolve(args.get('json') ?? join(ROOT, 'bench-report', 'peer-report.json'))
  const markdownPath = resolve(args.get('markdown') ?? join(ROOT, 'bench-report', 'peer-report.md'))
  const runId = randomUUID()
  const rawSamples = `${jsonPath}.${runId}.samples.jsonl`
  for (const path of [jsonPath, markdownPath, rawSamples]) mkdirSync(dirname(path), { recursive: true })
  const nodeVersion = execFileSync('node', ['--version'], { encoding: 'utf8' }).trim()
  const createdAt = new Date().toISOString()
  const policy = { elkCache, sceneAssertions: 'off', nodeExposeGc: true, finalUntimedGc: true, executionEnvironment: peerExecutionEnvironment(process.env), aplEnvironment: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('APL_'))) }
  const metadata = { schemaVersion: 1, advisory: true, runId, createdAt, policy, rawSamples, workerReceipts: `${rawSamples}.*.jsonl`, config: { rounds, timing, minSamples: MIN_SAMPLES, workloads, peers: peers.map(peer => peer.id) } }
  writeFileSync(jsonPath, `${JSON.stringify({ ...metadata, status: 'incomplete' }, null, 2)}\n`)
  writeFileSync(markdownPath, '# Peer benchmark: incomplete (advisory)\n')
  writeFileSync(rawSamples, `${JSON.stringify({ ...metadata, status: 'started' })}\n`)
  const scratch = mkdtempSync(join(tmpdir(), 'agentic-mermaid-peers-'))
  const startLoad = loadavg()
  try {
    const runtimePolicy = frozenRuntimePolicy(args.get('runtime-source') ?? ROOT)
    const acquisitionOut = `${rawSamples}.acquisition`
    const prepared = peers.map(peer => {
      const archive = peer.id === 'agentic-baseline' ? args.get('baseline-tarball') ?? (args.has('aa') ? args.get('candidate-tarball') : undefined) : peer.id === 'agentic' ? args.get('candidate-tarball') : undefined
      const digest = peer.id === 'agentic-baseline' ? args.get('baseline-sha256') ?? args.get('candidate-sha256') : args.get('candidate-sha256')
      let entry: Prepared
      if (archive) entry = preparePackedCandidate(archive, digest!, scratch, runtimePolicy, acquisitionOut, peer.id)
      else if (peer.id === 'agentic-npm' && peer.source.registry === 'npm') {
        const prefix = join(scratch, peer.id)
        const acquired = installAgenticRuntime(`agentic-mermaid@${peer.source.version}`, prefix, runtimePolicy, acquisitionOut, peer.id)
        entry = { peer, label: pin(peer), version: peer.source.version, root: acquired.root, integrity: acquired.integrity, runtime: acquired.runtime, warnings: [], installedLocks: [join(prefix, 'package-lock.json'), join(prefix, 'node_modules/.package-lock.json')] }
      } else entry = prepare(peer, nodeVersion)
      entry.peer = peer
      if (peer.id.startsWith('agentic') && entry.root && !entry.runtime) entry.runtime = inspectAgenticRuntime(entry.root, runtimePolicy, acquisitionOut, peer.id)
      entry.dependencyLocks = entry.installedLocks?.map((source, index) => {
        const bytes = readFileSync(source), path = `${rawSamples}.${entry.peer.id}.${index}.package-lock.json`
        writeFileSync(path, bytes, { flag: 'wx' })
        return { source: source.endsWith('.package-lock.json') ? 'node_modules/.package-lock.json' : 'package-lock.json', path, sha256: createHash('sha256').update(bytes).digest('hex') }
      })
      const runtimeLock = entry.installedLocks?.find(path => path.endsWith('node_modules/.package-lock.json'))
      if (runtimeLock) {
        const lock = JSON.parse(readFileSync(runtimeLock, 'utf8')) as { packages?: Record<string, { version?: string; integrity?: string; link?: boolean }> }
        const dependencies = peerRuntimeDependencyGraph(lock)
        entry.runtimeDependencySha256 = createHash('sha256').update(JSON.stringify(dependencies)).digest('hex')
      }
      delete entry.installedLocks
      if (entry.dependencyLocks) appendFileSync(rawSamples, `${JSON.stringify({ peer: peer.id, dependencyLocks: entry.dependencyLocks })}\n`)
      return entry
    })
    assertMatchedAgenticRuntimes(prepared.flatMap(entry => entry.runtime ? [entry.runtime] : []))
    const toolVersions = assertBenchmarkSetVersions(prepared.filter(entry => !entry.error).map(entry => ({
      tool: entry.peer.id.startsWith('agentic') ? 'agentic-mermaid' : entry.peer.source.registry === 'npm' || entry.peer.source.registry === 'pypi' ? entry.peer.source.name : entry.peer.id,
      version: entry.version,
      source: `Node peer ${entry.peer.id}`,
      ...(entry.peer.id.startsWith('agentic') && entry.peer.id !== 'agentic' ? { variant: entry.peer.id } : {}),
    })))
    const warnings = prepared.flatMap(entry => entry.warnings)
    for (const warning of warnings) console.error(`warning: ${warning}`)
    for (const entry of prepared.filter(entry => entry.error)) console.error(`${entry.peer.id}: ${entry.error}`)
    appendFileSync(rawSamples, `${JSON.stringify({ pins: prepared.map(({ root, python, ...entry }) => entry) })}\n`)
    const jobs = prepared.flatMap(entry => (['svg', 'terminal'] as const).filter(output => entry.peer[output] && workloads[output].length).map(output => ({ prepared: entry, output })))
    if (!jobs.length) throw new Error('No selected peer/output/workload combinations')
    // The worker is this file bundled for Node, so it never depends on
    // Node's TypeScript support; peers are imported from their cache paths.
    const bundle = join(scratch, 'peer-bench.node.mjs')
    const built = spawnSync(process.versions.bun ? process.execPath : 'bun', ['build', fileURLToPath(import.meta.url), '--target=node', '--format=esm', '--outfile', bundle], { stdio: ['ignore', 'ignore', 'inherit'] })
    if (built.status !== 0) throw new Error('bun build of the Node worker failed')
    const trackSources = { ...sources }
    const trackExpected = { ...expectedLabels }
    const scaling: string[] = []
    if (phases.length) {
      const { flowchartTree, flowchartMesh } = await import(pathToFileURL(join(ROOT, 'eval/benchmark/release-bench-cases.ts')).href) as typeof import('./release-bench-cases.ts')
      if (selected.includes('tree50')) { scaling.push('tree100'); trackSources.tree100 = flowchartTree(100); trackExpected.tree100 = range('Node ', 100) }
      if (selected.includes('mesh50')) { scaling.push('mesh100'); trackSources.mesh100 = flowchartMesh(100, 40); trackExpected.mesh100 = range('label ', 40) }
    }
    const trackSettings = { coldSamples: args.has('quick') ? 3 : 21, warmCalls: args.has('quick') ? 3 : 20, warmupMs: args.has('quick') ? 0 : 1000, samples: args.has('quick') ? 3 : 201, allocationSamples: 3, maxCaseMs: args.has('quick') ? timing.maxCaseMs : 180_000 }
    const tracks: PeerTrackReport = { schemaVersion: 1, contractVersion: 'semantic-peer-v1', cohort: PEER_FROZEN_COHORT, phases, consumers, scaling, observations: [] }
    const trackWorkloads = [...workloads.svg, ...scaling]
    const trackInputs = Object.fromEntries(trackWorkloads.map(id => [id, { source: trackSources[id], expected: trackExpected[id] }]))
    const harnessRevision = git(['rev-parse', 'HEAD'])
    const harnessDirty = git(['status', '--porcelain', '--', 'eval/benchmark']).length > 0
    const tracksConfig = { variantDomains: PEER_VARIANT_DOMAINS, phases, consumers, ...trackSettings, ...(phases.length ? {
      consumption: 'indexed-utf8-checksum-v1',
      warmupSources: 'fresh-edit-ordinals-v1',
      apiBindings: prepared.map(({ peer }) => ({ peer: peer.id, svg: peer.svg ? { subpath: peer.svg.subpath, api: peer.svg.api } : null,
        receipt: peer.id === 'agentic' || peer.id.startsWith('agentic-') ? 'renderMermaidSVGWithReceipt(source); availability is retained per observation' : null })),
      rendererEnvironment: { host: 'Node public SVG API; no browser mount/adaptation', fontAndMeasurerOptions: 'pinned peer defaults; no overrides supplied', validation: 'Resvg(svg, {font:{loadSystemFonts:false}})' },
      freshness: { firstUse: 'first API render in each fresh process after import/setup', exactRepeat: 'identical source bytes and repeated labels', warmNewSource: 'authored visible-label/relationship edits and graph-ID renaming where defined; unchanged labels may reuse typography caches', labelEdit: 'authored visible-label/relationship edit; graph IDs retained' },
    } : {}), minimumTailCalls: 20, inputs: trackInputs, harnessRevision, harnessDirty }
    const processes: ProcessRecord[] = []
    for (let round = 0; round < rounds; round++) {
      for (const { prepared: entry, output } of phases.length ? [] : round % 2 === 0 ? jobs : [...jobs].reverse()) {
        console.error(`round ${round + 1}/${rounds}: ${entry.peer.id} ${output} (${workloads[output].length} workloads)`)
        const observation = await runProcess(entry, output, workloads[output], round, { scratch, bundle, timing, sources, elkCache, rawSamples, expectedLabels })
        processes.push(observation)
        appendFileSync(rawSamples, `${JSON.stringify({ type: 'process', ...observation })}\n`)
      }
      if (phases.length) for (const entry of round % 2 === 0 ? prepared : [...prepared].reverse()) for (const phase of phases) for (const consumer of consumers) {
        console.error(`round ${round + 1}/${rounds}: ${entry.peer.id} ${phase} ${consumer} (${trackWorkloads.length} workloads)`)
        tracks.observations.push(...await runTrackProcess(entry, trackWorkloads, { ...trackSettings, phase, consumer, round }, { scratch, bundle, timing, sources: trackSources, expectedLabels: trackExpected, elkCache, rawSamples }))
        writeFileSync(jsonPath, `${JSON.stringify({ ...metadata, status: 'incomplete', tracks, tracksConfig }, null, 2)}\n`)
      }
    }

    const cell = (peer: string, output: Output, workload: string) => summarize(processes.filter(entry => entry.peer === peer && entry.output === output).flatMap(entry => entry.results.filter(result => result.workload === workload)))
    const ratio = (peer: string, workload: string) => {
      const values = Array.from({ length: rounds }, (_, round) => {
        const at = (id: string) => processes.find(entry => entry.peer === id && entry.output === 'svg' && entry.round === round)?.results.find(result => result.workload === workload && result.status === 'ok')?.medianMs
        const [mine, theirs] = [at('agentic'), at(peer)]
        return mine && theirs !== undefined ? theirs / mine : undefined
      }).filter((value): value is number => value !== undefined)
      return values.length === rounds ? median(values) : undefined
    }
    const svgPeers = jobs.filter(job => job.output === 'svg').map(job => job.prepared.peer.id)
    const terminalPeers = jobs.filter(job => job.output === 'terminal').map(job => job.prepared.peer.id)
    const comparators = svgPeers.filter(id => id !== 'agentic')

    const legacyCoverage = jobs.map(({ prepared: entry, output }) => {
      const statuses = workloads[output].map(id => {
        const result = cell(entry.peer.id, output, id)
        return result?.rounds === rounds ? result.status : undefined
      })
      return { peer: entry.peer.id, output, population: statuses.length, ok: statuses.filter(status => status === 'ok').length, unsupported: statuses.filter(status => status === 'unsupported').length, lostLabels: statuses.filter(status => status === 'lost-labels').length, errors: statuses.filter(status => status === 'error').length, missing: statuses.filter(status => status === undefined).length }
    })
    const trackCoverage = (consumer: (typeof PEER_CONSUMERS)[number]) => prepared.map(entry => {
      const cells = trackWorkloads.map(workload => {
        const rows = tracks.observations.filter(row => row.peer === entry.peer.id && row.workload === workload && row.consumer === consumer)
        const status = rows.length === rounds * phases.length ? rows.some(row => row.status === 'error') ? 'error' : rows.some(row => row.status === 'lost-labels') ? 'lost-labels' : rows.some(row => row.status === 'unsupported') ? 'unsupported' : 'ok' : undefined
        return { workload, status, semanticQualified: rows.length === rounds * phases.length && rows.every(row => row.semantic.ok), observations: rows.length, expectedObservations: rounds * phases.length }
      })
      return { peer: entry.peer.id, output: 'svg' as const, consumer, population: cells.length, ok: cells.filter(cell => cell.status === 'ok').length, unsupported: cells.filter(cell => cell.status === 'unsupported').length, lostLabels: cells.filter(cell => cell.status === 'lost-labels').length, errors: cells.filter(cell => cell.status === 'error').length, missing: cells.filter(cell => cell.status === undefined).length, semanticQualified: cells.filter(cell => cell.semanticQualified).length, workloads: cells }
    })
    const coverage = phases.length ? trackCoverage('svg-utf8') : legacyCoverage
    const receiptCoverage = phases.length ? trackCoverage('receipt-json-utf8') : []
    const out: string[] = []
    out.push('# Peer benchmark (advisory)', '')
    out.push(`- Date: ${createdAt}`)
    out.push(`- Machine: ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} logical CPUs, ${(totalmem() / 1024 ** 3).toFixed(0)} GiB, ${process.platform} ${process.arch} ${release()}; load average ${startLoad.map(value => value.toFixed(2)).join(' ')} at start, ${loadavg()[0]!.toFixed(2)} at end`)
    out.push(`- Runtimes: Node ${nodeVersion} (Node workers), Bun ${process.versions.bun ?? 'n/a'} (orchestrator)`)
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const command = ['bun run bench:peers', '--peers', quote(peers.map(peer => peer.id).join(',')), '--workloads', quote(selected.join(',')), '--rounds', String(rounds), '--elk-cache', elkCache, ...(phases.length ? ['--tracks', quote(phases.join(',')), '--track-consumers', quote(consumers.join(','))] : []), ...(args.has('aa') ? ['--aa'] : []), ...(args.has('baseline-tarball') ? ['--baseline-tarball', quote(resolve(args.get('baseline-tarball')!)), '--baseline-sha256', args.get('baseline-sha256')!] : []), ...(args.has('quick') ? ['--quick'] : []), ...(inventory ? ['--corpus'] : []), ...(npmVersion ? ['--agentic-npm', quote(npmVersion)] : []), ...(args.has('candidate-tarball') ? ['--candidate-tarball', quote(resolve(args.get('candidate-tarball')!)), '--candidate-sha256', args.get('candidate-sha256')!] : [])]
    out.push('- Reproduce:', '', '```sh', command.join(' '), '```')
    out.push(`- Policy: ELK cache ${elkCache}; built-in Scene assertions off; Node --expose-gc and final untimed GC; APL environment ${JSON.stringify(policy.aplEnvironment)}`)
    if (inventory)
      out.push(
        `- Corpus: ${inventory.occurrenceCount} official fence occurrences (${inventory.distinctCount} distinct sources); no label assertions. Success establishes output, not authored meaning or visual quality. Coverage retains unsupported/error cases. Three single-call samples after one warmup; this is not the calibrated synthetic timing policy.`,
      )
    out.push(`- Pins: ${prepared.map(entry => `${entry.peer.id} = ${entry.label}`).join('; ')}`)
    for (const entry of prepared) for (const lock of entry.dependencyLocks ?? []) out.push(`- ${entry.peer.id} ${lock.source}: ${lock.path} (SHA-256 ${lock.sha256})`)
    out.push(
      phases.length ? `- Track method: ${rounds} paired round(s), ${trackSettings.warmCalls} priming calls and at least ${trackSettings.warmupMs} ms elapsed warmup, up to ${trackSettings.samples} individually clocked calls (minimum 20 for tail qualification), ${trackSettings.allocationSamples} separate allocation probes, wall cap ${trackSettings.maxCaseMs} ms; consumption inside clocks and allocation probes, validation outside. First-use has ${trackSettings.coldSamples} timing calls, ${trackSettings.allocationSamples} allocation probes and one untimed diagnostic call, each in its own fresh worker per case/consumer/round, with no earlier render. Warmup, timing, allocation and diagnostics use separate deterministic source streams; only exact-repeat and first-use retain identical bytes between streams. Diagnostics replay is untimed. No observable endpoint contract means semantic.ok=false and excludes semantic numeric qualification.` : `- Method: ${rounds} round(s), one fresh process per peer and output, order alternating; per workload one first render, then ≥${timing.warmCalls} warm calls and ≥${timing.warmupMs} ms, ≤${timing.samples} samples of ≥${timing.minSampleMs} ms (at least ${MIN_SAMPLES}), capped near ${timing.maxCaseMs} ms; every complete output checked outside timing for labels and parseable SVG, captured in batches of at most 64 returns (about 1 MiB at the first output size), with output stores and per-batch clocks included; medians across rounds, ± is the median MAD/median.`,
    )
    out.push(`- Not covered: ${NOT_COVERED.join('; ')}`)
    for (const warning of warnings) out.push(`- Warning: ${warning}`)
    for (const entry of prepared.filter(entry => entry.error)) out.push(`- Unavailable: ${entry.peer.id}: ${entry.error}`)
    if (!phases.length) {
      out.push('', '## Coverage across all rounds', '', markdownTable(['peer', 'output', 'population', 'successful', 'unsupported', 'lost labels', 'errors', 'missing'], coverage.map(row => [row.peer, row.output, ...[row.population, row.ok, row.unsupported, row.lostLabels, row.errors, row.missing].map(String)]), 2))
      out.push('', '## Adapters', '')
      out.push(
        markdownTable(
          ['peer', 'output', 'timed call', 'note'],
          jobs.map(({ prepared: entry, output }) => [entry.peer.id, output, entry.peer[output]!.api, entry.peer.note ?? '']),
          4,
        ),
      )
      out.push('', '## Coverage (successful in every round)', '')
      out.push(
        markdownTable(
          ['peer', 'output', 'ok', 'lost labels', 'unsupported', 'error', 'total'],
          jobs.map(({ prepared: entry, output }) => {
            const cells = workloads[output].map(id => cell(entry.peer.id, output, id))
            return [entry.peer.id, output, ...(['ok', 'lost-labels', 'unsupported', 'error'] as const).map(status => String(cells.filter(result => result?.status === status).length)), String(cells.length)]
          }),
          2,
        ),
      )
      if (svgPeers.length) {
        out.push('', '## Warm SVG, median ms per call', '')
        out.push(
          markdownTable(
            ['workload', ...svgPeers],
            workloads.svg.map(id => [id, ...svgPeers.map(peer => statusText(cell(peer, 'svg', id)))]),
          ),
        )
        if (svgPeers.includes('agentic') && comparators.length) {
          out.push('', '## Warm SVG ratio, peer ÷ agentic (below 1: the peer is faster)', '', 'Per-round ratio, then the median, on workloads both pass in every round.', '')
          const ratios = workloads.svg.map(id => comparators.map(peer => ratio(peer, id)))
          const geomean = comparators.map((_, column) => {
            const values = ratios.map(row => row[column]).filter((value): value is number => value !== undefined)
            return values.length ? `${Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length).toPrecision(3)}× (${values.length})` : '—'
          })
          out.push(markdownTable(['workload', ...comparators], [...workloads.svg.map((id, row) => [id, ...ratios[row]!.map(value => (value === undefined ? '—' : `${value.toPrecision(3)}×`))]), ['geometric mean (n)', ...geomean]]))
        }
        out.push('', '## SVG output size and V8 allocation per call', '', 'Allocation is a GC-boundary estimate of the JS heap; it does not see WASM linear memory (mermaid-rs) or native heap (merman), and is not measured for Go or Python.', '')
        out.push(
          markdownTable(
            ['workload', ...svgPeers],
            workloads.svg.map(id => [
              id,
              ...svgPeers.map(peer => {
                const summary = cell(peer, 'svg', id)
                return summary?.status === 'ok' ? `${formatKiB(summary.outputBytes)} / ${formatKiB(summary.allocBytesPerCall)}` : '—'
              }),
            ]),
          ),
        )
      }
      out.push('', '## Cold start, median across rounds', '', 'Import includes one-time setup (Merman engine creation); first render is the first call in a fresh process; end RSS is resident memory after the last workload before the final untimed GC. Node peak RSS is the process high-water mark; settled heap is absolute used heap after that GC. All include harness/parser/sink state, not pure renderer retention; Python has no corresponding JS heap/peak receipt. Allocation excludes validation and capture-array allocation.', '')
      const coldRows = jobs.map(({ prepared: entry, output }) => {
        const records = processes.filter(record => record.peer === entry.peer.id && record.output === output)
        const pick = (values: Array<number | undefined>) => {
          const present = values.filter((value): value is number => typeof value === 'number')
          return present.length ? median(present) : undefined
        }
        const first = cell(entry.peer.id, output, 'flow5')
        const restarts = records.reduce((sum, record) => sum + record.restarts, 0)
        return [
          `${entry.peer.id}${restarts ? ` (${restarts} restart${restarts > 1 ? 's' : ''})` : ''}`,
          output,
          entry.peer.runtime === 'go' ? 'static binary' : formatMs(pick(records.map(record => (record.importMs === undefined ? undefined : record.importMs + (record.setupMs ?? 0))))),
          first?.firstMs === undefined ? '—' : formatMs(first.firstMs),
          formatMiB(pick(records.map(record => record.rssBytes))),
          formatMiB(pick(records.map(record => record.peakRssBytes))),
          formatMiB(pick(records.map(record => record.settledHeapBytes))),
        ]
      })
      out.push(markdownTable(['peer', 'output', 'import ms', 'first flow5 ms', 'end RSS MiB', 'peak RSS MiB', 'settled heap MiB'], coldRows, 2))
      if (terminalPeers.length) {
        out.push('', '## Warm terminal (Unicode, no colour), median ms per call', '')
        out.push(
          markdownTable(
            ['workload', ...terminalPeers],
            workloads.terminal.map(id => [id, ...terminalPeers.map(peer => statusText(cell(peer, 'terminal', id)))]),
          ),
        )
      }
    }
    if (phases.length) out.push('', '## Consumed SVG coverage across every phase/round', '', markdownTable(['peer', 'population', 'label/geometry OK', 'semantic qualified', 'unsupported', 'lost labels', 'errors', 'missing'], coverage.map(row => [row.peer, ...[row.population, row.ok, 'semanticQualified' in row ? row.semanticQualified : 0, row.unsupported, row.lostLabels, row.errors, row.missing].map(String)])), '', 'Receipt availability and coverage are counted separately.', '', markdownTable(['peer', 'receipt population', 'OK', 'unsupported', 'lost labels', 'errors', 'missing'], receiptCoverage.map(row => [row.peer, ...[row.population, row.ok, row.unsupported, row.lostLabels, row.errors, row.missing].map(String)])))
    if (phases.length) out.push('', '## Consumed semantic tracks', '', 'Per-call observations, allocation samples, bounded identity/endpoint checks and untimed cache/fallback diagnostics are retained in JSON under tracks.observations. First-use uses a fresh process for each workload and consumer. Cold tails require 20 independent first-render workers per round; receipt-unavailable peers are explicitly unsupported. These contracts do not establish visual equivalence or endpoint attachment geometry.', '', markdownTable(['peer', 'phase', 'consumer', 'workload', 'status', 'calls', 'p50 ms', 'p95 ms'], tracks.observations.map(row => [row.peer, row.phase, row.consumer, row.workload, row.status, String(row.callSamplesMs.length), formatMs(row.p50Ms), formatMs(row.p95Ms)]), 5))
    const markdown = `${out.join('\n')}\n`
    console.log(markdown)
    writeFileSync(markdownPath, markdown)
    appendFileSync(rawSamples, `${JSON.stringify({ status: 'completed', coverage })}\n`)
    {
      const summary: Record<Output, Record<string, Record<string, unknown>>> = { svg: {}, terminal: {} }
      for (const { prepared: entry, output } of jobs) summary[output][entry.peer.id] = Object.fromEntries(workloads[output].map(id => [id, { ...cell(entry.peer.id, output, id), ...(output === 'svg' && entry.peer.id !== 'agentic' ? { ratioToAgentic: ratio(entry.peer.id, id) } : {}) }]))
      const report = {
        ...metadata, status: 'completed', finishedAt: new Date().toISOString(), toolVersions,
        environment: { hostname: hostname(), node: nodeVersion, bun: process.versions.bun, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemBytes: totalmem(), loadAverageStart: startLoad, loadAverageEnd: loadavg() },
        config: { rounds, timing, minSamples: MIN_SAMPLES, workloads: phases.length ? { svg: trackWorkloads, terminal: [] } : workloads, peers: phases.length ? prepared.map(entry => ({ peer: entry.peer.id, output: 'svg' })) : jobs.map(job => ({ peer: job.prepared.peer.id, output: job.output })) },
        pins: prepared.map(entry => ({ peer: entry.peer.id, source: entry.peer.source, label: entry.label, ...(entry.integrity ? { integrity: entry.integrity } : {}), ...(entry.identity ? { identity: entry.identity } : {}), ...(entry.dependencyLocks ? { dependencyLocks: entry.dependencyLocks } : {}), ...(entry.runtime ? { runtime: entry.runtime } : {}), ...(entry.runtimeDependencySha256 ? { runtimeDependencySha256: entry.runtimeDependencySha256 } : {}), ...(entry.error ? { error: entry.error } : {}), svg: entry.peer.svg?.api, terminal: entry.peer.terminal?.api })),
        tracks, tracksConfig,
        cohorts: { frozen: PEER_FROZEN_COHORT, all: Object.keys(EXPECTED_LABELS) },
        ...(phases.length ? {} : { frozenCohortComparisons: comparators.map(peer => {
          const values = PEER_FROZEN_COHORT.map(workload => ratio(peer, workload))
          return { peer, expected: PEER_FROZEN_COHORT.length, supported: values.filter(value => value !== undefined).length, ratioToAgentic: values.every((value): value is number => value !== undefined) ? Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length) : undefined }
        }) }),
        coverage, receiptCoverage,
        ...(inventory ? { corpus: inventory } : {}),
        expectedLabels: phases.length ? trackExpected : expectedLabels,
        expectedSvgLabelPrefixes: SVG_LABEL_PREFIXES,
        warnings,
        notCovered: NOT_COVERED,
        ...(phases.length ? {} : { processes, summary }),
      }
      writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
    }
  } catch (error) {
    const reason = firstLine(error)
    appendFileSync(rawSamples, `${JSON.stringify({ status: 'failed', error: reason })}\n`)
    writeFileSync(jsonPath, `${JSON.stringify({ ...metadata, status: 'failed', error: reason }, null, 2)}\n`)
    writeFileSync(markdownPath, `# Peer benchmark: incomplete (advisory)\n\n${reason}\n`)
    throw error
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

await main()
