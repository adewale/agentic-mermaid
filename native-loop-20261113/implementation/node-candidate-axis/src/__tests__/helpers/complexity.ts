// Complexity guards without absolute wall-clock ceilings. A "finishes under N
// ms" budget flakes when the suite runs with coverage and parallel workers.
// Each guard here compares two timings taken back to back on the same machine,
// so runner load slows both sides alike and cancels out, while a super-linear
// regression still shows:
// - `expectNearLinearGrowth` / `measureGrowth` time one operation at two input
//   sizes and judge the growth ratio;
// - `costRelativeToLinearScan` times the work against a plain linear scan of
//   the same input.

import { expect } from 'bun:test'

/** Fastest of `runs` timings: a GC pause or a load spike inflates one sample, not all. */
function fastestOf<T>(runs: number, run: () => T): { ms: number; result: T } {
  let ms = Number.POSITIVE_INFINITY
  let result: T | undefined
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    result = run()
    ms = Math.min(ms, performance.now() - started)
  }
  return { ms, result: result as T }
}

/** Allowed multiple of the linear ratio (factor 8 → 32x; quadratic is 64x). */
const LINEAR_SLACK = 4
/** Fixed allowance so timer noise on sub-millisecond runs cannot fail the check. */
const NOISE_MS = 25

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
  const smallMs = fastestOf(3, () => run(small)).ms
  const largeMs = fastestOf(3, () => run(size)).ms
  const limitMs = smallMs * factor * LINEAR_SLACK + NOISE_MS
  expect(largeMs, `${label}: ${largeMs.toFixed(1)} ms at size ${size} vs ${smallMs.toFixed(1)} ms at size ${small} (limit ${limitMs.toFixed(1)} ms)`)
    .toBeLessThan(limitMs)
}

/**
 * Growth ratios below this still read as (near-)linear at `measureGrowth`'s
 * default factor 16. Measured on the guarded parsers (2026-09): linear ratios
 * 7-33, a quadratic control 144-355, so the ceiling sits at 4× the factor with
 * about 2× margin on each side.
 */
export const LINEAR_GROWTH_CEILING = 64

// Timer-resolution floor for the small run, so a sub-microsecond reading can
// not inflate the ratio.
const MIN_TIMED_MS = 0.05

/**
 * Times `run` at `n` and at `factor × n` (fastest of `repeats` each, after one
 * warm-up call) and returns the growth ratio with the large run's result.
 * Linear work grows about `factor`×; a quadratic regression about `factor`²×.
 */
export function measureGrowth<T>(
  run: (n: number) => T,
  n: number,
  options: { factor?: number; repeats?: number } = {},
): { ratio: number; result: T } {
  const factor = options.factor ?? 16
  const repeats = options.repeats ?? 3
  run(n)
  const small = fastestOf(repeats, () => run(n))
  const large = fastestOf(repeats, () => run(n * factor))
  return { ratio: large.ms / Math.max(small.ms, MIN_TIMED_MS), result: large.result }
}

let sink = 0

function linearScan(input: string): void {
  let acc = 0
  for (let i = 0; i < input.length; i++) acc = (acc + input.charCodeAt(i)) | 0
  sink ^= acc
}

/**
 * Fastest-of-`runs` time of `work` divided by the fastest time of a linear
 * character scan over `input`, both warmed once first. The ratio stays near a
 * constant for linear work and grows with the input for super-linear work (on
 * 64K-character inputs a quadratic scan lands tens of thousands of times above
 * the reference).
 */
export function costRelativeToLinearScan(input: string, work: () => unknown, runs = 7): number {
  work()
  linearScan(input)
  const workTime = fastestOf(runs, () => { work() }).ms
  const scanTime = fastestOf(runs, () => linearScan(input)).ms
  // Keep the reference observable so the scan cannot be optimized away.
  if (sink === Number.MIN_SAFE_INTEGER) throw new Error('unreachable')
  return workTime / Math.max(scanTime, 0.01)
}
