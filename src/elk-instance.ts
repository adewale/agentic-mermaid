import { estimatedResidency } from './experimental/cache-residency.ts'
import { WeightedLru } from './experimental/weighted-lru.ts'
/**
 * Shared ELK instance singleton.
 *
 * Uses elk.bundled.js (pure synchronous JS, ~1.6 MB) for all environments.
 * The singleton is created lazily on first use and cached forever; the
 * published Node entries also load elkjs itself then (see elk-constructor.ts).
 *
 * ELK's FakeWorker wraps both postMessage and onmessage in setTimeout(0),
 * making the normal API fully async. To bypass this:
 *   1. During construction, we capture setTimeout(0) callbacks and flush them
 *      synchronously — this registers the layout algorithms immediately.
 *   2. For layout calls, we call dispatcher.saveDispatch() directly (skipping
 *      the FakeWorker's postMessage setTimeout) and intercept the result via
 *      rawWorker.onmessage (which the dispatcher calls synchronously).
 */

import type { ElkNode } from 'elkjs'
import { assertLayoutGraphWork } from './shared/diagram-limits.ts'
import { measureRenderStage } from './render-stages.ts'
import { elkConstructor } from './elk-constructor.ts'
import { observeCache } from './performance-observations.ts'

interface RawFakeWorker {
  postMessage(msg: unknown): void
  onmessage: ((e: { data: Record<string, unknown> }) => void) | null
  dispatcher: {
    saveDispatch(msg: { data: Record<string, unknown> }): void
  }
}

let elk: unknown = null
let rawWorker: RawFakeWorker | null = null

/**
 * Ensure the ELK singleton exists.
 *
 * Patches setTimeout during construction to capture and synchronously flush
 * the algorithm registration callback that ELK queues via setTimeout(0).
 * Without this, layout calls fail with "algorithm not found" until the
 * next macrotask.
 */
function ensureElk(): void {
  if (elk) return
  // Load elkjs before the patches below, as a static import would have.
  const ELKBundled = elkConstructor()

  // Capture setTimeout(0) callbacks queued during ELK construction
  const pending: (() => void)[] = []
  const origSetTimeout = globalThis.setTimeout
  // @ts-ignore — simplified signature for our interception
  globalThis.setTimeout = (fn: () => void, delay?: number) => {
    if (delay === 0) { pending.push(fn); return 0 }
    return origSetTimeout(fn, delay)
  }

  // Bun and Cloudflare workerd define `self` (= globalThis) but not
  // `document`, which tricks elk-worker.min.js into taking the Web Worker
  // branch (registering self.onmessage, exporting no Worker) instead of the
  // CJS branch that exports {Worker: FakeWorker}. Deleting `self` worked on
  // Bun but not on workerd, where the global is undeletable. Temporarily
  // defining `document` flips the same branch condition on both runtimes:
  // elk-worker checks `typeof document === 'undefined' && typeof self !==
  // 'undefined'` before falling through to module.exports.
  const g = globalThis as Record<string, unknown>
  const hadDocument = typeof g.document !== 'undefined'
  if (!hadDocument) g.document = {}

  elk = new ELKBundled()

  if (!hadDocument) delete g.document

  // Restore setTimeout immediately
  globalThis.setTimeout = origSetTimeout

  // Flush captured callbacks synchronously — registers layout algorithms
  pending.forEach(fn => fn())

  // Cache the raw FakeWorker for elkLayoutSync()
  rawWorker = (elk as unknown as { worker: { worker: RawFakeWorker } }).worker.worker
}

/**
 * Run ELK layout synchronously.
 *
 * Bypasses BOTH of ELK's setTimeout(0) wrappers:
 *   - FakeWorker.postMessage wraps dispatch in setTimeout(0) — bypassed by
 *     calling dispatcher.saveDispatch() directly
 *   - PromisedWorker.onmessage wraps receive in setTimeout(0) — bypassed by
 *     replacing rawWorker.onmessage with a direct interceptor
 */
export function elkLayoutSync(graph: ElkNode): ElkNode {
  return measureRenderStage('elk', () => cachedElkLayout(graph))
}

// ELK lays out identical input graphs identically, so a repeated render,
// verify or edit-loop step need not run it again. The key is the whole input
// graph, options included; undefined and non-finite values are spelled out
// because JSON would merge them with absent fields and null. Results are
// stored and returned as copies, since ELK returns its mutated input and
// callers adjust the geometry they receive. Least recently used results are
// evicted past 64 entries, 1 Mi key code units, or 8 MiB estimated residency.
// Every weight includes at least eight units per key code unit, so its 8 MiB
// quota also enforces the key bound. These are estimates, not engine heap limits.
// AGENTIC_MERMAID_ELK_CACHE=0
// in the environment, or as a global where there is no `process`, turns the
// cache off, which the benchmarks do so that repeated renders time ELK itself.
const host = globalThis as { process?: { env?: Record<string, string | undefined> }; AGENTIC_MERMAID_ELK_CACHE?: unknown }
const ELK_CACHE_ENABLED = (host.process?.env?.AGENTIC_MERMAID_ELK_CACHE ?? host.AGENTIC_MERMAID_ELK_CACHE) !== '0'
const ELK_CACHE_MAX_ENTRIES = 64
const ELK_CACHE_MAX_KEY_UNITS = 1024 * 1024
const ELK_CACHE_MAX_RESIDENCY = 8 * 1024 * 1024
const elkResults = new WeightedLru<string, ElkNode>(ELK_CACHE_MAX_ENTRIES, ELK_CACHE_MAX_RESIDENCY)

function cachedElkLayout(graph: ElkNode): ElkNode {
  assertLayoutGraphWork(graph)
  if (!ELK_CACHE_ENABLED) { observeCache('elk-layout', 'bypass', 'disabled'); return layoutElkGraph(graph) }
  const key = elkGraphKey(graph)
  const cached = elkResults.get(key)
  if (cached) { observeCache('elk-layout', 'hit'); return structuredClone(cached) }
  observeCache('elk-layout', 'miss')
  const result = layoutElkGraph(graph)
  if (key.length <= ELK_CACHE_MAX_KEY_UNITS) {
    const weight = Math.max(key.length * 8, key.length * 2 + estimatedResidency(result, ELK_CACHE_MAX_RESIDENCY))
    if (weight <= ELK_CACHE_MAX_RESIDENCY) elkResults.set(key, structuredClone(result), weight)
    else observeCache('elk-layout', 'store-skipped', 'weight-limit')
  } else observeCache('elk-layout', 'store-skipped', 'key-limit')
  return result
}

function elkGraphKey(graph: ElkNode): string {
  return JSON.stringify(graph, (_key, value: unknown) => {
    if (value === undefined) return '\u0000undefined'
    if (typeof value === 'number' && !Number.isFinite(value)) return `\u0000${value}`
    // Keep a real string from spelling one of the markers above.
    if (typeof value === 'string' && value.startsWith('\u0000')) return `\u0000${value}`
    return value
  })
}

/** Forget cached ELK results, so a test or diagnostic can time or compare a cold layout. */
export function clearElkLayoutCache(): void {
  elkResults.clear()
}

function layoutElkGraph(graph: ElkNode): ElkNode {
  ensureElk()

  let result: ElkNode | undefined
  let error: unknown

  // Replace onmessage to intercept the result synchronously
  // (the dispatcher calls this directly, without setTimeout)
  const origOnmessage = rawWorker!.onmessage
  rawWorker!.onmessage = (answer: { data: Record<string, unknown> }) => {
    if (answer.data.error) {
      error = answer.data.error
    } else {
      result = answer.data.data as ElkNode
    }
  }

  // Call dispatcher.saveDispatch directly — bypasses FakeWorker.postMessage's
  // setTimeout(0) wrapper. The dispatcher processes the layout synchronously
  // and calls rawWorker.onmessage with the result.
  rawWorker!.dispatcher.saveDispatch({ data: { id: 0, cmd: 'layout', graph } as unknown as Record<string, unknown> })

  // Restore original handler
  rawWorker!.onmessage = origOnmessage

  if (error) throw error
  if (!result) throw new Error('ELK layout did not return synchronously')
  return result
}
