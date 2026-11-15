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
import { KVector } from '../../../core/math/KVector.ts'
import { LGraphElement } from './LGraphElement.ts'
import { LGraphUtil } from './LGraphUtil.ts'
import type { LNode } from './LNode.ts'
import { LPadding } from './LPadding.ts'
import type { Layer } from './Layer.ts'

export class LGraph extends LGraphElement implements JavaIterable<Layer> {
  static readonly #serialVersionUID = -8006835373897072852n
  private readonly size = new KVector()
  private readonly padding = new LPadding()
  private readonly offset = new KVector()
  private readonly layerlessNodes = new ArrayList<LNode>()
  private readonly layers = new ArrayList<Layer>()
  private parentNode: LNode | null = null

  getSize(): KVector { return this.size }
  getActualSize(): KVector { return new KVector(this.size.x + this.padding.left + this.padding.right, this.size.y + this.padding.top + this.padding.bottom) }
  getPadding(): LPadding { return this.padding }
  getOffset(): KVector { return this.offset }
  getLayerlessNodes(): ArrayList<LNode> { return this.layerlessNodes }
  getLayers(): ArrayList<Layer> { return this.layers }
  getParentNode(): LNode | null { return this.parentNode }
  setParentNode(parentNode: LNode | null): void { this.parentNode = parentNode }
  iterator(): Iterator<Layer> { return this.layers.iterator() }
  [Symbol.iterator](): IterableIterator<Layer> { return iterableIterator(this.iterator()) }

  toNodeArray(): LNode[][] {
    const lgraphArray = new Array<LNode[]>(this.layers.size())
    const layerIter = this.layers.listIterator()
    while (layerIter.hasNext()) {
      const layer = layerIter.next()
      const layerIndex = layerIter.previousIndex()
      lgraphArray[layerIndex] = LGraphUtil.toNodeArray(layer.getNodes())
    }
    return lgraphArray
  }

  override toString(): string {
    if (this.layers.isEmpty()) return 'G-unlayered' + this.layerlessNodes.toString()
    if (this.layerlessNodes.isEmpty()) return 'G-layered' + this.layers.toString()
    return 'G[layerless' + this.layerlessNodes.toString() + ', layers' + this.layers.toString() + ']'
  }
}
