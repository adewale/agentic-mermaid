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
  /** Outlines (lane and group frames) a route may cross but not follow: a
   * segment may cross a side anywhere, but no run lies along a side within
   * `clearance` of it over the side's span, where it would read as the frame
   * or as attached to it. A run exactly `clearance` away is allowed. Not
   * inflated by the request's `clearance`, and offering no line of its own:
   * a caller that needs a route when none keeps off the frames asks again
   * without them. */
  readonly frames?: { readonly boxes: readonly RouterBox[]; readonly clearance: number }
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
  /** With `charge`: called once for every grid step the early check that a
   * route can arrive at all reads before the search has. Without it a
   * `charge` budget turns that check off. With it the check runs, its reads
   * are charged here instead, and `charge` still counts exactly the steps
   * the search itself checks, so a route that cannot arrive stops early and
   * a route that can is charged as without the check. Returning false
   * abandons the check, and the search goes on as without it. */
  readonly probe?: () => boolean
  /** Order the search by a lower bound on the cost still to come. The route
   * is as cheap as without it, but among equally cheap routes it may find a
   * different one, and it explores far less of a large grid. Always on with
   * via points. */
  readonly guided?: boolean
  /** The most a route is worth to the caller, in the search's own cost
   * (length, bends, crossings and line costs, not counting the stubs), for
   * one that keeps the cheapest of several requests. Where every route
   * costs more than this (by over `COST_LIMIT_SLACK`), the search stops as
   * soon as that is certain and returns undefined; otherwise it returns the
   * route it returns without a limit. */
  readonly costLimit?: number
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
interface SegmentColumns { readonly at: Float64Array; readonly lo: Float64Array; readonly hi: Float64Array }
/** Segments split into vertical and horizontal columns. */
function columns(segments: readonly (readonly [RouterPoint, RouterPoint])[]): { readonly vertical: SegmentColumns; readonly horizontal: SegmentColumns } {
  let verticals = 0
  for (const segment of segments) if (Math.abs(segment[0].x - segment[1].x) <= EPS) verticals++
  const column = (size: number): SegmentColumns => ({ at: new Float64Array(size), lo: new Float64Array(size), hi: new Float64Array(size) })
  const vertical = column(verticals), horizontal = column(segments.length - verticals)
  let v = 0, h = 0
  for (const segment of segments) {
    const p = segment[0], q = segment[1]
    if (Math.abs(p.x - q.x) <= EPS) { vertical.at[v] = p.x; vertical.lo[v] = Math.min(p.y, q.y); vertical.hi[v++] = Math.max(p.y, q.y) }
    else { horizontal.at[h] = p.y; horizontal.lo[h] = Math.min(p.x, q.x); horizontal.hi[h++] = Math.max(p.x, q.x) }
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

/** Search states in flat columns, one slot per push, so a search allocates
 * no object per state. A slot's index is its push order. Kept between
 * searches with the per-state and per-edge tables, which a new generation
 * clears without rewriting them. */
class SearchScratch {
  size = 0
  i = new Int32Array(1024); j = new Int32Array(1024); d = new Int32Array(1024); k = new Int32Array(1024)
  cost = new Float64Array(1024); rank = new Float64Array(1024); run = new Float64Array(1024)
  /** The state this one was reached from, or -1. */
  previous = new Int32Array(1024)
  final = new Uint8Array(1024)
  /** Binary min-heap of slots in search order. */
  heap = new Int32Array(1024); heapRank = new Float64Array(1024)
  open = 0
  /** The cheapest cost found per search state, valid where its generation
   * is the current pass's. */
  best = new Float64Array(0); bestGeneration = new Uint32Array(0); passGeneration = 0
  /** Each grid edge's checked extra cost, valid where its generation is the
   * current route's. */
  edge = new Float64Array(0); edgeGeneration = new Uint32Array(0); routeGeneration = 0
  /** Edges the reachability check read for a caller's `probe` that the
   * search has not yet charged, where the generation is the current route's. */
  owed = new Uint32Array(0)

  /** Starts a pass over `states` search states. */
  startPass(states: number): void {
    this.size = 0; this.open = 0
    if (this.best.length < states) { this.best = new Float64Array(states); this.bestGeneration = new Uint32Array(states); this.passGeneration = 0 }
    if (++this.passGeneration === 0xffffffff) { this.bestGeneration.fill(0); this.passGeneration = 1 }
  }

  /** Starts a route over `edges` grid edges. */
  startRoute(edges: number): void {
    if (this.edge.length < edges) { this.edge = new Float64Array(edges); this.edgeGeneration = new Uint32Array(edges); this.owed = new Uint32Array(0); this.routeGeneration = 0 }
    if (++this.routeGeneration === 0xffffffff) { this.edgeGeneration.fill(0); this.owed.fill(0); this.routeGeneration = 1 }
  }

  /** Readies the owed-edge table for the current route's edges. */
  startOwing(): void {
    if (this.owed.length < this.edge.length) this.owed = new Uint32Array(this.edge.length)
  }

  add(i: number, j: number, d: number, k: number, cost: number, rank: number, run: number, previous: number, final: 0 | 1): number {
    if (this.size === this.i.length) this.grow()
    const slot = this.size++
    this.i[slot] = i; this.j[slot] = j; this.d[slot] = d; this.k[slot] = k
    this.cost[slot] = cost; this.rank[slot] = rank; this.run[slot] = run; this.previous[slot] = previous; this.final[slot] = final
    return slot
  }

  private grow(): void {
    const size = this.i.length * 2
    const widen = <T extends Int32Array | Float64Array | Uint8Array>(from: T, to: T): T => { to.set(from); return to }
    this.i = widen(this.i, new Int32Array(size)); this.j = widen(this.j, new Int32Array(size))
    this.d = widen(this.d, new Int32Array(size)); this.k = widen(this.k, new Int32Array(size))
    this.cost = widen(this.cost, new Float64Array(size)); this.rank = widen(this.rank, new Float64Array(size)); this.run = widen(this.run, new Float64Array(size))
    this.previous = widen(this.previous, new Int32Array(size)); this.final = widen(this.final, new Uint8Array(size))
    this.heap = widen(this.heap, new Int32Array(size)); this.heapRank = widen(this.heapRank, new Float64Array(size))
  }

  /** The search order: lower rank (cost so far plus the least cost still to
   * come) first, within EPS a tie, then the earlier grid column, row and
   * heading, then the earlier push. Deterministic. The heap keeps each
   * slot's rank beside it; ties read the slots. */
  private tieBefore(a: number, b: number): boolean {
    const i = this.i, j = this.j, d = this.d
    return i[a] !== i[b] ? i[a]! < i[b]! : j[a] !== j[b] ? j[a]! < j[b]! : d[a] !== d[b] ? d[a]! < d[b]! : a < b
  }

  push(slot: number): void {
    const heap = this.heap, ranks = this.heapRank, rank = this.rank[slot]!
    let index = this.open++
    while (index > 0) {
      const parent = (index - 1) >> 1, other = ranks[parent]!
      if (Math.abs(rank - other) > EPS ? rank >= other : !this.tieBefore(slot, heap[parent]!)) break
      heap[index] = heap[parent]!; ranks[index] = other
      index = parent
    }
    heap[index] = slot; ranks[index] = rank
  }

  pop(): number {
    const heap = this.heap, ranks = this.heapRank, first = heap[0]!
    const size = --this.open, last = heap[size]!, rank = ranks[size]!
    if (size === 0) return first
    let index = 0
    for (;;) {
      const left = index * 2 + 1, right = left + 1
      if (left >= size) break
      let child = left
      if (right < size) {
        const r = ranks[right]!, l = ranks[left]!
        if (Math.abs(r - l) > EPS ? r < l : this.tieBefore(heap[right]!, heap[left]!)) child = right
      }
      const c = ranks[child]!
      if (Math.abs(c - rank) > EPS ? c >= rank : !this.tieBefore(heap[child]!, last)) break
      heap[index] = heap[child]!; ranks[index] = c
      index = child
    }
    heap[index] = last; ranks[index] = rank
    return first
  }
}

/** One scratch kept between routes; a nested route (from a `charge`
 * callback) gets its own. */
let spareScratch: SearchScratch | undefined = new SearchScratch()

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
/** Scratch tables larger than this many entries are dropped after the route
 * that needed them rather than kept for the next. */
const RETAINED_SCRATCH = 1 << 20
/** States a search expands before it checks that a route exists at all. */
const HOPELESS = 128
/** Thrown inside the reachability check when the caller's `probe` declines. */
const ABANDONED = Symbol('abandoned reachability check')
/** How far past the cheapest cost a bounded pass still queues states: far
 * above rounding in summed costs; more only queues more states. */
const BOUND_SLACK = 1
/** How far past `costLimit` a route must cost before the search gives up on
 * it: far above rounding in summed costs, so a route within the limit, or a
 * caller summing the same route its own way, is never cut off. */
export const COST_LIMIT_SLACK = 1

/** Fewest bends, then shortest; undefined when no clear route exists. */
export function routeOrthogonal(request: OrthogonalRouteRequest): RouterPoint[] | undefined {
  const { start, end, exit, entry, clearance } = request
  const bendCost = request.bendCost ?? 1e4
  const minRun = request.minRun ?? 0
  const inflate = (box: RouterBox): RouterBox => ({ x0: box.x0 - clearance, y0: box.y0 - clearance, x1: box.x1 + clearance, y1: box.y1 + clearance })
  const inflated = request.obstacles.map(inflate)
  // A frame side is a band across its line that runs along it may not enter.
  const sides = (horizontal: boolean): RouterBox[] => {
    const frames = request.frames, bands: RouterBox[] = []
    if (frames) for (const box of frames.boxes) for (const at of horizontal ? [box.y0, box.y1] : [box.x0, box.x1]) {
      bands.push(horizontal ? { x0: box.x0, y0: at - frames.clearance, x1: box.x1, y1: at + frames.clearance } : { x0: at - frames.clearance, y0: box.y0, x1: at + frames.clearance, y1: box.y1 })
    }
    return bands
  }
  const frameRows = sides(true), frameColumns = sides(false)
  const framedX = [...request.axisObstacles?.horizontal ?? [], ...frameRows], framedY = [...request.axisObstacles?.vertical ?? [], ...frameColumns]
  const acrossX = [...(request.axisObstacles?.horizontal ?? []).map(inflate), ...frameRows], acrossY = [...(request.axisObstacles?.vertical ?? []).map(inflate), ...frameColumns]
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
  // A box blocks a line it passes through over its span along the line:
  // `blocks` lists those spans as (from, to) pairs.
  type Line = { vertical: boolean; at: number; blocks: number[]; crowd: number[]; cross?: Float64Array }
  const columnsAt: (Line | undefined)[] = [], rowsAt: (Line | undefined)[] = []
  const avoided = columns(request.avoid?.segments ?? []), drawn = columns(request.crossings?.segments ?? [])
  const lineAt = (vertical: boolean, index: number): Line => {
    let line = vertical ? columnsAt[index] : rowsAt[index]
    if (line) return line
    const at = vertical ? xs[index]! : ys[index]!
    const passes = (box: RouterBox) => vertical ? box.x0 + EPS < at && at < box.x1 - EPS : box.y0 + EPS < at && at < box.y1 - EPS
    // Avoided segments on this line or within a separation beside it.
    const along = vertical ? avoided.vertical : avoided.horizontal, crowd: number[] = []
    for (let k = 0; k < along.at.length; k++) {
      const offset = Math.abs(along.at[k]! - at)
      if (offset <= EPS || offset < separation) crowd.push(k)
    }
    const blocks: number[] = []
    for (const boxes of [inflated, vertical ? acrossY : acrossX]) for (const box of boxes) if (passes(box)) blocks.push(vertical ? box.y0 : box.x0, vertical ? box.y1 : box.x1)
    line = { vertical, at, blocks, crowd }
    if (vertical) columnsAt[index] = line
    else rowsAt[index] = line
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
  /** Whether step a-b along `line` keeps out of every box and clear of the
   * avoided segments. A box the line passes through is entered where the
   * step's span overlaps the box's span along the line (`segmentHits`). */
  const clear = (a: RouterPoint, b: RouterPoint, line: Line) => {
    const lo = line.vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), hi = line.vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x), blocks = line.blocks
    for (let k = 0; k < blocks.length; k += 2) if (hi > blocks[k]! + EPS && lo < blocks[k + 1]! - EPS) return false
    return !(request.avoid && crowds(a, b, line.at, line.vertical ? avoided.vertical : avoided.horizontal, line.crowd, request.avoid))
  }
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
      ? !stubClear(endpoint, tip, framedX, acrossX)
      : !stubClear(endpoint, tip, framedY, acrossY))
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
  // The least cost still to come, for a guided search (one through via
  // points would otherwise spread over the whole grid): the length through
  // the remaining stops plus the turns the next stop needs at least. It never
  // overestimates and never drops by more than a step costs, so the first
  // route found is still the cheapest.
  const arrivals = intos.map(({ point }) => point)
  const apart = (a: RouterPoint, b: RouterPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  const rest = via.map(() => 0)
  for (let k = via.length - 1; k >= 0; k--) rest[k] = k === via.length - 1 ? Math.min(...arrivals.map(end => apart(via[k]!, end))) : apart(via[k]!, via[k + 1]!) + rest[k + 1]!
  /** Length from (x, y) to (nextX, nextY) plus the turns reaching it
   * heading (stepX, stepY) needs. */
  const toward = (x: number, y: number, stepX: number, stepY: number, nextX: number, nextY: number) => {
    const dx = nextX - x, dy = nextY - y
    const ahead = dx * stepX + dy * stepY, aside = Math.abs(dx * stepY - dy * stepX)
    return Math.abs(dx) + Math.abs(dy) + (aside <= EPS ? (ahead >= -EPS ? 0 : 2) : ahead >= -EPS ? 1 : 2) * bendCost
  }
  const guided = request.guided || via.length > 0
  const viaX = via.map(point => point.x), viaY = via.map(point => point.y), arrivalX = arrivals.map(point => point.x), arrivalY = arrivals.map(point => point.y)
  const lowerBound = (i: number, j: number, d: number, k: number) => {
    const x = xs[i]!, y = ys[j]!, stepX = DI[d]!, stepY = DJ[d]!
    if (k < via.length) return toward(x, y, stepX, stepY, viaX[k]!, viaY[k]!) + rest[k]!
    let least = Infinity
    for (let at = 0; at < arrivalX.length; at++) least = Math.min(least, toward(x, y, stepX, stepY, arrivalX[at]!, arrivalY[at]!))
    return least
  }
  // With minRun, a short current run can block a turn a longer one allows,
  // so the search distinguishes the two.
  const runs = minRun > EPS ? 2 : 1
  const rows = ys.length, stages = via.length + 1
  const key = (i: number, j: number, d: number, k: number, run: number) => (((i * rows + j) * 4 + d) * runs + (run < minRun - EPS ? 1 : 0)) * stages + k
  const states = xs.length * rows * 4 * runs * stages
  // Clearance and extra cost belong to a grid edge, not to the state that
  // reaches it: each edge is checked once, however many headings arrive and
  // however many passes search the grid: -1 = blocked, otherwise its extra
  // cost (crossings, off channel).
  const edges = xs.length * rows * 4
  const scratch = spareScratch ?? new SearchScratch()
  spareScratch = undefined
  const dense = edges <= DENSE_EDGE_CACHE, sparse = dense ? undefined : new Map<number, number>()
  if (dense) scratch.startRoute(edges)
  // Under a `charge` budget with a `probe`, an edge the reachability check
  // reads first is owed to `charge` until the search reads it.
  const deferring = request.charge !== undefined && request.probe !== undefined
  if (deferring && dense) scratch.startOwing()
  const owed = scratch.owed, owedSparse = deferring && !dense ? new Set<number>() : undefined
  const edgeCost = scratch.edge, edgeGeneration = scratch.edgeGeneration, route = scratch.routeGeneration
  const arrivesAt = new Uint8Array(xs.length * rows)
  for (const target of targets) arrivesAt[target.i * rows + target.j] = 1
  /** The extra cost of the grid step from (i, j) heading d, `length` long,
   * or -1 when it is blocked; checked (and charged) once. */
  const stepExtra = (i: number, j: number, d: number, length: number): number => {
    const edge = (i * rows + j) * 4 + d
    if (dense ? edgeGeneration[edge] === route : sparse!.has(edge)) {
      if (deferring && (dense ? owed[edge] === route : owedSparse!.has(edge))) {
        if (dense) owed[edge] = 0
        else owedSparse!.delete(edge)
        request.charge!()
      }
      return dense ? edgeCost[edge]! : sparse!.get(edge)!
    }
    request.charge?.()
    return measure(i, j, d, length, edge)
  }
  /** The same step read for the reachability check under a `probe`: charged
   * to the probe, and owed to `charge`, when it reads the step first. */
  const probeStep = (i: number, j: number, d: number, length: number): number => {
    const edge = (i * rows + j) * 4 + d
    if (dense ? edgeGeneration[edge] === route : sparse!.has(edge)) return dense ? edgeCost[edge]! : sparse!.get(edge)!
    if (!request.probe!()) throw ABANDONED
    if (dense) owed[edge] = route
    else owedSparse!.add(edge)
    return measure(i, j, d, length, edge)
  }
  /** Checks a step not read before and keeps its extra cost. */
  const measure = (i: number, j: number, d: number, length: number, edge: number): number => {
    const ni = i + DI[d]!, nj = j + DJ[d]!
    const a = { x: xs[i]!, y: ys[j]! }, b = { x: xs[ni]!, y: ys[nj]! }
    const vertical = d % 2 === 1, line = vertical ? lineAt(true, i) : lineAt(false, j)
    let crossed = !clear(a, b, line) ? -1 : request.crossings ? crossedSegments(a, b, meets(line), arrivesAt[ni * rows + nj] === 1) * request.crossings.cost : 0
    if (crossed >= 0 && offChannel && !(vertical ? onChannelX[i] : onChannelY[j])) crossed += offChannel * length
    if (crossed >= 0) crossed += (vertical ? lineCostX[i]! : lineCostY[j]!) * length
    if (dense) { edgeCost[edge] = crossed; edgeGeneration[edge] = route }
    else sparse!.set(edge, crossed)
    return crossed
  }
  /** Whether any route can arrive at all, ignoring cost and minimum runs.
   * Every route the search can find keeps the rules this keeps (clear
   * steps, no reversal, via points in order, arriving along an entry or
   * onto its stub), so where this finds none, neither does the search. */
  const reachable = (): boolean => {
    const step = deferring ? probeStep : stepExtra
    const length = (i: number, j: number, ni: number, nj: number) => Math.abs(xs[ni]! - xs[i]!) + Math.abs(ys[nj]! - ys[j]!)
    // Depth first, each state's steps pushed in order of least progress
    // toward a goal, so the step toward it is tried first.
    const order = [0, 1, 2, 3], progress = [0, 0, 0, 0]
    const rank = (i: number, j: number, x: number, y: number, sign: number) => {
      for (let d = 0; d < 4; d++) { order[d] = d; progress[d] = sign * (DI[d]! * (x - xs[i]!) + DJ[d]! * (y - ys[j]!)) }
      order.sort((a, b) => progress[a]! - progress[b]! || a - b)
    }
    // Backward from the arrivals to a state the last stretch can start in
    // (after the last via point, or at the start, which settles a route
    // without via points). A blocked arrival is settled here, in its own
    // neighbourhood.
    const last = stopsAt[via.length - 1]
    const startsLast = (i: number, j: number, d: number) => last ? i === last.i && j === last.j
      : sources.some(source => source.i === i && source.j === j && source.d === d)
    const goal = last ?? sources[0]!, gx = xs[goal.i]!, gy = ys[goal.j]!
    const arrives = new Uint8Array(xs.length * rows * 4), back: number[] = []
    const mark = (i: number, j: number, d: number): boolean => {
      const id = (i * rows + j) * 4 + d
      if (!arrives[id]) { arrives[id] = 1; back.push(id) }
      return startsLast(i, j, d)
    }
    let joined = false
    for (const target of targets) for (let d = 0; d < 4; d++) if ((target.d === d || (endStub > EPS && (target.d + 2) % 4 !== d)) && mark(target.i, target.j, d)) joined = true
    while (!joined && back.length) {
      const id = back.pop()!, d = id % 4, point = (id - d) / 4, j = point % rows, i = (point - j) / rows
      const pi = i - DI[d]!, pj = j - DJ[d]!
      if (pi < 0 || pj < 0 || pi >= xs.length || pj >= rows || step(pi, pj, d, length(pi, pj, i, j)) < 0) continue
      rank(pi, pj, gx, gy, -1)
      for (const from of order) if ((from + 2) % 4 !== d && mark(pi, pj, from)) { joined = true; break }
    }
    if (!joined || !via.length) return joined
    // Forward through the via points to an arrival.
    const seen = new Uint8Array(xs.length * rows * 4 * stages), stack: number[] = []
    const visit = (i: number, j: number, d: number, k: number) => {
      const id = ((i * rows + j) * 4 + d) * stages + k
      if (!seen[id]) { seen[id] = 1; stack.push(id) }
    }
    for (const { i, j, d } of sources) visit(i, j, d, advance(0, i, j))
    const arrival = targets[0]!, ax = xs[arrival.i]!, ay = ys[arrival.j]!
    while (stack.length) {
      const id = stack.pop()!, k = id % stages, cell = (id - k) / stages, sd = cell % 4, point = (cell - sd) / 4, j = point % rows, i = (point - j) / rows
      if (k === via.length) for (const target of targets) if (target.i === i && target.j === j && (target.d === sd || (endStub > EPS && (target.d + 2) % 4 !== sd))) return true
      if (k < via.length) rank(i, j, via[k]!.x, via[k]!.y, 1)
      else rank(i, j, ax, ay, 1)
      for (const d of order) {
        if ((d + 2) % 4 === sd) continue
        const ni = i + DI[d]!, nj = j + DJ[d]!
        if (ni < 0 || nj < 0 || ni >= xs.length || nj >= rows) continue
        if (step(i, j, d, length(i, j, ni, nj)) < 0) continue
        visit(ni, nj, d, advance(k, ni, nj))
      }
    }
    return false
  }
  // A search that finds no route expands every state it can reach, once per
  // via point passed. Once the first pass has expanded a few states without
  // arriving, the cheaper reachability check settles whether it can arrive
  // at all. A `charge` budget counts the steps the full search checks, so
  // the check runs under one only with a `probe` to charge its own reads.
  const hopeless = request.charge && !request.probe ? -1 : HOPELESS
  /** Whether a route may arrive; an abandoned check does not say no. */
  const mayArrive = (): boolean => {
    try { return reachable() } catch (error) { if (error === ABANDONED) return true; throw error }
  }
  const limit = (request.costLimit ?? Infinity) + COST_LIMIT_SLACK
  /** One search pass, ordered by cost alone or (`ordered`) by cost plus the
   * lower bound. States whose cost plus lower bound exceeds `bound` cannot
   * lie on a route that cheap and are never queued. Returns the route's
   * cost and grid points. */
  const search = (ordered: boolean, bound: number): { cost: number; points: RouterPoint[] } | undefined => {
    // The cheapest cost found per search state, densely where the state
    // space is small enough.
    const table = states <= DENSE_EDGE_CACHE, map = table ? undefined : new Map<number, number>()
    scratch.startPass(table ? states : 0)
    const bestCost = scratch.best, bestGeneration = scratch.bestGeneration, pass = scratch.passGeneration
    const setBest = (k: number, cost: number) => { if (table) { bestCost[k] = cost; bestGeneration[k] = pass } else map!.set(k, cost) }
    const bounded = bound < Infinity
    const finish = (slot: number) => {
      const points: RouterPoint[] = []
      for (let at = slot; at >= 0; at = scratch.previous[at]!) points.push({ x: xs[scratch.i[at]!]!, y: ys[scratch.j[at]!]! })
      return { cost: scratch.cost[slot]!, points: points.reverse() }
    }
    for (const { i, j, d } of sources) {
      // Leaving against the start heading turns at `start`: the run since
      // that turn is the stub.
      const turned = startHeading >= 0 && d !== startHeading
      const cost = turned ? bendCost : 0, run = turned ? startStub : Infinity, k = advance(0, i, j)
      const least = ordered || bounded ? lowerBound(i, j, d, k) : 0
      if (cost + least > bound) continue
      scratch.push(scratch.add(i, j, d, k, cost, cost + (ordered ? least : 0), run, -1, 0))
      setBest(key(i, j, d, k, run), cost)
    }
    let expanded = 0
    while (scratch.open) {
      const slot = scratch.pop()
      // The cost-and-bound order pops states in rising rank (within EPS per
      // heap level), and a route's every state ranks at most its cost: once
      // the first pass pops a state ranked past the limit, no route within
      // it is left.
      if (ordered && scratch.rank[slot]! > limit) return undefined
      if (scratch.final[slot]) return finish(slot)
      const si = scratch.i[slot]!, sj = scratch.j[slot]!, sd = scratch.d[slot]!, sk = scratch.k[slot]!, scost = scratch.cost[slot]!, srun = scratch.run[slot]!
      const own = key(si, sj, sd, sk, srun)
      if ((table ? (bestGeneration[own] === pass ? bestCost[own]! : Infinity) : map!.get(own) ?? Infinity) < scost - EPS) continue
      if (++expanded === hopeless && !bounded && !mayArrive()) return undefined
      if (sk === via.length) {
        // Turning onto the end stub, or off it against the end heading, is
        // one more bend each, charged before the route can win; like any
        // turn it needs a minimum run before it: the run so far for the turn
        // onto the stub, and for the turn off it the stub, plus the run so
        // far when the route arrives straight along it. Without a stub the
        // route must arrive along the entry direction itself.
        let extra = Infinity
        for (const { i, j, d } of targets) {
          if (i !== si || j !== sj || (d !== sd && (endStub <= EPS || (d + 2) % 4 === sd))) continue
          const ontoStub = d !== sd, offStub = endHeading >= 0 && d !== endHeading
          if (ontoStub && srun < minRun - EPS) continue
          if (offStub && (ontoStub ? endStub : srun + endStub) < minRun - EPS) continue
          extra = Math.min(extra, (ontoStub ? 1 : 0) + (offStub ? 1 : 0))
        }
        if (extra === 0) return finish(slot)
        if (extra < Infinity && scost + extra * bendCost <= bound) scratch.push(scratch.add(si, sj, sd, sk, scost + extra * bendCost, scost + extra * bendCost, srun, scratch.previous[slot]!, 1))
      }
      const first = scratch.previous[slot]! < 0
      for (let d = 0; d < 4; d++) {
        if ((d + 2) % 4 === sd) continue // no reversal
        // The route leaves along the exit direction: by the stub when it has
        // one, otherwise by its first move.
        if (first && d !== sd && startStub <= EPS) continue
        const ni = si + DI[d]!, nj = sj + DJ[d]!
        if (ni < 0 || nj < 0 || ni >= xs.length || nj >= rows) continue
        const turned = d !== sd
        if (turned && srun < minRun - EPS) continue
        const length = Math.abs(xs[ni]! - xs[si]!) + Math.abs(ys[nj]! - ys[sj]!)
        const edge = (si * rows + sj) * 4 + d
        const crossed = dense && edgeGeneration[edge] === route && !(deferring && owed[edge] === route) ? edgeCost[edge]! : stepExtra(si, sj, d, length)
        if (crossed < 0) continue
        const cost = scost + length + (turned ? bendCost : 0) + crossed
        const run = turned ? length : srun + length
        const passed = advance(sk, ni, nj), k = key(ni, nj, d, passed, run)
        const least = ordered || bounded ? lowerBound(ni, nj, d, passed) : 0
        if (cost + least > bound) continue
        if (table) {
          if (bestGeneration[k] === pass && bestCost[k]! <= cost + EPS) continue
          bestCost[k] = cost; bestGeneration[k] = pass
        } else {
          if ((map!.get(k) ?? Infinity) <= cost + EPS) continue
          map!.set(k, cost)
        }
        scratch.push(scratch.add(ni, nj, d, passed, cost, cost + (ordered ? least : 0), run, slot, 0))
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
  let found: { cost: number; points: RouterPoint[] } | undefined
  try {
    const cheapest = search(true, Infinity)
    found = guided || !cheapest ? cheapest : search(false, cheapest.cost + BOUND_SLACK) ?? cheapest
  } finally {
    // A table this large is rare; keep it no longer than this route.
    if (scratch.best.length > RETAINED_SCRATCH || scratch.edge.length > RETAINED_SCRATCH || scratch.i.length > RETAINED_SCRATCH) spareScratch = new SearchScratch()
    else spareScratch = scratch
  }
  if (!found) return undefined
  const grid = found.points
  // Keep only the corners, then attach the stubs to the real endpoints.
  const corners = grid.filter((point, k) => {
    if (k === 0 || k === grid.length - 1) return true
    const p = grid[k - 1]!, n = grid[k + 1]!
    return !((Math.abs(p.x - point.x) <= EPS && Math.abs(n.x - point.x) <= EPS) || (Math.abs(p.y - point.y) <= EPS && Math.abs(n.y - point.y) <= EPS))
  })
  // Drop interior points made collinear by attaching the stubs.
  return withoutCollinear([start, ...corners, end].filter((point, k, all) => k === 0 || !samePoint(point, all[k - 1]!)))
}

/** How far beside each stub tip the last-resort route may turn. */
const FALLBACK_DETOUR = 16
/** The shortest lead the last-resort route draws, so it leaves and arrives
 * along its ports even where the other endpoint's stub tip is its own
 * endpoint (a route there would take no step from it). */
const FALLBACK_LEAD = 1

/** A family's last resort where no clear route exists: the request's
 * fewest-bend orthogonal route through nothing at all. It keeps the
 * endpoints, the exit and entry directions, the stubs (at least
 * `FALLBACK_LEAD` long) and the family's line costs, and drops the
 * obstacles, drawn routes, via points and minimum run; lines a detour beside
 * each stub tip let it turn back toward an endpoint behind the other, so a
 * route always exists. */
export function orthogonalFallback(request: Pick<OrthogonalRouteRequest, 'start' | 'end' | 'exit' | 'entry' | 'stub' | 'channels' | 'bendCost' | 'lineCosts'>): RouterPoint[] {
  const { start, end, exit, entry, stub } = request
  const [startStub, endStub] = (typeof stub === 'object' ? stub : [stub ?? 0, stub ?? 0]).map(length => Math.max(length, FALLBACK_LEAD)) as [number, number]
  const exits = typeof exit === 'string' ? [exit] : exit, entries = typeof entry === 'string' ? [entry] : entry
  const tips = [...exits.map(d => ({ x: start.x + STEP[d].x * startStub, y: start.y + STEP[d].y * startStub })), ...entries.map(d => ({ x: end.x - STEP[d].x * endStub, y: end.y - STEP[d].y * endStub }))]
  const beside = (values: readonly number[]) => values.flatMap(value => [value - FALLBACK_DETOUR, value + FALLBACK_DETOUR])
  const route = routeOrthogonal({
    start, end, exit, entry, stub: [startStub, endStub], obstacles: [], clearance: 0,
    channels: { x: [...request.channels?.x ?? [], ...beside(tips.map(tip => tip.x))], y: [...request.channels?.y ?? [], ...beside(tips.map(tip => tip.y))] },
    ...(request.bendCost === undefined ? {} : { bendCost: request.bendCost }),
    ...(request.lineCosts ? { lineCosts: request.lineCosts } : {}),
  })
  if (!route) throw new Error('orthogonalFallback: an unobstructed grid with lines beside both stub tips always routes')
  return route
}
