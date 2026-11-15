/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Class } from '../../../../../java/lang/Class.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import type { NotificationChain } from '../../../emf/common/notify/NotificationChain.ts'
import { Notification } from '../../../emf/common/notify/Notification.ts'
import type { EClass } from '../../../emf/ecore/EClass.ts'
import type { EStructuralFeature } from '../../../emf/ecore/EStructuralFeature.ts'
import type { InternalEObject } from '../../../emf/ecore/InternalEObject.ts'
import { ENotificationImpl } from '../../../emf/ecore/impl/ENotificationImpl.ts'
import { ElkGraphPackage } from '../ElkGraphPackage.ts'
import { ElkConnectableShape } from '../ElkConnectableShape.ts'
import { ElkEdge } from '../ElkEdge.ts'
import { EObjectWithInverseResolvingEList } from '../../../emf/ecore/util/EObjectWithInverseResolvingEList.ts'
import { ElkShapeImpl } from './ElkShapeImpl.ts'

export abstract class ElkConnectableShapeImpl extends ElkShapeImpl implements ElkConnectableShape {
  static override readonly javaName: string = 'org.eclipse.elk.graph.impl.ElkConnectableShapeImpl'
  readonly [ElkConnectableShape] = true
  protected outgoingEdges: EObjectWithInverseResolvingEList.ManyInverse<ElkEdge> | null = null
  protected incomingEdges: EObjectWithInverseResolvingEList.ManyInverse<ElkEdge> | null = null
  protected override eStaticClass(): EClass { return ElkGraphPackage.Literals.ELK_CONNECTABLE_SHAPE }
  getOutgoingEdges(): EObjectWithInverseResolvingEList.ManyInverse<ElkEdge> { return this.outgoingEdges ??= new EObjectWithInverseResolvingEList.ManyInverse(Class.interfaceOf(ElkEdge), this, ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES, ElkGraphPackage.ELK_EDGE__SOURCES) }
  getIncomingEdges(): EObjectWithInverseResolvingEList.ManyInverse<ElkEdge> { return this.incomingEdges ??= new EObjectWithInverseResolvingEList.ManyInverse(Class.interfaceOf(ElkEdge), this, ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES, ElkGraphPackage.ELK_EDGE__TARGETS) }
  override eInverseAdd(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    if (arguments.length === 4) return super.eInverseAdd(otherEnd, featureID, third as Class<unknown> | null, fourth!)
    const msgs = third as NotificationChain | null
    switch (featureID) {
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES: return this.getOutgoingEdges().basicAdd(otherEnd as unknown as ElkEdge, msgs)
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES: return this.getIncomingEdges().basicAdd(otherEnd as unknown as ElkEdge, msgs)
    }
    return super.eInverseAdd(otherEnd, featureID, msgs)
  }
  override eInverseRemove(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    if (arguments.length === 4) return super.eInverseRemove(otherEnd, featureID, third as Class<unknown> | null, fourth!)
    const msgs = third as NotificationChain | null
    switch (featureID) {
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES: return this.getOutgoingEdges().basicRemove(otherEnd as unknown as ElkEdge, msgs)
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES: return this.getIncomingEdges().basicRemove(otherEnd as unknown as ElkEdge, msgs)
    }
    return super.eInverseRemove(otherEnd, featureID, msgs)
  }
  override eGet(featureID: number | EStructuralFeature, resolve = true, coreType = true): unknown {
    switch (featureID) {
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES: return this.getOutgoingEdges()
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES: return this.getIncomingEdges()
    }
    return super.eGet(featureID, resolve, coreType)
  }
  override eSet(featureID: number | EStructuralFeature, newValue: unknown): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES: this.getOutgoingEdges().clear(); this.getOutgoingEdges().addAll(newValue as Collection<ElkEdge>); return
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES: this.getIncomingEdges().clear(); this.getIncomingEdges().addAll(newValue as Collection<ElkEdge>); return
    }
    super.eSet(featureID, newValue)
  }
  override eUnset(featureID: number | EStructuralFeature): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES: this.getOutgoingEdges().clear(); return
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES: this.getIncomingEdges().clear(); return
    }
    super.eUnset(featureID)
  }
  override eIsSet(featureID: number | EStructuralFeature): boolean {
    switch (featureID) {
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES: return this.outgoingEdges !== null && !this.outgoingEdges.isEmpty()
      case ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES: return this.incomingEdges !== null && !this.incomingEdges.isEmpty()
    }
    return super.eIsSet(featureID)
  }
}
