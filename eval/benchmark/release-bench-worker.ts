// One release-benchmark measurement in a fresh Node process, against one built
// package. Run by release-bench.ts; Node strips the types.
//
//   node release-bench-worker.ts <job.json> <result.json>
//
// `time` mode records cold start, correctness and per-input render times.
// `memory` mode (run with --expose-gc) records allocation, peak heap, retained
// growth and peak RSS. Keeping them apart keeps GC accounting out of timings.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { GCProfiler } from 'node:v8'

interface Input { id: string; family: string; source: string }
interface Job { entry: string; mode: 'time' | 'memory'; inputs: Input[]; reps: number }
interface Renderer {
  renderMermaidSVG(source: string): string
  renderMermaidASCII(source: string): string
}
type Outcome = { ok: true; output: string } | { ok: false; error: string }

const [jobPath, resultPath] = process.argv.slice(2)
const job = JSON.parse(readFileSync(jobPath!, 'utf8')) as Job

function attempt(render: () => string): Outcome {
  try {
    return { ok: true, output: render() }
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error).split('\n')[0]!.slice(0, 200) }
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]!
}

const importStart = performance.now()
const mod = await import(pathToFileURL(job.entry).href) as Renderer
const importMs = performance.now() - importStart

function timeMode(): unknown {
  const firstStart = performance.now()
  attempt(() => mod.renderMermaidSVG('flowchart TD\n  A --> B'))
  const firstRenderMs = performance.now() - firstStart

  // Correctness: render twice to check determinism; ASCII once each way too.
  const results = job.inputs.map(input => {
    const svg = attempt(() => mod.renderMermaidSVG(input.source))
    const again = attempt(() => mod.renderMermaidSVG(input.source))
    const ascii = attempt(() => mod.renderMermaidASCII(input.source))
    const asciiAgain = attempt(() => mod.renderMermaidASCII(input.source))
    const same = (a: Outcome, b: Outcome) => a.ok === b.ok && (a.ok ? a.output === (b as typeof a).output : a.error === (b as typeof a).error)
    return {
      id: input.id,
      svg,
      ascii: ascii.ok ? { ok: true as const, bytes: ascii.output.length } : ascii,
      deterministic: same(svg, again) && same(ascii, asciiAgain),
    }
  })

  // Timing: the passes above warmed every code path; take the median of reps.
  const samples = job.inputs.map(() => [] as number[])
  for (let rep = 0; rep < job.reps; rep++) {
    job.inputs.forEach((input, index) => {
      const start = performance.now()
      attempt(() => mod.renderMermaidSVG(input.source))
      samples[index]!.push(performance.now() - start)
    })
  }
  return {
    node: process.versions.node,
    importMs,
    firstRenderMs,
    results: results.map((result, index) => ({ ...result, ms: median(samples[index]!) })),
  }
}

function used(stats: { heapStatistics: { usedHeapSize: number } }): number {
  return stats.heapStatistics.usedHeapSize
}

/** Bytes allocated and peak used heap while `work` runs, from V8's GC log. */
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

function memoryMode(): unknown {
  const gc = globalThis.gc
  if (!gc) throw new Error('memory mode needs node --expose-gc')
  const pass = () => { for (const input of job.inputs) attempt(() => mod.renderMermaidSVG(input.source)) }
  // The first pass loads lazy modules and fills bounded caches; steady state
  // is what a long-lived host pays, so allocation and retention use later passes.
  pass()
  gc()
  const settled = process.memoryUsage().heapUsed
  const perInput = job.inputs.map(input => ({ id: input.id, ...measureHeap(() => attempt(() => mod.renderMermaidSVG(input.source))) }))
  const corpusPass = measureHeap(pass)
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

writeFileSync(resultPath!, JSON.stringify(job.mode === 'memory' ? memoryMode() : timeMode()))
