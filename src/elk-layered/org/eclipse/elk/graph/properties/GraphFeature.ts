/*******************************************************************************
 * Copyright (c) 2012, 2015 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Enum } from '../../../../../java/lang/Enum.ts'
import { IllegalArgumentException } from '../../../../../java/lang/IllegalArgumentException.ts'

export class GraphFeature extends Enum<GraphFeature> {
  static readonly SELF_LOOPS = new GraphFeature('SELF_LOOPS', 0, 'Edges connecting a node with itself.')
  static readonly INSIDE_SELF_LOOPS = new GraphFeature('INSIDE_SELF_LOOPS', 1, 'Self-loops routed through a node instead of around it.')
  static readonly MULTI_EDGES = new GraphFeature('MULTI_EDGES', 2, 'Multiple edges with the same source and target node.')
  static readonly EDGE_LABELS = new GraphFeature('EDGE_LABELS', 3, 'Labels that are associated with edges.')
  static readonly PORTS = new GraphFeature('PORTS', 4, 'Edges are connected to nodes over ports.')
  static readonly COMPOUND = new GraphFeature('COMPOUND', 5, 'Edges that connect nodes from different hierarchy levelsand are incident to compound nodes.')
  static readonly CLUSTERS = new GraphFeature('CLUSTERS', 6, 'Edges that connect nodes from different clusters, but not the cluster parent nodes.')
  static readonly DISCONNECTED = new GraphFeature('DISCONNECTED', 7, 'Multiple connected components.')
  private constructor(name: string, ordinal: number, private readonly description = '') { super(name, ordinal) }
  getDescription(): string { return this.description }
  static values(): GraphFeature[] { return [GraphFeature.SELF_LOOPS, GraphFeature.INSIDE_SELF_LOOPS, GraphFeature.MULTI_EDGES, GraphFeature.EDGE_LABELS, GraphFeature.PORTS, GraphFeature.COMPOUND, GraphFeature.CLUSTERS, GraphFeature.DISCONNECTED] }
  static valueOf(name: string): GraphFeature { for (const value of GraphFeature.values()) if (value.name() === name) return value; throw new IllegalArgumentException(`No enum constant ${name}`) }
}
