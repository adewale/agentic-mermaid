/*******************************************************************************
 * Copyright (c) 2014, 2017 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { Double } from '../../../../../java/lang/Double.ts'
import { JavaObject } from '../../../../../java/lang/Object.ts'
import { KVector } from './KVector.ts'

export class ElkRectangle extends JavaObject {
  x: number
  y: number
  width: number
  height: number

  constructor()
  constructor(x: number, y: number, w: number, h: number)
  constructor(rect: ElkRectangle)
  constructor(first: number | ElkRectangle = 0, y = 0, w = 0, h = 0) {
    super()
    if (first instanceof ElkRectangle) {
      this.x = first.x
      this.y = first.y
      this.width = first.width
      this.height = first.height
    } else {
      this.x = first
      this.y = y
      this.width = w
      this.height = h
    }
  }
  setRect(nx: number, ny: number, nw: number, nh: number): void { this.x = nx; this.y = ny; this.width = nw; this.height = nh }
  getPosition(): KVector { return new KVector(this.x, this.y) }
  getTopLeft(): KVector { return this.getPosition() }
  getTopRight(): KVector { return new KVector(this.x + this.width, this.y) }
  getBottomLeft(): KVector { return new KVector(this.x, this.y + this.height) }
  getBottomRight(): KVector { return new KVector(this.x + this.width, this.y + this.height) }
  getCenter(): KVector { return new KVector(this.x + this.width / 2, this.y + this.height / 2) }
  union(other: ElkRectangle): void {
    let x1 = Math.min(this.x, other.x)
    let y1 = Math.min(this.y, other.y)
    let x2 = Math.max(this.x + this.width, other.x + other.width)
    let y2 = Math.max(this.y + this.height, other.y + other.height)
    if (x2 < x1) { const t = x1; x1 = x2; x2 = t }
    if (y2 < y1) { const t = y1; y1 = y2; y2 = t }
    this.setRect(x1, y1, x2 - x1, y2 - y1)
  }
  move(offset: KVector): void { this.x += offset.x; this.y += offset.y }
  override toString(): string { return `Rect[x=${this.x},y=${this.y},w=${this.width},h=${this.height}]` }
  override equals(obj: unknown): boolean {
    // GWT's Objects.equals on boxed Double values uses JavaScript number equality.
    return obj instanceof ElkRectangle && this.x === obj.x && this.y === obj.y && this.width === obj.width && this.height === obj.height
  }
  override hashCode(): number {
    let hash = 1
    for (const value of [this.x, this.y, this.width, this.height]) hash = (Math.imul(31, hash) + Double.hashCode(value)) | 0
    return hash
  }
  getMaxX(): number { return this.x + this.width }
  getMaxY(): number { return this.y + this.height }
  intersects(rect: ElkRectangle): boolean {
    const r1x1 = this.x
    const r1y1 = this.y
    const r1x2 = this.x + this.width
    const r1y2 = this.y + this.height
    const r2x1 = rect.x
    const r2y1 = rect.y
    const r2x2 = rect.x + rect.width
    const r2y2 = rect.y + rect.height
    return r1x1 < r2x2 && r1x2 > r2x1 && r1y2 > r2y1 && r1y1 < r2y2
  }
}
