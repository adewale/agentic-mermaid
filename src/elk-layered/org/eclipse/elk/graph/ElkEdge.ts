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
import type { ElkEdgeSection } from './ElkEdgeSection.ts'
import type { ElkGraphElement } from './ElkGraphElement.ts'
import type { ElkNode } from './ElkNode.ts'

export interface ElkEdge extends ElkGraphElement {
  getContainingNode(): ElkNode | null
  setContainingNode(value: ElkNode | null): void
  getSources(): EList<ElkConnectableShape>
  getTargets(): EList<ElkConnectableShape>
  getSections(): EList<ElkEdgeSection>
  isHyperedge(): boolean
  isHierarchical(): boolean
  isSelfloop(): boolean
  isConnected(): boolean
}
