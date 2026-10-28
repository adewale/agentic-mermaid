// Browser JS diagnostics deliberately run after, and separately from, timings.
// CDP heap usage is neither native allocation nor process RSS or a peak estimate.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { BrowserSample, Engine } from './release-browser-bench.ts'
import { configureBrowserPage, type BrowserElkCache } from './browser-config.ts'

export interface MemoryInput { id: string; source: string; occurrenceIds: string[] }

/** Use the same distinct sources for every engine, retaining occurrence IDs so
 * a faster failure or a duplicate fence cannot silently change the population. */
export function sharedMemoryInputs(inputs: Array<{ id: string; source: string }>, samples: BrowserSample[], labels: string[], rounds: number): MemoryInput[] {
  const successes = new Map<string, Set<number>>()
  for (const row of samples) {
    if (!row.ok) continue
    const key = `${row.engine}\0${row.id}`
    if (!successes.has(key)) successes.set(key, new Set())
    successes.get(key)!.add(row.round)
  }
  const distinct = new Map<string, MemoryInput>()
  for (const input of inputs) {
    if (!labels.every(label => Array.from({ length: rounds }, (_, i) => i + 1).every(round => successes.get(`${label}\0${input.id}`)?.has(round)))) continue
    const existing = distinct.get(input.source)
    if (existing) existing.occurrenceIds.push(input.id)
    else distinct.set(input.source, { ...input, occurrenceIds: [input.id] })
  }
  return [...distinct.values()]
}

interface HeapUsage { usedSize: number; totalSize: number; embedderHeapUsedSize?: number; backingStorageSize?: number }
interface MemoryFailure { stage: string; id?: string; pass?: number; error: string }
interface MemoryRun {
  engine: string; round: number; status: 'completed' | 'failed'; checkpoints: Record<string, HeapUsage>
  renderedCalls: number; sampledRenderCalls: number; consumedUtf8Bytes: number; retainedOutputs: number; failures: MemoryFailure[]
  sampledAllocatedBytes?: number; allocationSamples?: number; allocationProfile?: string
}

export async function browserMemoryDiagnostics(options: {
  engines: Engine[]; origin: string; inputs: MemoryInput[]; rounds: number; passes: number; out: string; executablePath?: string; elkCache?: BrowserElkCache
}) {
  const runs: MemoryRun[] = []
  for (let round = 1; options.inputs.length > 0 && round <= options.rounds; round++) {
    for (const engine of round % 2 ? options.engines : [...options.engines].reverse()) {
      const row: MemoryRun = { engine: engine.label, round, status: 'failed', checkpoints: {}, renderedCalls: 0, sampledRenderCalls: 0, consumedUtf8Bytes: 0, retainedOutputs: 0, failures: [] }
      runs.push(row)
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
      try {
        browser = await chromium.launch({ headless: true, ...(options.executablePath ? { executablePath: options.executablePath } : {}) })
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
        await context.route('**/*', route => new URL(route.request().url()).origin === options.origin ? route.continue() : route.abort())
        const page = await context.newPage()
        await page.goto(`${options.origin}/blank`)
        const cdp = await context.newCDPSession(page)
        await cdp.send('HeapProfiler.enable')
        const checkpoint = async (stage: string) => {
          await cdp.send('HeapProfiler.collectGarbage')
          row.checkpoints[stage] = await cdp.send('Runtime.getHeapUsage')
        }
        await checkpoint('blank')
        await configureBrowserPage(page, engine.experiments, options.elkCache ?? 'off')
        await page.addScriptTag({ url: `${options.origin}/${engine.label}/${engine.bundle}` })
        await page.evaluate(({ kind, global }) => {
          type Api = { render(source: string, id?: string): unknown; renderMermaidSVG(source: string): string; initialize(options: { startOnLoad: boolean }): void }
          const host = globalThis as unknown as Record<string, unknown>
          const api = host[global] as Api
          if (kind === 'mermaid') api.initialize({ startOnLoad: false })
          const retained: string[] = []
          host.__amMemory = {
            async run(inputs: Array<{ id: string; source: string }>, passes: number, retain: boolean) {
              const failures: Array<{ id: string; pass: number; error: string }> = []
              let renderedCalls = 0, consumedUtf8Bytes = 0
              for (let pass = 0; pass < passes; pass++) for (let i = 0; i < inputs.length; i++) {
                const input = inputs[i]!
                renderedCalls++
                try {
                  const value = kind === 'agentic' ? api.renderMermaidSVG(input.source)
                    : kind === 'dart' ? (host[global] as (source: string) => unknown)(input.source)
                    : kind === 'mermaid' ? api.render(`memory${pass}x${i}`, input.source) : api.render(input.source)
                  const result = await value
                  const svg = typeof result === 'string' ? result : (result as { svg?: unknown })?.svg
                  if (typeof svg !== 'string' || !svg.includes('<svg')) throw new Error('Renderer returned no SVG string')
                  // Fully read returned text without retaining an extra encoded copy.
                  consumedUtf8Bytes += new TextEncoder().encode(svg).byteLength
                  if (retain) retained.push(svg)
                } catch (error) { failures.push({ id: input.id, pass: pass + 1, error: String(error) }) }
                finally { for (const div of document.querySelectorAll('body > div')) div.remove() }
              }
              return { renderedCalls, consumedUtf8Bytes, retainedOutputs: retained.length, failures }
            },
            release() { retained.length = 0 },
          }
        }, { kind: engine.kind, global: engine.global })
        await checkpoint('loaded')
        const render = async (stage: string, passes: number, retain: boolean) => {
          const result = await page.evaluate(async ({ inputs, passes, retain }) => {
            const state = (globalThis as unknown as { __amMemory: { run(inputs: Array<{ id: string; source: string }>, passes: number, retain: boolean): Promise<{ renderedCalls: number; consumedUtf8Bytes: number; retainedOutputs: number; failures: Array<{ id: string; pass: number; error: string }> }> } }).__amMemory
            return state.run(inputs, passes, retain)
          }, { inputs: options.inputs.map(({ id, source }) => ({ id, source })), passes, retain })
          row.renderedCalls += result.renderedCalls
          if (stage !== 'warmed') row.sampledRenderCalls += result.renderedCalls
          row.consumedUtf8Bytes += result.consumedUtf8Bytes
          row.retainedOutputs = result.retainedOutputs
          row.failures.push(...result.failures.map(failure => ({ stage, ...failure })))
          await checkpoint(stage)
        }
        await render('warmed', 1, false)
        await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
        await render('discarded', options.passes, false)
        await render('retaining', options.passes, true)
        await page.evaluate(() => { (globalThis as unknown as { __amMemory: { release(): void } }).__amMemory.release() })
        await checkpoint('released')
        const { profile } = await cdp.send('HeapProfiler.stopSampling')
        const allocated = (node: typeof profile.head): number => node.selfSize + node.children.reduce((total, child) => total + allocated(child), 0)
        row.sampledAllocatedBytes = allocated(profile.head)
        row.allocationSamples = profile.samples.length
        row.allocationProfile = `memory-${engine.label}-${round}.heapprofile.json`
        writeFileSync(join(options.out, row.allocationProfile), `${JSON.stringify(profile)}\n`)
        row.status = row.failures.length ? 'failed' : 'completed'
      } catch (error) { row.failures.push({ stage: 'diagnostic', error: String(error) }) }
      finally {
        try { await browser?.close() }
        catch (error) { row.status = 'failed'; row.failures.push({ stage: 'cleanup', error: String(error) }) }
      }
    }
  }
  return {
    status: runs.every(row => row.status === 'completed') && options.inputs.length > 0 ? 'completed' : 'incomplete',
    ...(options.inputs.length ? {} : { error: 'No distinct source succeeded in every timed round in every engine; memory comparison was not run' }),
    policy: { rounds: options.rounds, passes: options.passes, elkCache: options.elkCache ?? 'off', ordering: 'fresh Chromium process per engine/round; reversed order on alternate rounds',
      expectedSampledRenderCallsPerRun: 2 * options.passes * options.inputs.length,
      population: 'distinct sources successful in every timed round in every engine; occurrence IDs preserved',
      checkpoints: 'CDP forced-GC JS heap usage after blank, loaded, warmed, discarded, retaining and released',
      allocation: '4096-byte CDP sampling from warmed through released, including objects collected by major and minor GC; observer/UTF-8 consumption allocations included',
      limitations: 'sampled V8 JS allocations and post-GC heap checkpoints, not exact allocation, peak memory, native memory, process RSS, or painted DOM; remote assets blocked; cache policy recorded separately' },
    inputs: options.inputs.map(({ source: _source, ...input }) => input), runs,
  }
}
