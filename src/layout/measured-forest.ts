import type { AgenticLayout, MeasuredGraph } from './agentic-layered.ts'

/** Variable-size ordered forests need subtree spans, not crossing sweeps.
 * This is shared by the native producer and the legacy forest experiment.
 * Keep each subtree in its own interval and reserve depth bands within each
 * root, so incomplete levels cannot interleave related branches. Disconnected
 * roots already have separate cross-axis intervals and need no shared bands. */
export function layoutMeasuredForest(input: MeasuredGraph, packComponents = true): AgenticLayout | undefined {
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
  const depth = new Uint32Array(nodes.length), rootOrdinal = new Uint32Array(depth.length), rootDepth = new Uint32Array(roots.length)
  for (let ordinal = 0; ordinal < roots.length; ordinal++) rootOrdinal[roots[ordinal]!] = ordinal
  for (let cursor = 0; cursor < traversal.length; cursor++) {
    const parent = traversal[cursor]!, ordinal = rootOrdinal[parent]!
    for (const child of outgoing[parent]!) {
      depth[child] = depth[parent]! + 1; rootOrdinal[child] = ordinal
      if (depth[child]! > rootDepth[ordinal]!) rootDepth[ordinal] = depth[child]!
      traversal.push(child)
    }
  }
  if (traversal.length !== nodes.length) return undefined
  const horizontal = input.direction === 'LR' || input.direction === 'RL'
  const reverse = input.direction === 'RL' || input.direction === 'BT'
  const mainSize = (index: number): number => horizontal ? nodes[index]!.width : nodes[index]!.height
  const crossSize = (index: number): number => horizontal ? nodes[index]!.height : nodes[index]!.width
  if (nodes.some((node, index) => node.minimumPortSpacing !== undefined
    && (outgoing[index]!.length - 1) * node.minimumPortSpacing > crossSize(index) - 2 * (node.paintCornerRadius ?? 0))) return undefined
  // Each root's depth count is at most its node count, so these flat bands
  // together have at most nodes.length entries even for uneven components.
  const bandOffset = new Uint32Array(roots.length + 1)
  for (let ordinal = 0; ordinal < roots.length; ordinal++) bandOffset[ordinal + 1] = bandOffset[ordinal]! + rootDepth[ordinal]! + 1
  const span = new Float64Array(nodes.length), bands = new Float64Array(bandOffset[roots.length]!)
  for (let cursor = traversal.length - 1; cursor >= 0; cursor--) {
    const id = traversal[cursor]!, peers = outgoing[id]!
    let descendants = Math.max(0, peers.length - 1) * nodeSpacing
    for (const child of peers) descendants += span[child]!
    span[id] = Math.max(crossSize(id), descendants)
    const band = bandOffset[rootOrdinal[id]!]! + depth[id]!
    bands[band] = Math.max(bands[band]!, mainSize(id))
  }
  const bandStart = new Float64Array(bands.length)
  let mainExtent = 0
  for (let ordinal = 0; ordinal < roots.length; ordinal++) {
    let extent = 0
    const end = bandOffset[ordinal + 1]!
    for (let band = bandOffset[ordinal]!; band < end; band++) {
      bandStart[band] = extent
      extent += bands[band]! + (band + 1 < end ? layerSpacing : 0)
    }
    if (extent > mainExtent || extent !== extent) mainExtent = extent
  }
  const starts = new Float64Array(nodes.length)
  let crossExtent = 0
  for (const root of roots) { starts[root] = crossExtent; crossExtent += span[root]! + nodeSpacing }
  crossExtent -= nodeSpacing
  // Disconnected roots share no route. Pack their existing intervals without
  // reordering a subtree or recomputing any of its geometry. Four linear shelf
  // proposals include the two strips and useful near-square arrangements.
  const rootMainSize = (ordinal: number): number => {
    const last = bandOffset[ordinal + 1]! - 1
    return bandStart[last]! + bands[last]!
  }
  let columns = roots.length
  let area = (crossExtent + 2 * padding) * (mainExtent + 2 * padding)
  for (const count of packComponents ? [1, 2, Math.ceil(roots.length / 2), Math.ceil(Math.sqrt(roots.length))] : []) {
    if (count >= roots.length) continue
    let cross = 0, main = 0, rowCross = 0, rowMain = 0
    for (let ordinal = 0; ordinal < roots.length; ordinal++) {
      rowCross += span[roots[ordinal]!]! + (ordinal % count ? nodeSpacing : 0)
      rowMain = Math.max(rowMain, rootMainSize(ordinal))
      if ((ordinal + 1) % count === 0 || ordinal + 1 === roots.length) {
        cross = Math.max(cross, rowCross)
        main += rowMain + (ordinal + 1 < roots.length ? nodeSpacing : 0)
        rowCross = 0; rowMain = 0
      }
    }
    const candidateArea = (cross + 2 * padding) * (main + 2 * padding)
    if (candidateArea < area) { area = candidateArea; columns = count; crossExtent = cross; mainExtent = main }
  }
  if (columns !== roots.length) {
    let cross = 0, main = 0, rowMain = 0
    for (let ordinal = 0; ordinal < roots.length; ordinal++) {
      const root = roots[ordinal]!, extent = rootMainSize(ordinal)
      starts[root] = cross
      // Reverse each component within its own band before translating it.
      const shift = reverse ? mainExtent - extent - main : main
      for (let band = bandOffset[ordinal]!; band < bandOffset[ordinal + 1]!; band++) bandStart[band] = bandStart[band]! + shift
      cross += span[root]! + nodeSpacing
      rowMain = Math.max(rowMain, extent)
      if ((ordinal + 1) % columns === 0) { main += rowMain + nodeSpacing; cross = 0; rowMain = 0 }
    }
  }
  if (!Number.isFinite(mainExtent + crossExtent + 2 * padding)) return undefined
  const positioned = nodes.map(() => ({ x: 0, y: 0 }))
  for (const id of traversal) {
    const peers = outgoing[id]!
    const cross = padding + starts[id]! + (span[id]! - crossSize(id)) / 2
    const band = bandOffset[rootOrdinal[id]!]! + depth[id]!
    let main = bandStart[band]! + (bands[band]! - mainSize(id)) / 2
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
      const sourceId = edge.source, band = bandOffset[rootOrdinal[sourceId]!]! + depth[sourceId]!
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
