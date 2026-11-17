/*******************************************************************************
 * Copyright (c) 2008, 2010, 2016, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { calculatePortSide, type LayoutNode, type LayoutPort, type LayoutLabel } from './graph.ts'
import { setOption, vectorOption, type Direction } from './options.ts'

/** LGraphUtil.resizeNode; elkjs preserves these computations as doubles. */
export function resizeNode(node: LayoutNode, width: number, height: number, movePorts: boolean, moveLabels: boolean, ports: LayoutPort[] = node.ports, labels: LayoutLabel[] = node.labels): void {
  const oldWidth = node.width, oldHeight = node.height, widthRatio = width / oldWidth, heightRatio = height / oldHeight, widthDiff = width - oldWidth, heightDiff = height - oldHeight
  if (movePorts) {
    const fixed = node.portConstraints === 'FIXED_POS'
    for (const port of ports) {
      if (port.side === 'NORTH') { if (!fixed) port.x *= widthRatio }
      else if (port.side === 'EAST') { port.x += widthDiff; if (!fixed) port.y *= heightRatio }
      else if (port.side === 'SOUTH') { if (!fixed) port.x *= widthRatio; port.y += heightDiff }
      else if (port.side === 'WEST') { if (!fixed) port.y *= heightRatio }
    }
  }
  if (moveLabels) for (const label of labels) {
    const midX = label.x + label.width / 2, midY = label.y + label.height / 2, widthPercent = midX / oldWidth, heightPercent = midY / oldHeight
    if (widthPercent + heightPercent >= 1) {
      if (widthPercent - heightPercent > 0 && midY >= 0) { label.x += widthDiff; label.y += heightDiff * heightPercent }
      else if (widthPercent - heightPercent < 0 && midX >= 0) { label.x += widthDiff * widthPercent; label.y += heightDiff }
    }
  }
  node.width = width; node.height = height; node.options.set('nodeSize.constraints', '[]')
}

/** ElkUtil.resizeNode on the imported JSON model between independent layout runs. */
export function resizeImportedNode(node: LayoutNode, width: number, height: number, movePorts: boolean, direction: Direction): void {
  let minimum = { x: 0, y: 0 }
  if (setOption(node.options, 'nodeSize.constraints', ['PORTS', 'PORT_LABELS', 'NODE_LABELS', 'MINIMUM_SIZE'], []).has('MINIMUM_SIZE')) {
    minimum = vectorOption(node.options, 'nodeSize.minimum')
    if (setOption(node.options, 'nodeSize.options', ['DEFAULT_MINIMUM_SIZE', 'MINIMUM_SIZE_ACCOUNTS_FOR_PADDING', 'COMPUTE_PADDING', 'OUTSIDE_NODE_LABELS_OVERHANG', 'PORTS_OVERHANG', 'UNIFORM_PORT_SPACING', 'SPACE_EFFICIENT_PORT_LABELS', 'FORCE_TABULAR_NODE_LABELS', 'ASYMMETRICAL'], ['DEFAULT_MINIMUM_SIZE']).has('DEFAULT_MINIMUM_SIZE')) { if (minimum.x <= 0) minimum.x = 20; if (minimum.y <= 0) minimum.y = 20 }
  }
  if (movePorts) for (const port of node.sourcePorts) if (port.side === 'UNDEFINED') { port.side = calculatePortSide(port, direction); port.options.set('port.side', port.side) }
  resizeNode(node, Math.max(minimum.x, width), Math.max(minimum.y, height), movePorts, true, node.sourcePorts, node.sourceLabels)
  // The next algorithm imports these as the fixed labels of the updated model.
  for (const label of node.sourceLabels) { label.inputX = label.x; label.inputY = label.y }
}
