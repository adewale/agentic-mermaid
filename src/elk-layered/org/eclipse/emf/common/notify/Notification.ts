/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Class } from '../../../../../java/lang/Class.ts'

export class Notification {
  static readonly CREATE = 0
  static readonly SET = 1
  static readonly UNSET = 2
  static readonly ADD = 3
  static readonly REMOVE = 4
  static readonly ADD_MANY = 5
  static readonly REMOVE_MANY = 6
  static readonly MOVE = 7
  static readonly REMOVING_ADAPTER = 8
  static readonly RESOLVE = 9
  static readonly EVENT_TYPE_COUNT = 10
  static readonly NO_FEATURE_ID = -1
  static readonly NO_INDEX = -1
}

export interface Notification {
  getNotifier(): unknown
  getEventType(): number
  getFeature(): unknown
  getFeatureID(expectedClass: Class<unknown> | null): number
  getOldValue(): unknown
  getNewValue(): unknown
  isTouch(): boolean
  isReset(): boolean
  wasSet(): boolean
  getPosition(): number
  merge(notification: Notification): boolean
  getOldBooleanValue(): boolean
  getOldByteValue(): number
  getOldCharValue(): string
  getOldDoubleValue(): number
  getOldFloatValue(): number
  getOldIntValue(): number
  getOldLongValue(): bigint
  getOldShortValue(): number
  getOldStringValue(): string | null
  getNewBooleanValue(): boolean
  getNewByteValue(): number
  getNewCharValue(): string
  getNewDoubleValue(): number
  getNewFloatValue(): number
  getNewIntValue(): number
  getNewLongValue(): bigint
  getNewShortValue(): number
  getNewStringValue(): string | null
}
