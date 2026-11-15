/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { JavaObject, javaEquals } from '../../../../../../java/lang/Object.ts'
import type { Class } from '../../../../../../java/lang/Class.ts'
import { Integer } from '../../../../../../java/lang/Integer.ts'
import { IllegalStateException } from '../../../../../../java/lang/IllegalStateException.ts'
import { BasicEList } from '../../util/BasicEList.ts'
import { Notification } from '../Notification.ts'
import type { NotificationChain } from '../NotificationChain.ts'
import type { Notifier } from '../Notifier.ts'
import { NotificationChainImpl } from './NotificationChainImpl.ts'

export class NotificationImpl extends JavaObject implements Notification, NotificationChain {
  static readonly PRIMITIVE_TYPE_OBJECT = -1
  static readonly PRIMITIVE_TYPE_BOOLEAN = 0
  static readonly PRIMITIVE_TYPE_BYTE = 1
  static readonly PRIMITIVE_TYPE_CHAR = 2
  static readonly PRIMITIVE_TYPE_DOUBLE = 3
  static readonly PRIMITIVE_TYPE_FLOAT = 4
  static readonly PRIMITIVE_TYPE_INT = 5
  static readonly PRIMITIVE_TYPE_LONG = 6
  static readonly PRIMITIVE_TYPE_SHORT = 7
  protected static readonly IS_SET_CHANGE_INDEX = Notification.NO_INDEX - 1
  protected primitiveType: number
  protected eventType: number
  protected oldValue: unknown = null
  protected newValue: unknown = null
  protected oldSimplePrimitiveValue = 0n
  protected newSimplePrimitiveValue = 0n
  protected oldIEEEPrimitiveValue = 0
  protected newIEEEPrimitiveValue = 0
  protected position: number
  protected next: NotificationChain | null = null

  // primitiveType discriminates Java's primitive constructor overloads, which
  // TypeScript cannot distinguish from the Object overload by number alone.
  constructor(eventType: number, oldValue: unknown, newValue: unknown, positionOrIsSetChange: number | boolean = Notification.NO_INDEX, wasSet?: boolean, primitiveType = NotificationImpl.PRIMITIVE_TYPE_OBJECT) {
    super()
    this.eventType = eventType
    this.primitiveType = primitiveType
    this.position = typeof positionOrIsSetChange === 'boolean' ? positionOrIsSetChange ? NotificationImpl.IS_SET_CHANGE_INDEX : Notification.NO_INDEX : positionOrIsSetChange
    if (wasSet === false) this.position = NotificationImpl.IS_SET_CHANGE_INDEX - this.position - 1
    if (primitiveType === NotificationImpl.PRIMITIVE_TYPE_OBJECT) { this.oldValue = oldValue; this.newValue = newValue }
    else if (primitiveType === NotificationImpl.PRIMITIVE_TYPE_DOUBLE || primitiveType === NotificationImpl.PRIMITIVE_TYPE_FLOAT) {
      this.oldIEEEPrimitiveValue = primitiveType === NotificationImpl.PRIMITIVE_TYPE_FLOAT ? Math.fround(oldValue as number) : oldValue as number
      this.newIEEEPrimitiveValue = primitiveType === NotificationImpl.PRIMITIVE_TYPE_FLOAT ? Math.fround(newValue as number) : newValue as number
    } else {
      this.oldSimplePrimitiveValue = primitiveType === NotificationImpl.PRIMITIVE_TYPE_BOOLEAN ? oldValue ? 1n : 0n : primitiveType === NotificationImpl.PRIMITIVE_TYPE_CHAR ? BigInt((oldValue as string).charCodeAt(0)) : BigInt.asIntN(64, BigInt(oldValue as number | bigint))
      this.newSimplePrimitiveValue = primitiveType === NotificationImpl.PRIMITIVE_TYPE_BOOLEAN ? newValue ? 1n : 0n : primitiveType === NotificationImpl.PRIMITIVE_TYPE_CHAR ? BigInt((newValue as string).charCodeAt(0)) : BigInt.asIntN(64, BigInt(newValue as number | bigint))
    }
  }
  getNotifier(): unknown { return null }
  getEventType(): number { return this.eventType }
  getFeature(): unknown { return null }
  getFeatureID(_expectedClass: Class<unknown> | null): number { return Notification.NO_FEATURE_ID }
  getOldValue(): unknown {
    if (this.oldValue === null) {
      switch (this.primitiveType) {
        case NotificationImpl.PRIMITIVE_TYPE_BOOLEAN: this.oldValue = this.getOldBooleanValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_BYTE: this.oldValue = this.getOldByteValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_CHAR: this.oldValue = this.getOldCharValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_DOUBLE: this.oldValue = this.getOldDoubleValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_FLOAT: this.oldValue = this.getOldFloatValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_LONG: this.oldValue = this.getOldLongValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_INT: this.oldValue = this.getOldIntValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_SHORT: this.oldValue = this.getOldShortValue(); break
      }
    }
    return this.oldValue
  }
  getNewValue(): unknown {
    if (this.newValue === null) {
      switch (this.primitiveType) {
        case NotificationImpl.PRIMITIVE_TYPE_BOOLEAN: this.newValue = this.getNewBooleanValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_BYTE: this.newValue = this.getNewByteValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_CHAR: this.newValue = this.getNewCharValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_DOUBLE: this.newValue = this.getNewDoubleValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_FLOAT: this.newValue = this.getNewFloatValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_LONG: this.newValue = this.getNewLongValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_INT: this.newValue = this.getNewIntValue(); break
        case NotificationImpl.PRIMITIVE_TYPE_SHORT: this.newValue = this.getNewShortValue(); break
      }
    }
    return this.newValue
  }
  isTouch(): boolean {
    switch (this.eventType) {
      case Notification.RESOLVE: case Notification.REMOVING_ADAPTER: return true
      case Notification.ADD: case Notification.ADD_MANY: case Notification.REMOVE: case Notification.REMOVE_MANY: return false
      case Notification.MOVE: { const oldValue = this.getOldValue(); if (oldValue instanceof Integer) return oldValue.intValue() === this.position; if (typeof oldValue === 'number' && Number.isInteger(oldValue)) return oldValue === this.position; throw new TypeError('Expected an Integer move position') }
      case Notification.SET: case Notification.UNSET:
        if (this.position === NotificationImpl.IS_SET_CHANGE_INDEX) return false
        switch (this.primitiveType) {
          case NotificationImpl.PRIMITIVE_TYPE_BOOLEAN: case NotificationImpl.PRIMITIVE_TYPE_BYTE: case NotificationImpl.PRIMITIVE_TYPE_CHAR: case NotificationImpl.PRIMITIVE_TYPE_LONG: case NotificationImpl.PRIMITIVE_TYPE_INT: case NotificationImpl.PRIMITIVE_TYPE_SHORT: return this.oldSimplePrimitiveValue === this.newSimplePrimitiveValue
          case NotificationImpl.PRIMITIVE_TYPE_DOUBLE: case NotificationImpl.PRIMITIVE_TYPE_FLOAT: return this.oldIEEEPrimitiveValue === this.newIEEEPrimitiveValue
          default: return javaEquals(this.oldValue, this.newValue)
        }
      default: return false
    }
  }
  isReset(): boolean {
    switch (this.eventType) {
      case Notification.SET: {
        const defaultValue = this.getFeatureDefaultValue()
        switch (this.primitiveType) {
          case NotificationImpl.PRIMITIVE_TYPE_BOOLEAN: return defaultValue !== null && defaultValue === (this.newSimplePrimitiveValue !== 0n)
          case NotificationImpl.PRIMITIVE_TYPE_CHAR: return defaultValue !== null && defaultValue === String.fromCharCode(Number(this.newSimplePrimitiveValue & 65535n))
          case NotificationImpl.PRIMITIVE_TYPE_BYTE: case NotificationImpl.PRIMITIVE_TYPE_INT: case NotificationImpl.PRIMITIVE_TYPE_SHORT: return defaultValue !== null && Number(defaultValue) === Number(this.newSimplePrimitiveValue)
          case NotificationImpl.PRIMITIVE_TYPE_LONG: return defaultValue !== null && BigInt(defaultValue as bigint | number) === this.newSimplePrimitiveValue
          case NotificationImpl.PRIMITIVE_TYPE_DOUBLE: case NotificationImpl.PRIMITIVE_TYPE_FLOAT: return defaultValue !== null && Number(defaultValue) === this.newIEEEPrimitiveValue
          default: return javaEquals(defaultValue, this.newValue)
        }
      }
      case Notification.UNSET: return true
      default: return false
    }
  }
  wasSet(): boolean {
    switch (this.eventType) {
      case Notification.SET: if (this.isFeatureUnsettable()) return this.position !== NotificationImpl.IS_SET_CHANGE_INDEX; break
      case Notification.UNSET: if (this.isFeatureUnsettable()) return this.position === NotificationImpl.IS_SET_CHANGE_INDEX; break
      case Notification.ADD: case Notification.ADD_MANY: case Notification.REMOVE: case Notification.REMOVE_MANY: case Notification.MOVE: return this.position > NotificationImpl.IS_SET_CHANGE_INDEX
      default: return false
    }
    const defaultValue = this.getFeatureDefaultValue()
    switch (this.primitiveType) {
      case NotificationImpl.PRIMITIVE_TYPE_BOOLEAN: return defaultValue !== null && defaultValue !== (this.oldSimplePrimitiveValue !== 0n)
      case NotificationImpl.PRIMITIVE_TYPE_CHAR: return defaultValue !== null && defaultValue !== String.fromCharCode(Number(this.oldSimplePrimitiveValue & 65535n))
      case NotificationImpl.PRIMITIVE_TYPE_BYTE: case NotificationImpl.PRIMITIVE_TYPE_INT: case NotificationImpl.PRIMITIVE_TYPE_SHORT: return defaultValue !== null && Number(defaultValue) !== Number(this.oldSimplePrimitiveValue)
      case NotificationImpl.PRIMITIVE_TYPE_LONG: return defaultValue !== null && BigInt(defaultValue as bigint | number) !== this.oldSimplePrimitiveValue
      case NotificationImpl.PRIMITIVE_TYPE_DOUBLE: case NotificationImpl.PRIMITIVE_TYPE_FLOAT: return defaultValue !== null && Number(defaultValue) !== this.oldIEEEPrimitiveValue
      default: return !javaEquals(defaultValue, this.oldValue)
    }
  }
  protected isFeatureUnsettable(): boolean { return false }
  protected getFeatureDefaultValue(): unknown { return null }
  getPosition(): number { return this.position < 0 ? this.position < NotificationImpl.IS_SET_CHANGE_INDEX ? NotificationImpl.IS_SET_CHANGE_INDEX - this.position - 1 : Notification.NO_INDEX : this.position }
  merge(notification: Notification): boolean {
    switch (this.eventType) {
      // @ts-expect-error Java NotificationImpl.merge deliberately falls through to REMOVE.
      case Notification.SET: case Notification.UNSET:
        switch (notification.getEventType()) {
          case Notification.SET: case Notification.UNSET:
            if (notification.getNotifier() === this.getNotifier() && this.getFeatureID(null) === notification.getFeatureID(null)) {
              this.newValue = notification.getNewValue()
              if (notification.getEventType() === Notification.SET) this.eventType = Notification.SET
              return true
            }
        }
        // The source deliberately falls through to the REMOVE branch.
      case Notification.REMOVE:
        if (notification.getEventType() === Notification.REMOVE && notification.getNotifier() === this.getNotifier() && this.getFeatureID(null) === notification.getFeatureID(null)) {
          const originalWasSet = this.wasSet(), originalPosition = this.getPosition(), notificationPosition = notification.getPosition()
          this.eventType = Notification.REMOVE_MANY
          const removedValues = new BasicEList<unknown>(2)
          if (originalPosition <= notificationPosition) {
            removedValues.add(this.oldValue); removedValues.add(notification.getOldValue())
            this.newValue = [this.position = originalPosition, notificationPosition + 1]
          } else {
            removedValues.add(notification.getOldValue()); removedValues.add(this.oldValue)
            this.newValue = [this.position = notificationPosition, originalPosition]
          }
          this.oldValue = removedValues
          if (!originalWasSet) this.position = NotificationImpl.IS_SET_CHANGE_INDEX - this.position - 1
          return true
        }
        break
      case Notification.REMOVE_MANY:
        if (notification.getEventType() === Notification.REMOVE && notification.getNotifier() === this.getNotifier() && this.getFeatureID(null) === notification.getFeatureID(null)) {
          const originalWasSet = this.wasSet()
          let notificationPosition = notification.getPosition()
          const positions = this.newValue as number[], newPositions = new Array<number>(positions.length + 1).fill(0)
          let index = 0
          while (index < positions.length) {
            const oldPosition = positions[index]!
            if (oldPosition <= notificationPosition) { newPositions[index++] = oldPosition; ++notificationPosition } else break
          }
          ;(this.oldValue as BasicEList<unknown>).add(index, notification.getOldValue())
          newPositions[index] = notificationPosition
          while (++index < newPositions.length) newPositions[index] = positions[index - 1]!
          this.newValue = newPositions
          if (!originalWasSet) this.position = NotificationImpl.IS_SET_CHANGE_INDEX - newPositions[0]!
          return true
        }
        break
    }
    return false
  }
  getOldBooleanValue(): boolean { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_BOOLEAN) throw new IllegalStateException(); return this.oldSimplePrimitiveValue !== 0n }
  getOldByteValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_BYTE) throw new IllegalStateException(); return Number(BigInt.asIntN(8, this.oldSimplePrimitiveValue)) }
  getOldCharValue(): string { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_CHAR) throw new IllegalStateException(); return String.fromCharCode(Number(this.oldSimplePrimitiveValue & 65535n)) }
  getOldDoubleValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_DOUBLE) throw new IllegalStateException(); return this.oldIEEEPrimitiveValue }
  getOldFloatValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_FLOAT) throw new IllegalStateException(); return Math.fround(this.oldIEEEPrimitiveValue) }
  getOldIntValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_INT) throw new IllegalStateException(); return Number(BigInt.asIntN(32, this.oldSimplePrimitiveValue)) }
  getOldLongValue(): bigint { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_LONG) throw new IllegalStateException(); return this.oldSimplePrimitiveValue }
  getOldShortValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_SHORT) throw new IllegalStateException(); return Number(BigInt.asIntN(16, this.oldSimplePrimitiveValue)) }
  getOldStringValue(): string | null { return this.oldValue === null ? null : String(this.oldValue) }
  getNewBooleanValue(): boolean { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_BOOLEAN) throw new IllegalStateException(); return this.newSimplePrimitiveValue !== 0n }
  getNewByteValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_BYTE) throw new IllegalStateException(); return Number(BigInt.asIntN(8, this.newSimplePrimitiveValue)) }
  getNewCharValue(): string { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_CHAR) throw new IllegalStateException(); return String.fromCharCode(Number(this.newSimplePrimitiveValue & 65535n)) }
  getNewDoubleValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_DOUBLE) throw new IllegalStateException(); return this.newIEEEPrimitiveValue }
  getNewFloatValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_FLOAT) throw new IllegalStateException(); return Math.fround(this.newIEEEPrimitiveValue) }
  getNewIntValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_INT) throw new IllegalStateException(); return Number(BigInt.asIntN(32, this.newSimplePrimitiveValue)) }
  getNewLongValue(): bigint { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_LONG) throw new IllegalStateException(); return this.newSimplePrimitiveValue }
  getNewShortValue(): number { if (this.primitiveType !== NotificationImpl.PRIMITIVE_TYPE_SHORT) throw new IllegalStateException(); return Number(BigInt.asIntN(16, this.newSimplePrimitiveValue)) }
  getNewStringValue(): string | null { return this.newValue === null ? null : String(this.newValue) }
  override toString(): string {
    let result = super.toString() + ' (eventType: '
    switch (this.eventType) {
      case Notification.SET: result += 'SET'; break
      case Notification.UNSET: result += 'UNSET'; break
      case Notification.ADD: result += 'ADD'; break
      case Notification.ADD_MANY: result += 'ADD_MANY'; break
      case Notification.REMOVE: result += 'REMOVE'; break
      case Notification.REMOVE_MANY: result += 'REMOVE_MANY'; break
      case Notification.MOVE: result += 'MOVE'; break
      case Notification.REMOVING_ADAPTER: result += 'REMOVING_ADAPTER'; break
      case Notification.RESOLVE: result += 'RESOLVE'; break
      default: result += this.eventType
    }
    if (this.isTouch()) result += ', touch: true'
    result += ', position: ' + this.getPosition() + ', notifier: ' + this.getNotifier() + ', feature: ' + this.getFeature() + ', oldValue: ' + this.getOldValue() + ', newValue: '
    if (this.eventType === Notification.REMOVE_MANY && Array.isArray(this.newValue)) result += '[' + this.newValue.join(', ') + ']'
    else result += this.getNewValue()
    return result + ', isTouch: ' + this.isTouch() + ', wasSet: ' + this.wasSet() + ')'
  }
  add(newNotification: Notification | null): boolean {
    if (newNotification === null || this.merge(newNotification)) return false
    if (this.next === null) {
      if (newNotification instanceof NotificationImpl) { this.next = newNotification; return true }
      this.next = new NotificationChainImpl()
      return this.next.add(newNotification)
    }
    return this.next.add(newNotification)
  }
  dispatch(): void {
    const notifier = this.getNotifier()
    if (notifier !== null && this.getEventType() !== -1) (notifier as Notifier).eNotify(this)
    if (this.next !== null) this.next.dispatch()
  }
}
