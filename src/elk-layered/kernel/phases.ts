/*******************************************************************************
 * Copyright (c) 2010, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Random } from '../java/util/Random.ts'
import type { LayoutEdge, LayoutNode } from './graph.ts'
import { enumOption, integerOption, numberOption, stringOption, type Options } from './options.ts'

/** PortSideProcessor followed by the side-only branch of PortListSorter. */
export function assignPortSides(nodes: LayoutNode[]): void {
  const order = { UNDEFINED: 0, NORTH: 1, EAST: 2, SOUTH: 3, WEST: 4 }
  for (const node of nodes) {
    for (const port of node.ports) port.side = port.incoming.length - port.outgoing.length < 0 ? 'EAST' : 'WEST'
    node.portConstraints = 'FIXED_SIDE'
    node.ports.sort((a, b) => order[a.side] - order[b.side])
    for (const side of ['SOUTH', 'WEST'] as const) {
      // Preserve the source findPortSideRange and reverse bounds, including its
      // final-index behavior. Crossing minimization owns subsequent port order.
      if (node.ports.length <= 1) continue
      let currentSide = node.ports[0]!.side, low = 0
      while (low < node.ports.length - 1 && order[currentSide] < order[side]) { low++; currentSide = node.ports[low]!.side }
      let high = low
      while (high < node.ports.length - 1 && order[currentSide] < order[side] + 1) { high++; currentSide = node.ports[low]!.side }
      if (high <= low + 2) continue
      for (let i = 0; i < Math.trunc((high - low) / 2); i++) { const port = node.ports[low + i]!; node.ports[low + i] = node.ports[high - i - 1]!; node.ports[high - i - 1] = port }
    }
  }
}

/** LayerSweep control flow for layers with one node and at most one port per side. */
export function minimizeSingleNodeLayers(layers: LayoutNode[][], random: Random, options: Options): void {
  if (layers.length === 1 && layers[0]?.length === 1) return
  if (stringOption(options, 'layered.considerModelOrder.strategy', 'NONE') !== 'NONE') throw new Error('ELK TypeScript port: model-order crossing constraints are not implemented yet')
  const seed = random.nextLong()
  random.nextBoolean() // BARYCENTER's port-distributor selection in GraphInfoHolder.
  random.setSeed(seed)
  if (integerOption(options, 'layered.thoroughness', 7) > 0) {
    random.nextBoolean() // Direction of the initial sweep.
    random.nextDouble() // Random first-layer barycenter (one node).
    for (let index = 1; index < layers.length; index++) random.nextFloat()
    // Every adjacent pair is connected and each side has one port: no crossing
    // or port-order improvement is possible. The source exits on crossing0.
  }
  const threshold = integerOption(options, 'layered.crossingMinimization.greedySwitch.activationThreshold', 40)
  const strategy = stringOption(options, 'layered.crossingMinimization.greedySwitch.type', 'TWO_SIDED')
  if (strategy !== 'OFF' && (threshold === 0 || threshold > layers.length)) {
    random.nextLong()
    random.nextBoolean() // The two-sided greedy sweep has no swappable pair.
  }
}

/** NodeDimensionCalculation's single zero-size port on each occupied side. */
export function placeSinglePorts(nodes: LayoutNode[]): void {
  for (const node of nodes) {
    for (const side of ['WEST', 'EAST'] as const) {
      const ports = node.ports.filter(port => port.side === side)
      if (ports.length > 1) throw new Error('ELK TypeScript port: multiple-port sizing is not implemented yet')
      const port = ports[0]
      if (port !== undefined) { port.x = side === 'WEST' ? -port.width : node.width; port.y = (node.height - port.height) / 2 }
    }
  }
}

/** BK inside-block alignment when every layer contains one ordinary node. */
export function alignSingleNodeLayers(layers: LayoutNode[][]): void {
  if (layers.some(layer => layer.length !== 1)) throw new Error('ELK TypeScript port: multi-node layer placement is not implemented yet')
  const root = layers[0]?.[0]
  if (root === undefined) return
  const shifts = new Map<LayoutNode, number>([[root, 0]])
  let current = root, spaceAbove = 0, spaceBelow = root.height
  for (let index = 1; index < layers.length; index++) {
    const next = layers[index]![0]!
    const edge = connectingEdge(current, next)
    const difference = edge.source.y + edge.source.anchorY - edge.target.y - edge.target.anchorY
    const shift = shifts.get(current)! + difference
    shifts.set(next, shift)
    spaceAbove = Math.max(spaceAbove, -shift)
    spaceBelow = Math.max(spaceBelow, shift + next.height)
    current = next
  }
  for (const layer of layers) { const node = layer[0]!; node.y = 0 + (shifts.get(node)! + spaceAbove) }
  // BK's compactor has one block and no predecessor in these layers. Its
  // class coordinate is zero; the later graph-height pass owns normalization.
  void spaceBelow
}
function connectingEdge(source: LayoutNode, target: LayoutNode): LayoutEdge {
  for (const port of source.ports) for (const edge of port.outgoing) if (edge.target.node === target) return edge
  throw new Error('ELK TypeScript port: nonadjacent alignment blocks are not implemented yet')
}

/** LayerSizeAndGraphHeightCalculator and straight-edge orthogonal layer slots. */
export function routeStraightLayers(layers: LayoutNode[][], options: Options): { width: number; height: number; offsetY: number } {
  let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY
  const widths: number[] = []
  for (const layer of layers) {
    let width = 0
    for (const node of layer) width = Math.max(width, node.width + 0 + 0)
    widths.push(width)
    const first = layer[0]!, last = layer.at(-1)!
    minY = Math.min(minY, first.y - 0)
    maxY = Math.max(maxY, last.y + last.height + 0)
  }
  let x = 0
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]!, width = widths[index]!
    for (const node of layer) {
      let incoming = 0, outgoing = 0
      for (const port of node.ports) { if (port.incoming.length > 0) incoming++; if (port.outgoing.length > 0) outgoing++ }
      const alignment = enumOption(node.options, 'alignment', ['AUTOMATIC', 'LEFT', 'RIGHT', 'CENTER'] as const, 'AUTOMATIC')
      const ratio = alignment === 'LEFT' ? 0 : alignment === 'RIGHT' ? 1 : alignment === 'CENTER' || incoming + outgoing === 0 ? 0.5 : outgoing / (incoming + outgoing)
      let position = (width - node.width) * ratio
      if (ratio > 0.5) position -= 0 * 2 * (ratio - 0.5)
      else if (ratio < 0.5) position += 0 * 2 * (0.5 - ratio)
      if (position < 0) position = 0
      if (position > width - 0 - node.width) position = width - 0 - node.width
      node.x = x + position
    }
    x += width
    if (index + 1 < layers.length) x += numberOption(options, 'layered.spacing.nodeNodeBetweenLayers', 20)
  }
  return { width: x, height: maxY - minY, offsetY: 0 - minY }
}
