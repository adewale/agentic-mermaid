/*******************************************************************************
 * Copyright (c) 2012, 2016, 2022 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { CycleEdge, CycleNode, CyclePort } from './cycle-breaking.ts'
import { arrayMember, elementId, elementKey, isJsonObject, jsonValue, numberMember, objectMember, primitiveString, readMember, type JsonObject } from './json.ts'
import { booleanOption, enumOption, optionalEnumOption, importOptions, importOptionObject, integerOption, numberOption, paddingOption, optionalNumberOption, optionalIntegerOption, optionalVectorOption, vectorOption, type Direction, type Insets, type Options } from './options.ts'

export interface LayoutLabel {
  originalLabelEdge?: LayoutEdge
  endLabelEdge?: LayoutEdge
  labelSide?: 'UNKNOWN' | 'ABOVE' | 'BELOW' | 'INLINE'
  data: object
  text: string | null
  active: boolean
  inputX: number
  inputY: number
  inputWidth: number
  inputHeight: number
  x: number
  y: number
  width: number
  height: number
  options: Options
}

export interface LayoutPort extends CyclePort {
  insideConnections?: boolean
  connectedToExternalNodes?: boolean
  portDummy?: LayoutNode
  originPort?: LayoutPort
  index?: number
  modelOrder?: number
  longEdgeTargetNode?: LayoutNode
  key: string | number | null
  id: string | null
  options: Options
  labels: LayoutLabel[]
  sourceLabels: LayoutLabel[]
  borderOffset: number | null
  ratio: number
  explicitAnchor: boolean
  data: object | null
  node: LayoutNode
  incoming: LayoutEdge[]
  outgoing: LayoutEdge[]
  x: number
  y: number
  width: number
  height: number
  side: 'UNDEFINED' | 'NORTH' | 'EAST' | 'SOUTH' | 'WEST'
  collect: 'INPUT' | 'OUTPUT' | null
  anchorX: number
  anchorY: number
}

export interface LayoutEdge extends CycleEdge {
  containerGraph?: LayoutGraph
  containerId?: string | null
  coordinateOrigin?: LayoutGraph
  targetOffset?: { x: number; y: number }
  noLayout?: false
  sourceShapeKey?: string | number | null
  targetShapeKey?: string | number | null
  modelOrder?: number
  data: object | null
  source: LayoutPort
  target: LayoutPort
  priorityDirection: number
  priorityShortness: number
  reversed: boolean
  options: Options
  labels: LayoutLabel[]
  sourceLabels: LayoutLabel[]
  bends: { x: number; y: number }[]
  junctions?: { x: number; y: number }[]
}

export interface SkippedLayoutEdge {
  sourceShape?: LayoutNode | LayoutPort
  targetShape?: LayoutNode | LayoutPort
  containerGraph?: LayoutGraph
  containerId?: string | null
  noLayout: true
  data: object
  options: Options
  sourceLabels: LayoutLabel[]
}

export type LayoutNodeType = 'NORMAL' | 'LONG_EDGE' | 'EXTERNAL_PORT' | 'NORTH_SOUTH_PORT' | 'LABEL' | 'BREAKING_POINT' | 'PLACEHOLDER' | 'NONSHIFTING_PLACEHOLDER'
export type PortConstraints = 'UNDEFINED' | 'FREE' | 'FIXED_SIDE' | 'FIXED_ORDER' | 'FIXED_RATIO' | 'FIXED_POS'
export interface LayoutNode extends CycleNode {
  northSouthOrigin?: LayoutNode | LayoutEdge
  parent?: LayoutNode
  contentGraph?: LayoutGraph
  nestedGraph?: LayoutGraph
  layoutGraph?: LayoutGraph
  type: LayoutNodeType
  externalPortSide?: LayoutPort['side']
  originPort?: LayoutPort
  externalPortSize?: { x: number; y: number }
  externalPortAnchor?: { x: number; y: number }
  externalPortBorderOffset?: number
  externalPortRatio?: number
  edgeConstraint?: 'NONE' | 'INCOMING_ONLY' | 'OUTGOING_ONLY'
  layerConstraintSet?: boolean
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
  longEdgeBeforeLabelDummy?: boolean
  targetNodeModelOrder?: Map<LayoutNode, number>
  data: object | null
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
export interface GraphGeometry {
  width: number
  height: number
  offsetX: number
  offsetY: number
  padding: Insets
  options: Options
}

export interface LayoutGraph {
  hasHyperedges?: boolean
  geometry?: GraphGeometry
  hasExternalPorts?: boolean
  layerlessNodes?: LayoutNode[]
  ownerNode?: LayoutNode
  layers?: LayoutNode[][]
  phaseOptions?: Options
  random?: import('./random.ts').Random
  parentNode?: LayoutNode
  data: object
  id: string | null
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  sourceEdges: (LayoutEdge | SkippedLayoutEdge)[]
  containedEdges: (LayoutEdge | SkippedLayoutEdge)[]
  options: Options
  labels: LayoutLabel[]
  padding: Insets
  direction: Direction
  offsetX: number
  offsetY: number
  maxModelOrderNodes?: number
  modelOrderGroupCount?: number
  x: number
  y: number
  width: number
  height: number
}

// The importer keeps original JSON objects for emission. Input order, phase
// order, and source ownership are separate from mutable layer/component arrays.
export function importGraph(data: object): LayoutGraph {
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
    if (isJsonObject(child)) nodes.push(importNode(child, index))
  }
  const graph: LayoutGraph = { data, id, nodes, edges: [], sourceEdges: [], containedEdges: [], options, labels, padding: paddingOption(options, { top: 12, right: 12, bottom: 12, left: 12 }), offsetX: 0, offsetY: 0, maxModelOrderNodes: 0, modelOrderGroupCount: 0, direction, x, y, width, height }
  const ids = new Map<string | number, LayoutNode>(), portIds = new Map<string | number, LayoutPort>(), graphs: LayoutGraph[] = []
  const register = (nodes: LayoutNode[]): void => { for (const node of nodes) { if (node.key !== null) ids.set(node.key, node); for (const port of node.sourcePorts) if (port.key !== null) portIds.set(port.key, port); register(node.children) } }
  register(nodes)
  const buildGraphs = (current: LayoutGraph, inherited: 'SEPARATE_CHILDREN' | 'INCLUDE_CHILDREN', compoundRoot?: LayoutGraph): void => {
    const requested = enumOption(current.options, 'hierarchyHandling', ['INHERIT', 'SEPARATE_CHILDREN', 'INCLUDE_CHILDREN'] as const, 'INHERIT')
    const handling = requested === 'INHERIT' ? inherited : requested
    current.options.set('hierarchyHandling', handling); graphs.push(current)
    const compound = handling === 'INCLUDE_CHILDREN' ? compoundRoot ?? current : undefined
    if (compound !== undefined) { current.direction = compound.direction; current.options.set('direction', compound.direction) }
    for (const node of current.nodes) {
      node.layoutGraph = current
      if (!node.noLayout && booleanOption(node.options, 'hypernode', false)) throw new Error('ELK TypeScript port: hypernodes are not implemented yet')
      for (const port of node.sourcePorts) initializePort(port, current.direction)
      const requestedHandling = enumOption(node.options, 'hierarchyHandling', ['INHERIT', 'SEPARATE_CHILDREN', 'INCLUDE_CHILDREN'] as const, 'INHERIT')
      const nodeHandling = requestedHandling === 'INHERIT' ? handling : requestedHandling
      node.options.set('hierarchyHandling', nodeHandling)
      if (node.children.length === 0 || node.noLayout) continue
      const options = new Map(node.options), requested = enumOption(options, 'direction', ['UNDEFINED', 'RIGHT', 'LEFT', 'DOWN', 'UP'] as const, 'UNDEFINED'), aspect = numberOption(options, 'aspectRatio', 1.600000023841858), direction = requested === 'UNDEFINED' ? aspect >= 1 ? 'RIGHT' : 'DOWN' : requested
      const nested: LayoutGraph = { ownerNode: node, data: node.data!, id: node.id, nodes: node.children, edges: [], sourceEdges: [], containedEdges: [], options, labels: [], padding: paddingOption(options, { top: 12, right: 12, bottom: 12, left: 12 }), direction, offsetX: 0, offsetY: 0, maxModelOrderNodes: 0, modelOrderGroupCount: 0, x: node.x, y: node.y, width: node.width, height: node.height }
      node.contentGraph = nested
      if (compound !== undefined && nodeHandling === 'INCLUDE_CHILDREN') { node.nestedGraph = nested; nested.parentNode = node }
      buildGraphs(nested, handling, node.nestedGraph !== undefined ? compound : undefined)
    }
  }
  buildGraphs(graph, 'SEPARATE_CHILDREN')
  for (const current of graphs) { importEdges(current, ids, portIds); assignModelOrder(current) }
  for (const current of graphs) if (current.nodes.some(node => node.nestedGraph !== undefined) && (current.parentNode === undefined || current.parentNode.nestedGraph !== current)) assignCompoundModelOrder(current)
  return graph
}
function importNode(data: JsonObject, sourceIndex: number): LayoutNode {
  const key = elementKey(data), id = primitiveString(readMember(data, 'id')) ?? ''
  const options = importOptions(data), individualSpacings = readIndividualSpacings(data)
  const x = numberMember(data, 'x'), y = numberMember(data, 'y'), width = numberMember(data, 'width'), height = numberMember(data, 'height')
  const crossingMinimizationGroupId = integerOption(options, 'layered.considerModelOrder.groupModelOrder.crossingMinimizationId', 0)
  const node: LayoutNode = { padding: { top: 0, right: 0, bottom: 0, left: 0 }, minimumSize: vectorOption(options, 'nodeSize.minimum'), position: optionalVectorOption(options, 'position'), crossingMinimizationGroupId, crossingMinimizationGroupIdentity: crossingMinimizationGroupId >= -128 && crossingMinimizationGroupId <= 127 ? crossingMinimizationGroupId : {}, margin: { top: 0, right: 0, bottom: 0, left: 0 }, individualSpacings, type: 'NORMAL', portConstraints: enumOption(options, 'portConstraints', ['UNDEFINED', 'FREE', 'FIXED_SIDE', 'FIXED_ORDER', 'FIXED_RATIO', 'FIXED_POS'] as const, 'FREE'), data, id, key, sourceIndex, options, x, y, width, height, ports: [], sourcePorts: [], labels: [], sourceLabels: [], children: [], rank: 0, priority: integerOption(options, 'priority', 0), noLayout: booleanOption(options, 'noLayout', false) }
  const portData = arrayMember(data, 'ports')
  if (portData !== null) for (let index = 0; index < portData.length; index++) { const port = jsonValue(portData[index]); if (isJsonObject(port)) node.ports.push(importPort(port, node)) }
  node.sourcePorts = node.ports.slice()
  node.ports = node.ports.filter(port => !booleanOption(port.options, 'noLayout', false))
  node.sourceLabels = importLabels(data)
  node.labels = node.sourceLabels.filter(label => label.active)
  const childData = arrayMember(data, 'children')
  if (childData !== null) for (let index = 0; index < childData.length; index++) { const child = jsonValue(childData[index]); if (isJsonObject(child)) { const imported = importNode(child, index); imported.parent = node; node.children.push(imported) } }
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
    result.push({ data: label, text, active: text !== null && text.length > 0 && !booleanOption(options, 'noLayout', false), inputX: x, inputY: y, inputWidth: width, inputHeight: height, options, x, y, width, height })
  }
  return result
}
function readIndividualSpacings(data: object): Options { const raw = objectMember(data, 'individualSpacings'); return raw === null ? new Map() : importOptionObject(raw) }

function importEdges(graph: LayoutGraph, ids: Map<string | number, LayoutNode>, portIds: Map<string | number, LayoutPort>): void {
  const edgeData = arrayMember(graph.data, 'edges')
  if (edgeData === null) return
  for (let index = 0; index < edgeData.length; index++) {
    const data = jsonValue(edgeData[index])
    if (!isJsonObject(data)) continue
    const id = elementId(data)
    const identifier = primitiveString(readMember(data, 'id'))
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
    const isDescendant = (child: LayoutNode, parent: LayoutNode): boolean => { for (let node = child.parent; node !== undefined; node = node.parent) if (node === parent) return true; return false }
    for (const source of sourceNodes) if ('node' in source && source.insideConnections !== undefined) for (const target of targetNodes) { const targetNode = 'node' in target ? target.node : target; if (isDescendant(targetNode, source.node) || targetNode === source.node && booleanOption(options, 'insideSelfLoops.yo', false)) source.insideConnections = true }
    for (const target of targetNodes) if ('node' in target && target.insideConnections !== undefined) for (const source of sourceNodes) if (isDescendant('node' in source ? source.node : source, target.node)) target.insideConnections = true
    const incident = sourceNodes.concat(targetNodes).map(shape => 'node' in shape ? shape.node : shape)
    let container: LayoutNode | undefined
    if (incident.length === 2 && incident[0]!.parent === incident[1]!.parent) container = incident[0]!.parent
    else {
      container = incident[0]!
      for (const node of incident.slice(1)) if (container !== undefined && node !== container && !isDescendant(node, container)) {
        const ancestors = new Set<LayoutNode>(); for (let current: LayoutNode | undefined = node; current !== undefined; current = current.parent) ancestors.add(current)
        while (container !== undefined && !ancestors.has(container)) container = container.parent
      }
    }
    let topGraph = graph; while (topGraph.ownerNode?.layoutGraph !== undefined) topGraph = topGraph.ownerNode.layoutGraph
    const owner = container?.contentGraph ?? topGraph, containerId = container === undefined ? topGraph.id : container.id
    const hierarchical = enumOption(owner.options, 'hierarchyHandling', ['INHERIT', 'SEPARATE_CHILDREN', 'INCLUDE_CHILDREN'] as const, 'INHERIT') === 'INCLUDE_CHILDREN'
    const sourceNode = 'node' in sourceNodes[0]! ? sourceNodes[0]!.node : sourceNodes[0]!, targetNode = 'node' in targetNodes[0]! ? targetNodes[0]!.node : targetNodes[0]!
    const connectsToGraph = sourceNode.layoutGraph === owner && targetNode === owner.ownerNode || targetNode.layoutGraph === owner && sourceNode === owner.ownerNode
    if (booleanOption(options, 'noLayout', false) || hierarchical && (sourceNode.noLayout || targetNode.noLayout) || !hierarchical && !connectsToGraph && (sourceNode.layoutGraph !== owner || targetNode.layoutGraph !== owner)) {
      const skipped: SkippedLayoutEdge = { sourceShape: sourceNodes[0], targetShape: targetNodes[0], noLayout: true, containerGraph: owner, containerId, data, options, sourceLabels }
      graph.sourceEdges.push(skipped); owner.containedEdges.push(skipped); continue
    }
    if (sourceNode.noLayout || targetNode.noLayout) {
      const describe = (node: LayoutNode): string => { const id = node.id || node.sourceLabels[0]?.text; return 'ElkNode' + (id ? ' \"' + id + '\"' : '') + ' (' + node.x + ',' + node.y + ' | ' + node.width + ',' + node.height + ')' }
      const label = identifier || sourceLabels[0]?.text
      throw new Error('org.eclipse.elk.core.UnsupportedGraphException: The source or the target of edge ElkEdge' + (label ? ' \"' + label + '\"' : '') + ' ' + describe(sourceNode) + ' -> ' + describe(targetNode) + ' could not be found. This usually happens when an edge connects a node laid out by ELK Layered to a node in another level of hierarchy laid out by either another instance of ELK Layered or another layout algorithm alltogether. The former can be solved by setting the hierarchyHandling option to INCLUDE_CHILDREN.')
    }
    if (sourceNodes.length !== 1 || targetNodes.length !== 1) throw new Error('ELK TypeScript port: hyperedge transformation is not implemented yet')
    const sourceShape = sourceNodes[0]!, targetShape = targetNodes[0]!
    const source = 'node' in sourceShape && sourceShape.node.ports.includes(sourceShape) ? sourceShape : createPort(sourceNode.layoutGraph ?? owner, sourceNode, 'OUTPUT'), target = 'node' in targetShape && targetShape.node.ports.includes(targetShape) ? targetShape : createPort(targetNode.layoutGraph ?? owner, targetNode, 'INPUT')
    const edge: LayoutEdge = { containerGraph: owner, containerId, coordinateOrigin: sourceNode.parent !== targetNode.parent && !isDescendant(targetNode, sourceNode) ? owner : undefined, sourceShapeKey: sourceShape.key, targetShapeKey: targetShape.key, data, source, target, options, labels, sourceLabels, reversed: false, priorityDirection: integerOption(options, 'layered.priority.direction', 0), priorityShortness: integerOption(options, 'layered.priority.shortness', 0), bends: [] }
    source.outgoing.push(edge); target.incoming.push(edge)
    if (source.incoming.length > 1 || source.outgoing.length > 1 || target.incoming.length > 1 || target.outgoing.length > 1) owner.hasHyperedges = true
    owner.edges.push(edge); owner.containedEdges.push(edge); graph.sourceEdges.push(edge)
  }
}
export function createPort(graph: LayoutGraph, node: LayoutNode, type: 'INPUT' | 'OUTPUT'): LayoutPort {
  const constraints = enumOption(node.options, 'portConstraints', ['UNDEFINED', 'FREE', 'FIXED_SIDE', 'FIXED_ORDER', 'FIXED_RATIO', 'FIXED_POS'] as const, 'UNDEFINED')
  const collect = !isSideFixed(constraints) && (booleanOption(graph.options, 'layered.mergeEdges', false) || booleanOption(node.options, 'hypernode', false))
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

function importPort(data: JsonObject, node: LayoutNode): LayoutPort {
  const key = elementKey(data), id = primitiveString(readMember(data, 'id')), options = importOptions(data)
  const x = numberMember(data, 'x'), y = numberMember(data, 'y'), width = numberMember(data, 'width'), height = numberMember(data, 'height'), sourceLabels = importLabels(data), labels = sourceLabels.filter(label => label.active)
  const port: LayoutPort = { data, key, id, index: optionalIntegerOption(options, 'port.index'), options, labels, sourceLabels, node, incoming: [], outgoing: [], x, y, width, height, side: enumOption(options, 'port.side', ['UNDEFINED', 'NORTH', 'EAST', 'SOUTH', 'WEST'] as const, 'UNDEFINED'), collect: null, anchorX: 0, anchorY: 0, borderOffset: optionalNumberOption(options, 'port.borderOffset') ?? null, ratio: 0, explicitAnchor: false }
  return port
}
export function initializePort(port: LayoutPort, direction: Direction): void {
  const node = port.node, { x, y, width, height, options } = port
  port.side = enumOption(options, 'port.side', ['UNDEFINED', 'NORTH', 'EAST', 'SOUTH', 'WEST'] as const, 'UNDEFINED')
  port.borderOffset = optionalNumberOption(options, 'port.borderOffset') ?? null
  port.ratio = 0; port.anchorX = 0; port.anchorY = 0; port.explicitAnchor = false
  if (!node.noLayout && !booleanOption(port.options, 'noLayout', false)) port.insideConnections = false
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
}
export function isSideFixed(constraints: PortConstraints): boolean { return constraints !== 'FREE' && constraints !== 'UNDEFINED' }
export function calculatePortSide(port: LayoutPort, direction: Direction): LayoutPort['side'] {
  const node = port.node, width = node.width, height = node.height, x = port.x, y = port.y
  if (width <= 0 && height <= 0) return 'UNDEFINED'
  if (direction === 'LEFT' || direction === 'RIGHT') { if (x < 0) return 'WEST'; if (x + port.width > width) return 'EAST' }
  else { if (y < 0) return 'NORTH'; if (y + port.height > height) return 'SOUTH' }
  const widthPercent = (x + port.width / 2) / width, heightPercent = (y + port.height / 2) / height
  if (widthPercent + heightPercent <= 1 && widthPercent - heightPercent <= 0) return 'WEST'
  if (widthPercent + heightPercent >= 1 && widthPercent - heightPercent >= 0) return 'EAST'
  return heightPercent < 0.5 ? 'NORTH' : 'SOUTH'
}

function needsModelOrder(options: Options): boolean {
  const cycle = enumOption(options, 'layered.cycleBreaking.strategy', ['GREEDY', 'DEPTH_FIRST', 'INTERACTIVE', 'MODEL_ORDER', 'GREEDY_MODEL_ORDER', 'SCC_CONNECTIVITY', 'SCC_NODE_TYPE', 'DFS_NODE_ORDER', 'BFS_NODE_ORDER'] as const, 'GREEDY')
  const layering = enumOption(options, 'layered.layering.strategy', ['NETWORK_SIMPLEX', 'LONGEST_PATH', 'LONGEST_PATH_SOURCE', 'COFFMAN_GRAHAM', 'INTERACTIVE', 'STRETCH_WIDTH', 'MIN_WIDTH', 'BF_MODEL_ORDER', 'DF_MODEL_ORDER'] as const, 'NETWORK_SIMPLEX')
  const promotion = enumOption(options, 'layered.layering.nodePromotion.strategy', ['NONE', 'NIKOLOV', 'NIKOLOV_PIXEL', 'NIKOLOV_IMPROVED', 'NIKOLOV_IMPROVED_PIXEL', 'DUMMYNODE_PERCENTAGE', 'NODECOUNT_PERCENTAGE', 'NO_BOUNDARY', 'MODEL_ORDER_LEFT_TO_RIGHT', 'MODEL_ORDER_RIGHT_TO_LEFT'] as const, 'NONE')
  return ['MODEL_ORDER', 'BFS_NODE_ORDER', 'DFS_NODE_ORDER', 'GREEDY_MODEL_ORDER', 'SCC_CONNECTIVITY', 'SCC_NODE_TYPE'].includes(cycle) || layering === 'BF_MODEL_ORDER' || layering === 'DF_MODEL_ORDER' || promotion === 'MODEL_ORDER_LEFT_TO_RIGHT' || promotion === 'MODEL_ORDER_RIGHT_TO_LEFT' || enumOption(options, 'layered.considerModelOrder.strategy', ['NONE', 'NODES_AND_EDGES', 'PREFER_EDGES', 'PREFER_NODES'] as const, 'NONE') !== 'NONE' || booleanOption(options, 'layered.crossingMinimization.forceNodeModelOrder', false) || enumOption(options, 'layered.considerModelOrder.components', ['NONE', 'INSIDE_PORT_SIDE_GROUPS', 'GROUP_MODEL_ORDER', 'MODEL_ORDER'] as const, 'NONE') !== 'NONE' || numberOption(options, 'layered.considerModelOrder.crossingCounterNodeInfluence', 0) !== 0 || numberOption(options, 'layered.considerModelOrder.crossingCounterPortInfluence', 0) !== 0
}
function assignModelOrder(graph: LayoutGraph): void {
  const options = graph.options, needs = needsModelOrder(options)
  const hierarchical = enumOption(options, 'hierarchyHandling', ['INHERIT', 'SEPARATE_CHILDREN', 'INCLUDE_CHILDREN'] as const, 'INHERIT') === 'INCLUDE_CHILDREN'
  let index = 0
  const groups = new Set<number>()
  for (const node of graph.nodes) {
    if (needs && !booleanOption(node.options, 'layered.considerModelOrder.noModelOrder', false) && (hierarchical || !node.noLayout)) {
      node.modelOrder = index++
      if (optionalIntegerOption(node.options, 'layered.considerModelOrder.groupModelOrder.cycleBreakingId') !== undefined) groups.add(integerOption(node.options, 'layered.considerModelOrder.groupModelOrder.cycleBreakingId', 0))
      for (let portIndex = 0; portIndex < node.sourcePorts.length; portIndex++) node.sourcePorts[portIndex]!.modelOrder = portIndex
    }
    const constraint = optionalEnumOption(node.options, 'layered.layering.layerConstraint', ['NONE', 'FIRST', 'FIRST_SEPARATE', 'LAST', 'LAST_SEPARATE'] as const)
    node.layerConstraint = constraint ?? 'NONE'; node.layerConstraintSet = constraint !== undefined
    node.cycleBreakingGroupId = integerOption(node.options, 'layered.considerModelOrder.groupModelOrder.cycleBreakingId', 0)
  }
  graph.maxModelOrderNodes = index; graph.modelOrderGroupCount = groups.size
  if (needs) for (let edgeIndex = 0; edgeIndex < graph.containedEdges.length; edgeIndex++) { const edge = graph.containedEdges[edgeIndex]!; if (!edge.noLayout) edge.modelOrder = edgeIndex }
}

/** ElkGraphImporter's compound BFS counters span the complete imported hierarchy. */
function assignCompoundModelOrder(root: LayoutGraph): void {
  let index = 0
  const groups = new Set<number>(), queue = root.nodes.slice(), graphs: LayoutGraph[] = [root]
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const node = queue[cursor]!, parent = node.layoutGraph!
    if (needsModelOrder(parent.options) && !booleanOption(node.options, 'layered.considerModelOrder.noModelOrder', false)) {
      node.modelOrder = index++
      const group = optionalIntegerOption(node.options, 'layered.considerModelOrder.groupModelOrder.cycleBreakingId')
      if (group !== undefined) groups.add(group)
    } else delete node.modelOrder
    if (node.nestedGraph !== undefined) { queue.push(...node.nestedGraph.nodes); graphs.push(node.nestedGraph) }
  }
  root.maxModelOrderNodes = index; root.modelOrderGroupCount = groups.size
  for (const graph of graphs) if (graph !== root) { delete graph.maxModelOrderNodes; delete graph.modelOrderGroupCount }
  index = 0
  const needsEdges = needsModelOrder(root.options)
  for (const graph of graphs) for (const edge of graph.containedEdges) {
    if (!edge.noLayout) { if (needsEdges) edge.modelOrder = index; else delete edge.modelOrder }
    index++
  }
}
