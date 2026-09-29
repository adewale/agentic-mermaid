// Relative-growth complexity guard, the replacement for absolute wall-clock
// ceilings in the unit gate. It times one operation at size `n` and at
// `factor * n`, keeps the fastest of `repeats` runs of each to shed scheduler
// and GC noise, and returns the growth ratio. Coverage instrumentation or a
// loaded shard slows both sizes alike, so the ratio does not flake the way a
// fixed millisecond budget does. Linear work grows about `factor`×; a
// quadratic regression grows about `factor`²× (256× at the default factor 16).
// Measured on the guarded parsers (2026-09): linear ratios 7-33, a quadratic
// control 144-355, so the ceiling sits at 4× the factor with ~2× margin on
// each side.

/** Growth ratios below this still read as (near-)linear at the default factor. */
export const LINEAR_GROWTH_CEILING = 64

// Timer-resolution floor for the small run, so a sub-microsecond reading can
// not inflate the ratio.
const MIN_TIMED_MS = 0.05

export function measureGrowth<T>(
  run: (n: number) => T,
  n: number,
  options: { factor?: number; repeats?: number } = {},
): { ratio: number; result: T } {
  const factor = options.factor ?? 16
  const repeats = options.repeats ?? 3
  run(n) // warm the JIT before timing
  const fastest = (size: number) => {
    let best = Number.POSITIVE_INFINITY
    let result: T | undefined
    for (let i = 0; i < repeats; i++) {
      const started = performance.now()
      result = run(size)
      best = Math.min(best, performance.now() - started)
    }
    return { best, result: result as T }
  }
  const small = fastest(n)
  const large = fastest(n * factor)
  return { ratio: large.best / Math.max(small.best, MIN_TIMED_MS), result: large.result }
}
