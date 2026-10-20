import type { ElkNode } from 'elkjs'
import type { MermaidGraph } from '../types.ts'

export function isIndexedForestGraph(graph: MermaidGraph): boolean {
  if (graph.nodes.size < 2 || graph.subgraphs.length > 0 || graph.stateNotes?.length || graph.edges.length >= graph.nodes.size
    || [...graph.nodes.values()].some(node => node.shape !== 'rectangle')) return false
  const incoming = new Map<string, number>(), outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (edge.label !== undefined || (edge.length ?? 1) !== 1 || edge.source === edge.target
      || !graph.nodes.has(edge.source) || !graph.nodes.has(edge.target) || incoming.has(edge.target)) return false
    incoming.set(edge.target, 1)
    const peers = outgoing.get(edge.source)
    if (peers) peers.push(edge.target)
    else outgoing.set(edge.source, [edge.target])
  }
  const queue = [...graph.nodes.keys()].filter(id => !incoming.has(id))
  for (let cursor = 0; cursor < queue.length; cursor++) for (const child of outgoing.get(queue[cursor]!) ?? []) queue.push(child)
  return queue.length === graph.nodes.size
}

/**
 * Linear, variable-size ordered forest layout. Rectangular, flat, unlabelled
 * forests need neither rank optimization nor crossing minimization. Subtree
 * spans keep siblings disjoint, and global depth bands keep parent-child
 * channels clear. Everything else stays with the existing ELK strategies.
 */
export function indexedForestLayout(
  graph: MermaidGraph,
  input: ElkNode,
  padding: number,
  nodeSpacing: number,
  layerSpacing: number,
): ElkNode | undefined {
  const children = input.children
  if (!children || children.length < 2 || graph.subgraphs.length > 0 || graph.stateNotes?.length
    || children.length !== graph.nodes.size || graph.edges.some(edge => edge.label !== undefined || (edge.length ?? 1) !== 1)
    || [...graph.nodes.values()].some(node => node.shape !== 'rectangle')
    || ![padding, nodeSpacing, layerSpacing].every(value => Number.isFinite(value) && value >= 0)
    || nodeSpacing === 0 || layerSpacing === 0) return undefined
  const ordinal = new Map(children.map((node, index) => [node.id, index]))
  const outgoing: number[][] = children.map(() => []), indegree = new Uint32Array(children.length)
  for (const edge of graph.edges) {
    const from = ordinal.get(edge.source), to = ordinal.get(edge.target)
    if (from === undefined || to === undefined || from === to) return undefined
    indegree[to] = indegree[to]! + 1
    if (indegree[to]! > 1) return undefined
    outgoing[from]!.push(to)
  }
  const roots = children.flatMap((_, index) => indegree[index] === 0 ? [index] : [])
  const traversal: number[] = [], depth = new Uint32Array(children.length), queue = [...roots]
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const parent = queue[cursor]!
    traversal.push(parent)
    for (const child of outgoing[parent]!) { depth[child] = depth[parent]! + 1; queue.push(child) }
  }
  // A component with no root is a directed cycle (in-degree is at most one).
  if (traversal.length !== children.length) return undefined
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL'
  const reverse = graph.direction === 'RL' || graph.direction === 'BT'
  const mainSize = (node: ElkNode): number => horizontal ? node.width! : node.height!
  const crossSize = (node: ElkNode): number => horizontal ? node.height! : node.width!
  if (children.some(node => !Number.isFinite(node.width) || !Number.isFinite(node.height) || node.width! <= 0 || node.height! <= 0)) return undefined
  const span = new Float64Array(children.length), bands: number[] = []
  for (let cursor = traversal.length - 1; cursor >= 0; cursor--) {
    const id = traversal[cursor]!, peers = outgoing[id]!
    let descendants = Math.max(0, peers.length - 1) * nodeSpacing
    for (const child of peers) descendants += span[child]!
    span[id] = Math.max(crossSize(children[id]!), descendants)
    bands[depth[id]!] = Math.max(bands[depth[id]!] ?? 0, mainSize(children[id]!))
  }
  const bandStart: number[] = []
  let mainExtent = 0
  for (let band = 0; band < bands.length; band++) {
    bandStart.push(mainExtent)
    mainExtent += bands[band]! + (band + 1 < bands.length ? layerSpacing : 0)
  }
  const starts = new Float64Array(children.length)
  let crossExtent = 0
  for (const root of roots) { starts[root] = crossExtent; crossExtent += span[root]! + nodeSpacing }
  crossExtent -= nodeSpacing
  const positioned = children.map(node => ({ ...node }))
  for (const id of traversal) {
    const node = positioned[id]!, peers = outgoing[id]!
    const cross = padding + starts[id]! + (span[id]! - crossSize(node)) / 2
    let main = bandStart[depth[id]!]! + (bands[depth[id]!]! - mainSize(node)) / 2
    if (reverse) main = mainExtent - main - mainSize(node)
    main += padding
    node.x = horizontal ? main : cross; node.y = horizontal ? cross : main
    let peerWidth = Math.max(0, peers.length - 1) * nodeSpacing
    for (const child of peers) peerWidth += span[child]!
    let start = starts[id]! + (span[id]! - peerWidth) / 2
    for (const child of peers) { starts[child] = start; start += span[child]! + nodeSpacing }
  }
  const edges = graph.edges.map((edge, index) => {
    const source = positioned[ordinal.get(edge.source)!]!, target = positioned[ordinal.get(edge.target)!]!
    const startPoint = horizontal
      ? { x: source.x! + (reverse ? 0 : source.width!), y: source.y! + source.height! / 2 }
      : { x: source.x! + source.width! / 2, y: source.y! + (reverse ? 0 : source.height!) }
    const endPoint = horizontal
      ? { x: target.x! + (reverse ? target.width! : 0), y: target.y! + target.height! / 2 }
      : { x: target.x! + target.width! / 2, y: target.y! + (reverse ? target.height! : 0) }
    const mid = horizontal ? (startPoint.x + endPoint.x) / 2 : (startPoint.y + endPoint.y) / 2
    const bendPoints = horizontal
      ? [{ x: mid, y: startPoint.y }, { x: mid, y: endPoint.y }]
      : [{ x: startPoint.x, y: mid }, { x: endPoint.x, y: mid }]
    return { id: `e${index}`, sources: [edge.source], targets: [edge.target], sections: [{ id: `e${index}_s0`, startPoint, bendPoints, endPoint }] }
  })
  return {
    ...input, children: positioned, edges,
    width: 2 * padding + (horizontal ? mainExtent : crossExtent),
    height: 2 * padding + (horizontal ? crossExtent : mainExtent),
  }
}
