import { assertMarkerPaint, type MarkerPaint } from './compound-marker-seating.ts'
import { refinePrivateChainOrder } from './chain-insertion-order.ts'
import { minimumSpanRanks, privateRankSpan, MAX_MEASURED_RANKS as MAX_RANKS } from './minimum-span-ranks.ts'
import { compactMeasuredLoops } from './compact-measured-loops.ts'
import type { Direction, Point } from '../types.ts'
import { layoutSharedFan } from './shared-fan-core.ts'
import { layoutCyclicGraph, type LayoutSearchWork } from './cycle-layout-search.ts'
import { layoutCompoundGraph } from './agentic-compound-core.ts'
import { feedbackOrder } from './cycle-order.ts'
import { assignChannelTracks, type ChannelStep, type ChannelWork } from './channel-tracks.ts'
import { AGENTIC_MAX_NODES as MAX_NODES, AGENTIC_MAX_EDGES as MAX_EDGES, AGENTIC_MAX_EXPANDED_VERTICES as MAX_EXPANDED_VERTICES } from './agentic-limits.ts'

export interface MeasuredGraph {
  /** Ordered partitions are local to a sibling scope; omitted values use zero. */
  nodes: readonly { id: string; width: number; height: number; paintStrokeWidth?: number; paintCornerRadius?: number; /** Producer-reserved primary port pitch; final paint proofs remain required. */ minimumPortSpacing?: number; parent?: number; partition?: number; modelOrder?: number }[]
  /** Edges may address a frame at nodes.length + its group index. */
  groups?: readonly {
    id: string; parent?: number; partition?: number; modelOrder?: number; direction?: Direction; minWidth: number
    /** Measured painted header strip, excluding blank content padding. */
    paintStrokeWidth?: number
    /** Actual canonical rounded-rectangle frame radius; absent means unknown. */
    paintCornerRadius?: number
    headerHeight?: number
    padding: { top: number; right: number; bottom: number; left: number }
  }[]
  /** Label dimensions include the occupied painted body. Its own shaft is
   * masked by that body; foreign routes must stay outside it. Loop expansion
   * reserves additional space beside the arc instead of masking its shaft. */
  edges: readonly { source: number; target: number; minSpan: number; short?: true; boundaryMarker?: { inset: number; height: number }; markerPaint?: MarkerPaint; visible?: boolean; label?: { width: number; height: number } }[]
  direction: Direction
  padding: number
  nodeSpacing: number
  layerSpacing: number
  edgeSpacing?: number
  /** Actual endpoint artwork lead reserved independently of peer-obstacle clearance. */
  minimumTerminalLead?: number
  /** Actual maximum painted edge stroke, supplied by the producer. Absence keeps legacy routing. */
  maximumEdgeStrokeWidth?: number
  maximumEdgeBendRadius?: number
  /** Private source-port separation constraints introduced by loop expansion. */
  loopPorts?: readonly (readonly [number, number])[]
  /** Adapter permits confluent routing only for compatible plain fans. */
  shareCompleteFans?: boolean
  /** Private single-candidate refinement; authored arrow direction is restored. */
  authoredCycleOrder?: boolean
  /** Optional compact candidate: only labelled links need an extra private rank. */
  compactPrivateRanks?: boolean
  /** Private acyclic projection; its parent restores authored cycle directions. */
  cycleOriented?: true
  /** Internal family contract: retain placement constraints, omit final routes.
   * This flag participates in the measured-geometry cache key. */
  placementOnly?: true
}

export interface AgenticLayout {
  topology: 'forest' | 'layered'
  /** Authored edges whose producer explicitly owns shared routing. */
  sharedEdges?: readonly number[]
  width: number
  height: number
  nodes: { x: number; y: number }[]
  groups?: { x: number; y: number; width: number; height: number }[]
  /** Private aggregate work accounting for nested scope expansion. */
  expandedVertices?: number
  /** Routes whose frame/header corridors must survive raw shortcutting. */
  boundaryRoutes?: readonly number[]
  edges: { points: Point[]; labelPosition?: Point }[]
}

interface Vertex {
  rank: number
  crossSize: number
  mainSize: number
  incoming: number[]
  outgoing: number[]
}

export { MAX_EXPANDED_VERTICES }
const SWEEP_PAIRS = 4
const LABEL_GAP = 8

function finiteSize(value: number, positive: boolean): boolean {
  return Number.isFinite(value) && (positive ? value > 0 : value >= 0)
}

/**
 * Measured layered layout, independent of ELK's schema and runtime. Longest-path
 * ranks are expanded into private channel/label vertices. Stable barycenter
 * sweeps order the ranks; orthogonal routes stay inside the reserved channels
 * and inter-rank gaps. Cycles reverse private constraints and restore authored
 * route directions. Authored arrays and their edge order are never changed.
 */
// The adapters supply the shared forest fast path and typed decline. Keeping
// those bindings outside this module lets the browser fetch one private solver
// chunk without splitting shared family code into more startup requests.
export function layoutLayeredGraph(
  input: MeasuredGraph,
  forestLayout: (input: MeasuredGraph) => AgenticLayout | undefined,
  unsupported: (reason: string) => never,
  routingWork: ChannelWork = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 },
  searchWork: LayoutSearchWork = { attempts: 128, scorePairs: 8_000_000, loopPairs: 2_000_000, rankPairs: 200_000, blockPairs: 2_000_000, routing: { pairs: 500_000, arcs: 32768, swaps: 500_000 } },
): AgenticLayout {
  const { nodes, edges, padding, nodeSpacing, layerSpacing } = input
  if (nodes.length > MAX_NODES || edges.length > MAX_EDGES) unsupported('agentic local graph-size limit')
  if (![padding, nodeSpacing, layerSpacing].every(value => finiteSize(value, false))) {
    throw new TypeError('Measured graph spacing must be finite and nonnegative')
  }
  if (input.edgeSpacing !== undefined && !finiteSize(input.edgeSpacing, true)) throw new TypeError('Measured edge spacing must be finite and positive')
  if (input.minimumTerminalLead !== undefined && !finiteSize(input.minimumTerminalLead, true)) throw new TypeError('Measured terminal lead must be finite and positive')
  if (input.maximumEdgeStrokeWidth !== undefined && !finiteSize(input.maximumEdgeStrokeWidth, true)) throw new TypeError('Measured maximum edge stroke width must be finite and positive')
  if (input.maximumEdgeBendRadius !== undefined && !finiteSize(input.maximumEdgeBendRadius,false)) throw new TypeError('Invalid measured edge bend radius')
  for (const node of input.nodes) if (node.paintStrokeWidth !== undefined && !finiteSize(node.paintStrokeWidth,true)) throw new TypeError('Invalid measured node paint stroke')
  for (const node of input.nodes) if (node.paintCornerRadius !== undefined && !finiteSize(node.paintCornerRadius,false)) throw new TypeError('Invalid measured node corner radius')
  for (const node of input.nodes) if (node.minimumPortSpacing !== undefined && !finiteSize(node.minimumPortSpacing,true)) throw new TypeError('Invalid measured node port spacing')
  for (const group of input.groups ?? []) if (group.paintStrokeWidth !== undefined && !finiteSize(group.paintStrokeWidth,true)) throw new TypeError('Invalid measured group paint stroke')
  for (const group of input.groups ?? []) if (group.paintCornerRadius !== undefined && !finiteSize(group.paintCornerRadius,false)) throw new TypeError('Invalid measured group corner radius')
  for (const edge of input.edges) if (edge.markerPaint !== undefined) assertMarkerPaint(edge.markerPaint)
  if (!['TD', 'TB', 'BT', 'LR', 'RL'].includes(input.direction)) throw new TypeError('Invalid measured graph direction')
  if (input.groups?.length) {
    if (nodes.length + input.groups.length > MAX_NODES) unsupported('agentic local compound-size limit')
    return layoutCompoundGraph(input, flat => layoutLayeredGraph(flat, forestLayout, unsupported, routingWork, searchWork), unsupported, MAX_EXPANDED_VERTICES, routingWork)
  }
  const horizontal = input.direction === 'LR' || input.direction === 'RL'
  const reverse = input.direction === 'BT' || input.direction === 'RL'
  const ids = new Set<string>()
  let hasModelOrder = false
  for (const node of nodes) {
    if (node.parent !== undefined) throw new TypeError('Measured parent requires a compound scope')
    if (node.modelOrder !== undefined) {
      if (!Number.isSafeInteger(node.modelOrder) || node.modelOrder < 0) throw new TypeError('Invalid measured model order')
      hasModelOrder = true
    }
    if (node.partition !== undefined && (!Number.isSafeInteger(node.partition) || node.partition < 0 || node.partition > 10000)) throw new TypeError('Invalid measured partition')
    if (ids.has(node.id)) throw new TypeError('Measured graph node identities must be unique')
    ids.add(node.id)
    if (!finiteSize(node.width, true) || !finiteSize(node.height, true)) throw new TypeError('Measured node dimensions must be finite and positive')
  }
  const incoming: number[][] = nodes.map(() => [])
  const outgoing: number[][] = nodes.map(() => [])
  const indegree = new Uint32Array(nodes.length)
  let hasLoops = false, hasShortEdges = false
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index]!
    if (!Number.isInteger(edge.source) || !Number.isInteger(edge.target)
      || edge.source < 0 || edge.source >= nodes.length || edge.target < 0 || edge.target >= nodes.length) {
      throw new TypeError('Measured edge endpoint is outside the node array')
    }
    if (!Number.isSafeInteger(edge.minSpan) || edge.minSpan < 1) throw new TypeError('Measured edge minimum span must be a positive integer')
    if (edge.short !== undefined && edge.short !== true) throw new TypeError('Invalid measured short-edge preference')
    if (edge.boundaryMarker !== undefined && (![edge.boundaryMarker.inset, edge.boundaryMarker.height].every(value => Number.isFinite(value) && value >= 0))) throw new TypeError('Invalid measured ancestor marker dimensions')
    hasShortEdges ||= edge.short === true
    if (edge.label && (!finiteSize(edge.label.width, false) || !finiteSize(edge.label.height, false))) {
      throw new TypeError('Measured edge label dimensions must be finite and nonnegative')
    }
    if (edge.source === edge.target) {
      hasLoops = true; continue
    }
    outgoing[edge.source]!.push(index)
    incoming[edge.target]!.push(index)
    indegree[edge.target] = indegree[edge.target]! + 1
  }

  const partitioned = nodes.some(node => (node.partition ?? 0) !== (nodes[0]?.partition ?? 0))
  if (partitioned && edges.some(edge => (nodes[edge.source]!.partition ?? 0) > (nodes[edge.target]!.partition ?? 0))) {
    // Partitions constrain placement, not authored arrow direction. Orient only
    // the private placement graph, then restore each authored route occurrence.
    const reversed = edges.map(edge => (nodes[edge.source]!.partition ?? 0) > (nodes[edge.target]!.partition ?? 0))
    const placed = layoutLayeredGraph({ ...input, edges: edges.map((edge, index) => reversed[index]
      ? { ...edge, source: edge.target, target: edge.source } : edge) }, forestLayout, unsupported, routingWork, searchWork)
    return { ...placed, edges: placed.edges.map((edge, index) => reversed[index] ? { ...edge, points: [...edge.points].reverse() } : edge) }
  }

  if (hasLoops) {
    // A private turnaround box reserves space before placement. Two separately
    // ported spokes form the loop, and only its outward spoke owns the label.
    // Strip every helper before returning authored node/edge arrays.
    const expandedNodes = [...nodes], expandedEdges = [...edges]
    const loopPorts = [...(input.loopPorts ?? [])]
    const returns = new Int32Array(edges.length).fill(-1)
    let helperId = 0
    for (let index = 0; index < edges.length; index++) {
      const edge = edges[index]!
      if (edge.source !== edge.target) continue
      if (expandedNodes.length === MAX_NODES || expandedEdges.length === MAX_EDGES) unsupported('agentic local loop-expansion limit')
      let id: string
      do { id = `\0agentic-loop:${helperId++}` } while (ids.has(id))
      ids.add(id)
      const target = expandedNodes.length
      expandedNodes.push({ id, width: horizontal ? 1 : 40, height: horizontal ? 40 : 1, ...(partitioned ? { partition: nodes[edge.source]!.partition ?? 0 } : {}) })
      expandedEdges[index] = { ...edge, target, ...(edge.label ? { label: horizontal
        ? { width: edge.label.width, height: 2 * edge.label.height + 8 }
        : { width: 2 * edge.label.width + 8, height: edge.label.height } } : {}) }
      returns[index] = expandedEdges.length
      loopPorts.push([index, expandedEdges.length])
      expandedEdges.push({ source: edge.source, target, minSpan: edge.minSpan })
    }
    const placed = layoutLayeredGraph({ ...input, nodes: expandedNodes, edges: expandedEdges, loopPorts }, forestLayout, unsupported, routingWork, searchWork)
    const projected: AgenticLayout = { ...placed, topology: 'layered', nodes: placed.nodes.slice(0, nodes.length), edges: placed.edges.slice(0, edges.length).map((route, index) => {
      const back = returns[index]!
      if (back < 0) return route
      const returning = placed.edges[back]!.points
      let labelPosition = route.labelPosition
      if (labelPosition && edges[index]!.label) {
        const main = horizontal ? labelPosition.x : labelPosition.y, cross = horizontal ? labelPosition.y : labelPosition.x
        let side = -1
        for (let cursor = 1; cursor < returning.length; cursor++) {
          const a = returning[cursor - 1]!, b = returning[cursor]!
          const am = horizontal ? a.x : a.y, bm = horizontal ? b.x : b.y
          const ac = horizontal ? a.y : a.x, bc = horizontal ? b.y : b.x
          if (ac === bc && main >= Math.min(am, bm) && main <= Math.max(am, bm)) { side = cross < ac ? -1 : 1; break }
        }
        const distance = ((horizontal ? edges[index]!.label!.height : edges[index]!.label!.width) / 2 + 4) * side
        labelPosition = horizontal ? { x: labelPosition.x, y: labelPosition.y + distance } : { x: labelPosition.x + distance, y: labelPosition.y }
      }
      return { ...route, ...(labelPosition ? { labelPosition } : {}), points: route.points.concat([...returning].reverse()) }
    }) }
    return compactMeasuredLoops(input, projected, searchWork)
  }

  const shared = !partitioned && !hasModelOrder && !hasShortEdges && layoutSharedFan(input, incoming, outgoing, unsupported)
  if (shared) return shared
  const forest = !partitioned && !hasModelOrder && !hasShortEdges && forestLayout(input)
  if (forest) return { ...forest, expandedVertices: nodes.length }

  // The default reserves two private ranks per span. The optional compact
  // policy reserves the extra rank only for measured labels.
  const rank = new Uint32Array(nodes.length)
  const queue = nodes.flatMap((_, index) => indegree[index] === 0 ? [index] : [])
  let maxRank = 0
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor]!
    for (const edgeIndex of outgoing[source]!) {
      const edge = edges[edgeIndex]!
      const next = rank[source]! + privateRankSpan(edge, input.compactPrivateRanks)
      if (next >= MAX_RANKS) unsupported('agentic local rank-expansion limit')
      rank[edge.target] = Math.max(rank[edge.target]!, next)
      maxRank = Math.max(maxRank, next)
      indegree[edge.target] = indegree[edge.target]! - 1
      if (indegree[edge.target] === 0) queue.push(edge.target)
    }
  }
  if (queue.length !== nodes.length) {
    if (partitioned) {
      // Cross-partition links already point forward. A total private order
      // inside each partition breaks its cycles without reversing that order.
      const order = input.authoredCycleOrder ? Uint32Array.from(nodes, (_, index) => index) : feedbackOrder(incoming, outgoing, edges)
      const reversed = edges.map(edge => (nodes[edge.source]!.partition ?? 0) === (nodes[edge.target]!.partition ?? 0) && order[edge.source]! > order[edge.target]!)
      const placed = layoutLayeredGraph({ ...input, cycleOriented: true, edges: edges.map((edge, index) => reversed[index]
        ? { ...edge, source: edge.target, target: edge.source } : edge) }, forestLayout, unsupported, routingWork, searchWork)
      return { ...placed, edges: placed.edges.map((edge, index) => reversed[index] ? { ...edge, points: [...edge.points].reverse() } : edge) }
    }
    return layoutCyclicGraph(input, incoming, outgoing,
      (flat, fail, work) => layoutLayeredGraph(flat, forestLayout, fail, work, searchWork),
      unsupported, routingWork, searchWork)
  }
  const incomingWeight = hasShortEdges ? new Uint32Array(nodes.length) : undefined
  const outgoingWeight = hasShortEdges ? new Uint32Array(nodes.length) : undefined
  if (hasShortEdges) for (const edge of edges) {
    const weight = edge.short ? 100 : 1
    incomingWeight![edge.target] = incomingWeight![edge.target]! + weight
    outgoingWeight![edge.source] = outgoingWeight![edge.source]! + weight
  }
  // Move a vertex to a feasible bound that cannot increase total edge span.
  // Equal-degree moves favor the later bound; the fixed sweep limit keeps
  // this compaction deterministic even when several equally short ranks exist.
  for (let sweep = 0; !partitioned && sweep < 4; sweep++) {
    let changed = false
    for (const reverse of [true, false]) {
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const id = queue[reverse ? queue.length - 1 - cursor : cursor]!
        let lower = 0, upper = maxRank
        for (const index of incoming[id]!) { const edge = edges[index]!; lower = Math.max(lower, rank[edge.source]! + privateRankSpan(edge, input.compactPrivateRanks)) }
        for (const index of outgoing[id]!) { const edge = edges[index]!; upper = Math.min(upper, rank[edge.target]! - privateRankSpan(edge, input.compactPrivateRanks)) }
        const later = hasShortEdges ? outgoingWeight![id]! >= incomingWeight![id]! : outgoing[id]!.length >= incoming[id]!.length
        const next = outgoing[id]!.length && later ? upper : lower
        if (next !== rank[id]) { rank[id] = next; changed = true }
      }
    }
    if (!changed) break
  }
  if (partitioned) {
    // Compress numeric partitions to their authored order. Empty partition
    // numbers consume no ranks; consecutive blocks share no placement layer.
    const blocks = new Map<number, number[]>()
    for (const index of queue) {
      const partition = nodes[index]!.partition ?? 0
      const block = blocks.get(partition) ?? []
      block.push(index); blocks.set(partition, block)
    }
    let floor = 0
    for (const partition of [...blocks.keys()].sort((a, b) => a - b)) {
      let last = floor
      for (const index of blocks.get(partition)!) {
        let next = floor
        for (const edgeIndex of incoming[index]!) {
          const edge = edges[edgeIndex]!
          next = Math.max(next, rank[edge.source]! + privateRankSpan(edge, input.compactPrivateRanks))
        }
        if (next >= MAX_RANKS) unsupported('agentic local rank-expansion limit')
        rank[index] = next
        last = Math.max(last, next)
      }
      floor = last + 1
    }
  }
  if (partitioned && hasShortEdges) {
    const windows = new Map<number, { lower: number; upper: number }>()
    for (const [index, node] of nodes.entries()) {
      const partition = node.partition ?? 0, window = windows.get(partition)
      if (window) { window.lower = Math.min(window.lower, rank[index]!); window.upper = Math.max(window.upper, rank[index]!) }
      else windows.set(partition, { lower: rank[index]!, upper: rank[index]! })
    }
    for (let sweep = 0; sweep < 4; sweep++) {
      let changed = false
      for (const reverse of [true, false]) for (let cursor = 0; cursor < queue.length; cursor++) {
        const id = queue[reverse ? queue.length - 1 - cursor : cursor]!, window = windows.get(nodes[id]!.partition ?? 0)!
        let lower = window.lower, upper = window.upper
        for (const index of incoming[id]!) { const edge = edges[index]!; lower = Math.max(lower, rank[edge.source]! + privateRankSpan(edge, input.compactPrivateRanks)) }
        for (const index of outgoing[id]!) { const edge = edges[index]!; upper = Math.min(upper, rank[edge.target]! - privateRankSpan(edge, input.compactPrivateRanks)) }
        const next = outgoing[id]!.length && outgoingWeight![id]! >= incomingWeight![id]! ? upper : lower
        if (next !== rank[id]) { rank[id] = next; changed = true }
      }
      if (!changed) break
    }
  }
  const optimalRanks = !partitioned && minimumSpanRanks(input, searchWork, hasShortEdges)
  if (optimalRanks) rank.set(optimalRanks)
  maxRank = rank.reduce((maximum, value) => Math.max(maximum, value), 0)
  let expandedSize = nodes.length
  for (const edge of edges) {
    expandedSize += rank[edge.target]! - rank[edge.source]! - 1
    if (expandedSize > MAX_EXPANDED_VERTICES) unsupported('agentic local expanded-graph limit')
  }
  if (nodes.length === 0) {
    if (!Number.isFinite(2 * padding)) unsupported('agentic local coordinate-range limit')
    return { topology: 'layered', width: 2 * padding, height: 2 * padding, nodes: [], edges: [], expandedVertices: 0 }
  }

  const vertices: Vertex[] = nodes.map((node, index) => ({
    rank: rank[index]!, crossSize: horizontal ? node.height : node.width,
    mainSize: horizontal ? node.width : node.height, incoming: [], outgoing: [],
  }))
  const chains: number[][] = []
  const labelVertices: (number | undefined)[] = []
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
    const edge = edges[edgeIndex]!
    const chain = [edge.source]
    const labelRank = edge.label ? Math.floor((rank[edge.source]! + rank[edge.target]!) / 2) : -1
    for (let currentRank = rank[edge.source]! + 1; currentRank < rank[edge.target]!; currentRank++) {
      const label = currentRank === labelRank
      const index = vertices.length
      vertices.push({
        rank: currentRank,
        crossSize: label ? (horizontal ? edge.label!.height : edge.label!.width) + 2 * LABEL_GAP : 4,
        mainSize: label ? (horizontal ? edge.label!.width : edge.label!.height) : 0,
        incoming: [], outgoing: [],
      })
      if (label) labelVertices[edgeIndex] = index
      chain.push(index)
    }
    chain.push(edge.target)
    for (let index = 1; index < chain.length; index++) {
      const source = chain[index - 1]!, target = chain[index]!
      vertices[source]!.outgoing.push(target)
      vertices[target]!.incoming.push(source)
    }
    chains.push(chain)
  }

  const bands: number[][] = Array.from({ length: maxRank + 1 }, () => [])
  const bandWidths = new Float64Array(bands.length)
  const bandHeights = new Float64Array(bands.length)
  for (let index = 0; index < vertices.length; index++) bands[vertices[index]!.rank]!.push(index)
  const preserveModelOrder = hasModelOrder ? (band: number[]): void => {
    const ordered = band.filter(index => nodes[index]?.modelOrder !== undefined)
    ordered.sort((a, b) => nodes[a]!.modelOrder! - nodes[b]!.modelOrder!)
    let cursor = 0
    for (let index = 0; index < band.length; index++) if (nodes[band[index]!]?.modelOrder !== undefined) band[index] = ordered[cursor++]!
  } : undefined
  if (preserveModelOrder) for (const band of bands) preserveModelOrder(band)
  let crossExtent = 0
  for (let index = 0; index < bands.length; index++) {
    const band = bands[index]!
    let width = Math.max(0, band.length - 1) * nodeSpacing
    for (const vertexIndex of band) {
      const vertex = vertices[vertexIndex]!
      width += vertex.crossSize
      bandHeights[index] = Math.max(bandHeights[index]!, vertex.mainSize)
    }
    bandWidths[index] = width
    crossExtent = Math.max(crossExtent, width)
  }
  const cross = new Float64Array(vertices.length)
  const assignBand = (index: number): void => {
    let start = (crossExtent - bandWidths[index]!) / 2
    const band = bands[index]!
    for (let slot = 0; slot < band.length; slot++) {
      const vertexIndex = band[slot]!
      const width = vertices[vertexIndex]!.crossSize
      cross[vertexIndex] = start + width / 2
      start += width + nodeSpacing
    }
  }
  for (let index = 0; index < bands.length; index++) assignBand(index)
  const barycenters = new Float64Array(vertices.length)
  const reorder = (index: number, forward: boolean): void => {
    const band = bands[index]!
    let finite = true
    for (let slot = 0; slot < band.length; slot++) {
      const vertexIndex = band[slot]!
      const neighbors = forward ? vertices[vertexIndex]!.incoming : vertices[vertexIndex]!.outgoing
      let sum = 0
      for (let neighbor = 0; neighbor < neighbors.length; neighbor++) sum += cross[neighbors[neighbor]!]!
      const value = neighbors.length ? sum / neighbors.length : cross[vertexIndex]!
      barycenters[vertexIndex] = value
      finite &&= Number.isFinite(value)
    }
    if (band.length <= 16 && finite) {
      // At most 120 comparisons, with the exact barycenter/identity order.
      for (let slot = 1; slot < band.length; slot++) {
        const vertex = band[slot]!, value = barycenters[vertex]!
        let cursor = slot
        while (cursor > 0) {
          const previous = band[cursor - 1]!
          if ((barycenters[previous]! - value || previous - vertex) <= 0) break
          band[cursor--] = previous
        }
        band[cursor] = vertex
      }
    } else band.sort((a, b) => barycenters[a]! - barycenters[b]! || a - b)
    preserveModelOrder?.(band)
    assignBand(index)
  }
  const orderSlots = new Uint32Array(vertices.length)
  // Rank cardinalities stay fixed throughout ordering. Reuse zeroed score
  // trees instead of allocating them for every bounded search proposal.
  const crossingTrees = bands.slice(1).map(band => new Uint32Array(band.length + 1))
  const refreshOrderSlots = (): void => {
    for (let rank = 0; rank < bands.length; rank++) {
      const band = bands[rank]!
      for (let slot = 0; slot < band.length; slot++) orderSlots[band[slot]!] = slot
    }
  }
  const crossingScore = (): number => {
    refreshOrderSlots()
    let score = 0
    for (let rank = 0; rank + 1 < bands.length; rank++) {
      const tree = crossingTrees[rank]!
      tree.fill(0)
      let seen = 0
      const band = bands[rank]!
      for (let slot = 0; slot < band.length; slot++) {
        const targets = vertices[band[slot]!]!.outgoing
        for (let edge = 0; edge < targets.length; edge++) {
          const target = targets[edge]!
          let before = 0
          for (let index = orderSlots[target]! + 1; index > 0; index -= index & -index) before += tree[index]!
          score += seen - before
        }
        // A source's own fan is ordered at its ports and does not cross itself.
        for (let edge = 0; edge < targets.length; edge++) {
          for (let index = orderSlots[targets[edge]!]! + 1; index < tree.length; index += index & -index) tree[index] = tree[index]! + 1
        }
        seen += targets.length
      }
    }
    return score
  }
  let bestScore = crossingScore(), bestBands = bands.map(band => [...band])
  const rememberOrder = (): void => {
    const score = crossingScore()
    if (score < bestScore) { bestScore = score; bestBands = bands.map(band => [...band]) }
  }
  for (let sweep = 0; sweep < SWEEP_PAIRS; sweep++) {
    for (let index = 1; index < bands.length; index++) reorder(index, true)
    rememberOrder()
    for (let index = bands.length - 2; index >= 0; index--) reorder(index, false)
    rememberOrder()
  }
  bestBands.forEach((band, index) => { bands[index] = band; band.forEach((vertex, slot) => { orderSlots[vertex] = slot }) })
  // Adjacent switching reduces the exact two-layer inversion score. Charge
  // every neighbor comparison; budget exhaustion stops optional refinement.
  const switchAdjacentRanks = (): void => {
    refreshOrderSlots()
    for (let sweep = 0; sweep < 4; sweep++) {
      let changed = false
      for (let rank = 0; rank < bands.length; rank++) {
        const band = bands[rank]!
        for (let index = 0; index + 1 < band.length; index++) {
          if (hasModelOrder && nodes[band[index]!]?.modelOrder !== undefined && nodes[band[index + 1]!]?.modelOrder !== undefined) continue
          const a = vertices[band[index]!]!, b = vertices[band[index + 1]!]!
          const cost = a.incoming.length * b.incoming.length + a.outgoing.length * b.outgoing.length
          if (cost > routingWork.swaps) continue
          routingWork.swaps -= cost
          let reduction = 0
          for (let left = 0; left < a.incoming.length; left++) for (let right = 0; right < b.incoming.length; right++)
            reduction += Math.sign(orderSlots[a.incoming[left]!]! - orderSlots[b.incoming[right]!]!)
          for (let left = 0; left < a.outgoing.length; left++) for (let right = 0; right < b.outgoing.length; right++)
            reduction += Math.sign(orderSlots[a.outgoing[left]!]! - orderSlots[b.outgoing[right]!]!)
          if (reduction > 0) {
            const first = band[index]!, second = band[index + 1]!
            band[index] = second; band[index + 1] = first
            orderSlots[first] = index + 1; orderSlots[second] = index; changed = true
          }
        }
      }
      if (!changed) break
    }
  }
  switchAdjacentRanks()
  // Move a long edge's private vertices together. Single-rank switches can
  // stall when their temporary crossings conceal an improving joint move.
  if (input.compactPrivateRanks && nodes.length <= 20 && edges.length <= 64 && vertices.length <= 256) {
    let value = crossingScore(), trials = 128
    const blocks = chains.map(chain => chain.slice(1, -1)).filter(block => block.length > 1).sort((a, b) => b.length - a.length)
    for (const block of blocks) {
      if (value === 0) break
      const saved = new Map(block.map(id => [vertices[id]!.rank, [...bands[vertices[id]!.rank]!]]))
      let best = value, bestOrders: Map<number, number[]> | undefined, exhausted = false
      for (const fraction of [0, 1, .25, .5, .75]) {
        // Each expanded arc has at most eight Fenwick steps per query/update.
        const cost = bands.length + vertices.length + 16 * (vertices.length - nodes.length + edges.length)
        if (trials-- <= 0 || (searchWork.blockPairs ?? 2_000_000) < cost) { exhausted = true; break }
        searchWork.blockPairs = (searchWork.blockPairs ?? 2_000_000) - cost
        for (const id of block) {
          const rank = vertices[id]!.rank, band = bands[rank]!, original = saved.get(rank)!
          for (let index = 0; index < band.length; index++) band[index] = original[index]!
          const from = band.indexOf(id), to = Math.floor((band.length - 1) * fraction)
          if (from < to) for (let index = from; index < to; index++) band[index] = band[index + 1]!
          else for (let index = from; index > to; index--) band[index] = band[index - 1]!
          band[to] = id
        }
        const score = crossingScore()
        if (score < best) {
          best = score
          bestOrders = new Map([...saved].map(([rank]) => [rank, [...bands[rank]!]]))
        }
      }
      // Restore a completed best order before leaving, including exhaustion
      // halfway through a block's proposals. No partial proposal escapes.
      for (const [rank, band] of bestOrders ?? saved) bands[rank] = band
      value = best
      if (exhausted) break
    }
  }
  // Tiny cyclic graphs already enumerate every cycle-search start. Keep that
  // tuned policy: chain inversion gains there can add physical route bends.
  // Use chain insertion where larger graphs sample only a few cycle starts.
  if (input.compactPrivateRanks && nodes.length > 12 && nodes.length <= 20 && edges.length <= 64 && vertices.length <= 256) {
    refinePrivateChainOrder(bands, vertices, chains, searchWork)
  }
  // On a DAG, joint moves can make previously blocked local swaps improving
  // again. Keep the separately validated cycle-placement policy intact.
  if (input.compactPrivateRanks && !input.cycleOriented) switchAdjacentRanks()
  for (let index = 0; index < bands.length; index++) assignBand(index)

  // Median coordinate descent reduces adjacent-rank L1 span within the
  // existing band order. Real boxes retain their requested spacing even
  // when private channel or label vertices occur between them.
  const previousReal = new Int32Array(vertices.length).fill(-1), nextReal = new Int32Array(vertices.length).fill(-1)
  for (const band of bands) {
    let prior = -1
    for (const id of band) { previousReal[id] = prior; if (id < nodes.length) prior = id }
    prior = -1
    for (let cursor = band.length - 1; cursor >= 0; cursor--) { const id = band[cursor]!; nextReal[id] = prior; if (id < nodes.length) prior = id }
  }
  let medianScratch = new Float64Array(0)
  const coordinateGap = Math.min(4, nodeSpacing)
  for (let sweep = 0; sweep < 4; sweep++) for (const forward of [true, false]) {
    for (let row = 0; row < bands.length; row++) {
      const band = bands[forward ? row : bands.length - 1 - row]!
      for (let cursor = 0; cursor < band.length; cursor++) {
        const slot = forward ? cursor : band.length - 1 - cursor, id = band[slot]!, vertex = vertices[id]!
        const degree = vertex.incoming.length + vertex.outgoing.length
        if (!degree) continue
        let median: number
        if (degree <= 2) {
          // Most private chain vertices have two neighbors. Preserve the
          // directional lower/upper median without allocating or sorting.
          const firstNeighbor = vertex.incoming[0] ?? vertex.outgoing[0]!
          const secondNeighbor = degree === 1 ? firstNeighbor : vertex.incoming.length === 2
            ? vertex.incoming[1]! : vertex.outgoing[vertex.incoming.length === 1 ? 0 : 1]!
          const first = cross[firstNeighbor]!, second = cross[secondNeighbor]!
          median = forward ? Math.min(first, second) : Math.max(first, second)
        } else {
          if (medianScratch.length < degree) medianScratch = new Float64Array(degree)
          const peers = medianScratch.subarray(0, degree)
          let cursor = 0, numeric = true
          for (let neighbor = 0; neighbor < vertex.incoming.length; neighbor++) {
            const value = cross[vertex.incoming[neighbor]!]!
            peers[cursor++] = value; numeric &&= Number.isFinite(value) && !Object.is(value, -0)
          }
          for (let neighbor = 0; neighbor < vertex.outgoing.length; neighbor++) {
            const value = cross[vertex.outgoing[neighbor]!]!
            peers[cursor++] = value; numeric &&= Number.isFinite(value) && !Object.is(value, -0)
          }
          // Typed sorting treats signed zero and non-finite ties differently.
          const sorted = numeric ? peers.sort() : Array.from(peers).sort((a,b)=>a-b)
          median = sorted[Math.floor((degree - Number(forward)) / 2)]!
        }
        const before = band[slot - 1], after = band[slot + 1]
        let lo = before === undefined ? vertex.crossSize / 2 : cross[before]! + (vertices[before]!.crossSize + vertex.crossSize) / 2 + coordinateGap
        let hi = after === undefined ? crossExtent - vertex.crossSize / 2 : cross[after]! - (vertices[after]!.crossSize + vertex.crossSize) / 2 - coordinateGap
        if (id < nodes.length) {
          const previous = previousReal[id]!, next = nextReal[id]!
          if (previous >= 0) lo = Math.max(lo, cross[previous]! + (vertices[previous]!.crossSize + vertex.crossSize) / 2 + nodeSpacing)
          if (next >= 0) hi = Math.min(hi, cross[next]! - (vertices[next]!.crossSize + vertex.crossSize) / 2 - nodeSpacing)
        }
        if (lo <= hi) cross[id] = Math.max(lo, Math.min(hi, median))
      }
    }
  }

  // Compact long private channels into constant lanes where their ordered
  // free intervals intersect. This pass keeps boxes and band order fixed. Without
  // this, unequal band widths make a long edge zigzag at every private rank.
  const slots = new Uint32Array(vertices.length)
  for (const band of bands) band.forEach((vertex, index) => { slots[vertex] = index })
  const gap = Math.min(4, nodeSpacing)
  for (const chain of chains) {
    if (chain.length < 4) continue
    let start = 1
    while (start < chain.length - 1) {
      let lower = -Infinity, upper = Infinity, end = start
      while (end < chain.length - 1) {
        const id = chain[end]!, vertex = vertices[id]!, band = bands[vertex.rank]!, slot = slots[id]!
        const before = band[slot - 1], after = band[slot + 1]
        const lo = before === undefined ? vertex.crossSize / 2 : cross[before]! + (vertices[before]!.crossSize + vertex.crossSize) / 2 + gap
        const hi = after === undefined ? crossExtent - vertex.crossSize / 2 : cross[after]! - (vertices[after]!.crossSize + vertex.crossSize) / 2 - gap
        const nextLower = Math.max(lower, lo), nextUpper = Math.min(upper, hi)
        if (nextLower > nextUpper) break
        lower = nextLower; upper = nextUpper; end++
      }
      if (end > start + 1) {
        const desired = (cross[chain[start - 1]!]! + cross[chain[end]!]!) / 2
        const lane = Math.max(lower, Math.min(upper, desired))
        for (let index = start; index < end; index++) cross[chain[index]!] = lane
      }
      start = Math.max(start + 1, end)
    }
  }

  // Distinct authored edges receive distinct ports, including duplicate edges.
  const sourcePort = new Float64Array(edges.length), targetPort = new Float64Array(edges.length)
  const pairedPorts = new Map<number, (readonly [number, number])[]>()
  for (const pair of input.loopPorts ?? []) {
    const a = edges[pair[0]], b = edges[pair[1]]
    if (!a || !b || a.source !== b.source) throw new TypeError('Invalid measured loop port pair')
    const pairs = pairedPorts.get(a.source) ?? []
    pairs.push(pair); pairedPorts.set(a.source, pairs)
  }
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const width = vertices[nodeIndex]!.crossSize
    const assignPorts = (indices: number[], source: boolean): void => {
      const peers = [...indices].sort((a, b) => {
        const chainA = chains[a]!, chainB = chains[b]!
        const neighborA = source ? chainA[1]! : chainA[chainA.length - 2]!
        const neighborB = source ? chainB[1]! : chainB[chainB.length - 2]!
        return cross[neighborA]! - cross[neighborB]! || a - b
      })
      const pairs = source ? pairedPorts.get(nodeIndex) : undefined
      if (pairs?.length) {
        const slots = new Map(peers.map((edge, index) => [edge, index]))
        const constraints = pairs.map(([a, b]) => [Math.min(slots.get(a)!, slots.get(b)!), Math.max(slots.get(a)!, slots.get(b)!)] as const)
        if (constraints.some(([a, b]) => width * (b - a) / (peers.length + 1) < 8)) {
          const positions = new Float64Array(peers.length)
          const ends = new Map<number, number[]>()
          for (const [a, b] of constraints) { const starts = ends.get(b) ?? []; starts.push(a); ends.set(b, starts) }
          for (let index = 0; index < peers.length; index++) {
            positions[index] = index ? positions[index - 1]! + 2 : 0
            for (const start of ends.get(index) ?? []) positions[index] = Math.max(positions[index]!, positions[start]! + 8)
          }
          const margin = Math.min(8, width / 6)
          const slack = width - 2 * margin - (positions.at(-1) ?? 0)
          if (slack < 0) unsupported('agentic local loop-attachment capacity')
          peers.forEach((edge, index) => { sourcePort[edge] = cross[nodeIndex]! - width / 2 + margin + positions[index]! + slack * (index + 1) / (peers.length + 1) })
          return
        }
      }
      // Keep distinct ports in neighbor order, but use an available reserved
      // lane instead of adding a jog merely to reach a uniformly spaced port.
      // Dense sides retain the existing proportional spread; loop pairs keep
      // their separately proved attachment separation.
      if(nodes[nodeIndex]!.minimumPortSpacing!==undefined){routingWork.pairs-=3;if(routingWork.pairs<0)unsupported('agentic node port-spacing work limit')}
      const margin = Math.min(8, width / 6), separation = Math.max(8,nodes[nodeIndex]!.minimumPortSpacing??8)
      if (!pairs?.length && width - 2 * margin >= (peers.length - 1) * separation) {
        const left = cross[nodeIndex]! - width / 2 + margin, right = cross[nodeIndex]! + width / 2 - margin
        const positions = peers.map((edge, slot) => {
          const chain = chains[edge]!, neighbor = source ? chain[1]! : chain[chain.length - 2]!
          return Math.max(left + slot * separation, Math.min(right - (peers.length - 1 - slot) * separation, cross[neighbor]!))
        })
        for (let slot = 1; slot < positions.length; slot++) positions[slot] = Math.max(positions[slot]!, positions[slot - 1]! + separation)
        peers.forEach((edge, slot) => { (source ? sourcePort : targetPort)[edge] = positions[slot]! })
        return
      }
      for (let index = 0; index < peers.length; index++) {
        const position = cross[nodeIndex]! - width / 2 + width * (index + 1) / (peers.length + 1)
        ;(source ? sourcePort : targetPort)[peers[index]!] = position
      }
    }
    assignPorts(outgoing[nodeIndex]!, true)
    assignPorts(incoming[nodeIndex]!, false)
  }

  // Even zero requested spacing needs a channel in which a fan can turn.
  const halfGap = Math.max(4, layerSpacing / 2)
  const channels: ChannelStep[][] = Array.from({ length: maxRank }, () => [])
  const steps = chains.map((chain, edgeIndex) => chain.slice(1).map((to, index): ChannelStep => {
    const from = chain[index]!
    const step = { sourceCross: index === 0 ? sourcePort[edgeIndex]! : cross[from]!,
      targetCross: index === chain.length - 2 ? targetPort[edgeIndex]! : cross[to]!, offset: halfGap / 2, track: 0 }
    channels[vertices[from]!.rank]!.push(step)
    return step
  }))
  const gaps = channels.map(channel => {
    if (input.minimumTerminalLead !== undefined) { routingWork.pairs -= 3; if (routingWork.pairs < 0) unsupported('agentic terminal-lead work limit') }
    return assignChannelTracks(channel, halfGap, input.edgeSpacing ?? 6, crossExtent, routingWork, unsupported, input.minimumTerminalLead)
  })
  const main = new Float64Array(vertices.length)
  let mainExtent = 0
  for (let index = 0; index < bands.length; index++) {
    for (const vertexIndex of bands[index]!) main[vertexIndex] = mainExtent + bandHeights[index]! / 2
    mainExtent += bandHeights[index]! + (gaps[index] ?? 0)
  }
  if (!Number.isFinite(mainExtent + crossExtent + 2 * padding)) unsupported('agentic local coordinate-range limit')
  const point = (crossValue: number, mainValue: number): Point => {
    const orientedMain = padding + (reverse ? mainExtent - mainValue : mainValue)
    return horizontal ? { x: orientedMain, y: padding + crossValue } : { x: padding + crossValue, y: orientedMain }
  }

  // Node origins are the border authority used by the shape writer. Project
  // terminal faces from those same values instead of reassociating center/half
  // arithmetic, and carry each chosen cross coordinate through its lead.
  const positionedNodes = nodes.map((node, index) => {
    const center = point(cross[index]!, main[index]!)
    return { x: center.x - node.width / 2, y: center.y - node.height / 2 }
  })
  const portCross = (value: number, index: number): number => {
    const width = vertices[index]!.crossSize, margin = Math.min(8, width / 6)
    const origin = horizontal ? positionedNodes[index]!.y : positionedNodes[index]!.x
    if (value === cross[index]! - width / 2 + margin) return origin + margin
    if (value === cross[index]! + width / 2 - margin) return origin + width - margin
    return padding + value
  }
  const portMain = (index: number, source: boolean): number => {
    const node = positionedNodes[index]!, size = nodes[index]!
    return horizontal ? node.x + (source !== reverse ? size.width : 0) : node.y + (source !== reverse ? size.height : 0)
  }

  // Cycle selection and loop compaction still depend on temporary route
  // geometry. Ordinary acyclic placement needs channels/gaps but no point
  // arrays: the family will build the actual side-constrained routes.
  const positionedEdges = input.placementOnly && !input.cycleOriented && !input.loopPorts?.length
    ? edges.map(() => ({ points: [] as Point[] })) : edges.map((_, edgeIndex) => {
    const chain = chains[edgeIndex]!
    const points: Point[] = []
    const append = (crossValue: number, mainValue: number, projectedCross?: number, projectedMain?: number): void => {
      const next = point(crossValue, mainValue)
      if (projectedCross !== undefined) { if (horizontal) next.y = projectedCross; else next.x = projectedCross }
      if (projectedMain !== undefined) { if (horizontal) next.x = projectedMain; else next.y = projectedMain }
      const last = points.at(-1)
      if (last?.x === next.x && last.y === next.y) return
      const previous = points.at(-2)
      if (previous && last && ((previous.x === last.x && last.x === next.x && (last.y - previous.y) * (next.y - last.y) >= 0)
        || (previous.y === last.y && last.y === next.y && (last.x - previous.x) * (next.x - last.x) >= 0))) points.pop()
      points.push(next)
    }
    for (let index = 1; index < chain.length; index++) {
      const from = chain[index - 1]!, to = chain[index]!
      const step = steps[edgeIndex]![index - 1]!
      const startCross = step.sourceCross, endCross = step.targetCross
      const startMain = main[from]! + vertices[from]!.mainSize / 2
      const endMain = main[to]! - vertices[to]!.mainSize / 2
      const bandEnd = main[from]! + bandHeights[vertices[from]!.rank]! / 2
      const gapMain = bandEnd + step.offset
      const startProjectedCross = from < nodes.length ? portCross(startCross, from) : undefined
      const endProjectedCross = to < nodes.length ? portCross(endCross, to) : undefined
      append(startCross, startMain, startProjectedCross, from < nodes.length ? portMain(from, true) : undefined)
      append(startCross, gapMain, startProjectedCross)
      append(step.targetEscape ?? endCross, gapMain, step.targetEscape === undefined ? endProjectedCross : undefined)
      if (step.targetEscape !== undefined) {
        append(step.targetEscape, bandEnd + step.targetExit!)
        append(endCross, bandEnd + step.targetExit!, endProjectedCross)
      }
      append(endCross, endMain, endProjectedCross, to < nodes.length ? portMain(to, false) : undefined)
    }
    const labelIndex = labelVertices[edgeIndex]
    const labelPosition = labelIndex === undefined ? undefined : point(cross[labelIndex]!, main[labelIndex]!)
    return { points, ...(labelPosition ? { labelPosition } : {}) }
  })
  return {
    topology: 'layered',
    expandedVertices: vertices.length,
    width: 2 * padding + (horizontal ? mainExtent : crossExtent),
    height: 2 * padding + (horizontal ? crossExtent : mainExtent),
    nodes: positionedNodes,
    edges: positionedEdges,
  }
}
