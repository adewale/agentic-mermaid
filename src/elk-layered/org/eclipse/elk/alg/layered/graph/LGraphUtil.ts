/*******************************************************************************
 * Copyright (c) 2014, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Collection } from '../../../../../../java/util/Collection.ts'
import type { KVector } from '../../../core/math/KVector.ts'
import { PortSide } from '../../../core/options/PortSide.ts'
import { InternalProperties } from '../options/InternalProperties.ts'
import { PortType } from '../options/PortType.ts'
import type { LGraph } from './LGraph.ts'
import type { LNode } from './LNode.ts'
import type { LEdge } from './LEdge.ts'
import { LPort } from './LPort.ts'

export class LGraphUtil {
  private constructor() {}
  static toNodeArray(nodes: Collection<LNode>): LNode[] { return nodes.toArray(new Array<LNode>(nodes.size())) }
  static toEdgeArray(edges: Collection<LEdge>): LEdge[] { return edges.toArray(new Array<LEdge>(edges.size())) }
  static toPortArray(ports: Collection<LPort>): LPort[] { return ports.toArray(new Array<LPort>(ports.size())) }

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
}
