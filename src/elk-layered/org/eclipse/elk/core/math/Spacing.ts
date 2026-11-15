/*******************************************************************************
 * Copyright (c) 2014, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Double, NumberFormatException } from '../../../../../java/lang/Double.ts'
import { IllegalArgumentException } from '../../../../../java/lang/IllegalArgumentException.ts'
import { JavaObject } from '../../../../../java/lang/Object.ts'
import { Cloneable } from '../../../../../java/lang/Cloneable.ts'
import type { IDataObject } from '../util/IDataObject.ts'

export abstract class Spacing extends JavaObject implements IDataObject, Cloneable {
  readonly [Cloneable] = true
  static readonly #serialVersionUID = 4358555478195088364n
  top = 0.0
  bottom = 0.0
  left = 0.0
  right = 0.0

  protected constructor()
  protected constructor(top: number, right: number, bottom: number, left: number)
  protected constructor(top?: number, right?: number, bottom?: number, left?: number) {
    super()
    if (top !== undefined) this.set(top, right!, bottom!, left!)
  }

  set(spacing: Spacing): void
  set(newTop: number, newRight: number, newBottom: number, newLeft: number): void
  set(first: number | Spacing, newRight?: number, newBottom?: number, newLeft?: number): void {
    if (first instanceof Spacing) {
      this.set(first.top, first.right, first.bottom, first.left)
    } else {
      this.top = first
      this.right = newRight!
      this.bottom = newBottom!
      this.left = newLeft!
    }
  }

  getTop(): number { return this.top }
  setTop(top: number): void { this.top = top }
  getRight(): number { return this.right }
  setRight(right: number): void { this.right = right }
  getBottom(): number { return this.bottom }
  setBottom(bottom: number): void { this.bottom = bottom }
  getLeft(): number { return this.left }
  setLeft(left: number): void { this.left = left }
  setLeftRight(val: number): void { this.left = val; this.right = val }
  setTopBottom(val: number): void { this.top = val; this.bottom = val }
  getHorizontal(): number { return this.getLeft() + this.getRight() }
  getVertical(): number { return this.getTop() + this.getBottom() }

  equals(obj: unknown): boolean {
    return obj instanceof Spacing && this.top === obj.top && this.bottom === obj.bottom && this.left === obj.left && this.right === obj.right
  }

  hashCode(): number {
    let code1 = Double.valueOf(this.left).hashCode() << 16
    code1 |= Double.valueOf(this.bottom).hashCode() & 0xffff
    let code2 = Double.valueOf(this.right).hashCode() << 16
    code2 |= Double.valueOf(this.top).hashCode() & 0xffff
    return code1 ^ code2
  }

  toString(): string { return `[top=${this.top},left=${this.left},bottom=${this.bottom},right=${this.right}]` }

  parse(string: string): void {
    let start = 0
    while (start < string.length && Spacing.isdelim(string.charAt(start), "([{\"' \t\r\n")) start++
    let end = string.length
    while (end > 0 && Spacing.isdelim(string.charAt(end - 1), ")]}\"' \t\r\n")) end--
    if (start < end) {
      const tokens = string.substring(start, end).split(/,|;/)
      while (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()
      try {
        for (const token of tokens) {
          const keyandvalue = token.split('=')
          if (token.length > 0) while (keyandvalue.length > 0 && keyandvalue[keyandvalue.length - 1] === '') keyandvalue.pop()
          if (keyandvalue.length !== 2) throw new IllegalArgumentException('Expecting a list of key-value pairs.')
          const key = keyandvalue[0]!.trim()
          const value = Double.parseDouble(keyandvalue[1]!.trim())
          if (key === 'top') this.top = value
          else if (key === 'left') this.left = value
          else if (key === 'bottom') this.bottom = value
          else if (key === 'right') this.right = value
        }
      } catch (exception) {
        if (!(exception instanceof NumberFormatException)) throw exception
        throw new IllegalArgumentException(`The given string contains parts that cannot be parsed as numbers.${exception}`)
      }
    }
  }

  private static isdelim(c: string, delims: string): boolean {
    for (let i = 0; i < delims.length; i++) if (c === delims.charAt(i)) return true
    return false
  }

  copy(other: Spacing): Spacing {
    this.left = other.left
    this.right = other.right
    this.top = other.top
    this.bottom = other.bottom
    return this
  }

  add(other: Spacing): Spacing {
    this.left += other.left
    this.right += other.right
    this.top += other.top
    this.bottom += other.bottom
    return this
  }

  abstract clone(): Spacing
}
