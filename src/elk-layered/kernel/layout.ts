/*******************************************************************************
 * Copyright (c) 2010, 2012, 2016, 2022 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { packComponents, type Component } from './components.ts'
import { compactGraph } from './compaction.ts'
import { preprocessSelfLoops, restoreSelfLoopPorts, routeSelfLoops, postprocessSelfLoops } from './self-loops.ts'
import { insertLabelDummies, switchLabelDummies, selectLabelSides, removeLabelDummies } from './edge-labels.ts'
import { breakGreedyCycles, breakModelOrderCycles, breakGreedyModelOrderCycles } from './cycle-breaking.ts'
import { Random } from '../java/util/Random.ts'
import { assignNetworkSimplexLayers } from './network-simplex.ts'
import { assignPortSides, sortPortLists } from './phases.ts'
import { splitLongEdges, joinLongEdges } from './long-edges.ts'
import { minimizeCrossings } from './crossing.ts'
import { calculateNodeMargins } from './margins.ts'
import { placeNodes } from './node-placement.ts'
import { sizeAndPlacePorts } from './sizing.ts'
import { transformGraph } from './transform.ts'
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
    const compound = enumOption(graph.options, 'hierarchyHandling', ['INHERIT', 'INCLUDE_CHILDREN', 'SEPARATE_CHILDREN'] as const, 'INHERIT') === 'INCLUDE_CHILDREN'
    const random = new Random(integerOption(graph.options, 'randomSeed', 1))
    if (compound) {
      const component = layoutComponent(graph.nodes.filter(node => !node.noLayout), graph, random, true)
      graph.width = component.width + graph.padding.left + graph.padding.right
      graph.height = component.height + graph.padding.top + graph.padding.bottom
      graph.offsetX = component.offsetX + graph.padding.left
      graph.offsetY = component.offsetY + graph.padding.top
    } else {
      if (!booleanOption(graph.options, 'separateConnectedComponents', true)) throw new Error('ELK TypeScript port: unsplit component phases are not implemented yet')
      if (booleanOption(graph.options, 'layered.compaction.connectedComponents', false)) throw new Error('ELK TypeScript port: connected-component compaction is not implemented yet')
      const components: Component[] = []
      for (const nodes of splitComponents(graph)) components.push(layoutComponent(nodes, graph, random, false))
      const ordering = enumOption(graph.options, 'layered.considerModelOrder.components', ['NONE', 'INSIDE_PORT_SIDE_GROUPS', 'GROUP_MODEL_ORDER', 'MODEL_ORDER'] as const, 'NONE')
      if (ordering !== 'NONE') throw new Error('ELK TypeScript port: model-order component placer is not implemented yet')
      const size = packComponents(components, { spacing: numberOption(graph.options, 'spacing.componentComponent', 20), aspectRatio: numberOption(graph.options, 'aspectRatio', 1.600000023841858), preserveModelOrder: false })
      resizeGraph(graph, size.width, size.height)
    }
  }
  emitGraph(graph)
  return data
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
  for (const edge of graph.sourceEdges) {
    if (edge.noLayout) { writeMember(edge.data, 'container', graph.id); continue }
    const source = edge.source, target = edge.target
    const section: import('./types.ts').ElkEdgeSection = { id: String(elementKey(edge.data)) + '_s0', startPoint: { x: source.node.x + source.x + source.anchorX + graph.offsetX, y: source.node.y + source.y + source.anchorY + graph.offsetY }, endPoint: { x: target.node.x + target.x + target.anchorX + graph.offsetX, y: target.node.y + target.y + target.anchorY + graph.offsetY }, incomingShape: (edge.sourceShapeKey ?? source.key ?? source.node.key) as string, outgoingShape: (edge.targetShapeKey ?? target.key ?? target.node.key) as string }
    if (edge.bends.length > 0) section.bendPoints = edge.bends.map(point => ({ x: point.x + graph.offsetX, y: point.y + graph.offsetY }))
    writeMember(edge.data, 'sections', [section])
    if (edge.junctions?.length) writeMember(edge.data, 'junctionPoints', edge.junctions.map(point => ({ x: point.x + graph.offsetX, y: point.y + graph.offsetY })))
    writeMember(edge.data, 'container', graph.id)
  }
  for (const label of graph.labels) emitLabel(label, false)
  for (const node of graph.nodes) {
    const nodePlacement = setOption(node.options, 'nodeLabels.placement', ['H_LEFT', 'H_CENTER', 'H_RIGHT', 'V_TOP', 'V_CENTER', 'V_BOTTOM', 'INSIDE', 'OUTSIDE', 'H_PRIORITY'], []).size > 0
    for (const label of node.sourceLabels) emitLabel(label, label.active && (nodePlacement || setOption(label.options, 'nodeLabels.placement', ['H_LEFT', 'H_CENTER', 'H_RIGHT', 'V_TOP', 'V_CENTER', 'V_BOTTOM', 'INSIDE', 'OUTSIDE', 'H_PRIORITY'], []).size > 0))
    for (const port of node.sourcePorts) for (const label of port.sourceLabels) emitLabel(label, false)
  }
  for (const edge of graph.sourceEdges) for (const label of edge.sourceLabels) {
    if (!edge.noLayout && label.active) emitShape(label.data, { x: label.x + graph.offsetX, y: label.y + graph.offsetY, width: label.width, height: label.height })
    else emitLabel(label, false)
  }
}
function emitLabel(label: LayoutLabel, apply: boolean): void { emitShape(label.data, apply ? label : { x: label.inputX, y: label.inputY, width: label.inputWidth, height: label.inputHeight }) }
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
function layoutComponent(nodes: LayoutNode[], graph: LayoutGraph, random: Random, compound: boolean): Component {
  const direction = graph.direction
  const state = { width: 0, height: 0, offsetX: 0, offsetY: 0, padding: { ...graph.padding }, options: new Map(graph.options) }
  if (!compound) state.options.delete('nodeSize.minimum')
  state.options.set('direction', direction)
  for (const node of nodes) node.originalPortConstraints = node.portConstraints
  // The upstream strategy factory maps the preprocessor to TO_INPUT_DIRECTION.
  transformGraph(nodes, state, direction, 'TO_INPUT_DIRECTION')
  for (const node of nodes) {
    if (stringOption(node.options, 'layered.layering.layerConstraint', 'NONE') !== 'NONE') throw new Error('ELK TypeScript port: layer constraint processors are not implemented yet')
  }
  const loops = preprocessSelfLoops(nodes, state.options)
  const feedback = booleanOption(state.options, 'layered.feedbackEdges', false)
  if (feedback) assignPortSides(nodes)
  const cycleGraph = { nodes, random, cyclic: false, reverseEdge: (edge: import('./cycle-breaking.ts').CycleEdge) => reverseEdge(edge as import('./graph.ts').LayoutEdge, true), maxModelOrderNodes: graph.maxModelOrderNodes, modelOrderGroupCount: graph.modelOrderGroupCount, enforceGroupModelOrder: enumOption(state.options, 'layered.considerModelOrder.groupModelOrder.cbGroupOrderStrategy', ['ONLY_WITHIN_GROUP', 'MODEL_ORDER', 'ENFORCED'] as const, 'ONLY_WITHIN_GROUP') === 'ENFORCED' }
  const cycle = enumOption(state.options, 'layered.cycleBreaking.strategy', ['GREEDY', 'DEPTH_FIRST', 'INTERACTIVE', 'MODEL_ORDER', 'GREEDY_MODEL_ORDER', 'SCC_CONNECTIVITY', 'SCC_NODE_TYPE', 'DFS_NODE_ORDER', 'BFS_NODE_ORDER'] as const, 'GREEDY')
  if (cycle === 'GREEDY') breakGreedyCycles(cycleGraph)
  else if (cycle === 'MODEL_ORDER') breakModelOrderCycles(cycleGraph)
  else if (cycle === 'GREEDY_MODEL_ORDER') breakGreedyModelOrderCycles(cycleGraph)
  else throw new Error('ELK TypeScript port: cycle strategy ' + cycle + ' is not implemented yet')
  const centerLabels = nodes.some(node => node.ports.some(port => port.outgoing.some(edge => edge.source.node !== edge.target.node && edge.labels.some(label => enumOption(label.options, 'edgeLabels.placement', ['CENTER', 'HEAD', 'TAIL'] as const, 'CENTER') === 'CENTER')))) ? insertLabelDummies(nodes, state.options) : undefined
  const layers = assignNetworkSimplexLayers(nodes, integerOption(state.options, 'layered.thoroughness', 7)) as LayoutNode[][]
  for (const node of nodes) for (const port of node.ports) for (const edge of port.outgoing) {
    if (edge.labels.length > 0) throw new Error('ELK TypeScript port: edge label processors are not implemented yet')
  }
  splitLongEdges(layers)
  const phaseNodes = layers.flat()
  if (!feedback) assignPortSides(phaseNodes)
  sortPortLists(phaseNodes, state.options)
  minimizeCrossings(layers, state.options, random, graph.nodes.filter(node => !node.noLayout).length, graph.maxModelOrderNodes)
  restoreSelfLoopPorts(layers, loops)
  sizeAndPlacePorts(phaseNodes, state.options)
  calculateNodeMargins(phaseNodes)
  routeSelfLoops(layers, state.options, random, loops)
  if (centerLabels !== undefined) { switchLabelDummies(layers, state.options, centerLabels); selectLabelSides(layers, state.options, centerLabels) }
  placeNodes(layers, state.options)
  const size = routeOrthogonal(layers, state.options, random)
  state.width = size.width; state.height = size.height; state.offsetY = size.offsetY
  joinLongEdges(layers, state.options)
  postprocessSelfLoops(layers, loops)
  compactGraph(layers, state.options, state)
  if (centerLabels !== undefined) removeLabelDummies(layers, nodes, state.options, centerLabels)
  for (const layer of layers) for (const node of layer) for (const port of node.ports) for (const edge of [...port.outgoing]) if (edge.reversed) reverseEdge(edge, false)
  if (enumOption(state.options, 'hierarchyHandling', ['INHERIT', 'INCLUDE_CHILDREN', 'SEPARATE_CHILDREN'] as const, 'INHERIT') === 'INCLUDE_CHILDREN') resizeHierarchicalGraph(state)
  transformGraph(layers.flat(), state, direction, 'TO_INTERNAL_LTR')
  const points: { x: number; y: number }[] = []
  for (const node of nodes) for (const port of node.ports) for (const edge of port.outgoing) { points.push(...edge.bends); if (edge.junctions !== undefined) points.push(...edge.junctions); points.push(...edge.labels) }
  return { nodes, points, width: state.width, height: state.height, offsetX: state.offsetX, offsetY: state.offsetY }
}

/** HierarchicalNodeResizingProcessor's flat graph size/offset transfer. */
function resizeHierarchicalGraph(state: { width: number; height: number; offsetX: number; offsetY: number; padding: import('./options.ts').Insets; options: Options }): void {
  const padding = state.padding
  const oldWidth = state.width + padding.left + padding.right, oldHeight = state.height + padding.top + padding.bottom
  let width = oldWidth, height = oldHeight
  if (setOption(state.options, 'nodeSize.constraints', SIZE_CONSTRAINTS, []).has('MINIMUM_SIZE')) {
    const minimum = minimumSize(state.options)
    width = Math.max(width, minimum.x); height = Math.max(height, minimum.y)
  }
  const align = setOption(state.options, 'contentAlignment', ['V_TOP', 'V_CENTER', 'V_BOTTOM', 'H_LEFT', 'H_CENTER', 'H_RIGHT'], ['V_TOP', 'H_LEFT'])
  if (width > oldWidth) { if (align.has('H_CENTER')) state.offsetX += (width - oldWidth) / 2; else if (align.has('H_RIGHT')) state.offsetX += width - oldWidth }
  if (height > oldHeight) { if (align.has('V_CENTER')) state.offsetY += (height - oldHeight) / 2; else if (align.has('V_BOTTOM')) state.offsetY += height - oldHeight }
  state.width = width - padding.left - padding.right
  state.height = height - padding.top - padding.bottom
}
