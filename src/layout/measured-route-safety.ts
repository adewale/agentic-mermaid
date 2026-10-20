import type { MeasuredGraph } from './agentic-layered-core.ts'
import type { Point } from '../types.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

export interface MeasuredBox {
  x: number
  y: number
  width: number
  height: number
}

export function segmentEntersMeasuredBox(a: Point, b: Point, box: MeasuredBox): boolean {
  return a.x === b.x ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
}

export function pointOnMeasuredSegment(point: Point, a: Point, b: Point): boolean {
  return (a.x === b.x ? Math.abs(point.x - a.x) < 1e-7 : Math.abs(point.y - a.y) < 1e-7) && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)
}

export function measuredBoxesOverlap(a: MeasuredBox, b: MeasuredBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function sharesShaft(a: Point, b: Point, c: Point, d: Point): boolean {
  return (
    (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) <= 0.5 && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 0.01) ||
    (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) <= 0.5 && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 0.01)
  )
}

/** A bend touching another route must not erase a crossing from the metric.
 * Only an authored common endpoint may be an unmarked contact. */
export function scoreMeasuredRouteCrossings(points: Point[], index: number, routes: readonly { points: Point[]; style: string }[], input: MeasuredGraph): number | undefined {
  let score = 0
  const edge = input.edges[index]!
  for (const [other, route] of routes.entries()) {
    if (other === index || route.style === 'invisible') continue
    const peerEdge = input.edges[other]!,
      contacts = new Map<string, Point>()
    for (let i = 1; i < points.length; i++)
      for (let j = 1; j < route.points.length; j++) {
        const a = points[i - 1]!,
          b = points[i]!,
          c = route.points[j - 1]!,
          d = route.points[j]!
        if (sharesShaft(a, b, c, d)) return undefined
        const av = a.x === b.x,
          bv = c.x === d.x
        let p: Point | undefined
        if (av !== bv) {
          const vertical = av ? a : c,
            horizontal = av ? c : a
          const point = { x: vertical.x, y: horizontal.y }
          if (pointOnMeasuredSegment(point, a, b) && pointOnMeasuredSegment(point, c, d)) p = point
        } else if (av ? a.x === c.x : a.y === c.y) {
          const lo = Math.max(av ? Math.min(a.y, b.y) : Math.min(a.x, b.x), av ? Math.min(c.y, d.y) : Math.min(c.x, d.x))
          const hi = Math.min(av ? Math.max(a.y, b.y) : Math.max(a.x, b.x), av ? Math.max(c.y, d.y) : Math.max(c.x, d.x))
          if (hi >= lo) p = av ? { x: a.x, y: lo } : { x: lo, y: a.y }
        }
        if (!p) continue
        const common = (
          [
            ['source', 0],
            ['target', points.length - 1],
          ] as const
        ).some(([end, pointIndex]) =>
          (
            [
              ['source', 0],
              ['target', route.points.length - 1],
            ] as const
          ).some(([peerEnd, peerIndex]) => edge[end] === peerEdge[peerEnd] && points[pointIndex]!.x === p!.x && points[pointIndex]!.y === p!.y && route.points[peerIndex]!.x === p!.x && route.points[peerIndex]!.y === p!.y),
        )
        if (!common) contacts.set(`${p.x},${p.y}`, p)
      }
    const crossings = countPolylineCrossings([{ points }, route])
    if (crossings < contacts.size) return undefined
    score += crossings
  }
  return score
}
