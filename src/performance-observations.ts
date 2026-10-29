/** Internal, opt-in diagnostics shared by source and installed bundles. The
 * symbol is deliberately not a render option or a package export. Collect on
 * an untimed replay; ordinary renders allocate no observation records. */
export type PerformanceCacheOwner = 'elk-layout' | 'positioned-layout' | 'svg-inspection'
  | 'positioned-scene' | 'native-drawing' | 'paint-certification' | 'backend-registry' | 'capability-decision'
export type PerformanceObservation =
  | { readonly version: 1; readonly kind: 'scope'; readonly owner: 'graphical' }
  | { readonly version: 1; readonly kind: 'cache'; readonly owner: PerformanceCacheOwner
    readonly outcome: 'hit' | 'miss' | 'bypass' | 'store-skipped'; readonly reason?: string; readonly detail?: string }
  | { readonly version: 1; readonly kind: 'fallback'; readonly owner: 'native-drawing' | 'elk-degradation' | 'layout-candidate'
    readonly reason: string; readonly attempt?: number }
type Observer = (event: PerformanceObservation) => void
const OBSERVER = Symbol.for('agentic-mermaid.performance-observer.v1')
const host = globalThis as typeof globalThis & { [OBSERVER]?: Observer }

function deliver(observer: Observer, event: PerformanceObservation): void {
  // Diagnostic consumers must never change whether a render succeeds.
  try { observer(Object.freeze(event)) } catch { /* observer-owned failure */ }
}

export function observeGraphicalExecution(): void {
  const observer = host[OBSERVER]
  if (typeof observer === 'function') deliver(observer, { version: 1, kind: 'scope', owner: 'graphical' })
}

export function observeCache(owner: PerformanceCacheOwner, outcome: Extract<PerformanceObservation, { kind: 'cache' }>['outcome'], reason?: string, detail?: string): void {
  const observer = host[OBSERVER]
  if (typeof observer === 'function') deliver(observer, { version: 1, kind: 'cache', owner, outcome,
    ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) })
}

export function observeFallback(owner: Extract<PerformanceObservation, { kind: 'fallback' }>['owner'], reason: string, attempt?: number): void {
  const observer = host[OBSERVER]
  if (typeof observer === 'function') deliver(observer, { version: 1, kind: 'fallback', owner, reason,
    ...(attempt !== undefined ? { attempt } : {}) })
}

/** Synchronous diagnostic scope. Restores an enclosing collector on failure. */
export function withPerformanceObserver<T>(observe: Observer, run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(host, OBSERVER)
  Object.defineProperty(host, OBSERVER, { value: observe, writable: true, configurable: true })
  try { return run() } finally {
    if (previous) Object.defineProperty(host, OBSERVER, previous)
    else delete host[OBSERVER]
  }
}
