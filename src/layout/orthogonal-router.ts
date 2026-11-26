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
  /** Extra cost per pixel of a run along a listed line (a vertical run on
   * an `x` line, a horizontal one on a `y` line): ranks lines a family
   * prefers in order, such as where a route should bend, without
   * forbidding the others. */
  readonly lineCosts?: { readonly x?: readonly { readonly at: number; readonly cost: number }[]; readonly y?: readonly { readonly at: number; readonly cost: number }[] }
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

/** Drawn segments a grid step a-b crosses, given where the drawn segments
 * across its line meet that line, in ascending order. A crossing exactly at
 * `a` belongs to the step that arrived there, so a route through one point
 * pays once; one exactly at a route's own endpoint (`b` when `open`) is a
 * shared contact, not a crossing. */
function crossedSegments(a: RouterPoint, b: RouterPoint, meets: Float64Array, open: boolean): number {
  const vertical = Math.abs(a.x - b.x) <= EPS
  const from = vertical ? a.y : a.x, to = vertical ? b.y : b.x
  const sign = Math.sign(to - from), span = Math.abs(to - from), last = Math.max(from, to) + 2 * EPS
  let count = 0
  for (let k = firstAtLeast(meets, Math.min(from, to) - 2 * EPS); k < meets.length && meets[k]! <= last; k++) {
    const past = (meets[k]! - from) * sign
    if (past > EPS && (open ? past < span - EPS : past <= span + EPS)) count++
  }
  return count
}

/** The first index of an ascending list whose value is at least `value`. */
function firstAtLeast(values: Float64Array, value: number): number {
  let lo = 0, hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid]! < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Segments of one orientation as flat columns: the line each lies on and
 * its span along that line. */
interface SegmentColumns { readonly at: number[]; readonly lo: number[]; readonly hi: number[] }
/** Segments split into vertical and horizontal columns. */
function columns(segments: readonly (readonly [RouterPoint, RouterPoint])[]): { readonly vertical: SegmentColumns; readonly horizontal: SegmentColumns } {
  const vertical: SegmentColumns = { at: [], lo: [], hi: [] }, horizontal: SegmentColumns = { at: [], lo: [], hi: [] }
  for (const segment of segments) {
    const p = segment[0], q = segment[1]
    if (Math.abs(p.x - q.x) <= EPS) { vertical.at.push(p.x); vertical.lo.push(Math.min(p.y, q.y)); vertical.hi.push(Math.max(p.y, q.y)) }
    else { horizontal.at.push(p.y); horizontal.lo.push(Math.min(p.x, q.x)); horizontal.hi.push(Math.max(p.x, q.x)) }
  }
  return { vertical, horizontal }
}

/** Whether segment a-b, on the line `at`, runs too close alongside one of
 * the listed avoided segments of its orientation. */
function crowds(a: RouterPoint, b: RouterPoint, at: number, avoided: SegmentColumns, listed: readonly number[], avoid: NonNullable<OrthogonalRouteRequest['avoid']>): boolean {
  const vertical = Math.abs(a.x - b.x) <= EPS
  const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x)
  for (const k of listed) {
    const offset = Math.abs(avoided.at[k]! - at)
    const spacing = Math.max(avoided.lo[k]! - hi, lo - avoided.hi[k]!)
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
/** How far past the cheapest cost a bounded pass still queues states: far
 * above rounding in summed costs; more only queues more states. */
const BOUND_SLACK = 1

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
  const besideX: number[] = [], besideY: number[] = []
  if (!request.channelsOnly) for (const segment of request.avoid?.segments ?? []) {
    const p = segment[0], q = segment[1]
    const x0 = Math.min(p.x, q.x) - reach, x1 = Math.max(p.x, q.x) + reach, y0 = Math.min(p.y, q.y) - reach, y1 = Math.max(p.y, q.y) + reach
    let near = false
    for (const stop of stops) if (stop.x >= x0 && stop.x <= x1 && stop.y >= y0 && stop.y <= y1) { near = true; break }
    if (!near) continue
    if (Math.abs(p.x - q.x) <= EPS) besideX.push(p.x - separation, p.x + separation)
    else besideY.push(p.y - separation, p.y + separation)
  }
  const edgesX = request.channelsOnly ? [] : [...inflated.flatMap(box => [box.x0, box.x1]), ...middles.map(point => point.x), ...besideX]
  const edgesY = request.channelsOnly ? [] : [...inflated.flatMap(box => [box.y0, box.y1]), ...middles.map(point => point.y), ...besideY]
  const ends = [...outs, ...intos, ...via.map(point => ({ point }))].map(({ point }) => point)
  const xs = sortedUnique([...ends.map(point => point.x), ...edgesX, ...(request.channels?.x ?? [])])
  const ys = sortedUnique([...ends.map(point => point.y), ...edgesY, ...(request.channels?.y ?? [])])
  // Every grid step runs along one grid line. What can block or cross a step
  // is gathered once per line: the boxes it passes through, the avoided
  // segments within a separation of it and the drawn segments across it.
  type Line = { vertical: boolean; at: number; boxes: RouterBox[]; across: RouterBox[]; crowd: number[]; cross?: Float64Array }
  const lines = new Map<number, Line>()
  const avoided = columns(request.avoid?.segments ?? []), drawn = columns(request.crossings?.segments ?? [])
  const lineAt = (vertical: boolean, index: number): Line => {
    const id = vertical ? -1 - index : index
    let line = lines.get(id)
    if (line) return line
    const at = vertical ? xs[index]! : ys[index]!
    const passes = (box: RouterBox) => vertical ? box.x0 + EPS < at && at < box.x1 - EPS : box.y0 + EPS < at && at < box.y1 - EPS
    // Avoided segments on this line or within a separation beside it.
    const along = vertical ? avoided.vertical : avoided.horizontal, crowd: number[] = []
    for (let k = 0; k < along.at.length; k++) {
      const offset = Math.abs(along.at[k]! - at)
      if (offset <= EPS || offset < separation) crowd.push(k)
    }
    line = { vertical, at, boxes: inflated.filter(passes), across: (vertical ? acrossY : acrossX).filter(passes), crowd }
    lines.set(id, line)
    return line
  }
  /** Where the drawn segments across a line meet it, in ascending order;
   * gathered for the first clear step along the line. */
  const meets = (line: Line): Float64Array => {
    if (line.cross) return line.cross
    const across = line.vertical ? drawn.horizontal : drawn.vertical, at = line.at, found: number[] = []
    for (let k = 0; k < across.at.length; k++) if (across.lo[k]! + EPS < at && at < across.hi[k]! - EPS) found.push(across.at[k]!)
    return line.cross = Float64Array.from(found).sort()
  }
  const clear = (a: RouterPoint, b: RouterPoint, line: Line) => !line.boxes.some(box => segmentHits(a, b, box))
    && !line.across.some(box => segmentHits(a, b, box))
    && !(request.avoid && crowds(a, b, line.at, line.vertical ? avoided.vertical : avoided.horizontal, line.crowd, request.avoid))
  const offChannel = request.channelsOnly ? 0 : request.offChannelCost ?? 0
  const onChannel = (values: readonly number[], channels: readonly number[] = []) => values.map(value => channels.some(channel => Math.abs(channel - value) <= EPS))
  const onChannelX = offChannel ? onChannel(xs, request.channels?.x) : [], onChannelY = offChannel ? onChannel(ys, request.channels?.y) : []
  const lineCost = (values: readonly number[], costs: readonly { at: number; cost: number }[] = []) => values.map(value => costs.find(line => Math.abs(line.at - value) <= EPS)?.cost ?? 0)
  const lineCostX = lineCost(xs, request.lineCosts?.x), lineCostY = lineCost(ys, request.lineCosts?.y)
  const within = (p: RouterPoint, box: RouterBox) => p.x > box.x0 + EPS && p.x < box.x1 - EPS && p.y > box.y0 + EPS && p.y < box.y1 - EPS
  const inside = (p: RouterPoint) => inflated.some(box => within(p, box))
  // A stub runs from its endpoint to the grid. It keeps out of every box as
  // any segment does, except one its endpoint already lies in: it may leave
  // the clearance around a box its endpoint sits on, but never cross the box
  // itself, unless the endpoint lies inside the box itself (a family that
  // grows its own boxes puts the endpoint there; the stub tip must still
  // clear it).
  const stubClear = (endpoint: RouterPoint, tip: RouterPoint, raw: readonly RouterBox[], grown: readonly RouterBox[]) => grown.every((box, k) => !segmentHits(endpoint, tip, box)
    || (within(endpoint, box) && (!segmentHits(endpoint, tip, raw[k]!) || within(endpoint, raw[k]!))))
  const stubBlocked = (endpoint: RouterPoint, tip: RouterPoint, d: RouterDirection) => !stubClear(endpoint, tip, request.obstacles, inflated)
    || (d === 'E' || d === 'W'
      ? !stubClear(endpoint, tip, request.axisObstacles?.horizontal ?? [], acrossX)
      : !stubClear(endpoint, tip, request.axisObstacles?.vertical ?? [], acrossY))
  const index = (p: RouterPoint) => {
    const i = xs.findIndex(x => Math.abs(x - p.x) <= EPS), j = ys.findIndex(y => Math.abs(y - p.y) <= EPS)
    return i < 0 || j < 0 ? undefined : { i, j }
  }
  const heading = (d?: RouterDirection) => (d === undefined ? -1 : DIRECTIONS.indexOf(d))
  const startHeading = heading(request.startHeading), endHeading = heading(request.endHeading)
  const reverses = (d: number, h: number) => h >= 0 && (d + 2) % 4 === h
  const sources = outs.filter(({ d, point }) => !inside(point) && !stubBlocked(start, point, d) && !reverses(DIRECTIONS.indexOf(d), startHeading)).map(({ d, point }) => ({ d: DIRECTIONS.indexOf(d), ...index(point)! }))
  const targets = intos.filter(({ d, point }) => !inside(point) && !stubBlocked(end, point, d) && !reverses(DIRECTIONS.indexOf(d), endHeading)).map(({ d, point }) => ({ d: DIRECTIONS.indexOf(d), ...index(point)! }))
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
  const lowerBound = (i: number, j: number, d: number, k: number) => {
    if (k < via.length) return toward(i, j, d, via[k]!) + rest[k]!
    let least = Infinity
    for (const end of arrivals) least = Math.min(least, toward(i, j, d, end))
    return least
  }
  // With minRun, a short current run can block a turn a longer one allows,
  // so the search distinguishes the two.
  const runs = minRun > EPS ? 2 : 1
  const key = (i: number, j: number, d: number, k: number, run = Infinity) => (((i * ys.length + j) * 4 + d) * runs + (run < minRun - EPS ? 1 : 0)) * (via.length + 1) + k
  const states = xs.length * ys.length * 4 * runs * (via.length + 1)
  // Clearance and extra cost belong to a grid edge, not to the state that
  // reaches it: each edge is checked once, however many headings arrive and
  // however many passes search the grid. NaN = unchecked, -1 = blocked,
  // otherwise its extra cost (crossings, off channel).
  const edges = xs.length * ys.length * 4
  const dense = edges <= DENSE_EDGE_CACHE ? new Float64Array(edges).fill(Number.NaN) : undefined, sparse = dense ? undefined : new Map<number, number>()
  let pushed = 0
  /** One search pass, ordered by cost alone or (`ordered`) by cost plus the
   * lower bound. States whose cost plus lower bound exceeds `bound` cannot
   * lie on a route that cheap and are never queued. */
  const search = (ordered: boolean, bound: number): State | undefined => {
    // The cheapest cost found per search state, densely where the state
    // space is small enough.
    const table = states <= DENSE_EDGE_CACHE ? new Float64Array(states).fill(Infinity) : undefined, map = table ? undefined : new Map<number, number>()
    const best = { get: (k: number) => table ? table[k]! : map!.get(k) ?? Infinity, set: (k: number, cost: number) => { if (table) table[k] = cost; else map!.set(k, cost) } }
    const bounded = bound < Infinity
    const open = new StateHeap<State>()
    for (const { i, j, d } of sources) {
      // Leaving against the start heading turns at `start`: the run since
      // that turn is the stub.
      const turned = startHeading >= 0 && d !== startHeading
      const cost = turned ? bendCost : 0, run = turned ? startStub : Infinity, k = advance(0, i, j)
      const least = ordered || bounded ? lowerBound(i, j, d, k) : 0
      if (cost + least > bound) continue
      open.push({ i, j, d, k, cost, rank: cost + (ordered ? least : 0), run, seq: pushed++ })
      best.set(key(i, j, d, k, run), cost)
    }
    while (open.size) {
      const state = open.pop()!
      if (state.final) return state
      if (best.get(key(state.i, state.j, state.d, state.k, state.run)) < state.cost - EPS) continue
      if (state.k === via.length) {
        // Turning onto the end stub, or off it against the end heading, is
        // one more bend each, charged before the route can win; like any
        // turn it needs a minimum run before it: the run so far for the turn
        // onto the stub, and for the turn off it the stub, plus the run so
        // far when the route arrives straight along it. Without a stub the
        // route must arrive along the entry direction itself.
        let extra = Infinity
        for (const { i, j, d } of targets) {
          if (i !== state.i || j !== state.j || (d !== state.d && (endStub <= EPS || (d + 2) % 4 === state.d))) continue
          const ontoStub = d !== state.d, offStub = endHeading >= 0 && d !== endHeading
          if (ontoStub && state.run < minRun - EPS) continue
          if (offStub && (ontoStub ? endStub : state.run + endStub) < minRun - EPS) continue
          extra = Math.min(extra, (ontoStub ? 1 : 0) + (offStub ? 1 : 0))
        }
        if (extra === 0) return state
        if (extra < Infinity && state.cost + extra * bendCost <= bound) open.push({ ...state, cost: state.cost + extra * bendCost, rank: state.cost + extra * bendCost, seq: pushed++, final: true })
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
          crossed = !clear(a, b, line) ? -1 : request.crossings ? crossedSegments(a, b, meets(line), targets.some(target => target.i === ni && target.j === nj)) * request.crossings.cost : 0
          if (crossed >= 0 && offChannel && !(vertical ? onChannelX[state.i] : onChannelY[state.j])) crossed += offChannel * length
          if (crossed >= 0) crossed += (vertical ? lineCostX[state.i]! : lineCostY[state.j]!) * length
          if (dense) dense[edge] = crossed
          else sparse!.set(edge, crossed)
        }
        if (crossed < 0) continue
        const cost = state.cost + length + (turned ? bendCost : 0) + crossed
        const passed = advance(state.k, ni, nj), k = key(ni, nj, d, passed, turned ? length : state.run + length)
        const least = ordered || bounded ? lowerBound(ni, nj, d, passed) : 0
        if (cost + least > bound) continue
        if (best.get(k) <= cost + EPS) continue
        best.set(k, cost)
        open.push({ i: ni, j: nj, d, k: passed, cost, rank: cost + (ordered ? least : 0), run: turned ? length : state.run + length, previous: state, seq: pushed++ })
      }
    }
    return undefined
  }
  // An unguided search returns the route cost order finds, but cost order
  // alone spreads over every state cheaper than that route. A guided pass
  // finds the cheapest cost first. The cost-ordered pass then skips every
  // state whose cost plus lower bound exceeds it: the bound never
  // overestimates and never drops by more than a step costs, so no skipped
  // state lies on a route that cheap and the pass returns the same route as
  // over the whole grid. It reuses the edges the first pass checked.
  const cheapest = search(true, Infinity)
  const found = guided || !cheapest ? cheapest : search(false, cheapest.cost + BOUND_SLACK) ?? cheapest
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
