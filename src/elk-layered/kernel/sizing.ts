/*******************************************************************************
 * Copyright (c) 2015, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutNode, LayoutPort } from './graph.ts'
import { booleanOption, enumOption, numberOption, paddingOption, setOption, vectorOption, type Options } from './options.ts'

const SIZE_CONSTRAINTS = ['PORTS', 'PORT_LABELS', 'NODE_LABELS', 'MINIMUM_SIZE'] as const
const SIZE_OPTIONS = ['DEFAULT_MINIMUM_SIZE', 'MINIMUM_SIZE_ACCOUNTS_FOR_PADDING', 'COMPUTE_PADDING', 'OUTSIDE_NODE_LABELS_OVERHANG', 'PORTS_OVERHANG', 'UNIFORM_PORT_SPACING', 'SPACE_EFFICIENT_PORT_LABELS', 'FORCE_TABULAR_NODE_LABELS', 'ASYMMETRICAL'] as const
const ALIGNMENTS = ['DISTRIBUTED', 'JUSTIFIED', 'BEGIN', 'CENTER', 'END'] as const

/** Label-free E/W cells of NodeDimensionCalculation and PortPlacementCalculator. */
export function sizeAndPlacePorts(nodes: LayoutNode[], graphOptions: Options): void {
  for (const node of nodes) {
    if (node.type !== 'NORMAL') continue
    if (node.ports.some(port => port.side !== 'EAST' && port.side !== 'WEST')) throw new Error('ELK TypeScript port: north/south port sizing is not implemented yet')
    const constraints = setOption(node.options, 'nodeSize.constraints', SIZE_CONSTRAINTS, []), flags = setOption(node.options, 'nodeSize.options', SIZE_OPTIONS, ['DEFAULT_MINIMUM_SIZE'])
    if (constraints.has('NODE_LABELS') || constraints.has('PORT_LABELS')) throw new Error('ELK TypeScript port: label cells contributing to node size are not implemented yet')
    const spacing = numberOption(node.individualSpacings, 'spacing.portPort', numberOption(graphOptions, 'spacing.portPort', 10))
    const zero = { top: 0, right: 0, bottom: 0, left: 0 }
    const surrounding = paddingOption(node.individualSpacings, paddingOption(graphOptions, zero, 'spacing.portsSurrounding'), 'spacing.portsSurrounding')
    const minimum = constraints.has('MINIMUM_SIZE') ? vectorOption(node.options, 'nodeSize.minimum') : { x: 0, y: 0 }
    if (constraints.has('MINIMUM_SIZE') && flags.has('DEFAULT_MINIMUM_SIZE')) { if (minimum.x <= 0) minimum.x = 20; if (minimum.y <= 0) minimum.y = 20 }
    const sides = (['EAST', 'WEST'] as const).map(side => {
      const ports = node.ports.filter(port => port.side === side)
      if (side === 'WEST') ports.reverse()
      const alignment = enumOption(node.options, 'portAlignment.' + side.toLowerCase(), ALIGNMENTS, enumOption(node.options, 'portAlignment.default', ALIGNMENTS, 'DISTRIBUTED'))
      let size = 0
      for (let index = 0; index < ports.length; index++) { size += 0 + ports[index]!.height + 0; if (index + 1 < ports.length) size += spacing }
      if (alignment === 'DISTRIBUTED' && ports.length > 0) size += 2 * spacing
      return { ports, alignment, size }
    })
    if (constraints.size > 0) {
      let width = Math.max(0, minimum.x), height = Math.max(0, minimum.y)
      if (constraints.has('PORTS')) for (const side of sides) if (side.ports.length > 0) {
        if (node.portConstraints === 'FIXED_RATIO') throw new Error('ELK TypeScript port: fixed-ratio minimum size is not implemented yet')
        if (node.portConstraints === 'FIXED_POS') { for (const port of side.ports) height = Math.max(height, port.y + port.height) }
        else height = Math.max(height, surrounding.top + side.size + surrounding.bottom)
      }
      if (booleanOption(graphOptions, 'nodeSize.fixedGraphSize', false)) { width = Math.max(node.width, width); height = Math.max(node.height, height) }
      node.width = width; node.height = height
    }
    for (const side of sides) {
      const { ports } = side
      if (ports.length === 0) continue
      if (node.portConstraints === 'FIXED_POS') { for (const port of ports) port.x = portX(port, node.width); continue }
      if (node.portConstraints === 'FIXED_RATIO') { for (const port of ports) { port.x = portX(port, node.width); port.y = port.ratio * node.height }; continue }
      let alignment = side.alignment, calculated = side.size, current = 0 + surrounding.top, between = spacing
      const available = node.height - surrounding.top - surrounding.bottom
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
      for (const port of ports) { port.x = portX(port, node.width); port.y = current + 0; current += 0 + port.height + 0 + between }
    }
    node.margin.top = 0; node.margin.right = 0; node.margin.bottom = 0; node.margin.left = 0
    for (const port of node.ports) { node.margin.top = Math.max(node.margin.top, -port.y); node.margin.right = Math.max(node.margin.right, port.x + port.width - node.width); node.margin.bottom = Math.max(node.margin.bottom, port.y + port.height - node.height); node.margin.left = Math.max(node.margin.left, -port.x) }
  }
}
function portX(port: LayoutPort, width: number): number { return port.borderOffset === null ? port.side === 'WEST' ? -port.width : width : port.side === 'WEST' ? -port.width - port.borderOffset : width + port.borderOffset }
