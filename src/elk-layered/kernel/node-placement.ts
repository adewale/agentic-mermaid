/*******************************************************************************
 * Copyright (c) 2010, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutEdge, LayoutNode, LayoutPort } from './graph.ts'
import { booleanOption, enumOption, integerOption, numberOption, type Options } from './options.ts'

type Neighbor = { node: number; edge: LayoutEdge }
interface Neighborhood { nodes: LayoutNode[]; ids: Map<LayoutNode, number>; position: number[]; layer: number[]; left: Neighbor[][]; right: Neighbor[][] }
interface AlignedLayout { root: number[]; blockSize: number[]; align: number[]; inner: number[]; sink: number[]; shift: number[]; y: (number | null)[]; used: boolean[]; onlyDummies: boolean[]; up: boolean; left: boolean }
interface ClassNode { node: number; shift: number | null; incoming: number; outgoing: { target: ClassNode; separation: number }[] }
interface Postprocessable { free: number; isRoot: boolean; hasEdges: boolean; edge: LayoutEdge | null }

/** Brandes/Koepf placement, ELK0.11.0, with published elkjs arithmetic. */
export function placeNodes(layers: LayoutNode[][], options: Options): void {
  const ni = neighborhood(layers), marked = markConflicts(layers, ni)
  const alignment = enumOption(options, 'layered.nodePlacement.bk.fixedAlignment', ['NONE', 'LEFTUP', 'RIGHTUP', 'LEFTDOWN', 'RIGHTDOWN', 'BALANCED'] as const, 'NONE')
  const configurations: [boolean, boolean][] = alignment === 'LEFTDOWN' ? [[false, true]] : alignment === 'LEFTUP' ? [[true, true]] : alignment === 'RIGHTDOWN' ? [[false, false]] : alignment === 'RIGHTUP' ? [[true, false]] : [[false, false], [true, false], [false, true], [true, true]]
  const layouts = configurations.map(([up, left]) => makeLayout(ni.nodes.length, up, left))
  for (const layout of layouts) { verticalAlignment(layout, layers, ni, marked); insideBlockShift(layout, ni) }
  for (const layout of layouts) compact(layout, layers, ni, options)
  let chosen: AlignedLayout | null = null
  if ((alignment === 'NONE' && !booleanOption(options, 'layered.nodePlacement.favorStraightEdges', true)) || alignment === 'BALANCED') {
    const balanced = balance(layouts, ni)
    if (checkOrder(balanced, layers, ni)) chosen = balanced
  }
  if (chosen === null) for (const layout of layouts) if (checkOrder(layout, layers, ni) && (chosen === null || layoutSize(chosen, ni) > layoutSize(layout, ni))) chosen = layout
  chosen ??= layouts[0]!
  for (let id = 0; id < ni.nodes.length; id++) ni.nodes[id]!.y = chosen.y[id]! + chosen.inner[id]!
}
function neighborhood(layers: LayoutNode[][]): Neighborhood {
  const nodes = layers.flat(), ids = new Map<LayoutNode, number>(), position: number[] = [], layerIds: number[] = []
  for (let layer = 0; layer < layers.length; layer++) for (let index = 0; index < layers[layer]!.length; index++) { const node = layers[layer]![index]!; const id = ids.size; ids.set(node, id); position[id] = index; layerIds[id] = layer }
  const left: Neighbor[][] = [], right: Neighbor[][] = []
  for (const incoming of [true, false]) {
    const result = incoming ? left : right
    for (const node of nodes) {
      const neighbors: Neighbor[] = []; let maxPriority = 0
      for (const port of node.ports) for (const edge of incoming ? port.incoming : port.outgoing) {
        if (edge.source.node === edge.target.node || edge.source.node.rank === edge.target.node.rank) continue
        const priority = integerOption(edge.options, 'layered.priority.straightness', 0)
        if (priority > maxPriority) { maxPriority = priority; neighbors.length = 0 }
        if (priority === maxPriority) neighbors.push({ node: ids.get(incoming ? edge.source.node : edge.target.node)!, edge })
      }
      neighbors.sort((a, b) => Math.sign(position[a.node]! - position[b.node]!))
      result.push(neighbors)
    }
  }
  return { nodes, ids, position, layer: layerIds, left, right }
}
function makeLayout(count: number, up: boolean, left: boolean): AlignedLayout { return { root: new Array(count), blockSize: new Array(count), align: new Array(count), inner: new Array(count), sink: new Array(count), shift: new Array(count), y: new Array(count).fill(null), used: new Array(count).fill(false), onlyDummies: new Array(count).fill(true), up, left } }
function markConflicts(layers: LayoutNode[][], ni: Neighborhood): Set<LayoutEdge> {
  const marked = new Set<LayoutEdge>()
  const inner = (id: number, layer: number, previous: number): boolean => ni.nodes[id]!.type === 'LONG_EDGE' && ni.nodes[id]!.ports.some(port => port.incoming.some(edge => edge.source.node.type === 'LONG_EDGE' && ni.layer[ni.ids.get(edge.source.node)!] === previous && ni.layer[id] === layer))
  for (let i = 1; i < layers.length - 1; i++) {
    const current = layers[i + 1]!; let k0 = 0, l = 0
    for (let l1 = 0; l1 < current.length; l1++) {
      const id = ni.ids.get(current[l1]!)!
      if (l1 === current.length - 1 || inner(id, i + 1, i)) {
        const k1 = inner(id, i + 1, i) ? ni.position[ni.left[id]![0]!.node]! : layers[i]!.length - 1
        while (l <= l1) {
          const currentId = ni.ids.get(current[l]!)!
          if (!inner(currentId, i + 1, i)) for (const neighbor of ni.left[currentId]!) { const k = ni.position[neighbor.node]!; if (k < k0 || k > k1) marked.add(neighbor.edge) }
          l++
        }
        k0 = k1
      }
    }
  }
  return marked
}
function verticalAlignment(bal: AlignedLayout, layers: LayoutNode[][], ni: Neighborhood, marked: Set<LayoutEdge>): void {
  for (let id = 0; id < ni.nodes.length; id++) { bal.root[id] = id; bal.align[id] = id; bal.inner[id] = 0 }
  for (const layer of bal.left ? layers.toReversed() : layers) {
    let r = bal.up ? 2147483647 : -1
    for (const node of bal.up ? layer.toReversed() : layer) {
      const id = ni.ids.get(node)!, neighbors = (bal.left ? ni.right : ni.left)[id]!, count = neighbors.length
      if (count === 0) continue
      const low = Math.floor((count + 1.0) / 2.0) - 1, high = Math.ceil((count + 1.0) / 2.0) - 1
      for (let m = bal.up ? high : low; bal.up ? m >= low : m <= high; m += bal.up ? -1 : 1) {
        if (bal.align[id] !== id) continue
        const neighbor = neighbors[m]!, index = ni.position[neighbor.node]!
        if (!marked.has(neighbor.edge) && (bal.up ? r > index : r < index)) {
          bal.align[neighbor.node] = id; bal.root[id] = bal.root[neighbor.node]!; bal.align[id] = bal.root[id]!
          bal.onlyDummies[bal.root[id]!] = bal.onlyDummies[bal.root[id]!]! && node.type === 'LONG_EDGE'; r = index
        }
      }
    }
  }
}
function connectedEdge(a: LayoutNode, b: LayoutNode): LayoutEdge {
  for (const port of a.ports) { for (const edge of port.incoming) if (edge.target.node === b || edge.source.node === b) return edge; for (const edge of port.outgoing) if (edge.target.node === b || edge.source.node === b) return edge }
  throw new Error('ELK BK alignment nodes are not connected')
}
function insideBlockShift(bal: AlignedLayout, ni: Neighborhood): void {
  const roots = new Set(bal.root)
  for (const root of roots) {
    const rootNode = ni.nodes[root]!; let above = rootNode.margin.top, below = rootNode.height + rootNode.margin.bottom, current = root
    bal.inner[root] = 0
    for (let next = bal.align[current]!; next !== root; next = bal.align[current]!) {
      const edge = connectedEdge(ni.nodes[current]!, ni.nodes[next]!), source = edge.source, target = edge.target
      const difference = bal.left ? target.y + target.anchorY - source.y - source.anchorY : source.y + source.anchorY - target.y - target.anchorY
      const shift = bal.inner[current]! + difference; bal.inner[next] = shift
      const node = ni.nodes[next]!; above = Math.max(above, node.margin.top - shift); below = Math.max(below, shift + node.height + node.margin.bottom); current = next
    }
    current = root
    do { bal.inner[current] = bal.inner[current]! + above; current = bal.align[current]! } while (current !== root)
    bal.blockSize[root] = above + below
  }
}
function verticalSpacing(a: LayoutNode, b: LayoutNode, options: Options): number {
  const types = [a.type, b.type], has = (type: LayoutNode['type']): boolean => types.includes(type)
  let key: string, fallback: number
  if ((a.type === 'NORMAL' && b.type === 'NORMAL') || (has('NORMAL') && has('LABEL'))) { key = 'spacing.nodeNode'; fallback = 20 }
  else if ((a.type === 'EXTERNAL_PORT' && b.type === 'EXTERNAL_PORT')) { key = 'spacing.portPort'; fallback = 10 }
  else if (has('EXTERNAL_PORT') && has('LABEL')) { key = 'spacing.labelPortVertical'; fallback = 1 }
  else if (has('NORTH_SOUTH_PORT') && has('LABEL')) { key = 'spacing.labelNode'; fallback = 5 }
  else if (has('NORMAL') || (has('LONG_EDGE') && has('LABEL')) || (has('BREAKING_POINT') && (has('LONG_EDGE') || has('LABEL')))) { key = 'spacing.edgeNode'; fallback = 10 }
  else if (has('PLACEHOLDER') || has('NONSHIFTING_PLACEHOLDER')) throw new Error('ELK TypeScript port: unspecified BK node spacing')
  else { key = 'spacing.edgeEdge'; fallback = 10 }
  const global = numberOption(options, key, fallback)
  return Math.max(numberOption(a.individualSpacings, key, global), numberOption(b.individualSpacings, key, global))
}
function compact(bal: AlignedLayout, layers: LayoutNode[][], ni: Neighborhood, options: Options): void {
  const classes = new Map<number, ClassNode>(), finished = new Set<number>(), queue: Postprocessable[] = [], stack: Postprocessable[] = []
  const improve = enumOption(options, 'layered.nodePlacement.bk.edgeStraightening', ['NONE', 'IMPROVE_STRAIGHTNESS'] as const, 'IMPROVE_STRAIGHTNESS') === 'IMPROVE_STRAIGHTNESS'
  const invalid = bal.up ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  const ids = ni.ids, other = (edge: LayoutEdge, free: number): number => ids.get(edge.source.node === ni.nodes[free] ? edge.target.node : edge.source.node)!
  for (let id = 0; id < ni.nodes.length; id++) { bal.sink[id] = id; bal.shift[id] = bal.up ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY }
  const pickEdge = (pick: Postprocessable): Postprocessable => {
    const incoming = pick.isRoot ? !bal.left : bal.left, node = ni.nodes[pick.free]!
    let hasEdges = false
    for (const port of node.ports) for (const edge of incoming ? port.incoming : port.outgoing) {
      if (!bal.onlyDummies[bal.root[pick.free]!] && edge.source.node.rank === edge.target.node.rank) continue
      if (bal.used[bal.root[pick.free]!] || bal.used[bal.root[pick.free]!]) continue
      hasEdges = true
      if (finished.has(bal.root[other(edge, pick.free)]!)) { pick.hasEdges = true; pick.edge = edge; return pick }
    }
    pick.hasEdges = hasEdges; pick.edge = null; return pick
  }
  const bound = (free: number, isRoot: boolean): number => {
    const pick = pickEdge({ free, isRoot, hasEdges: false, edge: null })
    if (pick.edge === null) { if (pick.hasEdges) queue.push(pick); return invalid }
    const source = pick.edge.source, target = pick.edge.target
    const rootPort = isRoot ? bal.left ? source : target : bal.left ? target : source
    const otherPort = rootPort === source ? target : source, otherId = ids.get(otherPort.node)!, rootId = ids.get(rootPort.node)!
    const threshold = bal.y[bal.root[otherId]!]! + bal.inner[otherId]! + otherPort.y + otherPort.anchorY - bal.inner[rootId]! - rootPort.y - rootPort.anchorY
    bal.used[bal.root[ids.get(source.node)!]!] = true; bal.used[bal.root[ids.get(target.node)!]!] = true
    return threshold
  }
  const calculateThreshold = (old: number, root: number, current: number): number => {
    if (!improve) return invalid
    const isRoot = root === current, last = bal.align[current] === root
    if (!isRoot && !last) return old
    let threshold = isRoot ? bound(root, true) : old
    if ((threshold === Number.POSITIVE_INFINITY || threshold === Number.NEGATIVE_INFINITY) && last) threshold = bound(current, false)
    return threshold
  }
  const getClass = (id: number): ClassNode => { let result = classes.get(id); if (result === undefined) { result = { node: id, shift: null, incoming: 0, outgoing: [] }; classes.set(id, result) }; return result }
  const placeBlock = (root: number): void => {
    if (bal.y[root] !== null) return
    let initial = true, current = root, threshold = invalid
    bal.y[root] = 0.0
    do {
      const index = ni.position[current]!, layer = layers[ni.layer[current]!]!, node = ni.nodes[current]!
      if (bal.up ? index < layer.length - 1 : index > 0) {
        const neighbor = layer[index + (bal.up ? 1 : -1)]!, neighborId = ids.get(neighbor)!, neighborRoot = bal.root[neighborId]!
        placeBlock(neighborRoot); threshold = calculateThreshold(threshold, root, current)
        if (bal.sink[root] === root) bal.sink[root] = bal.sink[neighborRoot]!
        if (bal.sink[root] === bal.sink[neighborRoot]) {
          const spacing = verticalSpacing(node, neighbor, options)
          const position = bal.up ? bal.y[neighborRoot]! + bal.inner[neighborId]! - neighbor.margin.top - spacing - node.margin.bottom - node.height - bal.inner[current]! : bal.y[neighborRoot]! + bal.inner[neighborId]! + neighbor.height + neighbor.margin.bottom + spacing + node.margin.top - bal.inner[current]!
          if (initial) { initial = false; bal.y[root] = bal.up ? Math.min(position, threshold) : Math.max(position, threshold) }
          else bal.y[root] = bal.up ? Math.min(bal.y[root]!, Math.min(position, threshold)) : Math.max(bal.y[root]!, Math.max(position, threshold))
        } else {
          const spacing = numberOption(options, 'spacing.nodeNode', 20), sink = getClass(bal.sink[root]!), neighborSink = getClass(bal.sink[neighborRoot]!)
          const separation = bal.up ? bal.y[root]! + bal.inner[current]! + node.height + node.margin.bottom + spacing - (bal.y[neighborRoot]! + bal.inner[neighborId]! - neighbor.margin.top) : bal.y[root]! + bal.inner[current]! - node.margin.top - bal.y[neighborRoot]! - bal.inner[neighborId]! - neighbor.height - neighbor.margin.bottom - spacing
          neighborSink.incoming++; sink.outgoing.push({ target: neighborSink, separation })
        }
      } else threshold = calculateThreshold(threshold, root, current)
      current = bal.align[current]!
    } while (current !== root)
    finished.add(root)
  }
  const traversal = bal.left ? layers.toReversed() : layers
  bal.y.fill(null)
  for (const layer of traversal) for (const node of bal.up ? layer.toReversed() : layer) { const id = ids.get(node)!; if (bal.root[id] === id) placeBlock(id) }
  const sinks = [...classes.values()].filter(node => node.incoming === 0)
  for (let index = 0; index < sinks.length; index++) {
    const node = sinks[index]!; node.shift ??= 0
    for (const edge of node.outgoing) {
      if (edge.target.shift === null) edge.target.shift = node.shift + edge.separation
      else edge.target.shift = bal.up ? Math.max(edge.target.shift, node.shift + edge.separation) : Math.min(edge.target.shift, node.shift + edge.separation)
      edge.target.incoming--; if (edge.target.incoming === 0) sinks.push(edge.target)
    }
  }
  for (const node of classes.values()) bal.shift[node.node] = node.shift!
  for (const layer of traversal) for (const node of layer) {
    const id = ids.get(node)!; bal.y[id] = bal.y[bal.root[id]!]!
    if (id === bal.root[id]) { const shift = bal.shift[bal.sink[id]!]!; if (bal.up ? shift > Number.NEGATIVE_INFINITY : shift < Number.POSITIVE_INFINITY) bal.y[id] = bal.y[id]! + shift }
  }
  if (!improve) return
  const process = (pick: Postprocessable): boolean => {
    const edge = pick.edge!, source = edge.source, target = edge.target
    const block = source.node === ni.nodes[pick.free] ? source : target, fix = block === source ? target : source
    const coordinate = (port: LayoutPort): number => { const id = ids.get(port.node)!; return bal.y[id]! + bal.inner[id]! + port.y + port.anchorY }
    const delta = coordinate(block) - coordinate(fix)
    if (!(delta > 0 && delta < Number.MAX_VALUE) && !(delta < 0 && -delta < Number.MAX_VALUE)) return false
    let available = Math.abs(delta), current = ids.get(block.node)!, root = current
    do {
      current = bal.align[current]!
      const node = ni.nodes[current]!, index = ni.position[current]!, layer = layers[ni.layer[current]!]!
      const neighbor = delta > 0 ? index > 0 ? layer[index - 1] : undefined : index < layer.length - 1 ? layer[index + 1] : undefined
      if (neighbor !== undefined) {
        const neighborId = ids.get(neighbor)!, nodeY = bal.y[bal.root[current]!]! + bal.inner[current]!, neighborY = bal.y[bal.root[neighborId]!]! + bal.inner[neighborId]!
        available = Math.min(available, delta > 0 ? nodeY - node.margin.top - (neighborY + neighbor.height + neighbor.margin.bottom + verticalSpacing(node, neighbor, options)) : neighborY - neighbor.margin.top - (nodeY + node.height + node.margin.bottom + verticalSpacing(node, neighbor, options)))
      }
    } while (current !== root)
    current = root
    do { bal.y[current] = bal.y[current]! + (delta > 0 ? -available : available); current = bal.align[current]! } while (current !== root)
    return available > 0
  }
  for (let index = 0; index < queue.length; index++) {
    const pick = pickEdge(queue[index]!)
    if (pick.edge === null || (!bal.onlyDummies[bal.root[pick.free]!] && pick.edge.source.node.rank === pick.edge.target.node.rank)) continue
    if (!process(pick)) stack.push(pick)
  }
  while (stack.length > 0) process(stack.pop()!)
}
function layoutSize(bal: AlignedLayout, ni: Neighborhood): number { let min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY; for (let id = 0; id < ni.nodes.length; id++) { const y = bal.y[id]!; min = Math.min(min, y); max = Math.max(max, y + bal.blockSize[bal.root[id]!]!) }; return max - min }
function checkOrder(bal: AlignedLayout, layers: LayoutNode[][], ni: Neighborhood): boolean {
  for (const layer of layers) {
    let pos = Number.NEGATIVE_INFINITY
    for (const node of layer) { const id = ni.ids.get(node)!, top = bal.y[id]! + bal.inner[id]! - node.margin.top, bottom = bal.y[id]! + bal.inner[id]! + node.height + node.margin.bottom; if (!(top > pos && bottom > pos)) return false; pos = bottom }
  }
  return true
}
function balance(layouts: AlignedLayout[], ni: Neighborhood): AlignedLayout {
  const result = makeLayout(ni.nodes.length, false, false), widths: number[] = [], min = layouts.map(() => 2147483647), max = layouts.map(() => -2147483648)
  let smallest = 0
  for (let index = 0; index < layouts.length; index++) {
    const layout = layouts[index]!; widths[index] = layoutSize(layout, ni); if (widths[smallest]! > widths[index]!) smallest = index
    for (let id = 0; id < ni.nodes.length; id++) { const y = layout.y[id]! + layout.inner[id]!; min[index] = Math.min(min[index]!, y); max[index] = Math.max(max[index]!, y + ni.nodes[id]!.height) }
  }
  const shifts = layouts.map((layout, index) => layout.up ? max[smallest]! - max[index]! : min[smallest]! - min[index]!)
  for (let id = 0; id < ni.nodes.length; id++) { const ys = layouts.map((layout, index) => layout.y[id]! + layout.inner[id]! + shifts[index]!).sort((a, b) => a - b); result.y[id] = (ys[1]! + ys[2]!) / 2.0; result.inner[id] = 0 }
  return result
}
