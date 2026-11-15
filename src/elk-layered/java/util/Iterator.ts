/* SPDX-License-Identifier: EPL-2.0 */
export interface Iterator<T> {
  hasNext(): boolean
  next(): T
  remove(): void
}

export interface ListIterator<T> extends Iterator<T> {
  hasPrevious(): boolean
  previous(): T
  nextIndex(): number
  previousIndex(): number
  set(value: T): void
  add(value: T): void
}

export function iterableIterator<T>(iterator: Iterator<T>): IterableIterator<T> {
  return {
    [Symbol.iterator]() { return this },
    next() { return iterator.hasNext() ? { value: iterator.next(), done: false } : { value: undefined, done: true } },
  }
}
