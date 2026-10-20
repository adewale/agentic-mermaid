import type { Direction, Point } from '../types.ts'
import { layoutSharedFan } from './shared-fan-core.ts'
import { layoutCyclicGraph, type LayoutSearchWork } from './cycle-layout-search.ts'
import { layoutCompoundGraph } from './agentic-compound-core.ts'
import { assignChannelTracks, type ChannelStep, type ChannelWork } from './channel-tracks.ts'

export interface MeasuredGraph {
  nodes: readonly { id: string; width: number; height: number; parent?: number }[]
  /** Edges may address a frame at nodes.length + its group index. */
  groups?: readonly {
    id: string; parent?: number; direction?: Direction; minWidth: number
    padding: { top: number; right: number; bottom: number; left: number }
  }[]
  /** Label dimensions include the occupied painted body. Its own shaft is
   * masked by that body; foreign routes must stay outside it. Loop expansion
   * reserves additional space beside the arc instead of masking its shaft. */
  edges: readonly { source: number; target: number; minSpan: number; visible?: boolean; label?: { width: number; height: number } }[]
  direction: Direction
  padding: number
  nodeSpacing: number
  layerSpacing: number
  edgeSpacing?: number
  /** Private source-port separation constraints introduced by loop expansion. */
  loopPorts?: readonly (readonly [number, number])[]
  /** Adapter permits confluent routing only for compatible plain fans. */
  shareCompleteFans?: boolean
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
  edges: { points: Point[]; labelPosition?: Point }[]
}

interface Vertex {
  rank: number
  crossSize: number
  mainSize: number
  incoming: number[]
  outgoing: number[]
}

// These are local solver bounds, not a replacement for request admission.
const MAX_NODES = 4096
const MAX_EDGES = 16384
const MAX_RANKS = 4096
const MAX_EXPANDED_VERTICES = 32768
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
  searchWork: LayoutSearchWork = { attempts: 128, scorePairs: 8_000_000, routing: { pairs: 500_000, arcs: 32768, swaps: 500_000 } },
): AgenticLayout {
  const { nodes, edges, padding, nodeSpacing, layerSpacing } = input
  if (nodes.length > MAX_NODES || edges.length > MAX_EDGES) unsupported('agentic local graph-size limit')
  if (![padding, nodeSpacing, layerSpacing].every(value => finiteSize(value, false))) {
    throw new TypeError('Measured graph spacing must be finite and nonnegative')
  }
  if (input.edgeSpacing !== undefined && !finiteSize(input.edgeSpacing, true)) throw new TypeError('Measured edge spacing must be finite and positive')
  if (!['TD', 'TB', 'BT', 'LR', 'RL'].includes(input.direction)) throw new TypeError('Invalid measured graph direction')
  if (input.groups?.length) {
    if (nodes.length + input.groups.length > MAX_NODES) unsupported('agentic local compound-size limit')
    return layoutCompoundGraph(input, flat => layoutLayeredGraph(flat, forestLayout, unsupported, routingWork, searchWork), unsupported, MAX_EXPANDED_VERTICES)
  }
  const horizontal = input.direction === 'LR' || input.direction === 'RL'
  const reverse = input.direction === 'BT' || input.direction === 'RL'
  const ids = new Set<string>()
  for (const node of nodes) {
    if (node.parent !== undefined) throw new TypeError('Measured parent requires a compound scope')
    if (ids.has(node.id)) throw new TypeError('Measured graph node identities must be unique')
    ids.add(node.id)
    if (!finiteSize(node.width, true) || !finiteSize(node.height, true)) throw new TypeError('Measured node dimensions must be finite and positive')
  }
  const incoming: number[][] = nodes.map(() => [])
  const outgoing: number[][] = nodes.map(() => [])
  const indegree = new Uint32Array(nodes.length)
  let hasLoops = false
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index]!
    if (!Number.isInteger(edge.source) || !Number.isInteger(edge.target)
      || edge.source < 0 || edge.source >= nodes.length || edge.target < 0 || edge.target >= nodes.length) {
      throw new TypeError('Measured edge endpoint is outside the node array')
    }
    if (!Number.isSafeInteger(edge.minSpan) || edge.minSpan < 1) throw new TypeError('Measured edge minimum span must be a positive integer')
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
      expandedNodes.push({ id, width: horizontal ? 1 : 40, height: horizontal ? 40 : 1 })
      expandedEdges[index] = { ...edge, target, ...(edge.label ? { label: horizontal
        ? { width: edge.label.width, height: 2 * edge.label.height + 8 }
        : { width: 2 * edge.label.width + 8, height: edge.label.height } } : {}) }
      returns[index] = expandedEdges.length
      loopPorts.push([index, expandedEdges.length])
      expandedEdges.push({ source: edge.source, target, minSpan: edge.minSpan })
    }
    const placed = layoutLayeredGraph({ ...input, nodes: expandedNodes, edges: expandedEdges, loopPorts }, forestLayout, unsupported, routingWork, searchWork)
    return { ...placed, topology: 'layered', nodes: placed.nodes.slice(0, nodes.length), edges: placed.edges.slice(0, edges.length).map((route, index) => {
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
  }

  const shared = layoutSharedFan(input, incoming, outgoing, unsupported)
  if (shared) return shared
  const forest = forestLayout(input)
  if (forest) return { ...forest, expandedVertices: nodes.length }

  // Two private ranks per minimum span leave room for a measured edge label
  // even on an edge between adjacent authored ranks.
  const rank = new Uint32Array(nodes.length)
  const queue = nodes.flatMap((_, index) => indegree[index] === 0 ? [index] : [])
  let maxRank = 0
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const source = queue[cursor]!
    for (const edgeIndex of outgoing[source]!) {
      const edge = edges[edgeIndex]!
      const next = rank[source]! + 2 * edge.minSpan
      if (next >= MAX_RANKS) unsupported('agentic local rank-expansion limit')
      rank[edge.target] = Math.max(rank[edge.target]!, next)
      maxRank = Math.max(maxRank, next)
      indegree[edge.target] = indegree[edge.target]! - 1
      if (indegree[edge.target] === 0) queue.push(edge.target)
    }
  }
  if (queue.length !== nodes.length) {
    return layoutCyclicGraph(input, incoming, outgoing,
      (flat, fail, work) => layoutLayeredGraph(flat, forestLayout, fail, work, searchWork),
      unsupported, routingWork, searchWork)
  }
  // Move a vertex to a feasible bound that cannot increase total edge span.
  // Equal-degree moves favor the later bound; the fixed sweep limit keeps
  // this compaction deterministic even when several equally short ranks exist.
  for (let sweep = 0; sweep < 4; sweep++) {
    let changed = false
    for (const reverse of [true, false]) {
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const id = queue[reverse ? queue.length - 1 - cursor : cursor]!
        let lower = 0, upper = maxRank
        for (const index of incoming[id]!) { const edge = edges[index]!; lower = Math.max(lower, rank[edge.source]! + 2 * edge.minSpan) }
        for (const index of outgoing[id]!) { const edge = edges[index]!; upper = Math.min(upper, rank[edge.target]! - 2 * edge.minSpan) }
        const next = outgoing[id]!.length && outgoing[id]!.length >= incoming[id]!.length ? upper : lower
        if (next !== rank[id]) { rank[id] = next; changed = true }
      }
    }
    if (!changed) break
  }
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
    for (const vertexIndex of bands[index]!) {
      const width = vertices[vertexIndex]!.crossSize
      cross[vertexIndex] = start + width / 2
      start += width + nodeSpacing
    }
  }
  for (let index = 0; index < bands.length; index++) assignBand(index)
  const barycenters = new Float64Array(vertices.length)
  const reorder = (index: number, forward: boolean): void => {
    const band = bands[index]!
    for (const vertexIndex of band) {
      const neighbors = forward ? vertices[vertexIndex]!.incoming : vertices[vertexIndex]!.outgoing
      let sum = 0
      for (const neighbor of neighbors) sum += cross[neighbor]!
      barycenters[vertexIndex] = neighbors.length ? sum / neighbors.length : cross[vertexIndex]!
    }
    band.sort((a, b) => barycenters[a]! - barycenters[b]! || a - b)
    assignBand(index)
  }
  const orderSlots = new Uint32Array(vertices.length)
  const crossingScore = (): number => {
    for (const band of bands) band.forEach((vertex, index) => { orderSlots[vertex] = index })
    let score = 0
    for (let rank = 0; rank + 1 < bands.length; rank++) {
      const tree = new Uint32Array(bands[rank + 1]!.length + 1)
      let seen = 0
      for (const source of bands[rank]!) {
        const targets = vertices[source]!.outgoing
        for (const target of targets) {
          let before = 0
          for (let index = orderSlots[target]! + 1; index > 0; index -= index & -index) before += tree[index]!
          score += seen - before
        }
        // A source's own fan is ordered at its ports and does not cross itself.
        for (const target of targets) for (let index = orderSlots[target]! + 1; index < tree.length; index += index & -index) tree[index] = tree[index]! + 1
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
  for (let sweep = 0; sweep < 4; sweep++) {
    let changed = false
    for (let rank = 0; rank < bands.length; rank++) {
      const band = bands[rank]!
      for (let index = 0; index + 1 < band.length; index++) {
        const a = vertices[band[index]!]!, b = vertices[band[index + 1]!]!
        const cost = a.incoming.length * b.incoming.length + a.outgoing.length * b.outgoing.length
        if (cost > routingWork.swaps) continue
        routingWork.swaps -= cost
        let reduction = 0
        for (const [left, right] of [[a.incoming, b.incoming], [a.outgoing, b.outgoing]]) {
          for (const x of left!) for (const y of right!) reduction += Math.sign(orderSlots[x]! - orderSlots[y]!)
        }
        if (reduction > 0) {
          const first = band[index]!, second = band[index + 1]!
          band[index] = second; band[index + 1] = first
          orderSlots[first] = index + 1; orderSlots[second] = index; changed = true
        }
      }
    }
    if (!changed) break
  }
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
  const coordinateGap = Math.min(4, nodeSpacing)
  for (let sweep = 0; sweep < 4; sweep++) for (const forward of [true, false]) {
    for (let row = 0; row < bands.length; row++) {
      const band = bands[forward ? row : bands.length - 1 - row]!
      for (let cursor = 0; cursor < band.length; cursor++) {
        const slot = forward ? cursor : band.length - 1 - cursor, id = band[slot]!, vertex = vertices[id]!
        const peers = [...vertex.incoming, ...vertex.outgoing].map(peer => cross[peer]!).sort((a,b)=>a-b)
        if (!peers.length) continue
        const before = band[slot - 1], after = band[slot + 1]
        let lo = before === undefined ? vertex.crossSize / 2 : cross[before]! + (vertices[before]!.crossSize + vertex.crossSize) / 2 + coordinateGap
        let hi = after === undefined ? crossExtent - vertex.crossSize / 2 : cross[after]! - (vertices[after]!.crossSize + vertex.crossSize) / 2 - coordinateGap
        if (id < nodes.length) {
          const previous = previousReal[id]!, next = nextReal[id]!
          if (previous >= 0) lo = Math.max(lo, cross[previous]! + (vertices[previous]!.crossSize + vertex.crossSize) / 2 + nodeSpacing)
          if (next >= 0) hi = Math.min(hi, cross[next]! - (vertices[next]!.crossSize + vertex.crossSize) / 2 - nodeSpacing)
        }
        if (lo <= hi) cross[id] = Math.max(lo, Math.min(hi, peers[Math.floor((peers.length - Number(forward)) / 2)]!))
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
  const gaps = channels.map(channel => assignChannelTracks(channel, halfGap, input.edgeSpacing ?? 6, crossExtent, routingWork, unsupported))
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

  const positionedEdges = edges.map((_, edgeIndex) => {
    const chain = chains[edgeIndex]!
    const points: Point[] = []
    const append = (crossValue: number, mainValue: number): void => {
      const next = point(crossValue, mainValue)
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
      append(startCross, startMain)
      append(startCross, gapMain)
      append(step.targetEscape ?? endCross, gapMain)
      if (step.targetEscape !== undefined) {
        append(step.targetEscape, bandEnd + step.targetExit!)
        append(endCross, bandEnd + step.targetExit!)
      }
      append(endCross, endMain)
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
    nodes: nodes.map((node, index) => {
      const center = point(cross[index]!, main[index]!)
      return { x: center.x - node.width / 2, y: center.y - node.height / 2 }
    }),
    edges: positionedEdges,
  }
}
