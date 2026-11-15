/*******************************************************************************
 * Copyright (c) 2010, 2019 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { JavaIterable } from '../../../../../../java/lang/Iterable.ts'
import { ArrayList } from '../../../../../../java/util/ArrayList.ts'
import { iterableIterator, type Iterator } from '../../../../../../java/util/Iterator.ts'
import { Iterables } from '../../../../../../com/google/common/collect/Iterables.ts'
import type { Predicate } from '../../../../../../com/google/common/base/Predicates.ts'
import { KVector } from '../../../core/math/KVector.ts'
import { PortSide } from '../../../core/options/PortSide.ts'
import type { LNode } from './LNode.ts'
import type { LLabel } from './LLabel.ts'
import type { LEdge } from './LEdge.ts'
import { LMargin } from './LMargin.ts'
import { LShape } from './LShape.ts'

export class LPort extends LShape {
  static readonly #serialVersionUID = -3406558719744943360n
  static readonly OUTPUT_PREDICATE: Predicate<LPort> = port => !port.outgoingEdges.isEmpty()
  static readonly INPUT_PREDICATE: Predicate<LPort> = port => !port.incomingEdges.isEmpty()
  static readonly NORTH_PREDICATE: Predicate<LPort> = port => port.side === PortSide.NORTH
  static readonly EAST_PREDICATE: Predicate<LPort> = port => port.side === PortSide.EAST
  static readonly SOUTH_PREDICATE: Predicate<LPort> = port => port.side === PortSide.SOUTH
  static readonly WEST_PREDICATE: Predicate<LPort> = port => port.side === PortSide.WEST

  private owner: LNode | null = null
  private side = PortSide.UNDEFINED
  private readonly anchor = new KVector()
  private explicitlySuppliedPortAnchor = false
  private readonly margin = new LMargin()
  private readonly labels = new ArrayList<LLabel>(2)
  private readonly incomingEdges = new ArrayList<LEdge>(4)
  private readonly outgoingEdges = new ArrayList<LEdge>(4)
  private connectedEdges: JavaIterable<LEdge> = new CombineIter(this.incomingEdges, this.outgoingEdges)
  private connectedToExternalNodes = true

  getNode(): LNode | null { return this.owner }
  setNode(node: LNode | null): void {
    if (this.owner !== null) this.owner.getPorts().remove(this)
    this.owner = node
    if (this.owner !== null) this.owner.getPorts().add(this)
  }
  getSide(): PortSide { return this.side }
  setSide(theside: PortSide): void {
    if (theside === null) throw new TypeError('Null port side')
    this.side = theside
    if (!this.isExplicitlySuppliedPortAnchor()) {
      switch (this.side) {
        case PortSide.NORTH: this.getAnchor().x = this.getSize().x / 2; this.getAnchor().y = 0; break
        case PortSide.EAST: this.getAnchor().x = this.getSize().x; this.getAnchor().y = this.getSize().y / 2; break
        case PortSide.SOUTH: this.getAnchor().x = this.getSize().x / 2; this.getAnchor().y = this.getSize().y; break
        case PortSide.WEST: this.getAnchor().x = 0; this.getAnchor().y = this.getSize().y / 2; break
      }
    }
  }
  getAnchor(): KVector { return this.anchor }
  isExplicitlySuppliedPortAnchor(): boolean { return this.explicitlySuppliedPortAnchor }
  setExplicitlySuppliedPortAnchor(fixed: boolean): void { this.explicitlySuppliedPortAnchor = fixed }
  getAbsoluteAnchor(): KVector { return KVector.sum(this.owner!.getPosition(), this.getPosition(), this.anchor) }
  getMargin(): LMargin { return this.margin }
  getLabels(): ArrayList<LLabel> { return this.labels }
  getName(): string | null { return this.labels.isEmpty() ? null : this.labels.get(0).getText() }
  getDegree(): number { return (this.incomingEdges.size() + this.outgoingEdges.size()) | 0 }
  getNetFlow(): number { return (this.incomingEdges.size() - this.outgoingEdges.size()) | 0 }
  getIncomingEdges(): ArrayList<LEdge> { return this.incomingEdges }
  getOutgoingEdges(): ArrayList<LEdge> { return this.outgoingEdges }
  getConnectedEdges(): JavaIterable<LEdge> { return this.connectedEdges }
  isConnectedToExternalNodes(): boolean { return this.connectedToExternalNodes }
  setConnectedToExternalNodes(conn: boolean): void { this.connectedToExternalNodes = conn }

  getPredecessorPorts(): JavaIterable<LPort> {
    return Iterables.ofIterator(() => {
      const edgesIter = this.incomingEdges.iterator()
      return { hasNext: () => edgesIter.hasNext(), next: () => edgesIter.next().getSource()!, remove: () => edgesIter.remove() }
    })
  }
  getSuccessorPorts(): JavaIterable<LPort> {
    return Iterables.ofIterator(() => {
      const edgesIter = this.outgoingEdges.iterator()
      return { hasNext: () => edgesIter.hasNext(), next: () => edgesIter.next().getTarget()!, remove: () => edgesIter.remove() }
    })
  }
  getConnectedPorts(): JavaIterable<LPort> { return Iterables.concat(this.getPredecessorPorts(), this.getSuccessorPorts()) }
  getIndex(): number { return this.owner === null ? -1 : this.owner.getPorts().indexOf(this) }

  override getDesignation(): string {
    if (!this.labels.isEmpty()) { const text = this.labels.get(0).getText(); if (text !== null && text !== '') return text }
    const id = super.getDesignation()
    return id !== null ? id : String(this.getIndex())
  }
  override toString(): string {
    let result = 'p_' + this.getDesignation()
    if (this.owner !== null) result += '[' + this.owner + ']'
    if (this.incomingEdges.size() === 1 && this.outgoingEdges.isEmpty() && this.incomingEdges.get(0).getSource() !== this) {
      const source = this.incomingEdges.get(0).getSource()!
      result += ' << ' + source.getDesignation() + '[' + source.owner + ']'
    }
    if (this.incomingEdges.isEmpty() && this.outgoingEdges.size() === 1 && this.outgoingEdges.get(0).getTarget() !== this) {
      const target = this.outgoingEdges.get(0).getTarget()!
      result += ' >> ' + target.getDesignation() + '[' + target.owner + ']'
    }
    return result
  }
}

class CombineIter<T> implements JavaIterable<T> {
  constructor(private firstIterable: JavaIterable<T>, private secondIterable: JavaIterable<T>) {}
  iterator(): Iterator<T> {
    const firstIterator = this.firstIterable.iterator()
    const secondIterator = this.secondIterable.iterator()
    return {
      hasNext: () => firstIterator.hasNext() || secondIterator.hasNext(),
      next: () => firstIterator.hasNext() ? firstIterator.next() : secondIterator.next(),
      remove: () => { throw new Error('Unsupported iterator removal') },
    }
  }
  [Symbol.iterator](): IterableIterator<T> { return iterableIterator(this.iterator()) }
}
