/*******************************************************************************
 * Copyright (c) 2015, 2016, 2017 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
/*
 * Copyright 2008 Google Inc.
 * Copyright (C) 2011 The Guava Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 *
 * GWT 2.11 Arrays sorting and Guava 31.1-jre fuzzy comparisons, translated
 * under EPL-2.0. SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 */
import type { LayoutNode, LayoutPort, LayoutEdge, LayoutNodeType } from './graph.ts'
import { booleanOption, enumOption, numberOption } from './options.ts'
import type { Options } from './options.ts'

type Node = LayoutNode
type Port = LayoutPort
type Edge = LayoutEdge
type Point = { x: number; y: number }
type Rect = Point & { width: number; height: number }
type Direction = 'LEFT' | 'RIGHT'
type Locks = { left: boolean; right: boolean; up: boolean; down: boolean }
const locks = (): Locks => ({ left: false, right: false, up: false, down: false })
const incomingEdges = (node: Node): Edge[] => node.ports.flatMap(port => port.incoming)
const outgoingEdges = (node: Node): Edge[] => node.ports.flatMap(port => port.outgoing)
const connectedEdges = (node: Node): Edge[] => node.ports.flatMap(port => port.incoming.concat(port.outgoing))
const fuzzyEquals = (a: number, b: number): boolean => Math.abs(a - b) <= 0.0001 || a === b || Number.isNaN(a) && Number.isNaN(b)
function fuzzyCompare(a: number, b: number): number { return fuzzyEquals(a, b) ? 0 : a < b ? -1 : a > b ? 1 : Number.isNaN(a) ? 1 : -1 }
function compareNumbers(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  if (a === b) return a === 0 ? compareNumbers(1 / a, 1 / b) : 0
  return Number.isNaN(a) ? Number.isNaN(b) ? 0 : 1 : -1
}

// The fuzzy segment comparator can be nontransitive. Preserve the GWT merge
// and insertion sequence rather than relying on the host engine's sort.
function sortSegments(segments: VerticalSegment[]): void {
  const mergeSort = (temp: VerticalSegment[], array: VerticalSegment[], low: number, high: number, offset: number): void => {
    if (high - low < 7) {
      for (let i = low + 1; i < high; i++) for (let j = i; j > low && array[j - 1]!.compareTo(array[j]!) > 0; j--) {
        const value = array[j]!; array[j] = array[j - 1]!; array[j - 1] = value
      }
      return
    }
    let tempLow = low + offset
    const tempHigh = high + offset, tempMid = tempLow + ((tempHigh - tempLow) >> 1)
    mergeSort(array, temp, tempLow, tempMid, -offset)
    mergeSort(array, temp, tempMid, tempHigh, -offset)
    if (temp[tempMid - 1]!.compareTo(temp[tempMid]!) <= 0) {
      while (low < high) array[low++] = temp[tempLow++]!
      return
    }
    let top = tempMid
    while (low < high) array[low++] = top >= tempHigh || tempLow < tempMid && temp[tempLow]!.compareTo(temp[top]!) <= 0 ? temp[tempLow++]! : temp[top++]!
  }
  mergeSort(segments.slice(), segments, 0, segments.length, 0)
}

interface CNode {
  id: number
  origin: Node | VerticalSegment
  group?: CGroup
  offset: Point
  hitboxPreCompaction: Rect
  hitbox: Rect
  constraints: CNode[]
  startPos: number
}
interface CGroup {
  nodes: CNode[]
  master?: CNode
  reference: CNode
  startPos: number
  incomingConstraints: Set<CNode>
  outDegree: number
  outDegreeReal: number
  delta: number
  deltaNormalized: number
}
interface CGraph { nodes: CNode[]; groups: CGroup[]; predefinedHorizontalConstraints: Array<[CNode, CNode]> }
function addGroupNode(group: CGroup, node: CNode): void {
  if (node.group !== undefined) throw new Error('CNode belongs to another CGroup.')
  if (!group.nodes.includes(node)) group.nodes.push(node)
  node.group = group
}
function createGroup(graph: CGraph, node: CNode, master?: CNode): CGroup {
  const group: CGroup = { nodes: [], master, reference: node, startPos: Number.NEGATIVE_INFINITY, incomingConstraints: new Set(), outDegree: 0, outDegreeReal: 0, delta: 0, deltaNormalized: 0 }
  addGroupNode(group, node); graph.groups.push(group)
  return group
}
function createNode(graph: CGraph, origin: Node | VerticalSegment, hitbox: Rect): CNode {
  const node: CNode = { id: 0, origin, offset: { x: 0, y: 0 }, hitbox, hitboxPreCompaction: { ...hitbox }, constraints: [], startPos: Number.NEGATIVE_INFINITY }
  graph.nodes.push(node)
  return node
}

/** VerticalSegment, ELK v0.11.0, 54123e884b1ae743b453260f713b20c9bf5787f2. */
class VerticalSegment {
  potentialGroupParents: CNode[] = []
  representedLEdges: Edge[] = []
  affectedBends: Point[] = []
  affectedBoundingBoxes: Rect[] = []
  hitbox: Rect
  junctionPoints: Point[] = []
  ignoreSpacing = locks()
  constraints: VerticalSegment[] = []
  aPort?: Port
  joined: VerticalSegment[] = []
  constructor(bend1: Point, bend2: Point, node: CNode | undefined, edge: Edge) {
    this.affectedBends.push(bend1, bend2)
    this.hitbox = { x: Math.min(bend1.x, bend2.x), y: Math.min(bend1.y, bend2.y), width: Math.abs(bend1.x - bend2.x), height: Math.abs(bend1.y - bend2.y) }
    for (const jp of edge.junctions ?? []) if (fuzzyEquals(jp.x, bend1.x)) this.junctionPoints.push(jp)
    if (node !== undefined) this.potentialGroupParents.push(node)
    this.representedLEdges.push(edge)
  }
  joinWith(other: VerticalSegment): VerticalSegment {
    for (const value of other.representedLEdges) this.representedLEdges.push(value)
    for (const value of other.affectedBends) this.affectedBends.push(value)
    for (const value of other.affectedBoundingBoxes) this.affectedBoundingBoxes.push(value)
    for (const value of other.junctionPoints) this.junctionPoints.push(value)
    for (const value of other.constraints) this.constraints.push(value)
    for (const value of other.potentialGroupParents) this.potentialGroupParents.push(value)
    const x = Math.min(this.hitbox.x, other.hitbox.x), y = Math.min(this.hitbox.y, other.hitbox.y)
    const maxX = Math.max(this.hitbox.x + this.hitbox.width, other.hitbox.x + other.hitbox.width)
    const width = maxX - x
    const maxY = Math.max(this.hitbox.y + this.hitbox.height, other.hitbox.y + other.hitbox.height)
    this.hitbox.x = x; this.hitbox.y = y; this.hitbox.width = width; this.hitbox.height = maxY - y
    for (const direction of ['left', 'right', 'up', 'down'] as const) this.ignoreSpacing[direction] ||= other.ignoreSpacing[direction]
    this.aPort ??= other.aPort
    for (const value of other.joined) this.joined.push(value)
    this.joined.push(other)
    return this
  }
  intersects(other: VerticalSegment): boolean {
    return fuzzyEquals(this.hitbox.x, other.hitbox.x) && !(fuzzyCompare(this.hitbox.y + this.hitbox.height, other.hitbox.y) < 0 || fuzzyCompare(other.hitbox.y + other.hitbox.height, this.hitbox.y) < 0)
  }
  compareTo(other: VerticalSegment): number { return fuzzyCompare(this.hitbox.x, other.hitbox.x) || compareNumbers(this.hitbox.y, other.hitbox.y) }
}

class LGraphToCGraphTransformer {
  readonly graph: CGraph = { nodes: [], groups: [], predefinedHorizontalConstraints: [] }
  readonly lockMap = new Map<CNode, Locks>()
  private nodesMap = new Map<Node, CNode>()
  private verticalSegmentsMap = new Map<VerticalSegment, CNode>()
  private commentOffsets = new Map<Node, { anchor: Node; offset: Point }>()
  constructor(private layers: Node[][]) {}
  transform(): CGraph {
    for (const layer of this.layers) for (const node of layer) {
      if (booleanOption(node.options, 'commentBox', false)) {
        const edge = connectedEdges(node)[0]
        if (edge !== undefined) {
          const anchor = edge.source.node === node ? edge.target.node : edge.source.node
          this.commentOffsets.set(node, { anchor, offset: { x: node.x - anchor.x, y: node.y - anchor.y } })
          continue
        }
      }
      const margin = node.margin
      const cNode = createNode(this.graph, node, { x: node.x - margin.left, y: node.y - margin.top, width: node.width + margin.left + margin.right, height: node.height + margin.top + margin.bottom })
      createGroup(this.graph, cNode, cNode)
      const nodeLock = locks(), difference = incomingEdges(node).length - outgoingEdges(node).length
      if (difference < 0) nodeLock.left = true
      else if (difference > 0) nodeLock.right = true
      if (node.type === 'EXTERNAL_PORT') { nodeLock.left = false; nodeLock.right = false; nodeLock.up = false; nodeLock.down = false }
      this.lockMap.set(cNode, nodeLock); this.nodesMap.set(node, cNode)
    }
    const segments = this.collectVerticalSegmentsOrthogonal()
    this.mergeVerticalSegments(segments)
    for (const [segment, node] of this.verticalSegmentsMap) for (const other of segment.constraints) this.graph.predefinedHorizontalConstraints.push([node, this.verticalSegmentsMap.get(other)!])
    return this.graph
  }
  private collectVerticalSegmentsOrthogonal(): VerticalSegment[] {
    const segments: VerticalSegment[] = []
    for (const layer of this.layers) for (const node of layer) {
      const cNode = this.nodesMap.get(node)!
      for (const edge of outgoingEdges(node)) {
        const bends = edge.bends
        let first = true, lastSegment: VerticalSegment | undefined
        if (bends.length > 0) {
          let index = 1, bend1 = bends[0]!
          if (edge.source.side === 'NORTH') {
            const segment = new VerticalSegment(bend1, { x: bend1.x, y: cNode.hitbox.y }, cNode, edge)
            segment.ignoreSpacing.down = true; segment.aPort = edge.source; segments.push(segment)
          }
          if (edge.source.side === 'SOUTH') {
            const segment = new VerticalSegment(bend1, { x: bend1.x, y: cNode.hitbox.y + cNode.hitbox.height }, cNode, edge)
            segment.ignoreSpacing.up = true; segment.aPort = edge.source; segments.push(segment)
          }
          while (index < bends.length) {
            const bend2 = bends[index++]!
            if (!fuzzyEquals(bend1.y, bend2.y)) {
              lastSegment = new VerticalSegment(bend1, bend2, undefined, edge); segments.push(lastSegment)
              if (first) {
                first = false
                if (bend2.y < cNode.hitbox.y) lastSegment.ignoreSpacing.down = true
                else if (bend2.y > cNode.hitbox.y + cNode.hitbox.height) lastSegment.ignoreSpacing.up = true
                else { lastSegment.ignoreSpacing.up = true; lastSegment.ignoreSpacing.down = true }
              }
            }
            if (index < bends.length) bend1 = bend2
          }
          if (lastSegment !== undefined) {
            const target = this.nodesMap.get(edge.target.node)!
            if (bend1.y < target.hitbox.y) lastSegment.ignoreSpacing.down = true
            else if (bend1.y > target.hitbox.y + target.hitbox.height) lastSegment.ignoreSpacing.up = true
            else { lastSegment.ignoreSpacing.up = true; lastSegment.ignoreSpacing.down = true }
          }
        }
      }
      for (const edge of incomingEdges(node)) if (edge.bends.length > 0) {
        const bend = edge.bends[edge.bends.length - 1]!
        if (edge.target.side === 'NORTH') {
          const segment = new VerticalSegment(bend, { x: bend.x, y: cNode.hitbox.y }, cNode, edge)
          segment.ignoreSpacing.down = true; segment.aPort = edge.target; segments.push(segment)
        }
        if (edge.target.side === 'SOUTH') {
          const segment = new VerticalSegment(bend, { x: bend.x, y: cNode.hitbox.y + cNode.hitbox.height }, cNode, edge)
          segment.ignoreSpacing.up = true; segment.aPort = edge.target; segments.push(segment)
        }
      }
    }
    return segments
  }
  private mergeVerticalSegments(segments: VerticalSegment[]): void {
    if (segments.length === 0) return
    sortSegments(segments)
    let survivor = segments[0]!
    for (let i = 1; i < segments.length; i++) {
      const next = segments[i]!
      if (survivor.intersects(next)) survivor = survivor.joinWith(next)
      else { this.verticalSegmentToCNode(survivor); survivor = next }
    }
    this.verticalSegmentToCNode(survivor)
  }
  private verticalSegmentToCNode(segment: VerticalSegment): void {
    const node = createNode(this.graph, segment, { ...segment.hitbox })
    if (segment.potentialGroupParents.length > 0) addGroupNode(segment.potentialGroupParents[0]!.group!, node)
    const lock = locks(), incoming = new Set<Port>(), outgoing = new Set<Port>()
    for (const edge of segment.representedLEdges) { incoming.add(edge.source); outgoing.add(edge.target) }
    const difference = incoming.size - outgoing.size
    if (difference < 0) { lock.left = true; lock.right = false }
    else if (difference > 0) { lock.left = false; lock.right = true }
    this.lockMap.set(node, lock)
    for (const other of segment.joined) this.verticalSegmentsMap.set(other, node)
    this.verticalSegmentsMap.set(segment, node)
  }
  applyLayout(state: { width: number; height: number; offsetX: number; offsetY: number }): void {
    for (const node of this.graph.nodes) if (!(node.origin instanceof VerticalSegment)) node.origin.x = node.hitbox.x + node.origin.margin.left
    for (const [comment, { anchor, offset }] of this.commentOffsets) { comment.x = 0 + (anchor.x + offset.x); comment.y = 0 + (anchor.y + offset.y) }
    for (const node of this.graph.nodes) if (node.origin instanceof VerticalSegment) {
      const delta = node.hitbox.x - node.hitboxPreCompaction.x
      for (const bend of node.origin.affectedBends) bend.x += delta
      for (const box of node.origin.affectedBoundingBoxes) box.x += delta
      for (const point of node.origin.junctionPoints) point.x += delta
    }
    for (const [node, cNode] of this.nodesMap) for (const edge of outgoingEdges(node)) if (edge.source.node === edge.target.node) {
      const delta = cNode.hitbox.x - cNode.hitboxPreCompaction.x
      for (const label of edge.labels) label.x += delta
    }
    let topX = Number.POSITIVE_INFINITY, topY = Number.POSITIVE_INFINITY, bottomX = Number.NEGATIVE_INFINITY, bottomY = Number.NEGATIVE_INFINITY
    for (const node of this.graph.nodes) {
      topX = Math.min(topX, node.hitbox.x); topY = Math.min(topY, node.hitbox.y)
      bottomX = Math.max(bottomX, node.hitbox.x + node.hitbox.width); bottomY = Math.max(bottomY, node.hitbox.y + node.hitbox.height)
    }
    state.offsetX = 0 + -topX; state.offsetY = 0 + -topY
    state.width = 0 + (bottomX - topX); state.height = 0 + (bottomY - topY)
    for (const node of this.graph.nodes) if (!(node.origin instanceof VerticalSegment) && node.origin.type === 'EXTERNAL_PORT') {
      const origin = node.origin
      switch (origin.externalPortSide) {
        case 'WEST': origin.x = topX; break
        case 'EAST': origin.x = bottomX - (origin.width + origin.margin.right); break
        case 'NORTH': origin.y = topY; break
        case 'SOUTH': origin.y = bottomY - (origin.height + origin.margin.bottom); break
        case 'UNDEFINED': break
        default: throw new Error('External-port compaction requires its source port side.')
      }
    }
  }
}

class CompactionSpacings {
  constructor(private options: Options) {}
  individual(node: Node, key: string, fallback: number): number {
    return numberOption(node.individualSpacings, key, numberOption(this.options, key, fallback))
  }
  private option(a: LayoutNodeType, b: LayoutNodeType, horizontal: boolean): [string, number] {
    if (a === 'NORMAL' && b === 'NORMAL') return horizontal ? ['layered.spacing.nodeNodeBetweenLayers', 20] : ['spacing.nodeNode', 20]
    if (a === 'LONG_EDGE' && b === 'LONG_EDGE' || a === 'BREAKING_POINT' && b === 'BREAKING_POINT') return horizontal ? ['layered.spacing.edgeEdgeBetweenLayers', 10] : ['spacing.edgeEdge', 10]
    if (a === 'LABEL' && b === 'LABEL') return ['spacing.edgeEdge', 10]
    if (a === 'EXTERNAL_PORT' && b === 'EXTERNAL_PORT') { if (horizontal) throw new Error('Unspecified horizontal spacing.'); return ['spacing.portPort', 10] }
    const has = (x: LayoutNodeType, y: LayoutNodeType): boolean => a === x && b === y || a === y && b === x
    if (has('NORMAL', 'LONG_EDGE') || has('LONG_EDGE', 'LABEL') || has('BREAKING_POINT', 'NORMAL') || has('BREAKING_POINT', 'LABEL') || has('BREAKING_POINT', 'LONG_EDGE')) return horizontal ? ['layered.spacing.edgeNodeBetweenLayers', 10] : ['spacing.edgeNode', 10]
    if (has('NORMAL', 'LABEL')) return horizontal ? ['layered.spacing.nodeNodeBetweenLayers', 20] : ['spacing.nodeNode', 20]
    if (has('EXTERNAL_PORT', 'LABEL')) return horizontal ? ['spacing.labelPortHorizontal', 1] : ['spacing.labelPortVertical', 1]
    if (horizontal) throw new Error('Unspecified horizontal spacing.')
    if (has('NORMAL', 'NORTH_SOUTH_PORT') || has('NORMAL', 'EXTERNAL_PORT')) return ['spacing.edgeNode', 10]
    if (has('LONG_EDGE', 'NORTH_SOUTH_PORT') || has('LONG_EDGE', 'EXTERNAL_PORT') || has('NORTH_SOUTH_PORT', 'EXTERNAL_PORT') || a === 'NORTH_SOUTH_PORT' && b === 'NORTH_SOUTH_PORT') return ['spacing.edgeEdge', 10]
    if (has('NORTH_SOUTH_PORT', 'LABEL')) return ['spacing.labelNode', 5]
    throw new Error('Unspecified spacing.')
  }
  private sameEdge(a: CNode, b: CNode): boolean {
    return a.origin instanceof VerticalSegment && b.origin instanceof VerticalSegment && a.origin.representedLEdges.some(edge => (b.origin as VerticalSegment).representedLEdges.includes(edge))
  }
  horizontal(a: CNode, b: CNode): number {
    if (this.sameEdge(a, b)) return 0
    if (!(a.origin instanceof VerticalSegment) && a.origin.type === 'EXTERNAL_PORT' || !(b.origin instanceof VerticalSegment) && b.origin.type === 'EXTERNAL_PORT') return 0
    const [key, fallback] = this.option(a.origin instanceof VerticalSegment ? 'LONG_EDGE' : a.origin.type, b.origin instanceof VerticalSegment ? 'LONG_EDGE' : b.origin.type, true)
    return numberOption(this.options, key, fallback)
  }
  vertical(a: CNode, b: CNode): number {
    if (this.sameEdge(a, b)) return 1
    const [key, fallback] = this.option(a.origin instanceof VerticalSegment ? 'LONG_EDGE' : a.origin.type, b.origin instanceof VerticalSegment ? 'LONG_EDGE' : b.origin.type, false)
    return numberOption(this.options, key, fallback)
  }
}

class OneDimensionalCompactor {
  direction: Direction | 'UNDEFINED' = 'UNDEFINED'
  private finished = false
  lockFunction?: (node: CNode, direction: Direction) => boolean
  constructor(readonly graph: CGraph, readonly spacings: CompactionSpacings, private constraintStrategy: 'QUADRATIC' | 'SCANLINE', private options: Options) {
    this.calculateGroupOffsets()
    for (const node of graph.nodes) {
      if (node.group === undefined) createGroup(graph, node)
      node.hitboxPreCompaction = { ...node.hitbox }
    }
  }
  calculateGroupOffsets(): void {
    for (const group of this.graph.groups) {
      let reference: CNode | undefined
      for (const node of group.nodes) {
        node.offset.x = 0; node.offset.y = 0
        if (reference === undefined || node.hitbox.x < reference.hitbox.x) reference = node
      }
      group.reference = reference!
      for (const node of group.nodes) { node.offset.x = node.hitbox.x - group.reference.hitbox.x; node.offset.y = node.hitbox.y - group.reference.hitbox.y }
    }
  }
  private mirrorHitboxes(): void {
    for (const node of this.graph.nodes) node.hitbox.x = -node.hitbox.x - node.hitbox.width
    this.calculateGroupOffsets()
  }
  changeDirection(direction: Direction): this {
    if (this.finished) throw new Error('The OneDimensionalCompactor instance has been finished already.')
    if (this.direction === direction) return this
    const previous = this.direction
    this.direction = direction
    if (previous === 'UNDEFINED') {
      if (direction === 'RIGHT') this.mirrorHitboxes()
      this.calculateConstraints()
    } else { this.mirrorHitboxes(); this.reverseConstraints() }
    return this
  }
  private isLocked(group: CGroup): boolean {
    for (const node of group.nodes) if (this.lockFunction?.(node, this.direction as Direction)) return true
    return false
  }
  compact(): this {
    if (this.finished) throw new Error('The OneDimensionalCompactor instance has been finished already.')
    if (this.direction === 'UNDEFINED') this.changeDirection('LEFT')
    for (const group of this.graph.groups) group.outDegree = group.outDegreeReal
    for (const node of this.graph.nodes) node.startPos = Number.NEGATIVE_INFINITY
    this.longestPathCompaction()
    return this
  }
  finish(): void { this.changeDirection('LEFT'); this.finished = true }
  private calculateConstraintsForCGroups(): void {
    for (const group of this.graph.groups) { group.outDegree = 0; group.outDegreeReal = 0; group.incomingConstraints.clear() }
    for (const group of this.graph.groups) for (const node of group.nodes) for (const incoming of node.constraints) if (incoming.group !== group) {
      group.incomingConstraints.add(incoming); incoming.group!.outDegree++; incoming.group!.outDegreeReal++
    }
  }
  private calculateConstraints(): void {
    for (const node of this.graph.nodes) node.constraints.length = 0
    for (const [a, b] of this.graph.predefinedHorizontalConstraints) {
      if (this.direction === 'LEFT') a.constraints.push(b)
      else b.constraints.push(a)
    }
    if (this.constraintStrategy === 'SCANLINE') this.calculateEdgeAwareConstraints()
    else this.calculateQuadraticConstraints()
    this.calculateConstraintsForCGroups()
  }
  private reverseConstraints(): void {
    const incoming = new Map<CNode, CNode[]>()
    for (const node of this.graph.nodes) incoming.set(node, [])
    for (const node of this.graph.nodes) {
      node.startPos = Number.NEGATIVE_INFINITY
      for (const inc of node.constraints) incoming.get(inc)!.push(node)
    }
    for (const node of this.graph.nodes) { node.constraints.length = 0; node.constraints = incoming.get(node)! }
    this.calculateConstraintsForCGroups()
  }
  private longestPathCompaction(): void {
    let minStartPos = Number.POSITIVE_INFINITY
    for (const node of this.graph.nodes) minStartPos = Math.min(minStartPos, node.group!.reference.hitbox.x + node.offset.x)
    const sinks: CGroup[] = []
    for (const group of this.graph.groups) { group.startPos = minStartPos; if (group.outDegree === 0) sinks.push(group) }
    let head = 0
    while (head < sinks.length) {
      const group = sinks[head++]!
      let diff = group.reference.hitbox.x
      for (const node of group.nodes) {
        const suggestedX = group.startPos + node.offset.x
        if (!this.isLocked(group) || node.hitbox.x < suggestedX) node.startPos = suggestedX
        else node.startPos = node.hitbox.x
      }
      diff -= group.reference.startPos
      group.delta += diff
      if (this.direction === 'RIGHT') group.deltaNormalized += diff
      else group.deltaNormalized -= diff
      for (const node of group.nodes) for (const inc of node.constraints) {
        const spacing = this.spacings.horizontal(node, inc)
        inc.group!.startPos = Math.max(inc.group!.startPos, node.startPos + node.hitbox.width + spacing - inc.offset.x)
        if (this.lockFunction?.(inc, this.direction as Direction)) inc.group!.startPos = Math.max(inc.group!.startPos, inc.hitbox.x - inc.offset.x)
        inc.group!.outDegree--
        if (inc.group!.outDegree === 0) sinks.push(inc.group!)
      }
    }
    for (const node of this.graph.nodes) node.hitbox.x = node.startPos
  }
  private calculateQuadraticConstraints(): void {
    for (const node of this.graph.nodes) node.constraints.length = 0
    for (const a of this.graph.nodes) for (const b of this.graph.nodes) {
      if (a === b || a.group !== undefined && a.group === b.group) continue
      const spacing = this.spacings.vertical(a, b)
      if ((b.hitbox.x > a.hitbox.x || a.hitbox.x === b.hitbox.x && a.hitbox.width < b.hitbox.width)
        && fuzzyCompare(b.hitbox.y + b.hitbox.height + spacing, a.hitbox.y) > 0
        && fuzzyCompare(b.hitbox.y, a.hitbox.y + a.hitbox.height + spacing) < 0) a.constraints.push(b)
    }
  }
  private sweep(filter: (node: CNode) => boolean): void {
    const timestamps: Array<{ node: CNode; low: boolean }> = []
    for (const node of this.graph.nodes) if (filter(node)) timestamps.push({ node, low: true }, { node, low: false })
    const intervals: CNode[] = [], candidates = new Map<CNode, CNode | undefined>()
    for (let i = 0; i < this.graph.nodes.length; i++) this.graph.nodes[i]!.id = i
    timestamps.sort((a, b) => {
      let y1 = a.node.hitbox.y, y2 = b.node.hitbox.y
      if (!a.low) y1 += a.node.hitbox.height
      if (!b.low) y2 += b.node.hitbox.height
      const compared = compareNumbers(y1, y2)
      return compared === 0 ? !a.low && b.low ? -1 : !b.low && a.low ? 1 : 0 : compared
    })
    const compare = (a: CNode, b: CNode): number => compareNumbers(a.hitbox.x + a.hitbox.width / 2, b.hitbox.x + b.hitbox.width / 2)
    const lowerBound = (node: CNode): number => {
      let low = 0, high = intervals.length
      while (low < high) { const middle = Math.trunc((low + high) / 2); if (compare(intervals[middle]!, node) < 0) low = middle + 1; else high = middle }
      return low
    }
    for (const timestamp of timestamps) {
      const node = timestamp.node, index = lowerBound(node)
      const equal = index < intervals.length && compare(intervals[index]!, node) === 0
      if (timestamp.low) {
        if (equal) throw new Error('Invalid hitboxes for scanline constraint calculation.')
        intervals.splice(index, 0, node)
        candidates.set(node, intervals[index - 1])
        const right = intervals[index + 1]
        if (right !== undefined) candidates.set(right, node)
      } else {
        const left = intervals[index - 1]
        if (left !== undefined && left === candidates.get(node) && left.group !== undefined && left.group !== node.group) left.constraints.push(node)
        const right = intervals[index + (equal ? 1 : 0)]
        if (right !== undefined && candidates.get(right) === node && right.group !== undefined && right.group !== node.group) node.constraints.push(right)
        if (equal) intervals.splice(index, 1)
      }
    }
  }
  private alterHitbox(node: CNode, spacing: number, factor: number): void {
    const delta = spacing * factor
    if (node.origin instanceof VerticalSegment) {
      if (!node.origin.ignoreSpacing.up) { node.hitbox.y -= delta + 0.01; node.hitbox.height += delta + 0.01 }
      else if (!node.origin.ignoreSpacing.down) node.hitbox.height += delta + 0.01
    } else { node.hitbox.y -= delta; node.hitbox.height += 2 * delta }
  }
  private alterGroupedHitboxOrthogonal(group: CGroup, spacing: number, factor: number): void {
    const master = group.master ?? group.nodes[0]!
    this.alterHitbox(master, spacing, factor)
    if (group.nodes.length === 1) return
    const delta = spacing * factor
    for (const node of group.nodes) if (node !== master) {
      const segment = node.origin as VerticalSegment
      if (segment.ignoreSpacing.up) { node.hitbox.y += delta + 0.01; node.hitbox.height -= delta + 0.01 }
      else if (segment.ignoreSpacing.down) node.hitbox.height -= delta + 0.01
    }
  }
  private calculateEdgeAwareConstraints(): void {
    const schedule: Array<() => void> = []
    const verticalEdgeEdgeSpacing = numberOption(this.options, 'spacing.edgeEdge', 10)
    for (const node of this.graph.nodes) if (node.origin instanceof VerticalSegment) {
      const spacing = Math.max(0, verticalEdgeEdgeSpacing / 2 - 0.5)
      this.alterHitbox(node, spacing, 1); schedule.push(() => this.alterHitbox(node, spacing, -1))
    }
    this.sweep(node => node.origin instanceof VerticalSegment)
    for (const action of schedule) action()
    schedule.length = 0
    for (const node of this.graph.nodes) if (!(node.origin instanceof VerticalSegment)) {
      const spacing = Math.max(0, this.spacings.individual(node.origin, 'spacing.edgeEdge', 10) / 2 - 0.5)
      this.alterHitbox(node, spacing, 1); schedule.push(() => this.alterHitbox(node, spacing, -1))
    }
    this.sweep(node => !(node.origin instanceof VerticalSegment))
    for (const action of schedule) action()
    schedule.length = 0
    let minSpacing = Number.POSITIVE_INFINITY
    for (const node of this.graph.nodes) {
      let spacing: number
      if (!(node.origin instanceof VerticalSegment) && node.origin.type === 'EXTERNAL_PORT') spacing = Number.POSITIVE_INFINITY
      else if (node.origin instanceof VerticalSegment) spacing = Math.max(0, verticalEdgeEdgeSpacing / 2 - 0.5)
      else spacing = Math.max(0, this.spacings.individual(node.origin, 'spacing.nodeNode', 20) / 2 - 0.5)
      minSpacing = Math.min(minSpacing, spacing)
    }
    if (this.graph.nodes.length === 0) minSpacing = 0
    for (const group of this.graph.groups) {
      this.alterGroupedHitboxOrthogonal(group, minSpacing, 1); schedule.push(() => this.alterGroupedHitboxOrthogonal(group, minSpacing, -1))
    }
    this.sweep(() => true)
    for (const action of schedule) action()
    schedule.length = 0
  }
}

/**
 * HorizontalGraphCompactor -> LGraphToCGraphTransformer -> OneDimensionalCompactor
 * with LongestPathCompaction, ELK v0.11.0 at
 * 54123e884b1ae743b453260f713b20c9bf5787f2. Options are the effective graph
 * options after GraphConfigurator; individual spacings remain node-owned.
 */
export function compactGraph(layers: Node[][], options: Options, state: { width: number; height: number; offsetX: number; offsetY: number }): void {
  const strategy = enumOption(options, 'layered.compaction.postCompaction.strategy', ['NONE', 'LEFT', 'RIGHT', 'LEFT_RIGHT_CONSTRAINT_LOCKING', 'LEFT_RIGHT_CONNECTION_LOCKING', 'EDGE_LENGTH'] as const, 'NONE')
  if (strategy === 'NONE') return
  if (strategy === 'EDGE_LENGTH') throw new Error('ELK TypeScript port: edge-length compaction is not implemented yet')
  const routing = enumOption(options, 'edgeRouting', ['UNDEFINED', 'POLYLINE', 'ORTHOGONAL', 'SPLINES'] as const, 'ORTHOGONAL')
  if (routing !== 'ORTHOGONAL') throw new Error('Compaction not supported for ' + routing + ' edges.')
  const constraints = enumOption(options, 'layered.compaction.postCompaction.constraints', ['QUADRATIC', 'SCANLINE'] as const, 'SCANLINE')
  const transformer = new LGraphToCGraphTransformer(layers)
  const compactor = new OneDimensionalCompactor(transformer.transform(), new CompactionSpacings(options), constraints, options)
  if (strategy === 'RIGHT') compactor.changeDirection('RIGHT').compact()
  else {
    compactor.compact()
    if (strategy === 'LEFT_RIGHT_CONSTRAINT_LOCKING') { compactor.changeDirection('RIGHT'); compactor.lockFunction = node => node.group!.outDegreeReal === 0; compactor.compact() }
    else if (strategy === 'LEFT_RIGHT_CONNECTION_LOCKING') { compactor.changeDirection('RIGHT'); compactor.lockFunction = (node, direction) => direction === 'LEFT' ? transformer.lockMap.get(node)!.left : transformer.lockMap.get(node)!.right; compactor.compact() }
  }
  compactor.finish()
  transformer.applyLayout(state)
}
