/*******************************************************************************
 * Copyright (c) 2010, 2017 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Double, NumberFormatException } from '../../../../../java/lang/Double.ts'
import { IllegalArgumentException } from '../../../../../java/lang/IllegalArgumentException.ts'
import { IllegalStateException } from '../../../../../java/lang/IllegalStateException.ts'
import { LinkedList } from '../../../../../java/util/LinkedList.ts'
import type { Collection } from '../../../../../java/util/Collection.ts'
import type { IDataObject } from '../util/IDataObject.ts'
import { KVector } from './KVector.ts'

export class KVectorChain extends LinkedList<KVector> implements IDataObject {
  static readonly #serialVersionUID = -7978287459602078559n

  constructor()
  constructor(collection: Collection<KVector>)
  constructor(vectors: KVector[])
  constructor(...vectors: KVector[])
  constructor(first?: Collection<KVector> | KVector[] | KVector, ...rest: KVector[]) {
    if (first !== undefined && !(first instanceof KVector) && !Array.isArray(first)) super(first)
    else {
      super()
      if (Array.isArray(first)) this.addAll(first)
      else if (first !== undefined) this.addAll(first, ...rest)
    }
  }

  override toString(): string {
    let builder = '('
    const iter = this.iterator()
    while (iter.hasNext()) {
      const vector = iter.next()
      builder += `${vector.x},${vector.y}`
      if (iter.hasNext()) builder += '; '
    }
    return builder + ')'
  }

  override toArray(): KVector[]
  toArray(beginIndex: number): KVector[]
  override toArray(array: KVector[]): KVector[]
  override toArray(first?: number | KVector[]): KVector[] {
    if (Array.isArray(first)) return super.toArray(first)
    const beginIndex = first ?? 0
    if (beginIndex < 0 || beginIndex > this.size()) throw new RangeError('Index outside vector chain')
    let i = 0
    const result = new Array<KVector>(this.size() - beginIndex)
    const iter = this.listIterator(beginIndex)
    while (iter.hasNext()) result[i++] = iter.next()
    return result
  }

  parse(string: string): void {
    const tokens = string.split(/,|;|\(|\)|\[|\]|\{|\}| |\t|\n/)
    while (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()
    this.clear()
    try {
      let i = 0
      let xy = 0
      let x = 0, y = 0
      while (i < tokens.length) {
        if (tokens[i] != null && tokens[i]!.trim().length > 0) {
          if (xy % 2 === 0) x = Double.parseDouble(tokens[i]!)
          else y = Double.parseDouble(tokens[i]!)
          if (xy > 0 && xy % 2 !== 0) this.add(new KVector(x, y))
          xy++
        }
        i++
      }
    } catch (exception) {
      if (!(exception instanceof NumberFormatException)) throw exception
      throw new IllegalArgumentException(`The given string does not match the expected format for vectors.${exception}`)
    }
  }

  add(): void
  add(x: number, y: number): void
  override add(value: KVector): boolean
  override add(index: number, value: KVector): void
  override add(first?: number | KVector, second?: number | KVector): boolean | void {
    if (first === undefined) { super.add(new KVector()); return }
    if (typeof first === 'number' && typeof second === 'number') { super.add(new KVector(first, second)); return }
    if (typeof first === 'number') { super.add(first, second as KVector); return }
    return super.add(first)
  }

  addFirst(): void
  addFirst(x: number, y: number): void
  override addFirst(value: KVector): void
  override addFirst(first?: number | KVector, second?: number): void {
    if (first === undefined) super.addFirst(new KVector())
    else if (first instanceof KVector) super.addFirst(first)
    else super.addFirst(new KVector(first, second!))
  }

  addLast(): void
  addLast(x: number, y: number): void
  override addLast(value: KVector): void
  override addLast(first?: number | KVector, second?: number): void {
    if (first === undefined) super.addLast(new KVector())
    else if (first instanceof KVector) super.addLast(first)
    else super.addLast(new KVector(first, second!))
  }

  addAll(vectors: KVector[]): void
  addAll(...vectors: KVector[]): void
  override addAll(collection: Collection<KVector>): boolean
  override addAll(index: number, collection: Collection<KVector>): boolean
  override addAll(...args: (number | KVector | KVector[] | Collection<KVector>)[]): boolean | void {
    const first = args[0]
    if (typeof first === 'number') return super.addAll(first, args[1] as Collection<KVector>)
    if (first !== undefined && !(first instanceof KVector) && !Array.isArray(first)) return super.addAll(first)
    const vectors = Array.isArray(first) ? first : args as KVector[]
    for (const vector of vectors) this.add(vector)
  }

  addAllAsCopies(index: number, chain: Iterable<KVector>): void {
    const copies = new LinkedList<KVector>()
    for (const v of chain) copies.add(new KVector(v))
    this.addAll(index, copies)
  }

  scale(scale: number): KVectorChain
  scale(scalex: number, scaley: number): KVectorChain
  scale(scalex: number, scaley = scalex): KVectorChain {
    for (const vector of this) vector.scale(scalex, scaley)
    return this
  }

  offset(offset: KVector): KVectorChain
  offset(dx: number, dy: number): KVectorChain
  offset(first: KVector | number, second?: number): KVectorChain {
    for (const vector of this) {
      if (first instanceof KVector) vector.add(first)
      else vector.add(first, second!)
    }
    return this
  }

  offsetNonMutating(offset: KVector): KVectorChain {
    const result = new KVectorChain()
    for (const vector of this) result.add(KVector.sum(vector, offset))
    return result
  }

  totalLength(): number {
    let length = 0
    if (this.size() >= 2) {
      const iter = this.iterator()
      let point1 = iter.next()
      do {
        const point2 = iter.next()
        length += point1.distance(point2)
        point1 = point2
      } while (iter.hasNext())
    }
    return length
  }

  hasNaN(): boolean { for (const v of this) if (v.isNaN()) return true; return false }
  hasInfinite(): boolean { for (const v of this) if (v.isInfinite()) return true; return false }

  pointOnLine(dist: number): KVector {
    if (this.size() >= 2) {
      const absDistance = Math.abs(dist)
      let distanceSum = 0
      if (dist >= 0) {
        const iter = this.listIterator()
        let currentPoint = iter.next()
        do {
          const oldDistanceSum = distanceSum
          const nextPoint = iter.next()
          const additionalDistanceToNext = currentPoint.distance(nextPoint)
          if (additionalDistanceToNext > 0) {
            distanceSum += additionalDistanceToNext
            if (distanceSum >= absDistance) {
              const thisRelative = (absDistance - oldDistanceSum) / additionalDistanceToNext
              const result = nextPoint.clone().sub(currentPoint)
              result.scale(thisRelative)
              result.add(currentPoint)
              return result
            }
          }
          currentPoint = nextPoint
        } while (iter.hasNext())
        return iter.previous()
      }
      const iter = this.listIterator(this.size() - 1)
      let currentPoint = iter.previous()
      do {
        const oldDistanceSum = distanceSum
        const nextPoint = iter.previous()
        const additionalDistanceToNext = currentPoint.distance(nextPoint)
        if (additionalDistanceToNext > 0) {
          distanceSum += additionalDistanceToNext
          if (distanceSum >= absDistance) {
            const thisRelative = (absDistance - oldDistanceSum) / additionalDistanceToNext
            const result = nextPoint.clone().sub(currentPoint)
            result.scale(thisRelative)
            result.add(currentPoint)
            return result
          }
        }
        currentPoint = nextPoint
      } while (iter.hasPrevious())
      return iter.next()
    }
    if (this.size() === 1) return this.get(0)
    throw new IllegalStateException('Cannot determine a point on an empty vector chain.')
  }

  angleOnLine(dist: number): number {
    if (this.size() < 2) throw new IllegalStateException('Need at least two points to determine an angle.')
    const absDistance = Math.abs(dist)
    let distanceSum = 0
    if (dist >= 0) {
      const iter = this.listIterator()
      let currentPoint: KVector
      let nextPoint = iter.next()
      do {
        currentPoint = nextPoint
        nextPoint = iter.next()
        const additionalDistanceToNext = currentPoint.distance(nextPoint)
        if (additionalDistanceToNext > 0) {
          distanceSum += additionalDistanceToNext
          if (distanceSum >= absDistance) break
        }
      } while (iter.hasNext())
      return nextPoint.clone().sub(currentPoint!).toRadians()
    }
    const iter = this.listIterator(this.size() - 1)
    let currentPoint: KVector
    let nextPoint = iter.previous()
    do {
      currentPoint = nextPoint
      nextPoint = iter.previous()
      const additionalDistanceToNext = currentPoint.distance(nextPoint)
      if (additionalDistanceToNext > 0) {
        distanceSum += additionalDistanceToNext
        if (distanceSum >= absDistance) break
      }
    } while (iter.hasPrevious())
    return nextPoint.clone().sub(currentPoint!).toRadians()
  }

  static reverse(chain: KVectorChain): KVectorChain {
    const result = new KVectorChain()
    for (const vector of chain) result.add(0, new KVector(vector))
    return result
  }
}
