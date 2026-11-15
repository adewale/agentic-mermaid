/*******************************************************************************
 * Copyright (c) 2016 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { ElkBendPoint } from '../ElkBendPoint.ts'
import { ElkGraphPackage } from '../ElkGraphPackage.ts'
import type { EClass } from '../../../emf/ecore/EClass.ts'
import type { EStructuralFeature } from '../../../emf/ecore/EStructuralFeature.ts'
import { MinimalEObjectImpl } from '../../../emf/ecore/impl/MinimalEObjectImpl.ts'
import { ENotificationImpl } from '../../../emf/ecore/impl/ENotificationImpl.ts'
import { Notification } from '../../../emf/common/notify/Notification.ts'

export class ElkBendPointImpl extends MinimalEObjectImpl.Container implements ElkBendPoint {
  static readonly javaName = 'org.eclipse.elk.graph.impl.ElkBendPointImpl'
  readonly [ElkBendPoint] = true
  protected static readonly X_EDEFAULT = 0
  protected x = ElkBendPointImpl.X_EDEFAULT
  protected static readonly Y_EDEFAULT = 0
  protected y = ElkBendPointImpl.Y_EDEFAULT
  protected eStaticClass(): EClass { return ElkGraphPackage.Literals.ELK_BEND_POINT }
  getX(): number { return this.x }
  setX(newX: number): void {
    const oldX = this.x
    this.x = newX
    if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_BEND_POINT__X, oldX, this.x, Notification.NO_INDEX, undefined, ENotificationImpl.PRIMITIVE_TYPE_DOUBLE))
  }
  getY(): number { return this.y }
  setY(newY: number): void {
    const oldY = this.y
    this.y = newY
    if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_BEND_POINT__Y, oldY, this.y, Notification.NO_INDEX, undefined, ENotificationImpl.PRIMITIVE_TYPE_DOUBLE))
  }
  set(x: number, y: number): void { this.setX(x); this.setY(y) }
  override eGet(featureID: number | EStructuralFeature, resolve = true, coreType = true): unknown {
    switch (featureID) {
      case ElkGraphPackage.ELK_BEND_POINT__X: return this.getX()
      case ElkGraphPackage.ELK_BEND_POINT__Y: return this.getY()
    }
    return super.eGet(featureID, resolve, coreType)
  }
  override eSet(featureID: number | EStructuralFeature, newValue: unknown): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_BEND_POINT__X: this.setX(newValue as number); return
      case ElkGraphPackage.ELK_BEND_POINT__Y: this.setY(newValue as number); return
    }
    super.eSet(featureID, newValue)
  }
  override eUnset(featureID: number | EStructuralFeature): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_BEND_POINT__X: this.setX(ElkBendPointImpl.X_EDEFAULT); return
      case ElkGraphPackage.ELK_BEND_POINT__Y: this.setY(ElkBendPointImpl.Y_EDEFAULT); return
    }
    super.eUnset(featureID)
  }
  override eIsSet(featureID: number | EStructuralFeature): boolean {
    switch (featureID) {
      case ElkGraphPackage.ELK_BEND_POINT__X: return this.x !== ElkBendPointImpl.X_EDEFAULT
      case ElkGraphPackage.ELK_BEND_POINT__Y: return this.y !== ElkBendPointImpl.Y_EDEFAULT
    }
    return super.eIsSet(featureID)
  }
  override toString(): string { if (this.eIsProxy()) return super.toString(); return super.toString() + ' (x: ' + this.x + ', y: ' + this.y + ')' }
}
