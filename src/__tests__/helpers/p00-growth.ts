// Complexity guards without absolute wall-clock ceilings. A "finishes under N
// ms" budget flakes when the suite runs with coverage and parallel workers; a
// growth ratio times the same operation at two input sizes back to back, so
// machine load largely cancels out while a quadratic regression still shows.

import { expect } from 'bun:test'

/** Allowed multiple of the linear ratio (factor 8 → 32x; quadratic is 64x). */
const LINEAR_SLACK = 4
/** Fixed allowance so timer noise on sub-millisecond runs cannot fail the check. */
const NOISE_MS = 25

/** Fastest of three runs: a GC pause or a load spike inflates one sample, not all. */
function timeMs(run: () => void): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < 3; i++) {
    const started = performance.now()
    run()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

/**
 * Asserts `run(size)` grows at most about linearly with `size`: after one
 * warm-up call, the best run at `size` must take less than
 * `factor × LINEAR_SLACK` times the best run at `size / factor`, plus
 * `NOISE_MS`. `run` should do its own functional assertions; this helper only
 * judges the timing ratio.
 */
export function expectNearLinearGrowth(label: string, run: (size: number) => void, size: number, factor = 8): void {
  const small = Math.max(1, Math.floor(size / factor))
  run(small)
  const smallMs = timeMs(() => run(small))
  const largeMs = timeMs(() => run(size))
  const limitMs = smallMs * factor * LINEAR_SLACK + NOISE_MS
  expect(largeMs, `${label}: ${largeMs.toFixed(1)} ms at size ${size} vs ${smallMs.toFixed(1)} ms at size ${small} (limit ${limitMs.toFixed(1)} ms)`)
    .toBeLessThan(limitMs)
}
