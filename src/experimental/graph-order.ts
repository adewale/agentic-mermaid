/** A minimum heap of insertion ordinals; ties never depend on engine sorting. */
class OrdinalHeap {
  private readonly values: number[] = []
  push(value: number): void {
    let slot = this.values.length
    this.values.push(value)
    while (slot > 0) {
      const parent = (slot - 1) >>> 1
      if (this.values[parent]! <= value) break
      this.values[slot] = this.values[parent]!
      slot = parent
    }
    this.values[slot] = value
  }
  pop(): number | undefined {
    const first = this.values[0]
    const last = this.values.pop()
    if (this.values.length === 0 || last === undefined) return first
    let slot = 0
    while (2 * slot + 1 < this.values.length) {
      const left = 2 * slot + 1, right = left + 1
      const child = right < this.values.length && this.values[right]! < this.values[left]! ? right : left
      if (this.values[child]! >= last) break
      this.values[slot] = this.values[child]!
      slot = child
    }
    this.values[slot] = last
    return first
  }
}

/**
 * An insertion-only DAG. A valid topological rank rejects most cycle searches
 * immediately. A backwards insertion visits only the affected rank interval,
 * then moves those descendants after its source. The accepted constraints are
 * exactly the author-order, cycle-rejecting constraints of the original DFS.
 */
export class IncrementalGraphOrder {
  private readonly ordinal: Map<string, number>
  private readonly outgoing: Array<Set<number>>
  private readonly indegree: Int32Array
  private readonly rank: Int32Array
  private order: number[]
  private readonly visited: Uint32Array
  private generation = 0

  constructor(private readonly ids: readonly string[]) {
    this.ordinal = new Map(ids.map((id, index) => [id, index]))
    this.outgoing = ids.map(() => new Set<number>())
    this.indegree = new Int32Array(ids.length)
    this.rank = Int32Array.from(ids, (_, index) => index)
    this.order = ids.map((_, index) => index)
    this.visited = new Uint32Array(ids.length)
  }

  /** True for an existing constraint too; false for unknown or cyclic edges. */
  add(source: string, target: string): boolean {
    const from = this.ordinal.get(source), to = this.ordinal.get(target)
    if (from === undefined || to === undefined || from === to) return false
    if (this.outgoing[from]!.has(to)) return true
    if (this.rank[from]! >= this.rank[to]!) {
      if (++this.generation === 0x1_0000_0000) {
        this.visited.fill(0)
        this.generation = 1
      }
      const stack = [to]
      const affected: number[] = []
      while (stack.length > 0) {
        const current = stack.pop()!
        if (current === from) return false
        if (this.visited[current] === this.generation) continue
        this.visited[current] = this.generation
        affected.push(current)
        for (const next of this.outgoing[current]!) {
          if (this.rank[next]! <= this.rank[from]!) stack.push(next)
        }
      }
      // The subsequence order remains topological within the moved set. Every
      // retained descendant is beyond the source; predecessors stay before it.
      const moved = new Set(affected)
      const retained: number[] = [], shifted: number[] = []
      for (const current of this.order) (moved.has(current) ? shifted : retained).push(current)
      const at = retained.indexOf(from) + 1
      this.order = [...retained.slice(0, at), ...shifted, ...retained.slice(at)]
      this.order.forEach((id, index) => { this.rank[id] = index })
    }
    this.outgoing[from]!.add(to)
    this.indegree[to] = this.indegree[to]! + 1
    return true
  }

  /** Stable Kahn order: identical to repeatedly sorting by original ordinal. */
  stableOrder(): string[] {
    const degrees = this.indegree.slice(), ready = new OrdinalHeap(), result: string[] = []
    degrees.forEach((degree, id) => { if (degree === 0) ready.push(id) })
    for (let id = ready.pop(); id !== undefined; id = ready.pop()) {
      result.push(this.ids[id]!)
      for (const next of this.outgoing[id]!) {
        degrees[next] = degrees[next]! - 1
        if (degrees[next] === 0) ready.push(next)
      }
    }
    return result
  }
}

export function incrementalSourceOrder(ids: readonly string[], edges: readonly { source: string; target: string }[]): string[] {
  const dag = new IncrementalGraphOrder(ids)
  for (const edge of edges) dag.add(edge.source, edge.target)
  return dag.stableOrder()
}
