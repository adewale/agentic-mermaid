/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Notification } from './Notification.ts'
import type { Notifier } from './Notifier.ts'

export interface Adapter {
  readonly [Adapter.TYPE]: true
  notifyChanged(notification: Notification): void
  getTarget(): Notifier | null
  setTarget(newTarget: Notifier | null): void
  isAdapterForType(type: unknown): boolean
}

export namespace Adapter {
  export const TYPE = Symbol('org.eclipse.emf.common.notify.Adapter')
  export const Internal = Symbol('org.eclipse.emf.common.notify.Adapter.Internal')
  export interface Internal extends Adapter {
    readonly [Internal]: true
    unsetTarget(oldTarget: Notifier): void
  }
}

export function isAdapter(value: unknown): value is Adapter {
  return value !== null && typeof value === 'object' && (value as Adapter)[Adapter.TYPE] === true
}
export function isInternalAdapter(value: unknown): value is Adapter.Internal {
  return value !== null && typeof value === 'object' && (value as Adapter.Internal)[Adapter.Internal] === true
}
