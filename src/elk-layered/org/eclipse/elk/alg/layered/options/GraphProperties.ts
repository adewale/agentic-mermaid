/*******************************************************************************
 * Copyright (c) 2011, 2015 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../../java/lang/Enum.ts'

export class GraphProperties extends Enum<GraphProperties> {
  static readonly COMMENTS = new GraphProperties('COMMENTS', 0)
  static readonly EXTERNAL_PORTS = new GraphProperties('EXTERNAL_PORTS', 1)
  static readonly HYPEREDGES = new GraphProperties('HYPEREDGES', 2)
  static readonly HYPERNODES = new GraphProperties('HYPERNODES', 3)
  static readonly NON_FREE_PORTS = new GraphProperties('NON_FREE_PORTS', 4)
  static readonly NORTH_SOUTH_PORTS = new GraphProperties('NORTH_SOUTH_PORTS', 5)
  static readonly SELF_LOOPS = new GraphProperties('SELF_LOOPS', 6)
  static readonly CENTER_LABELS = new GraphProperties('CENTER_LABELS', 7)
  static readonly END_LABELS = new GraphProperties('END_LABELS', 8)
  static readonly PARTITIONS = new GraphProperties('PARTITIONS', 9)

  private constructor(name: string, ordinal: number) { super(name, ordinal) }
  static values(): GraphProperties[] { return [GraphProperties.COMMENTS, GraphProperties.EXTERNAL_PORTS, GraphProperties.HYPEREDGES, GraphProperties.HYPERNODES, GraphProperties.NON_FREE_PORTS, GraphProperties.NORTH_SOUTH_PORTS, GraphProperties.SELF_LOOPS, GraphProperties.CENTER_LABELS, GraphProperties.END_LABELS, GraphProperties.PARTITIONS] }
  static valueOf(name: string): GraphProperties {
    for (const value of GraphProperties.values()) if (value.name() === name) return value
    throw new Error(`Unknown GraphProperties value: ${name}`)
  }
}
