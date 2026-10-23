/** Invocation-local search over caller-owned ordinary adjacency maps/sets.
 * Callers retain their own authored-edge admission and insertion rules. */
export function directedReachability(outgoing: ReadonlyMap<string, ReadonlySet<string>>): (from: string, to: string) => boolean {
  let visited: Map<string, number> | undefined
  let stack: string[] | undefined
  let generation = 0

  return (from, to) => {
    // Zero-query invocations allocate no scratch; ordinary searches reuse it.
    const marks = visited ??= new Map<string, number>()
    const pending = stack ??= []
    // Do not retain a query's pending vertices on early exit.
    pending.length = 0
    if (generation === Number.MAX_SAFE_INTEGER) {
      marks.clear()
      generation = 0
    }
    generation++
    pending.push(from)
    while (pending.length > 0) {
      const id = pending.pop()!
      if (id === to) {
        pending.length = 0
        return true
      }
      if (marks.get(id) === generation) continue
      marks.set(id, generation)
      const next = outgoing.get(id)
      if (next) for (const target of next) pending.push(target)
    }
    return false
  }
}
