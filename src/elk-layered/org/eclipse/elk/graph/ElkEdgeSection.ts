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
import type { EMapPropertyHolder } from './EMapPropertyHolder.ts'
import type { ElkBendPoint } from './ElkBendPoint.ts'
import type { ElkConnectableShape } from './ElkConnectableShape.ts'
import type { ElkEdge } from './ElkEdge.ts'

export interface ElkEdgeSection extends EMapPropertyHolder {
  getStartX(): number
  setStartX(value: number): void
  getStartY(): number
  setStartY(value: number): void
  getEndX(): number
  setEndX(value: number): void
  getEndY(): number
  setEndY(value: number): void
  getBendPoints(): EList<ElkBendPoint>
  getParent(): ElkEdge | null
  setParent(value: ElkEdge | null): void
  getOutgoingShape(): ElkConnectableShape | null
  setOutgoingShape(value: ElkConnectableShape | null): void
  getIncomingShape(): ElkConnectableShape | null
  setIncomingShape(value: ElkConnectableShape | null): void
  getOutgoingSections(): EList<ElkEdgeSection>
  getIncomingSections(): EList<ElkEdgeSection>
  getIdentifier(): string | null
  setIdentifier(value: string | null): void
  setStartLocation(x: number, y: number): void
  setEndLocation(x: number, y: number): void
}
