// ============================================================================
// LayoutContext: seeded RNG, frozen font metrics, mock clock.
//
// Push every source of nondeterminism behind this interface. The library
// reads from these on the deterministic path. A lint rule bans direct use
// of Math.random / Date.now / performance.now in layout/render modules.
// ============================================================================

import type { LayoutContext, SeededRNG, MetricsTable, Clock, FontMetric } from './types.ts'
import FONT_METRICS from './assets/font-metrics.json' with { type: 'json' }

// ---- Seeded RNG (LCG) ----------------------------------------------------

const LCG_MULTIPLIER = 1664525
const LCG_INCREMENT = 1013904223
const LCG_MODULUS = 2 ** 32

/**
 * Creates a deterministic pseudo-random source. Same seed → same sequence
 * across platforms and runs. Sufficient for ordering shuffles; not suitable
 * for security-sensitive randomness.
 */
export function createSeededRNG(seed: number = 0): SeededRNG {
  // Normalize the seed to a uint32 so negative seeds produce a stable stream.
  let state = ((seed | 0) >>> 0) || 1
  const rng: SeededRNG = {
    next() {
      state = (LCG_MULTIPLIER * state + LCG_INCREMENT) % LCG_MODULUS
      return state / LCG_MODULUS
    },
    fork() {
      // Forked RNGs are seeded from the parent's next value so that the
      // parent and child streams don't share state.
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
      // Advance by 1ms per call so callers that key off "now" get a stable
      // monotonic sequence rather than a single repeated value.
      t += 1
      return t
    },
  }
}

// ---- Font metric table ----------------------------------------------------

interface SerializedMetricsTable {
  family: string
  size: number
  baseCharWidth: number
  lineHeight: number
  chars: Record<string, FontMetric>
}

const DEFAULT_METRICS: MetricsTable = FONT_METRICS as SerializedMetricsTable

export function defaultMetricsTable(): MetricsTable {
  return DEFAULT_METRICS
}

/**
 * Measure a string's display width using the frozen table. Falls back to
 * baseCharWidth for characters not in the table.
 */
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
}

export function createLayoutContext(opts: LayoutContextOptions = {}): LayoutContext {
  return {
    rng: createSeededRNG(opts.seed ?? 0),
    fontMetrics: opts.fontMetrics ?? defaultMetricsTable(),
    clock: opts.clock ?? createMockClock(),
    basePath: opts.basePath,
  }
}

/**
 * Default context: seed 0, frozen metric table, mock clock. This is what
 * `deterministic: true` (the spec's default) resolves to when callers don't
 * supply an explicit LayoutContext.
 */
export function defaultLayoutContext(): LayoutContext {
  return createLayoutContext()
}
