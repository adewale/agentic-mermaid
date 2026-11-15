/*******************************************************************************
 * Copyright (c) 2010, 2016, 2017 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { providePort, isSideFixed, calculatePortSide, type LayoutGraph, type LayoutNode, type LayoutPort, type PortConstraints } from './graph.ts'
import { createDummy } from './long-edges.ts'
import { booleanOption, enumOption, setOption, numberOption, optionalIntegerOption, optionalVectorOption, type Direction, type Insets, type Options } from './options.ts'

type Point = { x: number; y: number }
/** LGraphUtil.createExternalPortDummy. The caller owns graph insertion. */
export function createExternalPortDummy(properties: Options | LayoutPort, constraints: PortConstraints, side: LayoutPort['side'], netFlow: number, nodeSize: Point | null, position: Point | null, size: Point, direction: Direction, graph: LayoutGraph): LayoutNode {
  const modelPort = properties instanceof Map ? undefined : properties, options = properties instanceof Map ? properties : properties.options
  const dummy = createDummy('EXTERNAL_PORT'), offset = modelPort === undefined ? numberOption(options, 'port.borderOffset', 0) : modelPort.borderOffset ?? 0
  dummy.layoutGraph = graph; dummy.externalPortSize = size; dummy.externalPortBorderOffset = offset
  const port = providePort(dummy, 'OUTPUT', 'UNDEFINED', false)
  if (!isSideFixed(constraints)) {
    side = direction === 'RIGHT' ? netFlow >= 0 ? 'EAST' : 'WEST' : direction === 'LEFT' ? netFlow >= 0 ? 'WEST' : 'EAST' : direction === 'DOWN' ? netFlow >= 0 ? 'SOUTH' : 'NORTH' : netFlow >= 0 ? 'NORTH' : 'SOUTH'
    options.set('port.side', side)
  }
  const configured = modelPort?.explicitAnchor ? { x: modelPort.anchorX, y: modelPort.anchorY } : optionalVectorOption(options, 'port.anchor'), anchor = configured === undefined ? { x: size.x / 2, y: size.y / 2 } : { ...configured }
  if (side === 'WEST') {
    dummy.layerConstraint = 'FIRST_SEPARATE'; dummy.layerConstraintSet = true; dummy.edgeConstraint = 'OUTGOING_ONLY'; dummy.height = size.y
    if (offset < 0) dummy.width = -offset
    port.side = 'EAST'; if (configured === undefined) anchor.x = size.x; anchor.x -= size.x
  } else if (side === 'EAST') {
    dummy.layerConstraint = 'LAST_SEPARATE'; dummy.layerConstraintSet = true; dummy.edgeConstraint = 'INCOMING_ONLY'; dummy.height = size.y
    if (offset < 0) dummy.width = -offset
    port.side = 'WEST'; if (configured === undefined) anchor.x = 0
  } else if (side === 'NORTH') {
    dummy.inLayerConstraint = 'TOP'; dummy.width = size.x
    if (offset < 0) dummy.height = -offset
    port.side = 'SOUTH'; if (configured === undefined) anchor.y = size.y; anchor.y -= size.y
  } else if (side === 'SOUTH') {
    dummy.inLayerConstraint = 'BOTTOM'; dummy.width = size.x
    if (offset < 0) dummy.height = -offset
    port.side = 'NORTH'; if (configured === undefined) anchor.y = 0
  }
  port.x = anchor.x; port.y = anchor.y; dummy.externalPortAnchor = anchor
  if (constraints === 'FIXED_ORDER' || constraints === 'FIXED_RATIO' || constraints === 'FIXED_POS') {
    let information = 0
    const index = modelPort?.index ?? optionalIntegerOption(options, 'port.index')
    if (constraints === 'FIXED_ORDER' && index !== undefined) {
      if (side === 'NORTH' || side === 'EAST') information = index
      else if (side === 'SOUTH' || side === 'WEST') information = -1 * index
    } else if (side === 'WEST' || side === 'EAST') { information = position!.y; if (constraints === 'FIXED_RATIO') information /= nodeSize!.y }
    else if (side === 'NORTH' || side === 'SOUTH') { information = position!.x; if (constraints === 'FIXED_RATIO') information /= nodeSize!.x }
    dummy.externalPortRatio = information
  }
  dummy.externalPortSide = side
  return dummy
}

/** LGraphUtil.getExternalPortPosition, including its mutations of the dummy. */
export function getExternalPortPosition(graph: { width: number; height: number; offsetX: number; offsetY: number; padding: Insets }, dummy: LayoutNode, portWidth: number, portHeight: number): Point {
  const position = { x: dummy.x, y: dummy.y }, offset = dummy.externalPortBorderOffset ?? 0, padding = graph.padding
  position.x += dummy.width / 2.0; position.y += dummy.height / 2.0
  if (dummy.externalPortSide === 'NORTH') {
    position.x += padding.left + graph.offsetX - portWidth / 2.0
    position.y = -portHeight - offset; dummy.y = -(padding.top + offset + graph.offsetY)
  } else if (dummy.externalPortSide === 'EAST') {
    position.x = graph.width + padding.left + padding.right + offset
    position.y += padding.top + graph.offsetY - portHeight / 2.0
    dummy.x = graph.width + padding.right + offset - graph.offsetX
  } else if (dummy.externalPortSide === 'SOUTH') {
    position.x += padding.left + graph.offsetX - portWidth / 2.0
    position.y = graph.height + padding.top + padding.bottom + offset
    dummy.y = graph.height + padding.bottom + offset - graph.offsetY
  } else if (dummy.externalPortSide === 'WEST') {
    position.x = -portWidth - offset
    position.y += padding.top + graph.offsetY - portHeight / 2.0
    dummy.x = -(padding.left + offset + graph.offsetX)
  }
  return position
}

/** ElkGraphImporter external ports for a separately laid out graph. */
export function importIndependentPorts(graph: LayoutGraph): void {
  const owner = graph.ownerNode
  if (owner === undefined || graph.parentNode !== undefined) return
  const ports = owner.sourcePorts, insideLabels = setOption(graph.options, 'portLabels.placement', ['OUTSIDE', 'INSIDE', 'NEXT_TO_PORT_IF_POSSIBLE', 'ALWAYS_SAME_SIDE', 'ALWAYS_OTHER_SAME_SIDE', 'SPACE_EFFICIENT'], ['OUTSIDE']).has('INSIDE')
  const constraints = enumOption(graph.options, 'portConstraints', ['UNDEFINED', 'FREE', 'FIXED_SIDE', 'FIXED_ORDER', 'FIXED_RATIO', 'FIXED_POS'] as const, 'UNDEFINED')
  const fromDirection: LayoutPort['side'] = graph.direction === 'RIGHT' ? 'EAST' : graph.direction === 'LEFT' ? 'WEST' : graph.direction === 'DOWN' ? 'SOUTH' : 'NORTH'
  const opposed: LayoutPort['side'] = fromDirection === 'EAST' ? 'WEST' : fromDirection === 'WEST' ? 'EAST' : fromDirection === 'SOUTH' ? 'NORTH' : 'SOUTH'
  const descendant = (node: LayoutNode): boolean => { for (let parent = node.parent; parent !== undefined; parent = parent.parent) if (parent === owner) return true; return false }
  const insideLoops = booleanOption(owner.options, 'insideSelfLoops.activate', false)
  const votes = new Map<LayoutPort, number>()
  let top = graph; while (top.ownerNode?.layoutGraph !== undefined) top = top.ownerNode.layoutGraph
  const skipped: import('./graph.ts').SkippedLayoutEdge[] = []
  const collect = (graph: LayoutGraph): void => { for (const edge of graph.sourceEdges) if (edge.noLayout) skipped.push(edge); for (const node of graph.nodes) if (node.contentGraph !== undefined) collect(node.contentGraph) }
  collect(top)
  for (const port of ports) {
    let output = 0, input = 0
    const outgoing = (target: LayoutNode, innerLoop: boolean): void => { if (target === owner) { if (innerLoop) input++; else output++ } else if (target.parent === owner) input++; else output++ }
    const incoming = (source: LayoutNode, innerLoop: boolean): void => { if (source === owner) { if (innerLoop) output++; else input++ } else if (source.parent === owner) output++; else input++ }
    for (const edge of port.outgoing) outgoing(edge.target.node, insideLoops && booleanOption(edge.options, 'insideSelfLoops.yo', false))
    for (const edge of port.incoming) incoming(edge.source.node, insideLoops && booleanOption(edge.options, 'insideSelfLoops.yo', false))
    for (const edge of skipped) {
      if (edge.sourceShape === port && edge.targetShape !== undefined) outgoing('node' in edge.targetShape ? edge.targetShape.node : edge.targetShape, insideLoops && booleanOption(edge.options, 'insideSelfLoops.yo', false))
      if (edge.targetShape === port && edge.sourceShape !== undefined) incoming('node' in edge.sourceShape ? edge.sourceShape.node : edge.sourceShape, insideLoops && booleanOption(edge.options, 'insideSelfLoops.yo', false))
    }
    const flow = output - input; votes.set(port, flow)
    if (!isSideFixed(constraints)) port.side = flow > 0 ? fromDirection : opposed
    else if (port.side === 'UNDEFINED') { port.side = calculatePortSide(port, graph.direction); if (port.side === 'UNDEFINED') port.side = fromDirection }
    port.options.set('port.side', port.side)
  }
  if (!ports.some(port => port.insideConnections === true || insideLabels && port.sourceLabels.length > 0)) return
  graph.hasExternalPorts = true
  const dummies: LayoutNode[] = []
  for (const port of ports) {
    if (port.borderOffset === null) port.borderOffset = port.x === 0 && port.y === 0 ? 0 : port.side === 'NORTH' ? -(port.y + port.height) : port.side === 'EAST' ? port.x - owner.width : port.side === 'SOUTH' ? port.y - owner.height : -(port.x + port.width)
    const dummy = createExternalPortDummy(port, constraints, port.side, votes.get(port)!, { x: owner.width, y: owner.height }, { x: port.x + port.width / 2, y: port.y + port.height / 2 }, { x: port.width, y: port.height }, graph.direction, graph)
    port.side = dummy.externalPortSide!; port.options.set('port.borderOffset', Object.is(port.borderOffset, -0) ? '-0' : String(port.borderOffset))
    dummy.originPort = port
    const inner = dummy.ports[0]!
    inner.connectedToExternalNodes = port.incoming.some(edge => !descendant(edge.source.node)) || port.outgoing.some(edge => !descendant(edge.target.node))
    dummy.options.set('portLabels.placement', '[OUTSIDE]')
    for (const label of port.labels) {
      const copy = { ...label, options: new Map(label.options) }
      if (!insideLabels) {
        const placement = setOption(graph.options, 'portLabels.placement', ['OUTSIDE', 'INSIDE', 'NEXT_TO_PORT_IF_POSSIBLE', 'ALWAYS_SAME_SIDE', 'ALWAYS_OTHER_SAME_SIDE', 'SPACE_EFFICIENT'], ['OUTSIDE']), fixed = !placement.has('OUTSIDE') && !placement.has('INSIDE')
        let part = 0
        if (fixed) part = port.side === 'NORTH' ? Math.max(0, label.height + label.y - port.height) : port.side === 'SOUTH' ? Math.max(0, -label.y) : port.side === 'EAST' ? Math.max(0, -label.x) : Math.max(0, label.width + label.x - port.width)
        if (port.side === 'EAST' || port.side === 'WEST') copy.width = part; else copy.height = part
      }
      inner.labels.push(copy)
    }
    const parentOptions = owner.layoutGraph?.options ?? new Map()
    for (const [key, fallback] of [['spacing.labelPortHorizontal', 1], ['spacing.labelPortVertical', 1], ['spacing.labelLabel', 0]] as const) dummy.options.set(key, String(numberOption(parentOptions, key, fallback)))
    for (const edge of port.incoming.slice()) if (edge.containerGraph === graph) { port.incoming.splice(port.incoming.indexOf(edge), 1); edge.target = inner; inner.incoming.push(edge) }
    for (const edge of port.outgoing.slice()) if (edge.containerGraph === graph) { port.outgoing.splice(port.outgoing.indexOf(edge), 1); edge.source = inner; inner.outgoing.push(edge) }
    dummies.push(dummy)
  }
  graph.layerlessNodes = dummies.concat(graph.nodes.filter(node => !node.noLayout))
}
