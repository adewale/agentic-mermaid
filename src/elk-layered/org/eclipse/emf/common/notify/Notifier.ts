/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { EList } from '../util/EList.ts'
import type { Adapter } from './Adapter.ts'
import type { Notification } from './Notification.ts'

export interface Notifier { eAdapters(): EList<Adapter>; eNotify(notification: Notification): void; eDeliver(): boolean; eSetDeliver(deliver: boolean): void }
