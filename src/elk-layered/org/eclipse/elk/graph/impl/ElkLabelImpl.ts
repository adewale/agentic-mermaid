/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Class } from '../../../../../java/lang/Class.ts'
import { IllegalArgumentException } from '../../../../../java/lang/IllegalArgumentException.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import { Strings } from '../../../../../com/google/common/base/Strings.ts'
import type { NotificationChain } from '../../../emf/common/notify/NotificationChain.ts'
import { Notification } from '../../../emf/common/notify/Notification.ts'
import type { EClass } from '../../../emf/ecore/EClass.ts'
import type { EStructuralFeature } from '../../../emf/ecore/EStructuralFeature.ts'
import type { InternalEObject } from '../../../emf/ecore/InternalEObject.ts'
import { ENotificationImpl } from '../../../emf/ecore/impl/ENotificationImpl.ts'
import { EcoreUtil } from '../../../emf/ecore/util/EcoreUtil.ts'
import { EObjectContainmentWithInverseEList } from '../../../emf/ecore/util/EObjectContainmentWithInverseEList.ts'
import { ElkGraphPackage } from '../ElkGraphPackage.ts'
import { ElkLabel } from '../ElkLabel.ts'
import { ElkGraphElement } from '../ElkGraphElement.ts'
import { ElkShapeImpl } from './ElkShapeImpl.ts'

export class ElkLabelImpl extends ElkShapeImpl implements ElkLabel {
  static override readonly javaName: string = 'org.eclipse.elk.graph.impl.ElkLabelImpl'
  readonly [ElkLabel] = true
  protected static readonly TEXT_EDEFAULT = ''
  protected text: string | null = ElkLabelImpl.TEXT_EDEFAULT
  protected override eStaticClass(): EClass { return ElkGraphPackage.Literals.ELK_LABEL }
  getParent(): ElkGraphElement | null { return this.eContainerFeatureID() !== ElkGraphPackage.ELK_LABEL__PARENT ? null : this.eInternalContainer() as unknown as ElkGraphElement | null }
  basicSetParent(newParent: ElkGraphElement | null, msgs: NotificationChain | null): NotificationChain | null { return this.eBasicSetContainer(newParent as unknown as InternalEObject | null, ElkGraphPackage.ELK_LABEL__PARENT, msgs) }
  setParent(newParent: ElkGraphElement | null): void {
    if (newParent !== (this.eInternalContainer() as unknown) || this.eContainerFeatureID() !== ElkGraphPackage.ELK_LABEL__PARENT && newParent !== null) {
      if (EcoreUtil.isAncestor(this, newParent)) throw new IllegalArgumentException('Recursive containment not allowed for ' + this.toString())
      let msgs: NotificationChain | null = null
      if (this.eInternalContainer() !== null) msgs = this.eBasicRemoveFromContainer(msgs)
      if (newParent !== null) msgs = (newParent as unknown as InternalEObject).eInverseAdd(this, ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS, Class.interfaceOf(ElkGraphElement), msgs)
      msgs = this.basicSetParent(newParent, msgs)
      if (msgs !== null) msgs.dispatch()
    } else if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_LABEL__PARENT, newParent, newParent))
  }
  getText(): string | null { return this.text }
  setText(newText: string | null): void { const oldText = this.text; this.text = newText; if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_LABEL__TEXT, oldText, this.text)) }
  override eInverseAdd(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    if (arguments.length === 4) return super.eInverseAdd(otherEnd, featureID, third as Class<unknown> | null, fourth!)
    let msgs = third as NotificationChain | null
    switch (featureID) {
      case ElkGraphPackage.ELK_LABEL__PARENT:
        if (this.eInternalContainer() !== null) msgs = this.eBasicRemoveFromContainer(msgs)
        return this.basicSetParent(otherEnd as unknown as ElkGraphElement, msgs)
    }
    return super.eInverseAdd(otherEnd, featureID, msgs)
  }
  override eInverseRemove(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    if (arguments.length === 4) return super.eInverseRemove(otherEnd, featureID, third as Class<unknown> | null, fourth!)
    let msgs = third as NotificationChain | null
    switch (featureID) {
      case ElkGraphPackage.ELK_LABEL__PARENT:
        return this.basicSetParent(null, msgs)
    }
    return super.eInverseRemove(otherEnd, featureID, msgs)
  }
  override eBasicRemoveFromContainerFeature(msgs: NotificationChain | null): NotificationChain | null {
    if (this.eContainerFeatureID() === ElkGraphPackage.ELK_LABEL__PARENT) return this.eInternalContainer()!.eInverseRemove(this, ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS, Class.interfaceOf(ElkGraphElement), msgs)
    return super.eBasicRemoveFromContainerFeature(msgs)
  }
  override eGet(featureID: number | EStructuralFeature, resolve = true, coreType = true): unknown {
    switch (featureID) {
      case ElkGraphPackage.ELK_LABEL__PARENT: return this.getParent()
      case ElkGraphPackage.ELK_LABEL__TEXT: return this.getText()
    }
    return super.eGet(featureID, resolve, coreType)
  }
  override eSet(featureID: number | EStructuralFeature, newValue: unknown): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_LABEL__PARENT: this.setParent(newValue as ElkGraphElement | null); return
      case ElkGraphPackage.ELK_LABEL__TEXT: this.setText(newValue as string | null); return
    }
    super.eSet(featureID, newValue)
  }
  override eUnset(featureID: number | EStructuralFeature): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_LABEL__PARENT: this.setParent(null); return
      case ElkGraphPackage.ELK_LABEL__TEXT: this.setText(ElkLabelImpl.TEXT_EDEFAULT); return
    }
    super.eUnset(featureID)
  }
  override eIsSet(featureID: number | EStructuralFeature): boolean {
    switch (featureID) {
      case ElkGraphPackage.ELK_LABEL__PARENT: return this.getParent() !== null
      case ElkGraphPackage.ELK_LABEL__TEXT: return this.text !== ElkLabelImpl.TEXT_EDEFAULT
    }
    return super.eIsSet(featureID)
  }
  override toString(): string {
    if (this.eIsProxy()) return super.toString()
    let builder = 'ElkLabel'
    if (!Strings.isNullOrEmpty(this.text)) builder += ' "' + this.text + '"'
    return builder + ' (' + this.x + ',' + this.y + ' | ' + this.width + ',' + this.height + ')'
  }
}
