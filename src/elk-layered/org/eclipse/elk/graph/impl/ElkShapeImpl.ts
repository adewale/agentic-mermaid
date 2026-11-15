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
import { ElkShape } from '../ElkShape.ts'
import { ElkGraphElementImpl } from './ElkGraphElementImpl.ts'

export abstract class ElkShapeImpl extends ElkGraphElementImpl implements ElkShape {
  static override readonly javaName: string = 'org.eclipse.elk.graph.impl.ElkShapeImpl'
  readonly [ElkShape] = true
  protected static readonly HEIGHT_EDEFAULT = 0
  protected height = ElkShapeImpl.HEIGHT_EDEFAULT
  protected static readonly WIDTH_EDEFAULT = 0
  protected width = ElkShapeImpl.WIDTH_EDEFAULT
  protected static readonly X_EDEFAULT = 0
  protected x = ElkShapeImpl.X_EDEFAULT
  protected static readonly Y_EDEFAULT = 0
  protected y = ElkShapeImpl.Y_EDEFAULT
  protected override eStaticClass(): EClass { return ElkGraphPackage.Literals.ELK_SHAPE }
  getHeight(): number { return this.height }
  setHeight(newHeight: number): void { const oldHeight = this.height; this.height = newHeight; if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_SHAPE__HEIGHT, oldHeight, this.height, Notification.NO_INDEX, undefined, ENotificationImpl.PRIMITIVE_TYPE_DOUBLE)) }
  getWidth(): number { return this.width }
  setWidth(newWidth: number): void { const oldWidth = this.width; this.width = newWidth; if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_SHAPE__WIDTH, oldWidth, this.width, Notification.NO_INDEX, undefined, ENotificationImpl.PRIMITIVE_TYPE_DOUBLE)) }
  getX(): number { return this.x }
  setX(newX: number): void { const oldX = this.x; this.x = newX; if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_SHAPE__X, oldX, this.x, Notification.NO_INDEX, undefined, ENotificationImpl.PRIMITIVE_TYPE_DOUBLE)) }
  getY(): number { return this.y }
  setY(newY: number): void { const oldY = this.y; this.y = newY; if (this.eNotificationRequired()) this.eNotify(new ENotificationImpl(this, Notification.SET, ElkGraphPackage.ELK_SHAPE__Y, oldY, this.y, Notification.NO_INDEX, undefined, ENotificationImpl.PRIMITIVE_TYPE_DOUBLE)) }
  setDimensions(width: number, height: number): void { this.setWidth(width); this.setHeight(height) }
  setLocation(x: number, y: number): void { this.setX(x); this.setY(y) }
  override eGet(featureID: number | EStructuralFeature, resolve = true, coreType = true): unknown {
    switch (featureID) {
      case ElkGraphPackage.ELK_SHAPE__HEIGHT: return this.getHeight()
      case ElkGraphPackage.ELK_SHAPE__WIDTH: return this.getWidth()
      case ElkGraphPackage.ELK_SHAPE__X: return this.getX()
      case ElkGraphPackage.ELK_SHAPE__Y: return this.getY()
    }
    return super.eGet(featureID, resolve, coreType)
  }
  override eSet(featureID: number | EStructuralFeature, newValue: unknown): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_SHAPE__HEIGHT: this.setHeight(newValue as number); return
      case ElkGraphPackage.ELK_SHAPE__WIDTH: this.setWidth(newValue as number); return
      case ElkGraphPackage.ELK_SHAPE__X: this.setX(newValue as number); return
      case ElkGraphPackage.ELK_SHAPE__Y: this.setY(newValue as number); return
    }
    super.eSet(featureID, newValue)
  }
  override eUnset(featureID: number | EStructuralFeature): void {
    switch (featureID) {
      case ElkGraphPackage.ELK_SHAPE__HEIGHT: this.setHeight(ElkShapeImpl.HEIGHT_EDEFAULT); return
      case ElkGraphPackage.ELK_SHAPE__WIDTH: this.setWidth(ElkShapeImpl.WIDTH_EDEFAULT); return
      case ElkGraphPackage.ELK_SHAPE__X: this.setX(ElkShapeImpl.X_EDEFAULT); return
      case ElkGraphPackage.ELK_SHAPE__Y: this.setY(ElkShapeImpl.Y_EDEFAULT); return
    }
    super.eUnset(featureID)
  }
  override eIsSet(featureID: number | EStructuralFeature): boolean {
    switch (featureID) {
      case ElkGraphPackage.ELK_SHAPE__HEIGHT: return this.height !== ElkShapeImpl.HEIGHT_EDEFAULT
      case ElkGraphPackage.ELK_SHAPE__WIDTH: return this.width !== ElkShapeImpl.WIDTH_EDEFAULT
      case ElkGraphPackage.ELK_SHAPE__X: return this.x !== ElkShapeImpl.X_EDEFAULT
      case ElkGraphPackage.ELK_SHAPE__Y: return this.y !== ElkShapeImpl.Y_EDEFAULT
    }
    return super.eIsSet(featureID)
  }
  override toString(): string { return this.eIsProxy() ? super.toString() : super.toString() + ' (height: ' + this.height + ', width: ' + this.width + ', x: ' + this.x + ', y: ' + this.y + ')' }
}
