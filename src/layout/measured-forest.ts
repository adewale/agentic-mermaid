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
  if (nodes.some((node, index) => node.minimumPortSpacing !== undefined
    && (outgoing[index]!.length - 1) * node.minimumPortSpacing > crossSize(index) - 2 * (node.paintCornerRadius ?? 0))) return undefined
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
  // Spread ports also need ordered bend channels. Reusing one channel leaves
  // overlapping runs between siblings whose source contacts are now distinct.
  // Routes toward the low cross side use increasing channels; routes toward
  // the high side use decreasing channels. Opposite-side runs are disjoint.
  const fanTracks = new Float64Array(nodes.length)
  const trackSpacing = input.edgeSpacing ?? 6
  for (let id = 0; id < nodes.length; id++) {
    const pitch = nodes[id]!.minimumPortSpacing, peers = outgoing[id]!
    if (!pitch || peers.length < 2) continue
    const low: number[] = [], high: number[] = []
    const center = (horizontal ? positioned[id]!.y : positioned[id]!.x) + crossSize(id) / 2
    for (const [slot, child] of peers.entries()) {
      const sourceCross = center + (slot - (peers.length - 1) / 2) * pitch
      const targetCross = (horizontal ? positioned[child]!.y : positioned[child]!.x) + crossSize(child) / 2
      if (targetCross < sourceCross) low.push(child)
      else if (targetCross > sourceCross) high.push(child)
    }
    const tracks = Math.max(low.length, high.length)
    if ((tracks - 1) * trackSpacing > layerSpacing - 2 * Math.max(12, input.minimumTerminalLead ?? 0)) return undefined
    low.forEach((child, slot) => { fanTracks[child] = (slot - (low.length - 1) / 2) * trackSpacing })
    high.forEach((child, slot) => { fanTracks[child] = ((high.length - 1) / 2 - slot) * trackSpacing })
  }
  const sourceSlots = new Uint32Array(nodes.length)
  return {
    topology: 'forest',
    width: 2 * padding + (horizontal ? mainExtent : crossExtent),
    height: 2 * padding + (horizontal ? crossExtent : mainExtent),
    nodes: positioned,
    edges: edges.map(edge => {
      if (input.placementOnly && !input.cycleOriented && !input.loopPorts?.length) return { points: [] }
      const source = positioned[edge.source]!, target = positioned[edge.target]!
      const from = nodes[edge.source]!, to = nodes[edge.target]!
      const start = horizontal
        ? { x: source.x + (reverse ? 0 : from.width), y: source.y + from.height / 2 }
        : { x: source.x + from.width / 2, y: source.y + (reverse ? 0 : from.height) }
      const end = horizontal
        ? { x: target.x + (reverse ? to.width : 0), y: target.y + to.height / 2 }
        : { x: target.x + to.width / 2, y: target.y + (reverse ? to.height : 0) }
      // Reserve the producer's marker pitch in sibling order before final
      // seating. Moving coincident arrowheads greedily can invert that order.
      const slot = sourceSlots[edge.source]!, peers = outgoing[edge.source]!.length
      sourceSlots[edge.source] = slot + 1
      if (from.minimumPortSpacing && peers > 1) {
        const offset = (slot - (peers - 1) / 2) * from.minimumPortSpacing
        if (horizontal) start.y += offset
        else start.x += offset
      }
      let mid = horizontal ? (start.x + end.x) / 2 : (start.y + end.y) / 2
      // Unequal main-axis sizes center faces inside their depth bands. An
      // individual face midpoint can therefore enter a taller sibling box.
      // Keep existing clear band-gap bends exact; move only an out-of-gap bend.
      const band = depth[edge.source]!
      const exit = padding + (reverse ? mainExtent - (bandStart[band]! + bands[band]!) : bandStart[band]! + bands[band]!)
      const entry = padding + (reverse ? mainExtent - bandStart[band + 1]! : bandStart[band + 1]!)
      if (mid <= Math.min(exit, entry) || mid >= Math.max(exit, entry)) mid = exit + (entry - exit) / 2
      if (from.minimumPortSpacing && peers > 1) mid = (exit + entry) / 2 + (reverse ? -1 : 1) * fanTracks[edge.target]!
      return { points: horizontal
        ? [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end]
        : [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end] }
    }),
  }
}
