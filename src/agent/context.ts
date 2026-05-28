// ============================================================================
// LayoutContext: seeded RNG, frozen font metrics, mock clock.
//
// v3 fix: withSeededRandom(rng, fn) overrides Math.random for the duration
// of `fn()`. Layout calls wrapped in this helper actually have ELK use the
// seeded RNG for its internal randomized decisions.
// ============================================================================

import type { LayoutContext, SeededRNG, MetricsTable, Clock } from './types.ts'
import FONT_METRICS from './assets/font-metrics.json' with { type: 'json' }

// ---- Seeded RNG (LCG) ----------------------------------------------------

const LCG_MULTIPLIER = 1664525
const LCG_INCREMENT = 1013904223
const LCG_MODULUS = 2 ** 32

export function createSeededRNG(seed: number = 0): SeededRNG {
  // eslint-disable-next-line no-restricted-syntax -- substrate primitive
  let state = ((seed | 0) >>> 0) || 1
  const rng: SeededRNG = {
    next() {
      state = (LCG_MULTIPLIER * state + LCG_INCREMENT) % LCG_MODULUS
      return state / LCG_MODULUS
    },
    fork() {
      return createSeededRNG(Math.floor(rng.next() * LCG_MODULUS))
    },
  }
  return rng
}

// ---- Frozen mock clock ----------------------------------------------------

export function createMockClock(initial: number = 0): Clock {
  let t = initial
  return {
    now() {
      t += 1
      return t
    },
  }
}

// ---- Font metric table ----------------------------------------------------

const DEFAULT_METRICS: MetricsTable = FONT_METRICS as MetricsTable

export function defaultMetricsTable(): MetricsTable {
  return DEFAULT_METRICS
}

export function measureWidth(table: MetricsTable, text: string): number {
  let w = 0
  for (const ch of text) {
    const m = table.chars[ch]
    w += m ? m.width : table.baseCharWidth
  }
  return w
}

// ---- LayoutContext --------------------------------------------------------

export interface LayoutContextOptions {
  seed?: number
  fontMetrics?: MetricsTable
  clock?: Clock
  basePath?: string
  labelCharCap?: number
}

export function createLayoutContext(opts: LayoutContextOptions = {}): LayoutContext {
  return {
    rng: createSeededRNG(opts.seed ?? 0),
    fontMetrics: opts.fontMetrics ?? defaultMetricsTable(),
    clock: opts.clock ?? createMockClock(),
    basePath: opts.basePath,
    labelCharCap: opts.labelCharCap,
  }
}

export function defaultLayoutContext(): LayoutContext {
  return createLayoutContext()
}

// ---- withSeededRandom: pin ELK's Math.random -----------------------------

/**
 * Run `fn` with the global `Math.random` overridden to consume from `rng`.
 * Restores the original on exit (including on throw).
 *
 * This is the mechanism by which `LayoutContext.rng.seed` actually drives
 * ELK's layered crossing minimizer. ELK reads `Math.random()` for its
 * randomized stages; overriding it makes those stages deterministic.
 *
 * Best-effort: any code path inside `fn` that reads randomness from
 * sources other than `Math.random` (e.g., crypto) bypasses this.
 */
export function withSeededRandom<T>(rng: SeededRNG, fn: () => T): T {
  const originalRandom = Math.random
  try {
    Math.random = () => rng.next()
    return fn()
  } finally {
    Math.random = originalRandom
  }
}
