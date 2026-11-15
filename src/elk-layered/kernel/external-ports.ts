/*******************************************************************************
 * Copyright (c) 2010, 2016, 2017 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { providePort, isSideFixed, type LayoutGraph, type LayoutNode, type LayoutPort, type PortConstraints } from './graph.ts'
import { createDummy } from './long-edges.ts'
import { numberOption, optionalIntegerOption, optionalVectorOption, type Direction, type Insets, type Options } from './options.ts'

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
