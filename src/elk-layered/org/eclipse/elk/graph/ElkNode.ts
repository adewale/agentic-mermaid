/**
 * Copyright (c) 2016 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import type { EList } from '../../emf/common/util/EList.ts'
import type { ElkConnectableShape } from './ElkConnectableShape.ts'
import type { ElkEdge } from './ElkEdge.ts'
import type { ElkPort } from './ElkPort.ts'

export const ElkNode = Symbol('org.eclipse.elk.graph.ElkNode')

export interface ElkNode extends ElkConnectableShape {
  readonly [ElkNode]: true
  getPorts(): EList<ElkPort>
  getChildren(): EList<ElkNode>
  getParent(): ElkNode | null
  setParent(value: ElkNode | null): void
  getContainedEdges(): EList<ElkEdge>
  isHierarchical(): boolean
}

export function isElkNode(value: unknown): value is ElkNode { return value !== null && typeof value === 'object' && (value as ElkNode)[ElkNode] === true }
