/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { BasicEList } from '../../util/BasicEList.ts'
import type { Notification } from '../Notification.ts'
import type { NotificationChain } from '../NotificationChain.ts'
import type { Notifier } from '../Notifier.ts'

export class NotificationChainImpl extends BasicEList<Notification> implements NotificationChain {
  constructor(initialCapacity?: number) { if (initialCapacity === undefined) super(); else super(initialCapacity) }
  protected override newData(capacity: number): Notification[] { return new Array<Notification>(capacity).fill(null as unknown as Notification) }
  override add(newNotification: Notification | null): boolean
  override add(index: number, notification: Notification): void
  override add(first: number | Notification | null, second?: Notification): boolean | void {
    if (arguments.length === 2) { super.add(first as number, second!); return }
    if (first === null) return false
    const newNotification = first as Notification
    for (let i = 0; i < this.sizeValue; i++) if (this.dataValue![i]!.merge(newNotification)) return false
    return super.add(newNotification)
  }
  dispatch(notification?: Notification): void {
    if (notification === undefined) { for (let i = 0; i < this.sizeValue; i++) this.dispatch(this.dataValue![i]!); return }
    const notifier = notification.getNotifier()
    if (notifier !== null && notification.getEventType() !== -1) (notifier as Notifier).eNotify(notification)
  }
}
