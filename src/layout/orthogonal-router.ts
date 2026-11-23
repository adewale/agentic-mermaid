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
  /** Direction of the first segment, leaving `start`. */
  readonly exit: RouterDirection
  /** Direction of travel of the last segment, arriving at `end`. */
  readonly entry: RouterDirection
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
  const out = { x: start.x + STEP[exit].x * stub, y: start.y + STEP[exit].y * stub }
  const into = { x: end.x - STEP[entry].x * stub, y: end.y - STEP[entry].y * stub }
  // Without mandated corridors, obstacle edges and the midpoints between the
  // endpoints are candidates too, so an offset target can be reached directly.
  const edgesX = request.channelsOnly ? [] : [...inflated.flatMap(box => [box.x0, box.x1]), (out.x + into.x) / 2]
  const edgesY = request.channelsOnly ? [] : [...inflated.flatMap(box => [box.y0, box.y1]), (out.y + into.y) / 2]
  const xs = sortedUnique([out.x, into.x, ...edgesX, ...(request.channels?.x ?? [])])
  const ys = sortedUnique([out.y, into.y, ...edgesY, ...(request.channels?.y ?? [])])
  const clear = (a: RouterPoint, b: RouterPoint) => !inflated.some(box => segmentHits(a, b, box)) && !(request.avoid && crowds(a, b, request.avoid))
  const inside = (p: RouterPoint) => inflated.some(box => p.x > box.x0 + EPS && p.x < box.x1 - EPS && p.y > box.y0 + EPS && p.y < box.y1 - EPS)
  if (inside(out) || inside(into)) return undefined
  const index = (p: RouterPoint) => {
    const i = xs.findIndex(x => Math.abs(x - p.x) <= EPS), j = ys.findIndex(y => Math.abs(y - p.y) <= EPS)
    return i < 0 || j < 0 ? undefined : { i, j }
  }
  const from = index(out), to = index(into)
  if (!from || !to) return undefined
  // Dijkstra over (grid point, heading). Neighbours are adjacent grid points.
  type State = { i: number; j: number; d: number; cost: number; bends: number; length: number; run: number; seq: number; previous?: State }
  // With minRun, a short current run can block a turn a longer one allows,
  // so the search distinguishes the two.
  const key = (i: number, j: number, d: number, run = Infinity) => ((i * ys.length + j) * 4 + d) * 2 + (run < minRun - EPS ? 1 : 0)
  const best = new Map<number, number>()
  const exitIndex = DIRECTIONS.indexOf(exit)
  const open = new StateHeap<State>()
  let pushed = 0
  open.push({ i: from.i, j: from.j, d: exitIndex, cost: 0, bends: 0, length: 0, run: Infinity, seq: pushed++ })
  best.set(key(from.i, from.j, exitIndex), 0)
  const entryIndex = DIRECTIONS.indexOf(entry)
  let found: State | undefined
  while (open.size) {
    const state = open.pop()!
    if ((best.get(key(state.i, state.j, state.d, state.run)) ?? Infinity) < state.cost - EPS) continue
    if (state.i === to.i && state.j === to.j && state.d === entryIndex) { found = state; break }
    for (let d = 0; d < 4; d++) {
      if ((d + 2) % 4 === state.d) continue // no reversal
      if (!state.previous && d !== state.d) continue // the first move follows the exit direction
      const ni = state.i + Math.sign(STEP[DIRECTIONS[d]!].x), nj = state.j + Math.sign(STEP[DIRECTIONS[d]!].y)
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue
      const a = { x: xs[state.i]!, y: ys[state.j]! }, b = { x: xs[ni]!, y: ys[nj]! }
      if (!clear(a, b)) continue
      const turned = d !== state.d
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
      if (turned && state.run < minRun - EPS) continue
      const cost = state.cost + length + (turned ? bendCost : 0)
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
