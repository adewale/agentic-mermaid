/*******************************************************************************
 * Copyright (c) 2010, 2019 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Class } from '../../../../../../java/lang/Class.ts'
import { Enum } from '../../../../../../java/lang/Enum.ts'
import type { JavaIterable } from '../../../../../../java/lang/Iterable.ts'
import { ArrayList } from '../../../../../../java/util/ArrayList.ts'
import type { AbstractList } from '../../../../../../java/util/AbstractList.ts'
import { Collections } from '../../../../../../java/util/Collections.ts'
import { EnumMap } from '../../../../../../java/util/EnumMap.ts'
import { Predicates, type Predicate } from '../../../../../../com/google/common/base/Predicates.ts'
import { Iterables } from '../../../../../../com/google/common/collect/Iterables.ts'
import { KVector } from '../../../core/math/KVector.ts'
import { PortSide } from '../../../core/options/PortSide.ts'
import { Pair } from '../../../core/util/Pair.ts'
import { InternalProperties } from '../options/InternalProperties.ts'
import { LayeredOptions } from '../options/LayeredOptions.ts'
import { InteractiveReferencePoint } from '../options/InteractiveReferencePoint.ts'
import { PortType } from '../options/PortType.ts'
import type { LGraph } from './LGraph.ts'
import type { Layer } from './Layer.ts'
import type { LLabel } from './LLabel.ts'
import type { LEdge } from './LEdge.ts'
import { LPort } from './LPort.ts'
import { LMargin } from './LMargin.ts'
import { LPadding } from './LPadding.ts'
import { LShape } from './LShape.ts'

export class LNode extends LShape {
  static readonly #serialVersionUID = -4272570519129722541n
  private graph: LGraph | null
  private layer: Layer | null = null
  private type = LNode.NodeType.NORMAL
  private readonly ports = new ArrayList<LPort>(6)
  private readonly labels = new ArrayList<LLabel>(2)
  private nestedGraph: LGraph | null = null
  private readonly margin = new LMargin()
  private readonly padding = new LPadding()
  private portSideIndices: EnumMap<PortSide, Pair<number, number>> | null = null
  private portSidesCached = false

  constructor(graph: LGraph | null) { super(); this.graph = graph }
  getLayer(): Layer | null { return this.layer }

  setLayer(thelayer: Layer | null): void
  setLayer(index: number, newlayer: Layer | null): void
  setLayer(first: Layer | null | number, newlayer?: Layer | null): void {
    if (typeof first === 'number') {
      const index = first
      if (newlayer !== null && (index < 0 || index > newlayer!.getNodes().size())) throw new Error('index must be >= 0 and <= layer node count')
      if (this.layer !== null) this.layer.getNodes().remove(this)
      this.layer = newlayer!
      if (newlayer !== null) newlayer!.getNodes().add(index, this)
    } else {
      if (this.layer !== null) this.layer.getNodes().remove(this)
      this.layer = first
      if (this.layer !== null) this.layer.getNodes().add(this)
    }
  }

  getGraph(): LGraph | null { return this.graph === null && this.layer !== null ? this.layer.getGraph() : this.graph }
  setGraph(newGraph: LGraph | null): void { this.graph = newGraph }
  getType(): LNode.NodeType { return this.type }
  setType(type: LNode.NodeType): void { this.type = type }

  getPorts(): ArrayList<LPort>
  getPorts(portType: PortType): JavaIterable<LPort>
  getPorts(side: PortSide): JavaIterable<LPort>
  getPorts(portType: PortType, side: PortSide): JavaIterable<LPort>
  getPorts(first?: PortType | PortSide, side?: PortSide): JavaIterable<LPort> {
    if (first === undefined) return this.ports
    let typePredicate: Predicate<LPort> | null = null
    let sidePredicate: Predicate<LPort> | null = null
    if (first instanceof PortType) {
      switch (first) {
        case PortType.INPUT: typePredicate = LPort.INPUT_PREDICATE; break
        case PortType.OUTPUT: typePredicate = LPort.OUTPUT_PREDICATE; break
      }
      if (side === undefined) return typePredicate !== null ? Iterables.filter(this.ports, typePredicate) : Collections.emptyList()
    } else side = first
    switch (side) {
      case PortSide.NORTH: sidePredicate = LPort.NORTH_PREDICATE; break
      case PortSide.EAST: sidePredicate = LPort.EAST_PREDICATE; break
      case PortSide.SOUTH: sidePredicate = LPort.SOUTH_PREDICATE; break
      case PortSide.WEST: sidePredicate = LPort.WEST_PREDICATE; break
    }
    if (first instanceof PortSide) return sidePredicate !== null ? Iterables.filter(this.ports, sidePredicate) : Collections.emptyList()
    if (typePredicate !== null && sidePredicate !== null) return Iterables.filter(this.ports, Predicates.and(typePredicate, sidePredicate))
    return Collections.emptyList()
  }

  getPortSideView(side: PortSide): AbstractList<LPort> {
    if (!this.portSidesCached) this.findPortIndices()
    const indices = this.portSideIndices!.get(side)
    return indices === null ? Collections.emptyList() : this.ports.subList(indices.getFirst(), indices.getSecond())
  }

  getIncomingEdges(): JavaIterable<LEdge> {
    const iterables = new ArrayList<JavaIterable<LEdge>>()
    for (const port of this.ports) iterables.add(port.getIncomingEdges())
    return Iterables.concat(iterables)
  }
  getOutgoingEdges(): JavaIterable<LEdge> {
    const iterables = new ArrayList<JavaIterable<LEdge>>()
    for (const port of this.ports) iterables.add(port.getOutgoingEdges())
    return Iterables.concat(iterables)
  }
  getConnectedEdges(): JavaIterable<LEdge> {
    const iterables = new ArrayList<JavaIterable<LEdge>>()
    for (const port of this.ports) iterables.add(port.getConnectedEdges())
    return Iterables.concat(iterables)
  }
  getLabels(): ArrayList<LLabel> { return this.labels }
  getNestedGraph(): LGraph | null { return this.nestedGraph }
  setNestedGraph(nestedGraph: LGraph | null): void { this.nestedGraph = nestedGraph }
  getMargin(): LMargin { return this.margin }
  getPadding(): LPadding { return this.padding }
  getIndex(): number { return this.layer === null ? -1 : this.layer.getNodes().indexOf(this) }

  borderToContentAreaCoordinates(horizontal: boolean, vertical: boolean): void {
    const thegraph = this.getGraph()!
    const graphPadding = thegraph.getPadding()
    const offset = thegraph.getOffset()
    const pos = this.getPosition()
    if (horizontal) pos.x = pos.x - graphPadding.left - offset.x
    if (vertical) pos.y = pos.y - graphPadding.top - offset.y
  }

  getInteractiveReferencePoint(): KVector | null {
    switch (this.getGraph()!.getProperty(LayeredOptions.INTERACTIVE_REFERENCE_POINT)) {
      case InteractiveReferencePoint.CENTER: {
        const nodePos = this.getPosition()
        const nodeSize = this.getSize()
        return new KVector(nodePos.x + nodeSize.x / 2, nodePos.y + nodeSize.y / 2)
      }
      case InteractiveReferencePoint.TOP_LEFT: return new KVector(this.getPosition())
      default: return null
    }
  }

  cachePortSides(): void { this.portSidesCached = true; this.findPortIndices() }
  private findPortIndices(): void {
    this.portSideIndices = new EnumMap(Class.of(PortSide))
    let firstIndexForCurrentSide = 0
    let currentSide = PortSide.NORTH
    let currentIndex = 0
    for (; currentIndex < this.ports.size(); currentIndex++) {
      const port = this.ports.get(currentIndex)
      if (port.getSide() !== currentSide) {
        if (firstIndexForCurrentSide !== currentIndex) this.portSideIndices.put(currentSide, Pair.of(firstIndexForCurrentSide, currentIndex))
        currentSide = port.getSide()
        firstIndexForCurrentSide = currentIndex
      }
    }
    this.portSideIndices.put(currentSide, Pair.of(firstIndexForCurrentSide, currentIndex))
  }

  override getDesignation(): string {
    if (!this.labels.isEmpty()) { const text = this.labels.get(0).getText(); if (text !== null && text !== '') return text }
    const id = super.getDesignation()
    return id !== null ? id : String(this.getIndex())
  }
  isInlineEdgeLabel(): boolean {
    if (this.getType() !== LNode.NodeType.LABEL) return false
    for (const label of this.getProperty(InternalProperties.REPRESENTED_LABELS)!) if (!label.getProperty(LayeredOptions.EDGE_LABELS_INLINE)) return false
    return true
  }
  override toString(): string { return 'n' + (this.type !== LNode.NodeType.NORMAL ? '(' + this.type.toString().toLowerCase() + ')' : '') + '_' + this.getDesignation() }
}

export namespace LNode {
  export class NodeType extends Enum<NodeType> {
    static readonly NORMAL = new NodeType('NORMAL', 0)
    static readonly LONG_EDGE = new NodeType('LONG_EDGE', 1)
    static readonly EXTERNAL_PORT = new NodeType('EXTERNAL_PORT', 2)
    static readonly NORTH_SOUTH_PORT = new NodeType('NORTH_SOUTH_PORT', 3)
    static readonly LABEL = new NodeType('LABEL', 4)
    static readonly BREAKING_POINT = new NodeType('BREAKING_POINT', 5)
    static readonly PLACEHOLDER = new NodeType('PLACEHOLDER', 6)
    static readonly NONSHIFTING_PLACEHOLDER = new NodeType('NONSHIFTING_PLACEHOLDER', 7)
    private constructor(name: string, ordinal: number) { super(name, ordinal) }
    static values(): NodeType[] { return [NodeType.NORMAL, NodeType.LONG_EDGE, NodeType.EXTERNAL_PORT, NodeType.NORTH_SOUTH_PORT, NodeType.LABEL, NodeType.BREAKING_POINT, NodeType.PLACEHOLDER, NodeType.NONSHIFTING_PLACEHOLDER] }
    static valueOf(name: string): NodeType { for (const value of NodeType.values()) if (value.name() === name) return value; throw new Error(`Unknown NodeType value: ${name}`) }
    getColor(): string {
      switch (this) {
        case NodeType.EXTERNAL_PORT: return '#cc99cc'
        case NodeType.LONG_EDGE: return '#eaed00'
        case NodeType.NORTH_SOUTH_PORT: return '#0034de'
        case NodeType.LABEL: return '#75c3c3'
        case NodeType.BREAKING_POINT: return '#eeeeff'
        default: return '#eeeeee'
      }
    }
  }
}
