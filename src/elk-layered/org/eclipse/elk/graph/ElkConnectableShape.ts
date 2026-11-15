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
import type { ElkEdge } from './ElkEdge.ts'
import type { ElkShape } from './ElkShape.ts'

export const ElkConnectableShape = Symbol('org.eclipse.elk.graph.ElkConnectableShape')

export interface ElkConnectableShape extends ElkShape {
  readonly [ElkConnectableShape]: true
  getOutgoingEdges(): EList<ElkEdge>
  getIncomingEdges(): EList<ElkEdge>
}

export function isElkConnectableShape(value: unknown): value is ElkConnectableShape { return value !== null && typeof value === 'object' && (value as ElkConnectableShape)[ElkConnectableShape] === true }
