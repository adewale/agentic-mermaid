/*******************************************************************************
 * Copyright (c) 2020 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * 
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../../java/lang/Enum.ts'

export class OrderingStrategy extends Enum<OrderingStrategy> {
  static readonly NONE = new OrderingStrategy('NONE', 0)
  static readonly NODES_AND_EDGES = new OrderingStrategy('NODES_AND_EDGES', 1)
  static readonly PREFER_EDGES = new OrderingStrategy('PREFER_EDGES', 2)
  static readonly PREFER_NODES = new OrderingStrategy('PREFER_NODES', 3)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): OrderingStrategy[] { return [OrderingStrategy.NONE, OrderingStrategy.NODES_AND_EDGES, OrderingStrategy.PREFER_EDGES, OrderingStrategy.PREFER_NODES] }
  static valueOf(name: string): OrderingStrategy {
    for (const value of OrderingStrategy.values()) if (value.name() === name) return value
    throw new Error(`Unknown OrderingStrategy value: ${name}`)
  }
}
