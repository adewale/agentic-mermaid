import type { CacheBudget } from './cache-budget.ts'
/** Bounded retained data, weighted by estimated residency rather than key count. */
export class WeightedLru<K, V> {
  private entries = new Map<K, { value: V; weight: number }>()
  private weight = 0
  private readonly maxEntries: number
  private readonly maxWeight: number
  constructor(maxEntries: number, maxWeight: number, private readonly budget?: CacheBudget) { this.maxEntries = maxEntries; this.maxWeight = maxWeight }
  get(key: K): V | undefined {
    const found = this.entries.get(key)
    if (!found) return undefined
    this.entries.delete(key); this.entries.set(key, found)
    this.budget?.touch(found)
    return found.value
  }
  set(key: K, value: V, weight: number, residency = weight): void {
    if (!Number.isFinite(weight) || weight < 0 || weight > this.maxWeight
      || !Number.isFinite(residency) || residency < 0 || residency > (this.budget?.limit ?? Infinity)) return
    this.delete(key)
    const entry = { value, weight }
    this.entries.set(key, entry); this.weight += weight
    while (this.entries.size > this.maxEntries || this.weight > this.maxWeight) {
      const oldest = this.entries.keys().next().value as K
      this.delete(oldest)
    }
    if (this.entries.get(key) === entry) this.budget?.retain(entry, residency, () => this.delete(key))
  }
  private delete(key: K): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.weight -= entry.weight; this.entries.delete(key)
    this.budget?.release(entry)
  }
  clear(): void {
    for (const entry of this.entries.values()) this.budget?.release(entry)
    this.entries.clear(); this.weight = 0
  }
}
