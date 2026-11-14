// Paired comparison statistics. Deterministic: the bootstrap uses a seeded PRNG.

/** mulberry32 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  const rand = seededRandom(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export const mean = (values: readonly number[]): number | null => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null)

export interface PairedEstimate {
  /** Clusters (cases) with observations in both arms. */
  cases: number
  /** Mean over cases of (treatment − control). */
  diff: number | null
  lo: number | null
  hi: number | null
}

/**
 * Case-clustered paired bootstrap. Each case contributes the difference of its
 * per-arm means (over runs and models), and cases are resampled with
 * replacement, so repeated runs of one case are not treated as independent.
 */
export function pairedBootstrap(perCase: ReadonlyArray<{ control: number; treatment: number }>, iterations = 10_000, seed = 20261113, level = 0.95): PairedEstimate {
  const diffs = perCase.map(c => c.treatment - c.control)
  const n = diffs.length
  if (!n) return { cases: 0, diff: null, lo: null, hi: null }
  const rand = seededRandom(seed)
  const stats = new Float64Array(iterations)
  for (let i = 0; i < iterations; i++) {
    let sum = 0
    for (let k = 0; k < n; k++) sum += diffs[Math.floor(rand() * n)]!
    stats[i] = sum / n
  }
  stats.sort()
  const tail = (1 - level) / 2
  const at = (q: number) => stats[Math.min(iterations - 1, Math.max(0, Math.floor(q * iterations)))]!
  return { cases: n, diff: mean(diffs), lo: at(tail), hi: at(1 - tail) }
}
