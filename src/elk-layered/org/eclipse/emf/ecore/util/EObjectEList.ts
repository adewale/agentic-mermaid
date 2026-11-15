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
import { EcoreEList } from './EcoreEList.ts'

export class EObjectEList<E> extends EcoreEList<E> {
  static readonly #serialVersionUID = 1n
  constructor(dataClass: Class<unknown>, owner: InternalEObject, protected readonly featureID: number) { super(dataClass, owner) }
  override getFeatureID(): number { return this.featureID }
  protected override useEquals(): boolean { return false }
  protected override isUnique(): boolean { return true }
  protected override hasInverse(): boolean { return false }
  protected override isEObject(): boolean { return true }
  protected override canContainNull(): boolean { return false }
  protected override resolve(object: E): E
  protected override resolve(index: number, object: E): E
  protected override resolve(first: E | number, second?: E): E {
    if (arguments.length === 1) return super.resolve(first as E)
    return second!
  }
}

export namespace EObjectEList {
  export class Unsettable<E> extends EObjectEList<E> {
    static readonly #serialVersionUID = 1n
    constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number) { super(dataClass, owner, featureID) }
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
}
