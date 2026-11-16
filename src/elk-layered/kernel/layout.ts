/*******************************************************************************
 * Copyright (c) 2010, 2012, 2016, 2022 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { packComponentGroups } from './component-groups.ts'
import { packComponents, type Component } from './components.ts'
import { compactGraph } from './compaction.ts'
import { prepareEndLabels, selectEndLabelSides, sortEndLabels, finishEndLabels } from './end-labels.ts'
import { preprocessSelfLoops, restoreSelfLoopPorts, routeSelfLoops, postprocessSelfLoops } from './self-loops.ts'
import { insertLabelDummies, switchLabelDummies, selectLabelSides, removeLabelDummies } from './edge-labels.ts'
import { breakGreedyCycles, breakModelOrderCycles, breakGreedyModelOrderCycles } from './cycle-breaking.ts'
import { Random } from './random.ts'
import { applyHighDegreeLayers } from './high-degree.ts'
import { assignNetworkSimplexLayers } from './network-simplex.ts'
import { insertInvertedPortDummies } from './inverted-ports.ts'
import { assignPortSides, sortPortLists } from './phases.ts'
import { splitLongEdges, joinLongEdges } from './long-edges.ts'
import { minimizeCrossings, prepareCrossingModelOrder, minimizeHierarchicalCrossings, minimizeHierarchicalGreedySwitch } from './crossing.ts'
import { preprocessNorthSouthPorts, postprocessNorthSouthPorts, type NorthSouthPortState } from './north-south-ports.ts'
import { mergeHyperedgeDummies } from './hyperedge-dummies.ts'
import { preprocessPartitions, addPartitionConstraints, removePartitionConstraints } from './partitions.ts'
import { preprocessCompound, postprocessCompound } from './compound.ts'
import { constrainHierarchyPorts, sizeHierarchyPortDummies, positionHierarchyPorts, routeHierarchyPorts, type HierarchyPortState } from './hierarchy-ports.ts'
import { reverseConstrainedEdges, hideSeparateLayers, restoreSeparateLayers, enforceInLayerConstraints } from './constraints.ts'
import { calculateNodeMargins } from './margins.ts'
import { placeNodes } from './node-placement.ts'
import { sizeAndPlacePorts } from './sizing.ts'
import { resizeNode, resizeImportedNode } from './node-geometry.ts'
import { getExternalPortPosition, importIndependentPorts } from './external-ports.ts'
import { transformGraph } from './transform.ts'
import { routeOrthogonal, measureLayers } from './routing.ts'
import { importGraph, initializePort, reverseEdge, type LayoutGraph, type GraphGeometry, type LayoutLabel, type LayoutNode, type LayoutEdge } from './graph.ts'
import { writeMember, elementKey } from './json.ts'
import { booleanOption, enumOption, numberOption, integerOption, setOption, stringOption, vectorOption, type Options } from './options.ts'
import type { ElkNode } from './types.ts'

const SIZE_CONSTRAINTS = ['PORTS', 'PORT_LABELS', 'NODE_LABELS', 'MINIMUM_SIZE'] as const
const SIZE_OPTIONS = ['DEFAULT_MINIMUM_SIZE', 'MINIMUM_SIZE_ACCOUNTS_FOR_PADDING', 'COMPUTE_PADDING', 'OUTSIDE_NODE_LABELS_OVERHANG', 'PORTS_OVERHANG', 'UNIFORM_PORT_SPACING', 'SPACE_EFFICIENT_PORT_LABELS', 'FORCE_TABULAR_NODE_LABELS', 'ASYMMETRICAL'] as const

/** Synchronous ELK Layered JSON boundary. */
export function elkLayoutSync<T extends ElkNode>(data: T): T {
  const graph = importGraph(data)
  layoutGraph(graph)
  emitGraph(graph)
  return data
}
function layoutGraph(graph: LayoutGraph): void {
  importIndependentPorts(graph)
  layoutIndependentDescendants(graph)
  checkSupportedStrategies(graph.options)
  if (graph.nodes.some(node => node.nestedGraph !== undefined)) { layoutCompound(graph); return }
  const algorithm = stringOption(graph.options, 'algorithm', 'layered')
  if (algorithm !== 'layered' && algorithm !== 'org.eclipse.elk.layered') throw new Error('ELK TypeScript port: unsupported algorithm ' + algorithm)
  if (numberOption(graph.options, 'spacing.edgeEdge', 10) < 2) graph.options.set('spacing.edgeEdge', '2')
  if ((graph.layerlessNodes ?? graph.nodes).length > 0) {
    const compound = enumOption(graph.options, 'hierarchyHandling', ['INHERIT', 'INCLUDE_CHILDREN', 'SEPARATE_CHILDREN'] as const, 'INHERIT') === 'INCLUDE_CHILDREN'
    const random = new Random(integerOption(graph.options, 'randomSeed', 1))
    if (compound) {
      const component = layoutComponent(graph.nodes.filter(node => !node.noLayout), graph, random, true)
      graph.width = component.width + graph.padding.left + graph.padding.right
      graph.height = component.height + graph.padding.top + graph.padding.bottom
      graph.offsetX = component.offsetX + graph.padding.left
      graph.offsetY = component.offsetY + graph.padding.top
    } else {
      const constraints = enumOption(graph.options, 'portConstraints', ['UNDEFINED', 'FREE', 'FIXED_SIDE', 'FIXED_ORDER', 'FIXED_RATIO', 'FIXED_POS'] as const, 'UNDEFINED')
      const separate = booleanOption(graph.options, 'separateConnectedComponents', true) && (!graph.hasExternalPorts || constraints !== 'FIXED_ORDER' && constraints !== 'FIXED_RATIO' && constraints !== 'FIXED_POS')
      if (!separate) {
        const component = layoutComponent((graph.layerlessNodes ?? graph.nodes).filter(node => !node.noLayout), graph, random, false, false)
        graph.layerlessNodes = component.nodes
        resizeGraph(graph, component.width, component.height, component.offsetX, component.offsetY)
        transferIndependentGraph(graph)
        return
      }
      if (booleanOption(graph.options, 'layered.compaction.connectedComponents', false)) throw new Error('ELK TypeScript port: connected-component compaction is not implemented yet')
      const components: Component<LayoutNode>[] = []
      for (const nodes of splitComponents(graph)) {
        let connections = 0
        for (const node of nodes) if (node.type === 'EXTERNAL_PORT') connections |= node.externalPortSide === 'NORTH' ? 1 : node.externalPortSide === 'EAST' ? 2 : node.externalPortSide === 'SOUTH' ? 4 : node.externalPortSide === 'WEST' ? 8 : 0
        const component = layoutComponent(nodes, graph, random, false); component.connections = connections; components.push(component)
      }
      const ordering = enumOption(graph.options, 'layered.considerModelOrder.components', ['NONE', 'INSIDE_PORT_SIDE_GROUPS', 'GROUP_MODEL_ORDER', 'MODEL_ORDER'] as const, 'NONE')
      if (ordering !== 'NONE') throw new Error('ELK TypeScript port: model-order component placer is not implemented yet')
      const size = (graph.hasExternalPorts ? packComponentGroups : packComponents)(components, { spacing: numberOption(graph.options, 'spacing.componentComponent', 20), aspectRatio: numberOption(graph.options, 'aspectRatio', 1.600000023841858), preserveModelOrder: false })
      graph.layerlessNodes = (size.order ?? components).flatMap(component => component.nodes)
      resizeGraph(graph, size.width, size.height)
    }
  }
  transferIndependentGraph(graph)
}

function layoutIndependentDescendants(graph: LayoutGraph): void {
  for (const node of graph.nodes) if (node.contentGraph !== undefined && !node.noLayout) {
    if (node.nestedGraph !== undefined) layoutIndependentDescendants(node.nestedGraph)
    else {
      layoutGraph(node.contentGraph); node.width = node.contentGraph.width; node.height = node.contentGraph.height
      for (const port of node.sourcePorts) { const inside = port.insideConnections; initializePort(port, graph.direction); port.insideConnections = inside }
    }
  }
}
/** ElkLayered's actual two-stack collection and hierarchy-aware dispatch barriers. */
function layoutCompound(root: LayoutGraph): void {
  const compound = preprocessCompound(root), graphs = [root], search = [root]
  while (search.length > 0) {
    const graph = search.pop()!
    for (const node of graph.layerlessNodes!) if (node.nestedGraph !== undefined) { graphs.unshift(node.nestedGraph); search.push(node.nestedGraph) }
  }
  const crossing = enumOption(root.options, 'layered.crossingMinimization.strategy', ['LAYER_SWEEP', 'MEDIAN_LAYER_SWEEP', 'INTERACTIVE', 'NONE'] as const, 'LAYER_SWEEP')
  const greedy = enumOption(root.options, 'layered.crossingMinimization.greedySwitchHierarchical.type', ['ONE_SIDED', 'TWO_SIDED', 'OFF'] as const, 'OFF')
  const streams = new Map<LayoutGraph, Random>()
  for (const graph of graphs) {
    checkSupportedStrategies(graph.options)
    const childCrossing = enumOption(graph.options, 'layered.crossingMinimization.strategy', ['LAYER_SWEEP', 'MEDIAN_LAYER_SWEEP', 'INTERACTIVE', 'NONE'] as const, 'LAYER_SWEEP')
    if (childCrossing !== crossing) throw new Error('ELK TypeScript port: differing hierarchical crossing strategies are not implemented yet')
    graph.options.set('layered.crossingMinimization.greedySwitchHierarchical.type', greedy)
    if (numberOption(graph.options, 'spacing.edgeEdge', 10) < 2) graph.options.set('spacing.edgeEdge', '2')
    streams.set(graph, new Random(integerOption(graph.options, 'randomSeed', 1)))
  }
  const prepared = new Map<LayoutGraph, PreparedLayout>()
  for (const graph of graphs) {
    const layout = prepareLayout(graph.layerlessNodes!, graph, streams.get(graph)!, true)
    prepared.set(graph, layout)
  }
  minimizeHierarchicalCrossings(root)
  for (const graph of graphs) {
    if (graph === root) minimizeHierarchicalGreedySwitch(root)
    finishLayout(prepared.get(graph)!)
  }
  postprocessCompound(compound)
}

// GraphConfigurator chooses these algorithms and optional processors before
// component splitting. Valid alternatives outside the port must not silently
// run the default phase; invalid enum strings still use ELK's parsed defaults.
function checkSupportedStrategies(options: Options): void {
  const layering = enumOption(options, 'layered.layering.strategy', ['NETWORK_SIMPLEX', 'LONGEST_PATH', 'LONGEST_PATH_SOURCE', 'COFFMAN_GRAHAM', 'INTERACTIVE', 'STRETCH_WIDTH', 'MIN_WIDTH', 'BF_MODEL_ORDER', 'DF_MODEL_ORDER'] as const, 'NETWORK_SIMPLEX')
  if (layering !== 'NETWORK_SIMPLEX') throw new Error('ELK TypeScript port: layering strategy ' + layering + ' is not implemented yet')
  const placement = enumOption(options, 'layered.nodePlacement.strategy', ['SIMPLE', 'INTERACTIVE', 'LINEAR_SEGMENTS', 'BRANDES_KOEPF', 'NETWORK_SIMPLEX'] as const, 'BRANDES_KOEPF')
  if (placement !== 'BRANDES_KOEPF') throw new Error('ELK TypeScript port: node-placement strategy ' + placement + ' is not implemented yet')
  const routing = enumOption(options, 'edgeRouting', ['UNDEFINED', 'POLYLINE', 'ORTHOGONAL', 'SPLINES'] as const, 'ORTHOGONAL')
  if (routing !== 'ORTHOGONAL') throw new Error('ELK TypeScript port: edge-routing strategy ' + routing + ' is not implemented yet')
  const promotion = enumOption(options, 'layered.layering.nodePromotion.strategy', ['NONE', 'NIKOLOV', 'NIKOLOV_PIXEL', 'NIKOLOV_IMPROVED', 'NIKOLOV_IMPROVED_PIXEL', 'DUMMYNODE_PERCENTAGE', 'NODECOUNT_PERCENTAGE', 'NO_BOUNDARY', 'MODEL_ORDER_LEFT_TO_RIGHT', 'MODEL_ORDER_RIGHT_TO_LEFT'] as const, 'NONE')
  if (promotion !== 'NONE') throw new Error('ELK TypeScript port: node-promotion strategy ' + promotion + ' is not implemented yet')
  const unzipping = enumOption(options, 'layered.layerUnzipping.strategy', ['NONE', 'ALTERNATING'] as const, 'NONE')
  if (unzipping !== 'NONE') throw new Error('ELK TypeScript port: layer-unzipping strategy ' + unzipping + ' is not implemented yet')
  const wrapping = enumOption(options, 'layered.wrapping.strategy', ['OFF', 'SINGLE_EDGE', 'MULTI_EDGE'] as const, 'OFF')
  if (wrapping !== 'OFF') throw new Error('ELK TypeScript port: wrapping strategy ' + wrapping + ' is not implemented yet')
}

function minimumSize(options: Options): { x: number; y: number } {
  const minimum = vectorOption(options, 'nodeSize.minimum')
  const flags = setOption(options, 'nodeSize.options', SIZE_OPTIONS, ['DEFAULT_MINIMUM_SIZE'])
  if (flags.has('DEFAULT_MINIMUM_SIZE')) { if (minimum.x <= 0) minimum.x = 20; if (minimum.y <= 0) minimum.y = 20 }
  return minimum
}
function resizeGraph(graph: LayoutGraph, contentWidth: number, contentHeight: number, initialOffsetX = 0, initialOffsetY = 0): void {
  const padding = graph.padding
  const oldWidth = contentWidth + padding.left + padding.right, oldHeight = contentHeight + padding.top + padding.bottom
  let width = oldWidth, height = oldHeight, offsetX = initialOffsetX, offsetY = initialOffsetY
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
  graph.geometry = { width: width - padding.left - padding.right, height: height - padding.top - padding.bottom, offsetX, offsetY, padding, options: graph.options }
}
function emitGraph(graph: LayoutGraph, emitRoot = true): void {
  if (emitRoot) emitShape(graph.data, graph)
  for (const node of graph.nodes) { if (node.data === null) throw new Error('Layout node did not exist in input'); emitShape(node.data, { x: node.noLayout ? node.x : node.x + graph.offsetX, y: node.noLayout ? node.y : node.y + graph.offsetY, width: node.width, height: node.height }); for (const port of node.sourcePorts) if (port.data !== null) emitShape(port.data, port) }
  for (const edge of graph.sourceEdges) {
    if (edge.data === null) throw new Error('Layout edge did not exist in input')
    if (edge.noLayout) { writeMember(edge.data, 'container', edge.containerId === undefined ? graph.id : edge.containerId); continue }
    const source = edge.source, target = edge.target, owner = source.node.layoutGraph ?? graph, offset = emittedEdgeOffset(edge, owner)
    const start = descendantOf(target.node, source.node) ? { x: source.x + source.anchorX - owner.offsetX, y: source.y + source.anchorY - owner.offsetY } : { x: source.node.x + source.x + source.anchorX, y: source.node.y + source.y + source.anchorY }
    const end = { x: target.node.x + target.x + target.anchorX, y: target.node.y + target.y + target.anchorY }
    if (edge.targetOffset !== undefined) { end.x += edge.targetOffset.x; end.y += edge.targetOffset.y }
    start.x += offset.x; start.y += offset.y; end.x += offset.x; end.y += offset.y
    const section: import('./types.ts').ElkEdgeSection = { id: String(elementKey(edge.data)) + '_s0', startPoint: start, endPoint: end, incomingShape: (edge.sourceShapeKey ?? source.key ?? source.node.key) as string, outgoingShape: (edge.targetShapeKey ?? target.key ?? target.node.key) as string }
    if (edge.bends.length > 0) section.bendPoints = edge.bends.map(point => ({ x: point.x + offset.x, y: point.y + offset.y }))
    writeMember(edge.data, 'sections', [section])
    if (edge.junctions?.length) writeMember(edge.data, 'junctionPoints', edge.junctions.map(point => ({ x: point.x + offset.x, y: point.y + offset.y })))
    writeMember(edge.data, 'container', edge.containerId === undefined ? graph.id : edge.containerId)
  }
  for (const node of graph.nodes) if (node.contentGraph !== undefined) emitGraph(node.contentGraph, false)
  for (const label of graph.labels) emitLabel(label, false)
  for (const node of graph.nodes) {
    const nodePlacement = setOption(node.options, 'nodeLabels.placement', ['H_LEFT', 'H_CENTER', 'H_RIGHT', 'V_TOP', 'V_CENTER', 'V_BOTTOM', 'INSIDE', 'OUTSIDE', 'H_PRIORITY'], []).size > 0
    for (const label of node.sourceLabels) emitLabel(label, label.active && (nodePlacement || setOption(label.options, 'nodeLabels.placement', ['H_LEFT', 'H_CENTER', 'H_RIGHT', 'V_TOP', 'V_CENTER', 'V_BOTTOM', 'INSIDE', 'OUTSIDE', 'H_PRIORITY'], []).size > 0))
    for (const port of node.sourcePorts) for (const label of port.sourceLabels) emitLabel(label, false)
  }
  for (const edge of graph.sourceEdges) for (const label of edge.sourceLabels) {
    if (!edge.noLayout && label.active) { const owner = edge.source.node.layoutGraph ?? graph, offset = emittedEdgeOffset(edge, owner); emitShape(label.data, { x: label.x + offset.x, y: label.y + offset.y, width: label.width, height: label.height }) }
    else emitLabel(label, false)
  }
}
function descendantOf(child: LayoutNode, parent: LayoutNode): boolean { for (let node = child.layoutGraph?.parentNode; node !== undefined; node = node.layoutGraph?.parentNode) if (node === parent) return true; return false }
/** ElkGraphLayoutTransferrer.calculateHierarchicalOffset in source addition order. */
function emittedEdgeOffset(edge: LayoutEdge, sourceGraph: LayoutGraph): { x: number; y: number } {
  const hierarchical = { x: 0, y: 0 }, target = edge.coordinateOrigin
  if (target !== undefined) {
    let current = sourceGraph
    while (current !== target) {
      const parent = current.parentNode!
      current = parent.layoutGraph!
      const geometry = current.geometry ?? current
      hierarchical.x += parent.x; hierarchical.y += parent.y
      hierarchical.x += geometry.offsetX; hierarchical.y += geometry.offsetY
      hierarchical.x += geometry.padding.left; hierarchical.y += geometry.padding.top
    }
  }
  return { x: sourceGraph.offsetX + hierarchical.x, y: sourceGraph.offsetY + hierarchical.y }
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
  for (const node of graph.layerlessNodes ?? graph.nodes) if (!visited.has(node) && !node.noLayout) { const nodes: LayoutNode[] = []; visit(node, nodes); result.push(nodes) }
  return result
}
interface PreparedLayout {
  compound: boolean
  hierarchyPorts?: HierarchyPortState
  northSouthPorts: NorthSouthPortState
  nodes: LayoutNode[]
  graph: LayoutGraph
  random: Random
  direction: LayoutGraph['direction']
  state: GraphGeometry
  loops: ReturnType<typeof preprocessSelfLoops>
  centerLabels: ReturnType<typeof insertLabelDummies> | undefined
  layers: LayoutNode[][]
  phaseNodes: LayoutNode[]
}
function layoutComponent(nodes: LayoutNode[], graph: LayoutGraph, random: Random, compound: boolean, clearMinimum = !compound): Component<LayoutNode> {
  const prepared = prepareLayout(nodes, graph, random, compound, clearMinimum)
  minimizeCrossings(prepared.layers, prepared.state.options, random, (graph.layerlessNodes ?? graph.nodes).filter(node => !node.noLayout).length, graph.maxModelOrderNodes, true)
  return finishLayout(prepared)
}
function prepareLayout(nodes: LayoutNode[], graph: LayoutGraph, random: Random, compound: boolean, clearMinimum = !compound): PreparedLayout {
  const direction = graph.direction
  const state = { width: 0, height: 0, offsetX: 0, offsetY: 0, padding: { ...graph.padding }, options: new Map(graph.options) }
  if (clearMinimum) state.options.delete('nodeSize.minimum')
  state.options.set('direction', direction)
  for (const node of nodes) node.originalPortConstraints = node.portConstraints
  // The upstream strategy factory maps the preprocessor to TO_INPUT_DIRECTION.
  transformGraph(nodes, state, direction, 'TO_INPUT_DIRECTION')
  reverseConstrainedEdges(nodes)
  const partitioning = booleanOption(state.options, 'partitioning.activate', false)
  if (partitioning) preprocessPartitions(nodes)
  const loops = preprocessSelfLoops(nodes, state.options)
  const feedback = booleanOption(state.options, 'layered.feedbackEdges', false)
  if (feedback) assignPortSides(nodes)
  const cycleGraph = { nodes, random, cyclic: false, reverseEdge: (edge: import('./cycle-breaking.ts').CycleEdge) => reverseEdge(edge as import('./graph.ts').LayoutEdge, true), maxModelOrderNodes: graph.maxModelOrderNodes!, modelOrderGroupCount: graph.modelOrderGroupCount!, enforceGroupModelOrder: enumOption(state.options, 'layered.considerModelOrder.groupModelOrder.cbGroupOrderStrategy', ['ONLY_WITHIN_GROUP', 'MODEL_ORDER', 'ENFORCED'] as const, 'ONLY_WITHIN_GROUP') === 'ENFORCED' }
  const cycle = enumOption(state.options, 'layered.cycleBreaking.strategy', ['GREEDY', 'DEPTH_FIRST', 'INTERACTIVE', 'MODEL_ORDER', 'GREEDY_MODEL_ORDER', 'SCC_CONNECTIVITY', 'SCC_NODE_TYPE', 'DFS_NODE_ORDER', 'BFS_NODE_ORDER'] as const, 'GREEDY')
  if (cycle === 'GREEDY') breakGreedyCycles(cycleGraph)
  else if (cycle === 'MODEL_ORDER') breakModelOrderCycles(cycleGraph)
  else if (cycle === 'GREEDY_MODEL_ORDER') breakGreedyModelOrderCycles(cycleGraph)
  else throw new Error('ELK TypeScript port: cycle strategy ' + cycle + ' is not implemented yet')
  const centerLabels = nodes.some(node => node.ports.some(port => port.outgoing.some(edge => edge.source.node !== edge.target.node && edge.labels.some(label => enumOption(label.options, 'edgeLabels.placement', ['CENTER', 'HEAD', 'TAIL'] as const, 'CENTER') === 'CENTER')))) ? insertLabelDummies(nodes, state.options) : undefined
  const layererNodes = nodes.slice()
  const hiddenLayers = hideSeparateLayers(layererNodes)
  const partitions = partitioning ? addPartitionConstraints(layererNodes) : undefined
  const layers = assignNetworkSimplexLayers(layererNodes, integerOption(state.options, 'layered.thoroughness', 7))
  if (booleanOption(state.options, 'layered.highDegreeNodes.treatment', false)) applyHighDegreeLayers(layers, state.options)
  restoreSeparateLayers(layers, hiddenLayers)
  if (partitions !== undefined) removePartitionConstraints(layers, partitions)
  const hierarchyPorts = constrainHierarchyPorts(graph, layers)
  splitLongEdges(layers)
  if (!feedback) assignPortSides(layers.flat())
  insertInvertedPortDummies(layers, graph)
  sortPortLists(layers.flat(), state.options)
  graph.layers = layers; graph.phaseOptions = state.options; graph.random = random
  prepareCrossingModelOrder(graph)
  const northSouthPorts = preprocessNorthSouthPorts(layers, state.options)
  const phaseNodes = layers.flat()
  return { compound, hierarchyPorts, northSouthPorts, nodes, graph, random, direction, state, loops, centerLabels, layers, phaseNodes }
}
function finishLayout(prepared: PreparedLayout): Component<LayoutNode> {
  const { nodes, random, direction, state, loops, centerLabels, layers, phaseNodes } = prepared
  restoreSelfLoopPorts(layers, loops)
  enforceInLayerConstraints(layers)
  sizeAndPlacePorts(phaseNodes, state.options)
  calculateNodeMargins(phaseNodes)
  routeSelfLoops(layers, state.options, random, loops)
  const endLabels = layers.some(layer => layer.some(node => node.ports.some(port => [...port.incoming, ...port.outgoing].some(edge => edge.labels.some(label => enumOption(label.options, 'edgeLabels.placement', ['CENTER', 'HEAD', 'TAIL'] as const, 'CENTER') !== 'CENTER'))))) ? prepareEndLabels(layers, state.options) : undefined
  if (centerLabels !== undefined) { switchLabelDummies(layers, state.options, centerLabels); selectLabelSides(layers, state.options, centerLabels) }
  if (endLabels !== undefined) selectEndLabelSides(layers, state.options, endLabels)
  if (prepared.graph.hasHyperedges) mergeHyperedgeDummies(layers, state.options)
  sizeHierarchyPortDummies(layers, state.options, prepared.hierarchyPorts)
  placeNodes(layers, state.options)
  const measurement = measureLayers(layers, state.options)
  state.height = measurement.height; state.offsetY += measurement.offsetY
  positionHierarchyPorts(layers, state.options, state, prepared.hierarchyPorts)
  const size = routeOrthogonal(layers, state.options, random, measurement)
  state.width = size.width
  routeHierarchyPorts(layers, state.options, state, prepared.hierarchyPorts)
  joinLongEdges(layers, state.options)
  postprocessSelfLoops(layers, loops)
  postprocessNorthSouthPorts(layers, state.options, prepared.northSouthPorts)
  compactGraph(layers, state.options, state)
  if (centerLabels !== undefined) removeLabelDummies(layers, nodes, state.options, centerLabels)
  if (endLabels !== undefined) sortEndLabels(layers, endLabels)
  for (const layer of layers) for (const node of layer) for (const port of node.ports) for (const edge of [...port.outgoing]) if (edge.reversed) reverseEdge(edge, false)
  if (endLabels !== undefined) finishEndLabels(layers, endLabels)
  const completedNodes = layers.flat()
  if (prepared.compound) {
    prepared.graph.layerlessNodes = completedNodes
    prepared.graph.layers = []
    resizeHierarchicalGraph(state, prepared.graph)
    transferGraphToParent(prepared.graph, completedNodes, state)
  }
  transformGraph(completedNodes, state, direction, 'TO_INTERNAL_LTR')
  if (prepared.compound) {
    const graph = prepared.graph
    graph.geometry = state
    graph.width = state.width + state.padding.left + state.padding.right
    graph.height = state.height + state.padding.top + state.padding.bottom
    graph.offsetX = state.offsetX + state.padding.left; graph.offsetY = state.offsetY + state.padding.top
  }
  const points: { x: number; y: number }[] = []
  for (const node of completedNodes) for (const port of node.ports) for (const edge of port.outgoing) { points.push(...edge.bends); if (edge.junctions !== undefined) points.push(...edge.junctions); points.push(...edge.labels) }
  return { nodes: completedNodes, points, width: state.width, height: state.height, offsetX: state.offsetX, offsetY: state.offsetY }
}

/** HierarchicalNodeResizingProcessor's flat graph size/offset transfer. */
function resizeHierarchicalGraph(state: PreparedLayout['state'], graph: LayoutGraph): void {
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
  if (graph.hasExternalPorts && (width > oldWidth || height > oldHeight)) for (const node of graph.layerlessNodes ?? []) if (node.type === 'EXTERNAL_PORT') {
    if (node.externalPortSide === 'EAST') node.x += width - oldWidth
    else if (node.externalPortSide === 'SOUTH') node.y += height - oldHeight
  }
  state.width = width - padding.left - padding.right
  state.height = height - padding.top - padding.bottom
}

/** HierarchicalNodeResizingProcessor.graphLayoutToNode before direction postprocessing. */
function transferGraphToParent(graph: LayoutGraph, nodes: LayoutNode[], state: PreparedLayout['state']): void {
  const parent = graph.parentNode
  if (parent === undefined) return
  for (const node of nodes) if (node.originPort !== undefined) {
    const port = node.originPort, point = getExternalPortPosition(state, node, port.width, port.height)
    port.x = point.x; port.y = point.y; port.side = node.externalPortSide!
    if (!port.explicitAnchor) {
      if (port.side === 'NORTH') { port.anchorX = port.width / 2; port.anchorY = 0 }
      else if (port.side === 'EAST') { port.anchorX = port.width; port.anchorY = port.height / 2 }
      else if (port.side === 'SOUTH') { port.anchorX = port.width / 2; port.anchorY = port.height }
      else if (port.side === 'WEST') { port.anchorX = 0; port.anchorY = port.height / 2 }
    }
  }
  if (graph.hasExternalPorts) parent.portConstraints = 'FIXED_POS'
  resizeNode(parent, state.width + state.padding.left + state.padding.right, state.height + state.padding.top + state.padding.bottom, !graph.hasExternalPorts, true)
}

/** ElkGraphLayoutTransferrer top-level external ports and applyParentNodeLayout. */
function transferIndependentGraph(graph: LayoutGraph): void {
  const owner = graph.ownerNode
  if (owner === undefined || graph.parentNode !== undefined) return
  if (graph.hasExternalPorts) {
    const geometry = graph.geometry!
    for (const dummy of graph.layerlessNodes ?? []) if (dummy.originPort !== undefined) {
      const port = dummy.originPort, position = getExternalPortPosition(geometry, dummy, port.width, port.height)
      port.x = position.x; port.y = position.y
    }
    owner.portConstraints = 'FIXED_POS'; owner.options.set('portConstraints', 'FIXED_POS')
  }
  const portLabels = setOption(owner.options, 'nodeSize.constraints', SIZE_CONSTRAINTS, []).has('PORT_LABELS')
  if (graph.hasExternalPorts || !booleanOption(owner.options, 'nodeSize.fixedGraphSize', false)) resizeImportedNode(owner, graph.width, graph.height, !graph.hasExternalPorts, owner.layoutGraph?.direction ?? graph.direction)
  owner.options.set('nodeSize.constraints', portLabels ? '[PORT_LABELS]' : '[]')
}
