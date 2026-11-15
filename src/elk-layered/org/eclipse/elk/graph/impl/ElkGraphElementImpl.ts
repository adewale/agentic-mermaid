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
import { ElkGraphElement } from '../ElkGraphElement.ts'
import { ElkLabel } from '../ElkLabel.ts'
import { EObjectContainmentWithInverseEList } from '../../../emf/ecore/util/EObjectContainmentWithInverseEList.ts'
import { EMapPropertyHolderImpl } from './EMapPropertyHolderImpl.ts'

export abstract class ElkGraphElementImpl extends EMapPropertyHolderImpl implements ElkGraphElement {
  static override readonly javaName: string = 'org.eclipse.elk.graph.impl.ElkGraphElementImpl'
  readonly [ElkGraphElement] = true
  protected labels: EObjectContainmentWithInverseEList<ElkLabel> | null = null
  protected static readonly IDENTIFIER_EDEFAULT: string | null = null
  protected identifier = ElkGraphElementImpl.IDENTIFIER_EDEFAULT
  protected override eStaticClass(): EClass { return ElkGraphPackage.Literals.ELK_GRAPH_ELEMENT }
  getLabels(): EObjectContainmentWithInverseEList<ElkLabel> { return this.labels ??= new EObjectContainmentWithInverseEList(Class.interfaceOf(ElkLabel), this, ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS, ElkGraphPackage.ELK_LABEL__PARENT) }
  getIdentifier(): string | null { return this.identifier }
  setIdentifier(newIdentifier: string | null): void { const oldIdentifier = this.identifier; this.identifier = newIdentifier; if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_GRAPH_ELEMENT__IDENTIFIER, oldIdentifier, this.identifier)) }
  override eInverseAdd(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    if (arguments.length === 4) return super.eInverseAdd(otherEnd, featureID, third as Class<unknown> | null, fourth!)
    const msgs = third as NotificationChain | null
    if (featureID === ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS) return this.getLabels().basicAdd(otherEnd as unknown as ElkLabel, msgs)
    return super.eInverseAdd(otherEnd, featureID, msgs)
  }
  override eInverseRemove(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    if (arguments.length === 4) return super.eInverseRemove(otherEnd, featureID, third as Class<unknown> | null, fourth!)
    const msgs = third as NotificationChain | null
    if (featureID === ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS) return this.getLabels().basicRemove(otherEnd as unknown as ElkLabel, msgs)
    return super.eInverseRemove(otherEnd, featureID, msgs)
  }
  override eGet(featureID: number | EStructuralFeature, resolve = true, coreType = true): unknown {
    switch (featureID) { case ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS: return this.getLabels(); case ElkGraphPackage.ELK_GRAPH_ELEMENT__IDENTIFIER: return this.getIdentifier() }
    return super.eGet(featureID, resolve, coreType)
  }
  override eSet(featureID: number | EStructuralFeature, newValue: unknown): void {
    switch (featureID) { case ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS: this.getLabels().clear(); this.getLabels().addAll(newValue as Collection<ElkLabel>); return; case ElkGraphPackage.ELK_GRAPH_ELEMENT__IDENTIFIER: this.setIdentifier(newValue as string | null); return }
    super.eSet(featureID, newValue)
  }
  override eUnset(featureID: number | EStructuralFeature): void {
    switch (featureID) { case ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS: this.getLabels().clear(); return; case ElkGraphPackage.ELK_GRAPH_ELEMENT__IDENTIFIER: this.setIdentifier(ElkGraphElementImpl.IDENTIFIER_EDEFAULT); return }
    super.eUnset(featureID)
  }
  override eIsSet(featureID: number | EStructuralFeature): boolean {
    switch (featureID) { case ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS: return this.labels !== null && !this.labels.isEmpty(); case ElkGraphPackage.ELK_GRAPH_ELEMENT__IDENTIFIER: return this.identifier !== null }
    return super.eIsSet(featureID)
  }
  override toString(): string { return this.eIsProxy() ? super.toString() : super.toString() + ' (identifier: ' + this.identifier + ')' }
}
