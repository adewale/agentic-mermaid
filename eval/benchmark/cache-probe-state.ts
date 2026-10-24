// Evaluator-only private counters and a separate canonical diagnostic replay.
import { createHash } from 'node:crypto'
const identities = new WeakMap<object, number>()
const counters = new Map<number, { id: number; layer: string; events: Record<string, number>; weight: number; entries: number; getKeys: Set<string>; setKeys: Set<string> }>()
let next = 0
export function cacheProbeEvent(owner: object, layer: string, event: string, weight: number, entries: number, key?: string): void {
  let id = identities.get(owner)
  if (id === undefined) { id = next++; identities.set(owner, id) }
  let counter = counters.get(id)
  if (!counter) { counter = { id, layer, events: {}, weight, entries, getKeys: new Set(), setKeys: new Set() }; counters.set(id, counter) }
  counter.events[event] = (counter.events[event] ?? 0) + 1
  counter.weight = weight; counter.entries = entries
  if (key !== undefined && (event === 'get' || event === 'set')) {
    const digest = createHash('sha256').update(key).digest('hex')
    ;(event === 'get' ? counter.getKeys : counter.setKeys).add(digest)
  }
}
export function cacheProbeSnapshot() {
  return [...counters.values()].map(({ getKeys, setKeys, ...counter }) => ({ ...counter, events: { ...counter.events },
    distinctGetKeys: getKeys.size, distinctSetKeys: setKeys.size, getKeySha256: [...getKeys].sort(), setKeySha256: [...setKeys].sort() }))
}

const canonical = new Map<string, number>()
let scopes = 0
export function withCacheProbeObservations<T>(run: () => T): T {
  const symbol = Symbol.for('agentic-mermaid.performance-observer.v1')
  const host = globalThis as unknown as Record<symbol, unknown>
  const previous = Object.getOwnPropertyDescriptor(host, symbol)
  Object.defineProperty(host, symbol, { configurable: true, writable: true, value(event: { version?: number; kind?: string; owner?: string; outcome?: string; reason?: string }) {
    if (event.version !== 1) return
    if (event.kind === 'scope' && event.owner === 'graphical') scopes++
    if (event.kind === 'cache') {
      const key = [event.owner, event.outcome, event.reason].filter(value => value !== undefined).join(':')
      canonical.set(key, (canonical.get(key) ?? 0) + 1)
    }
  } })
  try { return run() } finally {
    if (previous) Object.defineProperty(host, symbol, previous)
    else delete host[symbol]
  }
}

export function cacheObservationSnapshot() {
  return { observed: scopes > 0, graphicalScopes: scopes, events: Object.fromEntries(canonical),
    limitations: 'Canonical hit/miss/bypass/store-skipped observations do not expose actual keys, entry counts or evictions; absence is unobserved, not proof of no work.' }
}
