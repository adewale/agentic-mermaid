import type { MermaidGraph } from '../types.ts'

/**
 * Deterministic, O(V + E) proxy for the layered placement work a graph asks
 * of ELK, computed from the graph alone (never from time or the host).
 *
 * Endpoints are ranked by model order (node declaration order, then first use
 * of any other endpoint such as a group), every edge points from its earlier
 * endpoint to its later one — the orientation model-order cycle breaking
 * favours — and each endpoint takes its longest-path layer.
 *
 * - `dummySegments` is the long-edge dummy count Σ(span − 1): the extra
 *   vertices every crossing-minimisation sweep must order.
 * - `maxGapEdges` is the largest number of edges spanning one layer gap: the
 *   segments one channel must order and route.
 * - `bundleWork` is E × Σ (fan-out and fan-in sizes of 2 or more): each
 *   bundle candidate is admitted against every route.
 */
export interface LayoutCostEstimate {
  readonly nodes: number
  readonly edges: number
  readonly layers: number
  readonly dummySegments: number
  readonly maxGapEdges: number
  readonly bundleWork: number
}

/** Layout options relaxed above the cost thresholds, in a stable order.
 * 'junction-contraction' lays out each complete-bipartite block through a
 * hidden junction (src/layout/junction-contraction.ts); the other options are
 * then decided from the contracted graph. */
export type RelaxedLayoutOption = 'junction-contraction' | 'model-order' | 'edge-bundling'

export interface LayoutCostReceipt {
  readonly estimate: LayoutCostEstimate
  /** With 'junction-contraction': the estimate of the graph actually laid out. */
  readonly contracted?: LayoutCostEstimate
  readonly relaxed: readonly RelaxedLayoutOption[]
  /** Layout candidates the bounded search may produce, each with at most
   * `maxElkAttemptsPerCandidate` ELK runs. */
  readonly maxCandidates: number
  readonly maxElkAttemptsPerCandidate: number
}

/**
 * Model-order crossing minimisation (`considerModelOrder: NODES_AND_EDGES`
 * with forced node order) dominates ELK time above the first two thresholds:
 * a complete 30-node DAG (4,060 dummy segments) took 72 s, a 30 × 30 state
 * transition table (870 edges in one gap) 43 s. Generic fan bundling admits
 * every member route against every other route (marker clearance, opposing
 * shared ink), so its work grows with `bundleWork`: 1.6M for a 30 × 30
 * all-to-all fan, whose bundling took 2.8-6.8 s; above that threshold edges
 * keep their individual ELK routes, the established unbundled route form.
 * The largest values in the corpus, golden and website samples (122 dummy
 * segments, 179 gap edges, bundleWork 89,401) reach none of them, so
 * their geometry is unchanged.
 */
export const LAYOUT_COST_THRESHOLDS = Object.freeze({ dummySegments: 1_000, maxGapEdges: 400, bundleWork: 500_000 })
/** Whether an estimate reaches any layout-cost threshold. */
export function layoutCostExceedsThresholds(estimate: LayoutCostEstimate): boolean {
  return estimate.dummySegments >= LAYOUT_COST_THRESHOLDS.dummySegments
    || estimate.maxGapEdges >= LAYOUT_COST_THRESHOLDS.maxGapEdges
    || estimate.bundleWork >= LAYOUT_COST_THRESHOLDS.bundleWork
}

/** Above a threshold: two candidates, each with two ELK option sets. */
const BOUNDED_CANDIDATES = 2
const BOUNDED_ELK_ATTEMPTS = 2

/** The estimate reads only node ids (in declaration order) and edge endpoints. */
export interface LayoutCostGraph {
  readonly nodes: ReadonlyMap<string, unknown>
  readonly edges: ReadonlyArray<{ readonly source: string; readonly target: string }>
}

export function estimateLayoutCost(graph: LayoutCostGraph): LayoutCostEstimate {
  const order = new Map<string, number>()
  for (const id of graph.nodes.keys()) order.set(id, order.size)
  for (const edge of graph.edges) {
    if (!order.has(edge.source)) order.set(edge.source, order.size)
    if (!order.has(edge.target)) order.set(edge.target, order.size)
  }
  // Incoming lists keyed by the later endpoint; self-loops span no gap.
  const earlier: number[][] = Array.from({ length: order.size }, () => [])
  const out = new Int32Array(order.size), into = new Int32Array(order.size)
  for (const edge of graph.edges) {
    const a = order.get(edge.source)!, b = order.get(edge.target)!
    if (a === b) continue
    earlier[Math.max(a, b)]!.push(Math.min(a, b))
    out[a]!++
    into[b]!++
  }
  let fanMembers = 0
  for (let v = 0; v < order.size; v++) fanMembers += (out[v]! >= 2 ? out[v]! : 0) + (into[v]! >= 2 ? into[v]! : 0)
  const layer = new Int32Array(order.size)
  let layers = order.size ? 1 : 0
  for (let v = 0; v < order.size; v++) {
    for (const u of earlier[v]!) if (layer[u]! + 1 > layer[v]!) layer[v] = layer[u]! + 1
    if (layer[v]! + 1 > layers) layers = layer[v]! + 1
  }
  // Difference array: gap g lies between layers g and g + 1.
  const gapDelta = new Int32Array(layers + 1)
  let dummySegments = 0
  for (let v = 0; v < order.size; v++) {
    for (const u of earlier[v]!) {
      gapDelta[layer[u]!]!++
      gapDelta[layer[v]!]!--
      dummySegments += layer[v]! - layer[u]! - 1
    }
  }
  let load = 0, maxGapEdges = 0
  for (let gap = 0; gap < layers; gap++) {
    load += gapDelta[gap]!
    if (load > maxGapEdges) maxGapEdges = load
  }
  return { nodes: graph.nodes.size, edges: graph.edges.length, layers, dummySegments, maxGapEdges, bundleWork: fanMembers * graph.edges.length }
}

function relaxedOptions(estimate: LayoutCostEstimate): RelaxedLayoutOption[] {
  const relaxed: RelaxedLayoutOption[] = []
  if (estimate.dummySegments >= LAYOUT_COST_THRESHOLDS.dummySegments || estimate.maxGapEdges >= LAYOUT_COST_THRESHOLDS.maxGapEdges) relaxed.push('model-order')
  if (estimate.bundleWork >= LAYOUT_COST_THRESHOLDS.bundleWork) relaxed.push('edge-bundling')
  return relaxed
}

/** The bounded profile for a graph above a cost threshold, else undefined. */
export function layoutCostReceipt(graph: Pick<MermaidGraph, 'nodes' | 'edges'>): LayoutCostReceipt | undefined {
  const estimate = estimateLayoutCost(graph)
  const relaxed = relaxedOptions(estimate)
  if (!relaxed.length) return undefined
  return { estimate, relaxed, maxCandidates: BOUNDED_CANDIDATES, maxElkAttemptsPerCandidate: BOUNDED_ELK_ATTEMPTS }
}

/** The bounded profile when `contracted` (junction contraction of the graph
 * `receipt` describes) is laid out instead: the remaining relaxations are
 * decided from the contracted graph's own estimate. */
export function contractedLayoutCostReceipt(receipt: LayoutCostReceipt, contracted: Pick<MermaidGraph, 'nodes' | 'edges'>): LayoutCostReceipt {
  const estimate = estimateLayoutCost(contracted)
  return { ...receipt, contracted: estimate, relaxed: ['junction-contraction', ...relaxedOptions(estimate)] }
}
