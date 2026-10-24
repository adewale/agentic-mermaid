// Imported only by evaluator-transformed source bundles, never renderer code.
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
