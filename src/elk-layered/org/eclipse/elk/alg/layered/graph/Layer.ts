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
import type { LGraph } from './LGraph.ts'
import type { LNode } from './LNode.ts'

export class Layer extends LGraphElement implements JavaIterable<LNode> {
  static readonly #serialVersionUID = 5760328884701318753n
  private readonly owner: LGraph
  private readonly size = new KVector()
  private readonly nodes = new ArrayList<LNode>()

  constructor(graph: LGraph) { super(); this.owner = graph }
  getSize(): KVector { return this.size }
  getNodes(): ArrayList<LNode> { return this.nodes }
  iterator(): Iterator<LNode> { return this.nodes.iterator() }
  [Symbol.iterator](): IterableIterator<LNode> { return iterableIterator(this.iterator()) }
  getGraph(): LGraph { return this.owner }
  getIndex(): number { return this.owner.getLayers().indexOf(this) }
  override toString(): string { return 'L_' + this.getIndex() + this.nodes.toString() }
}
