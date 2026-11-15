/*******************************************************************************
 * Copyright (c) 2002-2010 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { JavaObject } from '../../../../../../java/lang/Object.ts'
import type { Collection } from '../../../../../../java/util/Collection.ts'
import { BasicEList } from '../../util/BasicEList.ts'
import { ECollections } from '../../util/ECollections.ts'
import type { EList } from '../../util/EList.ts'
import { type Adapter, isInternalAdapter } from '../Adapter.ts'
import { Notification } from '../Notification.ts'
import type { Notifier } from '../Notifier.ts'
import { NotificationImpl } from './NotificationImpl.ts'

export class BasicNotifierImpl extends JavaObject implements Notifier {
  eAdapters(): EList<Adapter> { return ECollections.emptyEList() }
  protected eBasicAdapters(): BasicEList<Adapter> | null { return null }
  protected eBasicAdapterArray(): Adapter[] | null {
    const eBasicAdapters = this.eBasicAdapters()
    return eBasicAdapters === null ? null : eBasicAdapters.data()
  }
  protected eBasicHasAdapters(): boolean {
    const eBasicAdapters = this.eBasicAdapters()
    return eBasicAdapters !== null && eBasicAdapters.size() !== 0
  }
  eDeliver(): boolean { return false }
  eSetDeliver(_deliver: boolean): void { throw new Error('Unsupported operation') }
  eNotify(notification: Notification): void {
    const eAdapters = this.eBasicAdapterArray()
    if (eAdapters !== null && this.eDeliver()) {
      for (let i = 0, size = eAdapters.length; i < size; ++i) eAdapters[i]!.notifyChanged(notification)
    }
  }
  eNotificationRequired(): boolean { return this.eBasicHasAdapters() && this.eDeliver() }
}

export namespace BasicNotifierImpl {
  export interface EObservableAdapterList {
    addListener(listener: EObservableAdapterList.Listener): void
    removeListener(listener: EObservableAdapterList.Listener): void
  }
  export namespace EObservableAdapterList {
    export interface Listener {
      added(notifier: Notifier, adapter: Adapter): void
      removed(notifier: Notifier, adapter: Adapter): void
    }
  }

  export class EAdapterList<E extends Adapter> extends BasicEList<E> implements EObservableAdapterList {
    static readonly #serialVersionUID = 1n
    protected listeners: EObservableAdapterList.Listener[] | null = null
    protected safe = false
    constructor(protected notifier: Notifier) { super() }
    protected override canContainNull(): boolean { return false }
    protected override useEquals(): boolean { return false }
    protected override newData(capacity: number): E[] { return new Array<E>(capacity).fill(null as unknown as E) }
    protected override didAdd(_index: number, newObject: E): void {
      if (this.listeners !== null) {
        for (const listener of this.listeners) listener.added(this.notifier, newObject)
      }
      newObject.setTarget(this.notifier)
    }
    protected override didRemove(index: number, oldObject: E): void {
      if (this.listeners !== null) {
        for (const listener of this.listeners) listener.removed(this.notifier, oldObject)
      }
      const adapter = oldObject
      if (this.notifier.eDeliver()) {
        const getNotifier = (): Notifier => this.notifier
        const notification = new class extends NotificationImpl {
          override getNotifier(): unknown { return getNotifier() }
        }(Notification.REMOVING_ADAPTER, oldObject, null, index)
        adapter.notifyChanged(notification)
      }
      if (isInternalAdapter(adapter)) adapter.unsetTarget(this.notifier)
      else if (adapter.getTarget() === this.notifier) adapter.setTarget(null)
    }
    override data(): E[] | null {
      this.safe = true
      if (this.dataValue !== null && this.dataValue.length !== this.sizeValue) {
        if (this.sizeValue === 0) this.dataValue = null
        else {
          const oldData = this.dataValue
          this.dataValue = this.newData(this.sizeValue)
          for (let i = 0; i < this.sizeValue; i++) this.dataValue[i] = oldData[i]!
        }
      }
      return this.dataValue
    }
    protected ensureSafety(): void {
      if (this.safe && this.dataValue !== null) {
        const oldData = this.dataValue
        this.dataValue = this.newData(oldData.length)
        for (let i = 0; i < this.sizeValue; i++) this.dataValue[i] = oldData[i]!
        this.safe = false
      }
    }
    override add(object: E): boolean
    override add(index: number, object: E): void
    override add(first: number | E, second?: E): boolean | void {
      this.ensureSafety()
      if (arguments.length === 1) return super.add(first as E)
      super.add(first as number, second!)
    }
    override addAll(collection: Collection<E>): boolean
    override addAll(index: number, collection: Collection<E>): boolean
    override addAll(first: number | Collection<E>, second?: Collection<E>): boolean {
      // Only the Collection overload is overridden by EMF's EAdapterList.
      if (typeof first === 'number') return super.addAll(first, second!)
      this.ensureSafety()
      return super.addAll(first)
    }
    override remove(object: E): boolean
    override remove(index: number): E
    override remove(first: E | number): boolean | E {
      this.ensureSafety()
      return typeof first === 'number' ? super.remove(first) : super.remove(first)
    }
    override removeObject(object: E): boolean { this.ensureSafety(); return super.removeObject(object) }
    override removeAt(index: number): E { this.ensureSafety(); return super.removeAt(index) }
    override removeAll(collection: { contains(value: E): boolean }): boolean { this.ensureSafety(); return super.removeAll(collection) }
    override clear(): void { this.ensureSafety(); super.clear() }
    override retainAll(collection: { contains(value: E): boolean }): boolean { this.ensureSafety(); return super.retainAll(collection) }
    override set(index: number, object: E): E { this.ensureSafety(); return super.set(index, object) }
    override move(newPosition: number, object: E): void
    override move(newPosition: number, oldPosition: number): E
    override move(newPosition: number, second: E | number): E | void {
      this.ensureSafety()
      if (typeof second === 'number') return super.move(newPosition, second)
      super.move(newPosition, second)
    }
    addListener(listener: EObservableAdapterList.Listener): void {
      if (this.listeners === null) this.listeners = [listener]
      else {
        const newListeners = new Array<EObservableAdapterList.Listener>(this.listeners.length + 1)
        for (let i = 0; i < this.listeners.length; i++) newListeners[i] = this.listeners[i]!
        newListeners[this.listeners.length] = listener
        this.listeners = newListeners
      }
    }
    removeListener(listener: EObservableAdapterList.Listener): void {
      if (this.listeners !== null) {
        for (let i = 0; i < this.listeners.length; ++i) {
          if (this.listeners[i] === listener) {
            if (this.listeners.length === 1) this.listeners = null
            else {
              const newListeners = new Array<EObservableAdapterList.Listener>(this.listeners.length - 1)
              for (let j = 0; j < i; j++) newListeners[j] = this.listeners[j]!
              if (i !== newListeners.length) for (let j = i; j < newListeners.length; j++) newListeners[j] = this.listeners[j + 1]!
              this.listeners = newListeners
            }
            break
          }
        }
      }
    }
  }
}
