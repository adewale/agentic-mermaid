/*******************************************************************************
 * Copyright (c) 2010, 2015 Kiel University and others.
 * Copyright (c) 2021, 2025 Kiel University and others.
 * Copyright (c) 2022, 2025 Kiel University and others.
 * Copyright (c) 2025 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/

export type CycleLayerConstraint = 'NONE' | 'FIRST' | 'FIRST_SEPARATE' | 'LAST' | 'LAST_SEPARATE'

export interface CycleNode<Port> {
  ports: Port[]
  cycleIndex?: number
  modelOrder?: number
  layerConstraint?: CycleLayerConstraint
  cycleBreakingGroupId?: number
}

export interface CyclePort<Node, Edge> {
  node: Node
  incoming: Edge[]
  outgoing: Edge[]
}

export interface CycleEdge<Port> {
  source: Port
  target: Port
  priorityDirection: number
}

export interface CycleGraph<
  Node extends CycleNode<CyclePort<Node, Edge>>,
  Edge extends CycleEdge<CyclePort<Node, Edge>>,
> {
  nodes: Node[]
  random: { nextInt(bound: number): number }
  cyclic: boolean
  reverseEdge(edge: Edge): void
}

export interface ModelOrderCycleGraph<
  Node extends CycleNode<CyclePort<Node, Edge>>,
  Edge extends CycleEdge<CyclePort<Node, Edge>>,
> extends CycleGraph<Node, Edge> {
  maxModelOrderNodes: number
  modelOrderGroupCount: number
  enforceGroupModelOrder: boolean
}

type ModelOrderNode = Pick<CycleNode<unknown>, 'layerConstraint' | 'modelOrder' | 'cycleBreakingGroupId'>

/**
 * GreedyCycleBreaker.process/updateNeighbors, ELK v0.11.0
 * (54123e884b1ae743b453260f713b20c9bf5787f2), with published elkjs 0.11.1
 * GWT arithmetic. The caller owns edge reversal, including collector ports.
 */
export function breakGreedyCycles<Node extends CycleNode<CyclePort<Node, Edge>>, Edge extends CycleEdge<CyclePort<Node, Edge>>>(graph: CycleGraph<Node, Edge>): void {
  runGreedyCycleBreaker(graph, nodes => nodes[graph.random.nextInt(nodes.length)]!)
}

function runGreedyCycleBreaker<Node extends CycleNode<CyclePort<Node, Edge>>, Edge extends CycleEdge<CyclePort<Node, Edge>>>(graph: CycleGraph<Node, Edge>, chooseNodeWithMaxOutflow: (nodes: Node[]) => Node): void {
  const nodes = graph.nodes
  let unprocessedNodeCount = nodes.length
  const indeg: number[] = new Array(unprocessedNodeCount).fill(0)
  const outdeg: number[] = new Array(unprocessedNodeCount).fill(0)
  const mark: number[] = new Array(unprocessedNodeCount).fill(0)
  const sources: Node[] = []
  const sinks: Node[] = []
  let sourceHead = 0
  let sinkHead = 0

  let index = 0
  for (const node of nodes) {
    node.cycleIndex = index
    for (const port of node.ports) {
      for (const edge of port.incoming) {
        if (edge.source.node === node) continue
        const priority = edge.priorityDirection
        indeg[index]! += priority > 0 ? priority + 1 : 1
      }
      for (const edge of port.outgoing) {
        if (edge.target.node === node) continue
        const priority = edge.priorityDirection
        outdeg[index]! += priority > 0 ? priority + 1 : 1
      }
    }
    if (outdeg[index] === 0) sinks.push(node)
    else if (indeg[index] === 0) sources.push(node)
    index++
  }

  function updateNeighbor(node: Node, port: CyclePort<Node, Edge>, edge: Edge): void {
    const connectedPort = edge.source === port ? edge.target : edge.source
    const endpoint = connectedPort.node
    if (node === endpoint) return
    let priority = edge.priorityDirection
    if (priority < 0) priority = 0
    const endpointIndex = endpoint.cycleIndex!
    if (mark[endpointIndex] === 0) {
      if (edge.target === connectedPort) {
        indeg[endpointIndex]! -= priority + 1
        if (indeg[endpointIndex]! <= 0 && outdeg[endpointIndex]! > 0) sources.push(endpoint)
      } else {
        outdeg[endpointIndex]! -= priority + 1
        if (outdeg[endpointIndex]! <= 0 && indeg[endpointIndex]! > 0) sinks.push(endpoint)
      }
    }
  }

  function updateNeighbors(node: Node): void {
    for (const port of node.ports) {
      for (const edge of port.incoming) updateNeighbor(node, port, edge)
      for (const edge of port.outgoing) updateNeighbor(node, port, edge)
    }
  }

  let nextRight = -1
  let nextLeft = 1
  const maxNodes: Node[] = []
  while (unprocessedNodeCount > 0) {
    while (sinkHead < sinks.length) {
      const sink = sinks[sinkHead++]!
      mark[sink.cycleIndex!] = nextRight--
      updateNeighbors(sink)
      unprocessedNodeCount--
    }
    while (sourceHead < sources.length) {
      const source = sources[sourceHead++]!
      mark[source.cycleIndex!] = nextLeft++
      updateNeighbors(source)
      unprocessedNodeCount--
    }
    if (unprocessedNodeCount > 0) {
      let maxOutflow = -2147483648
      for (const node of nodes) {
        const nodeIndex = node.cycleIndex!
        if (mark[nodeIndex] === 0) {
          const outflow = outdeg[nodeIndex]! - indeg[nodeIndex]!
          if (outflow >= maxOutflow) {
            if (outflow > maxOutflow) {
              maxNodes.length = 0
              maxOutflow = outflow
            }
            maxNodes.push(node)
          }
        }
      }
      const maxNode = chooseNodeWithMaxOutflow(maxNodes)
      mark[maxNode.cycleIndex!] = nextLeft++
      updateNeighbors(maxNode)
      unprocessedNodeCount--
    }
  }

  const shiftBase = nodes.length + 1
  for (index = 0; index < nodes.length; index++) {
    if (mark[index]! < 0) mark[index]! += shiftBase
  }

  for (const node of nodes) {
    const ports = node.ports.slice()
    for (const port of ports) {
      const outgoingEdges = port.outgoing.slice()
      for (const edge of outgoingEdges) {
        const targetIndex = edge.target.node.cycleIndex!
        if (mark[node.cycleIndex!]! > mark[targetIndex]!) {
          graph.reverseEdge(edge)
          graph.cyclic = true
        }
      }
    }
  }
}

/** GroupModelOrderCalculator from the same pinned ELK source. */
class GroupModelOrderCalculator {
  private firstSeparateNodes = 0
  private lastSeparateNodes = 0

  private constraintOrder(node: ModelOrderNode, offset: number): number {
    switch (node.layerConstraint) {
      case 'FIRST_SEPARATE': {
        const modelOrder = 2 * -offset + this.firstSeparateNodes
        this.firstSeparateNodes++
        return modelOrder
      }
      case 'FIRST':
        return -offset
      case 'LAST':
        return offset
      case 'LAST_SEPARATE': {
        const modelOrder = 2 * offset + this.lastSeparateNodes
        this.lastSeparateNodes++
        return modelOrder
      }
      default:
        return 0
    }
  }

  computeConstraintModelOrder(node: ModelOrderNode, offset: number): number {
    let modelOrder = this.constraintOrder(node, offset)
    if (node.modelOrder !== undefined) modelOrder += node.modelOrder
    return modelOrder
  }

  computeConstraintGroupModelOrder(node: ModelOrderNode, offset: number, smallOffset: number): number {
    let modelOrder = this.constraintOrder(node, offset)
    if (node.modelOrder !== undefined) modelOrder += (node.cycleBreakingGroupId ?? 0) * smallOffset + node.modelOrder
    return modelOrder
  }

  resetInternalCounters(): void {
    this.firstSeparateNodes = 0
    this.lastSeparateNodes = 0
  }
}

/** ModelOrderCycleBreaker.process from the same pinned ELK source. */
export function breakModelOrderCycles<Node extends CycleNode<CyclePort<Node, Edge>>, Edge extends CycleEdge<CyclePort<Node, Edge>>>(graph: ModelOrderCycleGraph<Node, Edge>): void {
  const reversedEdges: Edge[] = []
  const offset = Math.max(graph.nodes.length, graph.maxModelOrderNodes)
  const bigOffset = offset * graph.modelOrderGroupCount
  const enforceGroupModelOrder = graph.enforceGroupModelOrder
  for (const source of graph.nodes) {
    const calculator = new GroupModelOrderCalculator()
    const modelOrderSource = enforceGroupModelOrder
      ? calculator.computeConstraintGroupModelOrder(source, bigOffset, offset)
      : calculator.computeConstraintModelOrder(source, offset)
    for (const port of source.ports) {
      if (port.outgoing.length === 0) continue
      for (const edge of port.outgoing) {
        const target = edge.target.node
        const modelOrderTarget = enforceGroupModelOrder
          ? calculator.computeConstraintGroupModelOrder(target, bigOffset, offset)
          : calculator.computeConstraintModelOrder(target, offset)
        if (modelOrderTarget < modelOrderSource) reversedEdges.push(edge)
      }
    }
  }
  for (const edge of reversedEdges) {
    graph.reverseEdge(edge)
    graph.cyclic = true
  }
}

/** GreedyModelOrderCycleBreaker.chooseNodeWithMaxOutflow from the same source. */
export function breakGreedyModelOrderCycles<Node extends CycleNode<CyclePort<Node, Edge>>, Edge extends CycleEdge<CyclePort<Node, Edge>>>(graph: ModelOrderCycleGraph<Node, Edge>): void {
  runGreedyCycleBreaker(graph, nodes => {
    let returnNode: Node | null = null
    let minimumModelOrder = 2147483647
    const offset = Math.max(graph.nodes.length, graph.maxModelOrderNodes)
    const bigOffset = offset * graph.modelOrderGroupCount
    const calculator = new GroupModelOrderCalculator()
    const enforceGroupModelOrder = graph.enforceGroupModelOrder
    for (const node of nodes) {
      if (node.modelOrder !== undefined) {
        const modelOrder = enforceGroupModelOrder
          ? calculator.computeConstraintGroupModelOrder(node, bigOffset, offset)
          : calculator.computeConstraintModelOrder(node, offset)
        if (minimumModelOrder > modelOrder) {
          minimumModelOrder = modelOrder
          returnNode = node
        }
      }
    }
    if (returnNode === null) return nodes[graph.random.nextInt(nodes.length)]!
    return returnNode
  })
}
