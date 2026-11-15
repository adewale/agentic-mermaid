/*******************************************************************************
 * Copyright (c) 2009, 2015 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { DoubleMath } from '../../../../../com/google/common/math/DoubleMath.ts'
import { Integer } from '../../../../../java/lang/Integer.ts'
import { KVector } from './KVector.ts'
import { KVectorChain } from './KVectorChain.ts'
import { ElkRectangle } from './ElkRectangle.ts'

export class ElkMath {
  private constructor() {}

  static maxi(...values: number[]): number {
    let max = Integer.MIN_VALUE
    for (let i = 0; i < values.length; i++) if (values[i]! > max) max = values[i]!
    return max
  }
  static mini(...values: number[]): number {
    let min = Integer.MAX_VALUE
    for (let i = 0; i < values.length; i++) if (values[i]! < min) min = values[i]!
    return min
  }
  static averagei(...values: number[]): number {
    let avg = 0
    for (let i = 0; i < values.length; i++) avg = (avg + values[i]!) | 0
    if (values.length === 0) throw new Error('/ by zero')
    return Math.trunc(avg / values.length) | 0
  }
  static maxl(...values: bigint[]): bigint {
    let max = BigInt(Integer.MIN_VALUE)
    for (let i = 0; i < values.length; i++) if (values[i]! > max) max = values[i]!
    return max
  }
  static minl(...values: bigint[]): bigint {
    let min = BigInt(Integer.MAX_VALUE)
    for (let i = 0; i < values.length; i++) if (values[i]! < min) min = values[i]!
    return min
  }
  static averagel(...values: bigint[]): bigint {
    let avg = 0n
    for (let i = 0; i < values.length; i++) avg = BigInt.asIntN(64, avg + values[i]!)
    return avg / BigInt(values.length)
  }
  static maxf(...values: number[]): number {
    let max = -3.4028234663852886e38
    for (let i = 0; i < values.length; i++) { const value = Math.fround(values[i]!); if (value > max) max = value }
    return max
  }
  static minf(...values: number[]): number {
    let min = 3.4028234663852886e38
    for (let i = 0; i < values.length; i++) { const value = Math.fround(values[i]!); if (value < min) min = value }
    return min
  }
  static averagef(...values: number[]): number {
    let avg = 0
    for (let i = 0; i < values.length; i++) avg = Math.fround(avg + Math.fround(values[i]!))
    return Math.fround(avg / Math.fround(values.length))
  }
  static maxd(...values: number[]): number {
    let max = -Number.MAX_VALUE
    for (let i = 0; i < values.length; i++) if (values[i]! > max) max = values[i]!
    return max
  }
  static mind(...values: number[]): number {
    let min = Number.MAX_VALUE
    for (let i = 0; i < values.length; i++) if (values[i]! < min) min = values[i]!
    return min
  }
  static averaged(...values: number[]): number {
    let avg = 0
    for (let i = 0; i < values.length; i++) avg += values[i]!
    return avg / values.length
  }
  static boundi(x: number, lower: number, upper: number): number { if (x <= lower) return lower; if (x >= upper) return upper; return x }
  static boundl(x: bigint, lower: bigint, upper: bigint): bigint { if (x <= lower) return lower; if (x >= upper) return upper; return x }
  static boundf(x: number, lower: number, upper: number): number {
    x = Math.fround(x); lower = Math.fround(lower); upper = Math.fround(upper)
    if (x <= lower) return lower
    if (x >= upper) return upper
    return x
  }
  static boundd(x: number, lower: number, upper: number): number { if (x <= lower) return lower; if (x >= upper) return upper; return x }
  static clipVector(v: KVector, width: number, height: number): KVector {
    const wh = width / 2, hh = height / 2
    const absx = Math.abs(v.x), absy = Math.abs(v.y)
    let xscale = 1, yscale = 1
    if (absx > wh) xscale = wh / absx
    if (absy > hh) yscale = hh / absy
    v.scale(Math.min(xscale, yscale))
    return v
  }
  static signum(x: number): number { if (x < 0) return -1; if (x > 0) return 1; return 0 }

  static intersects(rect: ElkRectangle, path: KVectorChain): boolean
  static intersects(rect: ElkRectangle, p1: KVector, p2: KVector): boolean
  static intersects(l11: KVector, l12: KVector, l21: KVector, l22: KVector): boolean
  static intersects(first: ElkRectangle | KVector, second: KVectorChain | KVector, third?: KVector, fourth?: KVector): boolean {
    if (first instanceof ElkRectangle) {
      const rect = first
      if (second instanceof KVectorChain) {
        const path = second
        if (path.size() < 2) return false
        const pathIt = path.iterator()
        const firstPoint = pathIt.next()
        let p1 = firstPoint
        while (pathIt.hasNext()) {
          const p2 = pathIt.next()
          if (ElkMath.intersects(rect, p1, p2)) return true
          p1 = p2
        }
        if (ElkMath.intersects(rect, p1, firstPoint)) return true
        return false
      }
      const p1 = second, p2 = third!
      if (ElkMath.contains(rect, p1, p2)) return false
      return ElkMath.intersects(rect.getTopLeft(), rect.getTopRight(), p1, p2)
        || ElkMath.intersects(rect.getTopRight(), rect.getBottomRight(), p1, p2)
        || ElkMath.intersects(rect.getBottomRight(), rect.getBottomLeft(), p1, p2)
        || ElkMath.intersects(rect.getBottomLeft(), rect.getTopLeft(), p1, p2)
    }
    const l11 = first, l12 = second as KVector, l21 = third!, l22 = fourth!
    const u0 = l11
    const v0 = l12.clone().sub(l11)
    const u1 = l21
    const v1 = l22.clone().sub(l21)
    const x00 = u0.x, y00 = u0.y
    const x10 = u1.x, y10 = u1.y
    const x01 = v0.x, y01 = v0.y
    const x11 = v1.x, y11 = v1.y
    const d = x11 * y01 - x01 * y11
    if (DoubleMath.fuzzyEquals(0, d, ElkMath.DOUBLE_EQ_EPSILON)) return false
    const s = (1 / d) * ((x00 - x10) * y01 - (y00 - y10) * x01)
    const t = (1 / d) * -(-(x00 - x10) * y11 + (y00 - y10) * x11)
    const intersects = DoubleMath.fuzzyCompare(0, s, ElkMath.DOUBLE_EQ_EPSILON) < 0
      && DoubleMath.fuzzyCompare(s, 1, ElkMath.DOUBLE_EQ_EPSILON) < 0
      && DoubleMath.fuzzyCompare(0, t, ElkMath.DOUBLE_EQ_EPSILON) < 0
      && DoubleMath.fuzzyCompare(t, 1, ElkMath.DOUBLE_EQ_EPSILON) < 0
    return intersects
  }
  private static readonly DOUBLE_EQ_EPSILON = 0.00001

  static intersects2(p: KVector, r: KVector, q: KVector, s: KVector): KVector | null {
    const pq = q.clone().sub(p)
    const pqXr = KVector.crossProduct(pq, r)
    const rXs = KVector.crossProduct(r, s)
    const t = KVector.crossProduct(pq, s) / rXs
    const u = pqXr / rXs
    if (rXs === 0) {
      if (pqXr === 0) {
        const center = q.clone().add(s.clone().scale(0.5))
        const d1 = p.distance(center)
        const d2 = p.clone().add(r).distance(center)
        const l = s.length() * 0.5
        if (d1 < d2 && d1 <= l) return p.clone()
        if (d2 <= l) return p.clone().add(r)
        return null
      }
      return null
    }
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return p.clone().add(r.clone().scale(t))
    return null
  }
  static distance(a1: KVector, a2: KVector, b1: KVector, b2: KVector, v: KVector): number {
    return Math.min(ElkMath.traceRays(a1, a2, b1, b2, v), ElkMath.traceRays(b1, b2, a1, a2, v.clone().negate()))
  }
  private static traceRays(a1: KVector, a2: KVector, b1: KVector, b2: KVector, v: KVector): number {
    let result = Number.POSITIVE_INFINITY
    let endpointHit = false
    let intersection = ElkMath.intersects2(a1, a2.clone().sub(a1), b1.clone().add(v), b2.clone().sub(b1))
    const edgeCase = intersection !== null && !(intersection.equalsFuzzily(a1) || intersection.equalsFuzzily(a2))
    intersection = ElkMath.intersects2(a1, a2.clone().sub(a1), b1, v)
    if (intersection !== null) {
      if (intersection.equalsFuzzily(a1) === intersection.equalsFuzzily(a2) || edgeCase) result = Math.min(result, intersection.sub(b1).length())
      else endpointHit = true
    }
    intersection = ElkMath.intersects2(a1, a2.clone().sub(a1), b2, v)
    if (intersection !== null) {
      if (endpointHit || intersection.equalsFuzzily(a1) === intersection.equalsFuzzily(a2) || edgeCase) result = Math.min(result, intersection.sub(b2).length())
    }
    return result
  }
  static contains(rect: ElkRectangle, path: KVectorChain): boolean
  static contains(rect: ElkRectangle, p1: KVector, p2: KVector): boolean
  static contains(rect: ElkRectangle, p: KVector): boolean
  static contains(rect: ElkRectangle, second: KVectorChain | KVector, third?: KVector): boolean {
    if (second instanceof KVectorChain) {
      const path = second
      if (path.size() < 2) return false
      const pathIt = path.iterator()
      const first = pathIt.next()
      let p1 = first
      while (pathIt.hasNext()) {
        const p2 = pathIt.next()
        if (!ElkMath.contains(rect, p1, p2)) return false
        p1 = p2
      }
      if (!ElkMath.contains(rect, p1, first)) return false
      return true
    }
    if (third !== undefined) return ElkMath.contains(rect, second) && ElkMath.contains(rect, third)
    const p = second
    const minX = rect.x
    const maxX = rect.x + rect.width
    const minY = rect.y
    const maxY = rect.y + rect.height
    return (p.x > minX && p.x < maxX) && (p.y > minY && p.y < maxY)
  }
  static shortestDistance(r1: ElkRectangle, r2: ElkRectangle): number {
    const rightDist = r2.x - (r1.x + r1.width)
    const leftDist = r1.x - (r2.x + r2.width)
    const topDist = r1.y - (r2.y + r2.height)
    const bottomDist = r2.y - (r1.y + r1.height)
    const horzDist = Math.max(leftDist, rightDist)
    const vertDist = Math.max(topDist, bottomDist)
    if ((DoubleMath.fuzzyCompare(horzDist, 0, ElkMath.DOUBLE_EQ_EPSILON) >= 0)
      !== (DoubleMath.fuzzyCompare(vertDist, 0, ElkMath.DOUBLE_EQ_EPSILON) >= 0)) return Math.max(vertDist, horzDist)
    if (DoubleMath.fuzzyCompare(horzDist, 0, ElkMath.DOUBLE_EQ_EPSILON) > 0) return Math.sqrt(vertDist * vertDist + horzDist * horzDist)
    return -Math.sqrt(vertDist * vertDist + horzDist * horzDist)
  }
}
