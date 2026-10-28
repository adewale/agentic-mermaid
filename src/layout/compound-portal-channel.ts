import type { Point } from '../types.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { CompoundObstacleQueries } from './compound-obstacle-index.ts'
import type { RoutingBox, Terminal } from './compound-visibility.ts'
import { pointOnMeasuredSegment } from './measured-route-safety.ts'

/** Same-normal portal/leaf exit: one free inter-row band then an exterior
 * channel. At most four existing same-face targets, each left then right
 * in portal coordinates, then perpendicular exits with the UNUSED allowance:
 * at most eight complete proposals TOTAL.
 * The caller retains the painted label spine/reservation. An automatic
 * unauthored computed tail beyond that halo is not an authored waypoint requirement. */
export function proposePortalChannel(
  bounds: Readonly<RoutingBox>,
  boxes: readonly Readonly<RoutingBox>[],
  start: Readonly<Terminal>,
  targets: readonly Terminal[],
  rails: readonly (readonly [Point, Point])[],
  queries: CompoundObstacleQueries,
  work: ChannelWork,
  reservePoints: (amount: number) => void,
  fail: (reason: string) => never,
  guard: (a: Point, b: Point, arrival: number, axis: number) => boolean,
  accept: (path: Point[]) => Point[] | undefined,
  minimumLead?: number,
  parallelStrokeUpperBound = 0.5,
  reverseOutput = false,
): Point[] | undefined {
  // Closures/captures, typed header and its actual logical coordinate capacity.
  work.arcs -= 24 + rails.length + 2
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
  charge(18)
  const dx = start.stub.x - start.port.x,
    dy = start.stub.y - start.port.y
  if ((dx === 0) === (dy === 0)) return
  const transpose = dy === 0,
    sign = Math.sign(transpose ? dx : dy)
  const sx = transpose ? start.port.y : start.port.x,
    sy = transpose ? start.port.x : start.port.y
  const stubY = minimumLead === undefined ? (transpose ? start.stub.x : start.stub.y) : sy + sign * minimumLead
  const xMin = transpose ? bounds.y : bounds.x,
    xMax = xMin + (transpose ? bounds.height : bounds.width)
  const yMin = transpose ? bounds.x : bounds.y,
    yMax = yMin + (transpose ? bounds.width : bounds.height),
    outerY = sign < 0 ? yMin : yMax
  if (!Number.isFinite(parallelStrokeUpperBound) || parallelStrokeUpperBound < 0.5 || (minimumLead !== undefined && (!Number.isFinite(minimumLead) || minimumLead < 0))) return
  if (!Number.isFinite(xMin + xMax + yMin + yMax + sx + sy + stubY) || xMax <= xMin || yMax <= yMin || sx < xMin || sx > xMax || sy < yMin || sy > yMax || stubY < yMin || stubY > yMax) return
  // Scratch storage is reused only after each scalar result is consumed. No
  // route, guard, search state, certificate or result is cached in it.
  const widest = (lo: number, hi: number, vertical: boolean, spanLo: number, spanHi: number): number | undefined => {
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
        by = transpose ? b.x : b.y
      const value = vertical ? ax : ay
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
  let proposals = 0
  // Same-normal legacy candidates FIRST; perpendicular returns use only the
  // still-unused allowance. No extra terminal is created in either phase.
  for (let phase = 0; phase < 2; phase++) {
    if (proposals >= 8) return
    let matchingTargets = 0
    // Sparse terminal generation supplies at most4 existing samples per face.
    // Each complete return segment is proved at its chosen channel coordinate;
    // no artificial full-host ray condition is imposed.
    for (const target of targets) {
      charge(6)
      const normalX = transpose ? target.stub.y - target.port.y : target.stub.x - target.port.x
      const normalY = transpose ? target.stub.x - target.port.x : target.stub.y - target.port.y
      charge(4)
      const perpendicular = phase === 1
      if (perpendicular ? normalY !== 0 || normalX === 0 : normalX !== 0 || Math.sign(normalY) !== sign) continue
      if (++matchingTargets > 4) break
      const tx = transpose ? target.port.y : target.port.x,
        ty = transpose ? target.port.x : target.port.y,
        targetStubY = transpose ? target.stub.x : target.stub.y,
        targetStubX = transpose ? target.stub.y : target.stub.x
      charge(8)
      if (tx < xMin || tx > xMax || ty < yMin || ty > yMax || sign * (ty - sy) <= 0) continue
      // Two candidate superset leg spans, left then right. A free exit row
      // over [outer host edge, portal] also clears the eventual shorter H leg.
      for (let corner = 0; corner < 2; corner++) {
        const xSign = corner === 0 ? -1 : 1,
          outerX = xSign < 0 ? xMin : xMax
        charge()
        if (perpendicular && xSign !== Math.sign(normalX)) continue
        const exitLoX = Math.min(outerX, sx),
          exitHiX = Math.max(outerX, sx)
        let rowBegin = stubY,
          settled = false
        // Each strict advance reaches a distinct original interval endpoint.
        // Therefore at most boxes.length advances suffice; every comparison paid.
        for (let advance = 0; advance <= boxes.length; advance++) {
          let next = rowBegin
          for (const box of boxes) {
            charge(12)
            const bx = transpose ? box.y : box.x,
              by = transpose ? box.x : box.y,
              bw = transpose ? box.height : box.width,
              bh = transpose ? box.width : box.height
            if (!Number.isFinite(bx + by + bw + bh) || bw < 0 || bh < 0) return
            if (bx >= exitHiX || bx + bw <= exitLoX) continue
            if (sign > 0 && by <= rowBegin && by + bh > rowBegin) next = Math.max(next, by + bh)
            if (sign < 0 && by < rowBegin && by + bh >= rowBegin) next = Math.min(next, by)
          }
          charge(3)
          if (next === rowBegin) {
            settled = true
            break
          }
          rowBegin = next
          if (rowBegin < yMin || rowBegin > yMax) break
        }
        if (!settled) continue
        let nextWall = outerY
        for (const box of boxes) {
          charge(10)
          const bx = transpose ? box.y : box.x,
            by = transpose ? box.x : box.y,
            bw = transpose ? box.height : box.width,
            bh = transpose ? box.width : box.height
          if (bx >= exitHiX || bx + bw <= exitLoX) continue
          if (sign > 0 && by >= rowBegin) nextWall = Math.min(nextWall, by)
          if (sign < 0 && by + bh <= rowBegin) nextWall = Math.max(nextWall, by + bh)
        }
        const escapeY = widest(Math.min(rowBegin, nextWall), Math.max(rowBegin, nextWall), false, exitLoX, exitHiX)
        charge(4)
        if (escapeY === undefined || sign * (escapeY - stubY) <= 0 || sign * (ty - escapeY) <= 0) continue
        let wallX = xSign < 0 ? xMax : xMin
        const spanLoY = Math.min(escapeY, perpendicular ? ty : outerY),
          spanHiY = Math.max(escapeY, perpendicular ? ty : outerY)
        for (const box of boxes) {
          charge(10)
          const bx = transpose ? box.y : box.x,
            by = transpose ? box.x : box.y,
            bw = transpose ? box.height : box.width,
            bh = transpose ? box.width : box.height
          if (by >= spanHiY || by + bh <= spanLoY || bx > xMax || bx + bw < xMin) continue
          wallX = xSign < 0 ? Math.min(wallX, Math.max(xMin, bx)) : Math.max(wallX, Math.min(xMax, bx + bw))
        }
        charge(2)
        if (xSign * (outerX - wallX) <= 0) continue
        const channelX = widest(Math.max(Math.min(outerX, wallX), exitLoX), Math.min(Math.max(outerX, wallX), exitHiX), true, spanLoY, spanHiY)
        if (channelX === undefined || xSign * (channelX - sx) < 0) continue
        let path: Point[]
        if (perpendicular) {
          charge(4)
          if (xSign * (channelX - targetStubX) < 0) continue
          charge(2)
          if (proposals >= 8) return
          proposals++
          reservePoints(5)
          reserve(6)
          path = transpose
            ? [
                { x: sy, y: sx },
                { x: escapeY, y: sx },
                { x: escapeY, y: channelX },
                { x: ty, y: channelX },
                { x: ty, y: tx },
              ]
            : [
                { x: sx, y: sy },
                { x: sx, y: escapeY },
                { x: channelX, y: escapeY },
                { x: channelX, y: ty },
                { x: tx, y: ty },
              ]
        } else {
          const spanLoX = Math.min(channelX, tx),
            spanHiX = Math.max(channelX, tx)
          let wallY = targetStubY
          for (const box of boxes) {
            charge(10)
            const bx = transpose ? box.y : box.x,
              by = transpose ? box.x : box.y,
              bw = transpose ? box.height : box.width,
              bh = transpose ? box.width : box.height
            if (bx >= spanHiX || bx + bw <= spanLoX || by > yMax || by + bh < yMin) continue
            wallY = sign < 0 ? Math.min(wallY, Math.max(yMin, by)) : Math.max(wallY, Math.min(yMax, by + bh))
          }
          charge(2)
          if (sign * (outerY - wallY) <= 0) continue
          const channelY = widest(Math.min(outerY, wallY), Math.max(outerY, wallY), false, spanLoX, spanHiX)
          if (channelY === undefined) continue
          charge(2)
          if (proposals >= 8) return
          proposals++
          reservePoints(6)
          reserve(7)
          path = transpose
            ? [
                { x: sy, y: sx },
                { x: escapeY, y: sx },
                { x: escapeY, y: channelX },
                { x: channelY, y: channelX },
                { x: channelY, y: tx },
                { x: ty, y: tx },
              ]
            : [
                { x: sx, y: sy },
                { x: sx, y: escapeY },
                { x: channelX, y: escapeY },
                { x: channelX, y: channelY },
                { x: tx, y: channelY },
                { x: tx, y: ty },
              ]
        }
        // Constructor roles may be opposite to authored source/target order.
        // Restore that order BEFORE every live query, guard and final admission.
        charge()
        if (reverseOutput) {
          charge(2 * path.length)
          path.reverse()
        }
        let clear = true,
          last = 0
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
          if ((a.x === p.x && a.y === p.y) || (a.x !== p.x && a.y !== p.y) || queries.entersSegment(a.x, a.y, p.x, p.y) || !guard(a, p, last || axis, axis) || ((i === 1 || i === path.length - 1) && !parallelStrokeClear(a, p, rails, parallelStrokeUpperBound, work, fail))) {
            clear = false
            break
          }
          last = axis
        }
        if (clear) {
          const result = accept(path)
          if (result) return result
        }
      }
    }
  }
}

/** Retain the original source contact and shaft THROUGH the measured label
 * halo. Only its unauthored computed tail is omitted. An actual fixed leaf
 * source and a final label-bearing shaft are required. */
export function proposeRetainedLabelChannel(
  core: readonly Point[],
  sourceBox: Readonly<RoutingBox>,
  label: Readonly<Point>,
  ownLabel: Readonly<RoutingBox>,
  bounds: Readonly<RoutingBox>,
  boxes: readonly Readonly<RoutingBox>[],
  targets: readonly Terminal[],
  rails: readonly (readonly [Point, Point])[],
  queries: CompoundObstacleQueries,
  work: ChannelWork,
  clearance: number,
  parallelStrokeUpperBound: number,
  reservePoints: (amount: number) => void,
  fail: (reason: string) => never,
  guard: (a: Point, b: Point, arrival: number, axis: number) => boolean,
  accept: (path: Point[]) => Point[] | undefined,
): Point[] | undefined {
  work.arcs -= 24 + core.length + 1
  if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
  const charge = (n = 1): void => {
    work.pairs -= n
    if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
  }
  const reserve = (n: number): void => {
    work.arcs -= n
    if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
  }
  charge(12)
  if (core.length < 2 || !pointOnMeasuredSegment(label, core.at(-2)!, core.at(-1)!)) return
  const a = core.at(-2)!,
    oldEnd = core.at(-1)!,
    dx = oldEnd.x - a.x,
    dy = oldEnd.y - a.y
  if ((dx === 0) === (dy === 0)) return
  const portalX = dx > 0 ? ownLabel.x + ownLabel.width : dx < 0 ? ownLabel.x : oldEnd.x
  const portalY = dy > 0 ? ownLabel.y + ownLabel.height : dy < 0 ? ownLabel.y : oldEnd.y
  charge(8)
  if (portalX < Math.min(a.x, oldEnd.x) || portalX > Math.max(a.x, oldEnd.x) || portalY < Math.min(a.y, oldEnd.y) || portalY > Math.max(a.y, oldEnd.y)) return
  const first = core[0]!,
    next = core[1]!,
    fx = next.x - first.x,
    fy = next.y - first.y
  if ((fx === 0) === (fy === 0)) return
  // Exact measured face arithmetic, correcting only a preexisting sub-epsilon
  // roundoff in an automatically computed port. Authored IDs/slots stay fixed.
  const faceX = fx > 0 ? sourceBox.x + sourceBox.width : fx < 0 ? sourceBox.x : first.x
  const faceY = fy > 0 ? sourceBox.y + sourceBox.height : fy < 0 ? sourceBox.y : first.y
  charge(4)
  if (Math.abs(faceX - first.x) > 1e-7 || Math.abs(faceY - first.y) > 1e-7) return
  reservePoints(3)
  reserve(3)
  const prefix = core.slice(),
    port = { x: faceX, y: faceY },
    end = { x: portalX, y: portalY },
    stub = { x: portalX + Math.sign(dx) * clearance, y: portalY + Math.sign(dy) * clearance }
  prefix[0] = port
  prefix[prefix.length - 1] = end
  const terminal: Terminal = { port: end, stub, penalty: 0 }
  for (let i = 1; i < prefix.length; i++) {
    const p = prefix[i - 1]!,
      q = prefix[i]!
    charge(4)
    if (!Number.isFinite(p.x + p.y + q.x + q.y) || (p.x !== q.x && p.y !== q.y)) return
    if (!parallelStrokeClear(p, q, rails, parallelStrokeUpperBound, work, fail)) return
    for (const box of boxes) {
      charge(4)
      if (box === ownLabel && i === prefix.length - 1) continue // ONLY the retained label-bearing shaft
      const enters = p.x === q.x ? p.x > box.x && p.x < box.x + box.width && Math.max(p.y, q.y) > box.y && Math.min(p.y, q.y) < box.y + box.height : p.y > box.y && p.y < box.y + box.height && Math.max(p.x, q.x) > box.x && Math.min(p.x, q.x) < box.x + box.width
      if (enters) return
    }
  }
  return proposePortalChannel(
    bounds,
    boxes,
    terminal,
    targets,
    rails,
    queries,
    work,
    reservePoints,
    fail,
    guard,
    last => {
      reserve(prefix.length + last.length) // new array header + retained point references
      const complete = new Array<Point>(prefix.length + last.length - 1)
      for (let i = 0; i < prefix.length; i++) {
        charge()
        complete[i] = prefix[i]!
      }
      for (let i = 1; i < last.length; i++) {
        charge()
        complete[prefix.length + i - 1] = last[i]!
      }
      let previous = 0
      for (let i = 1; i < complete.length; i++) {
        const p = complete[i - 1]!,
          q = complete[i]!,
          axis = p.x === q.x ? 2 : 1
        charge(4)
        if (!guard(p, q, previous || axis, axis)) return
        previous = axis
      }
      return accept(complete)
    },
    0,
    parallelStrokeUpperBound,
  )
}

/** Conservative parallel shaft/cap envelopes. Proper perpendicular crossings
 * remain under the original exact guard and metric. No result is memoized. */
export function parallelStrokeClear(a: Point, b: Point, rails: readonly (readonly [Point, Point])[], width: number, work: ChannelWork, fail: (reason: string) => never): boolean {
  const vertical = a.x === b.x
  for (const [c, d] of rails) {
    work.pairs -= 3
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
    if (vertical !== (c.x === d.x)) continue
    work.pairs -= 4
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
    const separation = Math.abs(vertical ? a.x - c.x : a.y - c.y)
    if (separation > width) continue
    work.pairs -= 12
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
    const overlap = Math.min(vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x), vertical ? Math.max(c.y, d.y) : Math.max(c.x, d.x)) - Math.max(vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), vertical ? Math.min(c.y, d.y) : Math.min(c.x, d.x))
    if (overlap >= -width) return false
  }
  return true
}

/** Caller-owned path only, AFTER every raw foreign-contact check. Removing
 * a monotone collinear subdivision preserves its exact Float64 ink set. */
export function compactProvedPath(path: Point[], work: ChannelWork, fail: (reason: string) => never): Point[] {
  let used = 0
  for (let read = 0; read < path.length; read++) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
    const p = path[read]!
    path[used++] = p
    while (used >= 3) {
      work.pairs -= 12
      if (work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
      const a = path[used - 3]!,
        b = path[used - 2]!,
        c = path[used - 1]!
      if (!((a.x === b.x && b.x === c.x && b.y >= Math.min(a.y, c.y) && b.y <= Math.max(a.y, c.y)) || (a.y === b.y && b.y === c.y && b.x >= Math.min(a.x, c.x) && b.x <= Math.max(a.x, c.x)))) break
      path[used - 2] = c
      used--
    }
  }
  if (--work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
  path.length = used
  return path
}
