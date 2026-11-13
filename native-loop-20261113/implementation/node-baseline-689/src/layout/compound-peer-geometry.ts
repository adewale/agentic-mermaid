import { buildNodeLaneIndex, type NodeLaneIndex } from '../shared/node-lane-index.ts'
import type { Point } from '../types.ts'
import type { ChannelWork } from './channel-tracks.ts'
import { pointOnMeasuredSegment } from './measured-route-safety.ts'

type PeerSegment = [Point, Point] & {
  x: number
  y: number
  width: number
  height: number
  route: number
  ordinal: number
  xLow: number
  xHigh: number
  yLow: number
  yHigh: number
}
interface RouteGeometry {
  points: Point[]
  segments: number
}
interface Membership {
  peer: PeerSegment
  next: Membership | undefined
}
interface AxisState {
  cross: 'x' | 'y'
  enabled: boolean
  seed: NodeLaneIndex | null
  first: number
  last: number
  memberships: number
  safe: boolean
  domainFirst: number
  domainLast: number
  heads: (Membership | undefined)[] | undefined
}
export interface PeerLease {
  readonly index: number
  readonly revision: number
  released: boolean
  queries: number
  guardCalls: number
  guard: (a: Point, b: Point, arrival: number, axis: number) => boolean
  release: () => void
}
interface PeerRoute {
  points: Point[]
  style: string
}

/** One boundary-call owner. Queries retain a single immutable peer revision. */
class GeometryOwner {
  readonly catalog: (RouteGeometry | null | undefined)[]
  readonly rails: PeerSegment[]
  readonly x: AxisState
  readonly y: AxisState
  revision = 0
  active: PeerLease | undefined
  geometrySafe = true
  arcAllocated = 1 // factory pre-reserves the owner instance
  pointAllocated = 0
  insertionVisits = 0
  flatMoves = 0
  flatSearches = 0
  seedBuilds = 0
  private failed = false
  private updating = true
  private lastStart = 0
  private lastCount = 0
  private readonly onIndexCharge: (amount: number, kind: 'capacity' | 'work') => void

  constructor(
    routes: readonly PeerRoute[],
    current: number,
    readonly canvasWidth: number,
    readonly canvasHeight: number,
    readonly work: ChannelWork,
    readonly reservePoints: (amount: number) => void,
    readonly fail: (reason: string) => never,
  ) {
    // Instance allocation is pre-reserved by createPeerGeometryOwner.
    this.capacity(routes.length + 2) // catalog slots/header + rail header
    this.catalog = new Array(routes.length)
    this.rails = []
    this.capacity(1) // retained original-builder callback
    this.onIndexCharge = (amount, kind) => (kind === 'capacity' ? this.capacity(amount) : this.charge(amount))
    this.capacity(2) // two axis records (heads are allocated separately)
    this.x = { cross: 'x', enabled: false, seed: null, first: Infinity, last: -Infinity, memberships: 0, safe: true, domainFirst: NaN, domainLast: NaN, heads: undefined }
    this.y = { cross: 'y', enabled: false, seed: null, first: Infinity, last: -Infinity, memberships: 0, safe: true, domainFirst: NaN, domainLast: NaN, heads: undefined }
    for (let index = 0; index < routes.length; index++) {
      this.charge()
      if (index !== current && routes[index]!.style !== 'invisible') this.addGeometry(index, routes[index]!.points)
    }
    this.seedAxis(this.x)
    this.seedAxis(this.y)
    this.updating = false
  }

  private charge(amount = 1): void {
    this.work.pairs -= amount
    if (this.work.pairs < 0) {
      this.failed = true
      this.fail('agentic local cross-hierarchy crossing-work limit')
    }
  }
  private capacity(amount: number): void {
    this.work.arcs -= amount
    if (this.work.arcs < 0) {
      this.failed = true
      this.fail('agentic local cross-hierarchy visibility-arc limit')
    }
    this.arcAllocated += amount
  }
  private point(): void {
    try {
      this.reservePoints(1)
      this.pointAllocated++
    } catch (error) {
      this.failed = true
      throw error
    }
  }
  private axisEligible(axis: AxisState): boolean {
    this.charge(8)
    const count = this.rails.length,
      span = axis.last - axis.first + 1
    return this.geometrySafe && count >= 32 && count <= 0x10000000 && axis.safe && Number.isSafeInteger(axis.memberships) && axis.memberships <= 8 * count && Number.isSafeInteger(span) && span <= 8 * count
  }
  private addTotals(axis: AxisState, segment: PeerSegment): void {
    this.charge(8)
    const low = axis.cross === 'x' ? segment.xLow : segment.yLow
    const high = axis.cross === 'x' ? segment.xHigh : segment.yHigh
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || high < low) {
      axis.safe = false
      return
    }
    axis.memberships += high - low + 1
    axis.first = Math.min(axis.first, low)
    axis.last = Math.max(axis.last, high)
    if (!Number.isSafeInteger(axis.memberships)) axis.safe = false
  }
  private addGeometry(index: number, raw: readonly Point[]): void {
    this.charge(3)
    if (!Number.isInteger(index) || index < 0 || index >= this.catalog.length || this.catalog[index] !== undefined) throw new TypeError('Duplicate or invalid peer geometry publication')
    this.capacity(raw.length + 2) // route record + original-length path slots/header
    const path: Point[] = new Array(raw.length)
    let used = 0
    for (let i = 0; i < raw.length; i++) {
      this.charge(4)
      const point = raw[i]!,
        previous = path[used - 1]
      if (previous?.x === point.x && previous.y === point.y) continue
      this.point()
      path[used++] = { x: point.x, y: point.y }
      while (used > 2) {
        this.charge(8)
        const a = path[used - 3]!,
          b = path[used - 2]!,
          c = path[used - 1]!
        if (!((a.x === b.x && b.x === c.x && b.y >= Math.min(a.y, c.y) && b.y <= Math.max(a.y, c.y)) || (a.y === b.y && b.y === c.y && b.x >= Math.min(a.x, c.x) && b.x <= Math.max(a.x, c.x)))) break
        path[used - 2] = c
        used--
      }
    }
    path.length = used // no capacity/point refund
    const count = Math.max(0, used - 1)
    let start = 0
    while (start < this.rails.length) {
      this.charge()
      this.flatSearches++
      if (this.rails[start]!.route > index) break
      start++
    }
    this.capacity(count) // new retained flat slots, BEFORE extension/movement
    const oldLength = this.rails.length
    this.rails.length = oldLength + count
    for (let cursor = oldLength - 1; cursor >= start; cursor--) {
      this.charge()
      this.flatMoves++
      this.rails[cursor + count] = this.rails[cursor]!
    }
    for (let ordinal = 0; ordinal < count; ordinal++) {
      this.charge(12)
      const a = path[ordinal]!,
        b = path[ordinal + 1]!
      this.geometrySafe &&= Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(b.x) && Number.isFinite(b.y) && (a.x === b.x || a.y === b.y) && Number.isFinite(Math.abs(a.x - b.x)) && Number.isFinite(Math.abs(a.y - b.y))
      this.capacity(3) // tuple record/header + two element slots; it IS the AABB record
      const segment = [a, b] as PeerSegment
      segment.route = index
      segment.ordinal = ordinal
      segment.x = Math.min(a.x, b.x) - 0.5
      segment.y = Math.min(a.y, b.y) - 0.5
      segment.width = Math.abs(a.x - b.x) + 1
      segment.height = Math.abs(a.y - b.y) + 1
      // EXACT original low+width arithmetic, never max+.5.
      segment.xLow = Math.floor(segment.x / 128)
      segment.xHigh = Math.floor((segment.x + segment.width) / 128)
      segment.yLow = Math.floor(segment.y / 128)
      segment.yHigh = Math.floor((segment.y + segment.height) / 128)
      this.rails[start + ordinal] = segment
      this.addTotals(this.x, segment)
      this.addTotals(this.y, segment)
    }
    this.catalog[index] = { points: path, segments: count }
    // Scalar publication cursors avoid a transient descriptor allocation.
    this.lastStart = start
    this.lastCount = count
  }
  private seedAxis(axis: AxisState): void {
    this.charge(12)
    const extent = axis.cross === 'x' ? this.canvasWidth : this.canvasHeight
    const first = Math.min(axis.first, Math.floor(-0.5 / 128))
    const last = Math.max(axis.last, Math.floor((extent + 0.5) / 128)),
      cells = last - first + 1
    axis.domainFirst = first
    axis.domainLast = last
    if (!this.axisEligible(axis) || !Number.isFinite(extent) || extent < 0 || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || !Number.isSafeInteger(cells) || cells > 8 * this.rails.length) return
    this.seedBuilds++
    axis.seed = buildNodeLaneIndex(this.rails, axis.cross, 0, this.onIndexCharge)
    if (!axis.seed) return // memoized permanent linear fallback
    this.capacity(cells + 1) // head-array header plus every reference slot
    this.charge(cells) // explicit full-domain initialization is separate from capacity
    axis.heads = new Array(cells).fill(undefined)
    axis.enabled = true
    // Existing builder ordinals already have the required authored/segment order.
    for (let cell = 0; cell + 1 < axis.seed.offsets.length; cell++) {
      this.charge()
      const selected = axis.seed.firstCell + cell - axis.domainFirst
      for (let cursor = axis.seed.offsets[cell + 1]! - 1; cursor >= axis.seed.offsets[cell]!; cursor--) {
        this.charge()
        this.capacity(1)
        axis.heads[selected] = { peer: this.rails[axis.seed.ordinals[cursor]!]!, next: axis.heads[selected] }
      }
    }
  }
  private insert(axis: AxisState, peer: PeerSegment): void {
    const low = axis.cross === 'x' ? peer.xLow : peer.yLow,
      high = axis.cross === 'x' ? peer.xHigh : peer.yHigh
    for (let cell = low; cell <= high; cell++) {
      this.charge(2)
      const selected = cell - axis.domainFirst
      let prior: Membership | undefined,
        next = axis.heads![selected]
      while (next) {
        this.charge(2)
        this.insertionVisits++
        if (next.peer.route > peer.route || (next.peer.route === peer.route && next.peer.ordinal >= peer.ordinal)) break
        prior = next
        next = next.next
      }
      this.capacity(1)
      const link: Membership = { peer, next }
      if (prior) prior.next = link
      else axis.heads![selected] = link
    }
  }
  private assertLease(lease: PeerLease): void {
    if (this.failed || this.updating || lease.released || this.active !== lease || lease.revision !== this.revision) throw new TypeError('Stale peer geometry revision')
  }
  acquire(index: number): PeerLease {
    this.charge(4)
    if (this.failed || this.updating || this.active || !Number.isInteger(index) || index < 0 || index >= this.catalog.length || this.catalog[index] !== undefined) throw new TypeError('Peer geometry lease is already active or owns its current route')
    this.capacity(3) // lease object and two retained function headers
    const lease: PeerLease = { index, revision: this.revision, released: false, queries: 0, guardCalls: 0, guard: undefined!, release: undefined! }
    lease.guard = (a, b, arrival, axis) => this.canTraverse(lease, a, b, arrival, axis)
    lease.release = () => this.release(lease)
    this.charge() // prepay the guaranteed valid-release cleanup, avoiding error masking
    this.active = lease
    return lease
  }
  enterQuery(lease: PeerLease): void {
    this.charge()
    this.assertLease(lease)
    this.charge() // prepay leaveQuery BEFORE entry; cleanup never masks a producer exception
    lease.queries++
  }
  leaveQuery(lease: PeerLease): void {
    // This cleanup was prepaid, and may unwind the ORIGINAL budget exception.
    if (lease.released || this.active !== lease || lease.revision !== this.revision || lease.queries <= 0) {
      this.charge()
      throw new TypeError('Peer query lease was not entered or is stale')
    }
    lease.queries--
  }
  release(lease: PeerLease): void {
    if (lease.released || this.active !== lease || lease.revision !== this.revision || lease.queries || lease.guardCalls) {
      this.charge()
      throw new TypeError('Cannot release stale peer geometry or an active query')
    }
    // Valid release was prepaid at acquisition; allow poisoned-state cleanup.
    lease.released = true
    this.active = undefined
  }
  publish(index: number, points: readonly Point[], visible: boolean): void {
    this.charge(4)
    if (this.failed || this.updating || this.active) throw new TypeError('Cannot publish peer geometry while a revision is leased or failed')
    if (!Number.isInteger(index) || index < 0 || index >= this.catalog.length || this.catalog[index] !== undefined) throw new TypeError('Duplicate or invalid peer geometry publication')
    this.updating = true
    if (!visible) {
      this.catalog[index] = null
      this.revision++
      this.updating = false
      return
    }
    this.addGeometry(index, points)
    const start = this.lastStart,
      count = this.lastCount
    for (let which = 0; which < 2; which++) {
      const axis = which === 0 ? this.x : this.y
      // Complete range/eligibility proof precedes ALL new membership enumeration.
      let covered = true
      for (let i = start; i < start + count; i++) {
        this.charge(4)
        const peer = this.rails[i]!,
          low = which === 0 ? peer.xLow : peer.yLow,
          high = which === 0 ? peer.xHigh : peer.yHigh
        if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low < axis.domainFirst || high > axis.domainLast) covered = false
      }
      if (!this.axisEligible(axis) || !covered) axis.enabled = false
      if (axis.enabled) for (let i = start; i < start + count; i++) this.insert(axis, this.rails[i]!)
    }
    this.revision++
    this.updating = false
  }
  private blocked(a: Point, b: Point, peer: PeerSegment, arrival: number, axis: number): boolean {
    const c = peer[0],
      d = peer[1]
    this.charge()
    if (arrival !== axis && pointOnMeasuredSegment(a, c, d)) return true
    const vertical = a.x === b.x,
      peerVertical = c.x === d.x
    if (vertical === peerVertical) {
      const separation = Math.abs(vertical ? a.x - c.x : a.y - c.y)
      const overlap = Math.min(vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x), vertical ? Math.max(c.y, d.y) : Math.max(c.x, d.x)) - Math.max(vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), vertical ? Math.min(c.y, d.y) : Math.min(c.x, d.x))
      if ((separation <= 0.5 && overlap > 0.01) || (separation === 0 && overlap >= 0)) return true
    } else {
      const x = vertical ? a.x : c.x,
        y = vertical ? c.y : a.y
      if (
        (a.x === b.x ? Math.abs(x - a.x) < 1e-7 : Math.abs(y - a.y) < 1e-7) &&
        x >= Math.min(a.x, b.x) &&
        x <= Math.max(a.x, b.x) &&
        y >= Math.min(a.y, b.y) &&
        y <= Math.max(a.y, b.y) &&
        (c.x === d.x ? Math.abs(x - c.x) < 1e-7 : Math.abs(y - c.y) < 1e-7) &&
        x >= Math.min(c.x, d.x) &&
        x <= Math.max(c.x, d.x) &&
        y >= Math.min(c.y, d.y) &&
        y <= Math.max(c.y, d.y) &&
        ((x === c.x && y === c.y) || (x === d.x && y === d.y))
      )
        return true
    }
    return false
  }
  private canTraverse(lease: PeerLease, a: Point, b: Point, arrival: number, axis: number): boolean {
    this.charge(2) // original finite/cell entry + revision validation
    this.assertLease(lease)
    lease.guardCalls++
    try {
      const cross = a.x === b.x ? this.x : this.y
      const coordinate = a.x === b.x ? a.x : a.y,
        cell = Math.floor(coordinate / 128)
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y) || (a.x !== b.x && a.y !== b.y) || !cross.enabled || !Number.isSafeInteger(cell)) {
        for (let i = 0; i < this.rails.length; i++) if (this.blocked(a, b, this.rails[i]!, arrival, axis)) return false
        return true
      }
      if (cell < cross.domainFirst || cell > cross.domainLast) return true
      let link = cross.heads![cell - cross.domainFirst]
      while (link) {
        if (this.blocked(a, b, link.peer, arrival, axis)) return false
        link = link.next
      }
      return true
    } finally {
      lease.guardCalls--
    }
  }
}

export type PeerGeometryOwner = GeometryOwner

export function createPeerGeometryOwner(routes: readonly PeerRoute[], current: number, canvasWidth: number, canvasHeight: number, work: ChannelWork, reservePoints: (amount: number) => void, fail: (reason: string) => never): PeerGeometryOwner {
  work.arcs-- // owner instance BEFORE construction; no rollback after constructor failure
  if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
  const owner = new GeometryOwner(routes, current, canvasWidth, canvasHeight, work, reservePoints, fail)
  return owner
}
