/*******************************************************************************
 * Copyright (c) 2010, 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutNode } from './graph.ts'

/** LGraphUtil.resizeNode; elkjs preserves these computations as doubles. */
export function resizeNode(node: LayoutNode, width: number, height: number, movePorts: boolean, moveLabels: boolean): void {
  const oldWidth = node.width, oldHeight = node.height, widthRatio = width / oldWidth, heightRatio = height / oldHeight, widthDiff = width - oldWidth, heightDiff = height - oldHeight
  if (movePorts) {
    const fixed = node.portConstraints === 'FIXED_POS'
    for (const port of node.ports) {
      if (port.side === 'NORTH') { if (!fixed) port.x *= widthRatio }
      else if (port.side === 'EAST') { port.x += widthDiff; if (!fixed) port.y *= heightRatio }
      else if (port.side === 'SOUTH') { if (!fixed) port.x *= widthRatio; port.y += heightDiff }
      else if (port.side === 'WEST') { if (!fixed) port.y *= heightRatio }
    }
  }
  if (moveLabels) for (const label of node.labels) {
    const midX = label.x + label.width / 2, midY = label.y + label.height / 2, widthPercent = midX / oldWidth, heightPercent = midY / oldHeight
    if (widthPercent + heightPercent >= 1) {
      if (widthPercent - heightPercent > 0 && midY >= 0) { label.x += widthDiff; label.y += heightDiff * heightPercent }
      else if (widthPercent - heightPercent < 0 && midX >= 0) { label.x += widthDiff * widthPercent; label.y += heightDiff }
    }
  }
  node.width = width; node.height = height; node.options.set('nodeSize.constraints', '[]')
}
