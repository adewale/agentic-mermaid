/*******************************************************************************
 * Copyright (c) 2012, 2016, 2022 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { CycleEdge, CycleNode, CyclePort } from './cycle-breaking.ts'
import { arrayMember, elementId, elementKey, isJsonObject, jsonValue, numberMember, objectMember, primitiveString, readMember, type JsonObject } from './json.ts'
import { booleanOption, enumOption, importOptions, importOptionObject, integerOption, numberOption, paddingOption, optionalNumberOption, optionalIntegerOption, optionalVectorOption, vectorOption, type Direction, type Insets, type Options } from './options.ts'
import type { ElkExtendedEdge, ElkLabel, ElkNode, ElkPort } from './types.ts'

export interface LayoutLabel { data: ElkLabel; text: string | null; active: boolean; inputX: number; inputY: number; inputWidth: number; inputHeight: number; x: number; y: number; width: number; height: number; options: Options }
export interface LayoutPort extends CyclePort { portDummy?: LayoutNode; originPort?: LayoutPort; index?: number; modelOrder?: number; longEdgeTargetNode?: LayoutNode; key: string | number | null; id: string | null; options: Options; labels: LayoutLabel[]; sourceLabels: LayoutLabel[]; borderOffset: number | null; ratio: number; explicitAnchor: boolean; data: ElkPort | null; node: LayoutNode; incoming: LayoutEdge[]; outgoing: LayoutEdge[]; x: number; y: number; width: number; height: number; side: 'UNDEFINED' | 'NORTH' | 'EAST' | 'SOUTH' | 'WEST'; collect: 'INPUT' | 'OUTPUT' | null; anchorX: number; anchorY: number }
export interface LayoutEdge extends CycleEdge { modelOrder?: number; data: ElkExtendedEdge; source: LayoutPort; target: LayoutPort; priorityDirection: number; priorityShortness: number; reversed: boolean; options: Options; labels: LayoutLabel[]; sourceLabels: LayoutLabel[]; bends: { x: number; y: number }[]; junctions?: { x: number; y: number }[] }
export type LayoutNodeType = 'NORMAL' | 'LONG_EDGE' | 'EXTERNAL_PORT' | 'NORTH_SOUTH_PORT' | 'LABEL' | 'BREAKING_POINT' | 'PLACEHOLDER' | 'NONSHIFTING_PLACEHOLDER'
export type PortConstraints = 'UNDEFINED' | 'FREE' | 'FIXED_SIDE' | 'FIXED_ORDER' | 'FIXED_RATIO' | 'FIXED_POS'
export interface LayoutNode extends CycleNode {
  type: LayoutNodeType
  externalPortSide?: LayoutPort['side']
  crossingMinimizationGroupId: number
  crossingMinimizationGroupIdentity: number | object
  margin: Insets
  padding: Insets
  minimumSize: { x: number; y: number }
  position?: { x: number; y: number }
  inLayerConstraint?: 'NONE' | 'TOP' | 'BOTTOM'
  individualSpacings: Options
  portConstraints: PortConstraints
  originalPortConstraints?: PortConstraints
  inLayerSuccessors?: LayoutNode[]
  inLayerLayoutUnit?: LayoutNode
  barycenterAssociates?: LayoutNode[]
  longEdgeTarget?: LayoutPort
  longEdgeSource?: LayoutPort
  longEdgeHasLabelDummies?: boolean
  targetNodeModelOrder?: Map<LayoutNode, number>
  data: ElkNode | null
  id: string
  key: string | number | null
  sourceIndex: number
  options: Options
  x: number
  y: number
  width: number
  height: number
  priority: number
  ports: LayoutPort[]
  sourcePorts: LayoutPort[]
  labels: LayoutLabel[]
  sourceLabels: LayoutLabel[]
  children: LayoutNode[]
  rank: number
  noLayout: boolean
}
export interface LayoutGraph {
  data: ElkNode
  id: string | null
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  options: Options
  labels: LayoutLabel[]
  padding: Insets
  direction: Direction
  offsetX: number
  offsetY: number
  maxModelOrderNodes: number
  modelOrderGroupCount: number
  x: number
  y: number
  width: number
  height: number
}

// The importer keeps original JSON objects for emission. Input order, phase
// order, and source ownership are separate from mutable layer/component arrays.
export function importGraph(data: ElkNode): LayoutGraph {
  elementId(data)
  const id = primitiveString(readMember(data, 'id'))
  const options = importOptions(data)
  readIndividualSpacings(data)
  const x = numberMember(data, 'x'), y = numberMember(data, 'y'), width = numberMember(data, 'width'), height = numberMember(data, 'height')
  const ports = arrayMember(data, 'ports')
  if (ports?.some(port => isJsonObject(jsonValue(port)))) throw new Error('ELK TypeScript port: graph ports are not implemented yet')
  const aspectRatio = numberOption(options, 'aspectRatio', 1.600000023841858)
  const requested = enumOption(options, 'direction', ['UNDEFINED', 'RIGHT', 'LEFT', 'DOWN', 'UP'] as const, 'UNDEFINED')
  const direction = requested === 'UNDEFINED' ? aspectRatio >= 1 ? 'RIGHT' : 'DOWN' : requested
  const labels = importLabels(data)
  const nodes: LayoutNode[] = []
  const children = arrayMember(data, 'children')
  if (children !== null) for (let index = 0; index < children.length; index++) {
    const child = jsonValue(children[index])
    if (isJsonObject(child)) nodes.push(importNode(child, index, direction))
  }
  for (const node of nodes) if (node.children.length > 0) throw new Error('ELK TypeScript port: hierarchy layout is not implemented yet')
  const graph: LayoutGraph = { data, id, nodes, edges: [], options, labels, padding: paddingOption(options, { top: 12, right: 12, bottom: 12, left: 12 }), offsetX: 0, offsetY: 0, maxModelOrderNodes: 0, modelOrderGroupCount: 0, direction, x, y, width, height }
  importEdges(graph)
  assignModelOrder(graph)
  return graph
}
function importNode(data: JsonObject, sourceIndex: number, direction: Direction): LayoutNode {
  const key = elementKey(data), id = primitiveString(readMember(data, 'id')) ?? ''
  const options = importOptions(data), individualSpacings = readIndividualSpacings(data)
  const x = numberMember(data, 'x'), y = numberMember(data, 'y'), width = numberMember(data, 'width'), height = numberMember(data, 'height')
  const crossingMinimizationGroupId = integerOption(options, 'layered.considerModelOrder.groupModelOrder.crossingMinimizationId', 0)
  const node: LayoutNode = { padding: { top: 0, right: 0, bottom: 0, left: 0 }, minimumSize: vectorOption(options, 'nodeSize.minimum'), position: optionalVectorOption(options, 'position'), crossingMinimizationGroupId, crossingMinimizationGroupIdentity: crossingMinimizationGroupId >= -128 && crossingMinimizationGroupId <= 127 ? crossingMinimizationGroupId : {}, margin: { top: 0, right: 0, bottom: 0, left: 0 }, individualSpacings, type: 'NORMAL', portConstraints: enumOption(options, 'portConstraints', ['UNDEFINED', 'FREE', 'FIXED_SIDE', 'FIXED_ORDER', 'FIXED_RATIO', 'FIXED_POS'] as const, 'FREE'), data: data as unknown as ElkNode, id, key, sourceIndex, options, x, y, width, height, ports: [], sourcePorts: [], labels: [], sourceLabels: [], children: [], rank: 0, priority: integerOption(options, 'priority', 0), noLayout: booleanOption(options, 'noLayout', false) }
  const portData = arrayMember(data, 'ports')
  if (portData !== null) for (let index = 0; index < portData.length; index++) { const port = jsonValue(portData[index]); if (isJsonObject(port)) node.ports.push(importPort(port, node, direction)) }
  node.sourcePorts = node.ports.slice()
  node.sourceLabels = importLabels(data)
  node.labels = node.sourceLabels.filter(label => label.active)
  const childData = arrayMember(data, 'children')
  if (childData !== null) for (let index = 0; index < childData.length; index++) { const child = jsonValue(childData[index]); if (isJsonObject(child)) node.children.push(importNode(child, index, direction)) }
  return node
}
function importLabels(data: object): LayoutLabel[] {
  const result: LayoutLabel[] = [], labels = arrayMember(data, 'labels')
  if (labels === null) return result
  for (let index = 0; index < labels.length; index++) {
    const label = jsonValue(labels[index])
    if (!isJsonObject(label)) continue
    // Labels do not require identifiers. Text is read even though it stays in
    // its authored JSON member; the graph importer preserves primitive coercion.
    const text = primitiveString(readMember(label, 'text'))
    if ('id' in label) primitiveString(readMember(label, 'id'))
    const options = importOptions(label)
    const x = numberMember(label, 'x'), y = numberMember(label, 'y'), width = numberMember(label, 'width'), height = numberMember(label, 'height')
    result.push({ data: label as ElkLabel, text, active: text !== null && text.length > 0 && !booleanOption(options, 'noLayout', false), inputX: x, inputY: y, inputWidth: width, inputHeight: height, options, x, y, width, height })
  }
  return result
}
function readIndividualSpacings(data: object): Options { const raw = objectMember(data, 'individualSpacings'); return raw === null ? new Map() : importOptionObject(raw) }

function importEdges(graph: LayoutGraph): void {
  const ids = new Map<string | number, LayoutNode>()
  for (const node of graph.nodes) if (node.key !== null) ids.set(node.key, node)
  const portIds = new Map<string | number, LayoutPort>()
  for (const node of graph.nodes) for (const port of node.ports) if (port.key !== null) portIds.set(port.key, port)
  const edgeData = arrayMember(graph.data, 'edges')
  if (edgeData === null) return
  for (let index = 0; index < edgeData.length; index++) {
    const data = jsonValue(edgeData[index])
    if (!isJsonObject(data)) continue
    const id = elementId(data)
    primitiveString(readMember(data, 'id'))
    const sources = arrayMember(data, 'sources'), targets = arrayMember(data, 'targets')
    const resolve = (values: unknown[] | null): (LayoutNode | LayoutPort)[] => {
      const result: (LayoutNode | LayoutPort)[] = []
      if (values !== null) for (let i = 0; i < values.length; i++) {
        const key = elementKey({ id: jsonValue(values[i]) }), node = ids.get(key) ?? portIds.get(key)
        if (node === undefined) throw new Error('Referenced shape does not exist: ' + key)
        if (!result.includes(node)) result.push(node)
      }
      return result
    }
    const sourceNodes = resolve(sources), targetNodes = resolve(targets)
    if (sourceNodes.length === 0 || targetNodes.length === 0) throw new Error("An edge must have at least one source and one target (edge id: '" + id + "').")
    const options = importOptions(data)
    if (arrayMember(data, 'sections')?.length) throw new Error('ELK TypeScript port: authored edge sections are not implemented yet')
    const sourceLabels = importLabels(data), labels = sourceLabels.filter(label => label.active)
    if (sourceNodes.length !== 1 || targetNodes.length !== 1) throw new Error('ELK TypeScript port: hyperedge transformation is not implemented yet')
    const sourceShape = sourceNodes[0]!, targetShape = targetNodes[0]!
    const source = 'node' in sourceShape ? sourceShape : createPort(graph, sourceShape, 'OUTPUT'), target = 'node' in targetShape ? targetShape : createPort(graph, targetShape, 'INPUT')
    const edge: LayoutEdge = { data: data as unknown as ElkExtendedEdge, source, target, options, labels, sourceLabels, reversed: false, priorityDirection: integerOption(options, 'layered.priority.direction', 0), priorityShortness: integerOption(options, 'layered.priority.shortness', 0), bends: [] }
    source.outgoing.push(edge); target.incoming.push(edge); graph.edges.push(edge)
  }
}
export function createPort(graph: LayoutGraph, node: LayoutNode, type: 'INPUT' | 'OUTPUT'): LayoutPort {
  const constraints = enumOption(node.options, 'portConstraints', ['UNDEFINED', 'FREE', 'FIXED_SIDE', 'FIXED_ORDER', 'FIXED_RATIO', 'FIXED_POS'] as const, 'UNDEFINED')
  if (constraints !== 'UNDEFINED' && constraints !== 'FREE') throw new Error('ELK TypeScript port: constrained port initialization is not implemented yet')
  const collect = booleanOption(graph.options, 'layered.mergeEdges', false) || booleanOption(node.options, 'layered.hypernode', false)
  const side = graph.direction === 'RIGHT' ? type === 'OUTPUT' ? 'EAST' : 'WEST' : graph.direction === 'LEFT' ? type === 'OUTPUT' ? 'WEST' : 'EAST' : graph.direction === 'DOWN' ? type === 'OUTPUT' ? 'SOUTH' : 'NORTH' : type === 'OUTPUT' ? 'NORTH' : 'SOUTH'
  return providePort(node, type, side, collect)
}
export function providePort(node: LayoutNode, type: 'INPUT' | 'OUTPUT', side: LayoutPort['side'], collect: boolean): LayoutPort {
  if (collect) { const existing = node.ports.find(port => port.collect === type); if (existing !== undefined) return existing }
  const port: LayoutPort = { key: null, id: null, options: new Map(), labels: [], sourceLabels: [], borderOffset: null, ratio: 0, explicitAnchor: false, data: null, node, incoming: [], outgoing: [], x: 0, y: 0, width: 0, height: 0, side, collect: collect ? type : null, anchorX: 0, anchorY: 0 }
  if (collect) {
    if (side === 'EAST') { port.x = node.width; port.y = node.height / 2 }
    else if (side === 'WEST') port.y = node.height / 2
    else if (side === 'SOUTH') { port.x = node.width / 2; port.y = node.height }
    else if (side === 'NORTH') port.x = node.width / 2
  }
  node.ports.push(port)
  return port
}
export function reverseEdge(edge: LayoutEdge, adaptPorts: boolean): void {
  const source = edge.source, target = edge.target
  source.outgoing.splice(source.outgoing.indexOf(edge), 1)
  target.incoming.splice(target.incoming.indexOf(edge), 1)
  edge.source = adaptPorts && target.collect === 'INPUT' ? providePort(target.node, 'OUTPUT', 'EAST', true) : target
  edge.target = adaptPorts && source.collect === 'OUTPUT' ? providePort(source.node, 'INPUT', 'WEST', true) : source
  edge.source.outgoing.push(edge); edge.target.incoming.push(edge)
  for (const label of edge.labels) {
    const placement = enumOption(label.options, 'edgeLabels.placement', ['CENTER', 'HEAD', 'TAIL'] as const, 'CENTER')
    if (placement === 'HEAD') label.options.set('edgeLabels.placement', 'TAIL')
    else if (placement === 'TAIL') label.options.set('edgeLabels.placement', 'HEAD')
  }
  edge.reversed = !edge.reversed
  edge.bends.reverse()
}

function importPort(data: JsonObject, node: LayoutNode, direction: Direction): LayoutPort {
  const key = elementKey(data), id = primitiveString(readMember(data, 'id')), options = importOptions(data)
  const x = numberMember(data, 'x'), y = numberMember(data, 'y'), width = numberMember(data, 'width'), height = numberMember(data, 'height'), sourceLabels = importLabels(data), labels = sourceLabels.filter(label => label.active)
  const port: LayoutPort = { data: data as unknown as ElkPort, key, id, index: optionalIntegerOption(options, 'port.index'), options, labels, sourceLabels, node, incoming: [], outgoing: [], x, y, width, height, side: enumOption(options, 'port.side', ['UNDEFINED', 'NORTH', 'EAST', 'SOUTH', 'WEST'] as const, 'UNDEFINED'), collect: null, anchorX: 0, anchorY: 0, borderOffset: optionalNumberOption(options, 'port.borderOffset') ?? null, ratio: 0, explicitAnchor: false }
  const fixed = isSideFixed(node.portConstraints)
  if (port.side === 'UNDEFINED' && fixed) {
    port.side = calculatePortSide(port, direction)
    if (port.borderOffset === null && port.side !== 'UNDEFINED' && (x !== 0 || y !== 0)) port.borderOffset = port.side === 'NORTH' ? -(y + height) : port.side === 'EAST' ? x - node.width : port.side === 'SOUTH' ? y - node.height : -(x + width)
  }
  if (node.portConstraints === 'FIXED_RATIO') {
    if ((port.side === 'NORTH' || port.side === 'SOUTH') && node.width > 0) port.ratio = x / node.width
    else if ((port.side === 'EAST' || port.side === 'WEST') && node.height > 0) port.ratio = y / node.height
  }
  const anchor = optionalVectorOption(options, 'port.anchor')
  if (anchor !== undefined) { port.anchorX = anchor.x; port.anchorY = anchor.y; port.explicitAnchor = true }
  else if (fixed && port.side !== 'UNDEFINED') {
    if (port.side === 'NORTH') port.anchorX = width / 2
    else if (port.side === 'EAST') { port.anchorX = width; port.anchorY = height / 2 }
    else if (port.side === 'SOUTH') { port.anchorX = width / 2; port.anchorY = height }
    else port.anchorY = height / 2
  } else { port.anchorX = width / 2; port.anchorY = height / 2 }
  return port
}
export function isSideFixed(constraints: PortConstraints): boolean { return constraints !== 'FREE' && constraints !== 'UNDEFINED' }
function calculatePortSide(port: LayoutPort, direction: Direction): LayoutPort['side'] {
  const node = port.node, width = node.width, height = node.height, x = port.x, y = port.y
  if (width <= 0 && height <= 0) return 'UNDEFINED'
  if (direction === 'LEFT' || direction === 'RIGHT') { if (x < 0) return 'WEST'; if (x + port.width > width) return 'EAST' }
  else { if (y < 0) return 'NORTH'; if (y + port.height > height) return 'SOUTH' }
  const widthPercent = (x + port.width / 2) / width, heightPercent = (y + port.height / 2) / height
  if (widthPercent + heightPercent <= 1 && widthPercent - heightPercent <= 0) return 'WEST'
  if (widthPercent + heightPercent >= 1 && widthPercent - heightPercent >= 0) return 'EAST'
  return heightPercent < 0.5 ? 'NORTH' : 'SOUTH'
}

function assignModelOrder(graph: LayoutGraph): void {
  const options = graph.options
  const cycle = enumOption(options, 'layered.cycleBreaking.strategy', ['GREEDY', 'DEPTH_FIRST', 'INTERACTIVE', 'MODEL_ORDER', 'GREEDY_MODEL_ORDER', 'SCC_CONNECTIVITY', 'SCC_NODE_TYPE', 'DFS_NODE_ORDER', 'BFS_NODE_ORDER'] as const, 'GREEDY')
  const layering = enumOption(options, 'layered.layering.strategy', ['NETWORK_SIMPLEX', 'LONGEST_PATH', 'LONGEST_PATH_SOURCE', 'COFFMAN_GRAHAM', 'INTERACTIVE', 'STRETCH_WIDTH', 'MIN_WIDTH', 'BF_MODEL_ORDER', 'DF_MODEL_ORDER'] as const, 'NETWORK_SIMPLEX')
  const promotion = enumOption(options, 'layered.layering.nodePromotion.strategy', ['NONE', 'NIKOLOV', 'NIKOLOV_PIXEL', 'NIKOLOV_IMPROVED', 'NIKOLOV_IMPROVED_PIXEL', 'DUMMYNODE_PERCENTAGE', 'NODECOUNT_PERCENTAGE', 'NO_BOUNDARY', 'MODEL_ORDER_LEFT_TO_RIGHT', 'MODEL_ORDER_RIGHT_TO_LEFT'] as const, 'NONE')
  const needs = ['MODEL_ORDER', 'BFS_NODE_ORDER', 'DFS_NODE_ORDER', 'GREEDY_MODEL_ORDER', 'SCC_CONNECTIVITY', 'SCC_NODE_TYPE'].includes(cycle) || layering === 'BF_MODEL_ORDER' || layering === 'DF_MODEL_ORDER' || promotion === 'MODEL_ORDER_LEFT_TO_RIGHT' || promotion === 'MODEL_ORDER_RIGHT_TO_LEFT' || enumOption(options, 'layered.considerModelOrder.strategy', ['NONE', 'NODES_AND_EDGES', 'PREFER_EDGES', 'PREFER_NODES'] as const, 'NONE') !== 'NONE' || booleanOption(options, 'layered.crossingMinimization.forceNodeModelOrder', false) || enumOption(options, 'layered.considerModelOrder.components', ['NONE', 'INSIDE_PORT_SIDE_GROUPS', 'GROUP_MODEL_ORDER', 'MODEL_ORDER'] as const, 'NONE') !== 'NONE' || numberOption(options, 'layered.considerModelOrder.crossingCounterNodeInfluence', 0) !== 0 || numberOption(options, 'layered.considerModelOrder.crossingCounterPortInfluence', 0) !== 0
  const hierarchical = enumOption(options, 'hierarchyHandling', ['INHERIT', 'SEPARATE_CHILDREN', 'INCLUDE_CHILDREN'] as const, 'INHERIT') === 'INCLUDE_CHILDREN'
  let index = 0
  const groups = new Set<number>()
  for (const node of graph.nodes) {
    if (needs && !booleanOption(node.options, 'layered.considerModelOrder.noModelOrder', false) && (hierarchical || !node.noLayout)) {
      node.modelOrder = index++
      if (optionalIntegerOption(node.options, 'layered.considerModelOrder.groupModelOrder.cycleBreakingId') !== undefined) groups.add(integerOption(node.options, 'layered.considerModelOrder.groupModelOrder.cycleBreakingId', 0))
      for (let portIndex = 0; portIndex < node.sourcePorts.length; portIndex++) node.sourcePorts[portIndex]!.modelOrder = portIndex
    }
    node.layerConstraint = enumOption(node.options, 'layered.layering.layerConstraint', ['NONE', 'FIRST', 'FIRST_SEPARATE', 'LAST', 'LAST_SEPARATE'] as const, 'NONE')
    node.cycleBreakingGroupId = integerOption(node.options, 'layered.considerModelOrder.groupModelOrder.cycleBreakingId', 0)
  }
  graph.maxModelOrderNodes = index; graph.modelOrderGroupCount = groups.size
  if (needs) for (let edgeIndex = 0; edgeIndex < graph.edges.length; edgeIndex++) graph.edges[edgeIndex]!.modelOrder = edgeIndex
}
