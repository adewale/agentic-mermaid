/**
 * Copyright (c) 2016 Kiel University and others.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import type { ElkConnectableShape } from './ElkConnectableShape.ts'
import type { ElkNode } from './ElkNode.ts'

export const ElkPort = Symbol('org.eclipse.elk.graph.ElkPort')

export interface ElkPort extends ElkConnectableShape {
  readonly [ElkPort]: true
  getParent(): ElkNode | null
  setParent(value: ElkNode | null): void
}

export function isElkPort(value: unknown): value is ElkPort { return value !== null && typeof value === 'object' && (value as ElkPort)[ElkPort] === true }
