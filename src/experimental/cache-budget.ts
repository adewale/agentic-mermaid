/** Aggregate residency estimates for module-owned renderer caches. This does
 * not include live requests, the ELK engine, host profiles or native heaps. */
export class CacheBudget {
  private entries = new Map<object, { weight: number; evict: () => void }>()
  private weight = 0
  constructor(readonly limit: number) {}
  touch(key: object): void {
    const entry = this.entries.get(key)
    if (entry) { this.entries.delete(key); this.entries.set(key, entry) }
  }
  release(key: object): void {
    const entry = this.entries.get(key)
    if (entry) { this.weight -= entry.weight; this.entries.delete(key) }
  }
  retain(key: object, weight: number, evict: () => void): void {
    this.release(key)
    this.entries.set(key, { weight, evict }); this.weight += weight
    while (this.weight > this.limit) {
      const oldest = this.entries.entries().next().value!
      this.release(oldest[0])
      oldest[1].evict()
    }
  }
}
export const rendererCacheBudget = new CacheBudget(32 * 1024 * 1024)
