/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { JavaIterable } from '../../../../../java/lang/Iterable.ts'
import { Iterables } from '../../../../../com/google/common/collect/Iterables.ts'
import type { ElkConnectableShape } from '../ElkConnectableShape.ts'
import type { ElkEdge } from '../ElkEdge.ts'
import { type ElkNode, isElkNode } from '../ElkNode.ts'
import { isElkPort } from '../ElkPort.ts'

export class ElkGraphUtil {
  static allIncidentShapes(edge: ElkEdge): JavaIterable<ElkConnectableShape> { return Iterables.concat(edge.getSources(), edge.getTargets()) }
  static connectableShapeToNode(connectableShape: ElkConnectableShape | null): ElkNode | null {
    if (isElkNode(connectableShape)) return connectableShape
    if (isElkPort(connectableShape)) return connectableShape.getParent()
    if (connectableShape === null) throw new TypeError('connectableShape cannot be null')
    throw new Error('Only support nodes and ports.')
  }
}
