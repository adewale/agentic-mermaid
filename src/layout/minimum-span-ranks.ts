/** Minimize total edge span in an acyclic measured constraint graph. Unit
 * flow on every edge supplies the dual demands. Positive residual cycles
 * improve that feasible flow; absence of such a cycle certifies the recovered
 * rank potentials by primal/dual equality. This is bounded cycle cancellation,
 * not a network-simplex implementation. Exhaustion keeps the caller's ranks. */
import type { MeasuredGraph } from './agentic-layered-core.ts'
export function minimumSpanRanks(input: Pick<MeasuredGraph, 'nodes' | 'edges'>, work: { rankPairs: number }): Float64Array | undefined {
  const n = input.nodes.length,
    edges = input.edges
  if (n === 0) return new Float64Array(0)
  if (work.rankPairs <= 0 || n > 64 || edges.length > 128 || edges.reduce((s, e) => s + e.minSpan, 0) > 128) return
  const flow = new Int32Array(edges.length).fill(1)
  for (let augmentation = 0; augmentation < 128; augmentation++) {
    const distance = new Float64Array(n),
      parent = new Int32Array(n).fill(-1),
      arc = new Int32Array(n)
    let changed = -1
    for (let round = 0; round < n; round++) {
      changed = -1
      for (const [i, edge] of edges.entries()) {
        work.rankPairs -= 2
        if (work.rankPairs < 0) return
        const span = 2 * edge.minSpan
        if (distance[edge.target]! < distance[edge.source]! + span) {
          distance[edge.target] = distance[edge.source]! + span
          parent[edge.target] = edge.source
          arc[edge.target] = i + 1
          changed = edge.target
        }
        if (flow[i]! > 0 && distance[edge.source]! < distance[edge.target]! - span) {
          distance[edge.source] = distance[edge.target]! - span
          parent[edge.source] = edge.target
          arc[edge.source] = -i - 1
          changed = edge.source
        }
      }
      if (changed < 0) {
        const primal = edges.reduce((s, e) => s + distance[e.target]! - distance[e.source]!, 0),
          dual = edges.reduce((s, e, i) => s + flow[i]! * 2 * e.minSpan, 0)
        if (primal !== dual) throw new Error(`dual rank mismatch ${primal} ${dual}`)
        return distance
      }
    }
    let cursor = changed
    for (let i = 0; i < n; i++) cursor = parent[cursor]!
    const start = cursor,
      cycle: number[] = []
    let capacity = Infinity,
      gain = 0
    do {
      const a = arc[cursor]!,
        index = Math.abs(a) - 1
      if (index < 0) throw new Error('missing residual predecessor')
      cycle.push(a)
      gain += Math.sign(a) * 2 * edges[index]!.minSpan
      if (a < 0) capacity = Math.min(capacity, flow[index]!)
      cursor = parent[cursor]!
    } while (cursor !== start && cycle.length <= n)
    if (cursor !== start || gain <= 0 || !Number.isFinite(capacity) || capacity <= 0) throw new Error(`invalid positive residual cycle ${gain} ${capacity}`)
    for (const a of cycle) flow[Math.abs(a) - 1] = flow[Math.abs(a) - 1]! + Math.sign(a) * capacity
  }
}
