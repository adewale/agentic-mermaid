/*******************************************************************************
 * Copyright (c) 2012, 2016, 2022 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { CycleEdge, CycleNode, CyclePort } from './cycle-breaking.ts'
import { arrayMember, elementId, elementKey, isJsonObject, jsonValue, numberMember, objectMember, primitiveString, readMember, type JsonObject } from './json.ts'
import { booleanOption, enumOption, importOptions, importOptionObject, integerOption, numberOption, paddingOption, type Direction, type Insets, type Options } from './options.ts'
import type { ElkExtendedEdge, ElkLabel, ElkNode, ElkPort } from './types.ts'

export interface LayoutLabel { data: ElkLabel; x: number; y: number; width: number; height: number; options: Options }
export interface LayoutPort extends CyclePort { data: ElkPort | null; node: LayoutNode; incoming: LayoutEdge[]; outgoing: LayoutEdge[]; x: number; y: number; width: number; height: number; side: 'UNDEFINED' | 'NORTH' | 'EAST' | 'SOUTH' | 'WEST'; collect: 'INPUT' | 'OUTPUT' | null; anchorX: number; anchorY: number }
export interface LayoutEdge extends CycleEdge { data: ElkExtendedEdge; source: LayoutPort; target: LayoutPort; priorityDirection: number; priorityShortness: number; reversed: boolean; options: Options; labels: LayoutLabel[]; bends: { x: number; y: number }[] }
export type LayoutNodeType = 'NORMAL' | 'LONG_EDGE' | 'EXTERNAL_PORT' | 'NORTH_SOUTH_PORT' | 'LABEL' | 'BREAKING_POINT' | 'PLACEHOLDER' | 'NONSHIFTING_PLACEHOLDER'
export type PortConstraints = 'UNDEFINED' | 'FREE' | 'FIXED_SIDE' | 'FIXED_ORDER' | 'FIXED_RATIO' | 'FIXED_POS'
export interface LayoutNode extends CycleNode {
  type: LayoutNodeType
  margin: Insets
  individualSpacings: Options
  portConstraints: PortConstraints
  inLayerSuccessors?: LayoutNode[]
  inLayerLayoutUnit?: LayoutNode
  barycenterAssociates?: LayoutNode[]
  data: ElkNode
  id: string
  key: string | number
  sourceIndex: number
  options: Options
  x: number
  y: number
  width: number
  height: number
  priority: number
  ports: LayoutPort[]
  labels: LayoutLabel[]
  children: LayoutNode[]
  rank: number
  noLayout: boolean
}
export interface LayoutGraph {
  data: ElkNode
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  options: Options
  labels: LayoutLabel[]
  padding: Insets
  direction: Direction
  offsetX: number
  offsetY: number
  x: number
  y: number
  width: number
  height: number
}

// The importer keeps original JSON objects for emission. Input order, phase
// order, and source ownership are separate from mutable layer/component arrays.
export function importGraph(data: ElkNode): LayoutGraph {
  elementId(data)
  primitiveString(readMember(data, 'id'))
  const options = importOptions(data)
  readIndividualSpacings(data)
  const x = numberMember(data, 'x'), y = numberMember(data, 'y'), width = numberMember(data, 'width'), height = numberMember(data, 'height')
  const ports = arrayMember(data, 'ports')
  if (ports?.some(port => isJsonObject(jsonValue(port)))) throw new Error('ELK TypeScript port: graph ports are not implemented yet')
  const labels = importLabels(data)
  const nodes: LayoutNode[] = []
  const children = arrayMember(data, 'children')
  if (children !== null) for (let index = 0; index < children.length; index++) {
    const child = jsonValue(children[index])
    if (isJsonObject(child)) nodes.push(importNode(child, index))
  }
  for (const node of nodes) if (node.children.length > 0) throw new Error('ELK TypeScript port: hierarchy layout is not implemented yet')
  const aspectRatio = numberOption(options, 'aspectRatio', 1.600000023841858)
  const requested = enumOption(options, 'direction', ['UNDEFINED', 'RIGHT', 'LEFT', 'DOWN', 'UP'] as const, 'UNDEFINED')
  const graph: LayoutGraph = { data, nodes, edges: [], options, labels, padding: paddingOption(options, { top: 12, right: 12, bottom: 12, left: 12 }), offsetX: 0, offsetY: 0, direction: requested === 'UNDEFINED' ? aspectRatio >= 1 ? 'RIGHT' : 'DOWN' : requested, x, y, width, height }
  importEdges(graph)
  return graph
}
function importNode(data: JsonObject, sourceIndex: number): LayoutNode {
  const key = elementKey(data), id = primitiveString(readMember(data, 'id')) ?? ''
  const options = importOptions(data)
  const individualSpacings = readIndividualSpacings(data)
  const x = numberMember(data, 'x'), y = numberMember(data, 'y'), width = numberMember(data, 'width'), height = numberMember(data, 'height')
  const ports = arrayMember(data, 'ports')
  if (ports?.some(port => isJsonObject(jsonValue(port)))) throw new Error('ELK TypeScript port: node ports are not implemented yet')
  const labels = importLabels(data), children: LayoutNode[] = []
  const childData = arrayMember(data, 'children')
  if (childData !== null) for (let index = 0; index < childData.length; index++) { const child = jsonValue(childData[index]); if (isJsonObject(child)) children.push(importNode(child, index)) }
  return { margin: { top: 0, right: 0, bottom: 0, left: 0 }, individualSpacings, type: 'NORMAL', portConstraints: enumOption(options, 'portConstraints', ['UNDEFINED', 'FREE', 'FIXED_SIDE', 'FIXED_ORDER', 'FIXED_RATIO', 'FIXED_POS'] as const, 'FREE'), data: data as unknown as ElkNode, id, key, sourceIndex, options, x, y, width, height, ports: [], labels, children, rank: 0, priority: integerOption(options, 'priority', 0), noLayout: booleanOption(options, 'noLayout', false) }
}
function importLabels(data: object): LayoutLabel[] {
  const result: LayoutLabel[] = [], labels = arrayMember(data, 'labels')
  if (labels === null) return result
  for (let index = 0; index < labels.length; index++) {
    const label = jsonValue(labels[index])
    if (!isJsonObject(label)) continue
    // Labels do not require identifiers. Text is read even though it stays in
    // its authored JSON member; the graph importer preserves primitive coercion.
    primitiveString(readMember(label, 'text'))
    const options = importOptions(label)
    const x = numberMember(label, 'x'), y = numberMember(label, 'y'), width = numberMember(label, 'width'), height = numberMember(label, 'height')
    if (width !== 0 || height !== 0 || x !== 0 || y !== 0 || arrayMember(label, 'labels')?.length) throw new Error('ELK TypeScript port: nontrivial label placement is not implemented yet')
    result.push({ data: label as ElkLabel, options, x, y, width, height })
  }
  return result
}
function readIndividualSpacings(data: object): Options { const raw = objectMember(data, 'individualSpacings'); return raw === null ? new Map() : importOptionObject(raw) }

function importEdges(graph: LayoutGraph): void {
  const ids = new Map<string | number, LayoutNode>()
  for (const node of graph.nodes) ids.set(node.key, node)
  const edgeData = arrayMember(graph.data, 'edges')
  if (edgeData === null) return
  for (let index = 0; index < edgeData.length; index++) {
    const data = jsonValue(edgeData[index])
    if (!isJsonObject(data)) continue
    const id = elementId(data)
    primitiveString(readMember(data, 'id'))
    const sources = arrayMember(data, 'sources'), targets = arrayMember(data, 'targets')
    const resolve = (values: unknown[] | null): LayoutNode[] => {
      const result: LayoutNode[] = []
      if (values !== null) for (let i = 0; i < values.length; i++) {
        const key = elementKey({ id: jsonValue(values[i]) }), node = ids.get(key)
        if (node === undefined) throw new Error('Referenced shape does not exist: ' + key)
        if (!result.includes(node)) result.push(node)
      }
      return result
    }
    const sourceNodes = resolve(sources), targetNodes = resolve(targets)
    if (sourceNodes.length === 0 || targetNodes.length === 0) throw new Error("An edge must have at least one source and one target (edge id: '" + id + "').")
    const options = importOptions(data)
    if (arrayMember(data, 'sections')?.length) throw new Error('ELK TypeScript port: authored edge sections are not implemented yet')
    const labels = importLabels(data)
    if (sourceNodes.length !== 1 || targetNodes.length !== 1) throw new Error('ELK TypeScript port: hyperedge transformation is not implemented yet')
    const source = createPort(graph, sourceNodes[0]!, 'OUTPUT'), target = createPort(graph, targetNodes[0]!, 'INPUT')
    const edge: LayoutEdge = { data: data as unknown as ElkExtendedEdge, source, target, options, labels, reversed: false, priorityDirection: integerOption(options, 'layered.priority.direction', 0), priorityShortness: integerOption(options, 'layered.priority.shortness', 0), bends: [] }
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
  const port: LayoutPort = { data: null, node, incoming: [], outgoing: [], x: 0, y: 0, width: 0, height: 0, side, collect: collect ? type : null, anchorX: 0, anchorY: 0 }
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
