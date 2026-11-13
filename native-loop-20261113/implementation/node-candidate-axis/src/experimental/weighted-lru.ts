/** Bounded retained data, weighted by estimated residency rather than key count. */
export class WeightedLru<K, V> {
  #entries = new Map<K, { value: V; weight: number }>()
  #weight = 0
  readonly #maxEntries: number
  readonly #maxWeight: number
  readonly #onRemove?: (key: K, value: V) => void
  constructor(maxEntries: number, maxWeight: number, onRemove?: (key: K, value: V) => void) { this.#maxEntries = maxEntries; this.#maxWeight = maxWeight; this.#onRemove = onRemove }
  get(key: K): V | undefined {
    const found = this.#entries.get(key)
    if (!found) return undefined
    this.#entries.delete(key); this.#entries.set(key, found)
    return found.value
  }
  canFit(key: K, weight: number): boolean {
    const prior = this.#entries.get(key)
    return Number.isFinite(weight) && weight >= 0 && this.#entries.size + (prior ? 0 : 1) <= this.#maxEntries && this.#weight - (prior?.weight ?? 0) + weight <= this.#maxWeight
  }
  /** Inspect the eviction candidate without changing its recency. */
  leastRecentlyUsed(): V | undefined {
    const oldest = this.#entries.values().next()
    return oldest.done ? undefined : oldest.value.value
  }
  delete(key: K): boolean {
    const prior = this.#entries.get(key)
    if (!prior) return false
    this.#entries.delete(key); this.#weight -= prior.weight
    this.#onRemove?.(key, prior.value)
    return true
  }
  set(key: K, value: V, weight: number): void {
    if (!Number.isFinite(weight) || weight < 0 || weight > this.#maxWeight) return
    this.delete(key)
    this.#entries.set(key, { value, weight }); this.#weight += weight
    while (this.#entries.size > this.#maxEntries || this.#weight > this.#maxWeight) {
      const oldest = this.#entries.keys().next().value as K
      this.delete(oldest)
    }
  }
  clear(): void {
    if (this.#onRemove) for (const key of this.#entries.keys()) this.delete(key)
    else { this.#entries.clear(); this.#weight = 0 }
  }
}
