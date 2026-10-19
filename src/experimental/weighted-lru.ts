/** Bounded retained data, weighted by estimated residency rather than key count. */
export class WeightedLru<K, V> {
  private entries = new Map<K, { value: V; weight: number }>()
  private weight = 0
  private readonly maxEntries: number
  private readonly maxWeight: number
  constructor(maxEntries: number, maxWeight: number) { this.maxEntries = maxEntries; this.maxWeight = maxWeight }
  get(key: K): V | undefined {
    const found = this.entries.get(key)
    if (!found) return undefined
    this.entries.delete(key); this.entries.set(key, found)
    return found.value
  }
  set(key: K, value: V, weight: number): void {
    if (!Number.isFinite(weight) || weight < 0 || weight > this.maxWeight) return
    const prior = this.entries.get(key)
    if (prior) { this.weight -= prior.weight; this.entries.delete(key) }
    this.entries.set(key, { value, weight }); this.weight += weight
    while (this.entries.size > this.maxEntries || this.weight > this.maxWeight) {
      const oldest = this.entries.keys().next().value as K
      this.weight -= this.entries.get(oldest)!.weight; this.entries.delete(oldest)
    }
  }
  clear(): void { this.entries.clear(); this.weight = 0 }
}
