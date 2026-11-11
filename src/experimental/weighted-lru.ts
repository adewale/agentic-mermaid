import { uncurryIntrinsic } from '../shared/intrinsics.ts'

/** Bounded retained data, weighted by estimated residency rather than key count. */
const NativeMap = Map
const mapGet = uncurryIntrinsic(Map.prototype.get) as <K, V>(map: Map<K, V>, key: K) => V | undefined
const mapSet = uncurryIntrinsic(Map.prototype.set) as <K, V>(map: Map<K, V>, key: K, value: V) => void
const mapDelete = uncurryIntrinsic(Map.prototype.delete) as <K, V>(map: Map<K, V>, key: K) => boolean
const mapClear = uncurryIntrinsic(Map.prototype.clear) as <K, V>(map: Map<K, V>) => void
const mapKeys = uncurryIntrinsic(Map.prototype.keys) as <K, V>(map: Map<K, V>) => MapIterator<K>
const mapValues = uncurryIntrinsic(Map.prototype.values) as <K, V>(map: Map<K, V>) => MapIterator<V>
const mapSize = uncurryIntrinsic(Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!) as <K, V>(map: Map<K, V>) => number
const mapNext = uncurryIntrinsic(Object.getPrototypeOf(new NativeMap().keys()).next) as <T>(iterator: MapIterator<T>) => IteratorResult<T>

export class WeightedLru<K, V> {
  #entries = new NativeMap<K, { value: V; weight: number }>()
  #weight = 0
  readonly #maxEntries: number
  readonly #maxWeight: number
  readonly #onRemove?: (key: K, value: V) => void
  constructor(maxEntries: number, maxWeight: number, onRemove?: (key: K, value: V) => void) { this.#maxEntries = maxEntries; this.#maxWeight = maxWeight; this.#onRemove = onRemove }
  get(key: K): V | undefined {
    const found = mapGet(this.#entries, key)
    if (!found) return undefined
    mapDelete(this.#entries, key); mapSet(this.#entries, key, found)
    return found.value
  }
  canFit(key: K, weight: number): boolean {
    const prior = mapGet(this.#entries, key)
    return Number.isFinite(weight) && weight >= 0 && mapSize(this.#entries) + (prior ? 0 : 1) <= this.#maxEntries && this.#weight - (prior?.weight ?? 0) + weight <= this.#maxWeight
  }
  /** Inspect the eviction candidate without changing its recency. */
  leastRecentlyUsed(): V | undefined {
    const oldest = mapNext(mapValues(this.#entries))
    return oldest.done ? undefined : oldest.value.value
  }
  delete(key: K): boolean {
    const prior = mapGet(this.#entries, key)
    if (!prior) return false
    mapDelete(this.#entries, key); this.#weight -= prior.weight
    this.#onRemove?.(key, prior.value)
    return true
  }
  set(key: K, value: V, weight: number): void {
    if (!Number.isFinite(weight) || weight < 0 || weight > this.#maxWeight) return
    this.delete(key)
    mapSet(this.#entries, key, { value, weight }); this.#weight += weight
    while (mapSize(this.#entries) > this.#maxEntries || this.#weight > this.#maxWeight) {
      const oldest = mapNext(mapKeys(this.#entries)).value as K
      this.delete(oldest)
    }
  }
  clear(): void {
    if (this.#onRemove) {
      const keys = mapKeys(this.#entries)
      for (let next = mapNext(keys); !next.done; next = mapNext(keys)) this.delete(next.value)
    } else { mapClear(this.#entries); this.#weight = 0 }
  }
}
