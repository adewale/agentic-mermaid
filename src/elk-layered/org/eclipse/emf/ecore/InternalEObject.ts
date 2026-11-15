/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Class } from '../../../../java/lang/Class.ts'
import type { NotificationChain } from '../common/notify/NotificationChain.ts'
import type { Notifier } from '../common/notify/Notifier.ts'
import type { EObject } from './EObject.ts'
import type { EReference } from './EReference.ts'
import type { EStructuralFeature } from './EStructuralFeature.ts'

export const InternalEObject = { EOPPOSITE_FEATURE_BASE: -1 } as const
export interface InternalEObject extends EObject, Notifier {
  eInternalContainer(): InternalEObject | null
  eContainerFeatureID(): number
  eIsProxy(): boolean
  eNotificationRequired(): boolean
  eDerivedStructuralFeatureID(featureID: number, baseClass: Class<unknown> | null): number
  eBaseStructuralFeatureID(featureID: number, baseClass: Class<unknown> | null): number
  eInverseAdd(otherEnd: InternalEObject, featureID: number, msgs: NotificationChain | null): NotificationChain | null
  eInverseAdd(otherEnd: InternalEObject, featureID: number, baseClass: Class<unknown> | null, msgs: NotificationChain | null): NotificationChain | null
  eInverseRemove(otherEnd: InternalEObject, featureID: number, msgs: NotificationChain | null): NotificationChain | null
  eInverseRemove(otherEnd: InternalEObject, featureID: number, baseClass: Class<unknown> | null, msgs: NotificationChain | null): NotificationChain | null
  eBasicSetContainer(container: InternalEObject | null, featureID: number, msgs: NotificationChain | null): NotificationChain | null
  eBasicRemoveFromContainer(msgs: NotificationChain | null): NotificationChain | null
  eContainmentFeature(): EReference | null
  eGet(feature: number | EStructuralFeature, resolve?: boolean, coreType?: boolean): unknown
  eSet(feature: number | EStructuralFeature, value: unknown): void
  eUnset(feature: number | EStructuralFeature): void
  eIsSet(feature: number | EStructuralFeature): boolean
  eDirectResource(): unknown | null
  eResolveProxy(proxy: InternalEObject): InternalEObject
}
