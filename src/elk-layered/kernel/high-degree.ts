/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutNode, LayoutEdge } from './graph.ts'
import { integerOption, type Options } from './options.ts'

type Node = LayoutNode
type Edge = LayoutEdge
type EdgeSelector = (node: Node) => Edge[]
interface HighDegreeNodeInformation { incomingHeight: number; incomingRoots: Node[]; outgoingHeight: number; outgoingRoots: Node[] }
const incoming: EdgeSelector = node => node.ports.flatMap(port => port.incoming)
const outgoing: EdgeSelector = node => node.ports.flatMap(port => port.outgoing)
const other = (edge: Edge, node: Node): Node => edge.source.node === node ? edge.target.node : edge.source.node

/** HighDegreeNodeLayeringProcessor, ELK v0.11.0, commit 54123e884b1ae743b453260f713b20c9bf5787f2. */
export function applyHighDegreeLayers(layers: Node[][], options: Options): void {
  const threshold = integerOption(options, 'layered.highDegreeNodes.threshold', 16)
  let heightThreshold = integerOption(options, 'layered.highDegreeNodes.treeHeight', 5)
  if (heightThreshold === 0) heightThreshold = 2147483647
  const highDegree = (node: Node): boolean => {
    let degree = 0
    for (const port of node.ports) degree += port.incoming.length + port.outgoing.length
    return degree >= threshold
  }
  const singleConnection = (node: Node, edges: EdgeSelector): boolean => {
    let connection: Node | undefined
    for (const edge of edges(node)) {
      if (connection === undefined) connection = other(edge, node)
      else if (other(edge, node) !== connection) return false
    }
    return true
  }
  const treeHeight = (root: Node, ancestors: EdgeSelector, descendants: EdgeSelector): number => {
    if (highDegree(root) || !singleConnection(root, ancestors)) return -1
    const edges = descendants(root)
    if (edges.length === 0) return 1
    let currentHeight = 0
    for (const edge of edges) {
      const height = treeHeight(other(edge, root), ancestors, descendants)
      if (height === -1) return -1
      currentHeight = Math.max(currentHeight, height)
      if (currentHeight > heightThreshold - 1) return -1
    }
    return currentHeight + 1
  }
  const information = (node: Node): HighDegreeNodeInformation => {
    const result: HighDegreeNodeInformation = { incomingHeight: -1, incomingRoots: [], outgoingHeight: -1, outgoingRoots: [] }
    for (const edge of incoming(node)) {
      if (edge.source.node === edge.target.node) continue
      const root = edge.source.node
      if (!singleConnection(root, outgoing)) continue
      const height = treeHeight(root, outgoing, incoming)
      if (height === -1) continue
      result.incomingHeight = Math.max(result.incomingHeight, height); result.incomingRoots.push(root)
    }
    for (const edge of outgoing(node)) {
      if (edge.source.node === edge.target.node) continue
      const root = edge.target.node
      if (!singleConnection(root, incoming)) continue
      const height = treeHeight(root, incoming, outgoing)
      if (height === -1) continue
      result.outgoingHeight = Math.max(result.outgoingHeight, height); result.outgoingRoots.push(root)
    }
    return result
  }
  const owningLayer = new Map<Node, Node[]>()
  for (const layer of layers) for (const node of layer) owningLayer.set(node, layer)
  const moveTree = (root: Node, edges: EdgeSelector, destination: Node[][]): void => {
    const previous = owningLayer.get(root)
    if (previous !== undefined) previous.splice(previous.indexOf(root), 1)
    destination[0]!.push(root); owningLayer.set(root, destination[0]!)
    const remainder = destination.slice(1)
    for (const edge of edges(root)) moveTree(other(edge, root), edges, remainder)
  }
  let cursor = 0
  while (cursor < layers.length) {
    const layer = layers[cursor++]!, nodes: HighDegreeNodeInformation[] = []
    let beforeHeight = -1, afterHeight = -1
    for (const node of layer) if (highDegree(node)) {
      const info = information(node)
      beforeHeight = Math.max(beforeHeight, info.incomingHeight); afterHeight = Math.max(afterHeight, info.outgoingHeight); nodes.push(info)
    }
    const before: Node[][] = []
    for (let i = 0; i < beforeHeight; i++) { const added: Node[] = []; layers.splice(cursor - 1, 0, added); cursor++; before.unshift(added) }
    for (const info of nodes) for (const root of info.incomingRoots) moveTree(root, incoming, before)
    const after: Node[][] = []
    for (let i = 0; i < afterHeight; i++) { const added: Node[] = []; layers.splice(cursor, 0, added); cursor++; after.push(added) }
    for (const info of nodes) for (const root of info.outgoingRoots) moveTree(root, outgoing, after)
  }
  for (let index = 0; index < layers.length;) { if (layers[index]!.length === 0) layers.splice(index, 1); else index++ }
  for (let index = 0; index < layers.length; index++) for (const node of layers[index]!) node.rank = index
}
