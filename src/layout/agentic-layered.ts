import type { Direction, Point } from '../types.ts'
import { GraphLayoutUnsupportedError } from './backend.ts'
import { layoutMeasuredForest } from './measured-forest.ts'
import { feedbackOrder } from './cycle-order.ts'

export interface MeasuredGraph {
  nodes: readonly { id: string; width: number; height: number }[]
  edges: readonly { source: number; target: number; minSpan: number; label?: { width: number; height: number } }[]
  direction: Direction
  padding: number
  nodeSpacing: number
  layerSpacing: number
}

export interface AgenticLayout {
  topology: 'forest' | 'layered'
  width: number
  height: number
  nodes: { x: number; y: number }[]
  edges: { points: Point[]; labelPosition?: Point }[]
}

interface Vertex {
  rank: number
  crossSize: number
  mainSize: number
  incoming: number[]
  outgoing: number[]
  label: boolean
}

// These are local solver bounds, not a replacement for request admission.
const MAX_NODES = 4096
const MAX_EDGES = 16384
const MAX_RANKS = 4096
const MAX_EXPANDED_VERTICES = 32768
const SWEEP_PAIRS = 4
const LABEL_GAP = 8

function unsupported(reason: string): never {
  throw new GraphLayoutUnsupportedError(reason)
}

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
export function layoutAgenticGraph(input: MeasuredGraph): AgenticLayout {
  const { nodes, edges, padding, nodeSpacing, layerSpacing } = input
  if (nodes.length > MAX_NODES || edges.length > MAX_EDGES) unsupported('agentic local graph-size limit')
  if (![padding, nodeSpacing, layerSpacing].every(value => finiteSize(value, false))) {
    throw new TypeError('Measured graph spacing must be finite and nonnegative')
  }
  if (!['TD', 'TB', 'BT', 'LR', 'RL'].includes(input.direction)) throw new TypeError('Invalid measured graph direction')
  const horizontal = input.direction === 'LR' || input.direction === 'RL'
  const reverse = input.direction === 'BT' || input.direction === 'RL'
  const ids = new Set<string>()
  for (const node of nodes) {
    if (ids.has(node.id)) throw new TypeError('Measured graph node identities must be unique')
    ids.add(node.id)
    if (!finiteSize(node.width, true) || !finiteSize(node.height, true)) throw new TypeError('Measured node dimensions must be finite and positive')
  }
  const incoming: number[][] = nodes.map(() => [])
  const outgoing: number[][] = nodes.map(() => [])
  const indegree = new Uint32Array(nodes.length)
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
    if (edge.source === edge.target) unsupported('self-loops')
    outgoing[edge.source]!.push(index)
    incoming[edge.target]!.push(index)
    indegree[edge.target] = indegree[edge.target]! + 1
  }

  const forest = layoutMeasuredForest(input)
  if (forest) return forest

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
    const order = feedbackOrder(incoming, outgoing, edges)
    const reversed = edges.map(edge => order[edge.source]! > order[edge.target]!)
    const acyclic = edges.map((edge, index) => reversed[index] ? { ...edge, source: edge.target, target: edge.source } : edge)
    const placed = layoutAgenticGraph({ ...input, edges: acyclic })
    return { ...placed, edges: placed.edges.map((edge, index) => reversed[index] ? { ...edge, points: [...edge.points].reverse() } : edge) }
  }
  let expandedSize = nodes.length
  for (const edge of edges) {
    expandedSize += rank[edge.target]! - rank[edge.source]! - 1
    if (expandedSize > MAX_EXPANDED_VERTICES) unsupported('agentic local expanded-graph limit')
  }
  if (nodes.length === 0) {
    if (!Number.isFinite(2 * padding)) unsupported('agentic local coordinate-range limit')
    return { topology: 'layered', width: 2 * padding, height: 2 * padding, nodes: [], edges: [] }
  }

  const vertices: Vertex[] = nodes.map((node, index) => ({
    rank: rank[index]!, crossSize: horizontal ? node.height : node.width,
    mainSize: horizontal ? node.width : node.height, incoming: [], outgoing: [], label: false,
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
        incoming: [], outgoing: [], label,
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
  for (let sweep = 0; sweep < SWEEP_PAIRS; sweep++) {
    for (let index = 1; index < bands.length; index++) reorder(index, true)
    for (let index = bands.length - 2; index >= 0; index--) reorder(index, false)
  }

  const main = new Float64Array(vertices.length)
  let mainExtent = 0
  // Even zero requested spacing needs a channel in which a fan can turn.
  const halfGap = Math.max(4, layerSpacing / 2)
  for (let index = 0; index < bands.length; index++) {
    for (const vertexIndex of bands[index]!) main[vertexIndex] = mainExtent + bandHeights[index]! / 2
    mainExtent += bandHeights[index]! + (index + 1 < bands.length ? halfGap : 0)
  }
  if (!Number.isFinite(mainExtent + crossExtent + 2 * padding)) unsupported('agentic local coordinate-range limit')
  const point = (crossValue: number, mainValue: number): Point => {
    const orientedMain = padding + (reverse ? mainExtent - mainValue : mainValue)
    return horizontal ? { x: orientedMain, y: padding + crossValue } : { x: padding + crossValue, y: orientedMain }
  }
  const routeCross = (index: number): number => vertices[index]!.label
    ? cross[index]! - vertices[index]!.crossSize / 2 + LABEL_GAP / 2 : cross[index]!

  // Distinct authored edges receive distinct ports, including duplicate edges.
  const sourcePort = new Float64Array(edges.length), targetPort = new Float64Array(edges.length)
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const width = vertices[nodeIndex]!.crossSize
    const assignPorts = (indices: number[], source: boolean): void => {
      const peers = [...indices].sort((a, b) => {
        const chainA = chains[a]!, chainB = chains[b]!
        const neighborA = source ? chainA[1]! : chainA[chainA.length - 2]!
        const neighborB = source ? chainB[1]! : chainB[chainB.length - 2]!
        return routeCross(neighborA) - routeCross(neighborB) || a - b
      })
      for (let index = 0; index < peers.length; index++) {
        const position = cross[nodeIndex]! - width / 2 + width * (index + 1) / (peers.length + 1)
        ;(source ? sourcePort : targetPort)[peers[index]!] = position
      }
    }
    assignPorts(outgoing[nodeIndex]!, true)
    assignPorts(incoming[nodeIndex]!, false)
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
      const startCross = index === 1 ? sourcePort[edgeIndex]! : routeCross(from)
      const endCross = index === chain.length - 1 ? targetPort[edgeIndex]! : routeCross(to)
      const startMain = main[from]! + vertices[from]!.mainSize / 2
      const endMain = main[to]! - vertices[to]!.mainSize / 2
      const gapMain = (main[from]! + bandHeights[vertices[from]!.rank]! / 2
        + main[to]! - bandHeights[vertices[to]!.rank]! / 2) / 2
      append(startCross, startMain)
      append(startCross, gapMain)
      append(endCross, gapMain)
      append(endCross, endMain)
    }
    const labelIndex = labelVertices[edgeIndex]
    const labelPosition = labelIndex === undefined ? undefined : point(cross[labelIndex]! + LABEL_GAP / 2, main[labelIndex]!)
    return { points, ...(labelPosition ? { labelPosition } : {}) }
  })
  return {
    topology: 'layered',
    width: 2 * padding + (horizontal ? mainExtent : crossExtent),
    height: 2 * padding + (horizontal ? crossExtent : mainExtent),
    nodes: nodes.map((node, index) => {
      const center = point(cross[index]!, main[index]!)
      return { x: center.x - node.width / 2, y: center.y - node.height / 2 }
    }),
    edges: positionedEdges,
  }
}
