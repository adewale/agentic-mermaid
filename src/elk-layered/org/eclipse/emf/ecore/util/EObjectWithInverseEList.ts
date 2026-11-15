/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Class } from '../../../../../java/lang/Class.ts'
import { Notification } from '../../common/notify/Notification.ts'
import type { InternalEObject } from '../InternalEObject.ts'
import { EObjectEList } from './EObjectEList.ts'

const EObjectEListBase: new <E>(dataClass: Class<unknown>, owner: InternalEObject, featureID: number) => EObjectEList<E> = EObjectEList

export class EObjectWithInverseEList<E> extends EObjectEListBase<E> {
  static readonly #serialVersionUID = 1n
  constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, protected readonly inverseFeatureID: number) { super(dataClass, owner, featureID) }
  protected override hasInverse(): boolean { return true }
  protected override hasNavigableInverse(): boolean { return true }
  override getInverseFeatureID(): number { return this.inverseFeatureID }
  override getInverseFeatureClass(): Class<unknown> { return this.dataClass }
}

const EObjectWithInverseEListBase: new <E>(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) => EObjectWithInverseEList<E> = EObjectWithInverseEList

export namespace EObjectWithInverseEList {
  export class Unsettable<E> extends EObjectWithInverseEListBase<E> {
    static readonly #serialVersionUID = 1n
    constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) { super(dataClass, owner, featureID, inverseFeatureID) }
    protected isSetValue = false
    protected override didChange(): void { this.isSetValue = true }
    override isSet(): boolean { return this.isSetValue }
    override unset(): void {
      super.unset()
      if (this.isNotificationRequired()) {
        const oldIsSet = this.isSetValue
        this.isSetValue = false
        this.owner.eNotify(this.createNotification(Notification.UNSET, oldIsSet, false))
      } else this.isSetValue = false
    }
  }
  const UnsettableBase: new <E>(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) => Unsettable<E> = Unsettable

  export namespace Unsettable {
    export class ManyInverse<E> extends UnsettableBase<E> {
      static readonly #serialVersionUID = 1n
      constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) { super(dataClass, owner, featureID, inverseFeatureID) }
      protected override hasManyInverse(): boolean { return true }
    }
  }
  export class ManyInverse<E> extends EObjectWithInverseEListBase<E> {
    static readonly #serialVersionUID = 1n
    constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) { super(dataClass, owner, featureID, inverseFeatureID) }
    protected override hasManyInverse(): boolean { return true }
  }
}
