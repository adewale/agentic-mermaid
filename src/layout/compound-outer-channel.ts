import type { Point } from '../types.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { CompoundObstacleQueries } from './compound-obstacle-index.ts'
import { parallelStrokeClear, proposePortalChannel } from './compound-portal-channel.ts'
import type { RoutingBox, Terminal } from './compound-visibility.ts'

/** Complete unlabelled routes only. Eight perpendicular proposals first,
 * then at most eight same-normal exterior proposals using existing ports. No
 * Cartesian port roster or graph; current exact predicates remain authority. */
export function proposeOuterChannel(
  bounds: Readonly<RoutingBox>,
  boxes: readonly Readonly<RoutingBox>[],
  starts: readonly Terminal[],
  ends: readonly Terminal[],
  rails: readonly (readonly [Point, Point])[],
  queries: CompoundObstacleQueries,
  work: ChannelWork,
  reservePoints: (n: number) => void,
  fail: (reason: string) => never,
  guard: (a: Point, b: Point, arrival: number, axis: number) => boolean,
  accept: (path: Point[]) => Point[] | undefined,
  parallelStrokeUpperBound = 0.5,
): Point[] | undefined {
  // All helper closures/captures/scalar proposal metadata, before allocation.
  work.arcs -= 40 + rails.length + 3
  if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
  const charge = (n = 1): void => {
    work.pairs -= n
    if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
  }
  const reserve = (n: number): void => {
    work.arcs -= n
    if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
  }
  const coordinates = new Float64Array(rails.length + 2)
  const compare = (a: number, b: number): number => {
    if (--work.swaps < 0) fail('agentic local cross-hierarchy coordinate-sort limit')
    return a === b ? 0 : a - b
  }
  const widest = (lo: number, hi: number, vertical: boolean, spanLo: number, spanHi: number, transpose: boolean): number | undefined => {
    charge(coordinates.length)
    coordinates.fill(Infinity)
    let count = 2
    coordinates[0] = lo
    coordinates[1] = hi
    for (const [a, b] of rails) {
      charge(10)
      const ax = transpose ? a.y : a.x,
        ay = transpose ? a.x : a.y,
        bx = transpose ? b.y : b.x,
        by = transpose ? b.x : b.y,
        value = vertical ? ax : ay
      if ((vertical ? ax !== bx : ay !== by) || Math.max(vertical ? ay : ax, vertical ? by : bx) < spanLo - parallelStrokeUpperBound || Math.min(vertical ? ay : ax, vertical ? by : bx) > spanHi + parallelStrokeUpperBound || value <= lo || value >= hi) continue
      coordinates[count++] = value
    }
    coordinates.sort(compare)
    let best = -Infinity,
      result: number | undefined
    for (let i = 1; i < count; i++) {
      charge(5)
      const a = coordinates[i - 1]!,
        b = coordinates[i]!,
        width = b - a,
        mid = a + width / 2
      if (width > 2 * parallelStrokeUpperBound && width > best && mid > a && mid < b) {
        best = width
        result = mid
      }
    }
    return result
  }
  charge(2)
  if (!Number.isFinite(parallelStrokeUpperBound) || parallelStrokeUpperBound < 0.5) return
  // Actual bounds and inputs are internally owned finite numeric geometry.
  charge(8)
  const right = bounds.x + bounds.width,
    bottom = bounds.y + bounds.height
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(right) || !Number.isFinite(bottom) || right <= bounds.x || bottom <= bounds.y) return
  for (let proposal = 0; proposal < 8; proposal++) {
    // L/B, R/B, L/T, R/T, then their axis-transposed orientations.
    const transpose = proposal >= 4,
      corner = proposal % 4
    const xSign = corner % 2 === 0 ? -1 : 1,
      ySign = corner < 2 ? 1 : -1
    const xMin = transpose ? bounds.y : bounds.x,
      xMax = transpose ? bottom : right
    const yMin = transpose ? bounds.x : bounds.y,
      yMax = transpose ? right : bottom
    const outerX = xSign < 0 ? xMin : xMax,
      outerY = ySign < 0 ? yMin : yMax
    let source: Terminal | undefined, target: Terminal | undefined
    for (const candidate of starts) {
      charge(6)
      const dx = transpose ? candidate.stub.y - candidate.port.y : candidate.stub.x - candidate.port.x
      const dy = transpose ? candidate.stub.x - candidate.port.x : candidate.stub.y - candidate.port.y
      if (dy === 0 && Math.sign(dx) === xSign) {
        source = candidate
        break
      }
    }
    for (const candidate of ends) {
      charge(6)
      const dx = transpose ? candidate.stub.y - candidate.port.y : candidate.stub.x - candidate.port.x
      const dy = transpose ? candidate.stub.x - candidate.port.x : candidate.stub.y - candidate.port.y
      if (dx === 0 && Math.sign(dy) === ySign) {
        target = candidate
        break
      }
    }
    if (!source || !target) continue
    const sx = transpose ? source.port.y : source.port.x,
      sy = transpose ? source.port.x : source.port.y
    const sourceStubX = transpose ? source.stub.y : source.stub.x
    const tx = transpose ? target.port.y : target.port.x,
      ty = transpose ? target.port.x : target.port.y
    const targetStubY = transpose ? target.stub.x : target.stub.y
    charge(9)
    // Ordered upper/lower endpoint rule prevents the return leg crossing the
    // first horizontal leg; raw foreign contact checks precede all repair.
    if (ySign * (ty - sy) <= 0) {
      // This original slot had NO complete proposal: its outer return would
      // cross the first lead. A portal exit row may instead turn before that
      // return. These required normals are perpendicular, so this one target
      // can produce at most ONE complete path within the same eight slots.
      reserve(2) // one singleton array header + reference BEFORE allocation
      const result = proposePortalChannel(bounds, boxes, source, [target], rails, queries, work, reservePoints, fail, guard, accept, undefined, parallelStrokeUpperBound)
      if (result) return result
      continue
    }
    if (sx < xMin || sx > xMax || sy < yMin || sy > yMax || tx < xMin || tx > xMax || ty < yMin || ty > yMax) continue
    // Find the genuinely free exterior slab for the whole prospective vertical
    // run. Headers outside that run do not close a physically free channel.
    let wallX = xSign < 0 ? xMax : xMin
    const spanLowY = Math.min(sy, outerY),
      spanHighY = Math.max(sy, outerY)
    for (const box of boxes) {
      charge(12)
      const bx = transpose ? box.y : box.x,
        by = transpose ? box.x : box.y
      const bw = transpose ? box.height : box.width,
        bh = transpose ? box.width : box.height
      if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bx + bw) || !Number.isFinite(by + bh) || bw < 0 || bh < 0) return
      if (by >= spanHighY || by + bh <= spanLowY || bx > xMax || bx + bw < xMin) continue
      wallX = xSign < 0 ? Math.min(wallX, Math.max(xMin, bx)) : Math.max(wallX, Math.min(xMax, bx + bw))
    }
    charge(2)
    if (xSign * (outerX - wallX) <= 0) continue
    const channelX = widest(Math.min(outerX, wallX), Math.max(outerX, wallX), true, spanLowY, spanHighY, transpose)
    charge(3)
    if (channelX === undefined || xSign * (channelX - sourceStubX) < 0) continue
    // The horizontal channel clears every box across its actual X span, and
    // stays beyond the target's complete measured outward stub.
    let wallY = targetStubY
    const spanLowX = Math.min(channelX, tx),
      spanHighX = Math.max(channelX, tx)
    for (const box of boxes) {
      charge(10)
      const bx = transpose ? box.y : box.x,
        by = transpose ? box.x : box.y
      const bw = transpose ? box.height : box.width,
        bh = transpose ? box.width : box.height
      if (bx >= spanHighX || bx + bw <= spanLowX || by > yMax || by + bh < yMin) continue
      wallY = ySign < 0 ? Math.min(wallY, Math.max(yMin, by)) : Math.max(wallY, Math.min(yMax, by + bh))
    }
    charge(2)
    if (ySign * (outerY - wallY) <= 0) continue
    const channelY = widest(Math.min(outerY, wallY), Math.max(outerY, wallY), false, spanLowX, spanHighX, transpose)
    charge(3)
    if (channelY === undefined || ySign * (channelY - targetStubY) < 0) continue
    // 5 fresh Points + array header/slots, paid before constructing proposal.
    reservePoints(5)
    reserve(6)
    const path: Point[] = transpose
      ? [
          { x: sy, y: sx },
          { x: sy, y: channelX },
          { x: channelY, y: channelX },
          { x: channelY, y: tx },
          { x: ty, y: tx },
        ]
      : [
          { x: sx, y: sy },
          { x: channelX, y: sy },
          { x: channelX, y: channelY },
          { x: tx, y: channelY },
          { x: tx, y: ty },
        ]
    let clear = true,
      previousAxis = 0
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!
      if (queries.containsPoint(p.x, p.y)) {
        clear = false
        break
      }
      if (i === 0) continue
      const a = path[i - 1]!,
        axis = a.x === p.x ? 2 : 1
      charge(4)
      if ((a.x === p.x && a.y === p.y) || (a.x !== p.x && a.y !== p.y) || queries.entersSegment(a.x, a.y, p.x, p.y) || !guard(a, p, previousAxis || axis, axis) || ((i === 1 || i === path.length - 1) && !parallelStrokeClear(a, p, rails, parallelStrokeUpperBound, work, fail))) {
        clear = false
        break
      }
      previousAxis = axis
    }
    if (clear) {
      const result = accept(path)
      if (result) return result
    }
  }
  // The perpendicular roster cannot join two S (or two N/E/W) contacts.
  // Reuse the same-normal portal constructor, near endpoint first. Each of
  // four faces selects one existing source/target pair and at most two corners.
  // No terminal or graph is added; every complete path keeps the live proofs.
  reserve(12)
  for (let face = 0; face < 4; face++) {
    charge(12)
    const vertical = face < 2,
      sign = face % 2 === 0 ? -1 : 1
    let source: Terminal | undefined, target: Terminal | undefined
    for (const candidate of starts) {
      charge(6)
      const dx = candidate.stub.x - candidate.port.x,
        dy = candidate.stub.y - candidate.port.y
      if (vertical ? dx === 0 && Math.sign(dy) === sign : dy === 0 && Math.sign(dx) === sign) { source = candidate; break }
    }
    for (const candidate of ends) {
      charge(6)
      const dx = candidate.stub.x - candidate.port.x,
        dy = candidate.stub.y - candidate.port.y
      if (vertical ? dx === 0 && Math.sign(dy) === sign : dy === 0 && Math.sign(dx) === sign) { target = candidate; break }
    }
    if (!source || !target) continue
    const sourceMain = vertical ? source.port.y : source.port.x,
      targetMain = vertical ? target.port.y : target.port.x
    charge(4)
    if (sourceMain === targetMain) continue
    const reverse = sign * (targetMain - sourceMain) < 0
    reserve(2) // Singleton target header/reference, before allocation.
    const result = proposePortalChannel(bounds, boxes, reverse ? target : source, [reverse ? source : target], rails, queries, work, reservePoints, fail, guard, accept, undefined, parallelStrokeUpperBound, reverse)
    if (result) return result
  }
}
