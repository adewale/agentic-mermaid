import type { Point } from '../types.ts'
import { pointOnMeasuredSegment } from './measured-route-safety.ts'
import { buildNodeLaneIndex, nodeLaneCell, type NodeLaneIndex } from '../shared/node-lane-index.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { RoutingBox } from './compound-visibility.ts'

export interface CompoundProjection { left: number; right: number; top: number; bottom: number }

export interface CompoundObstacleQueries {
  projectPoint: (x: number, y: number, bounds: Readonly<RoutingBox>, result: CompoundProjection) => void
  containsPoint: (x: number, y: number, beforeComparison?: () => void) => boolean
  entersSegment: (ax: number, ay: number, bx: number, by: number, beforeComparison?: () => void) => boolean
}

const obstacleQueryOwners = new WeakMap<CompoundObstacleQueries, {
  boxes: readonly Readonly<RoutingBox>[]
  containsPoint: CompoundObstacleQueries['containsPoint']
  entersSegment: CompoundObstacleQueries['entersSegment']
  projectPoint: CompoundObstacleQueries['projectPoint']
}>()

/** Internal proof authority only; wrappers, changed methods and another solid
 * array retain their original query behavior. Do not invoke custom getters. */
export function isCompoundObstacleIndexFor(queries: CompoundObstacleQueries | undefined, boxes: readonly Readonly<RoutingBox>[]): boolean {
  if (!queries) return false
  const owner = obstacleQueryOwners.get(queries)
  if (!owner || owner.boxes !== boxes) return false
  return Object.getOwnPropertyDescriptor(queries, 'containsPoint')?.value === owner.containsPoint
    && Object.getOwnPropertyDescriptor(queries, 'entersSegment')?.value === owner.entersSegment
    && Object.getOwnPropertyDescriptor(queries, 'projectPoint')?.value === owner.projectPoint
}

/** One immutable, internally owned rectangle scope. The inclusive lane index
 * is only a broad phase; every candidate keeps the original strict predicate.
 * Index metadata capacity uses arcs, comparisons use pairs, without refunds. */
function createIndexView(boxes: readonly Readonly<RoutingBox>[], work: ChannelWork, fail: (reason: string) => never, selected?: {x: NodeLaneIndex | null; y: NodeLaneIndex | null}): CompoundObstacleQueries {
  const charge = (amount = 1): void => {
    work.pairs -= amount
    if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
  }
  const chargeIndex = (amount: number, kind: 'capacity' | 'work'): void => {
    if (kind === 'work') charge(amount)
    else {
      work.arcs -= amount
      if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
    }
  }
  const xIndex = selected ? selected.x : buildNodeLaneIndex(boxes, 'x', 0, chargeIndex), yIndex = selected ? selected.y : buildNodeLaneIndex(boxes, 'y', 0, chargeIndex)
  const cell = (index: NodeLaneIndex | null, coordinate: number, beforeComparison?: () => void): number | null => {
    if (!index) return null
    beforeComparison?.()
    charge()
    return nodeLaneCell(index, coordinate)
  }
  const outside = (index: NodeLaneIndex, cell: number): boolean => cell < 0 || cell + 1 >= index.offsets.length
  const pointIn = (box: RoutingBox, x: number, y: number): boolean => x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height
  const segmentIn = (box: RoutingBox, ax: number, ay: number, bx: number, by: number): boolean => ax === bx
    ? ax > box.x && ax < box.x + box.width && Math.max(ay, by) > box.y && Math.min(ay, by) < box.y + box.height
    : ay > box.y && ay < box.y + box.height && Math.max(ax, bx) > box.x && Math.min(ax, bx) < box.x + box.width
  const projectBox = (box: Readonly<RoutingBox>, horizontal: boolean, x: number, y: number, result: CompoundProjection): void => {
    charge(2)
    if (horizontal) {
      if (y > box.y && y < box.y + box.height) {
        if (box.x >= x) result.right = Math.min(result.right, box.x)
        if (box.x + box.width <= x) result.left = Math.max(result.left, box.x + box.width)
      }
    } else if (x > box.x && x < box.x + box.width) {
      if (box.y >= y) result.bottom = Math.min(result.bottom, box.y)
      if (box.y + box.height <= y) result.top = Math.max(result.top, box.y + box.height)
    }
  }
  const queries: CompoundObstacleQueries = {
    projectPoint(x, y, bounds, result) {
      charge(4)
      result.left = bounds.x; result.right = bounds.x + bounds.width
      result.top = bounds.y; result.bottom = bounds.y + bounds.height
      for (let axis = 0; axis < 2; axis++) {
        const horizontal = axis === 0, index = horizontal ? yIndex : xIndex
        const selected = cell(index, horizontal ? y : x)
        if (index && selected !== null) {
          if (outside(index, selected)) continue
          for (let cursor = index.offsets[selected]!; cursor < index.offsets[selected + 1]!; cursor++) {
            projectBox(boxes[index.ordinals[cursor]!]!, horizontal, x, y, result)
          }
        } else for (const box of boxes) projectBox(box, horizontal, x, y, result)
      }
    },
    containsPoint(x, y, beforeComparison) {
      const xc = cell(xIndex, x, beforeComparison), yc = cell(yIndex, y, beforeComparison)
      if (xIndex && xc !== null && outside(xIndex, xc) || yIndex && yc !== null && outside(yIndex, yc)) return false
      const nx = xIndex && xc !== null ? xIndex.offsets[xc + 1]! - xIndex.offsets[xc]! : Infinity
      const ny = yIndex && yc !== null ? yIndex.offsets[yc + 1]! - yIndex.offsets[yc]! : Infinity
      const index = nx <= ny ? xIndex : yIndex, selected = nx <= ny ? xc : yc
      if (index && selected !== null) {
        for (let cursor = index.offsets[selected]!; cursor < index.offsets[selected + 1]!; cursor++) {
          beforeComparison?.()
          charge()
          if (pointIn(boxes[index.ordinals[cursor]!]!, x, y)) return true
        }
      } else for (const box of boxes) { beforeComparison?.(); charge(); if (pointIn(box, x, y)) return true }
      return false
    },
    entersSegment(ax, ay, bx, by, beforeComparison) {
      const index = ax === bx ? xIndex : yIndex, selected = cell(index, ax === bx ? ax : ay, beforeComparison)
      if (index && selected !== null) {
        if (outside(index, selected)) return false
        for (let cursor = index.offsets[selected]!; cursor < index.offsets[selected + 1]!; cursor++) {
          beforeComparison?.()
          charge()
          if (segmentIn(boxes[index.ordinals[cursor]!]!, ax, ay, bx, by)) return true
        }
      } else for (const box of boxes) { beforeComparison?.(); charge(); if (segmentIn(box, ax, ay, bx, by)) return true }
      return false
    },
  }
  // One ownership entry plus the three original method references. Methods
  // remain mutable; changed providers simply lose this proof authority.
  chargeIndex(4, 'capacity')
  obstacleQueryOwners.set(queries, { boxes, containsPoint: queries.containsPoint, entersSegment: queries.entersSegment, projectPoint: queries.projectPoint })
  return queries
}


/** Frozen final peer shafts for one edge's sparse searches. Inclusive lane
 * membership only selects candidates; the original exact contact predicates
 * decide every rejection, including proper-crossing versus endpoint contact. */
export function createCompoundPeerGuard(
  peers: readonly (readonly [Point, Point])[], work: ChannelWork, fail: (reason: string) => never,
): (a: Point, b: Point, arrival: number, axis: number) => boolean {
  const charge = (amount = 1): void => {
    work.pairs -= amount
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
  }
  const blocked = (a: Point, b: Point, c: Point, d: Point, arrival: number, axis: number): boolean => {
    charge()
    if (arrival !== axis && pointOnMeasuredSegment(a, c, d)) return true
    const vertical = a.x === b.x, peerVertical = c.x === d.x
    if (vertical === peerVertical) {
      const separation = Math.abs(vertical ? a.x - c.x : a.y - c.y)
      const overlap = Math.min(vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x), vertical ? Math.max(c.y, d.y) : Math.max(c.x, d.x))
        - Math.max(vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), vertical ? Math.min(c.y, d.y) : Math.min(c.x, d.x))
      if (separation <= .5 && overlap > .01 || separation === 0 && overlap >= 0) return true
    } else {
      const x = vertical ? a.x : c.x, y = vertical ? c.y : a.y
      // Scalar form of the original point predicate, without query allocations.
      if ((a.x === b.x ? Math.abs(x - a.x) < 1e-7 : Math.abs(y - a.y) < 1e-7)
        && x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)
        && (c.x === d.x ? Math.abs(x - c.x) < 1e-7 : Math.abs(y - c.y) < 1e-7)
        && x >= Math.min(c.x, d.x) && x <= Math.max(c.x, d.x) && y >= Math.min(c.y, d.y) && y <= Math.max(c.y, d.y)
        && (x === c.x && y === c.y || x === d.x && y === d.y)) return true
    }
    return false
  }
  const linear = (a: Point, b: Point, arrival: number, axis: number): boolean => {
    for (const [c, d] of peers) if (blocked(a, b, c, d, arrival, axis)) return false
    return true
  }
  if (peers.length < 32) return linear
  for (const [c, d] of peers) {
    charge()
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(d.x) || !Number.isFinite(d.y)
      || c.x !== d.x && c.y !== d.y || !Number.isFinite(Math.abs(c.x - d.x)) || !Number.isFinite(Math.abs(c.y - d.y))) return linear
  }
  const capacity = (amount: number): void => {
    work.arcs -= amount
    if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
  }
  capacity(peers.length)
  const boxes = peers.map(([a, b]): RoutingBox => ({ x: Math.min(a.x, b.x) - .5, y: Math.min(a.y, b.y) - .5,
    width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 }))
  const reserveIndex = (amount: number, kind: 'capacity' | 'work'): void => kind === 'capacity' ? capacity(amount) : charge(amount)
  const xIndex = buildNodeLaneIndex(boxes, 'x', 0, reserveIndex), yIndex = buildNodeLaneIndex(boxes, 'y', 0, reserveIndex)
  return (a, b, arrival, axis) => {
    charge()
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)
      || a.x !== b.x && a.y !== b.y) return linear(a, b, arrival, axis)
    const index = a.x === b.x ? xIndex : yIndex
    if (!index) return linear(a, b, arrival, axis)
    const selected = nodeLaneCell(index, a.x === b.x ? a.x : a.y)
    if (selected === null) return linear(a, b, arrival, axis)
    if (selected < 0 || selected + 1 >= index.offsets.length) return true
    for (let cursor = index.offsets[selected]!; cursor < index.offsets[selected + 1]!; cursor++) {
      const [c, d] = peers[index.ordinals[cursor]!]!
      if (blocked(a, b, c, d, arrival, axis)) return false
    }
    return true
  }
}

/** Build exact queries for one immutable rectangle scope. */
export function createCompoundObstacleIndex(boxes: readonly Readonly<RoutingBox>[], work: ChannelWork, fail: (reason: string) => never): CompoundObstacleQueries {
  return createIndexView(boxes, work, fail)
}

/** Boundary-call only: immutable DATA reuse, never query or route-proof reuse.
 * Caller supplies exclusively owned numeric rectangles frozen for this call.
 * Old query views close their own arrays; publication never changes them. */
export function createOwnedCompoundObstacleIndexFactory(work: ChannelWork, fail: (reason: string) => never): (boxes: readonly Readonly<RoutingBox>[]) => CompoundObstacleQueries {
  // Reserve before creating the factory's closures/holder.
  work.arcs -= 8
  if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
  const charge = (amount: number): void => { work.pairs -= amount; if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit') }
  const reserve = (amount: number): void => { work.arcs -= amount; if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit') }
  // Factory closure, retained prior context and its accounting closures.
  let prior: { boxes: readonly Readonly<RoutingBox>[]; x: NodeLaneIndex | null; y: NodeLaneIndex | null } | undefined
  const originalCharge = (amount: number, kind: 'capacity' | 'work'): void => kind === 'capacity' ? reserve(amount) : charge(amount)
  return boxes => {
    // Pay before the axis closure, selected pair and context are allocated.
    reserve(7)
    const axis = (cross: 'x' | 'y'): NodeLaneIndex | null => {
      charge(3)
      const old = prior?.[cross]
      if (old && prior!.boxes.length === boxes.length) {
        let equal = true
        for (let ordinal = 0; ordinal < boxes.length; ordinal++) {
          // Exact original Float64 bounds/floors, including signed zero.
          // Two bound-computation blocks plus one equality block.
          charge(3)
          const a = prior!.boxes[ordinal]!, b = boxes[ordinal]!
          const alo = a[cross] - 0, ahi = a[cross] + (cross === 'x' ? a.width : a.height) + 0
          const blo = b[cross] - 0, bhi = b[cross] + (cross === 'x' ? b.width : b.height) + 0
          if (!Object.is(Math.floor(alo / 128), Math.floor(blo / 128)) || !Object.is(Math.floor(ahi / 128), Math.floor(bhi / 128))) { equal = false; break }
        }
        if (equal) return old
      }
      return buildNodeLaneIndex(boxes, cross, 0, originalCharge)
    }
    // One ephemeral axis closure, selected-index pair and prior context.
    // A failed second axis keeps all actual first-axis work/capacity spent.
    const x = axis('x'), y = axis('y')
    const selected = { x, y }
    const view = createIndexView(boxes, work, fail, selected)
    charge(1)
    prior = { boxes, x, y }
    return view
  }
}
