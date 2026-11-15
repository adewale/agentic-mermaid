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
import type { EObject } from '../EObject.ts'
import { EObjectEList } from './EObjectEList.ts'

const EObjectEListBase: new <E>(dataClass: Class<unknown>, owner: InternalEObject, featureID: number) => EObjectEList<E> = EObjectEList

export class EObjectContainmentEList<E> extends EObjectEListBase<E> {
  static readonly #serialVersionUID = 1n
  constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number) { super(dataClass, owner, featureID) }
  protected override hasInverse(): boolean { return true }
  protected override hasNavigableInverse(): boolean { return false }
  protected override isContainment(): boolean { return true }
}

const EObjectContainmentEListBase: new <E>(dataClass: Class<unknown>, owner: InternalEObject, featureID: number) => EObjectContainmentEList<E> = EObjectContainmentEList

export namespace EObjectContainmentEList {
  export class Unsettable<E> extends EObjectContainmentEListBase<E> {
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
  const UnsettableBase: new <E>(dataClass: Class<unknown>, owner: InternalEObject, featureID: number) => Unsettable<E> = Unsettable

  export namespace Unsettable {
    export class Resolving<E> extends UnsettableBase<E> {
      static readonly #serialVersionUID = 1n
      constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number) { super(dataClass, owner, featureID) }
      protected override hasProxies(): boolean { return true }
    protected override resolve(object: E): E
    protected override resolve(index: number, object: E): E
    protected override resolve(first: E | number, second?: E): E {
      if (arguments.length === 1) return super.resolve(first as E)
      return this.resolveEObject(first as number, second as unknown as EObject) as E
    }
    }
  }
  export class Resolving<E> extends EObjectContainmentEListBase<E> {
    static readonly #serialVersionUID = 1n
    constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number) { super(dataClass, owner, featureID) }
    protected override hasProxies(): boolean { return true }
    protected override resolve(object: E): E
    protected override resolve(index: number, object: E): E
    protected override resolve(first: E | number, second?: E): E {
      if (arguments.length === 1) return super.resolve(first as E)
      return this.resolveEObject(first as number, second as unknown as EObject) as E
    }
  }
}
