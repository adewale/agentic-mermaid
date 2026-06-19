// Delta-debugging minimizer (Move 6): the "reduce" half of the GraphicsFuzz loop
// (Donaldson et al., OOPSLA 2017) and the standard tool for shrinking a failing
// metamorphic/differential case to a minimal repro (Zeller & Hildebrandt's ddmin).
//
// Given a list of units (e.g. the lines of a Mermaid source) and a predicate
// that is TRUE on the failing input, ddmin returns a locally-minimal sublist
// that still fails — so a 200-line counterexample collapses to the few lines
// that actually matter. fast-check shrinks property inputs for free; this covers
// the corpus/differential lanes where the failing input is a raw source string.

/**
 * Classic ddmin. `units` is the failing input split into removable pieces;
 * `stillFails(subset)` must return true for the full `units`. Returns a
 * 1-minimal subset that still fails (removing any single remaining unit makes
 * it pass).
 */
export function ddmin<T>(units: T[], stillFails: (subset: T[]) => boolean): T[] {
  let current = units.slice()
  let n = 2
  while (current.length >= 2) {
    const chunkSize = Math.ceil(current.length / n)
    let reduced = false
    for (let i = 0; i < current.length; i += chunkSize) {
      // The complement: current with chunk [i, i+chunkSize) removed.
      const complement = current.slice(0, i).concat(current.slice(i + chunkSize))
      if (complement.length > 0 && stillFails(complement)) {
        current = complement
        n = Math.max(n - 1, 2)
        reduced = true
        break
      }
    }
    if (!reduced) {
      if (n >= current.length) break  // granularity exhausted → 1-minimal
      n = Math.min(current.length, n * 2)
    }
  }
  return current
}

/** Convenience: reduce a multi-line source to a minimal failing source. */
export function reduceSource(source: string, stillFails: (s: string) => boolean): string {
  const lines = source.split('\n')
  return ddmin(lines, subset => stillFails(subset.join('\n'))).join('\n')
}
