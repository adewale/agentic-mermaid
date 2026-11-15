/*******************************************************************************
 * Copyright (c) 2016, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { reverseEdge, providePort, type LayoutNode, type LayoutPort, type LayoutEdge } from './graph.ts'
import { optionalIntegerOption } from './options.ts'

type Node = LayoutNode
type Edge = LayoutEdge
export interface PartitionState { readonly ports: Set<LayoutPort> }
const outgoing = (node: Node): Edge[] => node.ports.flatMap(port => port.outgoing)
const partition = (node: Node): number | undefined => optionalIntegerOption(node.options, 'partitioning.partition')

/** PartitionPreprocessor, ELK v0.11.0, commit 54123e884b1ae743b453260f713b20c9bf5787f2. */
export function preprocessPartitions(nodes: Node[]): void {
  const partitioned = nodes.filter(node => partition(node) !== undefined)
  const mustReverse = (edge: Edge): boolean => {
    const source = edge.source.node, target = edge.target.node, sourceId = partition(source)!, targetId = partition(target)
    if (targetId !== undefined) return sourceId > targetId
    const lower = partitioned.filter(node => partition(node)! < sourceId)
    const queue = [source], visited = new Set(queue)
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]!
      if (lower.includes(current)) return true
      for (const next of outgoing(current)) if (!visited.has(next.target.node)) { visited.add(next.target.node); queue.push(next.target.node) }
    }
    return false
  }
  // Source streams collect all candidates before any endpoint/list mutations.
  const reversed = partitioned.flatMap(outgoing).filter(mustReverse)
  for (const edge of reversed) { reverseEdge(edge, true); edge.priorityDirection = 1000 + edge.priorityDirection }
}

/** PartitionMidprocessor: connect all pairs in consecutive used partitions. */
export function addPartitionConstraints(nodes: Node[]): PartitionState {
  const groups = new Map<number, Set<Node>>(), ports = new Set<LayoutPort>()
  for (const node of nodes) {
    const id = partition(node)
    if (id === undefined) continue
    let group = groups.get(id)
    if (group === undefined) { group = new Set(); groups.set(id, group) }
    group.add(node)
  }
  const ids = [...groups.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  for (let index = 1; index < ids.length; index++) for (const node of groups.get(ids[index - 1]!)!) {
    const source = providePort(node, 'OUTPUT', 'EAST', false)
    ports.add(source)
    for (const other of groups.get(ids[index]!)!) {
      const target = providePort(other, 'INPUT', 'WEST', false)
      ports.add(target)
      const edge: Edge = { data: null, source, target, options: new Map(), labels: [], sourceLabels: [], bends: [], priorityDirection: 0, priorityShortness: 0, reversed: false }
      source.outgoing.push(edge); target.incoming.push(edge)
    }
  }
  return { ports }
}

/** PartitionPostprocessor removes ports, retaining their owner and edge lists. */
export function removePartitionConstraints(layers: Node[][], state: PartitionState): void {
  for (const layer of layers) for (const node of layer) for (let index = 0; index < node.ports.length;) {
    if (state.ports.has(node.ports[index]!)) node.ports.splice(index, 1)
    else index++
  }
}
