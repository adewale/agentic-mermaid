// ============================================================================
// Deterministic randomness core. Everything stochastic in the prototype flows
// from these two functions — no Math.random(), no Date — so identical input
// always produces identical SVG bytes (the golden-test contract).
// ============================================================================

export interface Point { x: number; y: number }

// --- Seeded PRNG (mulberry32). Tiny, fast, deterministic. ------------------
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Hash a string (e.g. a serialized element + substream) into a stable seed.
export function seedFrom(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
