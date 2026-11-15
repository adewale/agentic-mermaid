/*******************************************************************************
 * Copyright (c) 2015, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutNode, LayoutPort } from './graph.ts'
import { booleanOption, enumOption, numberOption, paddingOption, setOption, type Options } from './options.ts'

const SIZE_CONSTRAINTS = ['PORTS', 'PORT_LABELS', 'NODE_LABELS', 'MINIMUM_SIZE'] as const
const SIZE_OPTIONS = ['DEFAULT_MINIMUM_SIZE', 'MINIMUM_SIZE_ACCOUNTS_FOR_PADDING', 'COMPUTE_PADDING', 'OUTSIDE_NODE_LABELS_OVERHANG', 'PORTS_OVERHANG', 'UNIFORM_PORT_SPACING', 'SPACE_EFFICIENT_PORT_LABELS', 'FORCE_TABULAR_NODE_LABELS', 'ASYMMETRICAL'] as const
const ALIGNMENTS = ['DISTRIBUTED', 'JUSTIFIED', 'BEGIN', 'CENTER', 'END'] as const

/** Label-free port cells of NodeDimensionCalculation and PortPlacementCalculator. */
export function sizeAndPlacePorts(nodes: LayoutNode[], graphOptions: Options): void {
  for (const node of nodes) {
    if (node.type !== 'NORMAL') continue
    if (node.labels.some(label => setOption(label.options, 'nodeLabels.placement', ['H_LEFT', 'H_CENTER', 'H_RIGHT', 'V_TOP', 'V_CENTER', 'V_BOTTOM', 'INSIDE', 'OUTSIDE', 'H_PRIORITY'], []).size > 0) || node.labels.length > 0 && setOption(node.options, 'nodeLabels.placement', ['H_LEFT', 'H_CENTER', 'H_RIGHT', 'V_TOP', 'V_CENTER', 'V_BOTTOM', 'INSIDE', 'OUTSIDE', 'H_PRIORITY'], []).size > 0) throw new Error('ELK TypeScript port: positioned node label cells are not implemented yet')
    if (node.ports.some(port => port.labels.length > 0)) throw new Error('ELK TypeScript port: port label cells are not implemented yet')
    const constraints = setOption(node.options, 'nodeSize.constraints', SIZE_CONSTRAINTS, []), flags = setOption(node.options, 'nodeSize.options', SIZE_OPTIONS, ['DEFAULT_MINIMUM_SIZE'])
    if (constraints.has('NODE_LABELS') || constraints.has('PORT_LABELS')) throw new Error('ELK TypeScript port: label cells contributing to node size are not implemented yet')
    if (constraints.has('MINIMUM_SIZE') && flags.has('MINIMUM_SIZE_ACCOUNTS_FOR_PADDING')) throw new Error('ELK TypeScript port: minimum client-area label cells are not implemented yet')
    const spacing = numberOption(node.individualSpacings, 'spacing.portPort', numberOption(graphOptions, 'spacing.portPort', 10))
    const zero = { top: 0, right: 0, bottom: 0, left: 0 }
    const surrounding = paddingOption(node.individualSpacings, paddingOption(graphOptions, zero, 'spacing.portsSurrounding'), 'spacing.portsSurrounding')
    const minimum = constraints.has('MINIMUM_SIZE') ? { ...node.minimumSize } : { x: 0, y: 0 }
    if (constraints.has('MINIMUM_SIZE') && flags.has('DEFAULT_MINIMUM_SIZE')) { if (minimum.x <= 0) minimum.x = 20; if (minimum.y <= 0) minimum.y = 20 }
    const sides = (['NORTH', 'SOUTH', 'EAST', 'WEST'] as const).map(side => {
      const ports = node.ports.filter(port => port.side === side)
      if (side === 'WEST' || side === 'SOUTH') ports.reverse()
      const horizontal = side === 'NORTH' || side === 'SOUTH'
      const alignment = enumOption(node.options, 'portAlignment.' + side.toLowerCase(), ALIGNMENTS, enumOption(node.options, 'portAlignment.default', ALIGNMENTS, 'DISTRIBUTED'))
      let size = 0
      for (let index = 0; index < ports.length; index++) { size += 0 + (horizontal ? ports[index]!.width : ports[index]!.height) + 0; if (index + 1 < ports.length) size += spacing }
      if (alignment === 'DISTRIBUTED' && ports.length > 0) size += 2 * spacing
      return { ports, alignment, size, horizontal }
    })
    if (constraints.size > 0) {
      let width = Math.max(0, minimum.x), height = Math.max(0, minimum.y)
      if (constraints.has('PORTS')) for (const side of sides) if (side.ports.length > 0) {
        if (node.portConstraints === 'FIXED_RATIO') throw new Error('ELK TypeScript port: fixed-ratio minimum size is not implemented yet')
        if (side.horizontal) {
          if (node.portConstraints === 'FIXED_POS') { for (const port of side.ports) width = Math.max(width, port.x + port.width) }
          else width = Math.max(width, surrounding.left + side.size + surrounding.right)
        } else {
          if (node.portConstraints === 'FIXED_POS') { for (const port of side.ports) height = Math.max(height, port.y + port.height) }
          else height = Math.max(height, surrounding.top + side.size + surrounding.bottom)
        }
      }
      if (booleanOption(graphOptions, 'nodeSize.fixedGraphSize', false)) { width = Math.max(node.width, width); height = Math.max(node.height, height) }
      node.width = width; node.height = height
    }
    for (const side of sides) {
      const { ports, horizontal } = side
      if (ports.length === 0) continue
      if (node.portConstraints === 'FIXED_POS') { for (const port of ports) { if (horizontal) port.y = portY(port, node.height); else port.x = portX(port, node.width) }; continue }
      if (node.portConstraints === 'FIXED_RATIO') { for (const port of ports) { if (horizontal) { port.x = node.width * port.ratio; port.y = portY(port, node.height) } else { port.x = portX(port, node.width); port.y = node.height * port.ratio } }; continue }
      let alignment = side.alignment, calculated = side.size, current = 0 + (horizontal ? surrounding.left : surrounding.top), between = spacing
      const available = horizontal ? node.width - surrounding.left - surrounding.right : node.height - surrounding.top - surrounding.bottom
      if ((alignment === 'DISTRIBUTED' || alignment === 'JUSTIFIED') && ports.length === 1) { if (alignment === 'DISTRIBUTED') calculated -= 2 * spacing; alignment = 'CENTER' }
      if (available < calculated && !flags.has('PORTS_OVERHANG')) {
        if (alignment === 'DISTRIBUTED') { between += (available - calculated) / (ports.length + 1); current += between }
        else between += (available - calculated) / (ports.length - 1)
      } else {
        if (available < calculated) { if (alignment === 'DISTRIBUTED') calculated -= 2 * spacing; alignment = 'CENTER' }
        if (alignment === 'CENTER') current += (available - calculated) / 2
        else if (alignment === 'END') current += available - calculated
        else if (alignment === 'DISTRIBUTED') { between += Math.max(0, (available - calculated) / (ports.length + 1)); current += between }
        else if (alignment === 'JUSTIFIED') between += Math.max(0, (available - calculated) / (ports.length - 1))
      }
      for (const port of ports) {
        if (horizontal) { port.x = current + 0; port.y = portY(port, node.height) }
        else { port.x = portX(port, node.width); port.y = current + 0 }
        current += 0 + (horizontal ? port.width : port.height) + 0 + between
      }
    }

  }
}
function portX(port: LayoutPort, width: number): number { return port.borderOffset === null ? port.side === 'WEST' ? -port.width : width : port.side === 'WEST' ? -port.width - port.borderOffset : width + port.borderOffset }

function portY(port: LayoutPort, height: number): number { return (port.borderOffset === null ? port.side === 'NORTH' ? -port.height : 0 : port.side === 'NORTH' ? -port.height - port.borderOffset : port.borderOffset) + (port.side === 'SOUTH' ? height : 0) }
