// Imported only by evaluator-transformed source bundles, never renderer code.
const identities = new WeakMap<object, number>()
const counters = new Map<number, { id: number; layer: string; events: Record<string, number>; weight: number; entries: number }>()
let next = 0
export function cacheProbeEvent(owner: object, layer: string, event: string, weight: number, entries: number): void {
  let id = identities.get(owner)
  if (id === undefined) { id = next++; identities.set(owner, id) }
  let counter = counters.get(id)
  if (!counter) { counter = { id, layer, events: {}, weight, entries }; counters.set(id, counter) }
  counter.events[event] = (counter.events[event] ?? 0) + 1
  counter.weight = weight; counter.entries = entries
}
export function cacheProbeSnapshot() {
  return [...counters.values()].map(counter => ({ ...counter, events: { ...counter.events } }))
}
