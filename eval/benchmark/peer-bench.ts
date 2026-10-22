// Peer benchmark: the same workloads in agentic-mermaid's built package and in
// the browserless peers from eval/fork-graph, each timed in fresh processes.
//
//   bun run eval/benchmark/peer-bench.ts                     # every peer, 3 rounds
//   bun run eval/benchmark/peer-bench.ts --quick --rounds 1  # smoke run
//   bun run eval/benchmark/peer-bench.ts --peers agentic,pele --workloads flow5,tree50
//   bun run eval/benchmark/peer-bench.ts --agentic-npm 0.4.1 # add the published package
//
// Options: --peers a,b, --workloads a,b, --rounds N (3), --json PATH,
// --markdown PATH, --quick (fewer, shorter samples), --agentic-npm VERSION.
// --outputs svg --consume-svg consumes UTF-8 + SHA-256 on every timed call
// (Node SVG only, normal local caches, whole visible label phrases); legacy sampling is unchanged otherwise.
// --peers agentic,agentic-aa,agentic-native adds strict native and an identical
// default-ELK control, both opt-in. Zombie 5.8.2 has separate zombie-current
// and zombie-simple arms; marker-free State can also take its simple path.
// --svg-dir PATH retains each first output, including lost-label results.
// --corpus uses every official fence occurrence (including unsupported types),
// with one warmup and three single-call samples instead of calibrated loops.
// Corpus success is nonempty output, not a semantic/visual fidelity claim.
//
// Advisory only: it replaces the dated hand-run tables in docs/comparison.md
// with a re-runnable command and is never part of tests or CI. `agentic` is the
// local `dist/` (run `bun run build` first). Registry peers are installed at
// the exact version pinned below into
// node_modules/.cache/agentic-mermaid-peers/<name>@<version>/, with install
// scripts disabled (termaid: wheel only, into a venv there). Peer code runs
// only inside worker processes, but there with this user's privileges, and a
// peer's transitive npm dependencies resolve at install time (no lockfile).
// Registry pins are checked against docs/mermaid-community.json; git pins
// against eval/fork-graph/population.json; a mismatch is a
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

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, release, tmpdir, totalmem } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decodeXML } from 'entities'
import { allocationProbe, median } from './bench-stats.ts'
import type { MICRO_WORKLOADS } from './micro-bench-cases.ts'
import { layoutCacheEnvironment, missingSvgLabels } from './release-bench-fidelity.ts'
import { git, ROOT } from './revision-tree.ts'

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
  { id: 'agentic-aa', source: { registry: 'local' }, runtime: 'node', optIn: true, svg: beautifulApi.svg, note: 'identical default-ELK A/A control' },
  {
    id: 'agentic-native', source: { registry: 'local' }, runtime: 'node', optIn: true,
    svg: { subpath: '.', api: "renderMermaidSVG(source, { graphLayout: { backend: 'agentic', fallback: 'none' } })", make: m => source => m.renderMermaidSVG(source, { graphLayout: { backend: 'agentic', fallback: 'none' } }) },
    note: 'strict native; unchanged non-graph families do not establish a layout-backend improvement',
  },
  { id: 'ondine', source: { registry: 'npm', name: 'ondine', version: '0.0.1' }, runtime: 'node', optIn: true, svg: { subpath: './compiler', api: 'render(source).svg', make: m => source => m.render(source).svg }, note: 'published Node compiler, not the mount-only runtime or source HEAD' },
  { id: 'beautiful', source: { registry: 'npm', name: 'beautiful-mermaid', version: '1.1.3' }, runtime: 'node', ...beautifulApi },
  {
    id: 'zombie',
    source: { registry: 'npm', name: 'zombie-mermaid', version: '5.7.1' },
    runtime: 'node',
    svg: beautifulApi.svg,
    terminal: { ...beautifulApi.terminal, subpath: './ascii', api: `zombie-mermaid/ascii ${beautifulApi.terminal.api}` },
  },
  {
    id: 'zombie-current', source: { registry: 'npm', name: '@zombie-mermaid/svg-renderer', version: '5.8.2' }, runtime: 'node', optIn: true,
    svg: beautifulApi.svg, note: 'supplementary 2026-10-22 pin; Node auto-loads elkjs from the repository working directory',
  },
  {
    id: 'zombie-simple', source: { registry: 'npm', name: '@zombie-mermaid/svg-renderer', version: '5.8.2' }, runtime: 'node', optIn: true,
    svg: { subpath: '.', api: "renderMermaidSVG(source, { layout: 'simple' }) (Node auto-loads ELK where required)", make: m => source => m.renderMermaidSVG(source, { layout: 'simple' }) },
    note: 'Flowchart simple also handles marker-free State; Class/ER/Architecture use auto-loaded ELK; hybrid',
  },
  { id: 'pele', source: { registry: 'npm', name: 'pele', version: '1.6.0' }, runtime: 'node', svg: { subpath: '.', api: 'render(source).svg', make: m => source => m.render(source).svg }, note: 'returns { svg, ... }; only .svg is read' },
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
const EXPECTED_LABELS: Record<WorkloadId, readonly string[]> = {
  flow5: ['Start', 'Check', 'Do it', 'Skip', 'End'],
  tree50: range('Node ', 50),
  mesh50: range('label ', 20),
  seq20: range('message ', 20),
  // The C4 legend also prints the type names, so check text only a node or
  // relationship carries.
  c4: ['User', 'Email', 'Uses', 'Sends'],
  class80: range('C', 80),
  er40: range('E', 40),
  state80: range('S', 81),
  packet240: range('Field ', 240),
  kanban240: Array.from({ length: 12 }, (_, stage) => [`Stage ${stage}`, ...Array.from({ length: 20 }, (_, task) => `Task ${stage}.${task}`)]).flat(),
  requirement100: range('Requirement ', 100),
  architecture3: ['API', 'Database', 'Storage', 'Server'],
  // Leaf labels may be explicitly hidden in small quantitative cells; the
  // release workload's section labels and title remain visible in SVG.
  treemap260: ['Product allocation', ...range('Group ', 20)],
  ishikawa133: ['Delayed delivery', ...Array.from({ length: 12 }, (_, category) => [`Category ${category}`, ...Array.from({ length: 10 }, (_, cause) => `Cause ${category}.${cause}`)]).flat()],
  block120: range('Component ', 120),
}
const WORKLOADS: Record<Output, readonly WorkloadId[]> = {
  svg: ['flow5', 'tree50', 'mesh50', 'seq20', 'c4', 'class80', 'er40', 'state80', 'requirement100', 'architecture3'],
  terminal: ['flow5', 'tree50', 'mesh50', 'seq20'],
}

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
  firstSha256?: string
  lastSha256?: string
  changedOutputCalls?: number
  consumedCalls?: number
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
  consumeSvg?: boolean
  svgDirectory?: string
  workloads: Array<{ id: string; source: string; expected: readonly string[] }>
}
type WorkerLine = { type: 'import'; importMs: number; setupMs: number } | { type: 'fatal'; error: string } | { type: 'start'; workload: string } | ({ type: 'result' } & WorkloadResult) | { type: 'end'; rssBytes?: number }

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
function missingLabels(output: Output, rendered: string, expected: readonly string[], visiblePhrases = false): string[] {
  if (output === 'terminal') {
    const text = rendered.replace(ANSI_SGR, '')
    return expected.filter(label => !terminalLabel(label).test(text))
  }
  const missing = missingSvgLabels(rendered, expected)
  if (!missing.length) return missing
  const seen = new Set<string>()
  if (visiblePhrases) for (const [, inner] of rendered.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) seen.add(textOf(inner!))
  for (const [, inner] of rendered.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)) seen.add(textOf(inner!))
  for (const [, inner] of rendered.matchAll(/<foreignObject\b[^>]*>([\s\S]*?)<\/foreignObject>/g)) {
    seen.add(textOf(inner!))
    for (const run of inner!.split(/<[^>]+>/)) seen.add(textOf(run))
  }
  return missing.filter(label => {
    if (seen.has(label)) return false
    // A Requirement row may paint 'Text: Requirement 1' as one text element,
    // or its field/value as separate elements. Count the same visible phrase
    // in both, without accepting Requirement 1 inside Requirement 10.
    return !visiblePhrases || ![...seen].some(run => terminalLabel(label).test(run))
  })
}

async function measure(render: Render, output: Output, workload: WorkerJob['workloads'][number], timing: Timing, allocation: Awaited<ReturnType<typeof allocationProbe>>, consumeSvg = false, svgDirectory?: string): Promise<WorkloadResult> {
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
  if (svgDirectory) {
    mkdirSync(svgDirectory, { recursive: true })
    writeFileSync(join(svgDirectory, `${encodeURIComponent(id)}.svg`), first)
  }
  const outputBytes = Buffer.byteLength(first, 'utf8')
  const missing = missingLabels(output, first, workload.expected, consumeSvg)
  if (missing.length) return { workload: id, status: 'lost-labels', missing: missing.length, detail: missing.slice(0, 3).join(', '), firstMs, outputBytes }

  // Async peers are awaited per call; sync peers are timed in a plain loop
  // whose clock stops before this function's own promise settles.
  let sink: unknown = first
  const fingerprint = (value: unknown): string => {
    if (typeof value !== 'string' || !/^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b/.test(value)) throw new TypeError('render returned no SVG text during consumed sampling')
    return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex')
  }
  const firstSha256 = consumeSvg ? fingerprint(first) : undefined
  let lastSha256 = firstSha256, consumedCalls = 0, changedOutputCalls = 0
  const consume = (value: unknown) => {
    if (!consumeSvg) { sink = value; return }
    lastSha256 = fingerprint(value)
    consumedCalls++
    if (lastSha256 !== firstSha256) {
      changedOutputCalls++
      if (missingLabels(output, value as string, workload.expected, true).length) throw new Error('labels lost during consumed sampling')
    }
    sink = lastSha256
  }
  const timed = async (calls: number): Promise<number> => {
    const start = performance.now()
    if (consumeSvg) {
      if (isAsync) for (let i = 0; i < calls; i++) consume(await render(workload.source))
      else for (let i = 0; i < calls; i++) consume(render(workload.source))
    } else {
      if (isAsync) for (let i = 0; i < calls; i++) sink = await render(workload.source)
      else for (let i = 0; i < calls; i++) sink = render(workload.source)
    }
    return performance.now() - start
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
    const allocBytesPerCall = allocation ? (await allocation(() => timed(iterations))) / iterations : undefined
    ;(globalThis as { __peerBenchSink?: unknown }).__peerBenchSink = sink
    const medianMs = median(samplesMs)
    return { workload: id, status: 'ok', firstMs, outputBytes, ...(consumeSvg ? { firstSha256, lastSha256, consumedCalls, changedOutputCalls } : {}), warmCalls, iterations, samplesMs, medianMs, madMs: median(samplesMs.map(value => Math.abs(value - medianMs))), ...(allocBytesPerCall === undefined ? {} : { allocBytesPerCall }) }
  } catch (error) {
    return { workload: id, status: 'error', detail: `after the first render: ${firstLine(error)}`, firstMs, outputBytes }
  }
}

async function runWorker(jobPath: string, outPath: string): Promise<void> {
  const job = JSON.parse(readFileSync(jobPath, 'utf8')) as WorkerJob
  const emit = (line: WorkerLine) => appendFileSync(outPath, `${JSON.stringify(line)}\n`)
  // --agentic-npm adds a peer at run time; it uses agentic's adapters.
  const peer = PEERS.find(entry => entry.id === job.peer) ?? (job.peer === 'agentic-npm' ? PEERS[0] : undefined)
  const make = peer?.[job.output]?.make
  if (!make) throw new Error(`no ${job.output} adapter for ${job.peer}`)
  if (job.consumeSvg) Object.assign(process.env, layoutCacheEnvironment('normal'))
  const allocation = await allocationProbe()
  let render: Render
  try {
    const importStart = performance.now()
    const module = (await import(pathToFileURL(job.entry).href)) as PeerModule
    const setupStart = performance.now()
    render = await make(module)
    emit({ type: 'import', importMs: setupStart - importStart, setupMs: performance.now() - setupStart })
  } catch (error) {
    emit({ type: 'fatal', error: firstLine(error) })
    process.exit(0)
  }
  for (const workload of job.workloads) {
    emit({ type: 'start', workload: workload.id })
    emit({ type: 'result', ...(await measure(render, job.output, workload, job.timing, allocation, job.consumeSvg, job.svgDirectory)) })
  }
  emit({ type: 'end', rssBytes: process.memoryUsage().rss })
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
    case_start = now()
    warm_calls, warm_ms = 0, 0.0
    while warm_calls < timing['warmCalls'] or warm_ms < timing['warmupMs']:
        start = now()
        render(source)
        warm_ms += elapsed(start)
        warm_calls += 1
        if warm_ms >= timing['maxCaseMs'] / 4:
            break
    per_call = warm_ms / warm_calls
    iterations = max(1, math.ceil(timing['minSampleMs'] / max(per_call, 1e-6)))
    affordable = int((timing['maxCaseMs'] - elapsed(case_start)) // max(per_call * iterations, 1e-6))
    samples = []
    for _ in range(max(${MIN_SAMPLES}, min(timing['samples'], affordable))):
        start = now()
        for _ in range(iterations):
            render(source)
        samples.append(elapsed(start) / iterations)
        if len(samples) >= ${MIN_SAMPLES} and elapsed(case_start) > timing['maxCaseMs']:
            break
    mid = statistics.median(samples)
    emit({'type': 'result', 'workload': wid, 'status': 'ok', 'firstMs': first_ms, 'outputBytes': output_bytes, 'warmCalls': warm_calls, 'iterations': iterations, 'samplesMs': samples, 'medianMs': mid, 'madMs': statistics.median([abs(value - mid) for value in samples])})
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
  error?: string
}
interface ProcessRecord {
  peer: string
  output: Output
  round: number
  importMs?: number
  setupMs?: number
  rssBytes?: number
  wallMs: number
  restarts: number
  results: WorkloadResult[]
}

const UNSUPPORTED = /Invalid mermaid header|No diagram type detected|UnknownDiagramError|Unrecognized Mermaid header|(?:unsupported|inventory-only) in Agentic Mermaid|unsupported diagram|diagram type is not supported/i

function parseArgs(argv: readonly string[]): Map<string, string> {
  const flags = new Set(['quick', 'child', 'corpus', 'consume-svg'])
  const valued = new Set(['peers', 'workloads', 'rounds', 'json', 'markdown', 'agentic-npm', 'job', 'out', 'outputs', 'svg-dir'])
  const options = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!.replace(/^--/, '')
    if (flags.has(key)) options.set(key, 'true')
    else if (valued.has(key) && argv[i + 1] !== undefined) options.set(key, argv[++i]!)
    else throw new Error(`Unknown or incomplete option ${argv[i]}`)
  }
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

function installNpm(name: string, version: string): { root: string; integrity?: string; engines?: string } {
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
  const lock = JSON.parse(readFileSync(join(prefix, 'node_modules/.package-lock.json'), 'utf8')) as { packages: Record<string, { integrity?: string }> }
  const engines = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines?: { node?: string } }).engines?.node
  return { root, integrity: lock.packages[`node_modules/${name}`]?.integrity, engines }
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
  const population = JSON.parse(readFileSync(join(ROOT, 'docs/mermaid-community.json'), 'utf8')) as { nodes: Array<{ id: string; packages?: Array<{ registry: string; name: string; version: string }> }> }
  const recorded = population.nodes.flatMap(node => (node.packages ?? []).filter(entry => entry.registry === registry && entry.name === name).map(entry => `${entry.version} (${node.id})`))
  if (!recorded.length) return [`${peer.id}: ${name} is not in docs/mermaid-community.json`]
  return recorded.some(entry => entry.startsWith(`${version} `)) ? [] : [`${peer.id}: pinned ${name}@${version}, but mermaid-community.json records ${recorded.join(', ')}`]
}

/** Hash the complete local distribution, including chunks/assets, before timing. */
function distributionSha256(directory: string): string {
  const hash = createHash('sha256')
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) visit(child)
      else { hash.update(relative(directory, child)); hash.update('\0'); hash.update(readFileSync(child)); hash.update('\0') }
    }
  }
  visit(directory)
  return hash.digest('hex')
}

function prepare(peer: Peer, nodeVersion: string): Prepared {
  const warnings = populationWarnings(peer)
  if (peer.source.registry === 'local') {
    if (!existsSync(join(ROOT, 'dist/index.js'))) throw new Error('dist/index.js is missing: run `bun run build` before the peer benchmark')
    const dirty = git(['status', '--porcelain', '--', 'src']).length > 0
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version
    const built = statSync(join(ROOT, 'dist/index.js')).mtime.toISOString().slice(0, 16)
    return { peer, label: `agentic-mermaid ${version} local dist (HEAD ${git(['rev-parse', '--short=12', 'HEAD'])}${dirty ? ', src dirty' : ''}, built ${built}Z; dist SHA-256 ${distributionSha256(join(ROOT, 'dist'))})`, root: ROOT, version, warnings }
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
    const { root, integrity, engines } = installNpm(name, version)
    const floor = engines?.match(/^>=\s*(\d+)/)?.[1]
    if (floor && Number(nodeVersion.replace(/^v/, '').split('.')[0]) < Number(floor)) warnings.push(`${peer.id}: ${name}@${version} declares engines.node ${engines}; workers run Node ${nodeVersion}`)
    return { peer, label, root, version, warnings, ...(integrity ? { integrity } : {}) }
  } catch (error) {
    return { peer, label, version, warnings, error: firstLine(error) }
  }
}

interface WorkerRun {
  lines: WorkerLine[]
  exit?: string
  stderr: string
  wallMs: number
}

/** Runs one worker, killing it if a workload (or the import) makes no
 * progress within its limit, so one hung render cannot stall the run. */
function spawnWorker(command: readonly string[], outPath: string, limits: { importMs: number; workloadMs: number }): Promise<WorkerRun> {
  writeFileSync(outPath, '')
  const started = performance.now()
  return new Promise(done => {
    // Time ELK rather than a cached result, and renders as users get them.
    const child = spawn(command[0]!, command.slice(1), { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
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

async function runProcess(prepared: Prepared, output: Output, workloads: readonly WorkloadId[], round: number, context: { scratch: string; bundle: string; timing: Timing; sources: Record<WorkloadId, string>; consumeSvg: boolean; svgDirectory?: string; expectedLabels: Record<string, readonly string[]> }): Promise<ProcessRecord> {
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
    const job: WorkerJob = { peer: peer.id, output, entry, timing: context.timing, consumeSvg: context.consumeSvg, svgDirectory: context.svgDirectory ? join(context.svgDirectory, peer.id, `round-${round}`) : undefined, workloads: remaining.map(id => ({ id, source: context.sources[id]!, expected: context.expectedLabels[id]! })) }
    writeFileSync(`${base}.job.json`, JSON.stringify(job))
    const command = peer.runtime === 'go' ? [prepared.binary!, `${base}.job.json`, `${base}.out.jsonl`] : peer.runtime === 'python' ? [prepared.python!, '-I', '-c', PYTHON_WORKER, `${base}.job.json`, `${base}.out.jsonl`] : ['node', context.bundle, '--child', '--job', `${base}.job.json`, '--out', `${base}.out.jsonl`]
    const run = await spawnWorker(command, `${base}.out.jsonl`, limits)
    record.wallMs += run.wallMs
    const imported = run.lines.find(line => line.type === 'import')
    if (attempt === 0 && imported?.type === 'import') Object.assign(record, { importMs: imported.importMs, setupMs: imported.setupMs })
    const finished = run.lines.flatMap(line => (line.type === 'result' ? [line] : []))
    for (const { type: _, ...result } of finished) record.results.push(result.status === 'error' && UNSUPPORTED.test(result.detail ?? '') ? { ...result, status: 'unsupported' } : result)
    const doneIds = new Set(finished.map(line => line.workload))
    const end = run.lines.find(line => line.type === 'end')
    if (end?.type === 'end') {
      if (end.rssBytes !== undefined) record.rssBytes = end.rssBytes
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
  const sources: Record<string, string> = inventory ? Object.fromEntries(inventory.occurrences.map(input => [input.id, input.source])) : { ...MICRO_WORKLOADS, architecture3: readFileSync(join(ROOT, 'eval/layout-compare/fixtures/architecture-basic.mmd'), 'utf8') }
  const expectedLabels: Record<string, readonly string[]> = inventory ? Object.fromEntries(inventory.occurrences.map(input => [input.id, []])) : EXPECTED_LABELS
  const available: Record<Output, readonly string[]> = inventory ? { svg: Object.keys(sources), terminal: Object.keys(sources) } : WORKLOADS
  const outputs = (args.get('outputs') ?? 'svg,terminal').split(',')
  if (!outputs.length || new Set(outputs).size !== outputs.length || outputs.some(output => output !== 'svg' && output !== 'terminal')) throw new Error('--outputs takes svg, terminal, or svg,terminal')
  const consumeSvg = args.has('consume-svg')
  if (consumeSvg && (outputs.length !== 1 || outputs[0] !== 'svg')) throw new Error('--consume-svg requires --outputs svg')
  const rounds = Number(args.get('rounds') ?? 3)
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer')
  if (inventory && args.has('quick')) throw new Error('--corpus and --quick are separate sampling policies')
  const timing: Timing = inventory ? { warmCalls: 1, warmupMs: 0, samples: 3, minSampleMs: 0, maxCaseMs: 5000 } : args.has('quick') ? QUICK_TIMING : TIMING
  const npmVersion = args.get('agentic-npm')
  if (npmVersion !== undefined && !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(npmVersion)) throw new Error('--agentic-npm takes an exact version such as 0.4.1')
  const catalog = [PEERS[0]!, ...(npmVersion ? [{ ...PEERS[0]!, id: 'agentic-npm', source: { registry: 'npm', name: 'agentic-mermaid', version: npmVersion } } satisfies Peer] : []), ...PEERS.slice(1)]
  const requested = args
    .get('peers')
    ?.split(',')
    .map(id => id.trim())
  for (const id of requested ?? []) {
    if (id === 'mermaid') console.error(`skipping mermaid: ${NOT_COVERED[0]}`)
    else if (!catalog.some(peer => peer.id === id)) throw new Error(`Unknown peer ${id}; choose from ${catalog.map(peer => peer.id).join(', ')}`)
  }
  const peers = catalog.filter(peer => peer.id === 'agentic-npm' || (requested ? requested.includes(peer.id) : !peer.optIn))
  if (consumeSvg && peers.some(peer => peer.runtime !== 'node')) throw new Error('--consume-svg supports Node peers only')
  const svgDirectory = args.get('svg-dir')
  if (svgDirectory && (outputs.length !== 1 || outputs[0] !== 'svg' || peers.some(peer => peer.runtime !== 'node'))) throw new Error('--svg-dir requires Node peers and --outputs svg')
  const selected = (args
    .get('workloads')
    ?.split(',')
    .map(id => id.trim()) ?? Object.keys(expectedLabels)) as WorkloadId[]
  for (const id of selected) if (!(id in expectedLabels)) throw new Error(`Unknown workload ${id}; choose from ${Object.keys(expectedLabels).join(', ')}`)
  const workloads = { svg: available.svg.filter(id => selected.includes(id)), terminal: available.terminal.filter(id => selected.includes(id)) }

  const nodeVersion = execFileSync('node', ['--version'], { encoding: 'utf8' }).trim()
  const prepared = peers.map(peer => prepare(peer, nodeVersion))
  const warnings = prepared.flatMap(entry => entry.warnings)
  for (const warning of warnings) console.error(`warning: ${warning}`)
  for (const entry of prepared.filter(entry => entry.error)) console.error(`${entry.peer.id}: ${entry.error}`)
  const jobs = prepared.flatMap(entry => (['svg', 'terminal'] as const).filter(output => outputs.includes(output) && entry.peer[output] && workloads[output].length).map(output => ({ prepared: entry, output })))

  const scratch = mkdtempSync(join(tmpdir(), 'agentic-mermaid-peers-'))
  const startLoad = loadavg()
  const createdAt = new Date().toISOString()
  try {
    // The worker is this file bundled for Node, so it never depends on
    // Node's TypeScript support; peers are imported from their cache paths.
    const bundle = join(scratch, 'peer-bench.node.mjs')
    const built = spawnSync(process.versions.bun ? process.execPath : 'bun', ['build', fileURLToPath(import.meta.url), '--target=node', '--format=esm', '--outfile', bundle], { stdio: ['ignore', 'ignore', 'inherit'] })
    if (built.status !== 0) throw new Error('bun build of the Node worker failed')
    const processes: ProcessRecord[] = []
    for (let round = 0; round < rounds; round++) {
      for (const { prepared: entry, output } of round % 2 === 0 ? jobs : [...jobs].reverse()) {
        console.error(`round ${round + 1}/${rounds}: ${entry.peer.id} ${output} (${workloads[output].length} workloads)`)
        processes.push(await runProcess(entry, output, workloads[output], round, { scratch, bundle, timing, sources, consumeSvg, svgDirectory, expectedLabels }))
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

    const out: string[] = []
    out.push('# Peer benchmark (advisory)', '')
    out.push(`- Date: ${createdAt}`)
    out.push(`- Protocol: ${consumeSvg ? 'node-svg-consumed@2; whole visible label phrases (not metadata or numeric-prefix matches); each timed call includes complete UTF-8 SVG and SHA-256; normal local caches, peer defaults; Zombie 5.8.2 simple also handles marker-free State, and auto-loads repository ELK for other graph families; SVG-only public APIs, no extra receipt serialization' : 'legacy-peer@1; returned output retained, no per-call byte/hash consumption'}`)
    out.push('- First render excludes byte/hash consumption and label checks. Repeated-source warm costs include each renderer’s own cache behavior. Label presence alone does not prove topology, routing, styles, or paint fidelity.')
    out.push(`- Machine: ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} logical CPUs, ${(totalmem() / 1024 ** 3).toFixed(0)} GiB, ${process.platform} ${process.arch} ${release()}; load average ${startLoad.map(value => value.toFixed(2)).join(' ')} at start, ${loadavg()[0]!.toFixed(2)} at end`)
    out.push(`- Runtimes: Node ${nodeVersion} (Node workers), Bun ${process.versions.bun ?? 'n/a'} (orchestrator); native Go and Python versions appear in their pins`)
    if (inventory)
      out.push(
        `- Corpus: ${inventory.occurrenceCount} official fence occurrences (${inventory.distinctCount} distinct sources); no label assertions. Success establishes output, not authored meaning or visual quality. Coverage retains unsupported/error cases. Three single-call samples after one warmup; this is not the calibrated synthetic timing policy.`,
      )
    out.push(`- Pins: ${prepared.map(entry => `${entry.peer.id} = ${entry.label}`).join('; ')}`)
    out.push(
      `- Method: ${rounds} round(s), one fresh process per peer and output, order alternating; per workload one first render and a label check, then ≥${timing.warmCalls} warm calls and ≥${timing.warmupMs} ms, ≤${timing.samples} samples of ≥${timing.minSampleMs} ms (at least ${MIN_SAMPLES}), capped near ${timing.maxCaseMs} ms; medians across rounds, ± is the median MAD/median.`,
    )
    out.push(`- Not covered: ${NOT_COVERED.join('; ')}`)
    for (const warning of warnings) out.push(`- Warning: ${warning}`)
    for (const entry of prepared.filter(entry => entry.error)) out.push(`- Unavailable: ${entry.peer.id}: ${entry.error}`)
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
    out.push('', '## Cold start, median across rounds', '', 'Import includes one-time setup (Merman engine creation); first render is the first call in a fresh process; RSS is resident memory after the last workload.', '')
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
      ]
    })
    out.push(markdownTable(['peer', 'output', 'import ms', 'first flow5 ms', 'RSS MiB'], coldRows, 2))
    if (terminalPeers.length) {
      out.push('', '## Warm terminal (Unicode, no colour), median ms per call', '')
      out.push(
        markdownTable(
          ['workload', ...terminalPeers],
          workloads.terminal.map(id => [id, ...terminalPeers.map(peer => statusText(cell(peer, 'terminal', id)))]),
        ),
      )
    }
    const markdown = `${out.join('\n')}\n`
    console.log(markdown)
    if (args.has('markdown')) writeFileSync(args.get('markdown')!, markdown)
    if (args.has('json')) {
      const summary: Record<Output, Record<string, Record<string, unknown>>> = { svg: {}, terminal: {} }
      for (const { prepared: entry, output } of jobs) summary[output][entry.peer.id] = Object.fromEntries(workloads[output].map(id => [id, { ...cell(entry.peer.id, output, id), ...(output === 'svg' && entry.peer.id !== 'agentic' ? { ratioToAgentic: ratio(entry.peer.id, id) } : {}) }]))
      const report = {
        schemaVersion: 1,
        advisory: true,
        protocol: consumeSvg ? 'node-svg-consumed@2' : 'legacy-peer@1',
        revision: git(['rev-parse', 'HEAD']),
        sourceDirty: git(['status', '--porcelain', '--', 'src']).length > 0,
        cacheEnvironment: consumeSvg ? layoutCacheEnvironment('normal') : undefined,
        population: Object.fromEntries([...new Set(jobs.flatMap(job => workloads[job.output]))].map(id => [id, { source: sources[id], sha256: createHash('sha256').update(sources[id]!).digest('hex'), expectedLabels: expectedLabels[id] }])),
        createdAt,
        environment: { node: nodeVersion, bun: process.versions.bun, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemBytes: totalmem(), loadAverageStart: startLoad, loadAverageEnd: loadavg() },
        config: { rounds, timing, minSamples: MIN_SAMPLES, workloads, peers: jobs.map(job => ({ peer: job.prepared.peer.id, output: job.output })) },
        ...(inventory ? { corpus: inventory } : {}),
        pins: prepared.map(entry => ({ peer: entry.peer.id, source: entry.peer.source, label: entry.label, ...(entry.integrity ? { integrity: entry.integrity } : {}), ...(entry.error ? { error: entry.error } : {}), svg: entry.peer.svg?.api, terminal: entry.peer.terminal?.api })),
        expectedLabels,
        warnings,
        notCovered: NOT_COVERED,
        processes,
        summary,
      }
      writeFileSync(args.get('json')!, `${JSON.stringify(report, null, 2)}\n`)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

await main()
