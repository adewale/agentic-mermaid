/*******************************************************************************
 * Copyright (c) 2010, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { isSideFixed, type LayoutNode, type LayoutPort } from './graph.ts'
import { enumOption, integerOption, type Options } from './options.ts'

/** PortSideProcessor. */
export function assignPortSides(nodes: LayoutNode[]): void {
  for (const node of nodes) {
    const fixed = isSideFixed(node.portConstraints)
    for (const port of node.ports) if (!fixed || port.side === 'UNDEFINED') {
      port.side = port.incoming.length - port.outgoing.length < 0 ? 'EAST' : 'WEST'
      if (!port.explicitAnchor) { port.anchorX = port.side === 'EAST' ? port.width : 0; port.anchorY = port.height / 2 }
    }
    if (!fixed) node.portConstraints = 'FIXED_SIDE'
  }
}
function compareNumbers(a: number, b: number): number { if (a < b) return -1; if (a > b) return 1; if (a === b) return a === 0 ? compareNumbers(1 / a, 1 / b) : 0; return Number.isNaN(a) ? Number.isNaN(b) ? 0 : 1 : -1 }
/** PortListSorter, including source clockwise bounds and original-edge degrees. */
export function sortPortLists(nodes: LayoutNode[], options: Options): void {
  const order = { UNDEFINED: 0, NORTH: 1, EAST: 2, SOUTH: 3, WEST: 4 }
  const strategy = enumOption(options, 'layered.portSortingStrategy', ['INPUT_ORDER', 'PORT_DEGREE'] as const, 'INPUT_ORDER')
  for (const node of nodes) {
    const orderFixed = node.portConstraints === 'FIXED_ORDER' || node.portConstraints === 'FIXED_RATIO' || node.portConstraints === 'FIXED_POS'
    node.ports.sort((a, b) => {
      const side = order[a.side] - order[b.side]
      if (side !== 0 || !orderFixed) return side
      if (node.portConstraints === 'FIXED_ORDER') {
        const first = integerOption(a.options, 'port.index', Number.NaN), second = integerOption(b.options, 'port.index', Number.NaN)
        if (!Number.isNaN(first) && !Number.isNaN(second) && first - second !== 0) return first - second
      }
      return a.side === 'NORTH' ? compareNumbers(a.x, b.x) : a.side === 'EAST' ? compareNumbers(a.y, b.y) : a.side === 'SOUTH' ? compareNumbers(b.x, a.x) : compareNumbers(b.y, a.y)
    })
    if (orderFixed) continue
    for (const side of ['SOUTH', 'WEST'] as const) {
      if (node.ports.length <= 1) continue
      let currentSide = node.ports[0]!.side, low = 0
      while (low < node.ports.length - 1 && order[currentSide] < order[side]) { low++; currentSide = node.ports[low]!.side }
      let high = low
      while (high < node.ports.length - 1 && order[currentSide] < order[side] + 1) { high++; currentSide = node.ports[low]!.side }
      if (high <= low + 2) continue
      for (let i = 0; i < Math.trunc((high - low) / 2); i++) { const port = node.ports[low + i]!; node.ports[low + i] = node.ports[high - i - 1]!; node.ports[high - i - 1] = port }
    }
    if (strategy === 'PORT_DEGREE') node.ports.sort((a, b) => order[a.side] !== order[b.side] ? 0 : a.side === 'EAST' ? degree(b, false) - degree(a, false) : a.side === 'WEST' ? degree(a, true) - degree(b, true) : 0)
  }
}
function degree(port: LayoutPort, incoming: boolean): number { let result = 0; for (const edge of incoming ? port.incoming : port.outgoing) if (!edge.reversed) result++; return result }
