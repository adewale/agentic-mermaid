import './ci-policy-enforce.ts'
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
import type { BenchInput, MemoryResult, Outcome, OutputFingerprint, TimeResult } from './release-bench-types.ts'
import { missingSvgLabels, renderAgentEdit } from './release-bench-fidelity.ts'
import { rssCheckpoint } from './release-memory.ts'

// This is worker entry after static imports, not a pre-exec observation.
const workerStartRss = rssCheckpoint('after-static-imports-before-job-and-package-loading')

interface Job {
  entry: string
  mode: 'time' | 'memory'
  inputs: BenchInput[]
  reps: number
}
interface Renderer {
  renderMermaidSVG(source: string): string
  renderMermaidASCII(source: string): string
}
const [jobPath, resultPath] = process.argv.slice(2)
const job = JSON.parse(readFileSync(jobPath!, 'utf8')) as Job
if (!Number.isSafeInteger(job.reps) || job.reps < 1) throw new Error('reps must be a positive integer')

function attempt(render: () => string): Outcome {
  try {
    const output = render()
    if (typeof output !== 'string') throw new TypeError('Renderer must return a string')
    return { ok: true, output }
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) }
  }
}

function fingerprint(outcome: Outcome): OutputFingerprint {
  const text = outcome.ok ? outcome.output : outcome.error
  return {
    ok: outcome.ok,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(text, 'utf8'),
    ...(!outcome.ok ? { error: outcome.error } : {}),
  }
}

const same = (a: OutputFingerprint, b: OutputFingerprint) => a.ok === b.ok && a.sha256 === b.sha256 && a.bytes === b.bytes

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]!
}

const importStart = performance.now()
const mod = (await import(pathToFileURL(job.entry).href)) as Renderer
const importMs = performance.now() - importStart
const agent = job.inputs.some(input => input.workflow) ? await import(pathToFileURL(job.entry.replace(/index\.js$/, 'agent.js')).href) as Parameters<typeof renderAgentEdit>[0] : undefined
const renderSvg = (input: BenchInput) => input.workflow ? renderAgentEdit(agent!, input.source) : mod.renderMermaidSVG(input.source)

function timeMode(): TimeResult {
  const firstStart = performance.now()
  const first = attempt(() => mod.renderMermaidSVG('flowchart TD\n  A --> B'))
  const firstRenderMs = performance.now() - firstStart
  const firstRender = fingerprint(first)

  // Correctness: render twice to check determinism; ASCII once each way too.
  const svgFingerprints: OutputFingerprint[] = []
  const results = job.inputs.map(input => {
    const svg = attempt(() => renderSvg(input))
    const svgFingerprint = fingerprint(svg)
    svgFingerprints.push(svgFingerprint)
    const again = fingerprint(attempt(() => renderSvg(input)))
    const ascii = fingerprint(attempt(() => mod.renderMermaidASCII(input.source)))
    const asciiAgain = fingerprint(attempt(() => mod.renderMermaidASCII(input.source)))
    return {
      id: input.id,
      svg,
      ascii,
      deterministic: same(svgFingerprint, again) && same(ascii, asciiAgain),
      missingSvgLabels: svg.ok ? missingSvgLabels(svg.output, input.expectedSvgLabels) : [],
    }
  })

  // Timing: the passes above warmed every code path; take the median of reps.
  const samples = job.inputs.map(() => [] as number[])
  for (let rep = 0; rep < job.reps; rep++) {
    job.inputs.forEach((input, index) => {
      const start = performance.now()
      const rendered = attempt(() => renderSvg(input))
      samples[index]!.push(performance.now() - start)
      // Consume and compare the complete output after the measured API call.
      const current = fingerprint(rendered)
      results[index]!.deterministic &&= same(svgFingerprints[index]!, current)
      if (rendered.ok) for (const label of missingSvgLabels(rendered.output, input.expectedSvgLabels)) {
        if (!results[index]!.missingSvgLabels.includes(label)) results[index]!.missingSvgLabels.push(label)
      }
    })
  }
  return {
    node: process.versions.node,
    importMs,
    firstRenderMs,
    firstRender,
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
  const beforeMemoryWork = rssCheckpoint('after-package-imports-before-memory-warmup')
  const render = (input: BenchInput) => {
    const outcome = attempt(() => renderSvg(input))
    if (!outcome.ok) throw new Error(`${input.id}: memory render failed: ${outcome.error}`)
  }
  const pass = () => {
    for (const input of job.inputs) render(input)
  }
  // The first pass loads lazy modules and fills bounded caches; steady state
  // is what a long-lived host pays, so allocation and retention use later passes.
  pass()
  const perInput = job.inputs.map(input => ({ id: input.id, ...measureHeap(() => render(input)) }))
  // Keep reporting objects alive before settling so retention covers one pass,
  // without including the per-input measurements or their bookkeeping.
  gc()
  const settled = process.memoryUsage().heapUsed
  const corpusPass = measureHeap(pass)
  gc()
  const retained = process.memoryUsage().heapUsed
  const retainedGrowthBytes = Math.max(0, retained - settled)
  return {
    perInput,
    passAllocatedBytes: corpusPass.allocatedBytes,
    passPeakHeapBytes: corpusPass.peakHeapBytes,
    settledHeapBytes: settled,
    retainedHeapBytes: retained,
    retainedGrowthBytes,
    // Keep the existing process-lifetime maximum, including any inherited floor.
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    rss: { workerStart: workerStartRss, beforeMemoryWork, afterMemoryWork: rssCheckpoint('after-memory-measurement-and-final-gc') },
  }
}

writeFileSync(resultPath!, JSON.stringify(job.mode === 'memory' ? memoryMode() : timeMode()))
