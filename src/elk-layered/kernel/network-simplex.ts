/*******************************************************************************
 * Copyright (c) 2010, 2020 Kiel University and others.
 * Copyright (c) 2016, 2017 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/

export interface SimplexNode {
  ports: SimplexPort[]
  rank: number
}

export interface SimplexPort<Node = SimplexNode> {
  node: Node
  incoming: SimplexEdge<Node>[]
  outgoing: SimplexEdge<Node>[]
}

export interface SimplexEdge<Node = SimplexNode> {
  source: SimplexPort<Node>
  target: SimplexPort<Node>
  priorityShortness: number
}

interface NNode<Node> {
  origin: Node
  incoming: NEdge<Node>[]
  outgoing: NEdge<Node>[]
  layer: number
  internalId: number
  treeNode: boolean
  unknownCutvalues: NEdge<Node>[]
}

interface NEdge<Node> {
  source: NNode<Node>
  target: NNode<Node>
  weight: number
  delta: number
  internalId: number
  treeEdge: boolean
}

interface NGraph<Node> {
  nodes: NNode<Node>[]
}

function connectedEdges<Node>(node: NNode<Node>): NEdge<Node>[] {
  return node.incoming.concat(node.outgoing)
}

function otherNode<Node>(edge: NEdge<Node>, node: NNode<Node>): NNode<Node> {
  if (node === edge.source) return edge.target
  if (node === edge.target) return edge.source
  throw new Error('Node is not part of edge.')
}

function remove<T>(items: T[], item: T): void {
  const index = items.indexOf(item)
  if (index >= 0) items.splice(index, 1)
}

/**
 * NetworkSimplex and its private native graph representation from ELK v0.11.0,
 * commit 54123e884b1ae743b453260f713b20c9bf5787f2. Iteration and arithmetic
 * follow the published elkjs 0.11.1 GWT worker.
 */
class NetworkSimplex<Node> {
  private edges: NEdge<Node>[] = []
  private treeEdges = new Set<NEdge<Node>>()
  private sources: NNode<Node>[] = []
  private edgeVisited: boolean[] = []
  private postOrder = 1
  private poID: number[] = []
  private lowestPoID: number[] = []
  private cutvalue: number[] = []
  private subtreeNodesStack: Array<[NNode<Node>, NEdge<Node>]> = []

  constructor(private graph: NGraph<Node>, private iterationLimit: number, private previousLayeringNodeCounts: number[] | null) {}

  private initialize(): void {
    for (const node of this.graph.nodes) node.treeNode = false
    this.poID = new Array(this.graph.nodes.length).fill(0)
    this.lowestPoID = new Array(this.graph.nodes.length).fill(0)
    this.sources = []
    let index = 0
    this.edges = []
    for (const node of this.graph.nodes) {
      node.internalId = index++
      if (node.incoming.length === 0) this.sources.push(node)
      for (const edge of node.outgoing) this.edges.push(edge)
    }
    let counter = 0
    for (const edge of this.edges) {
      edge.internalId = counter++
      edge.treeEdge = false
    }
    this.cutvalue = new Array(this.edges.length).fill(0)
    this.edgeVisited = new Array(this.edges.length).fill(false)
    this.treeEdges = new Set()
    this.postOrder = 1
  }

  execute(): void {
    if (this.graph.nodes.length < 1) return
    for (const node of this.graph.nodes) node.layer = 0
    const removeSubtrees = this.graph.nodes.length >= 40
    if (removeSubtrees) this.removeSubtrees()
    this.initialize()
    this.feasibleTree()
    let edge = this.leaveEdge()
    let iter = 0
    while (edge !== null && iter < this.iterationLimit) {
      this.exchange(edge, this.enterEdge(edge)!)
      edge = this.leaveEdge()
      iter++
    }
    if (removeSubtrees) this.reattachSubtrees()
    this.balance(this.normalize())
  }

  private removeSubtrees(): void {
    this.subtreeNodesStack = []
    const leafs: NNode<Node>[] = []
    for (const node of this.graph.nodes) {
      if (connectedEdges(node).length === 1) leafs.push(node)
    }
    let head = 0
    while (head < leafs.length) {
      const node = leafs[head++]!
      const nodeEdges = connectedEdges(node)
      if (nodeEdges.length === 0) continue
      const edge = nodeEdges[0]!
      const isOutEdge = node.outgoing.length > 0
      const other = otherNode(edge, node)
      if (isOutEdge) remove(other.incoming, edge)
      else remove(other.outgoing, edge)
      if (connectedEdges(other).length === 1) leafs.push(other)
      this.subtreeNodesStack.push([node, edge])
      remove(this.graph.nodes, node)
    }
  }

  private reattachSubtrees(): void {
    while (this.subtreeNodesStack.length > 0) {
      const [node, edge] = this.subtreeNodesStack.pop()!
      const placed = otherNode(edge, node)
      if (edge.target === node) {
        placed.outgoing.push(edge)
        node.layer = placed.layer + edge.delta
      } else {
        placed.incoming.push(edge)
        node.layer = placed.layer - edge.delta
      }
      this.graph.nodes.push(node)
    }
  }

  private feasibleTree(): void {
    this.layeringTopologicalNumbering(this.sources)
    if (this.edges.length > 0) {
      this.edgeVisited.fill(false)
      while (this.tightTreeDFS(this.graph.nodes[0]!) < this.graph.nodes.length) {
        const edge = this.minimalSlack()!
        let slack = edge.target.layer - edge.source.layer - edge.delta
        if (edge.target.treeNode) slack = -slack
        for (const node of this.graph.nodes) {
          if (node.treeNode) node.layer += slack
        }
        this.edgeVisited.fill(false)
      }
      this.edgeVisited.fill(false)
      this.postorderTraversal(this.graph.nodes[0]!)
      this.cutvalues()
    }
  }

  private layeringTopologicalNumbering(initialRootNodes: NNode<Node>[]): void {
    const incident: number[] = new Array(this.graph.nodes.length).fill(0)
    for (const node of this.graph.nodes) incident[node.internalId]! += node.incoming.length
    const roots = initialRootNodes.slice()
    let head = 0
    while (head < roots.length) {
      const node = roots[head++]!
      for (const edge of node.outgoing) {
        const target = edge.target
        target.layer = Math.max(target.layer, node.layer + edge.delta)
        incident[target.internalId]!--
        if (incident[target.internalId] === 0) roots.push(target)
      }
    }
  }

  private minimalSpan(node: NNode<Node>): [number, number] {
    let minSpanOut = 2147483647
    let minSpanIn = 2147483647
    for (const edge of connectedEdges(node)) {
      const currentSpan = edge.target.layer - edge.source.layer
      if (edge.target === node && currentSpan < minSpanIn) minSpanIn = currentSpan
      else if (currentSpan < minSpanOut) minSpanOut = currentSpan
    }
    if (minSpanIn === 2147483647) minSpanIn = -1
    if (minSpanOut === 2147483647) minSpanOut = -1
    return [minSpanIn, minSpanOut]
  }

  private tightTreeDFS(node: NNode<Node>): number {
    let nodeCount = 1
    node.treeNode = true
    for (const edge of connectedEdges(node)) {
      if (!this.edgeVisited[edge.internalId]) {
        this.edgeVisited[edge.internalId] = true
        const opposite = otherNode(edge, node)
        if (edge.treeEdge) nodeCount += this.tightTreeDFS(opposite)
        else if (!opposite.treeNode && edge.delta === edge.target.layer - edge.source.layer) {
          edge.treeEdge = true
          this.treeEdges.add(edge)
          nodeCount += this.tightTreeDFS(opposite)
        }
      }
    }
    return nodeCount
  }

  private minimalSlack(): NEdge<Node> | null {
    let minSlack = 2147483647
    let minSlackEdge: NEdge<Node> | null = null
    for (const edge of this.edges) {
      if (edge.source.treeNode !== edge.target.treeNode) {
        const curSlack = edge.target.layer - edge.source.layer - edge.delta
        if (curSlack < minSlack) {
          minSlack = curSlack
          minSlackEdge = edge
        }
      }
    }
    return minSlackEdge
  }

  private postorderTraversal(node: NNode<Node>): number {
    let lowest = 2147483647
    for (const edge of connectedEdges(node)) {
      if (edge.treeEdge && !this.edgeVisited[edge.internalId]) {
        this.edgeVisited[edge.internalId] = true
        lowest = Math.min(lowest, this.postorderTraversal(otherNode(edge, node)))
      }
    }
    this.poID[node.internalId] = this.postOrder
    this.lowestPoID[node.internalId] = Math.min(lowest, this.postOrder++)
    return this.lowestPoID[node.internalId]!
  }

  private isInHead(node: NNode<Node>, edge: NEdge<Node>): boolean {
    const source = edge.source
    const target = edge.target
    if (this.lowestPoID[source.internalId]! <= this.poID[node.internalId]!
      && this.poID[node.internalId]! <= this.poID[source.internalId]!
      && this.lowestPoID[target.internalId]! <= this.poID[node.internalId]!
      && this.poID[node.internalId]! <= this.poID[target.internalId]!) {
      if (this.poID[source.internalId]! < this.poID[target.internalId]!) return false
      return true
    }
    if (this.poID[source.internalId]! < this.poID[target.internalId]!) return true
    return false
  }

  private cutvalues(): void {
    const leafs: NNode<Node>[] = []
    for (const node of this.graph.nodes) {
      let treeEdgeCount = 0
      node.unknownCutvalues.length = 0
      for (const edge of connectedEdges(node)) {
        if (edge.treeEdge) {
          node.unknownCutvalues.push(edge)
          treeEdgeCount++
        }
      }
      if (treeEdgeCount === 1) leafs.push(node)
    }
    for (const leaf of leafs) {
      let node = leaf
      while (node.unknownCutvalues.length === 1) {
        const toDetermine = node.unknownCutvalues[0]!
        this.cutvalue[toDetermine.internalId] = toDetermine.weight
        const source = toDetermine.source
        const target = toDetermine.target
        for (const edge of connectedEdges(node)) {
          if (edge !== toDetermine) {
            if (edge.treeEdge) {
              if (source === edge.source || target === edge.target) this.cutvalue[toDetermine.internalId]! -= this.cutvalue[edge.internalId]! - edge.weight
              else this.cutvalue[toDetermine.internalId]! += this.cutvalue[edge.internalId]! - edge.weight
            } else if (node === source) {
              if (edge.source === node) this.cutvalue[toDetermine.internalId]! += edge.weight
              else this.cutvalue[toDetermine.internalId]! -= edge.weight
            } else {
              if (edge.source === node) this.cutvalue[toDetermine.internalId]! -= edge.weight
              else this.cutvalue[toDetermine.internalId]! += edge.weight
            }
          }
        }
        remove(source.unknownCutvalues, toDetermine)
        remove(target.unknownCutvalues, toDetermine)
        if (source === node) node = toDetermine.target
        else node = toDetermine.source
      }
    }
  }

  private leaveEdge(): NEdge<Node> | null {
    for (const edge of this.treeEdges) {
      if (edge.treeEdge && this.cutvalue[edge.internalId]! < -1e-10) return edge
    }
    return null
  }

  private enterEdge(leave: NEdge<Node>): NEdge<Node> | null {
    if (!leave.treeEdge) throw new Error('The input edge is not a tree edge.')
    let replace: NEdge<Node> | null = null
    let repSlack = 2147483647
    for (const edge of this.edges) {
      const source = edge.source
      const target = edge.target
      if (this.isInHead(source, leave) && !this.isInHead(target, leave)) {
        const slack = target.layer - source.layer - edge.delta
        if (slack < repSlack) {
          repSlack = slack
          replace = edge
        }
      }
    }
    return replace
  }

  private exchange(leave: NEdge<Node>, enter: NEdge<Node>): void {
    if (!leave.treeEdge) throw new Error('Given leave edge is no tree edge.')
    if (enter.treeEdge) throw new Error('Given enter edge is a tree edge already.')
    leave.treeEdge = false
    this.treeEdges.delete(leave)
    enter.treeEdge = true
    this.treeEdges.add(enter)
    let delta = enter.target.layer - enter.source.layer - enter.delta
    if (!this.isInHead(enter.target, leave)) delta = -delta
    for (const node of this.graph.nodes) {
      if (!this.isInHead(node, leave)) node.layer += delta
    }
    this.postOrder = 1
    this.edgeVisited.fill(false)
    this.postorderTraversal(this.graph.nodes[0]!)
    this.cutvalues()
  }

  private normalize(): number[] {
    let highest = -2147483648
    let lowest = 2147483647
    for (const node of this.graph.nodes) {
      lowest = Math.min(lowest, node.layer)
      highest = Math.max(highest, node.layer)
    }
    const filling: number[] = new Array(highest - lowest + 1).fill(0)
    for (const node of this.graph.nodes) {
      node.layer -= lowest
      filling[node.layer]!++
    }
    let layerID = 0
    if (this.previousLayeringNodeCounts !== null) {
      for (const nodeCntInLayer of this.previousLayeringNodeCounts) {
        filling[layerID++]! += nodeCntInLayer
        if (filling.length === layerID) break
      }
    }
    return filling
  }

  private balance(filling: number[]): void {
    for (const node of this.graph.nodes) {
      if (node.incoming.length === node.outgoing.length) {
        let newLayer = node.layer
        const [minSpanIn, minSpanOut] = this.minimalSpan(node)
        for (let i = node.layer - minSpanIn + 1; i < node.layer + minSpanOut; i++) {
          if (filling[i]! < filling[newLayer]!) newLayer = i
        }
        if (filling[newLayer]! < filling[node.layer]!) {
          filling[node.layer]!--
          filling[newLayer]!++
          node.layer = newLayer
        }
      }
    }
  }
}

/** NetworkSimplexLayerer.process, connectedComponents, and initialize, same source pin. */
export function assignNetworkSimplexLayers<Node extends { ports: SimplexPort<Node>[]; rank: number }>(nodes: Node[], thoroughness: number): Node[][] {
  if (nodes.length < 1) return []
  const components: Node[][] = []
  const visited = new Set<Node>()
  function connectedComponentsDFS(node: Node, component: Node[]): void {
    visited.add(node)
    component.push(node)
    for (const port of node.ports) {
      for (const edge of port.incoming) {
        const opposite = edge.source === port ? edge.target.node : edge.source.node
        if (!visited.has(opposite)) connectedComponentsDFS(opposite, component)
      }
      for (const edge of port.outgoing) {
        const opposite = edge.source === port ? edge.target.node : edge.source.node
        if (!visited.has(opposite)) connectedComponentsDFS(opposite, component)
      }
    }
  }
  for (const node of nodes) {
    if (!visited.has(node)) {
      const component: Node[] = []
      connectedComponentsDFS(node, component)
      if (components.length === 0 || components[0]!.length < component.length) components.unshift(component)
      else components.push(component)
    }
  }

  const layers: Node[][] = []
  let previousLayeringNodeCounts: number[] | null = null
  for (const component of components) {
    const graph: NGraph<Node> = { nodes: [] }
    const nodeMap = new Map<Node, NNode<Node>>()
    for (const node of component) {
      const nNode: NNode<Node> = { origin: node, incoming: [], outgoing: [], layer: 0, internalId: 0, treeNode: false, unknownCutvalues: [] }
      graph.nodes.push(nNode)
      nodeMap.set(node, nNode)
    }
    for (const node of component) {
      for (const port of node.ports) {
        for (const edge of port.outgoing) {
          if (edge.source.node === edge.target.node) continue
          const nEdge: NEdge<Node> = {
            source: nodeMap.get(edge.source.node)!, target: nodeMap.get(edge.target.node)!,
            weight: Math.max(1, edge.priorityShortness), delta: 1, internalId: 0, treeEdge: false,
          }
          nEdge.source.outgoing.push(nEdge)
          nEdge.target.incoming.push(nEdge)
        }
      }
    }
    const iterLimit = thoroughness * 4 * Math.trunc(Math.sqrt(component.length))
    new NetworkSimplex(graph, iterLimit, previousLayeringNodeCounts).execute()
    for (const node of graph.nodes) {
      while (layers.length <= node.layer) layers.push([])
      node.origin.rank = node.layer
      layers[node.layer]!.push(node.origin)
    }
    if (components.length > 1) previousLayeringNodeCounts = layers.map(layer => layer.length)
  }
  return layers
}
