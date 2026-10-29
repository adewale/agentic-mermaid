import type { MeasuredGraph } from './agentic-layered.ts'

/** Reverse DFS finish order preserves authored traversal when feedback counts
 * tie. Iterative traversal keeps deep state-machine chains off the JS stack. */
export function depthFirstOrder(outgoing: readonly number[][], edges: MeasuredGraph['edges']): Int32Array {
  const state = new Uint8Array(outgoing.length), cursor = new Uint32Array(outgoing.length)
  const order = new Int32Array(outgoing.length), stack: number[] = []
  let remaining = outgoing.length - 1
  for (let root = 0; root < outgoing.length; root++) {
    if (state[root]) continue
    state[root] = 1; stack.push(root)
    while (stack.length) {
      const node = stack.at(-1)!
      if (cursor[node]! < outgoing[node]!.length) {
        const edge = edges[outgoing[node]![cursor[node]!]!]!
        cursor[node] = cursor[node]! + 1
        if (!state[edge.target]) { state[edge.target] = 1; stack.push(edge.target) }
      } else {
        stack.pop(); state[node] = 2; order[node] = remaining--
      }
    }
  }
  return order
}

/** Greedy feedback-arc ordering (Eades–Lin–Smyth): peel sinks/sources, then
 * remove a vertex of maximum outdegree minus indegree. Intrusive score buckets
 * bound both space and total degree updates by O(nodes + edges). Ties follow
 * deterministic insertion order. This changes private ranks, never meaning. */
export function feedbackOrder(incoming: readonly number[][], outgoing: readonly number[][], edges: MeasuredGraph['edges']): Int32Array {
  const count = incoming.length, offset = edges.length
  const heads = new Int32Array(2 * offset + 1).fill(-1)
  const next = new Int32Array(count).fill(-1), previous = new Int32Array(count).fill(-1)
  const ins = Uint32Array.from(incoming, peers => peers.length), outs = Uint32Array.from(outgoing, peers => peers.length)
  const active = new Uint8Array(count).fill(1), order = new Int32Array(count)
  const sources: number[] = [], sinks: number[] = []
  let highest = 0, left = 0, right = count - 1
  const bucket = (node: number): number => offset + outs[node]! - ins[node]!
  const insert = (node: number): void => {
    const score = bucket(node), head = heads[score]!
    previous[node] = -1; next[node] = head
    if (head >= 0) previous[head] = node
    heads[score] = node
    highest = Math.max(highest, score)
  }
  const unlink = (node: number): void => {
    const before = previous[node]!, after = next[node]!
    if (before >= 0) next[before] = after
    else heads[bucket(node)] = after
    if (after >= 0) previous[after] = before
  }
  const remove = (node: number): void => {
    unlink(node); active[node] = 0
    for (const edge of incoming[node]!) {
      const peer = edges[edge]!.source
      if (!active[peer]) continue
      unlink(peer); outs[peer] = outs[peer]! - 1; insert(peer)
      if (outs[peer] === 0) sinks.push(peer)
    }
    for (const edge of outgoing[node]!) {
      const peer = edges[edge]!.target
      if (!active[peer]) continue
      unlink(peer); ins[peer] = ins[peer]! - 1; insert(peer)
      if (ins[peer] === 0) sources.push(peer)
    }
  }
  for (let node = count - 1; node >= 0; node--) {
    insert(node)
    if (!ins[node]) sources.push(node)
    if (!outs[node]) sinks.push(node)
  }
  while (left <= right) {
    while (sinks.length) {
      const node = sinks.pop()!
      if (active[node]) { order[node] = right--; remove(node) }
    }
    while (sources.length) {
      const node = sources.pop()!
      if (active[node]) { order[node] = left++; remove(node) }
    }
    if (left > right) break
    while (highest >= 0 && heads[highest] === -1) highest--
    const node = heads[highest]
    if (node === undefined || node < 0) throw new TypeError('Feedback ordering lost an active vertex')
    order[node] = left++; remove(node)
  }
  return order
}
