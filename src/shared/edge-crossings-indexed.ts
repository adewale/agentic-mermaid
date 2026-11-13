/**
 * Indexed evaluation of the shared crossing metric for large route sets.
 *
 * The reference sweep tests every pair of segments whose closed bounding boxes
 * overlap. Dense orthogonal layouts make that set quadratic: every horizontal
 * channel segment properly crosses most vertical port segments. This module
 * returns the same number without visiting those pairs one by one.
 *
 * A "clean" incidence is a horizontal segment of one route and a vertical
 * segment of another that cross strictly inside both, at least `margin` away
 * from both segments' ends, where both routes are short, axis-aligned and keep
 * every non-adjacent pair of their own segments more than `margin` apart. For
 * such a pair the shared predicate always reports a straight-interior crossing
 * at a location no other incidence of the same route pair can share, so each
 * clean incidence contributes exactly one to the count. They are counted with a
 * sweep over x and a Fenwick tree over horizontal y (orthogonal segment
 * intersection counting). Every other bounding-box overlap — touching ends,
 * diagonal segments, routes that retrace or nearly touch themselves — is still
 * evaluated pair by pair with the shared predicate and deduplicated exactly as
 * the reference does.
 *
 * Why a clean incidence is unique within its route pair: any other incidence of
 * the same pair lies on another segment of one of the two routes, which is
 * either adjacent (sharing an end at least `margin` away along the axis) or
 * separated by more than `margin`. Between two clean routes every evaluated
 * incidence is horizontal × vertical, whose location error is a few ULPs of
 * the coordinate scale, far below `margin`; parallel axis segments never cross.
 */
interface Point { readonly x: number; readonly y: number }
interface Location extends Point { error: number }
export interface IndexedSegment {
  readonly a: Point
  readonly b: Point
  readonly edgeIndex: number
  readonly pointIndex: number
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}
type Predicate = (a: IndexedSegment, b: IndexedSegment) => Location | undefined

/** Larger routes take the pairwise path; the self-separation check is k². */
const MAX_CLEAN_ROUTE_SEGMENTS = 64
/** Beyond this coordinate magnitude, products in the predicate lose the margin. */
const MAX_INDEXED_COORDINATE = 1e12

const lowerBound = (values: readonly number[], value: number, strict: boolean): number => {
  let lo = 0, hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (strict ? values[mid]! <= value : values[mid]! < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

class Fenwick {
  private readonly tree: Int32Array
  constructor(size: number) { this.tree = new Int32Array(size + 1) }
  add(index: number, delta: number): void { for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i]! += delta }
  /** Sum over [0, end). */
  prefix(end: number): number { let sum = 0; for (let i = end; i > 0; i -= i & -i) sum += this.tree[i]!; return sum }
}

/**
 * `sorted` must be the reference order (minX, minY, edgeIndex, pointIndex) of
 * every visible non-degenerate segment; `byRoute` the same segments in route
 * order. Returns undefined when the input is outside the indexed domain (any
 * non-finite or very large coordinate); the caller then uses the reference.
 */
export function countIndexedCrossings(
  routeCount: number,
  byRoute: readonly IndexedSegment[],
  sorted: readonly IndexedSegment[],
  involved: ReadonlySet<number> | undefined,
  crossing: Predicate,
  distinct: (points: Location[]) => number,
): number | undefined {
  let scale = 1
  for (const segment of sorted) {
    const extent = Math.max(Math.abs(segment.minX), Math.abs(segment.maxX), Math.abs(segment.minY), Math.abs(segment.maxY))
    if (!(extent <= MAX_INDEXED_COORDINATE)) return undefined
    if (extent > scale) scale = extent
  }
  // Far above the predicate's own error terms and the physical endpoint radius.
  const margin = 0.05 + scale * 1e-9
  const rank = new Map<IndexedSegment, number>()
  sorted.forEach((segment, index) => rank.set(segment, index))
  const counts = (edge: number): boolean => !involved || involved.has(edge)

  // Clean routes: short, axis-aligned, no reversal, self-separated by margin.
  const clean = new Uint8Array(routeCount)
  const segmentsOf: IndexedSegment[][] = Array.from({ length: routeCount }, () => [])
  for (const segment of byRoute) segmentsOf[segment.edgeIndex]!.push(segment)
  for (let edge = 0; edge < routeCount; edge++) {
    const own = segmentsOf[edge]!
    if (own.length === 0 || own.length > MAX_CLEAN_ROUTE_SEGMENTS) continue
    let ok = own.every(s => s.a.x === s.b.x || s.a.y === s.b.y)
    for (let i = 0; ok && i + 1 < own.length; i++) {
      const s = own[i]!, t = own[i + 1]!
      const sx = Math.sign(s.b.x - s.a.x), sy = Math.sign(s.b.y - s.a.y), tx = Math.sign(t.b.x - t.a.x), ty = Math.sign(t.b.y - t.a.y)
      if ((sx !== 0 && sx === -tx) || (sy !== 0 && sy === -ty)) ok = false
    }
    for (let i = 0; ok && i < own.length; i++) {
      for (let j = i + 2; j < own.length; j++) {
        const s = own[i]!, t = own[j]!
        if (!(s.maxX + margin < t.minX || t.maxX + margin < s.minX || s.maxY + margin < t.minY || t.maxY + margin < s.minY)) { ok = false; break }
      }
    }
    if (ok) clean[edge] = 1
  }

  interface Horizontal { s: IndexedSegment; y: number; lo: number; hi: number }
  interface Vertical { s: IndexedSegment; x: number; lo: number; hi: number }
  const horizontals: Horizontal[] = [], verticals: Vertical[] = [], general: IndexedSegment[] = []
  const fast = new Set<IndexedSegment>()
  for (const s of sorted) {
    if (!clean[s.edgeIndex]) { general.push(s); continue }
    fast.add(s)
    if (s.a.y === s.b.y) horizontals.push({ s, y: s.minY, lo: s.minX + margin, hi: s.maxX - margin })
    else verticals.push({ s, x: s.minX, lo: s.minY + margin, hi: s.maxY - margin })
  }
  // Clean means h.lo < v.x < h.hi and v.lo < h.y < v.hi, with exactly these
  // stored bounds in the counter and in every exclusion below.

  // 1. Count clean incidences: x-sweep, Fenwick over horizontal y.
  let cleanCount = 0
  const ys = [...new Set(horizontals.filter(h => h.lo < h.hi).map(h => h.y))].sort((p, q) => p - q)
  if (ys.length && verticals.length) {
    const all = new Fenwick(ys.length), selected = new Fenwick(ys.length)
    // Removal (hi) before queries before insertion (lo) at one x: open intervals.
    const events: Array<{ x: number; kind: 0 | 1 | 2; h?: Horizontal; v?: Vertical }> = []
    for (const h of horizontals) {
      if (!(h.lo < h.hi)) continue
      events.push({ x: h.lo, kind: 2, h }, { x: h.hi, kind: 0, h })
    }
    for (const v of verticals) events.push({ x: v.x, kind: 1, v })
    events.sort((p, q) => p.x - q.x || p.kind - q.kind)
    for (const event of events) {
      if (event.kind === 1) {
        const v = event.v!
        const from = lowerBound(ys, v.lo, true), to = lowerBound(ys, v.hi, false)
        if (from >= to) continue
        cleanCount += counts(v.s.edgeIndex) ? all.prefix(to) - all.prefix(from) : selected.prefix(to) - selected.prefix(from)
      } else {
        const h = event.h!, index = lowerBound(ys, h.y, false), delta = event.kind === 2 ? 1 : -1
        all.add(index, delta)
        if (counts(h.s.edgeIndex)) selected.add(index, delta)
      }
    }
  }

  // 2. Evaluate every other bounding-box overlap with the shared predicate.
  const locations = new Map<number, Location[]>()
  const evaluate = (first: IndexedSegment, second: IndexedSegment): void => {
    if (first.edgeIndex === second.edgeIndex || (!counts(first.edgeIndex) && !counts(second.edgeIndex))) return
    const later = rank.get(first)! > rank.get(second)! ? first : second
    const point = crossing(later, later === first ? second : first)
    if (!point) return
    const low = Math.min(first.edgeIndex, second.edgeIndex), high = Math.max(first.edgeIndex, second.edgeIndex)
    const key = low * routeCount + high
    const previous = locations.get(key)
    if (!previous) { locations.set(key, [point]); return }
    const duplicate = previous.find(p => p.x === point.x && p.y === point.y)
    if (duplicate) duplicate.error = Math.max(duplicate.error, point.error)
    else previous.push(point)
  }

  // 2a. Pairs with a general segment: the reference sweep, scanning only the
  // side that can contain one. Fast-only pairs are left to 2b and the counter.
  const activeAll: IndexedSegment[] = [], activeGeneral: IndexedSegment[] = []
  const overlapsY = (s: IndexedSegment, t: IndexedSegment): boolean => !(t.maxY < s.minY || t.minY > s.maxY)
  if (general.length) {
    for (const s of sorted) {
      const isGeneral = !fast.has(s)
      const scan = isGeneral ? activeAll : activeGeneral
      let retained = 0
      for (let index = 0; index < scan.length; index++) {
        const other = scan[index]!
        if (!(other.maxX >= s.minX)) continue
        scan[retained++] = other
        if (overlapsY(s, other)) evaluate(s, other)
      }
      scan.length = retained
      activeAll.push(s)
      if (isGeneral) activeGeneral.push(s)
    }
  }

  // 2b. Fast horizontal × vertical overlaps that are not clean: near an end
  // in x (from each horizontal), else near an end in y (from each vertical).
  // Parallel fast segments never cross under the predicate (zero determinant).
  const byX = [...verticals].sort((p, q) => p.x - q.x), xs = byX.map(v => v.x)
  const byY = [...horizontals].sort((p, q) => p.y - q.y), hys = byY.map(h => h.y)
  const windows = (min: number, max: number, lo: number, hi: number): Array<[number, number]> => {
    const first = Math.min(max, lo), second = Math.max(min, hi)
    return first >= second ? [[min, max]] : [[min, first], [second, max]]
  }
  for (const h of horizontals) {
    for (const [from, to] of windows(h.s.minX, h.s.maxX, h.lo, h.hi)) {
      for (let i = lowerBound(xs, from, false); i < byX.length && byX[i]!.x <= to; i++) {
        const v = byX[i]!
        if (v.s.minY <= h.y && h.y <= v.s.maxY) evaluate(h.s, v.s)
      }
    }
  }
  for (const v of verticals) {
    for (const [from, to] of windows(v.s.minY, v.s.maxY, v.lo, v.hi)) {
      for (let i = lowerBound(hys, from, false); i < byY.length && byY[i]!.y <= to; i++) {
        const h = byY[i]!
        if (h.s.minX <= v.x && v.x <= h.s.maxX && h.lo < v.x && v.x < h.hi) evaluate(h.s, v.s)
      }
    }
  }

  let crossings = cleanCount
  for (const points of locations.values()) crossings += distinct(points)
  return crossings
}
