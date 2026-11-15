/*******************************************************************************
 * Copyright (c) 2015, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutNode } from './graph.ts'

/** InnermostNodeMarginCalculator / NodeMarginCalculator without edge end labels. */
export function calculateNodeMargins(nodes: LayoutNode[]): void {
  for (const node of nodes) {
    let x = node.x, y = node.y, width = node.width, height = node.height
    const union = (otherX: number, otherY: number, otherWidth: number, otherHeight: number): void => {
      let x1 = Math.min(x, otherX), y1 = Math.min(y, otherY), x2 = Math.max(x + width, otherX + otherWidth), y2 = Math.max(y + height, otherY + otherHeight)
      if (x2 < x1) { const temporary = x1; x1 = x2; x2 = temporary }
      if (y2 < y1) { const temporary = y1; y1 = y2; y2 = temporary }
      x = x1; y = y1; width = x2 - x1; height = y2 - y1
    }
    for (const label of node.labels) union(label.x + node.x, label.y + node.y, label.width, label.height)
    for (const port of node.ports) {
      const portX = port.x + node.x, portY = port.y + node.y
      union(portX, portY, port.width, port.height)
      for (const label of port.labels) union(label.x + portX, label.y + portY, label.width, label.height)
    }
    node.margin.top = Math.max(0, node.y - y)
    node.margin.bottom = Math.max(0, y + height - (node.y + node.height))
    node.margin.left = Math.max(0, node.x - x)
    node.margin.right = Math.max(0, x + width - (node.x + node.width))
  }
}
