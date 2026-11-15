/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { JavaObject } from '../../../../../../java/lang/Object.ts'
import { Adapter } from '../Adapter.ts'
import type { Notification } from '../Notification.ts'
import type { Notifier } from '../Notifier.ts'

export class AdapterImpl extends JavaObject implements Adapter.Internal {
  readonly [Adapter.TYPE] = true
  readonly [Adapter.Internal] = true
  protected target: Notifier | null = null

  isAdapterForType(_type: unknown): boolean { return false }
  notifyChanged(_msg: Notification): void {}
  getTarget(): Notifier | null { return this.target }
  setTarget(newTarget: Notifier | null): void { this.target = newTarget }
  unsetTarget(oldTarget: Notifier): void { if (this.target === oldTarget) this.setTarget(null) }
}
