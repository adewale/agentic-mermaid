/*******************************************************************************
 * Copyright (c) 2010, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
// ELK v0.11.0, org.eclipse.elk.core.math.KVector.
import { Double, NumberFormatException } from '../../../../../java/lang/Double.ts'
import { Integer } from '../../../../../java/lang/Integer.ts'
import { JavaObject } from '../../../../../java/lang/Object.ts'
import { Cloneable } from '../../../../../java/lang/Cloneable.ts'
import type { Random } from '../../../../../java/util/Random.ts'
import type { IDataObject } from '../util/IDataObject.ts'

export class KVector extends JavaObject implements IDataObject, Cloneable {
  readonly [Cloneable] = true
  private static readonly DEFAULT_FUZZYNESS = 0.05
  static readonly #serialVersionUID = -4780985519832787684n
  x: number
  y: number

  constructor()
  constructor(thex: number, they: number)
  constructor(v: KVector)
  constructor(start: KVector, end: KVector)
  constructor(angle: number)
  constructor(first?: number | KVector, second?: number | KVector) {
    super()
    if (first === undefined) {
      this.x = 0.0
      this.y = 0.0
    } else if (first instanceof KVector) {
      if (second instanceof KVector) {
        this.x = second.x - first.x
        this.y = second.y - first.y
      } else {
        this.x = first.x
        this.y = first.y
      }
    } else if (typeof second === 'number') {
      this.x = first
      this.y = second
    } else {
      this.x = Math.cos(first)
      this.y = Math.sin(first)
    }
  }

  clone(): KVector { return new KVector(this.x, this.y) }
  toString(): string { return `(${this.x},${this.y})` }
  equals(obj: unknown): boolean { return obj instanceof KVector && this.x === obj.x && this.y === obj.y }

  equalsFuzzily(other: KVector, fuzzyness = KVector.DEFAULT_FUZZYNESS): boolean {
    return Math.abs(this.x - other.x) <= fuzzyness && Math.abs(this.y - other.y) <= fuzzyness
  }

  hashCode(): number { return (Double.valueOf(this.x).hashCode() + Integer.reverse(Double.valueOf(this.y).hashCode())) | 0 }
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y) }
  squareLength(): number { return this.x * this.x + this.y * this.y }

  reset(): KVector {
    this.x = 0.0
    this.y = 0.0
    return this
  }

  set(other: KVector): KVector
  set(newX: number, newY: number): KVector
  set(first: number | KVector, second?: number): KVector {
    this.x = first instanceof KVector ? first.x : first
    this.y = first instanceof KVector ? first.y : second!
    return this
  }

  add(v: KVector): KVector
  add(dx: number, dy: number): KVector
  add(first: number | KVector, second?: number): KVector {
    this.x += first instanceof KVector ? first.x : first
    this.y += first instanceof KVector ? first.y : second!
    return this
  }

  static sum(...vs: KVector[]): KVector {
    const sum = new KVector()
    for (const v of vs) {
      sum.x += v.x
      sum.y += v.y
    }
    return sum
  }

  sub(v: KVector): KVector
  sub(dx: number, dy: number): KVector
  sub(first: number | KVector, second?: number): KVector {
    this.x -= first instanceof KVector ? first.x : first
    this.y -= first instanceof KVector ? first.y : second!
    return this
  }

  static diff(v1: KVector, v2: KVector): KVector { return new KVector(v1.x - v2.x, v1.y - v2.y) }

  scale(scale: number): KVector
  scale(scalex: number, scaley: number): KVector
  scale(scalex: number, scaley = scalex): KVector {
    this.x *= scalex
    this.y *= scaley
    return this
  }

  normalize(): KVector {
    const length = this.length()
    if (length > 0) {
      this.x /= length
      this.y /= length
    }
    return this
  }

  scaleToLength(length: number): KVector {
    this.normalize()
    this.scale(length)
    return this
  }

  negate(): KVector {
    this.x = -this.x
    this.y = -this.y
    return this
  }

  toDegrees(): number { return this.toRadians() * (180.0 / Math.PI) }

  toRadians(): number {
    const length = this.length()
    if (this.x >= 0 && this.y >= 0) return Math.asin(this.y / length)
    if (this.x < 0) return Math.PI - Math.asin(this.y / length)
    return 2 * Math.PI + Math.asin(this.y / length)
  }

  wiggle(random: Random, amount: number): void {
    this.x += random.nextDouble() * amount - (amount / 2)
    this.y += random.nextDouble() * amount - (amount / 2)
  }

  distance(v2: KVector): number {
    const dx = this.x - v2.x
    const dy = this.y - v2.y
    return Math.sqrt((dx * dx) + (dy * dy))
  }

  dotProduct(v2: KVector): number { return this.x * v2.x + this.y * v2.y }
  static crossProduct(v: KVector, w: KVector): number { return v.x * w.y - v.y * w.x }

  rotate(angle: number): KVector {
    const newX = this.x * Math.cos(angle) - this.y * Math.sin(angle)
    this.y = this.x * Math.sin(angle) + this.y * Math.cos(angle)
    this.x = newX
    return this
  }

  angle(other: KVector): number { return Math.acos(this.dotProduct(other) / (this.length() * other.length())) }

  bound(lowx: number, lowy: number, highx: number, highy: number): KVector {
    if (highx < lowx || highy < lowy) throw new Error('java.lang.IllegalArgumentException: The highx must be bigger then lowx and the highy must be bigger then lowy')
    if (this.x < lowx) this.x = lowx
    else if (this.x > highx) this.x = highx
    if (this.y < lowy) this.y = lowy
    else if (this.y > highy) this.y = highy
    return this
  }

  isNaN(): boolean { return Double.isNaN(this.x) || Double.isNaN(this.y) }
  isInfinite(): boolean { return Double.isInfinite(this.x) || Double.isInfinite(this.y) }

  parse(string: string): void {
    let start = 0
    while (start < string.length && KVector.isdelim(string.charAt(start), "([{\"' \t\r\n")) start++
    let end = string.length
    while (end > 0 && KVector.isdelim(string.charAt(end - 1), ")]}\"' \t\r\n")) end--
    if (start >= end) throw new Error('java.lang.IllegalArgumentException: The given string does not contain any numbers.')
    const tokens = string.substring(start, end).split(/,|;|\r|\n/)
    while (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()
    if (tokens.length !== 2) throw new Error(`java.lang.IllegalArgumentException: Exactly two numbers are expected, ${tokens.length} were found.`)
    try {
      this.x = Double.parseDouble(tokens[0]!.trim())
      this.y = Double.parseDouble(tokens[1]!.trim())
    } catch (exception) {
      if (!(exception instanceof NumberFormatException)) throw exception
      throw new Error(`java.lang.IllegalArgumentException: The given string contains parts that cannot be parsed as numbers.${exception}`)
    }
  }

  private static isdelim(c: string, delims: string): boolean {
    for (let i = 0; i < delims.length; i++) if (c === delims.charAt(i)) return true
    return false
  }
}
