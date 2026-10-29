import type { Point } from '../types.ts'

/**
 * ELK computes bends in Float64 and its adapters add container offsets, so one
 * axis-aligned run can come back with coordinates a roundoff apart (x
 * 6527.03333333333 beside 6527.033333333329). Exact orthogonality checks, and
 * SVG spellings that shorten long decimal tails, then see a diagonal. Give each
 * such run the coordinate of its first point. Only a difference within eight
 * ulps and below 1e-6 counts; anything larger is real geometry and is kept.
 */
export function alignElkRoundoff(points: Point[]): Point[] {
  let aligned: Point[] | undefined
  for (const axis of ['x', 'y'] as const) {
    let anchor = points[0]?.[axis]
    for (let index = 1; index < points.length; index++) {
      const value = points[index]![axis]
      if (value === anchor) continue
      if (anchor !== undefined && withinRoundoff(value, anchor)) {
        aligned ??= points.map(point => ({ ...point }))
        aligned[index]![axis] = anchor
      } else anchor = value
    }
  }
  return aligned ?? points
}

function withinRoundoff(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.min(1e-6, 8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)))
}
