import { estimatedResidency } from './experimental/cache-residency.ts'
import { WeightedLru } from './experimental/weighted-lru.ts'
/** Shared synchronous ELK Layered boundary and its existing weighted result cache. */

import type { ElkNode } from 'elkjs'
import { assertLayoutGraphWork } from './shared/diagram-limits.ts'
import { measureRenderStage } from './render-stages.ts'
import { elkSolver } from './elk-solver.ts'
import { observeCache } from './performance-observations.ts'

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
  return elkSolver()(graph)
}
