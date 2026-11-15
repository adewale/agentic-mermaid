/*******************************************************************************
 * Copyright (c) 2014, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Collection } from '../../../../../../java/util/Collection.ts'
import { KVector } from '../../../core/math/KVector.ts'
import { Alignment } from '../../../core/options/Alignment.ts'
import { CoreOptions } from '../../../core/options/CoreOptions.ts'
import { Direction } from '../../../core/options/Direction.ts'
import { EdgeLabelPlacement } from '../../../core/options/EdgeLabelPlacement.ts'
import { PortConstraints } from '../../../core/options/PortConstraints.ts'
import { PortSide } from '../../../core/options/PortSide.ts'
import { SizeConstraint } from '../../../core/options/SizeConstraint.ts'
import { GraphProperties } from '../options/GraphProperties.ts'
import { EdgeConstraint } from '../options/EdgeConstraint.ts'
import { InLayerConstraint } from '../options/InLayerConstraint.ts'
import { LayerConstraint } from '../options/LayerConstraint.ts'
import { InternalProperties } from '../options/InternalProperties.ts'
import { LayeredOptions } from '../options/LayeredOptions.ts'
import { PortType } from '../options/PortType.ts'
import type { LGraph } from './LGraph.ts'
import { LNode } from './LNode.ts'
import type { LEdge } from './LEdge.ts'
import type { Layer } from './Layer.ts'
import { LPort } from './LPort.ts'
import type { IPropertyHolder } from '../../../graph/properties/IPropertyHolder.ts'
import type { IProperty } from '../../../graph/properties/IProperty.ts'

export class LGraphUtil {
  private constructor() {}
  static toNodeArray(nodes: Collection<LNode>): LNode[] { return nodes.toArray(new Array<LNode>(nodes.size())) }
  static toEdgeArray(edges: Collection<LEdge>): LEdge[] { return edges.toArray(new Array<LEdge>(edges.size())) }
  static toPortArray(ports: Collection<LPort>): LPort[] { return ports.toArray(new Array<LPort>(ports.size())) }

  static resizeNode(node: LNode, newSize: KVector, movePorts: boolean, moveLabels: boolean): void {
    const oldSize = new KVector(node.getSize())
    const widthRatio = Math.fround(newSize.x / oldSize.x)
    const heightRatio = Math.fround(newSize.y / oldSize.y)
    const widthDiff = Math.fround(newSize.x - oldSize.x)
    const heightDiff = Math.fround(newSize.y - oldSize.y)
    if (movePorts) {
      const fixedPorts = node.getProperty(LayeredOptions.PORT_CONSTRAINTS) === PortConstraints.FIXED_POS
      for (const port of node.getPorts()) {
        switch (port.getSide()) {
          case PortSide.NORTH:
            if (!fixedPorts) port.getPosition().x *= widthRatio
            break
          case PortSide.EAST:
            port.getPosition().x += widthDiff
            if (!fixedPorts) port.getPosition().y *= heightRatio
            break
          case PortSide.SOUTH:
            if (!fixedPorts) port.getPosition().x *= widthRatio
            port.getPosition().y += heightDiff
            break
          case PortSide.WEST:
            if (!fixedPorts) port.getPosition().y *= heightRatio
            break
        }
      }
    }
    if (moveLabels) {
      for (const label of node.getLabels()) {
        const midx = label.getPosition().x + label.getSize().x / 2
        const midy = label.getPosition().y + label.getSize().y / 2
        const widthPercent = midx / oldSize.x
        const heightPercent = midy / oldSize.y
        if (widthPercent + heightPercent >= 1) {
          if (widthPercent - heightPercent > 0 && midy >= 0) {
            label.getPosition().x += widthDiff
            label.getPosition().y += heightDiff * heightPercent
          } else if (widthPercent - heightPercent < 0 && midx >= 0) {
            label.getPosition().x += widthDiff * widthPercent
            label.getPosition().y += heightDiff
          }
        }
      }
    }
    node.getSize().x = newSize.x
    node.getSize().y = newSize.y
    node.setProperty(LayeredOptions.NODE_SIZE_CONSTRAINTS, SizeConstraint.fixed())
  }

  static offsetGraphs(graphs: Collection<LGraph>, offsetx: number, offsety: number): void {
    for (const graph of graphs) LGraphUtil.offsetGraph(graph, offsetx, offsety)
  }
  static offsetGraph(graph: LGraph, offsetx: number, offsety: number): void {
    const graphOffset = new KVector(offsetx, offsety)
    for (const node of graph.getLayerlessNodes()) {
      node.getPosition().add(graphOffset)
      for (const port of node.getPorts()) {
        for (const edge of port.getOutgoingEdges()) {
          edge.getBendPoints().offset(graphOffset)
          const junctionPoints = edge.getProperty(LayeredOptions.JUNCTION_POINTS)
          if (junctionPoints !== null) junctionPoints.offset(graphOffset)
          for (const label of edge.getLabels()) label.getPosition().add(graphOffset)
        }
      }
    }
  }

  static placeNodesHorizontally(layer: Layer, xoffset: number): void {
    let maxLeftMargin = 0
    let maxRightMargin = 0
    for (const node of layer.getNodes()) {
      maxLeftMargin = Math.max(maxLeftMargin, node.getMargin().left)
      maxRightMargin = Math.max(maxRightMargin, node.getMargin().right)
    }
    for (const node of layer.getNodes()) {
      const alignment = node.getProperty(LayeredOptions.ALIGNMENT)
      let ratio: number
      switch (alignment) {
        case Alignment.LEFT: ratio = 0; break
        case Alignment.RIGHT: ratio = 1; break
        case Alignment.CENTER: ratio = 0.5; break
        default: {
          let inports = 0
          let outports = 0
          for (const port of node.getPorts()) {
            if (!port.getIncomingEdges().isEmpty()) inports = (inports + 1) | 0
            if (!port.getOutgoingEdges().isEmpty()) outports = (outports + 1) | 0
          }
          ratio = ((inports + outports) | 0) === 0 ? 0.5 : outports / ((inports + outports) | 0)
        }
      }
      const size = layer.getSize()
      const nodeSize = node.getSize().x
      let xpos = (size.x - nodeSize) * ratio
      if (ratio > 0.5) xpos -= maxRightMargin * 2 * (ratio - 0.5)
      else if (ratio < 0.5) xpos += maxLeftMargin * 2 * (0.5 - ratio)
      const leftMargin = node.getMargin().left
      if (xpos < leftMargin) xpos = leftMargin
      const rightMargin = node.getMargin().right
      if (xpos > size.x - rightMargin - nodeSize) xpos = size.x - rightMargin - nodeSize
      node.getPosition().x = xoffset + xpos
    }
  }

  static findMaxNonDummyNodeWidth(layer: Layer, respectNodeMargins: boolean): number {
    if (layer.getGraph().getProperty(LayeredOptions.DIRECTION)!.isVertical()) return 0
    let maxWidth = 0
    for (const node of layer) {
      if (node.getType() === LNode.NodeType.NORMAL) {
        let width = node.getSize().x
        if (respectNodeMargins) width += node.getMargin().left + node.getMargin().right
        maxWidth = Math.max(maxWidth, width)
      }
    }
    return maxWidth
  }

  static computeGraphProperties(layeredGraph: LGraph): void {
    const props = layeredGraph.getProperty(InternalProperties.GRAPH_PROPERTIES)!
    if (!props.isEmpty()) props.clear()
    const direction = LGraphUtil.getDirection(layeredGraph)
    for (const node of layeredGraph.getLayerlessNodes()) {
      if (node.getProperty(LayeredOptions.COMMENT_BOX)) props.add(GraphProperties.COMMENTS)
      else if (node.getProperty(LayeredOptions.HYPERNODE)) { props.add(GraphProperties.HYPERNODES); props.add(GraphProperties.HYPEREDGES) }
      else if (node.getType() === LNode.NodeType.EXTERNAL_PORT) props.add(GraphProperties.EXTERNAL_PORTS)
      const portConstraints = node.getProperty(LayeredOptions.PORT_CONSTRAINTS)
      if (portConstraints === PortConstraints.UNDEFINED) node.setProperty(LayeredOptions.PORT_CONSTRAINTS, PortConstraints.FREE)
      else if (portConstraints !== PortConstraints.FREE) props.add(GraphProperties.NON_FREE_PORTS)
      for (const port of node.getPorts()) {
        if (((port.getIncomingEdges().size() + port.getOutgoingEdges().size()) | 0) > 1) props.add(GraphProperties.HYPEREDGES)
        const portSide = port.getSide()
        switch (direction) {
          case Direction.UP:
          case Direction.DOWN:
            if (portSide === PortSide.EAST || portSide === PortSide.WEST) props.add(GraphProperties.NORTH_SOUTH_PORTS)
            break
          default:
            if (portSide === PortSide.NORTH || portSide === PortSide.SOUTH) props.add(GraphProperties.NORTH_SOUTH_PORTS)
        }
        for (const edge of port.getOutgoingEdges()) {
          if (edge.getTarget()!.getNode() === node) props.add(GraphProperties.SELF_LOOPS)
          for (const label of edge.getLabels()) {
            switch (label.getProperty(LayeredOptions.EDGE_LABELS_PLACEMENT)) {
              case EdgeLabelPlacement.CENTER: props.add(GraphProperties.CENTER_LABELS); break
              case EdgeLabelPlacement.HEAD:
              case EdgeLabelPlacement.TAIL: props.add(GraphProperties.END_LABELS); break
            }
          }
        }
      }
    }
  }

  static createPort(node: LNode, endPoint: KVector | null, type: PortType, layeredGraph: LGraph): LPort | null {
    let port: LPort | null
    const direction = LGraphUtil.getDirection(layeredGraph)
    const mergePorts = layeredGraph.getProperty(LayeredOptions.MERGE_EDGES)
    if ((mergePorts || node.getProperty(LayeredOptions.HYPERNODE)) && !node.getProperty(LayeredOptions.PORT_CONSTRAINTS)!.isSideFixed()) {
      const defaultSide = PortSide.fromDirection(direction)
      port = LGraphUtil.provideCollectorPort(layeredGraph, node, type, type === PortType.OUTPUT ? defaultSide : defaultSide.opposed())
    } else {
      port = new LPort()
      port.setNode(node)
      if (endPoint !== null) {
        const pos = port.getPosition()
        pos.x = endPoint.x - node.getPosition().x
        pos.y = endPoint.y - node.getPosition().y
        pos.bound(0, 0, node.getSize().x, node.getSize().y)
        port.setSide(LGraphUtil.calcPortSide(port, direction))
      } else {
        const defaultSide = PortSide.fromDirection(direction)
        port.setSide(type === PortType.OUTPUT ? defaultSide : defaultSide.opposed())
      }
      const graphProperties = layeredGraph.getProperty(InternalProperties.GRAPH_PROPERTIES)!
      const portSide = port.getSide()
      switch (direction) {
        case Direction.LEFT:
        case Direction.RIGHT:
          if (portSide === PortSide.NORTH || portSide === PortSide.SOUTH) graphProperties.add(GraphProperties.NORTH_SOUTH_PORTS)
          break
        case Direction.UP:
        case Direction.DOWN:
          if (portSide === PortSide.EAST || portSide === PortSide.WEST) graphProperties.add(GraphProperties.NORTH_SOUTH_PORTS)
          break
      }
    }
    return port
  }

  static calcPortSide(port: LPort, direction: Direction): PortSide {
    const node = port.getNode()!
    const nodeWidth = node.getSize().x
    const nodeHeight = node.getSize().y
    if (nodeWidth <= 0 && nodeHeight <= 0) return PortSide.UNDEFINED
    const xpos = port.getPosition().x
    const ypos = port.getPosition().y
    const width = port.getSize().x
    const height = port.getSize().y
    switch (direction) {
      case Direction.LEFT:
      case Direction.RIGHT:
        if (xpos < 0) return PortSide.WEST
        if (xpos + width > nodeWidth) return PortSide.EAST
        break
      case Direction.UP:
      case Direction.DOWN:
        if (ypos < 0) return PortSide.NORTH
        if (ypos + height > nodeHeight) return PortSide.SOUTH
        break
    }
    const widthPercent = (xpos + width / 2) / nodeWidth
    const heightPercent = (ypos + height / 2) / nodeHeight
    if (widthPercent + heightPercent <= 1 && widthPercent - heightPercent <= 0) return PortSide.WEST
    if (widthPercent + heightPercent >= 1 && widthPercent - heightPercent >= 0) return PortSide.EAST
    if (heightPercent < 0.5) return PortSide.NORTH
    return PortSide.SOUTH
  }

  static calcPortOffset(port: LPort, side: PortSide): number {
    const node = port.getNode()!
    switch (side) {
      case PortSide.NORTH: return -(port.getPosition().y + port.getSize().y)
      case PortSide.EAST: return port.getPosition().x - node.getSize().x
      case PortSide.SOUTH: return port.getPosition().y - node.getSize().y
      case PortSide.WEST: return -(port.getPosition().x + port.getSize().x)
    }
    return 0
  }

  static centerPoint(point: KVector, boundary: KVector, side: PortSide): void {
    switch (side) {
      case PortSide.NORTH: point.x = boundary.x / 2; point.y = 0; break
      case PortSide.EAST: point.x = boundary.x; point.y = boundary.y / 2; break
      case PortSide.SOUTH: point.x = boundary.x / 2; point.y = boundary.y; break
      case PortSide.WEST: point.x = 0; point.y = boundary.y / 2; break
    }
  }

  static provideCollectorPort(_layeredGraph: LGraph, node: LNode, type: PortType, side: PortSide): LPort | null {
    let port: LPort | null = null
    switch (type) {
      case PortType.INPUT:
        for (const inport of node.getPorts()) if (inport.getProperty(InternalProperties.INPUT_COLLECT)) return inport
        port = new LPort()
        port.setProperty(InternalProperties.INPUT_COLLECT, true)
        break
      case PortType.OUTPUT:
        for (const outport of node.getPorts()) if (outport.getProperty(InternalProperties.OUTPUT_COLLECT)) return outport
        port = new LPort()
        port.setProperty(InternalProperties.OUTPUT_COLLECT, true)
        break
    }
    if (port !== null) {
      port.setNode(node)
      port.setSide(side)
      LGraphUtil.centerPoint(port.getPosition(), node.getSize(), side)
    }
    return port
  }

  static initializePort(port: LPort, portConstraints: PortConstraints, direction: Direction, anchorPos: KVector | null): void {
    let portSide = port.getSide()
    if (portSide === PortSide.UNDEFINED && portConstraints.isSideFixed()) {
      portSide = LGraphUtil.calcPortSide(port, direction)
      port.setSide(portSide)
      if (!port.getAllProperties().containsKey(LayeredOptions.PORT_BORDER_OFFSET) && portSide !== PortSide.UNDEFINED && (port.getPosition().x !== 0 || port.getPosition().y !== 0)) port.setProperty(LayeredOptions.PORT_BORDER_OFFSET, LGraphUtil.calcPortOffset(port, portSide))
    }
    if (portConstraints.isRatioFixed()) {
      let ratio = 0
      switch (portSide) {
        case PortSide.NORTH:
        case PortSide.SOUTH: {
          const nodeWidth = port.getNode()!.getSize().x
          if (nodeWidth > 0) ratio = port.getPosition().x / nodeWidth
          break
        }
        case PortSide.EAST:
        case PortSide.WEST: {
          const nodeHeight = port.getNode()!.getSize().y
          if (nodeHeight > 0) ratio = port.getPosition().y / nodeHeight
          break
        }
      }
      port.setProperty(InternalProperties.PORT_RATIO_OR_POSITION, ratio)
    }
    const portSize = port.getSize()
    const portAnchor = port.getAnchor()
    if (anchorPos !== null) {
      portAnchor.x = anchorPos.x
      portAnchor.y = anchorPos.y
      port.setExplicitlySuppliedPortAnchor(true)
    } else if (portConstraints.isSideFixed() && portSide !== PortSide.UNDEFINED) {
      switch (portSide) {
        case PortSide.NORTH: portAnchor.x = portSize.x / 2; break
        case PortSide.EAST: portAnchor.x = portSize.x; portAnchor.y = portSize.y / 2; break
        case PortSide.SOUTH: portAnchor.x = portSize.x / 2; portAnchor.y = portSize.y; break
        case PortSide.WEST: portAnchor.y = portSize.y / 2; break
      }
    } else {
      portAnchor.x = portSize.x / 2
      portAnchor.y = portSize.y / 2
    }
  }

  static createExternalPortDummy(propertyHolder: IPropertyHolder, portConstraints: PortConstraints, portSide: PortSide, netFlow: number, portNodeSize: KVector, portPosition: KVector, portSize: KVector, layoutDirection: Direction, layeredGraph: LGraph): LNode {
    let finalExternalPortSide = portSide
    const dummy = new LNode(layeredGraph)
    dummy.setType(LNode.NodeType.EXTERNAL_PORT)
    dummy.setProperty(InternalProperties.EXT_PORT_SIZE, portSize)
    dummy.setProperty(LayeredOptions.PORT_CONSTRAINTS, PortConstraints.FIXED_POS)
    const portBorderOffset = propertyHolder.getProperty(LayeredOptions.PORT_BORDER_OFFSET)!
    dummy.setProperty(LayeredOptions.PORT_BORDER_OFFSET, portBorderOffset)
    const dummyPort = new LPort()
    dummyPort.setNode(dummy)
    if (!portConstraints.isSideFixed()) {
      if (netFlow >= 0) finalExternalPortSide = PortSide.fromDirection(layoutDirection)
      else finalExternalPortSide = PortSide.fromDirection(layoutDirection).opposed()
      propertyHolder.setProperty(LayeredOptions.PORT_SIDE, finalExternalPortSide)
    }
    const anchor = new KVector()
    let explicitAnchor = false
    if (propertyHolder.hasProperty(LayeredOptions.PORT_ANCHOR)) {
      anchor.set(propertyHolder.getProperty(LayeredOptions.PORT_ANCHOR)!)
      explicitAnchor = true
    } else anchor.set(portSize.x / 2, portSize.y / 2)
    switch (finalExternalPortSide) {
      case PortSide.WEST:
        dummy.setProperty(LayeredOptions.LAYERING_LAYER_CONSTRAINT, LayerConstraint.FIRST_SEPARATE)
        dummy.setProperty(InternalProperties.EDGE_CONSTRAINT, EdgeConstraint.OUTGOING_ONLY)
        dummy.getSize().y = portSize.y
        if (portBorderOffset < 0) dummy.getSize().x = -portBorderOffset
        dummyPort.setSide(PortSide.EAST)
        if (!explicitAnchor) anchor.x = portSize.x
        anchor.x -= portSize.x
        break
      case PortSide.EAST:
        dummy.setProperty(LayeredOptions.LAYERING_LAYER_CONSTRAINT, LayerConstraint.LAST_SEPARATE)
        dummy.setProperty(InternalProperties.EDGE_CONSTRAINT, EdgeConstraint.INCOMING_ONLY)
        dummy.getSize().y = portSize.y
        if (portBorderOffset < 0) dummy.getSize().x = -portBorderOffset
        dummyPort.setSide(PortSide.WEST)
        if (!explicitAnchor) anchor.x = 0
        break
      case PortSide.NORTH:
        dummy.setProperty(InternalProperties.IN_LAYER_CONSTRAINT, InLayerConstraint.TOP)
        dummy.getSize().x = portSize.x
        if (portBorderOffset < 0) dummy.getSize().y = -portBorderOffset
        dummyPort.setSide(PortSide.SOUTH)
        if (!explicitAnchor) anchor.y = portSize.y
        anchor.y -= portSize.y
        break
      case PortSide.SOUTH:
        dummy.setProperty(InternalProperties.IN_LAYER_CONSTRAINT, InLayerConstraint.BOTTOM)
        dummy.getSize().x = portSize.x
        if (portBorderOffset < 0) dummy.getSize().y = -portBorderOffset
        dummyPort.setSide(PortSide.NORTH)
        if (!explicitAnchor) anchor.y = 0
        break
    }
    dummyPort.getPosition().set(anchor)
    dummy.setProperty(LayeredOptions.PORT_ANCHOR, anchor)
    if (portConstraints.isOrderFixed()) {
      let informationAboutIt = 0
      if (portConstraints === PortConstraints.FIXED_ORDER && propertyHolder.hasProperty(LayeredOptions.PORT_INDEX)) {
        switch (finalExternalPortSide) {
          case PortSide.NORTH:
          case PortSide.EAST: informationAboutIt = propertyHolder.getProperty(LayeredOptions.PORT_INDEX)!; break
          case PortSide.SOUTH:
          case PortSide.WEST: informationAboutIt = -1 * propertyHolder.getProperty(LayeredOptions.PORT_INDEX)!; break
        }
      } else {
        switch (finalExternalPortSide) {
          case PortSide.WEST:
          case PortSide.EAST:
            informationAboutIt = portPosition.y
            if (portConstraints.isRatioFixed()) informationAboutIt /= portNodeSize.y
            break
          case PortSide.NORTH:
          case PortSide.SOUTH:
            informationAboutIt = portPosition.x
            if (portConstraints.isRatioFixed()) informationAboutIt /= portNodeSize.x
            break
        }
      }
      dummy.setProperty(InternalProperties.PORT_RATIO_OR_POSITION, informationAboutIt)
    }
    dummy.setProperty(InternalProperties.EXT_PORT_SIDE, finalExternalPortSide)
    return dummy
  }

  static getExternalPortPosition(graph: LGraph, portDummy: LNode, portWidth: number, portHeight: number): KVector {
    const portPosition = new KVector(portDummy.getPosition())
    portPosition.x += portDummy.getSize().x / 2
    portPosition.y += portDummy.getSize().y / 2
    const portOffset = portDummy.getProperty(LayeredOptions.PORT_BORDER_OFFSET)!
    const graphSize = graph.getSize()
    const padding = graph.getPadding()
    const graphOffset = graph.getOffset()
    switch (portDummy.getProperty(InternalProperties.EXT_PORT_SIDE)) {
      case PortSide.NORTH:
        portPosition.x += padding.left + graphOffset.x - portWidth / 2
        portPosition.y = -portHeight - portOffset
        portDummy.getPosition().y = -(padding.top + portOffset + graphOffset.y)
        break
      case PortSide.EAST:
        portPosition.x = graphSize.x + padding.left + padding.right + portOffset
        portPosition.y += padding.top + graphOffset.y - portHeight / 2
        portDummy.getPosition().x = graphSize.x + padding.right + portOffset - graphOffset.x
        break
      case PortSide.SOUTH:
        portPosition.x += padding.left + graphOffset.x - portWidth / 2
        portPosition.y = graphSize.y + padding.top + padding.bottom + portOffset
        portDummy.getPosition().y = graphSize.y + padding.bottom + portOffset - graphOffset.y
        break
      case PortSide.WEST:
        portPosition.x = -portWidth - portOffset
        portPosition.y += padding.top + graphOffset.y - portHeight / 2
        portDummy.getPosition().x = -(padding.left + portOffset + graphOffset.x)
        break
    }
    return portPosition
  }

  static isDescendant(child: LNode, parent: LNode): boolean {
    let current = child
    let next = current.getGraph()!.getParentNode()
    while (next !== null) {
      current = next
      if (current === parent) return true
      next = current.getGraph()!.getParentNode()
    }
    return false
  }

  static changeCoordSystem(point: KVector, oldGraph: LGraph, newGraph: LGraph): void {
    if (oldGraph === newGraph) return
    let graph = oldGraph
    let node: LNode | null
    do {
      point.add(graph.getOffset())
      node = graph.getParentNode()
      if (node !== null) {
        const padding = graph.getPadding()
        point.add(padding.left, padding.top)
        point.add(node.getPosition())
        graph = node.getGraph()!
      }
    } while (node !== null)
    graph = newGraph
    do {
      point.sub(graph.getOffset())
      node = graph.getParentNode()
      if (node !== null) {
        const padding = graph.getPadding()
        point.sub(padding.left, padding.top)
        point.sub(node.getPosition())
        graph = node.getGraph()!
      }
    } while (node !== null)
  }

  static getDirection(graph: LGraph): Direction {
    const direction = graph.getProperty(LayeredOptions.DIRECTION)!
    if (direction === Direction.UNDEFINED) {
      const aspectRatio = graph.getProperty(LayeredOptions.ASPECT_RATIO)!
      return aspectRatio >= 1 ? Direction.RIGHT : Direction.DOWN
    }
    return direction
  }

  static getIndividualOrInherited<T>(node: LNode, property: IProperty<T>): T | null {
    let result: T | null = null
    if (node.hasProperty(CoreOptions.SPACING_INDIVIDUAL)) {
      const individualSpacings = node.getProperty(CoreOptions.SPACING_INDIVIDUAL)
      if (individualSpacings.hasProperty(property)) result = individualSpacings.getProperty(property)
    }
    if (result === null && node.getGraph() !== null) result = node.getGraph()!.getProperty(property)
    return result
  }

  static getMinimalModelOrder(graph: LGraph): number {
    let order = 2147483647
    for (const node of graph.getLayerlessNodes()) if (node.hasProperty(InternalProperties.MODEL_ORDER)) order = Math.min(order, node.getProperty(InternalProperties.MODEL_ORDER)!)
    return order
  }
}
