import { smallFeedbackCuts } from './small-feedback-cuts.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { ChannelWork } from './channel-tracks.ts'
import { depthFirstOrder, feedbackOrder } from './cycle-order.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

/** Optional work is shared across scopes but cannot spend the budget needed
 * to produce a feasible layout in a later scope. */
export interface LayoutSearchWork {
  attempts: number
  scorePairs: number
  loopPairs: number
  rankPairs: number
  /** Joint long-edge ordering shares an independent, bounded score budget. */
  blockPairs?: number
  routing: ChannelWork
}

class OptionalOrderDecline extends Error {}

export function layoutCyclicGraph(
  input: MeasuredGraph,
  incoming: readonly number[][],
  outgoing: readonly number[][],
  layout: (input: MeasuredGraph, fail: (reason: string) => never, work: ChannelWork) => AgenticLayout,
  unsupported: (reason: string) => never,
  routingWork: ChannelWork,
  search: LayoutSearchWork,
): AgenticLayout {
  const { nodes, edges } = input
  const greedy = feedbackOrder(incoming, outgoing, edges), model = depthFirstOrder(outgoing, edges)
  const feedbackCount = (order: ArrayLike<number>): number => edges.reduce((count, edge) => count + Number(order[edge.source]! > order[edge.target]!), 0)
  const place = (order: ArrayLike<number>, fail: (reason: string) => never, work: ChannelWork, reverseNodes = false, reverseEdges = false): AgenticLayout => {
    const reversed = edges.map(edge => order[edge.source]! > order[edge.target]!)
    const permutation = nodes.map((_, index) => reverseNodes ? nodes.length - 1 - index : index)
    const indices = new Uint32Array(nodes.length)
    permutation.forEach((original, index) => { indices[original] = index })
    const edgeOrder = edges.map((_, index) => reverseEdges ? edges.length - 1 - index : index)
    const edgeIndices = new Uint32Array(edges.length)
    edgeOrder.forEach((original, index) => { edgeIndices[original] = index })
    const moved = layout({ ...input, shareCompleteFans: false, cycleOriented: true,
      nodes: permutation.map(index => nodes[index]!),
      edges: edgeOrder.map(original => {
        const edge = edges[original]!, source = reversed[original] ? edge.target : edge.source, target = reversed[original] ? edge.source : edge.target
        return { ...edge, source: indices[source]!, target: indices[target]! }
      }),
      loopPorts: input.loopPorts?.map(([a, b]) => [edgeIndices[a]!, edgeIndices[b]!] as const),
    }, fail, work)
    return { ...moved, nodes: nodes.map((_, index) => moved.nodes[indices[index]!]!),
      edges: edges.map((_, index) => {
        const route = moved.edges[edgeIndices[index]!]!
        return reversed[index] ? { ...route, points: [...route.points].reverse() } : route
      }) }
  }
  if (input.authoredCycleOrder) return place(Uint32Array.from(nodes, (_, index) => index), unsupported, routingWork, false, true)
  const primary = feedbackCount(model) <= feedbackCount(greedy) ? model : greedy
  let best = place(primary, unsupported, routingWork)
  if (nodes.length > 48 || edges.length > 128 || edges.reduce((sum, edge) => sum + edge.minSpan, 0) > 128
    || (best.expandedVertices ?? 0) > 1024 || search.attempts <= 0) return best
  const score = (candidate: AgenticLayout): number | undefined => {
    const points = candidate.edges.reduce((sum, edge, index) => sum + (edges[index]!.visible === false ? 0 : edge.points.length), 0)
    if (points > 2048 || points * points > search.scorePairs) return undefined
    search.scorePairs -= points * points
    return countPolylineCrossings(candidate.edges.map((route, index) => ({ ...route, visible: edges[index]!.visible })))
  }
  let bestScore = score(best)
  if (bestScore === undefined || bestScore === 0) return best
  const bendCount = (candidate: AgenticLayout): number => candidate.edges.reduce((sum, route, index) =>
    sum + (edges[index]!.visible === false ? 0 : Math.max(0, route.points.length - 2)), 0)
  let bestBends = bendCount(best), bestArea = best.width * best.height
  const key = (order: ArrayLike<number>, reverseNodes: boolean, reverseEdges: boolean): string =>
    edges.map(edge => order[edge.source]! > order[edge.target]! ? 1 : 0).join('') + ':' + reverseNodes + ':' + reverseEdges
  // Larger compact candidates retain the primary plus two optional orders.
  // The normal producer keeps its full search; compact placement is optional.
  let localAttempts = input.compactPrivateRanks && nodes.length > 16 ? 2 : 12
  const seen = new Set([key(primary, false, false)])
  const starts = nodes.length <= 12 ? nodes.map((_, index) => index)
    : nodes.length <= 20 ? [0, Math.floor(nodes.length / 4), Math.floor(nodes.length / 2), Math.floor(3 * nodes.length / 4), nodes.length - 1] : []
  const shifted = starts.flatMap(start => {
    const remap = (index: number) => (index - start + nodes.length) % nodes.length
    const movedEdges = edges.map(edge => ({ ...edge, source: remap(edge.source), target: remap(edge.target) }))
    const movedOut = outgoing.slice(start).concat(outgoing.slice(0, start)), movedIn = incoming.slice(start).concat(incoming.slice(0, start))
    const dfs = depthFirstOrder(movedOut, movedEdges), otherGreedy = feedbackOrder(movedIn, movedOut, movedEdges)
    return [Uint32Array.from(nodes, (_, index) => dfs[remap(index)]!), Uint32Array.from(nodes, (_, index) => otherGreedy[remap(index)]!)]
  })
  // Spend the two larger compact trials on distinct cuts before input variants.
  const diversify = input.compactPrivateRanks && nodes.length > 16
  // Scarce larger-graph trials should explore cuts beyond the same greedy
  // orientation. For nearly acyclic compact graphs, enumerate small cuts and
  // try opposite span extremes with authored node/edge order intact.
  const cuts = diversify && feedbackCount(primary) <= 3 ? smallFeedbackCuts(input, search, 3) : []
  cuts.sort((a, b) => b.span - a.span)
  const cutOrders = cuts.length > 1 ? [cuts[0]!.order, cuts.at(-1)!.order, ...cuts.slice(1, -1).map(cut => cut.order)] : cuts.map(cut => cut.order)
  const orders = [...cutOrders, greedy, model, ...shifted, Uint32Array.from(nodes, (_, index) => index)]
  const permutations = cuts.length ? [[false, false], [true, true], [true, false], [false, true]] as const
    : [[true, true], [true, false], [false, true], [false, false]] as const
  for (let trial = 0; trial < orders.length * permutations.length; trial++) {
    const order = orders[diversify ? trial % orders.length : Math.floor(trial / permutations.length)]!
    const [reverseNodes, reverseEdges] = permutations[diversify ? Math.floor(trial / orders.length) : trial % permutations.length]!
    const candidateKey = key(order, reverseNodes, reverseEdges)
    if (seen.has(candidateKey)) continue
    seen.add(candidateKey)
    if (localAttempts-- <= 0 || search.attempts-- <= 0 || search.routing.pairs < 0 || search.routing.arcs < 0 || search.routing.swaps < 0) return best
    try {
      const alternative = place(order, reason => { throw new OptionalOrderDecline(reason) }, search.routing, reverseNodes, reverseEdges)
      const value = score(alternative)
      if (value === undefined) return best
      const bends = bendCount(alternative), area = alternative.width * alternative.height
      // Crossings dominate, followed by bends and area. Exact ties preserve
      // the earlier candidate; no weighted score trades feasibility away.
      if (value < bestScore || (value === bestScore && (bends < bestBends || (bends === bestBends && area < bestArea)))) {
        best = alternative; bestScore = value; bestBends = bends; bestArea = area
      }
      if (bestScore === 0) return best
    } catch (error) {
      if (!(error instanceof OptionalOrderDecline)) throw error
    }
  }
  return best
}
