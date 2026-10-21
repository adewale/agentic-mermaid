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
  const edge = input.edges[index]!, pair = [{ points }, { points: [] as Point[] }]
  for (let other = 0; other < routes.length; other++) {
    const route = routes[other]!
    if (other === index || route.style === 'invisible') continue
    const peerEdge = input.edges[other]!
    let contacts: Set<string> | undefined
    for (let i = 1; i < points.length; i++) for (let j = 1; j < route.points.length; j++) {
      const a = points[i - 1]!, b = points[i]!, c = route.points[j - 1]!, d = route.points[j]!
      if (sharesShaft(a,b,c,d)) return undefined
      const av = a.x === b.x, bv = c.x === d.x
      let x = 0, y = 0, contact = false
      if (av !== bv) {
        x = av ? a.x : c.x; y = av ? c.y : a.y
        contact = x >= Math.min(a.x,b.x) && x <= Math.max(a.x,b.x) && y >= Math.min(a.y,b.y) && y <= Math.max(a.y,b.y)
          && x >= Math.min(c.x,d.x) && x <= Math.max(c.x,d.x) && y >= Math.min(c.y,d.y) && y <= Math.max(c.y,d.y)
      } else if (av ? a.x === c.x : a.y === c.y) {
        const lo = Math.max(av ? Math.min(a.y,b.y) : Math.min(a.x,b.x), av ? Math.min(c.y,d.y) : Math.min(c.x,d.x))
        const hi = Math.min(av ? Math.max(a.y,b.y) : Math.max(a.x,b.x), av ? Math.max(c.y,d.y) : Math.max(c.x,d.x))
        if (hi >= lo) { x = av ? a.x : lo; y = av ? lo : a.y; contact = true }
      }
      if (!contact) continue
      const first = points[0]!, last = points.at(-1)!, peerFirst = route.points[0]!, peerLast = route.points.at(-1)!
      const from = first.x === x && first.y === y, to = last.x === x && last.y === y
      const peerFrom = peerFirst.x === x && peerFirst.y === y, peerTo = peerLast.x === x && peerLast.y === y
      const common = (edge.source === peerEdge.source && from && peerFrom) || (edge.source === peerEdge.target && from && peerTo)
        || (edge.target === peerEdge.source && to && peerFrom) || (edge.target === peerEdge.target && to && peerTo)
      if (!common) (contacts ??= new Set()).add(`${x},${y}`)
    }
    pair[1]!.points = route.points
    const crossings = countPolylineCrossings(pair)
    if (crossings < (contacts?.size ?? 0)) return undefined
    score += crossings
  }
  return score
}
