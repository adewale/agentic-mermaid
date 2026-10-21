import type { MeasuredGraph } from './agentic-layered-core.ts'
import { privateRankSpan } from './minimum-span-ranks.ts'

/** Enumerate feasible one/two-edge reversal cuts of a small cyclic graph.
 * Completed cuts remain useful on exhaustion; an unfinished topological order
 * never escapes. This shares the optional ordering budget with chain moves. */
export function smallFeedbackCuts(
  input: MeasuredGraph,
  work: { blockPairs?: number },
): { order: Int32Array; span: number }[] {
  const n = input.nodes.length, edges = input.edges
  if (!n || n > 20 || edges.length > 48 || (work.blockPairs ?? 2_000_000) <= 0) return []
  const base = new Uint16Array(n), incoming = new Uint16Array(n), queue = new Uint16Array(n)
  const rank = new Float64Array(n), order = new Int32Array(n)
  for (const edge of edges) base[edge.target] = base[edge.target]! + 1
  let exhausted = false
  const spend = (cost: number): boolean => {
    const remaining = work.blockPairs ?? 2_000_000
    if (remaining < cost) { exhausted = true; return false }
    work.blockPairs = remaining - cost
    return true
  }
  const test = (first: number, second: number): { order: Int32Array; span: number } | undefined => {
    if (!spend(n + 4)) return
    incoming.set(base); rank.fill(0)
    for (const index of [first, second]) if (index >= 0) {
      const edge = edges[index]!
      incoming[edge.target] = incoming[edge.target]! - 1
      incoming[edge.source] = incoming[edge.source]! + 1
    }
    let length = 0
    for (let node = 0; node < n; node++) if (!incoming[node]) queue[length++] = node
    for (let cursor = 0; cursor < length; cursor++) {
      if (!spend(edges.length)) return
      const node = queue[cursor]!; order[node] = cursor
      for (let index = 0; index < edges.length; index++) {
        const edge = edges[index]!, reversed = index === first || index === second
        const source = reversed ? edge.target : edge.source, target = reversed ? edge.source : edge.target
        if (source !== node) continue
        rank[target] = Math.max(rank[target]!, rank[node]! + privateRankSpan(edge, input.compactPrivateRanks))
        incoming[target] = incoming[target]! - 1
        if (!incoming[target]) queue[length++] = target
      }
    }
    if (length !== n) return
    if (!spend(edges.length)) return
    let span = 0
    for (const edge of edges) span += Math.abs(rank[edge.target]! - rank[edge.source]!)
    return { order: order.slice(), span }
  }
  const cuts: { order: Int32Array; span: number }[] = []
  for (let first = 0; first < edges.length && !exhausted; first++) {
    const cut = test(first, -1)
    if (cut) cuts.push(cut)
  }
  if (cuts.length || exhausted) return cuts
  for (let first = 0; first < edges.length && !exhausted; first++) {
    for (let second = first + 1; second < edges.length && !exhausted; second++) {
      const cut = test(first, second)
      if (cut) cuts.push(cut)
    }
  }
  return cuts
}
