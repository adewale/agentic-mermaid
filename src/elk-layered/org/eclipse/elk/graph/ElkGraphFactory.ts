/**
 * Copyright (c) 2016 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import type { EFactory } from '../../emf/ecore/EFactory.ts'
import type { EObject } from '../../emf/ecore/EObject.ts'
import type { EClass } from '../../emf/ecore/EClass.ts'
import type { BasicEMap } from '../../emf/common/util/BasicEMap.ts'
import type { IProperty } from './properties/IProperty.ts'
import type { ElkNode } from './ElkNode.ts'
import type { ElkPort } from './ElkPort.ts'
import type { ElkLabel } from './ElkLabel.ts'
import type { ElkEdge } from './ElkEdge.ts'
import type { ElkBendPoint } from './ElkBendPoint.ts'
import type { ElkEdgeSection } from './ElkEdgeSection.ts'
import type { ElkGraphPackage } from './ElkGraphPackage.ts'

export abstract class ElkGraphFactory implements EFactory {
  static get eINSTANCE(): ElkGraphFactory { return (require('./impl/ElkGraphFactoryImpl.ts') as { ElkGraphFactoryImpl: { init(): ElkGraphFactory } }).ElkGraphFactoryImpl.init() }
  abstract create(eClass: EClass): EObject
  abstract createElkLabel(): ElkLabel
  abstract createElkNode(): ElkNode
  abstract createElkPort(): ElkPort
  abstract createElkEdge(): ElkEdge
  abstract createElkBendPoint(): ElkBendPoint
  abstract createElkEdgeSection(): ElkEdgeSection
  abstract getElkGraphPackage(): ElkGraphPackage
  abstract createElkPropertyToValueMapEntry(): BasicEMap.Entry<IProperty<unknown>, unknown>
}
