// ============================================================================
// Deterministic seeding for styled backends (SPEC §8 seed contract).
//
//   seed(node, stream) = hash(options.seed, stableSceneNodeId, streamName)
//
// Randomness is keyed on stable scene-node ids and named substreams — never
// list position — so inserting a decorative mark cannot reshuffle unrelated
// geometry. All randomness flows from makeRng(seed) (mulberry32).
// Math.random()/Date are forbidden in the render path (lint-gated).
// ============================================================================

/** FNV-1a 32-bit string hash. */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, deterministic PRNG over a 32-bit seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The §8 substream seed: user seed + stable node id + named substream. */
export function nodeSeed(userSeed: number, nodeId: string, stream: string): number {
  return seedFrom(`${userSeed >>> 0}|${nodeId}|${stream}`)
}

export function nodeRng(userSeed: number, nodeId: string, stream: string): () => number {
  return makeRng(nodeSeed(userSeed, nodeId, stream))
}
