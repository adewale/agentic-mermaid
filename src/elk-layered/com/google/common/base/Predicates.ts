/* SPDX-License-Identifier: EPL-2.0 */
export type Predicate<T> = (value: T) => boolean
export class Predicates {
  static and<T>(first: Predicate<T>, second: Predicate<T>): Predicate<T> { return value => first(value) && second(value) }
}
