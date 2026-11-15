/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Class } from '../../../../../java/lang/Class.ts'
import type { EObject } from '../EObject.ts'
import type { InternalEObject } from '../InternalEObject.ts'
import { EObjectWithInverseEList } from './EObjectWithInverseEList.ts'

const EObjectWithInverseEListBase: new <E>(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) => EObjectWithInverseEList<E> = EObjectWithInverseEList
const EObjectWithInverseUnsettableBase: new <E>(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) => EObjectWithInverseEList.Unsettable<E> = EObjectWithInverseEList.Unsettable

export class EObjectWithInverseResolvingEList<E> extends EObjectWithInverseEListBase<E> {
  static readonly #serialVersionUID = 1n
  constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) { super(dataClass, owner, featureID, inverseFeatureID) }
  protected override hasProxies(): boolean { return true }
  protected override resolve(object: E): E
  protected override resolve(index: number, object: E): E
  protected override resolve(first: E | number, second?: E): E {
    if (arguments.length === 1) return super.resolve(first as E)
    return this.resolveEObject(first as number, second as unknown as EObject) as E
  }
}

const EObjectWithInverseResolvingEListBase: new <E>(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) => EObjectWithInverseResolvingEList<E> = EObjectWithInverseResolvingEList

export namespace EObjectWithInverseResolvingEList {
  export class Unsettable<E> extends EObjectWithInverseUnsettableBase<E> {
    static readonly #serialVersionUID = 1n
    constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) { super(dataClass, owner, featureID, inverseFeatureID) }
    protected override hasProxies(): boolean { return true }
    protected override resolve(object: E): E
    protected override resolve(index: number, object: E): E
    protected override resolve(first: E | number, second?: E): E {
      if (arguments.length === 1) return super.resolve(first as E)
      return this.resolveEObject(first as number, second as unknown as EObject) as E
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
  export class ManyInverse<E> extends EObjectWithInverseResolvingEListBase<E> {
    static readonly #serialVersionUID = 1n
    constructor(dataClass: Class<unknown>, owner: InternalEObject, featureID: number, inverseFeatureID: number) { super(dataClass, owner, featureID, inverseFeatureID) }
    protected override hasManyInverse(): boolean { return true }
  }
}
