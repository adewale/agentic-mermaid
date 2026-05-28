// ============================================================================
// LayoutContext: seeded RNG, frozen font metrics, mock clock.
//
// v2 honest framing: this is a CONTRACT for the agent surface. It's used by
// the font-measurement path (LABEL_OVERFLOW heuristic). It is NOT yet plumbed
// through ELK — ELK's internal RNG still drives crossing minimization.
// `LayoutContext.rng.seed` does not currently affect layout output.
// ============================================================================

import type { LayoutContext, SeededRNG, MetricsTable, Clock } from './types.ts'
import FONT_METRICS from './assets/font-metrics.json' with { type: 'json' }

// ---- Seeded RNG (LCG) ----------------------------------------------------

const LCG_MULTIPLIER = 1664525
const LCG_INCREMENT = 1013904223
const LCG_MODULUS = 2 ** 32

export function createSeededRNG(seed: number = 0): SeededRNG {
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

/**
 * Measure a string's display width using the frozen table. Characters not
 * in the table fall back to baseCharWidth — recall on non-ASCII inputs is
 * poor by construction.
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

export function defaultLayoutContext(): LayoutContext {
  return createLayoutContext()
}
