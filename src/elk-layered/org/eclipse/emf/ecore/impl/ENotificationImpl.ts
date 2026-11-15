/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Class } from '../../../../../java/lang/Class.ts'
import { Notification } from '../../common/notify/Notification.ts'
import { NotificationImpl } from '../../common/notify/impl/NotificationImpl.ts'
import type { EStructuralFeature } from '../EStructuralFeature.ts'
import type { InternalEObject } from '../InternalEObject.ts'

export class ENotificationImpl extends NotificationImpl {
  protected notifier: InternalEObject
  protected featureID = Notification.NO_FEATURE_ID
  protected feature: EStructuralFeature | null = null
  constructor(notifier: InternalEObject, eventType: number, feature: number | EStructuralFeature, oldValue: unknown, newValue: unknown, positionOrIsSetChange: number | boolean = Notification.NO_INDEX, wasSet?: boolean, primitiveType = NotificationImpl.PRIMITIVE_TYPE_OBJECT) {
    super(eventType, oldValue, newValue, positionOrIsSetChange, wasSet, primitiveType)
    this.notifier = notifier
    if (typeof feature === 'number') this.featureID = feature
    else this.feature = feature
  }
  override getNotifier(): InternalEObject { return this.notifier }
  override getFeature(): EStructuralFeature | null {
    if (this.feature === null && this.featureID !== Notification.NO_FEATURE_ID) this.feature = this.notifier.eClass().getEStructuralFeature(this.featureID)
    return this.feature
  }
  override getFeatureID(expectedClass: Class<unknown> | null): number {
    if (this.featureID === Notification.NO_FEATURE_ID && this.feature !== null) this.featureID = this.notifier.eDerivedStructuralFeatureID(this.feature.getFeatureID(), this.feature.getContainerClass())
    return this.notifier.eBaseStructuralFeatureID(this.featureID, expectedClass)
  }
  protected override getFeatureDefaultValue(): unknown { return this.getFeature()?.getDefaultValue() ?? null }
  protected override isFeatureUnsettable(): boolean { return this.getFeature()?.isUnsettable() ?? false }
}
