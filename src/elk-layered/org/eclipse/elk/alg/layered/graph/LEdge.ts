/*******************************************************************************
 * Copyright (c) 2010, 2019 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { ArrayList } from '../../../../../../java/util/ArrayList.ts'
import { KVectorChain } from '../../../core/math/KVectorChain.ts'
import { EdgeLabelPlacement } from '../../../core/options/EdgeLabelPlacement.ts'
import { PortSide } from '../../../core/options/PortSide.ts'
import { InternalProperties } from '../options/InternalProperties.ts'
import { LayeredOptions } from '../options/LayeredOptions.ts'
import { PortType } from '../options/PortType.ts'
import { LGraphElement } from './LGraphElement.ts'
import type { LGraph } from './LGraph.ts'
import { LGraphUtil } from './LGraphUtil.ts'
import type { LLabel } from './LLabel.ts'
import type { LNode } from './LNode.ts'
import { LPort } from './LPort.ts'

export class LEdge extends LGraphElement {
  static readonly #serialVersionUID = 1429497419118554817n
  private bendPoints = new KVectorChain()
  private source: LPort | null = null
  private target: LPort | null = null
  private readonly labels = new ArrayList<LLabel>(3)

  reverse(layeredGraph: LGraph, adaptPorts: boolean): void {
    const oldSource = this.getSource()!
    const oldTarget = this.getTarget()!
    this.setSource(null)
    this.setTarget(null)
    if (adaptPorts && oldTarget.getProperty(InternalProperties.INPUT_COLLECT)) this.setSource(LGraphUtil.provideCollectorPort(layeredGraph, oldTarget.getNode()!, PortType.OUTPUT, PortSide.EAST))
    else this.setSource(oldTarget)
    if (adaptPorts && oldSource.getProperty(InternalProperties.OUTPUT_COLLECT)) this.setTarget(LGraphUtil.provideCollectorPort(layeredGraph, oldSource.getNode()!, PortType.INPUT, PortSide.WEST))
    else this.setTarget(oldSource)
    for (const label of this.labels) {
      const labelPlacement = label.getProperty(LayeredOptions.EDGE_LABELS_PLACEMENT)
      if (labelPlacement === EdgeLabelPlacement.TAIL) label.setProperty(LayeredOptions.EDGE_LABELS_PLACEMENT, EdgeLabelPlacement.HEAD)
      else if (labelPlacement === EdgeLabelPlacement.HEAD) label.setProperty(LayeredOptions.EDGE_LABELS_PLACEMENT, EdgeLabelPlacement.TAIL)
    }
    const reversed = this.getProperty(InternalProperties.REVERSED)
    this.setProperty(InternalProperties.REVERSED, !reversed)
    this.bendPoints = KVectorChain.reverse(this.bendPoints)
  }

  getSource(): LPort | null { return this.source }
  setSource(source: LPort | null): void {
    if (this.source !== null) this.source.getOutgoingEdges().remove(this)
    this.source = source
    if (this.source !== null) this.source.getOutgoingEdges().add(this)
  }
  getTarget(): LPort | null { return this.target }
  setTarget(target: LPort | null): void {
    if (this.target !== null) this.target.getIncomingEdges().remove(this)
    this.target = target
    if (this.target !== null) this.target.getIncomingEdges().add(this)
  }
  setTargetAndInsertAtIndex(targetPort: LPort | null, index: number): void {
    if (this.target !== null) this.target.getIncomingEdges().remove(this)
    this.target = targetPort
    if (this.target !== null) this.target.getIncomingEdges().add(index, this)
  }
  isSelfLoop(): boolean {
    if (this.source === null || this.target === null) return false
    return this.source.getNode() !== null && this.source.getNode() === this.target.getNode()
  }
  isInLayerEdge(): boolean { return !this.isSelfLoop() && this.source!.getNode()!.getLayer() === this.target!.getNode()!.getLayer() }
  getBendPoints(): KVectorChain { return this.bendPoints }
  getLabels(): ArrayList<LLabel> { return this.labels }

  getOther(port: LPort): LPort | null
  getOther(node: LNode): LNode | null
  getOther(element: LPort | LNode): LPort | LNode | null {
    if (element instanceof LPort) {
      if (element === this.source) return this.target
      if (element === this.target) return this.source
      throw new Error("'port' must be either the source port or target port of the edge.")
    }
    if (element === this.source!.getNode()) return this.target!.getNode()
    if (element === this.target!.getNode()) return this.source!.getNode()
    throw new Error("'node' must either be the source node or target node of the edge.")
  }

  override getDesignation(): string | null {
    if (!this.labels.isEmpty()) { const text = this.labels.get(0).getText(); if (text !== null && text !== '') return text }
    return super.getDesignation()
  }
  override toString(): string {
    let result = 'e_'
    const designation = this.getDesignation()
    if (designation !== null) result += designation
    if (this.source !== null && this.target !== null) {
      result += ' ' + this.source.getDesignation() + '[' + this.source.getNode() + ']'
      result += ' -> ' + this.target.getDesignation() + '[' + this.target.getNode() + ']'
    }
    return result
  }
}
