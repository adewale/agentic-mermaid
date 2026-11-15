/* SPDX-License-Identifier: EPL-2.0 */
import { Cloneable } from '../lang/Cloneable.ts'
import { AbstractList } from './AbstractList.ts'
import type { ListIterator, Iterator } from './Iterator.ts'

class Node<T> {
  prev!: Node<T>
  next!: Node<T>
  constructor(public value: T) {}
}

export class LinkedList<T> extends AbstractList<T> implements Cloneable {
  readonly [Cloneable] = true
  private readonly tail = new Node<T>(null as T)
  private length = 0

  constructor(source?: Iterable<T>) {
    super()
    this.tail.prev = this.tail.next = this.tail
    if (source !== undefined) for (const value of source) this.add(value)
    this.modCount = 0
  }

  private node(index: number, insertion = false): Node<T> {
    this.checkIndex(index, insertion)
    if (index < this.length / 2) {
      let node = this.tail.next
      for (let offset = 0; offset < index; offset++) node = node.next
      return node
    }
    let node = this.tail
    for (let offset = this.length; offset > index; offset--) node = node.prev
    return node
  }
  private insertBefore(value: T, next: Node<T>): void {
    const node = new Node(value)
    node.prev = next.prev
    node.next = next
    next.prev.next = node
    next.prev = node
    this.length++
    this.modCount = (this.modCount + 1) | 0
  }
  private unlink(node: Node<T>): T {
    node.prev.next = node.next
    node.next.prev = node.prev
    this.length--
    this.modCount = (this.modCount + 1) | 0
    return node.value
  }
  size(): number { return this.length }
  get(index: number): T { return this.node(index).value }
  set(index: number, value: T): T { const node = this.node(index); const previous = node.value; node.value = value; return previous }
  add(value: T): boolean
  add(index: number, value: T): void
  add(first: T | number, second?: T): boolean | void {
    if (arguments.length === 1) { this.insertBefore(first as T, this.tail); return true }
    this.insertBefore(second!, this.node(first as number, true))
  }
  removeAt(index: number): T { return this.unlink(this.node(index)) }
  override clear(): void { this.tail.prev = this.tail.next = this.tail; this.length = 0; this.modCount = (this.modCount + 1) | 0 }
  addFirst(value: T): void { this.insertBefore(value, this.tail.next) }
  addLast(value: T): void { this.insertBefore(value, this.tail) }
  getFirst(): T { if (this.isEmpty()) throw new Error('No such element'); return this.tail.next.value }
  getLast(): T { if (this.isEmpty()) throw new Error('No such element'); return this.tail.prev.value }
  removeFirst(): T { if (this.isEmpty()) throw new Error('No such element'); return this.unlink(this.tail.next) }
  removeLast(): T { if (this.isEmpty()) throw new Error('No such element'); return this.unlink(this.tail.prev) }
  poll(): T | null { return this.isEmpty() ? null : this.removeFirst() }
  peek(): T | null { return this.isEmpty() ? null : this.getFirst() }
  offer(value: T): boolean { return this.add(value) }
  clone(): LinkedList<T> { return new LinkedList(this) }

  override listIterator(index = 0): ListIterator<T> {
    let next = this.node(index, true)
    let cursor = index
    let last: Node<T> | null = null
    let expected = this.modCount
    const check = (): void => { if (this.modCount !== expected) throw new Error('Concurrent modification') }
    return {
      hasNext: () => next !== this.tail,
      next: () => { check(); if (next === this.tail) throw new Error('No such element'); last = next; next = next.next; cursor++; return last.value },
      hasPrevious: () => next.prev !== this.tail,
      previous: () => { check(); if (next.prev === this.tail) throw new Error('No such element'); next = next.prev; last = next; cursor--; return last.value },
      nextIndex: () => cursor,
      previousIndex: () => cursor - 1,
      remove: () => {
        check()
        if (last === null) throw new Error('No current element')
        if (next === last) next = next.next
        else cursor--
        this.unlink(last)
        expected = this.modCount
        last = null
      },
      set: value => { check(); if (last === null) throw new Error('No current element'); last.value = value },
      add: value => { check(); this.insertBefore(value, next); cursor++; last = null; expected = this.modCount },
    }
  }
  descendingIterator(): Iterator<T> {
    const iterator = this.listIterator(this.size())
    return { hasNext: () => iterator.hasPrevious(), next: () => iterator.previous(), remove: () => iterator.remove() }
  }
}
