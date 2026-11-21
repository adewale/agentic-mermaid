/*******************************************************************************
 * Copyright (c) 2010, 2012, 2014, 2015, 2016, 2018, 2020 Kiel University and others.
 * Copyright (c) 2021, 2023, 2025 Kiel University and others.
 * Copyright (c) 2020 sdo and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Random } from './random.ts'
import type { LayoutNode, LayoutPort, LayoutEdge, LayoutGraph } from './graph.ts'
import { booleanOption, enumOption, integerOption, numberOption } from './options.ts'
import type { Options } from './options.ts'
import { sortPortLists } from './phases.ts'
import { sort } from './sort.ts'

type Node = LayoutNode
type Port = LayoutPort
type Edge = LayoutEdge
type Side = Port['side']
type Order = Node[][]
const sideOrder: Record<Side, number> = { UNDEFINED: 0, NORTH: 1, EAST: 2, SOUTH: 3, WEST: 4 }
const connectedEdges = (port: Port): Edge[] => port.incoming.concat(port.outgoing)
const otherEnd = (edge: Edge, port: Port): Port => edge.source === port ? edge.target : edge.source
const portsOnSide = (node: Node, side: Side): Port[] => node.ports.filter(port => port.side === side)
const topDownPorts = (node: Node, side: Side): Port[] => side === 'WEST' || side === 'SOUTH' ? portsOnSide(node, side).reverse() : portsOnSide(node, side)
const isInLayer = (edge: Edge): boolean => edge.source.node.rank === edge.target.node.rank
const isSelfLoop = (edge: Edge): boolean => edge.source.node === edge.target.node
const isOrderFixed = (node: Node): boolean => node.portConstraints === 'FIXED_ORDER' || node.portConstraints === 'FIXED_RATIO' || node.portConstraints === 'FIXED_POS'
function remove<T>(items: T[], item: T): boolean { const index = items.indexOf(item); if (index < 0) return false; items.splice(index, 1); return true }
function compareNumbers(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  if (a === b) return a === 0 ? compareNumbers(1 / a, 1 / b) : 0
  return Number.isNaN(a) ? Number.isNaN(b) ? 0 : 1 : -1
}

type OrderingStrategy = 'NONE' | 'NODES_AND_EDGES' | 'PREFER_EDGES' | 'PREFER_NODES'
type LongEdgeOrderingStrategy = 'DUMMY_NODE_OVER' | 'DUMMY_NODE_UNDER' | 'EQUAL'
type GroupOrderStrategy = 'ONLY_WITHIN_GROUP' | 'MODEL_ORDER' | 'ENFORCED'
type ModelElement = Node | Port | Edge
class ModelOrderContext {
  readonly strategy: OrderingStrategy
  readonly groupStrategy: GroupOrderStrategy
  readonly portModelOrder: boolean
  readonly longEdgeStrategy: LongEdgeOrderingStrategy
  constructor(readonly options: Options, readonly order: Order, private maximum?: number) {
    this.strategy = enumOption(options, 'layered.considerModelOrder.strategy', ['NONE', 'NODES_AND_EDGES', 'PREFER_EDGES', 'PREFER_NODES'] as const, 'NONE')
    this.groupStrategy = enumOption(options, 'layered.considerModelOrder.groupModelOrder.cmGroupOrderStrategy', ['ONLY_WITHIN_GROUP', 'MODEL_ORDER', 'ENFORCED'] as const, 'ONLY_WITHIN_GROUP')
    this.portModelOrder = booleanOption(options, 'layered.considerModelOrder.portModelOrder', false)
    this.longEdgeStrategy = enumOption(options, 'layered.considerModelOrder.longEdgeStrategy', ['DUMMY_NODE_OVER', 'DUMMY_NODE_UNDER', 'EQUAL'] as const, 'DUMMY_NODE_OVER')
  }
  get maxModelOrderNodes(): number {
    // The source unboxes this optional graph property only when a comparator
    // actually needs it. Joined child graphs do not acquire a local default.
    if (this.maximum === undefined) throw new TypeError("Cannot read properties of undefined (reading 'value_0')")
    return this.maximum
  }
  groupId(element: ModelElement): number {
    return 'ports' in element ? element.crossingMinimizationGroupId : integerOption(element.options, 'layered.considerModelOrder.groupModelOrder.crossingMinimizationId', 0)
  }
  calculate(element: ModelElement, other: ModelElement, offset: number): number {
    if (element.modelOrder === undefined) return -1
    if (this.groupStrategy === 'ENFORCED') {
      // The source List option has no IDataObject parser at the JSON boundary.
      const enforced = [1, 2, 6, 7, 10, 11]
      if (enforced.includes(this.groupId(element)) && enforced.includes(this.groupId(other))) return offset * this.groupId(element) + element.modelOrder
    }
    return element.modelOrder
  }
}
function requiredModelOrder(element: ModelElement): number {
  if (element.modelOrder === undefined) throw new TypeError("Cannot read properties of undefined (reading 'value_0')")
  return element.modelOrder
}

/** Source transitive relation tables use membership and set unions, never iteration to choose a relation. */
class TransitiveOrdering<T> {
  biggerThan = new Map<T, Set<T>>()
  smallerThan = new Map<T, Set<T>>()
  compare(a: T, b: T, smallerTable: boolean): number {
    if (!this.biggerThan.has(a)) this.biggerThan.set(a, new Set())
    else if (this.biggerThan.get(a)!.has(b)) return 1
    if (!this.biggerThan.has(b)) this.biggerThan.set(b, new Set())
    else if (this.biggerThan.get(b)!.has(a)) return -1
    if (!this.smallerThan.has(a)) this.smallerThan.set(a, new Set())
    else if (this.smallerThan.get(a)!.has(b)) return -1
    if (!this.smallerThan.has(b)) this.smallerThan.set(b, new Set())
    else if ((smallerTable ? this.smallerThan : this.biggerThan).get(b)!.has(a)) return 1
    return 0
  }
  update(bigger: T, smaller: T): void {
    const bb = this.biggerThan.get(bigger)!, sb = this.biggerThan.get(smaller)!
    const bs = this.smallerThan.get(bigger)!, ss = this.smallerThan.get(smaller)!
    bb.add(smaller); ss.add(bigger)
    for (const verySmall of sb) {
      bb.add(verySmall); this.smallerThan.get(verySmall)!.add(bigger)
      for (const value of bs) this.smallerThan.get(verySmall)!.add(value)
    }
    for (const veryBig of bs) {
      ss.add(veryBig); this.biggerThan.get(veryBig)!.add(smaller)
      for (const value of sb) this.biggerThan.get(veryBig)!.add(value)
    }
  }
  clear(): void { this.biggerThan = new Map(); this.smallerThan = new Map() }
}

class ModelOrderPortComparator {
  private relation = new TransitiveOrdering<Port>()
  constructor(private context: ModelOrderContext, private previous: Node[], private targetNodeModelOrder: Map<Node, number> | null, private portModelOrder: boolean) {}
  private update(bigger: Port, smaller: Port, reverse: number): void { this.relation.update(reverse < 0 ? smaller : bigger, reverse < 0 ? bigger : smaller) }
  private result(a: Port, b: Port, reverse: number, result: number): number { if (result > 0) this.update(a, b, reverse); else this.update(b, a, reverse); return result > 0 ? reverse : -reverse }
  private checkReferenceLayer(layer: Node[], a: Node, b: Node): number { for (const node of layer) { if (node === a) return -1; if (node === b) return 1 }; return 0 }
  private checkPortModelOrder(a: Port, b: Port): number {
    if (a.modelOrder === undefined || b.modelOrder === undefined) return 0
    return compareNumbers(this.context.calculate(a, b, a.node.ports.length), this.context.calculate(b, a, a.node.ports.length))
  }
  compare(a: Port, b: Port): number {
    const transitive = this.relation.compare(a, b, false)
    if (transitive !== 0) return transitive
    if (a.side !== b.side) {
      const result = compareNumbers(sideOrder[a.side], sideOrder[b.side])
      if (result > 0) this.update(a, b, 1); else this.update(b, a, 1)
      return result
    }
    let reverse = 1
    if (a.incoming.length > 0 && b.incoming.length > 0) {
      if (a.side === 'WEST' || a.side === 'NORTH' || a.side === 'SOUTH') reverse = -reverse
      const aSource = a.incoming[0]!.source, bSource = b.incoming[0]!.source
      const aNode = aSource.node, bNode = bSource.node
      if (aNode === bNode) for (const port of aNode.ports) {
        if (port === aSource) return this.result(a, b, reverse, -1)
        if (port === bSource) return this.result(a, b, reverse, 1)
      }
      if (aNode.type === 'LONG_EDGE' && bNode.type === 'LONG_EDGE' && aNode.rank === bNode.rank && aNode.rank === a.node.rank) {
        const inLayer = this.checkReferenceLayer(this.context.order[aNode.rank]!, aNode, bNode)
        if (inLayer !== 0) { if (a.side === 'EAST') reverse = -reverse; return this.result(a, b, reverse, inLayer) }
      }
      const previous = this.checkReferenceLayer(this.previous, aNode, bNode)
      if (previous !== 0) return this.result(a, b, reverse, previous)
      if (this.portModelOrder) { const value = this.checkPortModelOrder(a, b); if (value !== 0) return this.result(a, b, reverse, value) }
    }
    if (a.outgoing.length > 0 && b.outgoing.length > 0) {
      if (a.side === 'WEST' || a.side === 'SOUTH') reverse = -reverse
      const aTarget = a.longEdgeTargetNode, bTarget = b.longEdgeTargetNode
      if (this.context.strategy === 'PREFER_NODES' && aTarget !== undefined && bTarget !== undefined && aTarget.modelOrder !== undefined && bTarget.modelOrder !== undefined) {
        const x = this.context.calculate(aTarget, bTarget, this.context.maxModelOrderNodes), y = this.context.calculate(bTarget, aTarget, this.context.maxModelOrderNodes)
        return this.result(a, b, reverse, x > y ? 1 : -1)
      }
      if (this.portModelOrder) { const value = this.checkPortModelOrder(a, b); if (value !== 0) return this.result(a, b, reverse, value) }
      let x = a.outgoing[0]!.modelOrder === undefined ? 0 : this.context.calculate(a.outgoing[0]!, b.outgoing[0]!, a.outgoing.length + a.incoming.length)
      let y = b.outgoing[0]!.modelOrder === undefined ? 0 : this.context.calculate(b.outgoing[0]!, a.outgoing[0]!, b.outgoing.length + b.incoming.length)
      if (aTarget !== undefined && aTarget === bTarget) return this.result(a, b, reverse, x > y ? 1 : -1)
      if (aTarget !== undefined && this.targetNodeModelOrder?.has(aTarget)) x = this.targetNodeModelOrder.get(aTarget)!
      if (bTarget !== undefined && this.targetNodeModelOrder?.has(bTarget)) y = this.targetNodeModelOrder.get(bTarget)!
      return this.result(a, b, reverse, x > y ? 1 : -1)
    }
    if (a.incoming.length > 0 && b.outgoing.length > 0) { this.update(a, b, reverse); return 1 }
    if (a.outgoing.length > 0 && b.incoming.length > 0) { this.update(b, a, reverse); return -1 }
    if (a.modelOrder !== undefined && b.modelOrder !== undefined) {
      const x = this.context.calculate(a, b, a.node.ports.length), y = this.context.calculate(b, a, a.node.ports.length)
      if (a.side === 'WEST' || a.side === 'SOUTH') reverse = -reverse
      return this.result(a, b, reverse, x > y ? 1 : -1)
    }
    return this.result(a, b, reverse, -1)
  }
}

class ModelOrderNodeComparator {
  private relation = new TransitiveOrdering<Node>()
  constructor(private context: ModelOrderContext, private previous: Node[], private longEdgeOrder: LongEdgeOrderingStrategy, private beforePorts: boolean) {}
  clearTransitiveOrdering(): void { this.relation.clear() }
  private connectedOrder(node: Node): number {
    const port = node.ports.find(p => p.incoming.length > 0)
    return port === undefined ? this.longEdgeOrder === 'DUMMY_NODE_OVER' ? 2147483647 : this.longEdgeOrder === 'DUMMY_NODE_UNDER' ? -2147483648 : 0 : requiredModelOrder(port.incoming[0]!)
  }
  private update(a: Node, b: Node, result: number): number { if (result > 0) this.relation.update(a, b); else this.relation.update(b, a); return result }
  compare(a: Node, b: Node): number {
    const transitive = this.relation.compare(a, b, false)
    if (transitive !== 0) return transitive
    if (this.context.strategy === 'PREFER_EDGES' || a.modelOrder === undefined || b.modelOrder === undefined) {
      const previousSource = (node: Node): Port | undefined => {
        for (const port of node.ports) if (port.incoming.length > 0 && port.incoming[0]!.source.node.rank === node.rank - 1) return port.incoming[0]!.source
        return undefined
      }
      const x = previousSource(a), y = previousSource(b)
      if (x !== undefined && y !== undefined) {
        if (x.node === y.node) {
          for (const port of x.node.ports) {
            if (port === x) return this.update(a, b, -1)
            if (port === y) return this.update(a, b, 1)
          }
          return this.update(a, b, this.connectedOrder(a) > this.connectedOrder(b) ? 1 : -1)
        }
        for (const node of this.previous) { if (node === x.node) return this.update(a, b, -1); if (node === y.node) return this.update(a, b, 1) }
      }
      if ((x !== undefined) !== (y !== undefined)) {
        const helper = this.handleHelperDummyNodes(a, b)
        if (helper !== 0) return this.update(a, b, helper)
        if (a.modelOrder === undefined || b.modelOrder === undefined) return this.update(a, b, this.connectedOrder(a) > this.connectedOrder(b) ? 1 : -1)
      }
      if (x === undefined && y === undefined) {
        const helper = this.handleHelperDummyNodes(a, b)
        if (helper !== 0) return this.update(a, b, helper)
      }
    }
    if (a.modelOrder !== undefined && b.modelOrder !== undefined) return this.update(a, b, this.context.calculate(a, b, this.context.maxModelOrderNodes) > this.context.calculate(b, a, this.context.maxModelOrderNodes) ? 1 : -1)
    return this.update(a, b, -1)
  }
  private incomingSource(node: Node): Port { return node.ports.find(p => p.incoming.length > 0)!.incoming[0]!.source }
  private outgoingTarget(node: Node): Port { return node.ports.find(p => p.outgoing.length > 0)!.outgoing[0]!.target }
  private handleHelperDummyNodes(a: Node, b: Node): number {
    if (a.type === 'LONG_EDGE' && b.type === 'NORMAL') {
      const source = this.incomingSource(a).node, target = this.outgoingTarget(a).node
      if (source.rank !== a.rank && target.rank !== a.rank) return 0
      if (source === b || target === b) { this.relation.update(a, b); return 1 }
      return this.compare(source, b)
    }
    if (a.type === 'NORMAL' && b.type === 'LONG_EDGE') {
      const source = this.incomingSource(b).node, target = this.outgoingTarget(b).node
      if (source.rank !== a.rank && target.rank !== a.rank) return 0
      if (source === a || target === a) { this.relation.update(b, a); return -1 }
      return this.compare(a, source)
    }
    if (a.type === 'LONG_EDGE' && b.type === 'LONG_EDGE') {
      const as = this.incomingSource(a), at = this.outgoingTarget(a), bs = this.incomingSource(b), bt = this.outgoingTarget(b)
      let ar = a, br = b, aSource = false, aTarget = false, bSource = false, bTarget = false
      if (as.node.rank === a.rank) { aSource = true; ar = as.node } else if (at.node.rank === a.rank) { aTarget = true; ar = at.node }
      if (bs.node.rank === b.rank) { bSource = true; br = bs.node } else if (bt.node.rank === b.rank) { bTarget = true; br = bt.node }
      if (ar === br) {
        if (this.beforePorts) {
          if (aSource && bSource) {
            const value = new ModelOrderPortComparator(this.context, this.previous, null, bTarget).compare(as, bs)
            if (value > 0) { this.relation.update(b, a); return 1 }
            this.relation.update(a, b); return -1
          }
          if (aSource && bTarget) { this.relation.update(b, a); return 1 }
          if (aTarget && bSource) { this.relation.update(a, b); return -1 }
          if (aTarget && bTarget) return 0
        } else for (const port of ar.ports) {
          if (port === as) { this.relation.update(b, a); return -1 }
          if (port === bs) { this.relation.update(a, b); return 1 }
        }
      }
      return this.compare(ar, br)
    }
    return 0
  }
}

function longEdgeTargetNodePreprocessing(node: Node): Map<Node, number> {
  if (node.targetNodeModelOrder !== undefined) return node.targetNodeModelOrder
  const targets = new Map<Node, number>()
  for (const port of node.ports) if (port.outgoing.length > 0) {
    let edge = port.outgoing[0]!, target: Node | undefined
    do {
      target = edge.target.node
      if (target.longEdgeTarget !== undefined) { target = target.longEdgeTarget.node; break }
      if (target.type !== 'NORMAL') {
        let next: Edge | undefined
        for (const p of target.ports) { if (p.outgoing.length > 0) { next = p.outgoing[0]; break } }
        if (next === undefined) { target = undefined; break }
        edge = next
      }
    } while (target.type !== 'NORMAL')
    port.longEdgeTargetNode = target
    if (target !== undefined && !port.outgoing[0]!.reversed) targets.set(target, Math.min(requiredModelOrder(port.outgoing[0]!), targets.get(target) ?? 2147483647))
  }
  node.targetNodeModelOrder = targets
  return targets
}
function insertionSort<T>(items: T[], compare: (a: T, b: T) => number): void {
  for (let i = 1; i < items.length; i++) {
    const value = items[i]!
    let j = i
    while (j > 0 && compare(items[j - 1]!, value) > 0) { items[j] = items[j - 1]!; j-- }
    items[j] = value
  }
}
function sortByInputModel(order: Order, context: ModelOrderContext): void {
  for (let l = 0; l < order.length; l++) {
    const layer = order[l]!, previousIndex = l === 0 ? 0 : l - 1
    let comparator = new ModelOrderNodeComparator(context, order[previousIndex]!.slice(), context.longEdgeStrategy, true)
    insertionSort(layer, (a, b) => comparator.compare(a, b)); comparator.clearTransitiveOrdering()
    for (const node of layer) if (node.portConstraints !== 'FIXED_ORDER' && node.portConstraints !== 'FIXED_POS') {
      const ports = new ModelOrderPortComparator(context, order[previousIndex]!.slice(), longEdgeTargetNodePreprocessing(node), context.portModelOrder)
      sort(node.ports, (a, b) => ports.compare(a, b))
    }
    comparator = new ModelOrderNodeComparator(context, order[previousIndex]!.slice(), context.longEdgeStrategy, false)
    insertionSort(layer, (a, b) => comparator.compare(a, b)); comparator.clearTransitiveOrdering()
  }
}

/** BinaryIndexedTree, ELK v0.11.0, 54123e884b1ae743b453260f713b20c9bf5787f2. */
class BinaryIndexedTree {
  private binarySums: number[]
  private numsPerIndex: number[]
  size = 0
  constructor(maxNum: number) { this.binarySums = new Array(maxNum + 1).fill(0); this.numsPerIndex = new Array(maxNum).fill(0) }
  add(index: number): void { this.size++; this.numsPerIndex[index]!++; for (let i = index + 1; i < this.binarySums.length; i += i & -i) this.binarySums[i]!++ }
  rank(index: number): number { let sum = 0; for (let i = index; i > 0; i -= i & -i) sum += this.binarySums[i]!; return sum }
  removeAll(index: number): void {
    const numEntries = this.numsPerIndex[index]!
    if (numEntries === 0) return
    this.numsPerIndex[index] = 0; this.size -= numEntries
    for (let i = index + 1; i < this.binarySums.length; i += i & -i) this.binarySums[i]! -= numEntries
  }
  clear(): void {
    this.binarySums.fill(0)
    this.numsPerIndex.length = this.binarySums.length - 1
    this.numsPerIndex.fill(0)
    this.size = 0
  }
}

class CrossingsCounter {
  private indexTree = new BinaryIndexedTree(0)
  private ends: number[] = []
  private nodeCardinalities = new Map<Node, number>()
  constructor(private positions: Map<Port, number>) {}
  private positionOf(port: Port): number { return this.positions.get(port)! }
  private initPositions(nodes: Node[], ports: Port[], side: Side, topDown: boolean, cardinalities: boolean): void {
    let numPorts = ports.length
    if (cardinalities) this.nodeCardinalities = new Map()
    for (let i = topDown ? 0 : nodes.length - 1; topDown ? i < nodes.length : i >= 0; i += topDown ? 1 : -1) {
      const node = nodes[i]!
      const nodePorts = side === 'EAST' ? topDown ? portsOnSide(node, side) : portsOnSide(node, side).reverse() : topDown ? portsOnSide(node, side).reverse() : portsOnSide(node, side)
      if (cardinalities) this.nodeCardinalities.set(node, nodePorts.length)
      for (const port of nodePorts) { this.positions.set(port, numPorts++); ports.push(port) }
    }
  }
  private initPortPositionsCounterClockwise(left: Node[], right: Node[]): Port[] {
    const ports: Port[] = []
    this.initPositions(left, ports, 'EAST', true, false)
    this.initPositions(right, ports, 'WEST', false, false)
    return ports
  }
  initPortPositionsForInLayerCrossings(nodes: Node[], side: Side): Port[] {
    const ports: Port[] = []
    this.initPositions(nodes, ports, side, true, true)
    this.indexTree = new BinaryIndexedTree(ports.length)
    return ports
  }
  initForCountingBetween(left: Node[], right: Node[]): void { this.indexTree = new BinaryIndexedTree(this.initPortPositionsCounterClockwise(left, right).length) }
  countCrossingsBetweenLayers(left: Node[], right: Node[]): number {
    const ports = this.initPortPositionsCounterClockwise(left, right)
    this.indexTree = new BinaryIndexedTree(ports.length)
    return this.countCrossingsOnPorts(ports)
  }
  countInLayerCrossingsOnSide(nodes: Node[], side: Side): number { return this.countInLayerCrossingsOnPorts(this.initPortPositionsForInLayerCrossings(nodes, side)) }
  countNorthSouthPortCrossingsInLayer(nodes: Node[]): number {
    const ports: Port[] = [], stack: Node[] = []
    let previousUnit: Node | undefined, index = 0
    const append = (port: Port): void => { this.positions.set(port, index++); ports.push(port) }
    const emptyStack = (): void => { while (stack.length > 0) append(portsOnSide(stack.pop()!, 'EAST')[0]!) }
    for (const node of nodes) {
      if (previousUnit !== undefined && previousUnit !== node && node.inLayerLayoutUnit !== undefined && node.inLayerLayoutUnit !== previousUnit) emptyStack()
      if (node.inLayerLayoutUnit !== undefined) previousUnit = node.inLayerLayoutUnit
      if (node.type === 'NORMAL') {
        for (const port of portsOnSide(node, 'NORTH')) if (port.portDummy !== undefined) append(port)
        emptyStack()
        for (const port of portsOnSide(node, 'SOUTH')) if (port.portDummy !== undefined) append(port)
      } else if (node.type === 'NORTH_SOUTH_PORT') {
        const west = portsOnSide(node, 'WEST')
        if (west.length > 0) append(west[0]!)
        if (portsOnSide(node, 'EAST').length > 0) stack.push(node)
      } else if (node.type === 'LONG_EDGE') {
        for (const port of portsOnSide(node, 'WEST')) append(port)
        for (const _port of portsOnSide(node, 'EAST')) stack.push(node)
      }
    }
    emptyStack(); this.indexTree = new BinaryIndexedTree(ports.length)
    let crossings = 0
    for (const port of ports) {
      this.indexTree.removeAll(this.positionOf(port))
      const targets: Array<[Port, number]> = []
      if (port.node.type === 'NORMAL') for (const other of port.portDummy!.ports) targets.push([other, other.incoming.length + other.outgoing.length])
      else if (port.node.type === 'LONG_EDGE') { const other = port.node.ports.find(other => other !== port); if (other !== undefined) targets.push([other, other.incoming.length + other.outgoing.length]) }
      else if (port.node.type === 'NORTH_SOUTH_PORT') targets.push([port.originPort!, port.incoming.length + port.outgoing.length])
      for (const [other, degree] of targets) { const end = this.positionOf(other); if (end > this.positionOf(port)) { crossings += this.indexTree.rank(end) * degree; this.ends.push(end) } }
      while (this.ends.length > 0) this.indexTree.add(this.ends.pop()!)
    }
    return crossings
  }
  switchPorts(top: Port, bottom: Port): void { const pos = this.positionOf(top); this.positions.set(top, this.positionOf(bottom)); this.positions.set(bottom, pos) }
  switchNodes(upper: Node, lower: Node, side: Side): void {
    for (const port of topDownPorts(upper, side)) this.positions.set(port, this.positionOf(port) + this.nodeCardinalities.get(lower)!)
    for (const port of topDownPorts(lower, side)) this.positions.set(port, this.positionOf(port) - this.nodeCardinalities.get(upper)!)
  }
  private positionSet(ports: Port[]): Port[] {
    const byPosition = new Map<number, Port>()
    for (const port of ports) if (!byPosition.has(this.positionOf(port))) byPosition.set(this.positionOf(port), port)
    return [...byPosition.values()].sort((a, b) => this.positionOf(a) - this.positionOf(b))
  }
  countCrossingsBetweenPortsInBothOrders(upper: Port, lower: Port): [number, number] {
    const collected: Port[] = []
    for (const port of [upper, lower]) {
      collected.push(port)
      for (const edge of connectedEdges(port)) if (edge.source !== edge.target) collected.push(otherEnd(edge, port))
    }
    const ports = this.positionSet(collected)
    const original = this.countCrossingsOnPorts(ports)
    this.indexTree.clear(); this.switchPorts(upper, lower)
    ports.sort((a, b) => this.positionOf(a) - this.positionOf(b))
    const switched = this.countCrossingsOnPorts(ports)
    this.indexTree.clear(); this.switchPorts(lower, upper)
    return [original, switched]
  }
  countInLayerCrossingsBetweenNodesInBothOrders(upper: Node, lower: Node, side: Side): [number, number] {
    const collected: Port[] = []
    for (const node of [upper, lower]) for (const port of topDownPorts(node, side)) for (const edge of connectedEdges(port)) {
      if (!isSelfLoop(edge)) { collected.push(port); if (isInLayer(edge)) collected.push(otherEnd(edge, port)) }
    }
    const ports = this.positionSet(collected)
    const original = this.countInLayerCrossingsOnPorts(ports)
    this.switchNodes(upper, lower, side); this.indexTree.clear()
    ports.sort((a, b) => this.positionOf(a) - this.positionOf(b))
    const switched = this.countInLayerCrossingsOnPorts(ports)
    this.switchNodes(lower, upper, side); this.indexTree.clear()
    return [original, switched]
  }
  private countCrossingsOnPorts(ports: Port[]): number {
    let crossings = 0
    for (const port of ports) {
      this.indexTree.removeAll(this.positionOf(port))
      for (const edge of connectedEdges(port)) {
        const endPosition = this.positionOf(otherEnd(edge, port))
        if (endPosition > this.positionOf(port)) { crossings += this.indexTree.rank(endPosition); this.ends.push(endPosition) }
      }
      while (this.ends.length > 0) this.indexTree.add(this.ends.pop()!)
    }
    return crossings
  }
  private countInLayerCrossingsOnPorts(ports: Port[]): number {
    let crossings = 0
    for (const port of ports) {
      this.indexTree.removeAll(this.positionOf(port))
      let numBetweenLayerEdges = 0
      for (const edge of connectedEdges(port)) {
        if (isInLayer(edge)) {
          const endPosition = this.positionOf(otherEnd(edge, port))
          if (endPosition > this.positionOf(port)) { crossings += this.indexTree.rank(endPosition); this.ends.push(endPosition) }
        } else numBetweenLayerEdges++
      }
      crossings += this.indexTree.size * numBetweenLayerEdges
      while (this.ends.length > 0) this.indexTree.add(this.ends.pop()!)
    }
    return crossings
  }
}

interface Hyperedge { edges: Edge[]; ports: Port[]; upperLeft: number; lowerLeft: number; upperRight: number; lowerRight: number; identityOrder: number }
class HyperedgeCrossingsCounter {
  constructor(private positions: Map<Port, number>) {}
  countCrossings(left: Node[], right: Node[]): number {
    let sourceCount = 0
    for (const node of left) for (const port of node.ports) {
      let count = 0
      for (const edge of port.outgoing) if (node.rank !== edge.target.node.rank) count++
      if (count > 0) this.positions.set(port, sourceCount++)
    }
    let targetCount = 0
    for (const node of right) {
      let northInputPorts = 0
      for (const port of node.ports) {
        if (port.side !== 'NORTH') break
        for (const edge of port.incoming) if (node.rank !== edge.source.node.rank) { northInputPorts++; break }
      }
      let otherInputPorts = 0
      for (let i = node.ports.length - 1; i >= 0; i--) {
        const port = node.ports[i]!
        let count = 0
        for (const edge of port.incoming) if (node.rank !== edge.source.node.rank) count++
        if (count > 0) {
          if (port.side === 'NORTH') this.positions.set(port, targetCount++)
          else this.positions.set(port, targetCount + northInputPorts + otherInputPorts++)
        }
      }
      targetCount += otherInputPorts
    }
    const port2Hyperedge = new Map<Port, Hyperedge>()
    const hyperedgeSet = new Set<Hyperedge>()
    let identityOrder = 0
    for (const node of left) for (const sourcePort of node.ports) for (const edge of sourcePort.outgoing) {
      const targetPort = edge.target
      if (node.rank === targetPort.node.rank) continue
      const sourceHE = port2Hyperedge.get(sourcePort), targetHE = port2Hyperedge.get(targetPort)
      if (sourceHE === undefined && targetHE === undefined) {
        // LinkedHashSet assigns the source identity hash on this first insertion.
        const hyperedge: Hyperedge = { edges: [edge], ports: [sourcePort, targetPort], upperLeft: 0, lowerLeft: 0, upperRight: 0, lowerRight: 0, identityOrder: identityOrder++ }
        hyperedgeSet.add(hyperedge); port2Hyperedge.set(sourcePort, hyperedge); port2Hyperedge.set(targetPort, hyperedge)
      } else if (sourceHE === undefined) {
        targetHE!.edges.push(edge); targetHE!.ports.push(sourcePort); port2Hyperedge.set(sourcePort, targetHE!)
      } else if (targetHE === undefined) {
        sourceHE.edges.push(edge); sourceHE.ports.push(targetPort); port2Hyperedge.set(targetPort, sourceHE)
      } else if (sourceHE === targetHE) sourceHE.edges.push(edge)
      else {
        sourceHE.edges.push(edge)
        for (const port of targetHE.ports) port2Hyperedge.set(port, sourceHE)
        for (const e of targetHE.edges) sourceHE.edges.push(e)
        for (const port of targetHE.ports) sourceHE.ports.push(port)
        hyperedgeSet.delete(targetHE)
      }
    }
    const hyperedges = [...hyperedgeSet]
    for (const he of hyperedges) {
      he.upperLeft = sourceCount; he.upperRight = targetCount
      for (const port of he.ports) {
        const position = this.positions.get(port)!
        if (port.node.rank === left[0]!.rank) { he.upperLeft = Math.min(he.upperLeft, position); he.lowerLeft = Math.max(he.lowerLeft, position) }
        else if (port.node.rank === right[0]!.rank) { he.upperRight = Math.min(he.upperRight, position); he.lowerRight = Math.max(he.lowerRight, position) }
      }
    }
    hyperedges.sort((a, b) => a.upperLeft - b.upperLeft || a.upperRight - b.upperRight || a.identityOrder - b.identityOrder)
    const southSequence = hyperedges.map(he => he.upperRight)
    const compressDeltas: number[] = new Array(targetCount + 1).fill(0)
    for (const position of southSequence) compressDeltas[position] = 1
    let delta = 0
    for (let i = 0; i < compressDeltas.length; i++) { if (compressDeltas[i] === 1) compressDeltas[i] = delta; else delta-- }
    let q = 0
    for (let i = 0; i < southSequence.length; i++) { southSequence[i]! += compressDeltas[southSequence[i]!]!; q = Math.max(q, southSequence[i]! + 1) }
    let firstIndex = 1
    while (firstIndex < q) firstIndex *= 2
    const tree: number[] = new Array(2 * firstIndex - 1).fill(0)
    firstIndex--
    let crossings = 0
    for (const position of southSequence) {
      let index = position + firstIndex
      tree[index]!++
      while (index > 0) { if (index % 2 > 0) crossings += tree[index + 1]!; index = Math.trunc((index - 1) / 2); tree[index]!++ }
    }
    for (const side of ['Left', 'Right'] as const) {
      const corners: Array<{ hyperedge: Hyperedge; position: number; oppositePosition: number; upper: boolean }> = []
      for (const hyperedge of hyperedges) {
        const upper = side === 'Left' ? hyperedge.upperLeft : hyperedge.upperRight
        const lower = side === 'Left' ? hyperedge.lowerLeft : hyperedge.lowerRight
        corners.push({ hyperedge, position: upper, oppositePosition: lower, upper: true }, { hyperedge, position: lower, oppositePosition: upper, upper: false })
      }
      corners.sort((a, b) => a.position - b.position || a.oppositePosition - b.oppositePosition || (a.hyperedge !== b.hyperedge ? a.hyperedge.identityOrder - b.hyperedge.identityOrder : a.upper === b.upper ? 0 : a.upper ? -1 : 1))
      let openHyperedges = 0
      for (const corner of corners) { if (corner.upper) openHyperedges++; else { openHyperedges--; crossings += openHyperedges } }
    }
    return crossings
  }
}

class AllCrossingsCounter {
  private crossingCounter: CrossingsCounter
  private hyperedgeCounter: HyperedgeCrossingsCounter
  private hyperedgesEast: boolean[]
  private northSouth: boolean[]
  constructor(order: Order) {
    const positions = new Map<Port, number>()
    this.hyperedgesEast = new Array(order.length).fill(false)
    this.northSouth = order.map(layer => layer.some(node => node.type === 'NORTH_SOUTH_PORT'))
    for (let l = 0; l < order.length; l++) for (const node of order[l]!) for (const port of node.ports) {
      positions.set(port, 0)
      if (port.incoming.length + port.outgoing.length > 1) {
        if (port.side === 'EAST') this.hyperedgesEast[l] = true
        else if (port.side === 'WEST' && l > 0) this.hyperedgesEast[l - 1] = true
      }
    }
    this.crossingCounter = new CrossingsCounter(positions)
    this.hyperedgeCounter = new HyperedgeCrossingsCounter(positions)
  }
  countAllCrossings(order: Order): number {
    if (order.length === 0) return 0
    let crossings = this.crossingCounter.countInLayerCrossingsOnSide(order[0]!, 'WEST')
    crossings += this.crossingCounter.countInLayerCrossingsOnSide(order[order.length - 1]!, 'EAST')
    for (let l = 0; l < order.length; l++) {
      const left = order[l]!
      if (l + 1 < order.length) {
        const right = order[l + 1]!
        if (this.hyperedgesEast[l]) {
          crossings += this.hyperedgeCounter.countCrossings(left, right)
          crossings += this.crossingCounter.countInLayerCrossingsOnSide(left, 'EAST')
          crossings += this.crossingCounter.countInLayerCrossingsOnSide(right, 'WEST')
        } else crossings += this.crossingCounter.countCrossingsBetweenLayers(left, right)
      }
      if (this.northSouth[l]) crossings += this.crossingCounter.countNorthSouthPortCrossingsInLayer(left)
    }
    return crossings
  }
}

interface BarycenterState { barycenter: number | null; summedWeight: number; degree: number; visited: boolean }
class ModelOrderBarycenterHeuristic {
  private relation = new TransitiveOrdering<Node>()
  constructor(private context: ModelOrderContext, private stateOf: (node: Node) => BarycenterState) {}
  clearTransitiveOrdering(): void { this.relation.clear() }
  compare(a: Node, b: Node): number {
    if (a.layerConstraint === 'FIRST_SEPARATE' || a.layerConstraint === 'LAST_SEPARATE' || b.layerConstraint === 'FIRST_SEPARATE' || b.layerConstraint === 'LAST_SEPARATE') return 0
    const transitive = this.relation.compare(a, b, true)
    if (transitive !== 0) return transitive
    if (a.modelOrder !== undefined && b.modelOrder !== undefined) {
      let value = compareNumbers(this.context.calculate(a, b, this.context.maxModelOrderNodes), this.context.calculate(b, a, this.context.maxModelOrderNodes))
      if (this.context.groupStrategy === 'ONLY_WITHIN_GROUP' && a.crossingMinimizationGroupIdentity !== b.crossingMinimizationGroupIdentity) value = 0
      if (value < 0) { this.relation.update(a, b); return value }
      if (value > 0) { this.relation.update(b, a); return value }
    }
    const x = this.stateOf(a).barycenter, y = this.stateOf(b).barycenter
    if (x !== null && y !== null) {
      const value = compareNumbers(x, y)
      if (value < 0) this.relation.update(a, b)
      else if (value > 0) this.relation.update(b, a)
      return value
    }
    if (x !== null) { this.relation.update(a, b); return -1 }
    if (y !== null) { this.relation.update(b, a); return 1 }
    return 0
  }
}
interface ConstraintGroup { nodes: Node[]; outgoing: ConstraintGroup[] | null; incoming: ConstraintGroup[] | null; incomingCount: number; summedWeight: number; degree: number }
class ForsterConstraintResolver {
  readonly states = new Map<Node, BarycenterState>()
  private groups = new Map<Node, ConstraintGroup>()
  private layoutUnits = new Map<Node, Node[]>()
  constructor(order: Order) {
    for (const layer of order) for (const node of layer) {
      this.states.set(node, { barycenter: null, summedWeight: 0, degree: 0, visited: false })
      this.groups.set(node, this.newGroup([node]))
      if (node.inLayerLayoutUnit !== undefined) {
        const members = this.layoutUnits.get(node.inLayerLayoutUnit) ?? []
        if (!members.includes(node)) members.push(node)
        this.layoutUnits.set(node.inLayerLayoutUnit, members)
      }
    }
  }
  private newGroup(nodes: Node[]): ConstraintGroup { return { nodes, outgoing: null, incoming: null, incomingCount: 0, summedWeight: 0, degree: 0 } }
  private barycenter(group: ConstraintGroup): number { return this.states.get(group.nodes[0]!)!.barycenter! }
  private setBarycenter(group: ConstraintGroup, value: number): void { for (const node of group.nodes) this.states.get(node)!.barycenter = value }
  processConstraints(nodes: Node[]): void {
    const groups = nodes.map(node => this.groups.get(node)!)
    for (const group of groups) { group.outgoing = null; group.incomingCount = 0 }
    let lastNonDummy: Node | null = null
    for (const group of groups) {
      const node = group.nodes[0]!
      for (const successor of node.inLayerSuccessors ?? []) {
        const next = this.groups.get(successor)!
        ;(group.outgoing ??= []).push(next); next.incomingCount++
      }
      if (node.type === 'NORMAL') {
        if (lastNonDummy !== null) for (const last of this.layoutUnits.get(lastNonDummy) ?? []) for (const current of this.layoutUnits.get(node) ?? []) {
          const next = this.groups.get(current)!
          ;(this.groups.get(last)!.outgoing ??= []).push(next); next.incomingCount++
        }
        lastNonDummy = node
      }
    }
    let violation: [ConstraintGroup, ConstraintGroup] | null
    while ((violation = this.findViolatedConstraint(groups)) !== null) this.handleViolatedConstraint(violation[0], violation[1], groups)
    nodes.length = 0
    for (const group of groups) for (const node of group.nodes) { nodes.push(node); this.states.get(node)!.barycenter = this.barycenter(group) }
  }
  private findViolatedConstraint(groups: ConstraintGroup[]): [ConstraintGroup, ConstraintGroup] | null {
    const active: ConstraintGroup[] = []
    for (const group of groups) { group.incoming = null; if ((group.outgoing?.length ?? 0) > 0 && group.incomingCount === 0) active.push(group) }
    for (let head = 0; head < active.length; head++) {
      const group = active[head]!
      for (const predecessor of group.incoming ?? []) {
        if (this.barycenter(predecessor) === this.barycenter(group)) {
          if (groups.indexOf(predecessor) > groups.indexOf(group)) return [predecessor, group]
        } else if (this.barycenter(predecessor) > this.barycenter(group)) return [predecessor, group]
      }
      for (const successor of group.outgoing ?? []) {
        ;(successor.incoming ??= []).unshift(group)
        if (successor.incomingCount === successor.incoming.length) active.push(successor)
      }
    }
    return null
  }
  private merge(first: ConstraintGroup, second: ConstraintGroup): ConstraintGroup {
    const group = this.newGroup(first.nodes.concat(second.nodes))
    if (first.outgoing !== null) {
      group.outgoing = first.outgoing.slice(); remove(group.outgoing, second)
      for (const candidate of second.outgoing ?? []) {
        if (candidate === first) continue
        if (group.outgoing.includes(candidate)) candidate.incomingCount--
        else group.outgoing.push(candidate)
      }
    } else if (second.outgoing !== null) { group.outgoing = second.outgoing.slice(); remove(group.outgoing, first) }
    group.summedWeight = first.summedWeight + second.summedWeight
    group.degree = first.degree + second.degree
    if (group.degree > 0) this.setBarycenter(group, group.summedWeight / group.degree)
    else {
      const a = this.states.get(first.nodes[0]!)!.barycenter, b = this.states.get(second.nodes[0]!)!.barycenter
      if (a !== null && b !== null) this.setBarycenter(group, (a + b) / 2)
      else if (a !== null) this.setBarycenter(group, a)
      else if (b !== null) this.setBarycenter(group, b)
    }
    return group
  }
  private handleViolatedConstraint(first: ConstraintGroup, second: ConstraintGroup, groups: ConstraintGroup[]): void {
    const merged = this.merge(first, second)
    let inserted = false
    for (let index = 0; index < groups.length;) {
      const group = groups[index]!
      if (group === first || group === second) groups.splice(index, 1)
      else if (!inserted && this.barycenter(group) > this.barycenter(merged)) { groups.splice(index, 0, merged); inserted = true; index++ }
      else {
        if ((group.outgoing?.length ?? 0) > 0) {
          const a = remove(group.outgoing!, first), b = remove(group.outgoing!, second)
          if (a || b) { group.outgoing!.push(merged); merged.incomingCount++ }
        }
        index++
      }
    }
    if (!inserted) groups.push(merged)
  }
}

class BarycenterPortDistributor {
  readonly portRanks = new Map<Port, number>()
  private portBarycenter = new Map<Port, number>()
  private nodePositions = new Map<Node, number>()
  private inLayerPorts: Port[] = []
  private minBarycenter = 0
  private maxBarycenter = 0
  constructor(order: Order, private nodeRelative: boolean) {
    for (const layer of order) for (let i = 0; i < layer.length; i++) {
      const node = layer[i]!
      this.nodePositions.set(node, i)
      for (const port of node.ports) { this.portRanks.set(port, 0); this.portBarycenter.set(port, 0) }
    }
  }
  calculatePortRanks(layer: Node[], output: boolean): void {
    let consumedRank = 0
    for (const node of layer) {
      if (output) {
        const ports = node.ports.filter(port => port.outgoing.length > 0)
        if (this.nodeRelative) {
          const increment = 1 / (ports.length + 1)
          let position = consumedRank + increment
          for (const port of ports) { this.portRanks.set(port, position); position += increment }
          consumedRank += 1
        } else {
          let position = 0
          for (const port of ports) this.portRanks.set(port, consumedRank + ++position)
          consumedRank += position
        }
      } else {
        const ports = node.ports.filter(port => port.incoming.length > 0)
        const northCount = ports.filter(port => port.side === 'NORTH').length
        const increment = this.nodeRelative ? 1 / (ports.length + 1) : 1
        let northPosition = consumedRank + northCount * increment
        let restPosition = this.nodeRelative ? consumedRank + 1 - increment : consumedRank + ports.length
        for (const port of ports) {
          if (port.side === 'NORTH') { this.portRanks.set(port, northPosition); northPosition -= increment }
          else { this.portRanks.set(port, restPosition); restPosition -= increment }
        }
        consumedRank += this.nodeRelative ? 1 : ports.length
      }
    }
  }
  distributePortsWhileSweeping(order: Order, current: number, forward: boolean): boolean {
    const layer = order[current]!
    for (let i = 0; i < layer.length; i++) this.nodePositions.set(layer[i]!, i)
    const side = forward ? 'WEST' : 'EAST'
    if (forward ? current !== 0 : current !== order.length - 1) {
      const fixed = order[forward ? current - 1 : current + 1]!
      this.calculatePortRanks(fixed, forward)
      for (const node of layer) this.distributePorts(node, side, layer.length)
      this.calculatePortRanks(layer, !forward)
      for (const node of fixed) if (node.nestedGraph === undefined) this.distributePorts(node, forward ? 'EAST' : 'WEST', fixed.length)
    } else for (const node of layer) this.distributePorts(node, side, layer.length)
    return false
  }
  private distributePorts(node: Node, side: Side, layerSize: number): void {
    if (isOrderFixed(node)) return
    for (const currentSide of [side, 'SOUTH', 'NORTH'] as Side[]) {
      this.inLayerPorts = []; this.minBarycenter = 0; this.maxBarycenter = 0
      portLoop: for (const port of portsOnSide(node, currentSide)) {
        let sum = 0
        const northSouth = currentSide === 'NORTH' || currentSide === 'SOUTH'
        if (northSouth) {
          const dummy = port.portDummy
          if (dummy === undefined) continue
          let input = false, output = false
          for (const other of dummy.ports) if (other.originPort === port) {
            if (other.outgoing.length > 0) output = true
            else if (other.incoming.length > 0) input = true
          }
          const large = 2 * layerSize + 1
          if (input && !output) sum = currentSide === 'NORTH' ? -this.nodePositions.get(dummy)! : large - this.nodePositions.get(dummy)!
          else if (output && !input) sum = this.nodePositions.get(dummy)! + 1.0
          else if (input && output) sum = currentSide === 'NORTH' ? 0.0 : large / 2
        } else {
        for (const edge of port.outgoing) {
          if (edge.target.node.rank === node.rank) { this.inLayerPorts.push(port); continue portLoop }
          sum += this.portRanks.get(edge.target)!
        }
        for (const edge of port.incoming) {
          if (edge.source.node.rank === node.rank) { this.inLayerPorts.push(port); continue portLoop }
          sum -= this.portRanks.get(edge.source)!
        }
        }
        const degree = port.incoming.length + port.outgoing.length
        if (degree > 0) {
          const barycenter = sum / degree
          this.portBarycenter.set(port, barycenter)
          this.minBarycenter = Math.min(this.minBarycenter, barycenter); this.maxBarycenter = Math.max(this.maxBarycenter, barycenter)
        } else if (northSouth) this.portBarycenter.set(port, sum)
      }
      for (const port of this.inLayerPorts) {
        let sum = 0, connections = 0
        for (const edge of connectedEdges(port)) {
          const connected = otherEnd(edge, port)
          if (connected.node.rank === node.rank) { sum += this.nodePositions.get(connected.node)! + 1; connections++ }
        }
        const barycenter = sum / connections, nodePosition = this.nodePositions.get(node)! + 1
        if (port.side === 'EAST') this.portBarycenter.set(port, barycenter < nodePosition ? this.minBarycenter - barycenter : this.maxBarycenter + (layerSize + 1 - barycenter))
        else if (port.side === 'WEST') this.portBarycenter.set(port, barycenter < nodePosition ? this.maxBarycenter + barycenter : this.minBarycenter - (layerSize + 1 - barycenter))
      }
    }
    node.ports.sort((a, b) => {
      if (a.side !== b.side) return sideOrder[a.side] - sideOrder[b.side]
      const x = this.portBarycenter.get(a)!, y = this.portBarycenter.get(b)!
      return x === 0 && y === 0 ? 0 : x === 0 ? -1 : y === 0 ? 1 : compareNumbers(x, y)
    })
  }
}

class BarycenterHeuristic {
  private modelOrder: ModelOrderBarycenterHeuristic | null
  constructor(private resolver: ForsterConstraintResolver, private random: Random, private distributor: BarycenterPortDistributor, context?: ModelOrderContext) {
    this.modelOrder = context === undefined ? null : new ModelOrderBarycenterHeuristic(context, node => this.stateOf(node))
  }
  private stateOf(node: Node): BarycenterState { return this.resolver.states.get(node)! }
  private minimize(layer: Node[], preOrdered: boolean, randomize: boolean, forward: boolean): void {
    if (randomize) for (const node of layer) { const state = this.stateOf(node); state.barycenter = this.random.nextDouble(); state.summedWeight = state.barycenter; state.degree = 1 }
    else {
      for (const node of layer) this.stateOf(node).visited = false
      for (const node of layer) this.calculateBarycenter(node, forward)
      this.fillInUnknownBarycenters(layer, preOrdered)
    }
    if (layer.length > 1) {
      if (this.modelOrder !== null) {
        insertionSort(layer, (a, b) => this.modelOrder!.compare(a, b))
        this.modelOrder.clearTransitiveOrdering()
      } else {
        layer.sort((a, b) => {
          const x = this.stateOf(a).barycenter, y = this.stateOf(b).barycenter
          return x !== null && y !== null ? compareNumbers(x, y) : x !== null ? -1 : y !== null ? 1 : 0
        })
        this.resolver.processConstraints(layer)
      }
    }
  }
  private fillInUnknownBarycenters(nodes: Node[], preOrdered: boolean): void {
    if (preOrdered) {
      let lastValue = -1
      for (let i = 0; i < nodes.length; i++) {
        const state = this.stateOf(nodes[i]!)
        let value = state.barycenter
        if (value === null) {
          let nextValue = lastValue + 1
          for (let j = i + 1; j < nodes.length; j++) { const x = this.stateOf(nodes[j]!).barycenter; if (x !== null) { nextValue = x; break } }
          value = (lastValue + nextValue) / 2; state.barycenter = value; state.summedWeight = value; state.degree = 1
        }
        lastValue = value
      }
    } else {
      let maxBary = 0
      for (const node of nodes) { const value = this.stateOf(node).barycenter; if (value !== null) maxBary = Math.max(maxBary, value) }
      maxBary += 2
      for (const node of nodes) { const state = this.stateOf(node); if (state.barycenter === null) { const value = this.random.nextFloat() * maxBary - 1; state.barycenter = value; state.summedWeight = value; state.degree = 1 } }
    }
  }
  private calculateBarycenter(node: Node, forward: boolean): void {
    const state = this.stateOf(node)
    if (state.visited) return
    state.visited = true; state.degree = 0; state.summedWeight = 0; state.barycenter = null
    for (const freePort of node.ports) for (const edge of forward ? freePort.incoming : freePort.outgoing) {
      const fixedPort = forward ? edge.source : edge.target, fixedNode = fixedPort.node
      if (fixedNode.rank === node.rank) {
        if (fixedNode !== node) { this.calculateBarycenter(fixedNode, forward); state.degree += this.stateOf(fixedNode).degree; state.summedWeight += this.stateOf(fixedNode).summedWeight }
      } else { state.summedWeight += this.distributor.portRanks.get(fixedPort)!; state.degree++ }
    }
    for (const associate of node.barycenterAssociates ?? []) if (associate.rank === node.rank) {
      this.calculateBarycenter(associate, forward); state.degree += this.stateOf(associate).degree; state.summedWeight += this.stateOf(associate).summedWeight
    }
    if (state.degree > 0) {
      const amount = 0.07000000029802322
      state.summedWeight += this.random.nextFloat() * amount - amount / 2
      state.barycenter = state.summedWeight / state.degree
    }
  }
  setFirstLayerOrder(order: Order, forward: boolean): boolean { this.minimize(order[forward ? 0 : order.length - 1]!, false, true, forward); return false }
  minimizeCrossings(order: Order, free: number, forward: boolean, firstSweep: boolean): boolean {
    if (forward ? free > 0 : free < order.length - 1) this.distributor.calculatePortRanks(order[free - (forward ? 1 : -1)]!, forward)
    this.minimize(order[free]!, !firstSweep || order[free]![0]!.type === 'EXTERNAL_PORT', false, forward)
    return false
  }
}

interface Adjacency { position: number; cardinality: number; currentCardinality: number }
class AdjacencyList {
  private list: Adjacency[] = []
  private totalSize = 0
  private currentSize = 0
  private currentIndex = 0
  constructor(node: Node, side: Side, positions: Map<Port, number>) {
    for (const port of topDownPorts(node, side)) for (const edge of side === 'WEST' ? port.incoming : port.outgoing) {
      if (!isSelfLoop(edge) && !isInLayer(edge)) {
        const adjacent = side === 'WEST' ? edge.source : edge.target
        const position = positions.get(adjacent)!
        const last = this.list[this.list.length - 1]
        if (last !== undefined && last.position === position) { last.cardinality++; last.currentCardinality++ }
        else this.list.push({ position, cardinality: 1, currentCardinality: 1 })
        this.totalSize++; this.currentSize++
      }
    }
    this.list.sort((a, b) => a.position < b.position ? -1 : a.position === b.position ? 0 : 1)
  }
  reset(): void { this.currentIndex = 0; this.currentSize = this.totalSize; if (this.currentSize > 0) this.list[0]!.currentCardinality = this.list[0]!.cardinality }
  get size(): number { return this.currentSize }
  get first(): number { return this.list[this.currentIndex]!.position }
  countAdjacenciesBelowNodeOfFirstPort(): number { return this.currentSize - this.list[this.currentIndex]!.currentCardinality }
  removeFirst(): void {
    if (this.currentSize === 0) return
    const current = this.list[this.currentIndex]!
    if (current.currentCardinality === 1) { this.currentIndex++; if (this.currentIndex < this.list.length) this.list[this.currentIndex]!.currentCardinality = this.list[this.currentIndex]!.cardinality }
    else current.currentCardinality--
    this.currentSize--
  }
}

class BetweenLayerEdgeTwoNodeCrossingsCounter {
  private positions = new Map<Port, number>()
  private easternAdjacencies = new Map<Node, AdjacencyList>()
  private westernAdjacencies = new Map<Node, AdjacencyList>()
  constructor(private order: Order, private free: number) {
    if (free > 0) this.setPortPositionsForLayer(free - 1, 'EAST')
    if (free + 1 < order.length) this.setPortPositionsForLayer(free + 1, 'WEST')
  }
  private setPortPositionsForLayer(layer: number, side: Side): void {
    let position = 0
    for (const node of this.order[layer]!) for (const port of topDownPorts(node, side)) this.positions.set(port, position++)
  }
  countBothSideCrossings(upper: Node, lower: Node): [number, number] {
    let upperLower = 0, lowerUpper = 0
    if (upper === lower) return [0, 0]
    for (const side of ['WEST', 'EAST'] as const) {
      const adjacencies = side === 'WEST' ? this.westernAdjacencies : this.easternAdjacencies
      if (adjacencies.size === 0) for (const node of this.order[this.free]!) adjacencies.set(node, new AdjacencyList(node, side, this.positions))
      const a = adjacencies.get(upper)!, b = adjacencies.get(lower)!
      a.reset(); b.reset()
      if (a.size === 0 || b.size === 0) continue
      while (a.size > 0 && b.size > 0) {
        if (a.first > b.first) { upperLower += a.size; b.removeFirst() }
        else if (b.first > a.first) { lowerUpper += b.size; a.removeFirst() }
        else { upperLower += a.countAdjacenciesBelowNodeOfFirstPort(); lowerUpper += b.countAdjacenciesBelowNodeOfFirstPort(); a.removeFirst(); b.removeFirst() }
      }
    }
    return [upperLower, lowerUpper]
  }
}

class GreedyPortDistributor {
  private counter: CrossingsCounter
  constructor(order: Order) {
    const positions = new Map<Port, number>()
    for (const layer of order) for (const node of layer) for (const port of node.ports) positions.set(port, 0)
    this.counter = new CrossingsCounter(positions)
  }
  distributePortsWhileSweeping(order: Order, current: number, forward: boolean): boolean {
    if (forward && current > 0) this.counter.initForCountingBetween(order[current - 1]!, order[current]!)
    else if (!forward && current < order.length - 1) this.counter.initForCountingBetween(order[current]!, order[current + 1]!)
    else this.counter.initPortPositionsForInLayerCrossings(order[current]!, forward ? 'WEST' : 'EAST')
    const side = forward ? 'WEST' : 'EAST'
    let improved = false
    for (const node of order[current]!) {
      if (isOrderFixed(node)) continue
      const ports = topDownPorts(node, side)
      let continueSwitching: boolean
      do {
        continueSwitching = false
        for (let i = 0; i + 1 < ports.length; i++) {
          const upper = ports[i]!, lower = ports[i + 1]!
          let [original, switched] = this.counter.countCrossingsBetweenPortsInBothOrders(upper, lower)
          if (node.nestedGraph !== undefined && upper.portDummy !== undefined && lower.portDummy !== undefined) {
            const inner = node.nestedGraph.layers!, index = forward ? 0 : inner.length - 1
            const pair = new BetweenLayerEdgeTwoNodeCrossingsCounter(inner, index).countBothSideCrossings(upper.portDummy, lower.portDummy)
            original += pair[0]; switched += pair[1]
          }
          if (original > switched) {
            this.counter.switchPorts(upper, lower)
            const a = node.ports.indexOf(upper), b = node.ports.indexOf(lower)
            node.ports[a] = lower; node.ports[b] = upper
            ports[i] = lower; ports[i + 1] = upper
            improved = true; continueSwitching = true
          }
        }
      } while (continueSwitching)
    }
    return improved
  }
}

/** NorthSouthEdgeNeighbouringNodeCrossingsCounter. */
class NorthSouthNeighbourCounter {
  private positions = new Map<Port, number>()
  constructor(layer: Node[]) {
    for (const node of layer) for (const side of ['SOUTH', 'NORTH'] as const) {
      let index = 0
      for (const port of topDownPorts(node, side)) this.positions.set(port, index++)
    }
  }
  count(upper: Node, lower: Node): [number, number] {
    let upperLower = 0, lowerUpper = 0
    const isNorth = (node: Node): boolean => node.ports[0]!.originPort!.side === 'NORTH'
    if (upper.type === 'NORTH_SOUTH_PORT' && lower.type === 'NORTH_SOUTH_PORT' && upper.northSouthOrigin === lower.northSouthOrigin) {
      const further = isNorth(upper) ? upper : lower, closer = isNorth(upper) ? lower : upper
      let a: Port | undefined, b: Port | undefined
      if (this.positions.get(further.ports[0]!.originPort!)! > this.positions.get(closer.ports[0]!.originPort!)!) { a = portsOnSide(closer, 'EAST')[0]; b = portsOnSide(further, 'WEST')[0] }
      else { a = portsOnSide(closer, 'WEST')[0]; b = portsOnSide(further, 'EAST')[0] }
      upperLower = a === undefined ? 0 : a.incoming.length + a.outgoing.length
      lowerUpper = b === undefined ? 0 : b.incoming.length + b.outgoing.length
    }
    if (upper.type === 'NORTH_SOUTH_PORT' && lower.type === 'LONG_EDGE') { if (isNorth(upper)) upperLower = 1; else lowerUpper = 1 }
    else if (lower.type === 'NORTH_SOUTH_PORT' && upper.type === 'LONG_EDGE') { if (isNorth(lower)) lowerUpper = 1; else upperLower = 1 }
    const edges = (node: Node, side: Side): number => portsOnSide(node, side).filter(port => port.portDummy !== undefined).length
    if (upper.type === 'NORMAL' && lower.type === 'LONG_EDGE') { upperLower = edges(upper, 'SOUTH'); lowerUpper = edges(upper, 'NORTH') }
    if (lower.type === 'NORMAL' && upper.type === 'LONG_EDGE') { upperLower = edges(lower, 'NORTH'); lowerUpper = edges(lower, 'SOUTH') }
    return [upperLower, lowerUpper]
  }
}

class GreedySwitchHeuristic {
  private left: CrossingsCounter
  private right: CrossingsCounter
  private matrix = new Map<Node, Map<Node, number>>()
  private between!: BetweenLayerEdgeTwoNodeCrossingsCounter
  private parentCounter?: CrossingsCounter
  private northSouth!: NorthSouthNeighbourCounter
  constructor(order: Order, private hierarchy?: { parent: Node; parentOrder: Order; parentPositions: Map<Port, number>; bottomUp: boolean }) {
    const positions = new Map<Port, number>()
    for (const layer of order) for (const node of layer) for (const port of node.ports) positions.set(port, 0)
    this.left = new CrossingsCounter(positions); this.right = new CrossingsCounter(positions)
  }
  private setUp(order: Order, free: number): void {
    this.matrix = new Map()
    this.northSouth = new NorthSouthNeighbourCounter(order[free]!)
    this.between = new BetweenLayerEdgeTwoNodeCrossingsCounter(order, free)
    this.left.initPortPositionsForInLayerCrossings(order[free]!, 'WEST')
    this.right.initPortPositionsForInLayerCrossings(order[free]!, 'EAST')
    this.parentCounter = undefined
    if (this.hierarchy !== undefined && !this.hierarchy.bottomUp && order[free]![0]!.type === 'EXTERNAL_PORT') {
      const { parent, parentOrder, parentPositions } = this.hierarchy, index = parent.rank
      const previous = parentOrder[index - 1] ?? [], current = parentOrder[index]!, next = parentOrder[index + 1] ?? []
      this.parentCounter = new CrossingsCounter(parentPositions)
      if (free === order.length - 1) this.parentCounter.initForCountingBetween(current, next)
      else this.parentCounter.initForCountingBetween(previous, current)
    }
  }
  private haveLayoutUnitConstraints(upper: Node, lower: Node): boolean {
    const different = upper.inLayerLayoutUnit !== lower.inLayerLayoutUnit
    const multi = (upper.inLayerLayoutUnit !== undefined && upper.inLayerLayoutUnit !== upper) || (lower.inLayerLayoutUnit !== undefined && lower.inLayerLayoutUnit !== lower)
    const hasEdges = (node: Node, side: Side): boolean => portsOnSide(node, side).some(port => port.portDummy !== undefined || port.incoming.length + port.outgoing.length > 0)
    const layoutUnit = ((multi || hasEdges(upper, 'SOUTH') || hasEdges(lower, 'NORTH')) && different) || hasEdges(upper, 'NORTH') || hasEdges(lower, 'SOUTH')
    return upper.type !== 'LONG_EDGE' && lower.type !== 'LONG_EDGE' && layoutUnit
  }
  private switchIfImproves(layer: Node[], upperIndex: number): boolean {
    const upper = layer[upperIndex]!, lower = layer[upperIndex + 1]!
    if ((upper.inLayerSuccessors ?? []).includes(lower) || this.haveLayoutUnitConstraints(upper, lower) || upper.type === 'NORMAL' && lower.type === 'NORTH_SOUTH_PORT' || lower.type === 'NORMAL' && upper.type === 'NORTH_SOUTH_PORT') return false
    const left = this.left.countInLayerCrossingsBetweenNodesInBothOrders(upper, lower, 'WEST')
    const right = this.right.countInLayerCrossingsBetweenNodesInBothOrders(upper, lower, 'EAST')
    let upperLower = this.matrix.get(upper)?.get(lower), lowerUpper = this.matrix.get(lower)?.get(upper)
    if (upperLower === undefined) {
      ;[upperLower, lowerUpper] = this.between.countBothSideCrossings(upper, lower)
      const a = this.matrix.get(upper) ?? new Map<Node, number>(), b = this.matrix.get(lower) ?? new Map<Node, number>()
      a.set(lower, upperLower); b.set(upper, lowerUpper)
      this.matrix.set(upper, a); this.matrix.set(lower, b)
    }
    const northSouth = this.northSouth.count(upper, lower)
    const parent = this.parentCounter?.countCrossingsBetweenPortsInBothOrders(upper.originPort!, lower.originPort!) ?? [0, 0]
    if (upperLower + left[0] + right[0] + northSouth[0] + parent[0]! > lowerUpper! + left[1] + right[1] + northSouth[1] + parent[1]!) {
      this.left.switchNodes(upper, lower, 'WEST'); this.right.switchNodes(upper, lower, 'EAST')
      this.parentCounter?.switchPorts(upper.originPort!, lower.originPort!)
      layer[upperIndex] = lower; layer[upperIndex + 1] = upper
      return true
    }
    return false
  }
  private sweepDownwardInLayer(layer: Node[]): boolean {
    let improved = false
    for (let upper = 0; upper + 1 < layer.length; upper++) improved = this.switchIfImproves(layer, upper) || improved
    return improved
  }
  setFirstLayerOrder(order: Order, forward: boolean): boolean {
    const free = forward ? 0 : order.length - 1
    this.setUp(order, free)
    return this.sweepDownwardInLayer(order[free]!)
  }
  minimizeCrossings(order: Order, free: number): boolean {
    this.setUp(order, free)
    let improved = false, continueSwitching: boolean
    do { continueSwitching = this.sweepDownwardInLayer(order[free]!); improved ||= continueSwitching } while (continueSwitching)
    return improved
  }
}

/** SortByInputModelProcessor at its separate, pre-crossing hierarchy slot. */
export function prepareCrossingModelOrder(graph: LayoutGraph): void {
  if (graph.layers === undefined || graph.phaseOptions === undefined) throw new Error('Crossing model order requires prepared graph layers and phase options.')
  const context = new ModelOrderContext(graph.phaseOptions, graph.layers, graph.maxModelOrderNodes)
  if (context.strategy !== 'NONE') sortByInputModel(graph.layers, context)
}

type HierarchicalCrossMinType = 'BARYCENTER' | 'TWO_SIDED_GREEDY_SWITCH'
interface CrossingHeuristic {
  setFirstLayerOrder(order: Order, forward: boolean): boolean
  minimizeCrossings(order: Order, free: number, forward: boolean, first: boolean): boolean
}
interface NodeInfluence { connected: number; hierarchical: number; random: number }

/** GraphInfoHolder and LayerSweepTypeDecider use one record per active LGraph. */
class GraphInfoHolder {
  readonly order: Order
  readonly options: Options
  readonly random: Random
  readonly parent?: Node
  readonly children: LayoutGraph[] = []
  readonly counter: AllCrossingsCounter
  readonly distributor: BarycenterPortDistributor | GreedyPortDistributor
  readonly heuristic: CrossingHeuristic
  readonly context: ModelOrderContext
  readonly positions = new Map<Port, number>()
  readonly bottomUp: boolean
  initialOrder = false
  currentBest: SweepCopy | null = null
  best: SweepCopy | null = null
  constructor(readonly graph: LayoutGraph, readonly type: HierarchicalCrossMinType, readonly parentRecord: GraphInfoHolder | undefined) {
    if (graph.layers === undefined || graph.phaseOptions === undefined || graph.random === undefined) throw new Error('Hierarchical crossing requires prepared graph layers, phase options, and random streams.')
    this.order = graph.layers.map(layer => layer.slice())
    this.options = graph.phaseOptions; this.random = graph.random; this.parent = graph.parentNode
    this.counter = new AllCrossingsCounter(this.order)
    this.distributor = type === 'BARYCENTER' ? new BarycenterPortDistributor(this.order, this.random.nextBoolean()) : new GreedyPortDistributor(this.order)
    // LayerSweepTypeDecider.initAtLayerLevel reads the first node even when
    // an empty child layer will later be skipped by bottom-up processing.
    if (this.order.some(layer => layer.length === 0)) throw new TypeError("Cannot read properties of undefined (reading 'layer')")
    this.context = new ModelOrderContext(this.options, graph.layers, graph.maxModelOrderNodes)
    for (const layer of this.order) for (const node of layer) {
      if (node.nestedGraph !== undefined) this.children.push(node.nestedGraph)
      for (const port of node.ports) this.positions.set(port, 0)
    }
    if (type === 'BARYCENTER') {
      this.heuristic = new BarycenterHeuristic(new ForsterConstraintResolver(this.order), this.random, this.distributor as BarycenterPortDistributor, booleanOption(this.options, 'layered.crossingMinimization.forceNodeModelOrder', false) ? this.context : undefined)
      this.bottomUp = this.useBottomUp()
    } else {
      this.bottomUp = this.useBottomUp()
      this.heuristic = new GreedySwitchHeuristic(this.order, this.parent === undefined ? undefined : { parent: this.parent, parentOrder: parentRecord!.order, parentPositions: parentRecord!.positions, bottomUp: this.bottomUp })
    }
  }
  getBestSweep(): SweepCopy | null { return this.type === 'BARYCENTER' ? this.best : this.currentBest }
  private useBottomUp(): boolean {
    const boundary = numberOption(this.options, 'layered.crossingMinimization.hierarchicalSweepiness', 0.1), parent = this.parent
    if (boundary < -1 || parent === undefined || isOrderFixed(parent) || portsOnSide(parent, 'EAST').length < 2 && portsOnSide(parent, 'WEST').length < 2) return true
    if (this.type !== 'BARYCENTER') return false
    const info = new Map<Node, NodeInfluence>()
    for (const layer of this.order) for (const node of layer) info.set(node, { connected: 0, hierarchical: 0, random: 0 })
    let randomPaths = 0, hierarchicalPaths = 0
    const transfer = (current: NodeInfluence, target: Node): void => {
      const next = info.get(target)!
      next.hierarchical += current.hierarchical; next.random += current.random; next.connected += current.connected; next.connected++
    }
    const outgoing = (node: Node, current: NodeInfluence): void => {
      for (const port of node.ports) for (const edge of port.outgoing) { randomPaths += current.random; hierarchicalPaths += current.hierarchical; transfer(current, edge.target.node) }
    }
    for (const layer of this.order) {
      const northSouth: Node[] = []
      for (const node of layer) {
        if (node.type === 'NORTH_SOUTH_PORT') { northSouth.push(node); continue }
        const current = info.get(node)!
        if (node.type === 'EXTERNAL_PORT') { current.hierarchical = 1; if (node.originPort!.side === 'EAST') hierarchicalPaths += current.connected }
        else if (!portsOnSide(node, 'WEST').some(port => port.incoming.length + port.outgoing.length > 0)) current.random = 1
        else if (!portsOnSide(node, 'EAST').some(port => port.incoming.length + port.outgoing.length > 0)) randomPaths += current.connected
        outgoing(node, current)
        for (const port of portsOnSide(node, 'NORTH').concat(portsOnSide(node, 'SOUTH'))) if (port.portDummy !== undefined) {
          randomPaths += current.random; hierarchicalPaths += current.hierarchical; transfer(current, port.portDummy)
        }
      }
      for (const node of northSouth) outgoing(node, info.get(node)!)
    }
    const all = randomPaths + hierarchicalPaths
    return (all === 0 ? Number.POSITIVE_INFINITY : (randomPaths - hierarchicalPaths) / all) >= boundary
  }
}

/** The shared LayerSweepCrossingMinimizer controller, preserving its root RNG. */
class HierarchicalLayerSweep {
  private records: GraphInfoHolder[] = []
  private byGraph = new Map<LayoutGraph, GraphInfoHolder>()
  private changed = new Set<GraphInfoHolder>()
  private random: Random
  private seed: bigint
  constructor(root: LayoutGraph, private type: HierarchicalCrossMinType) {
    if (root.random === undefined) throw new Error('Hierarchical crossing requires a prepared root random stream.')
    this.random = root.random; this.seed = this.random.nextLong()
    const graphs = [root]
    for (let i = 0; i < graphs.length; i++) {
      const graph = graphs[i]!, parent = graph.parentNode?.layoutGraph
      const record = new GraphInfoHolder(graph, type, parent === undefined ? undefined : this.byGraph.get(parent))
      this.records.push(record); this.byGraph.set(graph, record); graphs.push(...record.children)
    }
  }
  process(): void {
    const sweepOn: GraphInfoHolder[] = []
    for (const record of this.records) if (record.bottomUp) sweepOn.push(record)
    sweepOn.reverse()
    for (const record of sweepOn) if (record.order.length > 0) {
      if (this.type === 'BARYCENTER') this.compareRandomizedLayouts(record)
      else this.minimizeWithoutCounter(record)
      const best = record.getBestSweep()
      if (record.parent !== undefined && record.graph.hasExternalPorts === true && best !== null) {
        this.sortParentPorts(best.lastLayer, record.parent, true); this.sortParentPorts(best.firstLayer, record.parent, false)
        record.parent.portConstraints = 'FIXED_ORDER'
      }
    }
    for (const record of this.records) record.getBestSweep()?.transfer(record.graph.layers!)
  }
  private setCurrentBest(): void { for (const record of this.changed) record.currentBest = new SweepCopy(record.order) }
  private saveChangedGraphs(): void { for (const record of this.changed) record.best = new SweepCopy(record.currentBest!) }
  private count(record: GraphInfoHolder, modelOrder: boolean): number {
    let influence = 0
    if (modelOrder && record.context.strategy !== 'NONE') {
      influence += numberOption(record.options, 'layered.considerModelOrder.crossingCounterNodeInfluence', 0) * countModelOrderNodeChanges(record.order, record.context)
      influence += numberOption(record.options, 'layered.considerModelOrder.crossingCounterPortInfluence', 0) * countModelOrderPortChanges(record.order, record.context)
    }
    let result = 0
    result += record.counter.countAllCrossings(record.order) + influence
    for (const graph of record.children) { const child = this.byGraph.get(graph)!; if (!child.bottomUp) result += this.count(child, false) }
    return result
  }
  private compareRandomizedLayouts(record: GraphInfoHolder): void {
    this.random.setSeed(this.seed); this.changed.clear()
    const withModelOrder = numberOption(record.options, 'layered.considerModelOrder.crossingCounterNodeInfluence', 0) !== 0
    let bestCrossings = withModelOrder ? Number.MAX_VALUE : 2147483647
    record.initialOrder = record.context.strategy !== 'NONE'
    for (let i = 0; i < integerOption(record.options, 'layered.thoroughness', 7); i++) {
      const result = this.minimizeWithCounter(record, record.initialOrder, withModelOrder)
      record.initialOrder = result.initial
      if (result.crossings < bestCrossings) {
        bestCrossings = result.crossings; this.saveChangedGraphs()
        if (bestCrossings === 0) break
      }
    }
  }
  private minimizeWithCounter(record: GraphInfoHolder, initial: boolean, withModelOrder: boolean): { crossings: number; initial: boolean } {
    let forward = this.random.nextBoolean()
    const firstCrossings = this.count(record, withModelOrder)
    if (firstCrossings === 0 && initial) return { crossings: 0, initial }
    if (!initial || record.context.strategy === 'NONE') record.heuristic.setFirstLayerOrder(record.order, forward)
    else forward = initial
    this.sweep(record, forward, true, initial)
    // FIRST_TRY and SECOND_TRY alias the same GWT property ID.
    initial = false
    let crossings = this.count(record, withModelOrder), previous: number
    do {
      this.setCurrentBest()
      if (crossings === 0) return { crossings: 0, initial }
      forward = !forward; previous = crossings
      this.sweep(record, forward, false, initial)
      crossings = this.count(record, withModelOrder)
    } while (previous > crossings)
    return { crossings: previous, initial }
  }
  private minimizeWithoutCounter(record: GraphInfoHolder): void {
    let forward = this.random.nextBoolean(), improved = true
    while (improved) {
      improved = record.heuristic.setFirstLayerOrder(record.order, forward)
      improved = this.sweep(record, forward, false, false) || improved
      forward = !forward
    }
    this.setCurrentBest()
  }
  private sweep(record: GraphInfoHolder, forward: boolean, first: boolean, initial: boolean): boolean {
    const order = record.order, start = forward ? 0 : order.length - 1
    let improved = record.distributor.distributePortsWhileSweeping(order, start, forward)
    improved = this.sweepChildren(order[start]!, forward, first) || improved
    for (let i = forward ? 1 : order.length - 2; forward ? i < order.length : i >= 0; i += forward ? 1 : -1) {
      improved = record.heuristic.minimizeCrossings(order, i, forward, first && !initial) || improved
      improved = record.distributor.distributePortsWhileSweeping(order, i, forward) || improved
      improved = this.sweepChildren(order[i]!, forward, first) || improved
    }
    this.changed.add(record)
    return improved
  }
  private sweepChildren(layer: Node[], forward: boolean, first: boolean): boolean {
    let improved = false
    for (const node of layer) if (node.nestedGraph !== undefined) {
      const record = this.byGraph.get(node.nestedGraph)!
      if (record.bottomUp) continue
      const start = forward ? 0 : record.order.length - 1, nodes = record.order[start]!
      if (nodes[0]!.type === 'EXTERNAL_PORT') {
        const ports = topDownPorts(node, forward ? 'WEST' : 'EAST').filter(port => port.insideConnections === true)
        if (ports.length < nodes.length) throw new Error('Expected ' + nodes.length + ' hierarchical ports, but found only ' + ports.length + '.')
        if (ports.length > nodes.length) throw new RangeError('Hierarchical port dummy index exceeds the first layer length.')
        record.order[start] = ports.map(port => port.portDummy!)
      } else record.heuristic.setFirstLayerOrder(record.order, forward)
      // Nested graphs read their own FIRST/SECOND_TRY property; the root's
      // initial-order flag is not propagated down the inclusion tree.
      improved = this.sweep(record, forward, first, record.initialOrder) || improved
      this.sortParentPorts(record.order[forward ? record.order.length - 1 : 0]!, record.parent!, forward)
    }
    return improved
  }
  private sortParentPorts(layer: readonly Node[], parent: Node, rightmost: boolean): void {
    let index = rightmost ? 0 : layer.length - 1
    if (layer[index]!.type !== 'EXTERNAL_PORT') return
    for (let i = 0; i < parent.ports.length; i++) {
      const port = parent.ports[i]!
      if (port.side === (rightmost ? 'EAST' : 'WEST') && port.insideConnections === true) {
        parent.ports[i] = layer[index]!.originPort!
        index += rightmost ? 1 : -1
      }
    }
  }
}

/** Coupled crossing for a prepared hierarchy; model sorting is a prior slot. */
export function minimizeHierarchicalCrossings(root: LayoutGraph): void {
  if (root.layers === undefined || root.phaseOptions === undefined || root.random === undefined) throw new Error('Hierarchical crossing requires prepared root layers, phase options, and random stream.')
  const layers = root.layers, options = root.phaseOptions
  if (layers.length === 0 || layers.every(layer => layer.length === 0)) return
  const hierarchical = enumOption(options, 'hierarchyHandling', ['INHERIT', 'SEPARATE_CHILDREN', 'INCLUDE_CHILDREN'] as const, 'INHERIT') === 'INCLUDE_CHILDREN'
  if (layers.length === 1 && layers[0]!.length === 1 && !hierarchical) return
  const pending = [root]
  for (let i = 0; i < pending.length; i++) {
    const graph = pending[i]!
    if (graph.layers === undefined || graph.phaseOptions === undefined || graph.random === undefined) throw new Error('Hierarchical crossing requires prepared child layers, phase options, and random streams.')
    if (enumOption(graph.phaseOptions, 'layered.crossingMinimization.strategy', ['LAYER_SWEEP', 'MEDIAN_LAYER_SWEEP', 'INTERACTIVE', 'NONE'] as const, 'LAYER_SWEEP') !== 'LAYER_SWEEP' || booleanOption(graph.phaseOptions, 'layered.crossingMinimization.semiInteractive', false)) throw new Error('ELK TypeScript port: this crossing-minimization strategy is not implemented yet')
    for (const layer of graph.layers) for (const node of layer) {
      if (!['NORMAL', 'LONG_EDGE', 'LABEL', 'EXTERNAL_PORT', 'NORTH_SOUTH_PORT'].includes(node.type)) throw new Error('ELK TypeScript port: north/south crossing references are not implemented yet')
      if (node.nestedGraph !== undefined) pending.push(node.nestedGraph)
    }
  }
  new HierarchicalLayerSweep(root, 'BARYCENTER').process()
}

/** The later hierarchy-aware greedy processor has its own dispatch barrier. */
export function minimizeHierarchicalGreedySwitch(root: LayoutGraph): void {
  if (root.layers === undefined || root.phaseOptions === undefined || root.random === undefined) throw new Error('Hierarchical greedy switch requires prepared root layers, phase options, and random stream.')
  const layers = root.layers, options = root.phaseOptions
  const hierarchical = enumOption(options, 'hierarchyHandling', ['INHERIT', 'SEPARATE_CHILDREN', 'INCLUDE_CHILDREN'] as const, 'INHERIT') === 'INCLUDE_CHILDREN'
  if (layers.length === 0 || layers.every(layer => layer.length === 0) || layers.length === 1 && layers[0]!.length === 1 && !hierarchical) return
  const greedy = hierarchical ? enumOption(options, 'layered.crossingMinimization.greedySwitchHierarchical.type', ['ONE_SIDED', 'TWO_SIDED', 'OFF'] as const, 'OFF') : enumOption(options, 'layered.crossingMinimization.greedySwitch.type', ['ONE_SIDED', 'TWO_SIDED', 'OFF'] as const, 'TWO_SIDED')
  const threshold = integerOption(options, 'layered.crossingMinimization.greedySwitch.activationThreshold', 40)
  if (greedy === 'OFF' || !hierarchical && threshold !== 0 && threshold <= root.nodes.filter(node => !node.noLayout).length) return
  if (greedy !== 'TWO_SIDED') throw new Error('ELK TypeScript port: one-sided greedy switch is not implemented yet')
  new HierarchicalLayerSweep(root, 'TWO_SIDED_GREEDY_SWITCH').process()
}

type SavedSweepRow =
  | readonly Node[]
  | { readonly runs: readonly (Node | number)[] }

// These ordinary split dummies never enter the hierarchical parent-port sorter,
// and both port distributors leave FIXED_POS untouched. Capturing any other
// port order still requires its own snapshot.
function canonicalLongEdgePorts(node: Node): boolean {
  return node.type === 'LONG_EDGE' && node.layoutGraph === undefined &&
    node.portConstraints === 'FIXED_POS' && node.ports.length === 2 &&
    node.ports[0]!.side === 'EAST' && node.ports[1]!.side === 'WEST'
}

// The splitter creates one outgoing segment per ordinary long-edge dummy.
// The inverted-port processor also uses LONG_EDGE but attaches its layoutGraph.
// During crossing minimization, ordinary dummy endpoints and ranks stay fixed.
function longEdgeContinuations(previous: readonly Node[]): () => Node | undefined {
  let index = 0
  return () => {
    while (index < previous.length) {
      const node = previous[index++]!
      if (node.type !== 'LONG_EDGE' || node.layoutGraph !== undefined || node.ports.length !== 2) continue
      const first = node.ports[0]!, east = first.side === 'EAST' ? first : node.ports[1]!
      if (east.side !== 'EAST' || east.outgoing.length !== 1) continue
      const target = east.outgoing[0]!.target.node
      if (target.type === 'LONG_EDGE' && target.layoutGraph === undefined && target.rank === node.rank + 1) return target
    }
    return undefined
  }
}

// Store consecutive matching inner segments as a length. ELK decides the
// order, including every random draw. A reordered continuation retains the
// complete row. Endpoint and label nodes always retain their own identities.
function saveSweepRow(layer: readonly Node[], previous: readonly Node[]): SavedSweepRow {
  if (layer.length > 1) {
    const take = longEdgeContinuations(previous)
    let next = take()
    if (next !== undefined) {
      const runs: (Node | number)[] = []
      let length = 0
      for (const node of layer) {
        if (node === next) {
          length++
          next = take()
        } else {
          if (length > 0) { runs.push(length); length = 0 }
          runs.push(node)
        }
      }
      if (length > 0) runs.push(length)
      if (next === undefined && runs.length < layer.length) return { runs }
    }
  }
  return layer.slice()
}

class SweepCopy {
  readonly firstLayer: readonly Node[]
  readonly lastLayer: readonly Node[]
  private readonly rows: readonly SavedSweepRow[]
  private ports = new Map<Node, Port[]>()
  constructor(order: Order | SweepCopy) {
    if (order instanceof SweepCopy) {
      this.firstLayer = order.firstLayer; this.lastLayer = order.lastLayer
      this.rows = order.rows
      this.ports = new Map(order.ports)
    } else {
      this.firstLayer = order[0]?.slice() ?? []
      this.lastLayer = order.length > 1 ? order[order.length - 1]!.slice() : this.firstLayer
      this.rows = order.map((layer, index) => {
        if (index === 0) return this.firstLayer
        if (index + 1 === order.length) return this.lastLayer
        if (layer.length <= 1) return layer.slice()
        return saveSweepRow(layer, order[index - 1]!)
      })
      for (const layer of order) for (const node of layer) if (!canonicalLongEdgePorts(node)) this.ports.set(node, node.ports.slice())
    }
  }
  transfer(order: Order): void {
    const update = new Set<Node>()
    for (let l = 0; l < order.length; l++) {
      const layer = order[l]!, saved = this.rows[l]!, northSouth: Node[] = []
      if ('runs' in saved) {
        const take = longEdgeContinuations(order[l - 1]!)
        let write = 0
        for (const item of saved.runs) {
          if (typeof item === 'number') for (let count = 0; count < item; count++) layer[write++] = take()!
          else layer[write++] = item
        }
      }
      const nodes = 'runs' in saved ? layer : saved
      for (let i = 0; i < layer.length; i++) {
        const node = nodes[i]!
        if (node.type === 'NORTH_SOUTH_PORT') northSouth.push(node)
        layer[i] = node
        const ports = this.ports.get(node)
        if (ports !== undefined) {
          node.ports.length = 0
          for (const port of ports) node.ports.push(port)
        } else {
          const first = node.ports[0]!, second = node.ports[1]!
          node.ports.length = 0
          if (first.side === 'EAST') node.ports.push(first, second)
          else node.ports.push(second, first)
        }
        if (!isOrderFixed(node)) node.portConstraints = 'FIXED_ORDER'
      }
      if (northSouth.length === 0) continue
      const positions = new Map<Node, number>()
      for (let i = 0; i < layer.length; i++) positions.set(layer[i]!, i)
      for (const dummy of northSouth) {
        const origin = dummy.inLayerLayoutUnit!, port = origin.ports.find(port => port === dummy.ports[0]!.originPort)
        if (port !== undefined) {
          if (port.side === 'NORTH' && positions.get(dummy)! > positions.get(origin)!) { port.side = 'SOUTH'; if (port.explicitAnchor) port.anchorY = port.height - port.anchorY }
          else if (port.side === 'SOUTH' && positions.get(origin)! > positions.get(dummy)!) { port.side = 'NORTH'; if (port.explicitAnchor) port.anchorY = -(port.height - port.anchorY) }
        }
        update.add(origin); update.add(dummy)
      }
    }
    for (const node of update) sortPortLists([node], new Map())
  }
}

function countModelOrderNodeChanges(order: Order, context: ModelOrderContext): number {
  let wrong = 0
  for (let l = 0; l < order.length; l++) {
    const comparator = new ModelOrderNodeComparator(context, order[l === 0 ? 0 : l - 1]!, 'EQUAL', false)
    const layer = order[l]!
    for (let i = 0; i < layer.length; i++) for (let j = i + 1; j < layer.length; j++) {
      if (layer[i]!.modelOrder !== undefined && layer[j]!.modelOrder !== undefined && comparator.compare(layer[i]!, layer[j]!) > 0) wrong++
    }
  }
  return wrong
}
function countModelOrderPortChanges(order: Order, context: ModelOrderContext): number {
  let wrong = 0
  for (let l = 0; l < order.length; l++) for (const node of order[l]!) {
    const comparator = new ModelOrderPortComparator(context, order[l === 0 ? 0 : l - 1]!, longEdgeTargetNodePreprocessing(node), context.portModelOrder)
    for (let i = 0; i < node.ports.length; i++) for (let j = i + 1; j < node.ports.length; j++) if (comparator.compare(node.ports[i]!, node.ports[j]!) > 0) wrong++
  }
  return wrong
}

/**
 * SortByInputModelProcessor, flat LayerSweepCrossingMinimizer with BARYCENTER
 * or ModelOrderBarycenterHeuristic, and configured TWO_SIDED_GREEDY_SWITCH,
 * from ELK v0.11.0 at the source pin above. Nested graphs and north/south dummy
 * references are supplied by separate source processors.
 */
export function minimizeCrossings(layers: Order, options: Options, random: Random, originalGraphNodeCount?: number, maxModelOrderNodes?: number, modelOrderPrepared = false): void {
  if (layers.length === 0 || layers.every(layer => layer.length === 0)) return
  if (enumOption(options, 'layered.crossingMinimization.strategy', ['LAYER_SWEEP', 'MEDIAN_LAYER_SWEEP', 'INTERACTIVE', 'NONE'] as const, 'LAYER_SWEEP') !== 'LAYER_SWEEP'
    || booleanOption(options, 'layered.crossingMinimization.semiInteractive', false)) throw new Error('ELK TypeScript port: this crossing-minimization strategy is not implemented yet')
  for (const layer of layers) for (const node of layer) {
    if (!['NORMAL', 'LONG_EDGE', 'LABEL', 'EXTERNAL_PORT', 'NORTH_SOUTH_PORT'].includes(node.type) || node.nestedGraph !== undefined) throw new Error('ELK TypeScript port: hierarchical and north/south crossing references are not implemented yet')
  }
  const context = new ModelOrderContext(options, layers, maxModelOrderNodes ?? layers.reduce((sum, layer) => sum + layer.filter(node => node.modelOrder !== undefined).length, 0))
  if (!modelOrderPrepared && context.strategy !== 'NONE') sortByInputModel(layers, context)
  const hierarchical = enumOption(options, 'hierarchyHandling', ['INHERIT', 'SEPARATE_CHILDREN', 'INCLUDE_CHILDREN'] as const, 'INHERIT') === 'INCLUDE_CHILDREN'
  if (layers.length === 1 && layers[0]!.length === 1 && !hierarchical) return
  const current = layers.map(layer => layer.slice())
  const seed = random.nextLong()
  const distributor = new BarycenterPortDistributor(current, random.nextBoolean())
  const heuristic = new BarycenterHeuristic(new ForsterConstraintResolver(current), random, distributor, booleanOption(options, 'layered.crossingMinimization.forceNodeModelOrder', false) ? context : undefined)
  const counter = new AllCrossingsCounter(current)
  random.setSeed(seed)
  let currentBest: SweepCopy | null = null, best: SweepCopy | null = null
  const nodeInfluence = numberOption(options, 'layered.considerModelOrder.crossingCounterNodeInfluence', 0)
  const portInfluence = numberOption(options, 'layered.considerModelOrder.crossingCounterPortInfluence', 0)
  // Both terms of the source's branch condition check node influence.
  const withModelOrderCounter = nodeInfluence !== 0
  let bestCrossings = withModelOrderCounter ? Number.MAX_VALUE : 2147483647
  // FIRST_TRY and SECOND_TRY have the same source property ID, hence alias.
  let tryWithInitialOrder = context.strategy !== 'NONE'
  const count = (): number => {
    let influence = 0
    if (withModelOrderCounter && context.strategy !== 'NONE') {
      influence += nodeInfluence * countModelOrderNodeChanges(current, context)
      influence += portInfluence * countModelOrderPortChanges(current, context)
    }
    return counter.countAllCrossings(current) + influence
  }
  const sweep = (forward: boolean, first: boolean): void => {
    distributor.distributePortsWhileSweeping(current, forward ? 0 : current.length - 1, forward)
    for (let i = forward ? 1 : current.length - 2; forward ? i < current.length : i >= 0; i += forward ? 1 : -1) {
      heuristic.minimizeCrossings(current, i, forward, first && !tryWithInitialOrder)
      distributor.distributePortsWhileSweeping(current, i, forward)
    }
  }
  for (let trial = 0; trial < integerOption(options, 'layered.thoroughness', 7); trial++) {
    let forward = random.nextBoolean()
    const initialCrossings = count()
    let achieved: number
    if (initialCrossings === 0 && tryWithInitialOrder) achieved = 0
    else {
      if (!tryWithInitialOrder || context.strategy === 'NONE') heuristic.setFirstLayerOrder(current, forward)
      else forward = tryWithInitialOrder
      sweep(forward, true)
      // Clearing SECOND clears FIRST before the source's subsequent FIRST test.
      tryWithInitialOrder = false
      let crossings = count(), oldCrossings: number
      do {
        currentBest = new SweepCopy(current)
        if (crossings === 0) break
        forward = !forward; oldCrossings = crossings
        sweep(forward, false)
        crossings = count()
      } while (oldCrossings! > crossings)
      achieved = crossings === 0 ? 0 : oldCrossings!
    }
    if (achieved < bestCrossings) {
      bestCrossings = achieved; best = currentBest
      if (bestCrossings === 0) break
    }
  }
  if (best !== null) best.transfer(layers)

  const greedyType = hierarchical
    ? enumOption(options, 'layered.crossingMinimization.greedySwitchHierarchical.type', ['ONE_SIDED', 'TWO_SIDED', 'OFF'] as const, 'OFF')
    : enumOption(options, 'layered.crossingMinimization.greedySwitch.type', ['ONE_SIDED', 'TWO_SIDED', 'OFF'] as const, 'TWO_SIDED')
  const threshold = integerOption(options, 'layered.crossingMinimization.greedySwitch.activationThreshold', 40)
  const nodeCount = originalGraphNodeCount ?? layers.reduce((sum, layer) => sum + layer.filter(node => node.type === 'NORMAL').length, 0)
  if (greedyType === 'OFF' || !hierarchical && threshold !== 0 && threshold <= nodeCount) return
  if (greedyType !== 'TWO_SIDED') throw new Error('ELK TypeScript port: one-sided greedy switch is not implemented yet')
  random.nextLong()
  const greedyOrder = layers.map(layer => layer.slice())
  const greedyPorts = new GreedyPortDistributor(greedyOrder)
  const greedy = new GreedySwitchHeuristic(greedyOrder)
  let forward = random.nextBoolean(), improved = true
  while (improved) {
    improved = greedy.setFirstLayerOrder(greedyOrder, forward)
    improved = greedyPorts.distributePortsWhileSweeping(greedyOrder, forward ? 0 : greedyOrder.length - 1, forward) || improved
    for (let i = forward ? 1 : greedyOrder.length - 2; forward ? i < greedyOrder.length : i >= 0; i += forward ? 1 : -1) {
      improved = greedy.minimizeCrossings(greedyOrder, i) || improved
      improved = greedyPorts.distributePortsWhileSweeping(greedyOrder, i, forward) || improved
    }
    forward = !forward
  }
  new SweepCopy(greedyOrder).transfer(layers)
}
