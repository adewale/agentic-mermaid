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
  /** Minimum length of the first and last segments (port stubs, markers);
   * a pair gives the start and end lengths separately. */
  readonly stub?: number | readonly [number, number]
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
  /** Boxes that block runs along one axis only: a horizontal segment may not
   * enter a box in `horizontal`, though a vertical one may cross it (a band
   * crossed only perpendicularly), and likewise for `vertical`. Inflated by
   * `clearance` like the obstacles. */
  readonly axisObstacles?: { readonly horizontal?: readonly RouterBox[]; readonly vertical?: readonly RouterBox[] }
  /** Points the route passes through in order, between the stubs: the best
   * route that visits each in turn, under the same rules (it never turns
   * back, so a via point is passed straight through or turned at). */
  readonly via?: readonly RouterPoint[]
  /** Extra cost per pixel of a run on no channel line (without
   * channelsOnly): a small value breaks ties toward the channels, a larger
   * one pays for a detour to reach them. */
  readonly offChannelCost?: number
  /** Called once for every grid step the search checks, so a caller can
   * bound the routing work of a whole diagram by throwing. */
  readonly charge?: () => void
  /** Order the search by a lower bound on the cost still to come. The route
   * is as cheap as without it, but among equally cheap routes it may find a
   * different one, and it explores far less of a large grid. Always on with
   * via points. */
  readonly guided?: boolean
}

const STEP: Record<RouterDirection, RouterPoint> = { E: { x: 1, y: 0 }, W: { x: -1, y: 0 }, N: { x: 0, y: -1 }, S: { x: 0, y: 1 } }
const DIRECTIONS: readonly RouterDirection[] = ['E', 'S', 'W', 'N']
/** Grid index steps per heading, in DIRECTIONS order. */
const DI = [1, 0, -1, 0], DJ = [0, 1, 0, -1]
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

interface Queued { readonly i: number; readonly j: number; readonly d: number; readonly rank: number; readonly seq: number }

/** The search order: lower rank (cost so far plus the least cost still to
 * come) first, within EPS a tie, then the earlier grid column, row and
 * heading, then the earlier push. Deterministic. */
function before(a: Queued, b: Queued): boolean {
  if (Math.abs(a.rank - b.rank) > EPS) return a.rank < b.rank
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

const samePoint = (a: RouterPoint, b: RouterPoint) => Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS
/** Interior points whose neighbours share their line carry no turn. */
function withoutCollinear(route: readonly RouterPoint[]): RouterPoint[] {
  return route.filter((point, k) => {
    if (k === 0 || k === route.length - 1) return true
    const p = route[k - 1]!, n = route[k + 1]!
    return !((Math.abs(p.x - point.x) <= EPS && Math.abs(n.x - point.x) <= EPS) || (Math.abs(p.y - point.y) <= EPS && Math.abs(n.y - point.y) <= EPS))
  })
}

/** Grid edges are checked once per search. A large grid keeps the checks
 * sparsely instead of allocating one slot for every edge. */
const DENSE_EDGE_CACHE = 1 << 22

/** Fewest bends, then shortest; undefined when no clear route exists. */
export function routeOrthogonal(request: OrthogonalRouteRequest): RouterPoint[] | undefined {
  const { start, end, exit, entry, clearance } = request
  const bendCost = request.bendCost ?? 1e4
  const minRun = request.minRun ?? 0
  const inflate = (box: RouterBox): RouterBox => ({ x0: box.x0 - clearance, y0: box.y0 - clearance, x1: box.x1 + clearance, y1: box.y1 + clearance })
  const inflated = request.obstacles.map(inflate)
  const acrossX = (request.axisObstacles?.horizontal ?? []).map(inflate), acrossY = (request.axisObstacles?.vertical ?? []).map(inflate)
  const [startStub, endStub] = typeof request.stub === 'object' ? request.stub : [request.stub ?? 0, request.stub ?? 0]
  const via = request.via ?? []
  // Leave and arrive along the required directions for at least the stub.
  const exits = typeof exit === 'string' ? [exit] : exit, entries = typeof entry === 'string' ? [entry] : entry
  const outs = exits.map(d => ({ d, point: { x: start.x + STEP[d].x * startStub, y: start.y + STEP[d].y * startStub } }))
  const intos = entries.map(d => ({ d, point: { x: end.x - STEP[d].x * endStub, y: end.y - STEP[d].y * endStub } }))
  if (!outs.length || !intos.length) return undefined
  const out = outs[0]!.point, into = intos[0]!.point
  // Without mandated corridors, obstacle edges and the midpoints between
  // consecutive stops are candidates too, so an offset target can be reached
  // directly.
  // A one-axis obstacle blocks, but never offers its edges as a line to run
  // along (that would trace the band's own outline).
  const stops = [out, ...via, into]
  const middles = stops.slice(1).map((point, k) => ({ x: (point.x + stops[k]!.x) / 2, y: (point.y + stops[k]!.y) / 2 }))
  // Lines a separation beside each avoided segment that passes near a stop
  // (where routes meet at ports and leads) let a route run next to one
  // rather than only along obstacle edges.
  const separation = request.avoid?.separation ?? 0, reach = 4 * separation
  const nearStop = ([p, q]: readonly [RouterPoint, RouterPoint]) => stops.some(stop => stop.x >= Math.min(p.x, q.x) - reach && stop.x <= Math.max(p.x, q.x) + reach && stop.y >= Math.min(p.y, q.y) - reach && stop.y <= Math.max(p.y, q.y) + reach)
  const beside = (vertical: boolean) => (request.avoid?.segments ?? []).flatMap(segment => {
    if ((Math.abs(segment[0].x - segment[1].x) <= EPS) !== vertical || !nearStop(segment)) return []
    const at = vertical ? segment[0].x : segment[0].y
    return [at - separation, at + separation]
  })
  const edgesX = request.channelsOnly ? [] : [...inflated.flatMap(box => [box.x0, box.x1]), ...middles.map(point => point.x), ...beside(true)]
  const edgesY = request.channelsOnly ? [] : [...inflated.flatMap(box => [box.y0, box.y1]), ...middles.map(point => point.y), ...beside(false)]
  const ends = [...outs, ...intos, ...via.map(point => ({ point }))].map(({ point }) => point)
  const xs = sortedUnique([...ends.map(point => point.x), ...edgesX, ...(request.channels?.x ?? [])])
  const ys = sortedUnique([...ends.map(point => point.y), ...edgesY, ...(request.channels?.y ?? [])])
  // Every grid step runs along one grid line. What can block or cross a step
  // is gathered once per line: the boxes it passes through, the avoided
  // segments within a separation of it and the drawn segments across it.
  type Segment = readonly [RouterPoint, RouterPoint]
  type Line = { boxes: RouterBox[]; across: RouterBox[]; crowd: Segment[]; cross: Segment[] }
  const lines = new Map<number, Line>()
  const lineAt = (vertical: boolean, index: number): Line => {
    const id = vertical ? -1 - index : index
    let line = lines.get(id)
    if (line) return line
    const at = vertical ? xs[index]! : ys[index]!
    const passes = (box: RouterBox) => vertical ? box.x0 + EPS < at && at < box.x1 - EPS : box.y0 + EPS < at && at < box.y1 - EPS
    const upright = ([p, q]: Segment) => Math.abs(p.x - q.x) <= EPS
    const separation = request.avoid?.separation ?? 0
    line = {
      boxes: inflated.filter(passes), across: (vertical ? acrossY : acrossX).filter(passes),
      crowd: (request.avoid?.segments ?? []).filter(segment => upright(segment) === vertical && (offset => offset <= EPS || offset < separation)(Math.abs((vertical ? segment[0].x : segment[0].y) - at))),
      cross: (request.crossings?.segments ?? []).filter(segment => upright(segment) !== vertical && (([p, q]) => vertical
        ? Math.min(p.x, q.x) + EPS < at && at < Math.max(p.x, q.x) - EPS : Math.min(p.y, q.y) + EPS < at && at < Math.max(p.y, q.y) - EPS)(segment)),
    }
    lines.set(id, line)
    return line
  }
  const clear = (a: RouterPoint, b: RouterPoint, line: Line) => !line.boxes.some(box => segmentHits(a, b, box))
    && !line.across.some(box => segmentHits(a, b, box))
    && !(request.avoid && crowds(a, b, { ...request.avoid, segments: line.crowd }))
  const offChannel = request.channelsOnly ? 0 : request.offChannelCost ?? 0
  const onChannel = (values: readonly number[], channels: readonly number[] = []) => values.map(value => channels.some(channel => Math.abs(channel - value) <= EPS))
  const onChannelX = offChannel ? onChannel(xs, request.channels?.x) : [], onChannelY = offChannel ? onChannel(ys, request.channels?.y) : []
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
  if (!sources.length || !targets.length || via.some(inside)) return undefined
  const stopsAt = via.map(point => index(point)!)
  /** Via points passed after reaching grid point (i, j) with `k` passed. */
  const advance = (k: number, i: number, j: number) => {
    while (k < stopsAt.length && stopsAt[k]!.i === i && stopsAt[k]!.j === j) k++
    return k
  }
  // Dijkstra over (grid point, heading, via points passed). Neighbours are
  // adjacent grid points.
  type State = { i: number; j: number; d: number; k: number; cost: number; rank: number; run: number; seq: number; previous?: State; final?: true }
  // The least cost still to come, for a guided search (one through via
  // points would otherwise spread over the whole grid): the length through
  // the remaining stops plus the turns the next stop needs at least. It never
  // overestimates and never drops by more than a step costs, so the first
  // route found is still the cheapest.
  const arrivals = intos.map(({ point }) => point)
  const apart = (a: RouterPoint, b: RouterPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  const rest = via.map(() => 0)
  for (let k = via.length - 1; k >= 0; k--) rest[k] = k === via.length - 1 ? Math.min(...arrivals.map(end => apart(via[k]!, end))) : apart(via[k]!, via[k + 1]!) + rest[k + 1]!
  /** Length to `next` plus the turns reaching it from (i, j) heading d needs. */
  const toward = (i: number, j: number, d: number, next: RouterPoint) => {
    const dx = next.x - xs[i]!, dy = next.y - ys[j]!, step = STEP[DIRECTIONS[d]!]
    const ahead = dx * step.x + dy * step.y, aside = Math.abs(dx * step.y - dy * step.x)
    return Math.abs(dx) + Math.abs(dy) + (aside <= EPS ? (ahead >= -EPS ? 0 : 2) : ahead >= -EPS ? 1 : 2) * bendCost
  }
  const guided = request.guided || via.length > 0
  const guide = (i: number, j: number, d: number, k: number) => !guided ? 0 : k < via.length ? toward(i, j, d, via[k]!) + rest[k]! : Math.min(...arrivals.map(end => toward(i, j, d, end)))
  // With minRun, a short current run can block a turn a longer one allows,
  // so the search distinguishes the two.
  const key = (i: number, j: number, d: number, k: number, run = Infinity) => (((i * ys.length + j) * 4 + d) * 2 + (run < minRun - EPS ? 1 : 0)) * (via.length + 1) + k
  // The cheapest cost found per search state, densely where the state space
  // is small enough.
  const states = xs.length * ys.length * 8 * (via.length + 1)
  const table = states <= DENSE_EDGE_CACHE ? new Float64Array(states).fill(Infinity) : undefined, map = table ? undefined : new Map<number, number>()
  const best = { get: (k: number) => table ? table[k]! : map!.get(k) ?? Infinity, set: (k: number, cost: number) => { if (table) table[k] = cost; else map!.set(k, cost) } }
  // Clearance and extra cost belong to a grid edge, not to the state that
  // reaches it: each edge is checked once, however many headings arrive.
  // NaN = unchecked, -1 = blocked, otherwise its extra cost (crossings, off
  // channel).
  const edges = xs.length * ys.length * 4
  const dense = edges <= DENSE_EDGE_CACHE ? new Float64Array(edges).fill(Number.NaN) : undefined, sparse = dense ? undefined : new Map<number, number>()
  const open = new StateHeap<State>()
  let pushed = 0
  for (const { i, j, d } of sources) {
    const turned = startHeading >= 0 && d !== startHeading
    const cost = turned ? bendCost : 0, run = turned ? 0 : Infinity, k = advance(0, i, j)
    open.push({ i, j, d, k, cost, rank: cost + guide(i, j, d, k), run, seq: pushed++ })
    best.set(key(i, j, d, k, run), cost)
  }
  let found: State | undefined
  while (open.size) {
    const state = open.pop()!
    if (state.final) { found = state; break }
    if (best.get(key(state.i, state.j, state.d, state.k, state.run)) < state.cost - EPS) continue
    if (state.k === via.length) {
      // Turning onto the end stub, or off it against the end heading, is one
      // more bend each, charged before the route can win; like any turn it
      // needs a minimum run before it. Without a stub the route must arrive
      // along the entry direction itself.
      let extra = Infinity
      for (const { i, j, d } of targets) {
        if (i !== state.i || j !== state.j || (d !== state.d && (endStub <= EPS || (d + 2) % 4 === state.d))) continue
        extra = Math.min(extra, (d !== state.d ? 1 : 0) + (endHeading >= 0 && d !== endHeading ? 1 : 0))
      }
      if (extra === 0) { found = state; break }
      if (extra < Infinity && state.run >= minRun - EPS) open.push({ ...state, cost: state.cost + extra * bendCost, rank: state.cost + extra * bendCost, seq: pushed++, final: true })
    }
    for (let d = 0; d < 4; d++) {
      if ((d + 2) % 4 === state.d) continue // no reversal
      // The route leaves along the exit direction: by the stub when it has
      // one, otherwise by its first move.
      if (!state.previous && d !== state.d && startStub <= EPS) continue
      const ni = state.i + DI[d]!, nj = state.j + DJ[d]!
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue
      const turned = d !== state.d
      if (turned && state.run < minRun - EPS) continue
      const length = Math.abs(xs[ni]! - xs[state.i]!) + Math.abs(ys[nj]! - ys[state.j]!)
      const edge = (state.i * ys.length + state.j) * 4 + d
      let crossed = dense ? dense[edge]! : sparse!.get(edge) ?? Number.NaN
      if (Number.isNaN(crossed)) {
        request.charge?.()
        const a = { x: xs[state.i]!, y: ys[state.j]! }, b = { x: xs[ni]!, y: ys[nj]! }
        const vertical = d % 2 === 1, line = vertical ? lineAt(true, state.i) : lineAt(false, state.j)
        crossed = !clear(a, b, line) ? -1 : request.crossings ? crossedSegments(a, b, line.cross, targets.some(target => target.i === ni && target.j === nj)) * request.crossings.cost : 0
        if (crossed >= 0 && offChannel && !(vertical ? onChannelX[state.i] : onChannelY[state.j])) crossed += offChannel * length
        if (dense) dense[edge] = crossed
        else sparse!.set(edge, crossed)
      }
      if (crossed < 0) continue
      const cost = state.cost + length + (turned ? bendCost : 0) + crossed
      const passed = advance(state.k, ni, nj), k = key(ni, nj, d, passed, turned ? length : state.run + length)
      if (best.get(k) <= cost + EPS) continue
      best.set(k, cost)
      open.push({ i: ni, j: nj, d, k: passed, cost, rank: cost + guide(ni, nj, d, passed), run: turned ? length : state.run + length, previous: state, seq: pushed++ })
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
  // Drop interior points made collinear by attaching the stubs.
  return withoutCollinear([start, ...corners, end].filter((point, k, all) => k === 0 || !samePoint(point, all[k - 1]!)))
}
