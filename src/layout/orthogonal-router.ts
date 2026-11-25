// One obstacle-aware orthogonal router any family can use. A family supplies
// the endpoints with their required exit and entry directions, the boxes a
// route must stay clear of, and optionally the channel coordinates it prefers
// (gutters between columns, gaps between lanes). The router searches the
// sparse orthogonal grid those coordinates span and returns the route with the
// fewest bends, then the shortest, that keeps every segment out of every
// inflated obstacle. It is deterministic: ties prefer earlier coordinates.

export interface RouterPoint { readonly x: number; readonly y: number }
export interface RouterBox { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
export type RouterDirection = 'E' | 'W' | 'N' | 'S'

export interface OrthogonalRouteRequest {
  readonly start: RouterPoint
  readonly end: RouterPoint
  /** Direction of the first segment, leaving `start`; a list admits any of
   * them, for an endpoint that is already clear of its own box. */
  readonly exit: RouterDirection | readonly RouterDirection[]
  /** Direction of travel of the last segment, arriving at `end`; a list
   * admits any of them. */
  readonly entry: RouterDirection | readonly RouterDirection[]
  readonly obstacles: readonly RouterBox[]
  /** Distance every segment keeps from every obstacle. */
  readonly clearance: number
  /** Extra candidate coordinates for vertical (x) and horizontal (y) runs. */
  readonly channels?: { readonly x?: readonly number[]; readonly y?: readonly number[] }
  /** Route only along the channels (plus the endpoint stubs), never hugging
   * an obstacle edge: for families whose routes belong in fixed corridors. */
  readonly channelsOnly?: boolean
  /** Minimum length of the first and last segments (port stubs, markers). */
  readonly stub?: number
  /** Cost of one bend in pixels of length; bends dominate by default. */
  readonly bendCost?: number
  /** Shortest interior segment allowed: a turn needs at least this much run
   * since the previous turn, so a route never makes a visible tiny jog. */
  readonly minRun?: number
  /** Segments of routes already drawn. A new segment may not run on the same
   * line within `gap` of one (it would read as one line turning), nor beside
   * one closer than `separation` where their spans overlap. */
  readonly avoid?: { readonly segments: readonly (readonly [RouterPoint, RouterPoint])[]; readonly separation: number; readonly gap: number }
  /** The direction the drawn line already travels as it reaches `start` (a
   * lead the caller draws). Leaving in another listed direction is a bend and
   * costs one; turning back is never allowed. */
  readonly startHeading?: RouterDirection
  /** The direction the drawn line continues in after `end`. Arriving in
   * another listed direction is a bend and costs one; arriving head-on
   * against it is never allowed. */
  readonly endHeading?: RouterDirection
  /** Segments of routes already drawn that a new route should not cross.
   * Each crossing adds `cost`; below one bend, a crossing still wins over a
   * detour that needs another bend. */
  readonly crossings?: { readonly segments: readonly (readonly [RouterPoint, RouterPoint])[]; readonly cost: number }
}

const STEP: Record<RouterDirection, RouterPoint> = { E: { x: 1, y: 0 }, W: { x: -1, y: 0 }, N: { x: 0, y: -1 }, S: { x: 0, y: 1 } }
const DIRECTIONS: readonly RouterDirection[] = ['E', 'S', 'W', 'N']
const EPS = 1e-6

/** Whether an axis-aligned segment passes through an obstacle's interior. */
function segmentHits(a: RouterPoint, b: RouterPoint, box: RouterBox): boolean {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
  return x1 > box.x0 + EPS && x0 < box.x1 - EPS && y1 > box.y0 + EPS && y0 < box.y1 - EPS
}

function sortedUnique(values: readonly number[]): number[] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.filter((value, index) => index === 0 || value - sorted[index - 1]! > EPS)
}

/** Whether segment a-b runs too close alongside an existing segment. */
/** Drawn segments a grid step a-b crosses. A crossing exactly at `a` belongs
 * to the step that arrived there, so a route through one point pays once; one
 * exactly at a route's own endpoint (`b` when `open`) is a shared contact, not
 * a crossing. */
function crossedSegments(a: RouterPoint, b: RouterPoint, segments: readonly (readonly [RouterPoint, RouterPoint])[], open: boolean): number {
  const vertical = Math.abs(a.x - b.x) <= EPS
  const fixed = vertical ? a.x : a.y, from = vertical ? a.y : a.x, to = vertical ? b.y : b.x
  let count = 0
  for (const [p, q] of segments) {
    if ((Math.abs(p.x - q.x) <= EPS) === vertical) continue
    const at = vertical ? p.y : p.x
    const lo = vertical ? Math.min(p.x, q.x) : Math.min(p.y, q.y), hi = vertical ? Math.max(p.x, q.x) : Math.max(p.y, q.y)
    if (fixed <= lo + EPS || fixed >= hi - EPS) continue
    const past = (at - from) * Math.sign(to - from), span = Math.abs(to - from)
    if (past > EPS && (open ? past < span - EPS : past <= span + EPS)) count++
  }
  return count
}

function crowds(a: RouterPoint, b: RouterPoint, avoid: NonNullable<OrthogonalRouteRequest['avoid']>): boolean {
  const vertical = Math.abs(a.x - b.x) <= EPS
  const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x)
  for (const [p, q] of avoid.segments) {
    if ((Math.abs(p.x - q.x) <= EPS) !== vertical) continue
    const offset = vertical ? Math.abs(p.x - a.x) : Math.abs(p.y - a.y)
    const plo = vertical ? Math.min(p.y, q.y) : Math.min(p.x, q.x), phi = vertical ? Math.max(p.y, q.y) : Math.max(p.x, q.x)
    const spacing = Math.max(plo - hi, lo - phi)
    if (offset <= EPS ? spacing < avoid.gap : offset < avoid.separation && spacing < 0) return true
  }
  return false
}

interface Queued { readonly i: number; readonly j: number; readonly d: number; readonly cost: number; readonly seq: number }

/** The search order: cheaper first (costs within EPS tie), then the earlier
 * grid column, row and heading, then the earlier push. Deterministic. */
function before(a: Queued, b: Queued): boolean {
  if (Math.abs(a.cost - b.cost) > EPS) return a.cost < b.cost
  return a.i !== b.i ? a.i < b.i : a.j !== b.j ? a.j < b.j : a.d !== b.d ? a.d < b.d : a.seq < b.seq
}

/** Binary min-heap over `before`. */
class StateHeap<T extends Queued> {
  private readonly items: T[] = []
  get size(): number { return this.items.length }
  push(item: T): void {
    const items = this.items
    let index = items.push(item) - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (!before(item, items[parent]!)) break
      items[index] = items[parent]!
      index = parent
    }
    items[index] = item
  }
  pop(): T | undefined {
    const items = this.items, first = items[0], last = items.pop()
    if (first === undefined || last === undefined || items.length === 0) return first
    let index = 0
    for (;;) {
      const left = index * 2 + 1, right = left + 1
      if (left >= items.length) break
      const child = right < items.length && before(items[right]!, items[left]!) ? right : left
      if (!before(items[child]!, last)) break
      items[index] = items[child]!
      index = child
    }
    items[index] = last
    return first
  }
}

/** Fewest bends, then shortest; undefined when no clear route exists. */
export function routeOrthogonal(request: OrthogonalRouteRequest): RouterPoint[] | undefined {
  const { start, end, exit, entry, clearance } = request
  const stub = request.stub ?? 0
  const bendCost = request.bendCost ?? 1e4
  const minRun = request.minRun ?? 0
  const inflated = request.obstacles.map(box => ({ x0: box.x0 - clearance, y0: box.y0 - clearance, x1: box.x1 + clearance, y1: box.y1 + clearance }))
  // Leave and arrive along the required directions for at least the stub.
  const exits = typeof exit === 'string' ? [exit] : exit, entries = typeof entry === 'string' ? [entry] : entry
  const outs = exits.map(d => ({ d, point: { x: start.x + STEP[d].x * stub, y: start.y + STEP[d].y * stub } }))
  const intos = entries.map(d => ({ d, point: { x: end.x - STEP[d].x * stub, y: end.y - STEP[d].y * stub } }))
  if (!outs.length || !intos.length) return undefined
  const out = outs[0]!.point, into = intos[0]!.point
  // Without mandated corridors, obstacle edges and the midpoints between the
  // endpoints are candidates too, so an offset target can be reached directly.
  const edgesX = request.channelsOnly ? [] : [...inflated.flatMap(box => [box.x0, box.x1]), (out.x + into.x) / 2]
  const edgesY = request.channelsOnly ? [] : [...inflated.flatMap(box => [box.y0, box.y1]), (out.y + into.y) / 2]
  const ends = [...outs, ...intos].map(({ point }) => point)
  const xs = sortedUnique([...ends.map(point => point.x), ...edgesX, ...(request.channels?.x ?? [])])
  const ys = sortedUnique([...ends.map(point => point.y), ...edgesY, ...(request.channels?.y ?? [])])
  const clear = (a: RouterPoint, b: RouterPoint) => !inflated.some(box => segmentHits(a, b, box)) && !(request.avoid && crowds(a, b, request.avoid))
  const inside = (p: RouterPoint) => inflated.some(box => p.x > box.x0 + EPS && p.x < box.x1 - EPS && p.y > box.y0 + EPS && p.y < box.y1 - EPS)
  const index = (p: RouterPoint) => {
    const i = xs.findIndex(x => Math.abs(x - p.x) <= EPS), j = ys.findIndex(y => Math.abs(y - p.y) <= EPS)
    return i < 0 || j < 0 ? undefined : { i, j }
  }
  const heading = (d?: RouterDirection) => (d === undefined ? -1 : DIRECTIONS.indexOf(d))
  const startHeading = heading(request.startHeading), endHeading = heading(request.endHeading)
  const reverses = (d: number, h: number) => h >= 0 && (d + 2) % 4 === h
  const sources = outs.filter(({ d, point }) => !inside(point) && !reverses(DIRECTIONS.indexOf(d), startHeading)).map(({ d, point }) => ({ d: DIRECTIONS.indexOf(d), ...index(point)! }))
  const targets = intos.filter(({ d, point }) => !inside(point) && !reverses(DIRECTIONS.indexOf(d), endHeading)).map(({ d, point }) => ({ d: DIRECTIONS.indexOf(d), ...index(point)! }))
  if (!sources.length || !targets.length) return undefined
  // Dijkstra over (grid point, heading). Neighbours are adjacent grid points.
  type State = { i: number; j: number; d: number; cost: number; bends: number; length: number; run: number; seq: number; previous?: State; final?: true }
  // With minRun, a short current run can block a turn a longer one allows,
  // so the search distinguishes the two.
  const key = (i: number, j: number, d: number, run = Infinity) => ((i * ys.length + j) * 4 + d) * 2 + (run < minRun - EPS ? 1 : 0)
  const best = new Map<number, number>()
  // Clearance and crossing cost belong to a grid edge, not to the state that
  // reaches it: each edge is checked once, however many headings arrive.
  // NaN = unchecked, -1 = blocked, otherwise the crossing cost.
  const edgeCost = new Float64Array(xs.length * ys.length * 4).fill(Number.NaN)
  const open = new StateHeap<State>()
  let pushed = 0
  for (const { i, j, d } of sources) {
    const turned = startHeading >= 0 && d !== startHeading
    const cost = turned ? bendCost : 0, run = turned ? 0 : Infinity
    open.push({ i, j, d, cost, bends: turned ? 1 : 0, length: 0, run, seq: pushed++ })
    best.set(key(i, j, d, run), cost)
  }
  let found: State | undefined
  while (open.size) {
    const state = open.pop()!
    if (state.final) { found = state; break }
    if ((best.get(key(state.i, state.j, state.d, state.run)) ?? Infinity) < state.cost - EPS) continue
    if (targets.some(({ i, j, d }) => state.i === i && state.j === j && state.d === d)) {
      // Arriving off the end heading is one more bend, charged before it can
      // win, and like any turn it needs a minimum run before it.
      if (endHeading < 0 || state.d === endHeading) { found = state; break }
      if (state.run >= minRun - EPS) open.push({ ...state, cost: state.cost + bendCost, bends: state.bends + 1, seq: pushed++, final: true })
    }
    for (let d = 0; d < 4; d++) {
      if ((d + 2) % 4 === state.d) continue // no reversal
      if (!state.previous && d !== state.d) continue // the first move follows the exit direction
      const ni = state.i + Math.sign(STEP[DIRECTIONS[d]!].x), nj = state.j + Math.sign(STEP[DIRECTIONS[d]!].y)
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue
      const turned = d !== state.d
      if (turned && state.run < minRun - EPS) continue
      const a = { x: xs[state.i]!, y: ys[state.j]! }, b = { x: xs[ni]!, y: ys[nj]! }
      const edge = (state.i * ys.length + state.j) * 4 + d
      let crossed = edgeCost[edge]!
      if (Number.isNaN(crossed)) {
        crossed = !clear(a, b) ? -1 : request.crossings ? crossedSegments(a, b, request.crossings.segments, targets.some(target => target.i === ni && target.j === nj)) * request.crossings.cost : 0
        edgeCost[edge] = crossed
      }
      if (crossed < 0) continue
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
      const cost = state.cost + length + (turned ? bendCost : 0) + crossed
      const k = key(ni, nj, d, turned ? length : state.run + length)
      if ((best.get(k) ?? Infinity) <= cost + EPS) continue
      best.set(k, cost)
      open.push({ i: ni, j: nj, d, cost, bends: state.bends + (turned ? 1 : 0), length: state.length + length, run: turned ? length : state.run + length, previous: state, seq: pushed++ })
    }
  }
  if (!found) return undefined
  const grid: RouterPoint[] = []
  for (let state: State | undefined = found; state; state = state.previous) grid.unshift({ x: xs[state.i]!, y: ys[state.j]! })
  // Keep only the corners, then attach the stubs to the real endpoints.
  const corners = grid.filter((point, k) => {
    if (k === 0 || k === grid.length - 1) return true
    const p = grid[k - 1]!, n = grid[k + 1]!
    return !((Math.abs(p.x - point.x) <= EPS && Math.abs(n.x - point.x) <= EPS) || (Math.abs(p.y - point.y) <= EPS && Math.abs(n.y - point.y) <= EPS))
  })
  const route = [start, ...corners, end].filter((point, k, all) => k === 0 || Math.abs(point.x - all[k - 1]!.x) > EPS || Math.abs(point.y - all[k - 1]!.y) > EPS)
  // Drop interior points made collinear by attaching the stubs.
  return route.filter((point, k) => {
    if (k === 0 || k === route.length - 1) return true
    const p = route[k - 1]!, n = route[k + 1]!
    return !((Math.abs(p.x - point.x) <= EPS && Math.abs(n.x - point.x) <= EPS) || (Math.abs(p.y - point.y) <= EPS && Math.abs(n.y - point.y) <= EPS))
  })
}
