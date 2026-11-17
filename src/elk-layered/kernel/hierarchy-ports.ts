/*******************************************************************************
 * Copyright (c) 2010, 2015, 2017 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
/*
 * Copyright 2008 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 *
 * GWT 2.11 Arrays sorting, translated under EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import { providePort, isSideFixed, type LayoutGraph, type LayoutNode, type LayoutPort, type LayoutEdge, type PortConstraints } from './graph.ts'
import { createDummy } from './long-edges.ts'
import { calculateNodeMargins } from './margins.ts'
import { routeOrthogonalGap } from './routing.ts'
import { enumOption, numberOption, setOption, type Insets, type Options } from './options.ts'

type Node = LayoutNode
type Port = LayoutPort
type Edge = LayoutEdge
export interface HierarchyPortGeometry { width: number; height: number; offsetX: number; offsetY: number; padding: Insets; options: Options }
export interface HierarchyPortState { graph: LayoutGraph; constraints: PortConstraints; originals?: Node[]; replacements: Map<Node, Node> }
const constraintsOf = (options: Options): PortConstraints => enumOption(options, 'portConstraints', ['UNDEFINED', 'FREE', 'FIXED_SIDE', 'FIXED_ORDER', 'FIXED_RATIO', 'FIXED_POS'] as const, 'UNDEFINED')
const fixedOrder = (constraints: PortConstraints): boolean => constraints === 'FIXED_ORDER' || constraints === 'FIXED_RATIO' || constraints === 'FIXED_POS'
const northSouth = (node: Node): boolean => node.type === 'EXTERNAL_PORT' && (node.externalPortSide === 'NORTH' || node.externalPortSide === 'SOUTH')
const incoming = (node: Node): Edge[] => node.ports.flatMap(port => port.incoming)
const outgoing = (node: Node): Edge[] => node.ports.flatMap(port => port.outgoing)
const remove = <T>(array: T[], value: T): void => { const index = array.indexOf(value); if (index >= 0) array.splice(index, 1) }
function source(edge: Edge, port: Port): void { remove(edge.source.outgoing, edge); edge.source = port; port.outgoing.push(edge) }
function target(edge: Edge, port: Port): void { remove(edge.target.incoming, edge); edge.target = port; port.incoming.push(edge) }
function setLayer(node: Node, layer: Node[] | undefined, layers: Node[][]): void { for (const current of layers) remove(current, node); layer?.push(node) }
function ranks(layers: Node[][]): void { for (let index = 0; index < layers.length; index++) for (const node of layers[index]!) node.rank = index }
function compareNumbers(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  if (a === b) return a === 0 ? compareNumbers(1 / a, 1 / b) : 0
  return Number.isNaN(a) ? Number.isNaN(b) ? 0 : 1 : -1
}
// GWT 2.11 Arrays.sort: NodeComparator is deliberately not antisymmetric for
// two ordinary nodes, so the source merge/insertion sequence is significant.
function sort<T>(array: T[], compare: (a: T, b: T) => number): void {
  const merge = (temporary: T[], output: T[], low: number, high: number, offset: number): void => {
    if (high - low < 7) {
      for (let i = low + 1; i < high; i++) for (let j = i; j > low && compare(output[j - 1]!, output[j]!) > 0; j--) { const value = output[j]!; output[j] = output[j - 1]!; output[j - 1] = value }
      return
    }
    let first = low + offset
    const end = high + offset, middle = first + ((end - first) >> 1)
    merge(output, temporary, first, middle, -offset); merge(output, temporary, middle, end, -offset)
    if (compare(temporary[middle - 1]!, temporary[middle]!) <= 0) { while (low < high) output[low++] = temporary[first++]!; return }
    let second = middle
    while (low < high) output[low++] = second >= end || first < middle && compare(temporary[first]!, temporary[second]!) <= 0 ? temporary[first++]! : temporary[second++]!
  }
  merge(array.slice(), array, 0, array.length, 0)
}
function replacement(original: Node, graph: LayoutGraph): Node {
  const node = createDummy('EXTERNAL_PORT')
  node.layoutGraph = graph; node.options = new Map(original.options); node.options.set('alignment', 'CENTER'); node.options.set('portConstraints', 'FIXED_POS')
  node.individualSpacings = original.individualSpacings
  node.externalPortSide = original.externalPortSide; node.externalPortSize = original.externalPortSize; node.externalPortAnchor = original.externalPortAnchor; node.externalPortRatio = original.externalPortRatio; node.externalPortBorderOffset = original.externalPortBorderOffset
  node.originPort = original.originPort; node.edgeConstraint = original.edgeConstraint; node.layerConstraint = original.layerConstraint; node.layerConstraintSet = original.layerConstraintSet; node.inLayerConstraint = original.inLayerConstraint
  node.inLayerSuccessors = original.inLayerSuccessors; node.inLayerLayoutUnit = original.inLayerLayoutUnit; node.barycenterAssociates = original.barycenterAssociates
  node.modelOrder = original.modelOrder; node.crossingMinimizationGroupId = original.crossingMinimizationGroupId; node.crossingMinimizationGroupIdentity = original.crossingMinimizationGroupIdentity
  node.longEdgeSource = original.longEdgeSource; node.longEdgeTarget = original.longEdgeTarget; node.longEdgeHasLabelDummies = original.longEdgeHasLabelDummies; node.longEdgeBeforeLabelDummy = original.longEdgeBeforeLabelDummy; node.targetNodeModelOrder = original.targetNodeModelOrder
  providePort(node, 'INPUT', 'WEST', false); providePort(node, 'OUTPUT', 'EAST', false)
  return node
}
/** ELK 0.11.0 HierarchicalPortConstraintProcessor, before long-edge splitting. */
export function constrainHierarchyPorts(graph: LayoutGraph, layers: Node[][]): HierarchyPortState | undefined {
  if (graph.hasExternalPorts !== true) return undefined
  const constraints = constraintsOf(graph.options), state: HierarchyPortState = { graph, constraints, replacements: new Map() }
  if (fixedOrder(constraints)) for (const layer of [layers[0]!, layers[layers.length - 1]!]) {
    const nodes = layer.slice()
    sort(nodes, (a, b) => b.type !== 'EXTERNAL_PORT' ? -1 : a.type !== 'EXTERNAL_PORT' ? 1 : (a.externalPortRatio ?? 0) === (b.externalPortRatio ?? 0) ? 0 : (a.externalPortRatio ?? 0) < (b.externalPortRatio ?? 0) ? -1 : 1)
    let previous: Node | undefined
    for (const node of nodes) {
      if (node.type !== 'EXTERNAL_PORT') break
      if (node.externalPortSide !== 'WEST' && node.externalPortSide !== 'EAST') continue
      if (previous !== undefined) (previous.inLayerSuccessors ??= []).push(node)
      previous = node
    }
  }
  if (!isSideFixed(constraints)) return state
  const count = layers.length, maps: Map<Port | undefined, Node>[] = [new Map(), new Map()], additions: Node[][] = [[], []], originals: Node[] = []
  for (let index = 0; index < count; index++) {
    const previousMap = maps[index]!, nextMap = new Map<Port | undefined, Node>(), previous = additions[index]!, next: Node[] = []
    maps.push(nextMap); additions.push(next)
    for (const node of layers[index]!) {
      if (northSouth(node)) { originals.push(node); continue }
      for (const edge of incoming(node)) if (northSouth(edge.source.node)) {
        const original = edge.source.node, key = original.originPort
        let dummy = previousMap.get(key)
        if (dummy === undefined) { dummy = replacement(original, graph); previousMap.set(key, dummy); previous.push(dummy); state.replacements.set(dummy, original) }
        source(edge, dummy.ports[1]!)
      }
      for (const edge of outgoing(node)) if (northSouth(edge.target.node)) {
        const original = edge.target.node, key = original.originPort
        let dummy = nextMap.get(key)
        if (dummy === undefined) { dummy = replacement(original, graph); nextMap.set(key, dummy); next.push(dummy); state.replacements.set(dummy, original) }
        target(edge, dummy.ports[0]!)
      }
    }
  }
  for (let index = 0; index < additions.length; index++) {
    const nodes = additions[index]!
    if (nodes.length === 0) continue
    let layer: Node[]
    if (index === 0) { layer = []; layers.unshift(layer) }
    else if (index === maps.length - 1) { layer = []; layers.push(layer) }
    else layer = layers[index - 1]!
    for (const node of nodes) setLayer(node, layer, layers)
  }
  for (const node of originals) setLayer(node, undefined, layers)
  state.originals = originals; ranks(layers)
  return state
}
/** HierarchicalPortDummySizeProcessor, after ordering and before placement. */
export function sizeHierarchyPortDummies(layers: Node[][], options: Options, state?: HierarchyPortState): void {
  if (state === undefined) return
  const delta = numberOption(options, 'layered.spacing.edgeEdgeBetweenLayers', 10) * 2
  for (const layer of layers) for (const side of ['NORTH', 'SOUTH'] as const) {
    const nodes = layer.filter(node => node.type === 'EXTERNAL_PORT' && node.externalPortSide === side)
    let width = side === 'NORTH' ? 0.0 : delta * (nodes.length - 1), step = delta
    if (side === 'SOUTH') step *= -1.0
    for (const node of nodes) { node.options.set('alignment', 'CENTER'); node.width = width; for (const port of node.ports) if (port.side === 'EAST') port.x = width; width += step }
  }
}
/** HierarchicalPortPositionProcessor, after graph-height calculation. */
export function positionHierarchyPorts(layers: Node[][], options: Options, geometry: HierarchyPortGeometry, state?: HierarchyPortState): void {
  if (state === undefined) return
  const constraints = constraintsOf(options)
  if (constraints !== 'FIXED_RATIO' && constraints !== 'FIXED_POS') return
  const fix = (layer: Node[]): void => {
    const height = geometry.height + geometry.padding.top + geometry.padding.bottom
    for (const node of layer) if (node.type === 'EXTERNAL_PORT' && (node.externalPortSide === 'EAST' || node.externalPortSide === 'WEST')) {
      let coordinate = node.externalPortRatio ?? 0
      if (constraints === 'FIXED_RATIO') coordinate *= height
      node.y = coordinate - node.externalPortAnchor!.y; node.y = node.y - geometry.padding.top - geometry.offsetY
    }
  }
  if (layers.length > 0) fix(layers[0]!)
  if (layers.length > 1) fix(layers[layers.length - 1]!)
}
function connect(original: Node, dummy: Node): void {
  const port = providePort(dummy, 'OUTPUT', dummy.externalPortSide!, false), input = original.ports[0]!
  const edge: Edge = { data: null, source: port, target: input, options: new Map(), labels: [], sourceLabels: [], priorityDirection: 0, priorityShortness: 0, reversed: false, bends: [] }
  port.outgoing.push(edge); input.incoming.push(edge)
}
function restoreOriginal(node: Node, options: Options): void {
  const port = node.ports[0]!
  if (node.externalPortSide === 'NORTH') port.side = 'SOUTH'
  else if (node.externalPortSide === 'SOUTH') port.side = 'NORTH'
  if (!setOption(options, 'nodeSize.constraints', ['NODE_LABELS', 'PORTS', 'PORT_LABELS', 'MINIMUM_SIZE'], []).has('PORT_LABELS')) return
  const horizontal = numberOption(node.options, 'spacing.labelPortHorizontal', 1), vertical = numberOption(node.options, 'spacing.labelPortVertical', 1), labels = numberOption(node.options, 'spacing.labelLabel', 0)
  const placement = setOption(options, 'portLabels.placement', ['INSIDE', 'OUTSIDE', 'NEXT_TO_PORT_IF_POSSIBLE', 'ALWAYS_SAME_SIDE', 'SPACE_EFFICIENT'], ['OUTSIDE'])
  if (placement.has('INSIDE')) {
    let y = vertical
    const center = node.width / 2 - port.x
    for (const label of port.labels) { label.y = y; label.x = center - label.width / 2; y += label.height + labels }
  } else if (placement.has('OUTSIDE')) for (const label of port.labels) label.x = horizontal + node.width - port.x
  calculateNodeMargins([node])
}
function ascending(nodes: Node[], geometry: HierarchyPortGeometry, options: Options): void {
  if (nodes.length === 0) return
  const spacing = numberOption(options, 'spacing.portPort', 10)
  let next = nodes[0]!.x + nodes[0]!.width + nodes[0]!.margin.right + spacing
  for (let index = 1; index < nodes.length; index++) {
    const node = nodes[index]!, delta = node.x - node.margin.left - next
    if (delta < 0) node.x -= delta
    geometry.width = Math.max(geometry.width, node.x + node.width)
    next = node.x + node.width + node.margin.right + spacing
  }
}
function placeOriginals(nodes: Node[], options: Options, geometry: HierarchyPortGeometry): void {
  const constraints = constraintsOf(options), width = geometry.width + geometry.padding.left + geometry.padding.right, north = 0 - geometry.padding.top - geometry.offsetY, south = geometry.height + geometry.padding.top + geometry.padding.bottom - geometry.offsetY
  const northern: Node[] = [], southern: Node[] = []
  for (const node of nodes) {
    const anchor = node.externalPortAnchor?.x ?? 0
    if (constraints === 'FREE' || constraints === 'FIXED_SIDE' || constraints === 'FIXED_ORDER') {
      const port = node.ports[0]!, degree = port.incoming.length + port.outgoing.length
      if (degree === 0) node.x = 0
      else { let sum = 0.0; for (const edge of port.incoming) { const other = edge.source; sum += other.node.x + other.x + other.anchorX }; for (const edge of port.outgoing) { const other = edge.target; sum += other.node.x + other.x + other.anchorX }; node.x = sum / degree - anchor }
    } else if (constraints === 'FIXED_RATIO') { node.x = width * (node.externalPortRatio ?? 0) - anchor; node.x = node.x - geometry.padding.left - geometry.offsetX }
    else if (constraints === 'FIXED_POS') { node.x = (node.externalPortRatio ?? 0) - anchor; node.x = node.x - geometry.padding.left - geometry.offsetX; geometry.width = Math.max(geometry.width, node.x + node.width / 2.0) }
    if (node.externalPortSide === 'NORTH') { node.y = north; northern.push(node) }
    else if (node.externalPortSide === 'SOUTH') { node.y = south; southern.push(node) }
  }
  if (constraints === 'FREE' || constraints === 'FIXED_SIDE' || constraints === 'FIXED_ORDER') for (const list of [northern, southern]) {
    sort(list, constraints === 'FIXED_ORDER' ? (a, b) => compareNumbers(a.externalPortRatio ?? 0, b.externalPortRatio ?? 0) : (a, b) => compareNumbers(a.x, b.x))
    ascending(list, geometry, options)
  }
}
function removeReplacements(layers: Node[][], state: HierarchyPortState): void {
  const removed: Node[] = []
  for (const layer of layers) for (const node of layer) {
    if (node.type !== 'EXTERNAL_PORT' || !state.replacements.has(node)) continue
    let input: Port | undefined, output: Port | undefined, origin: Port | undefined
    for (const port of node.ports) { if (port.side === 'WEST') input = port; else if (port.side === 'EAST') output = port; else origin = port }
    const connection = origin!.outgoing[0]!, inPoints = connection.bends.map(point => ({ ...point })), outPoints = connection.bends.toReversed().map(point => ({ ...point }))
    inPoints.unshift({ x: origin!.x + node.x, y: origin!.y + node.y }); outPoints.push({ x: origin!.x + node.x, y: origin!.y + node.y })
    const port = state.replacements.get(node)!.ports[0]!
    for (const edge of input!.incoming.slice()) { target(edge, port); edge.bends.push(...inPoints.map(point => ({ ...point }))) }
    for (const edge of output!.outgoing.slice()) { source(edge, port); edge.bends.unshift(...outPoints.map(point => ({ ...point }))) }
    remove(connection.source.outgoing, connection); remove(connection.target.incoming, connection)
    removed.push(node)
  }
  for (const node of removed) setLayer(node, undefined, layers)
  ranks(layers)
}
function fixCoordinates(layers: Node[][], options: Options, geometry: HierarchyPortGeometry): void {
  const constraints = constraintsOf(options)
  for (const layer of [layers[0]!, layers[layers.length - 1]!]) {
    const height = geometry.height + geometry.padding.top + geometry.padding.bottom
    let newHeight = height
    for (const node of layer) if (node.type === 'EXTERNAL_PORT') {
      const side = node.externalPortSide
      if (side === 'EAST') node.x = geometry.width + geometry.padding.right - geometry.offsetX
      else if (side === 'WEST') node.x = -geometry.offsetX - geometry.padding.left
      let required = 0.0
      if ((side === 'EAST' || side === 'WEST') && (constraints === 'FIXED_RATIO' || constraints === 'FIXED_POS')) {
        node.y = (constraints === 'FIXED_RATIO' ? height * (node.externalPortRatio ?? 0) : node.externalPortRatio ?? 0) - node.externalPortAnchor!.y
        required = node.y + node.externalPortSize!.y; node.y = node.y - geometry.padding.top - geometry.offsetY
      }
      newHeight = Math.max(newHeight, required)
    }
    geometry.height += newHeight - height
    for (const node of layer) if (node.type === 'EXTERNAL_PORT') {
      if (node.externalPortSide === 'NORTH') node.y = -geometry.offsetY - geometry.padding.top
      else if (node.externalPortSide === 'SOUTH') node.y = geometry.height + geometry.padding.bottom - geometry.offsetY
    }
  }
}
/** HierarchicalPortOrthogonalEdgeRouter, after ordinary edge routing. */
export function routeHierarchyPorts(layers: Node[][], options: Options, geometry: HierarchyPortGeometry, state?: HierarchyPortState): void {
  if (state === undefined) return
  const restored: Node[] = []
  if (state.originals !== undefined) {
    for (const node of state.originals) { restoreOriginal(node, options); restored.push(node) }
    for (const layer of layers) for (const node of layer) if (node.type === 'EXTERNAL_PORT') { const original = state.replacements.get(node); if (original !== undefined) connect(original, node) }
    for (const node of restored) setLayer(node, layers[layers.length - 1]!, layers)
    ranks(layers)
  }
  placeOriginals(restored, options, geometry)
  const northernSource = new Set<Node>(), northernTarget = new Set<Node>(), southernSource = new Set<Node>(), southernTarget = new Set<Node>()
  for (const node of restored) {
    const north = node.externalPortSide === 'NORTH', south = node.externalPortSide === 'SOUTH'
    if (!north && !south) continue
    const sources = north ? northernSource : southernSource, targets = north ? northernTarget : southernTarget
    targets.add(node); for (const edge of incoming(node)) sources.add(edge.source.node)
  }
  const nodeSpacing = numberOption(options, 'spacing.nodeNode', 20), edgeSpacing = numberOption(options, 'spacing.edgeEdge', 10)
  if (northernSource.size > 0) {
    if (state.graph.random === undefined) throw new Error('Hierarchical edge routing requires the prepared graph random stream.')
    const slots = routeOrthogonalGap([...northernSource], [...northernTarget], 'SOUTH_TO_NORTH', -nodeSpacing - geometry.offsetY, edgeSpacing, state.graph.random)
    if (slots > 0) { const height = nodeSpacing + (slots - 1) * edgeSpacing; geometry.offsetY += height; geometry.height += height }
  }
  if (southernSource.size > 0) {
    if (state.graph.random === undefined) throw new Error('Hierarchical edge routing requires the prepared graph random stream.')
    const slots = routeOrthogonalGap([...southernSource], [...southernTarget], 'NORTH_TO_SOUTH', geometry.height + nodeSpacing - geometry.offsetY, edgeSpacing, state.graph.random)
    if (slots > 0) geometry.height += nodeSpacing + (slots - 1) * edgeSpacing
  }
  removeReplacements(layers, state); fixCoordinates(layers, options, geometry)
  for (const layer of [layers[0]!, layers[layers.length - 1]!]) for (const node of layer) if (node.type === 'EXTERNAL_PORT' && (node.externalPortSide === 'EAST' || node.externalPortSide === 'WEST')) for (const port of node.ports) for (const edge of port.incoming.concat(port.outgoing)) {
    if (edge.bends.length === 0) continue
    if (edge.source.node === node) edge.bends[0]!.y = edge.source.node.y + edge.source.y + edge.source.anchorY
    if (edge.target.node === node) edge.bends[edge.bends.length - 1]!.y = edge.target.node.y + edge.target.y + edge.target.anchorY
  }
}
