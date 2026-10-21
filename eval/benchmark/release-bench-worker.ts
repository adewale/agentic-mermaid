// One release-benchmark measurement in a fresh Node process, against one built
// package. Run by release-bench.ts; Node strips the types.
//
//   node release-bench-worker.ts <job.json> <result.json>
//
// `time` mode records cold start, correctness and per-input render times.
// `memory` mode (run with --expose-gc) records allocation, peak heap, retained
// growth and peak RSS. Keeping them apart keeps GC accounting out of timings.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { GCProfiler } from 'node:v8'
import type { BenchInput, LayoutCache, LayoutMode, LayoutObservation, MemoryResult, Outcome, OutputFingerprint, TimeResult } from './release-bench-types.ts'
import type { RenderOptions } from '../../src/types.ts'
import type { RenderRequestReceipt } from '../../src/render-contract.ts'
import { layoutCacheEnvironment, layoutRenderOptions, missingSvgLabels, renderAgentEdit } from './release-bench-fidelity.ts'

interface Job {
  entry: string
  mode: 'time' | 'memory'
  inputs: BenchInput[]
  reps: number
  layoutMode?: LayoutMode
  layoutCache?: LayoutCache
  consumeReceipt?: boolean
  collectQuality?: boolean
}
interface Renderer {
  renderMermaidSVG(source: string, options?: RenderOptions): string
  renderMermaidASCII(source: string, options?: RenderOptions): string
  renderMermaidSVGWithReceipt?(source: string, options?: RenderOptions): { svg: string; receipt: RenderRequestReceipt }
  renderMermaidASCIIWithReceipt?(source: string, options?: RenderOptions): { text: string; receipt: RenderRequestReceipt }
}
const [jobPath, resultPath] = process.argv.slice(2)
const job = JSON.parse(readFileSync(jobPath!, 'utf8')) as Job
if (job.consumeReceipt) Object.assign(process.env, layoutCacheEnvironment(job.layoutCache ?? 'off'))
if (!Number.isSafeInteger(job.reps) || job.reps < 1) throw new Error('reps must be a positive integer')

// Breadcrumbs stay outside timed calls and GC-profiler windows. A killed worker
// remains a failed measurement; this only identifies the last stage it reached.
function progress(stage: string, inputId?: string): void {
  writeFileSync(`${resultPath!}.progress.json`, JSON.stringify({ mode: job.mode, stage, ...(inputId ? { inputId } : {}) }))
}
process.once('beforeExit', () => progress('event-loop-drained'))


function attempt(render: () => string): Outcome {
  try {
    const output = render()
    if (typeof output !== 'string') throw new TypeError('Renderer must return a string')
    return { ok: true, output }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return {
      ok: false, error: String(error instanceof Error ? error.message : error),
      ...(job.consumeReceipt ? { code, category: code === 'GRAPH_LAYOUT_UNSUPPORTED' ? 'unsupported' as const
        : code === 'LAYOUT_CERTIFICATION_FAILED' ? 'candidate-rejected' as const : 'error' as const } : {}),
    }
  }
}

function fingerprint(outcome: Outcome): OutputFingerprint {
  const text = outcome.ok ? outcome.output : outcome.error
  return {
    ok: outcome.ok,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(text, 'utf8'),
    ...(!outcome.ok ? { error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}), ...(outcome.category ? { category: outcome.category } : {}) } : {}),
  }
}

const same = (a: OutputFingerprint, b: OutputFingerprint) => a.ok === b.ok && a.sha256 === b.sha256 && a.bytes === b.bytes

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]!
}

progress('module-import')
const importStart = performance.now()
const mod = (await import(pathToFileURL(job.entry).href)) as Renderer
const importMs = performance.now() - importStart
progress('module-ready')
const agent = job.inputs.some(input => input.workflow) ? await import(pathToFileURL(job.entry.replace(/index\.js$/, 'agent.js')).href) as Parameters<typeof renderAgentEdit>[0] : undefined
const renderOptions = layoutRenderOptions(job.layoutMode)
let lastReceipt: { json: string; value: RenderRequestReceipt } | undefined
function consume(output: string, receipt: RenderRequestReceipt): string {
  // Both complete transport operations belong inside the timed public call.
  Buffer.from(output, 'utf8')
  lastReceipt = { json: JSON.stringify(receipt), value: receipt }
  return output
}
function renderPixelSource(source: string): string {
  lastReceipt = undefined
  if (!job.consumeReceipt) return mod.renderMermaidSVG(source)
  if (!mod.renderMermaidSVGWithReceipt) throw new Error('Consumed benchmark requires renderMermaidSVGWithReceipt')
  const rendered = mod.renderMermaidSVGWithReceipt(source, renderOptions ?? { onConfigDiagnostic: () => {} })
  return consume(rendered.svg, rendered.receipt)
}
const renderSvg = (input: BenchInput) => {
  lastReceipt = undefined
  return input.workflow ? renderAgentEdit(agent!, input.source, renderOptions, renderPixelSource) : renderPixelSource(input.source)
}
function renderAscii(input: BenchInput): string {
  lastReceipt = undefined
  if (!job.consumeReceipt) return mod.renderMermaidASCII(input.source)
  if (!mod.renderMermaidASCIIWithReceipt) throw new Error('Consumed benchmark requires renderMermaidASCIIWithReceipt')
  const rendered = mod.renderMermaidASCIIWithReceipt(input.source, renderOptions ?? { onConfigDiagnostic: () => {} })
  return consume(rendered.text, rendered.receipt)
}
function layoutObservation(): LayoutObservation | undefined {
  if (!lastReceipt) return undefined
  const receipt = lastReceipt
  lastReceipt = undefined
  return {
    receipt: fingerprint({ ok: true, output: receipt.json }),
    decisions: receipt.value.layoutDecisions ?? [],
    certification: receipt.value.layoutCertification,
    quality: 'not-collected',
  }
}
const sameReceipt = (a: LayoutObservation | undefined, b: LayoutObservation | undefined) => (!a && !b) || (!!a && !!b && same(a.receipt, b.receipt))

async function timeMode(): Promise<TimeResult> {
  progress('cold-svg')
  const firstStart = performance.now()
  const first = attempt(() => renderPixelSource('flowchart TD\n  A --> B'))
  const firstRenderMs = performance.now() - firstStart
  const firstRender = fingerprint(first)
  const firstLayout = layoutObservation()

  // Correctness: render twice to check determinism; ASCII once each way too.
  const svgFingerprints: OutputFingerprint[] = []
  const results: Omit<TimeResult['results'][number], 'ms' | 'samplesMs'>[] = job.inputs.map(input => {
    progress('correctness-svg', input.id)
    const svg = attempt(() => renderSvg(input))
    const layout = layoutObservation()
    const svgFingerprint = fingerprint(svg)
    svgFingerprints.push(svgFingerprint)
    const again = fingerprint(attempt(() => renderSvg(input)))
    const svgReceiptStable = sameReceipt(layout, layoutObservation())
    progress('correctness-ascii', input.id)
    const ascii = fingerprint(attempt(() => renderAscii(input)))
    const asciiLayout = layoutObservation()
    const asciiAgain = fingerprint(attempt(() => renderAscii(input)))
    return {
      id: input.id,
      svg,
      ascii,
      deterministic: same(svgFingerprint, again) && same(ascii, asciiAgain) && svgReceiptStable && sameReceipt(asciiLayout, layoutObservation()),
      missingSvgLabels: svg.ok ? missingSvgLabels(svg.output, input.expectedSvgLabels) : [],
      ...(layout ? { layout } : {}), ...(asciiLayout ? { asciiLayout } : {}),
    }
  })

  // Timing: the passes above warmed every code path; take the median of reps.
  progress('timing')
  const samples = job.inputs.map(() => [] as number[])
  for (let rep = 0; rep < job.reps; rep++) {
    job.inputs.forEach((input, index) => {
      const start = performance.now()
      const rendered = attempt(() => renderSvg(input))
      samples[index]!.push(performance.now() - start)
      // Consume and compare the complete output after the measured API call.
      const current = fingerprint(rendered)
      results[index]!.deterministic &&= same(svgFingerprints[index]!, current)
      results[index]!.deterministic &&= sameReceipt(results[index]!.layout, layoutObservation())
      if (rendered.ok) for (const label of missingSvgLabels(rendered.output, input.expectedSvgLabels)) {
        if (!results[index]!.missingSvgLabels.includes(label)) results[index]!.missingSvgLabels.push(label)
      }
    })
  }
  progress('timing-complete')
  // This reruns the public layout projection after ALL timed samples. It is
  // evidence for the same request policy, not the retained timed SVG object.
  if (job.collectQuality) {
    progress('quality-import')
    type QualityApi = Pick<typeof import('../../src/agent/index.ts'), 'layoutMermaidWithReceipt' | 'measureQuality'>
    let qualityApi: QualityApi | undefined
    let unavailable = 'package does not expose public layout quality measurement'
    try {
      const module = await import(pathToFileURL(job.entry.replace(/index\.js$/, 'agent.js')).href)
      if (typeof module.layoutMermaidWithReceipt === 'function' && typeof module.measureQuality === 'function') qualityApi = module
    } catch (error) { unavailable = String(error) }
    for (let index = 0; index < job.inputs.length; index++) {
      const input = job.inputs[index]!, result = results[index]!
      progress('quality-layout', input.id)
      if (input.workflow || !result.svg.ok || !qualityApi) {
        result.quality = { status: 'unavailable', reason: input.workflow ? 'workflow final mutated source is not retained for independent quality projection'
          : !result.svg.ok ? 'no successful timed SVG for this request' : unavailable }
        continue
      }
      try {
        const artifact = qualityApi.layoutMermaidWithReceipt(input.source, { ...renderOptions, onConfigDiagnostic: () => {}, debug: true })
        const measured = qualityApi.measureQuality(artifact.layout)
        const metrics = JSON.parse(JSON.stringify(measured, (_key, value: unknown) => typeof value === 'number' && !Number.isFinite(value)
          ? { unavailable: 'non-finite metric', value: String(value) } : value)) as unknown
        result.quality = {
          status: 'measured', scope: 'separate-public-layout-after-timing', metrics,
          decisions: artifact.receipt.layoutDecisions ?? [], certification: artifact.receipt.layoutCertification,
          unavailable: ['full preferred-port score', 'peer symmetry score', 'group-title fit score', 'full final-candidate bend score'],
        }
      } catch (error) {
        result.quality = { status: 'unavailable', reason: String(error),
          ...(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? { code: error.code } : {}) }
      }
    }
  }
  return {
    node: process.versions.node,
    importMs,
    firstRenderMs,
    firstRender,
    ...(firstLayout ? { firstLayout } : {}),
    results: results.map((result, index) => ({ ...result, ms: median(samples[index]!), samplesMs: samples[index]! })),
  }
}

function used(stats: { heapStatistics: { usedHeapSize: number } }): number {
  return stats.heapStatistics.usedHeapSize
}

/** Bytes allocated and an estimated heap peak, sampled at GC boundaries. */
function measureHeap(work: () => void): { allocatedBytes: number; peakHeapBytes: number } {
  const gc = globalThis.gc!
  gc()
  const start = process.memoryUsage().heapUsed
  const profiler = new GCProfiler()
  profiler.start()
  work()
  const end = process.memoryUsage().heapUsed
  const statistics = profiler.stop()?.statistics ?? []
  let allocatedBytes = 0
  let peakHeapBytes = Math.max(start, end)
  let previous = start
  for (const entry of statistics) {
    allocatedBytes += Math.max(0, used(entry.beforeGC) - previous)
    peakHeapBytes = Math.max(peakHeapBytes, used(entry.beforeGC))
    previous = used(entry.afterGC)
  }
  allocatedBytes += Math.max(0, end - previous)
  return { allocatedBytes, peakHeapBytes }
}

function memoryMode(): MemoryResult {
  const gc = globalThis.gc
  if (!gc) throw new Error('memory mode needs node --expose-gc')
  const render = (input: BenchInput) => {
    const outcome = attempt(() => renderSvg(input))
    lastReceipt = undefined
    if (!outcome.ok) throw new Error(`${input.id}: memory render failed: ${outcome.error}`)
  }
  const pass = () => {
    for (const input of job.inputs) render(input)
  }
  // The first pass loads lazy modules and fills bounded caches; steady state
  // is what a long-lived host pays, so allocation and retention use later passes.
  progress('memory-warmup')
  pass()
  const perInput = job.inputs.map(input => {
    progress('memory-input', input.id)
    return { id: input.id, ...measureHeap(() => render(input)) }
  })
  // Keep reporting objects alive before settling so retention covers one pass,
  // without including the per-input measurements or their bookkeeping.
  gc()
  const settled = process.memoryUsage().heapUsed
  progress('memory-pass')
  const corpusPass = measureHeap(pass)
  progress('memory-retention')
  gc()
  const retainedGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - settled)
  return {
    perInput,
    passAllocatedBytes: corpusPass.allocatedBytes,
    passPeakHeapBytes: corpusPass.peakHeapBytes,
    retainedGrowthBytes,
    // resourceUsage reports kilobytes.
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
  }
}

const result = { ...(job.mode === 'memory' ? memoryMode() : await timeMode()),
  ...(job.consumeReceipt ? { cacheEnvironment: layoutCacheEnvironment(job.layoutCache ?? 'off') } : {}) }
progress('write-result')
writeFileSync(resultPath!, JSON.stringify(result))
progress('result-written')
