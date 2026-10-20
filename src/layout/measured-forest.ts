import type { AgenticLayout, MeasuredGraph } from './agentic-layered.ts'

/** Variable-size ordered forests need subtree spans, not crossing sweeps.
 * This is shared by the native producer and the legacy forest experiment.
 * Keep each subtree in its own interval and reserve a global band per depth,
 * so incomplete levels cannot interleave unrelated branches. */
export function layoutMeasuredForest(input: MeasuredGraph): AgenticLayout | undefined {
  const { nodes, edges, padding, nodeSpacing, layerSpacing } = input
  if (nodes.length < 2 || edges.length >= nodes.length || nodeSpacing <= 0 || layerSpacing <= 0
    || ![padding, nodeSpacing, layerSpacing].every(value => Number.isFinite(value) && value >= 0)
    || nodes.some(node => !Number.isFinite(node.width) || !Number.isFinite(node.height) || node.width <= 0 || node.height <= 0)) return undefined
  const outgoing: number[][] = nodes.map(() => [])
  const indegree = new Uint32Array(nodes.length)
  for (const edge of edges) {
    if (edge.label !== undefined || edge.minSpan !== 1 || edge.source === edge.target
      || !Number.isInteger(edge.source) || !Number.isInteger(edge.target)
      || edge.source < 0 || edge.source >= nodes.length || edge.target < 0 || edge.target >= nodes.length) return undefined
    indegree[edge.target] = indegree[edge.target]! + 1
    if (indegree[edge.target]! > 1) return undefined
    outgoing[edge.source]!.push(edge.target)
  }
  const roots = nodes.flatMap((_, index) => indegree[index] === 0 ? [index] : [])
  const traversal = [...roots]
  const depth = new Uint32Array(nodes.length)
  for (let cursor = 0; cursor < traversal.length; cursor++) {
    const parent = traversal[cursor]!
    for (const child of outgoing[parent]!) { depth[child] = depth[parent]! + 1; traversal.push(child) }
  }
  if (traversal.length !== nodes.length) return undefined
  const horizontal = input.direction === 'LR' || input.direction === 'RL'
  const reverse = input.direction === 'RL' || input.direction === 'BT'
  const mainSize = (index: number): number => horizontal ? nodes[index]!.width : nodes[index]!.height
  const crossSize = (index: number): number => horizontal ? nodes[index]!.height : nodes[index]!.width
  const span = new Float64Array(nodes.length), bands: number[] = []
  for (let cursor = traversal.length - 1; cursor >= 0; cursor--) {
    const id = traversal[cursor]!, peers = outgoing[id]!
    let descendants = Math.max(0, peers.length - 1) * nodeSpacing
    for (const child of peers) descendants += span[child]!
    span[id] = Math.max(crossSize(id), descendants)
    bands[depth[id]!] = Math.max(bands[depth[id]!] ?? 0, mainSize(id))
  }
  const bandStart: number[] = []
  let mainExtent = 0
  for (let band = 0; band < bands.length; band++) {
    bandStart.push(mainExtent)
    mainExtent += bands[band]! + (band + 1 < bands.length ? layerSpacing : 0)
  }
  const starts = new Float64Array(nodes.length)
  let crossExtent = 0
  for (const root of roots) { starts[root] = crossExtent; crossExtent += span[root]! + nodeSpacing }
  crossExtent -= nodeSpacing
  if (!Number.isFinite(mainExtent + crossExtent + 2 * padding)) return undefined
  const positioned = nodes.map(() => ({ x: 0, y: 0 }))
  for (const id of traversal) {
    const peers = outgoing[id]!
    const cross = padding + starts[id]! + (span[id]! - crossSize(id)) / 2
    let main = bandStart[depth[id]!]! + (bands[depth[id]!]! - mainSize(id)) / 2
    if (reverse) main = mainExtent - main - mainSize(id)
    main += padding
    positioned[id] = horizontal ? { x: main, y: cross } : { x: cross, y: main }
    let peerWidth = Math.max(0, peers.length - 1) * nodeSpacing
    for (const child of peers) peerWidth += span[child]!
    let start = starts[id]! + (span[id]! - peerWidth) / 2
    for (const child of peers) { starts[child] = start; start += span[child]! + nodeSpacing }
  }
  return {
    width: 2 * padding + (horizontal ? mainExtent : crossExtent),
    height: 2 * padding + (horizontal ? crossExtent : mainExtent),
    nodes: positioned,
    edges: edges.map(edge => {
      const source = positioned[edge.source]!, target = positioned[edge.target]!
      const from = nodes[edge.source]!, to = nodes[edge.target]!
      const start = horizontal
        ? { x: source.x + (reverse ? 0 : from.width), y: source.y + from.height / 2 }
        : { x: source.x + from.width / 2, y: source.y + (reverse ? 0 : from.height) }
      const end = horizontal
        ? { x: target.x + (reverse ? to.width : 0), y: target.y + to.height / 2 }
        : { x: target.x + to.width / 2, y: target.y + (reverse ? to.height : 0) }
      const mid = horizontal ? (start.x + end.x) / 2 : (start.y + end.y) / 2
      return { points: horizontal
        ? [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end]
        : [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end] }
    }),
  }
}
