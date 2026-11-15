/*******************************************************************************
 * Copyright (c) 2010, 2012, 2016, 2022 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { packComponents, type Component } from './components.ts'
import { breakGreedyCycles, breakModelOrderCycles, breakGreedyModelOrderCycles } from './cycle-breaking.ts'
import { Random } from '../java/util/Random.ts'
import { assignNetworkSimplexLayers } from './network-simplex.ts'
import { assignPortSides, sortPortLists } from './phases.ts'
import { splitLongEdges, joinLongEdges } from './long-edges.ts'
import { minimizeCrossings } from './crossing.ts'
import { placeNodes } from './node-placement.ts'
import { sizeAndPlacePorts } from './sizing.ts'
import { routeOrthogonal } from './routing.ts'
import { importGraph, reverseEdge, type LayoutGraph, type LayoutLabel, type LayoutNode } from './graph.ts'
import { writeMember, elementKey } from './json.ts'
import { booleanOption, enumOption, numberOption, integerOption, setOption, stringOption, vectorOption, type Options } from './options.ts'
import type { ElkNode } from './types.ts'

const SIZE_CONSTRAINTS = ['PORTS', 'PORT_LABELS', 'NODE_LABELS', 'MINIMUM_SIZE'] as const
const SIZE_OPTIONS = ['DEFAULT_MINIMUM_SIZE', 'MINIMUM_SIZE_ACCOUNTS_FOR_PADDING', 'COMPUTE_PADDING', 'OUTSIDE_NODE_LABELS_OVERHANG', 'PORTS_OVERHANG', 'UNIFORM_PORT_SPACING', 'SPACE_EFFICIENT_PORT_LABELS', 'FORCE_TABULAR_NODE_LABELS', 'ASYMMETRICAL'] as const

/** Development entry. Production continues to use elkjs until all paths qualify. */
export function elkLayoutSync<T extends ElkNode>(data: T): T {
  const graph = importGraph(data)
  const algorithm = stringOption(graph.options, 'algorithm', 'layered')
  if (algorithm !== 'layered' && algorithm !== 'org.eclipse.elk.layered') throw new Error('ELK TypeScript port: unsupported algorithm ' + algorithm)
  if (numberOption(graph.options, 'spacing.edgeEdge', 10) < 2) graph.options.set('spacing.edgeEdge', '2')
  if (graph.nodes.length > 0) {
    if (enumOption(graph.options, 'layered.compaction.postCompaction.strategy', ['NONE', 'LEFT', 'RIGHT', 'LEFT_RIGHT_CONSTRAINT_LOCKING', 'LEFT_RIGHT_CONNECTION_LOCKING', 'EDGE_LENGTH'] as const, 'NONE') !== 'NONE') throw new Error('ELK TypeScript port: horizontal post-compaction is not implemented yet')
    if (!booleanOption(graph.options, 'separateConnectedComponents', true)) throw new Error('ELK TypeScript port: unsplit component phases are not implemented yet')
    if (booleanOption(graph.options, 'layered.compaction.connectedComponents', false)) throw new Error('ELK TypeScript port: connected-component compaction is not implemented yet')
    const components: Component[] = []
    const random = new Random(integerOption(graph.options, 'randomSeed', 1))
    for (const nodes of splitComponents(graph)) components.push(nodes.some(node => node.ports.length > 0) ? layoutConnectedComponent(nodes, graph, random) : layoutComponent(nodes[0]!, graph))
    const ordering = enumOption(graph.options, 'layered.considerModelOrder.components', ['NONE', 'INSIDE_PORT_SIDE_GROUPS', 'GROUP_MODEL_ORDER', 'MODEL_ORDER'] as const, 'NONE')
    if (ordering !== 'NONE') throw new Error('ELK TypeScript port: model-order component placer is not implemented yet')
    const size = packComponents(components, { spacing: numberOption(graph.options, 'spacing.componentComponent', 20), aspectRatio: numberOption(graph.options, 'aspectRatio', 1.600000023841858), preserveModelOrder: false })
    resizeGraph(graph, size.width, size.height)
  }
  emitGraph(graph)
  return data
}

function layoutComponent(node: LayoutNode, graph: LayoutGraph): Component {
  // On the zero-edge singleton component each phase reduces to its source
  // invariant: rank0, unchanged order, no routing segments. Keep the native
  // phase operations shared with the following connected implementation.
  breakGreedyCycles({ nodes: [node], random: { nextInt: () => { throw new Error('An edgeless component cannot request a random choice') } }, cyclic: false, reverseEdge: () => { throw new Error('An edgeless component cannot reverse an edge') } })
  node.rank = 0
  sizeNode(node)
  const vertical = graph.direction === 'DOWN' || graph.direction === 'UP'
  const sizeX = vertical ? node.height : node.width, sizeY = vertical ? node.width : node.height
  const layerWidth = Math.max(0, sizeX)
  let x = (layerWidth - sizeX) / 2, y = 0
  // Label-free BK placement, LayerSizeAndGraphHeightCalculator and orthogonal
  // routing of a single layer retain the source layer-width and height rules.
  const graphHeight = y + sizeY - y
  const graphWidth = layerWidth
  if (graph.direction === 'LEFT') x = graphWidth - x - sizeX
  if (graph.direction === 'UP') x = graphWidth - x - sizeX
  if (vertical) { node.x = y; node.y = x } else { node.x = x; node.y = y }
  return { nodes: [node], width: vertical ? graphHeight : graphWidth, height: vertical ? graphWidth : graphHeight, offsetX: 0, offsetY: 0 }
}
function sizeNode(node: LayoutNode): void {
  const constraints = setOption(node.options, 'nodeSize.constraints', SIZE_CONSTRAINTS, [])
  if (!constraints.has('MINIMUM_SIZE')) return
  const minimum = minimumSize(node.options)
  node.width = Math.max(0, minimum.x)
  node.height = Math.max(0, minimum.y)
}
function minimumSize(options: Options): { x: number; y: number } {
  const minimum = vectorOption(options, 'nodeSize.minimum')
  const flags = setOption(options, 'nodeSize.options', SIZE_OPTIONS, ['DEFAULT_MINIMUM_SIZE'])
  if (flags.has('DEFAULT_MINIMUM_SIZE')) { if (minimum.x <= 0) minimum.x = 20; if (minimum.y <= 0) minimum.y = 20 }
  return minimum
}
function resizeGraph(graph: LayoutGraph, contentWidth: number, contentHeight: number): void {
  const padding = graph.padding
  const oldWidth = contentWidth + padding.left + padding.right, oldHeight = contentHeight + padding.top + padding.bottom
  let width = oldWidth, height = oldHeight, offsetX = 0, offsetY = 0
  if (setOption(graph.options, 'nodeSize.constraints', SIZE_CONSTRAINTS, []).has('MINIMUM_SIZE')) {
    const minimum = minimumSize(graph.options)
    width = Math.max(width, minimum.x); height = Math.max(height, minimum.y)
  }
  const fixed = booleanOption(graph.options, 'nodeSize.fixedGraphSize', false)
  if (!fixed) {
    const align = setOption(graph.options, 'contentAlignment', ['V_TOP', 'V_CENTER', 'V_BOTTOM', 'H_LEFT', 'H_CENTER', 'H_RIGHT'], ['V_TOP', 'H_LEFT'])
    if (width > oldWidth) { if (align.has('H_CENTER')) offsetX += (width - oldWidth) / 2; else if (align.has('H_RIGHT')) offsetX += width - oldWidth }
    if (height > oldHeight) { if (align.has('V_CENTER')) offsetY += (height - oldHeight) / 2; else if (align.has('V_BOTTOM')) offsetY += height - oldHeight }
    graph.width = width - padding.left - padding.right + padding.left + padding.right
    graph.height = height - padding.top - padding.bottom + padding.top + padding.bottom
  }
  graph.offsetX = offsetX + padding.left; graph.offsetY = offsetY + padding.top
}
function emitGraph(graph: LayoutGraph): void {
  emitShape(graph.data, graph)
  for (const node of graph.nodes) { if (node.data === null) throw new Error('Layout node did not exist in input'); emitShape(node.data, { x: node.noLayout ? node.x : node.x + graph.offsetX, y: node.noLayout ? node.y : node.y + graph.offsetY, width: node.width, height: node.height }); for (const port of node.sourcePorts) if (port.data !== null) emitShape(port.data, port) }
  for (const edge of graph.edges) {
    const source = edge.source, target = edge.target
    const section: import('./types.ts').ElkEdgeSection = { id: String(elementKey(edge.data)) + '_s0', startPoint: { x: source.node.x + source.x + source.anchorX + graph.offsetX, y: source.node.y + source.y + source.anchorY + graph.offsetY }, endPoint: { x: target.node.x + target.x + target.anchorX + graph.offsetX, y: target.node.y + target.y + target.anchorY + graph.offsetY }, incomingShape: (source.key ?? source.node.key) as string, outgoingShape: (target.key ?? target.node.key) as string }
    if (edge.bends.length > 0) section.bendPoints = edge.bends.map(point => ({ x: point.x + graph.offsetX, y: point.y + graph.offsetY }))
    writeMember(edge.data, 'sections', [section])
    if (edge.junctions?.length) writeMember(edge.data, 'junctionPoints', edge.junctions.map(point => ({ x: point.x + graph.offsetX, y: point.y + graph.offsetY })))
    writeMember(edge.data, 'container', graph.id)
  }
  for (const label of graph.labels) emitLabel(label)
  for (const node of graph.nodes) { for (const label of node.labels) emitLabel(label); for (const port of node.sourcePorts) for (const label of port.labels) emitLabel(label) }
}
function emitLabel(label: LayoutLabel): void { emitShape(label.data, label) }
function emitShape(data: object, shape: { x: number; y: number; width: number; height: number }): void { writeMember(data, 'x', shape.x); writeMember(data, 'y', shape.y); writeMember(data, 'width', shape.width); writeMember(data, 'height', shape.height) }

function splitComponents(graph: LayoutGraph): LayoutNode[][] {
  const result: LayoutNode[][] = [], visited = new Set<LayoutNode>()
  const visit = (node: LayoutNode, nodes: LayoutNode[]): void => {
    if (visited.has(node) || node.noLayout) return
    visited.add(node); nodes.push(node)
    for (const port of node.ports) {
      for (const edge of port.incoming) visit(edge.source.node, nodes)
      for (const edge of port.outgoing) visit(edge.target.node, nodes)
    }
  }
  for (const node of graph.nodes) if (!visited.has(node) && !node.noLayout) { const nodes: LayoutNode[] = []; visit(node, nodes); result.push(nodes) }
  return result
}
function layoutConnectedComponent(nodes: LayoutNode[], graph: LayoutGraph, random: Random): Component {
  const direction = graph.direction
  if (direction !== 'RIGHT') throw new Error('ELK TypeScript port: connected direction transforms are not implemented yet')
  for (const node of nodes) {
    if (node.ports.some(port => port.incoming.some(edge => edge.source.node === node))) throw new Error('ELK TypeScript port: self-loop processors are not implemented yet')
    if (stringOption(node.options, 'layered.layering.layerConstraint', 'NONE') !== 'NONE') throw new Error('ELK TypeScript port: layer constraint processors are not implemented yet')
  }
  const feedback = booleanOption(graph.options, 'layered.feedbackEdges', false)
  if (feedback) assignPortSides(nodes)
  const cycleGraph = { nodes, random, cyclic: false, reverseEdge: (edge: import('./cycle-breaking.ts').CycleEdge) => reverseEdge(edge as import('./graph.ts').LayoutEdge, true), maxModelOrderNodes: graph.maxModelOrderNodes, modelOrderGroupCount: graph.modelOrderGroupCount, enforceGroupModelOrder: enumOption(graph.options, 'layered.considerModelOrder.groupModelOrder.cbGroupOrderStrategy', ['ONLY_WITHIN_GROUP', 'MODEL_ORDER', 'ENFORCED'] as const, 'ONLY_WITHIN_GROUP') === 'ENFORCED' }
  const cycle = enumOption(graph.options, 'layered.cycleBreaking.strategy', ['GREEDY', 'DEPTH_FIRST', 'INTERACTIVE', 'MODEL_ORDER', 'GREEDY_MODEL_ORDER', 'SCC_CONNECTIVITY', 'SCC_NODE_TYPE', 'DFS_NODE_ORDER', 'BFS_NODE_ORDER'] as const, 'GREEDY')
  if (cycle === 'GREEDY') breakGreedyCycles(cycleGraph)
  else if (cycle === 'MODEL_ORDER') breakModelOrderCycles(cycleGraph)
  else if (cycle === 'GREEDY_MODEL_ORDER') breakGreedyModelOrderCycles(cycleGraph)
  else throw new Error('ELK TypeScript port: cycle strategy ' + cycle + ' is not implemented yet')
  const layers = assignNetworkSimplexLayers(nodes, integerOption(graph.options, 'layered.thoroughness', 7)) as LayoutNode[][]
  for (const node of nodes) for (const port of node.ports) for (const edge of port.outgoing) {
    if (edge.labels.length > 0) throw new Error('ELK TypeScript port: edge label processors are not implemented yet')
  }
  splitLongEdges(layers)
  const phaseNodes = layers.flat()
  if (!feedback) assignPortSides(phaseNodes)
  sortPortLists(phaseNodes, graph.options)
  minimizeCrossings(layers, graph.options, random, graph.nodes.filter(node => !node.noLayout).length, graph.maxModelOrderNodes)
  sizeAndPlacePorts(phaseNodes, graph.options)
  placeNodes(layers, graph.options)
  const size = routeOrthogonal(layers, graph.options, random)
  joinLongEdges(layers, graph.options)
  for (const layer of layers) for (const node of layer) for (const port of node.ports) for (const edge of [...port.outgoing]) if (edge.reversed) reverseEdge(edge, false)
  const points: { x: number; y: number }[] = []
  for (const node of nodes) for (const port of node.ports) for (const edge of port.outgoing) { points.push(...edge.bends); if (edge.junctions !== undefined) points.push(...edge.junctions); points.push(...edge.labels) }
  return { nodes, points, width: size.width, height: size.height, offsetX: 0, offsetY: size.offsetY }
}
