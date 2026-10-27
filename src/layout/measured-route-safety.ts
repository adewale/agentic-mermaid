import type { MeasuredGraph } from './agentic-layered-core.ts'
import type { Point } from '../types.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'

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

/** Extra physical checks debit the owning caller's existing allowance. False
 * stops immediately; the caller's exhausted ledger remains authoritative. */
export type MeasuredContactCharge = (amount: number) => boolean | void

export function writtenCoordinateGapLessThan(a: string, b: string, width: string, charge?: MeasuredContactCharge): boolean | undefined {
  if (charge?.(8) === false) return undefined
  const x = Number(a), y = Number(b), w = Number(width), difference = Math.abs(x - y) - w
  // This only selects exact arithmetic near binary cancellation. It is never
  // a geometric tolerance or an allowance for positive painted overlap.
  if (Math.abs(difference) > 8 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y), w)) return difference < 0
  if (charge?.(384) === false) return undefined
  const part = (text: string) => {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text)!
    return { n: BigInt(m[1]! + m[2]! + (m[3] ?? '')), e: Number(m[4] ?? 0) - (m[3]?.length ?? 0) }
  }
  const A = part(a), B = part(b), W = part(width), scale = Math.min(A.e, B.e, W.e)
  if (charge?.(32 + A.e - scale + B.e - scale + W.e - scale) === false) return undefined
  const delta = A.n * 10n ** BigInt(A.e - scale) - B.n * 10n ** BigInt(B.e - scale),
    magnitude = delta < 0n ? -delta : delta
  return magnitude < W.n * 10n ** BigInt(W.e - scale)
}

function sharesWrittenShaft(a: Point, b: Point, c: Point, d: Point, width: number, widthText: string, charge?: MeasuredContactCharge): boolean | undefined {
  if (charge?.(4) === false) return undefined
  const vertical = a.x === b.x
  if ((c.x === d.x) !== vertical || (!vertical && (a.y !== b.y || c.y !== d.y))) return false
  if (charge?.(12) === false) return undefined
  const fixed = vertical ? a.x : a.y,
    other = vertical ? c.x : c.y
  // Broad phase only: contain the writer's twelve-significant-digit rounding.
  const error = (Math.abs(fixed) + Math.abs(other) + width) * 1e-10 + 1e-9
  if (Math.abs(fixed - other) > width + error) return false
  const A = vertical ? a.y : a.x,
    B = vertical ? b.y : b.x,
    C = vertical ? c.y : c.x,
    D = vertical ? d.y : d.x
  const spanError = (Math.abs(A) + Math.abs(B) + Math.abs(C) + Math.abs(D)) * 1e-10 + 1e-9
  if (Math.min(Math.max(A, B), Math.max(C, D)) < Math.max(Math.min(A, B), Math.min(C, D)) - spanError) return false
  // Prepay bounded numeric spellings before invoking the canonical writer.
  if (charge?.(256) === false) return undefined
  const gap = writtenCoordinateGapLessThan(formatSvgNumber(fixed), formatSvgNumber(other), widthText, charge)
  if (gap !== true) return gap
  if (charge?.(512) === false) return undefined
  const wa = Number(formatSvgNumber(A)),
    wb = Number(formatSvgNumber(B)),
    wc = Number(formatSvgNumber(C)),
    wd = Number(formatSvgNumber(D)),
    lo = Math.max(Math.min(wa, wb), Math.min(wc, wd)),
    hi = Math.min(Math.max(wa, wb), Math.max(wc, wd))
  return lo < hi
}


function orthogonal(points: readonly Point[]): boolean {
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
      || (index && point.x !== points[index - 1]!.x && point.y !== points[index - 1]!.y)) return false
  }
  return true
}

/** A bend touching another route must not erase a crossing from the metric.
 * Only an authored common endpoint may be an unmarked contact. */
export function scoreMeasuredRouteCrossings(points: Point[], index: number, routes: readonly { points: Point[]; style: string }[], input: MeasuredGraph, charge?: MeasuredContactCharge): number | undefined {
  let score = 0
  let width: number | undefined, widthText: string | undefined
  if (input.maximumEdgeStrokeWidth !== undefined) {
    if (charge?.(128) === false) return undefined
    widthText = formatSvgNumber(input.maximumEdgeStrokeWidth)
    width = Number(widthText)
    if (!Number.isFinite(width) || width <= 0) throw new TypeError('Measured stroke width must be finite and positive')
  }
  let candidateOrthogonal: boolean | undefined
  const edge = input.edges[index]!, pair = [{ points }, { points: [] as Point[] }]
  for (let other = 0; other < routes.length; other++) {
    const route = routes[other]!
    if (other === index || route.style === 'invisible') continue
    const peerEdge = input.edges[other]!
    let contacts: Set<string> | undefined
    for (let i = 1; i < points.length; i++) for (let j = 1; j < route.points.length; j++) {
      const a = points[i - 1]!, b = points[i]!, c = route.points[j - 1]!, d = route.points[j]!
      if (width === undefined) {
        if (sharesShaft(a,b,c,d)) return undefined
      } else {
        const shared = sharesWrittenShaft(a,b,c,d,width,widthText!,charge)
        if (shared !== false) return undefined
      }
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
    // Every proper crossing of finite orthogonal routes is a recorded
    // perpendicular contact. A contact-free pair needs no segment preparation.
    if (!contacts && (candidateOrthogonal ??= orthogonal(points)) && orthogonal(route.points)) continue
    pair[1]!.points = route.points
    const crossings = countPolylineCrossings(pair)
    if (crossings < (contacts?.size ?? 0)) return undefined
    score += crossings
  }
  return score
}
