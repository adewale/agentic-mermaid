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
import { ElkNode } from '../ElkNode.ts'
import { ElkConnectableShape } from '../ElkConnectableShape.ts'
import { ElkEdgeSection } from '../ElkEdgeSection.ts'
import { EObjectWithInverseResolvingEList } from '../../../emf/ecore/util/EObjectWithInverseResolvingEList.ts'
import { ElkGraphUtil } from '../util/ElkGraphUtil.ts'
import { Joiner } from '../../../../../com/google/common/base/Joiner.ts'
import { ElkEdge } from '../ElkEdge.ts'
import { ElkGraphElementImpl } from './ElkGraphElementImpl.ts'

export class ElkEdgeImpl extends ElkGraphElementImpl implements ElkEdge {
  static override readonly javaName: string = 'org.eclipse.elk.graph.impl.ElkEdgeImpl'
  readonly [ElkEdge] = true
  protected sources: EObjectWithInverseResolvingEList.ManyInverse<ElkConnectableShape> | null = null
  protected targets: EObjectWithInverseResolvingEList.ManyInverse<ElkConnectableShape> | null = null
  protected sections: EObjectContainmentWithInverseEList<ElkEdgeSection> | null = null
  protected static readonly HYPEREDGE_EDEFAULT = false
  protected static readonly HIERARCHICAL_EDEFAULT = false
  protected static readonly SELFLOOP_EDEFAULT = false
  protected static readonly CONNECTED_EDEFAULT = false
  protected override eStaticClass(): EClass { return ElkGraphPackage.Literals.ELK_EDGE }
  getContainingNode(): ElkNode | null { return this.eContainerFeatureID() !== ElkGraphPackage.ELK_EDGE__CONTAINING_NODE ? null : this.eInternalContainer() as unknown as ElkNode | null }
  basicSetContainingNode(newContainingNode: ElkNode | null, msgs: NotificationChain | null): NotificationChain | null { return this.eBasicSetContainer(newContainingNode as unknown as InternalEObject | null, ElkGraphPackage.ELK_EDGE__CONTAINING_NODE, msgs) }
  setContainingNode(newContainingNode: ElkNode | null): void {
    if (newContainingNode !== (this.eInternalContainer() as unknown) || this.eContainerFeatureID() !== ElkGraphPackage.ELK_EDGE__CONTAINING_NODE && newContainingNode !== null) {
      if (EcoreUtil.isAncestor(this, newContainingNode)) throw new IllegalArgumentException('Recursive containment not allowed for ' + this.toString())
      let msgs: NotificationChain | null = null
      if (this.eInternalContainer() !== null) msgs = this.eBasicRemoveFromContainer(msgs)
      if (newContainingNode !== null) msgs = (newContainingNode as unknown as InternalEObject).eInverseAdd(this, ElkGraphPackage.ELK_NODE__CONTAINED_EDGES, Class.interfaceOf(ElkNode), msgs)
      msgs = this.basicSetContainingNode(newContainingNode, msgs)
      if (msgs !== null) msgs.dispatch()
    } else if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_EDGE__CONTAINING_NODE, newContainingNode, newContainingNode))
  }
  getSources(): EObjectWithInverseResolvingEList.ManyInverse<ElkConnectableShape> { return this.sources ??= new EObjectWithInverseResolvingEList.ManyInverse(Class.interfaceOf(ElkConnectableShape), this, ElkGraphPackage.ELK_EDGE__SOURCES, ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES) }
  getTargets(): EObjectWithInverseResolvingEList.ManyInverse<ElkConnectableShape> { return this.targets ??= new EObjectWithInverseResolvingEList.ManyInverse(Class.interfaceOf(ElkConnectableShape), this, ElkGraphPackage.ELK_EDGE__TARGETS, ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES) }
  getSections(): EObjectContainmentWithInverseEList<ElkEdgeSection> { return this.sections ??= new EObjectContainmentWithInverseEList(Class.interfaceOf(ElkEdgeSection), this, ElkGraphPackage.ELK_EDGE__SECTIONS, ElkGraphPackage.ELK_EDGE_SECTION__PARENT) }
  isHyperedge(): boolean { return !(this.getSources().size() <= 1 && this.getTargets().size() <= 1) }
  isHierarchical(): boolean {
    let commonRepresentingNode: ElkNode | null = null
    for (const incidentShape of ElkGraphUtil.allIncidentShapes(this)) {
      const shapeNode = ElkGraphUtil.connectableShapeToNode(incidentShape)!
      if (commonRepresentingNode === null) commonRepresentingNode = shapeNode.getParent()
      else if (commonRepresentingNode !== shapeNode.getParent()) return true
    }
    return false
  }
  isSelfloop(): boolean {
    let commonNode: ElkNode | null = null
    for (const incidentShape of ElkGraphUtil.allIncidentShapes(this)) {
      const shapeNode = ElkGraphUtil.connectableShapeToNode(incidentShape)
      if (commonNode === null) commonNode = shapeNode
      else if (commonNode !== shapeNode) return false
    }
    return true
  }
  isConnected(): boolean { return !this.getSources().isEmpty() && !this.getTargets().isEmpty() }
  override eInverseAdd(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    if (arguments.length === 4) return super.eInverseAdd(otherEnd, featureID, third as Class<unknown> | null, fourth!)
    let msgs = third as NotificationChain | null
    switch (featureID) {
      case ElkGraphPackage.ELK_EDGE__CONTAINING_NODE:
        if (this.eInternalContainer() !== null) msgs = this.eBasicRemoveFromContainer(msgs)
        return this.basicSetContainingNode(otherEnd as unknown as ElkNode, msgs)
      case ElkGraphPackage.ELK_EDGE__SOURCES: return this.getSources().basicAdd(otherEnd as unknown as ElkConnectableShape, msgs)
      case ElkGraphPackage.ELK_EDGE__TARGETS: return this.getTargets().basicAdd(otherEnd as unknown as ElkConnectableShape, msgs)
      case ElkGraphPackage.ELK_EDGE__SECTIONS: return this.getSections().basicAdd(otherEnd as unknown as ElkEdgeSection, msgs)
    }
    return super.eInverseAdd(otherEnd, featureID, msgs)
  }
  override eInverseRemove(otherEnd: InternalEObject, featureID: number, third: Class<unknown> | NotificationChain | null, fourth?: NotificationChain | null): NotificationChain | null {
    if (arguments.length === 4) return super.eInverseRemove(otherEnd, featureID, third as Class<unknown> | null, fourth!)
    let msgs = third as NotificationChain | null
    switch (featureID) {
      case ElkGraphPackage.ELK_EDGE__CONTAINING_NODE:
        return this.basicSetContainingNode(null, msgs)
      case ElkGraphPackage.ELK_EDGE__SOURCES: return this.getSources().basicRemove(otherEnd as unknown as ElkConnectableShape, msgs)
      case ElkGraphPackage.ELK_EDGE__TARGETS: return this.getTargets().basicRemove(otherEnd as unknown as ElkConnectableShape, msgs)
      case ElkGraphPackage.ELK_EDGE__SECTIONS: return this.getSections().basicRemove(otherEnd as unknown as ElkEdgeSection, msgs)
    }
    return super.eInverseRemove(otherEnd, featureID, msgs)
  }
  override eBasicRemoveFromContainerFeature(msgs: NotificationChain | null): NotificationChain | null {
    if (this.eContainerFeatureID() === ElkGraphPackage.ELK_EDGE__CONTAINING_NODE) return this.eInternalContainer()!.eInverseRemove(this, ElkGraphPackage.ELK_NODE__CONTAINED_EDGES, Class.interfaceOf(ElkNode), msgs)
    return super.eBasicRemoveFromContainerFeature(msgs)
  }
  override eGet(featureID: number | EStructuralFeature, resolve = true, coreType = true): unknown {
    switch (featureID) {
      case ElkGraphPackage.ELK_EDGE__CONTAINING_NODE: return this.getContainingNode()
      case ElkGraphPackage.ELK_EDGE__SOURCES: return this.getSources()
      case ElkGraphPackage.ELK_EDGE__TARGETS: return this.getTargets()
      case ElkGraphPackage.ELK_EDGE__SECTIONS: return this.getSections()
      case ElkGraphPackage.ELK_EDGE__HYPEREDGE: return this.isHyperedge()
      case ElkGraphPackage.ELK_EDGE__HIERARCHICAL: return this.isHierarchical()
      case ElkGraphPackage.ELK_EDGE__SELFLOOP: return this.isSelfloop()
      case ElkGraphPackage.ELK_EDGE__CONNECTED: return this.isConnected()
    }
    return super.eGet(featureID, resolve, coreType)
  }
  override eSet(featureID: number | EStructuralFeature, newValue: unknown): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_EDGE__CONTAINING_NODE: this.setContainingNode(newValue as ElkNode | null); return
      case ElkGraphPackage.ELK_EDGE__SOURCES: this.getSources().clear(); this.getSources().addAll(newValue as Collection<ElkConnectableShape>); return
      case ElkGraphPackage.ELK_EDGE__TARGETS: this.getTargets().clear(); this.getTargets().addAll(newValue as Collection<ElkConnectableShape>); return
      case ElkGraphPackage.ELK_EDGE__SECTIONS: this.getSections().clear(); this.getSections().addAll(newValue as Collection<ElkEdgeSection>); return
    }
    super.eSet(featureID, newValue)
  }
  override eUnset(featureID: number | EStructuralFeature): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_EDGE__CONTAINING_NODE: this.setContainingNode(null); return
      case ElkGraphPackage.ELK_EDGE__SOURCES: this.getSources().clear(); return
      case ElkGraphPackage.ELK_EDGE__TARGETS: this.getTargets().clear(); return
      case ElkGraphPackage.ELK_EDGE__SECTIONS: this.getSections().clear(); return
    }
    super.eUnset(featureID)
  }
  override eIsSet(featureID: number | EStructuralFeature): boolean {
    switch (featureID) {
      case ElkGraphPackage.ELK_EDGE__CONTAINING_NODE: return this.getContainingNode() !== null
      case ElkGraphPackage.ELK_EDGE__SOURCES: return this.sources !== null && !this.sources.isEmpty()
      case ElkGraphPackage.ELK_EDGE__TARGETS: return this.targets !== null && !this.targets.isEmpty()
      case ElkGraphPackage.ELK_EDGE__SECTIONS: return this.sections !== null && !this.sections.isEmpty()
      case ElkGraphPackage.ELK_EDGE__HYPEREDGE: return this.isHyperedge() !== ElkEdgeImpl.HYPEREDGE_EDEFAULT
      case ElkGraphPackage.ELK_EDGE__HIERARCHICAL: return this.isHierarchical() !== ElkEdgeImpl.HIERARCHICAL_EDEFAULT
      case ElkGraphPackage.ELK_EDGE__SELFLOOP: return this.isSelfloop() !== ElkEdgeImpl.SELFLOOP_EDEFAULT
      case ElkGraphPackage.ELK_EDGE__CONNECTED: return this.isConnected() !== ElkEdgeImpl.CONNECTED_EDEFAULT
    }
    return super.eIsSet(featureID)
  }
  override toString(): string {
    if (this.eIsProxy()) return super.toString()
    let builder = 'ElkEdge'
    const id = this.getIdentifier()
    if (!Strings.isNullOrEmpty(id)) builder += ' "' + id + '"'
    else if (this.getLabels().size() > 0) { const text = this.getLabels().get(0).getText(); if (!Strings.isNullOrEmpty(text)) builder += ' "' + text + '"' }
    const hyperedge = this.isHyperedge()
    builder += hyperedge ? ' [' : ' '
    builder += Joiner.on(', ').join(this.sources!)
    if (hyperedge) builder += ']'
    builder += ' -> '
    if (hyperedge) builder += '['
    builder += Joiner.on(', ').join(this.targets!)
    if (hyperedge) builder += ']'
    return builder
  }
}
