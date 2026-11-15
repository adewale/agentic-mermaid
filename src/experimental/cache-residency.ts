/** Conservative residency units, including collection contents and aliases.
 * This is an eviction estimate, not a measurement of the engine's heap.
 * `opaque` may supply the weight of an immutable subtree without visiting it. */
export function estimatedResidency(value: unknown, limit: number, opaque?: (item: object) => number | undefined): number {
  const seen = new WeakSet<object>()
  let weight = 0
  const visit = (item: unknown): void => {
    if (weight > limit) return
    if (typeof item === 'string') { weight += item.length * 4 + 16; return }
    if (item === null || typeof item !== 'object') { weight += 16; return }
    if (seen.has(item)) { weight += 8; return }
    seen.add(item)
    const known = opaque?.(item)
    if (known !== undefined) { weight += known; return }
    weight += 64
    if (item instanceof Map) {
      for (const [key, value] of item) { weight += 32; visit(key); visit(value); if (weight > limit) break }
    } else if (item instanceof Set) {
      for (const value of item) { weight += 16; visit(value); if (weight > limit) break }
    } else if (item instanceof ArrayBuffer) weight += item.byteLength
    else if (ArrayBuffer.isView(item)) visit(item.buffer)
    else {
      for (const key of Object.keys(item)) {
        weight += key.length * 2 + 16
        visit((item as Record<string, unknown>)[key])
        if (weight > limit) break
      }
    }
  }
  visit(value)
  return weight
}
