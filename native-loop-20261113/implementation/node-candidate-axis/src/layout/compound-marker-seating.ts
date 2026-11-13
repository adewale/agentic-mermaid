import type { ClassMarkerPiece } from '../class/relationship-paint.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import type { Point } from '../types.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { RoutingBox } from './compound-visibility.ts'
import { classMarkerPiecesOverlap } from './measured-marker-overlap.ts'
import { pointOnMeasuredSegment, writtenCoordinateGapLessThan, type MeasuredSharpContactWitness } from './measured-route-safety.ts'
export type MarkerPaint = { start?: readonly ClassMarkerPiece[]; end?: readonly ClassMarkerPiece[] }
/** Internal canonical producer templates; sanity checks do not establish a general arbitrary-polygon language. */
export function assertMarkerPaint(value: MarkerPaint): void {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid measured marker paint')
  for (const pieces of [value.start, value.end]) {
    if (pieces === undefined) continue
    if (!Array.isArray(pieces) || pieces.length > 64) throw new TypeError('Invalid measured marker pieces')
    for (const piece of pieces) {
      if (piece.kind === 'circle') {
        if (![piece.cx, piece.cy, piece.r].every(value => Number.isFinite(value * value * 16)) || !(piece.r > 0)) throw new TypeError('Invalid measured marker circle')
      } else if (piece.kind === 'polygon') {
        if (!Array.isArray(piece.points) || piece.points.length < 3 || piece.points.length > 32) throw new TypeError('Invalid measured marker polygon')
        for (const point of piece.points) if (!Number.isFinite(point.x * point.x * 16) || !Number.isFinite(point.y * point.y * 16)) throw new TypeError('Invalid measured marker coordinate')
        let sign = 0
        for (let i = 0; i < piece.points.length; i++) {
          const a = piece.points[i]!,
            b = piece.points[(i + 1) % piece.points.length]!,
            c = piece.points[(i + 2) % piece.points.length]!
          const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
          if (!Number.isFinite(cross) || (cross && sign && Math.sign(cross) !== sign)) throw new TypeError('Nonconvex measured marker polygon')
          if (cross) sign = Math.sign(cross)
        }
        if (!sign) throw new TypeError('Empty measured marker polygon')
      } else throw new TypeError('Invalid measured marker kind')
    }
  }
}
/** Conservative continuous support, with exact canonical written coordinates.
 * Perpendicular proper crossings and zero-measure parallel contacts are not
 * positive shared ink. Scope: uniform actual Class shaft width. */
export function writtenParallelSupportsOverlap(a: Point, b: Point, c: Point, d: Point, width: number, writtenWidth: number, charge: (n?: number) => void, reserve: (n: number) => void): boolean {
  charge()
  const vertical = a.x === b.x
  if ((c.x === d.x) !== vertical) return false
  charge(2)
  const fixed = vertical ? a.x : a.y,
    otherFixed = vertical ? c.x : c.y,
    error = (Math.abs(fixed) + Math.abs(otherFixed) + Math.abs(width)) * 1e-10 + 1e-9
  if (Math.abs(fixed - otherFixed) > width + error) return false
  charge(2)
  const lo = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x),
    hi = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x),
    low = Math.min(vertical ? c.y : c.x, vertical ? d.y : d.x),
    high = Math.max(vertical ? c.y : c.x, vertical ? d.y : d.x),
    spanError = (Math.abs(lo) + Math.abs(hi) + Math.abs(low) + Math.abs(high)) * 1e-10 + 1e-9
  if (Math.min(hi, high) < Math.max(lo, low) - spanError) return false
  // Three bounded canonical spellings plus the shared exact helper's bounded
  // parse/regex/closure headers AND fifteen regex capture slots are prepaid.
  // No uncharged temporary-reference reuse is assumed on the exact path.
  reserve(42)
  charge(384)
  const gap = writtenCoordinateGapLessThan(formatSvgNumber(fixed), formatSvgNumber(otherFixed), formatSvgNumber(writtenWidth), charge)
  // A non-throwing exhausted caller has no clear proof. Normal seating charges
  // throw the original work error; neither path can turn uncertainty into clear.
  if (gap !== true) return gap === undefined
  reserve(20)
  charge(512)
  const A = Number(formatSvgNumber(vertical ? a.y : a.x)),
    B = Number(formatSvgNumber(vertical ? b.y : b.x)),
    C = Number(formatSvgNumber(vertical ? c.y : c.x)),
    D = Number(formatSvgNumber(vertical ? d.y : d.x))
  return Math.min(Math.max(A, B), Math.max(C, D)) > Math.max(Math.min(A, B), Math.min(C, D))
}

type Pose = { owner: number; source: boolean; pieces: ClassMarkerPiece[]; minX: number; maxX: number; minY: number; maxY: number }
type Route = { points: Point[]; labelPosition?: Point }
/** All routes are final and all query leases ended before entry. Earlier marker
 * reservations are immutable. Reseating changes only an owned path's endpoint
 * and first bend, then submits the COMPLETE path to the original full proof. */
export function seatMeasuredMarkers(
  edges: readonly { source: number; target: number; visible?: boolean; label?: { width: number; height: number }; markerPaint?: MarkerPaint }[],
  routes: Route[],
  subjects: readonly RoutingBox[],
  work: ChannelWork,
  reservePoints: (amount: number) => void,
  fail: (reason: string) => never,
  accept: (index: number, points: Point[]) => boolean,
  changed: (index: number) => void,
  paintClear?: (index: number, source: boolean, pieces: readonly ClassMarkerPiece[], bounds: Readonly<Omit<Pose, 'pieces'>>) => boolean,
  carrierWidth?: number,
  carrierBendRadius = 0,
  ink?: { bounds: RoutingBox; obstacles: readonly RoutingBox[] },
  inspectContact?: (index: number, witness: MeasuredSharpContactWitness) => boolean,
): void {
  work.arcs -= 18
  if (work.arcs < 0) fail('agentic marker seating capacity limit')
  const charge = (amount = 1) => {
    work.pairs -= amount
    if (work.pairs < 0) fail('agentic marker seating work limit')
  }
  const records = (amount: number) => {
    work.arcs -= amount
    if (work.arcs < 0) fail('agentic marker seating capacity limit')
  }
  // Owner/callback/list/interval descriptors were paid before closure creation.
  const seated: Pose[] = []
  let markerCount = 0
  for (const edge of edges) {
    charge()
    if (edge.visible !== false) markerCount += Number(!!edge.markerPaint?.start?.length) + Number(!!edge.markerPaint?.end?.length)
  }
  let segmentCount = 0, straightCount = 0
  if (carrierWidth !== undefined) {
    if (!Number.isFinite(carrierWidth) || carrierWidth <= 0 || !Number.isFinite(carrierBendRadius) || carrierBendRadius < 0) throw new TypeError('Invalid measured marker carrier width')
    for (let i = 0; i < routes.length; i++) {
      charge()
      if (edges[i]!.visible === false) continue
      const path = routes[i]!.points
      charge(2)
      if (path.length === 2) straightCount++
      segmentCount += Math.max(0, path.length - 1)
      for (let j = 1; j + 1 < path.length; j++) {
        charge(4)
        const a = path[j - 1]!,
          b = path[j]!,
          c = path[j + 1]!
        if ((a.x === b.x) !== (b.x === c.x)) segmentCount++
      }
    }
  }
  const eventCapacity = 4 * (markerCount + segmentCount + 4 * straightCount + (ink?.obstacles.length ?? 0)) + 8
  records(eventCapacity)
  charge(eventCapacity)
  const cuts = new Float64Array(eventCapacity)
  type Carrier = { current: boolean; a: Point; b: Point; point: number; join: boolean; minX: number; maxX: number; minY: number; maxY: number }
  type Range = { begin: number; end: number; minX: number; maxX: number; minY: number; maxY: number }
  records(2 * segmentCount + 2 * routes.length + 9)
  reservePoints(4)
  const carriers: Carrier[] = [],
    ranges: Range[] = [],
    rectangle = [
      {
        kind: 'polygon' as const,
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    ]
  const half = (carrierWidth ?? 0) / 2
  const updateCarrier = (record: Carrier, a: Point, b: Point): void => {
    charge(13)
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y) || (a.x !== b.x && a.y !== b.y)) fail('Unsupported measured marker carrier')
    record.a = a
    record.b = b
    const margin = half + (record.join ? carrierBendRadius : 0)
    record.minX = Math.min(a.x, b.x) - margin
    record.maxX = Math.max(a.x, b.x) + margin
    record.minY = Math.min(a.y, b.y) - margin
    record.maxY = Math.max(a.y, b.y) + margin
  }
  const refresh = (index: number): void => {
    const range = ranges[index]!,
      path = routes[index]!.points
    range.minX = range.minY = Infinity
    range.maxX = range.maxY = -Infinity
    charge(4)
    for (let cursor = range.begin; cursor < range.end; cursor++) {
      const record = carriers[cursor]!
      updateCarrier(record, path[record.point]!, record.join ? path[record.point]! : path[record.point + 1]!)
      charge(4)
      range.minX = Math.min(range.minX, record.minX)
      range.maxX = Math.max(range.maxX, record.maxX)
      range.minY = Math.min(range.minY, record.minY)
      range.maxY = Math.max(range.maxY, record.maxY)
    }
  }
  for (let i = 0; i < routes.length; i++) {
    charge()
    const begin = carriers.length
    if (carrierWidth !== undefined && edges[i]!.visible !== false)
      for (let j = 1; j < routes[i]!.points.length; j++) {
        charge()
        carriers.push({ current: true, a: routes[i]!.points[j - 1]!, b: routes[i]!.points[j]!, point: j - 1, join: false, minX: 0, maxX: 0, minY: 0, maxY: 0 })
      }
    if (carrierWidth !== undefined && edges[i]!.visible !== false)
      for (let j = 1; j + 1 < routes[i]!.points.length; j++) {
        charge(4)
        const a = routes[i]!.points[j - 1]!,
          b = routes[i]!.points[j]!,
          c = routes[i]!.points[j + 1]!
        if ((a.x === b.x) !== (b.x === c.x)) carriers.push({ current: true, a: b, b, point: j, join: true, minX: 0, maxX: 0, minY: 0, maxY: 0 })
      }
    ranges.push({ begin, end: carriers.length, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
    refresh(i)
  }
  // A straight carrier can acquire two paid bends. Keep old physical records
  // retained, but only its current range participates in any later proof.
  records(1)
  const growStraightRange = (index: number, candidate: Point[]): void => {
    const old = ranges[index]!, begin = carriers.length
    records(10) // three segment records, two joins and their five retained refs
    for (let j = 0; j < 3; j++) {
      charge()
      carriers.push({ current: true, a: candidate[j]!, b: candidate[j+1]!, point: j, join: false, minX:0,maxX:0,minY:0,maxY:0 })
    }
    for (let j = 1; j < 3; j++) {
      charge()
      carriers.push({ current: true, a: candidate[j]!, b: candidate[j]!, point: j, join: true, minX:0,maxX:0,minY:0,maxY:0 })
    }
    for (let cursor=old.begin;cursor<old.end;cursor++){charge();carriers[cursor]!.current=false}
    old.begin=begin;old.end=carriers.length
  }
  const intersects = (shape: Pose, box: { minX: number; maxX: number; minY: number; maxY: number }): boolean => {
    charge(5)
    return shape.maxX > box.minX && shape.minX < box.maxX && shape.maxY > box.minY && shape.minY < box.maxY
  }
  const hits = (shape: Pose, carrier: Carrier): boolean => {
    if (!intersects(shape, carrier)) return false
    const a = carrier.a,
      b = carrier.b,
      p = rectangle[0]!.points
    charge(8)
    if (carrier.join) {
      p[0]!.x = carrier.minX
      p[0]!.y = carrier.minY
      p[1]!.x = carrier.maxX
      p[1]!.y = carrier.minY
      p[2]!.x = carrier.maxX
      p[2]!.y = carrier.maxY
      p[3]!.x = carrier.minX
      p[3]!.y = carrier.maxY
    } else if (a.x === b.x) {
      p[0]!.x = carrier.minX
      p[0]!.y = Math.min(a.y, b.y)
      p[1]!.x = carrier.maxX
      p[1]!.y = p[0]!.y
      p[2]!.x = carrier.maxX
      p[2]!.y = Math.max(a.y, b.y)
      p[3]!.x = carrier.minX
      p[3]!.y = p[2]!.y
    } else {
      p[0]!.x = Math.min(a.x, b.x)
      p[0]!.y = carrier.minY
      p[1]!.x = Math.max(a.x, b.x)
      p[1]!.y = carrier.minY
      p[2]!.x = p[1]!.x
      p[2]!.y = carrier.maxY
      p[3]!.x = p[0]!.x
      p[3]!.y = carrier.maxY
    }
    return classMarkerPiecesOverlap(shape.pieces, rectangle, charge)
  }
  // Serialization is narrowed only after a conservative raw-distance/span
  // rejection. The canonical formatter decides strict written-width overlap,
  // preserving zero-measure contacts and proper perpendicular crossings.
  let coordinateBound = 1
  for (const range of ranges) {
    charge(4)
    if (range.begin < range.end) coordinateBound = Math.max(coordinateBound, Math.abs(range.minX), Math.abs(range.maxX), Math.abs(range.minY), Math.abs(range.maxY))
  }
  for (const box of subjects) {
    charge(4)
    coordinateBound = Math.max(coordinateBound, Math.abs(box.x), Math.abs(box.y), Math.abs(box.x + box.width), Math.abs(box.y + box.height))
  }
  if (ink) {
    charge(4)
    coordinateBound = Math.max(coordinateBound, Math.abs(ink.bounds.x), Math.abs(ink.bounds.y), Math.abs(ink.bounds.x + ink.bounds.width), Math.abs(ink.bounds.y + ink.bounds.height))
  }
  // Every proposed coordinate is within an original coordinate/subject face or
  // this declared canvas interval. This deliberately loose12-significant-digit
  // bound is BROAD PHASE ONLY; canonical spellings decide any retained pair.
  const queryRoundingBound = (coordinateBound + Math.abs(carrierWidth ?? 0)) * 1e-10 + 1e-9
  const written = (value: number): number => {
    records(5)
    charge(128)
    return Number(formatSvgNumber(value))
  }
  const writtenWidth = carrierWidth === undefined ? 0 : written(carrierWidth)
  const parallelClear = (owner: number, segment: Carrier): boolean => {
    if (carrierWidth === undefined || segment.join) return true
    const a = segment.a,
      b = segment.b,
      vertical = a.x === b.x,
      fixed = vertical ? a.x : a.y,
      lo = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x),
      hi = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x)
    for (let other = 0; other < ranges.length; other++) {
      charge()
      if (other === owner) continue
      const range = ranges[other]!
      charge(5)
      if (segment.maxX < range.minX - queryRoundingBound || segment.minX > range.maxX + queryRoundingBound || segment.maxY < range.minY - queryRoundingBound || segment.minY > range.maxY + queryRoundingBound) continue
      for (let k = range.begin; k < range.end; k++) {
        charge()
        const peer = carriers[k]!
        if (peer.join) continue
        if (writtenParallelSupportsOverlap(a, b, peer.a, peer.b, carrierWidth, writtenWidth, charge, records)) return false
      }
    }
    return true
  }
  // Synchronous scratch is owned by this seating phase. No old query lease
  // survives, and every accepted route refreshes its borrowed current records.
  const changedCarrier: Carrier = { current: true, a: undefined as unknown as Point, b: undefined as unknown as Point, point: 0, join: false, minX: 0, maxX: 0, minY: 0, maxY: 0 }

  const pose = (template: readonly ClassMarkerPiece[], port: Point, next: Point, owner: number, source: boolean): Pose => {
    charge(10)
    if (!Number.isFinite(port.x) || !Number.isFinite(port.y) || !Number.isFinite(next.x) || !Number.isFinite(next.y)) fail('Nonfinite measured marker normal')
    const dx = Math.sign(next.x - port.x),
      dy = Math.sign(next.y - port.y)
    if (Number(!dx) + Number(!dy) !== 1) fail('Nonorthogonal measured marker normal')
    let points = 0
    for (const piece of template) {
      charge()
      if (piece.kind === 'polygon') points += piece.points.length
    }
    records(2 + 2 * template.length + points)
    reservePoints(points)
    const result: Pose = { owner, source, pieces: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    for (const piece of template) {
      charge()
      if (piece.kind === 'circle') {
        const cx = port.x + dx * piece.cx - dy * piece.cy,
          cy = port.y + dy * piece.cx + dx * piece.cy
        result.pieces.push({ kind: 'circle', cx, cy, r: piece.r })
        result.minX = Math.min(result.minX, cx - piece.r)
        result.maxX = Math.max(result.maxX, cx + piece.r)
        result.minY = Math.min(result.minY, cy - piece.r)
        result.maxY = Math.max(result.maxY, cy + piece.r)
      } else {
        const polygon: Extract<ClassMarkerPiece, { kind: 'polygon' }> = { kind: 'polygon', points: [] }
        for (const p of piece.points) {
          charge()
          const x = port.x + dx * p.x - dy * p.y,
            y = port.y + dy * p.x + dx * p.y
          polygon.points.push({ x, y })
          result.minX = Math.min(result.minX, x)
          result.maxX = Math.max(result.maxX, x)
          result.minY = Math.min(result.minY, y)
          result.maxY = Math.max(result.maxY, y)
        }
        result.pieces.push(polygon)
      }
    }
    return result
  }
  records(markerCount + 1)
  const all: Pose[] = []
  for (let i = 0; i < edges.length; i++) {
    charge()
    if (edges[i]!.visible === false) continue
    for (let role = 0; role < 2; role++) {
      charge()
      const template = role === 0 ? edges[i]!.markerPaint?.start : edges[i]!.markerPaint?.end
      if (!template?.length) continue
      const path = routes[i]!.points,
        source = role === 0
      all.push(pose(template, source ? path[0]! : path.at(-1)!, source ? path[1]! : path.at(-2)!, i, source))
    }
  }
  const clear = (candidate: Pose, index: number, source: boolean): boolean => {
    if (paintClear && !paintClear(index, source, candidate.pieces, candidate)) return false
    if (carrierWidth !== undefined)
      for (let other = 0; other < ranges.length; other++) {
        charge()
        const range = ranges[other]!
        if (!intersects(candidate, range)) continue
        for (let k = range.begin; k < range.end; k++) {
          charge()
          const piece = carriers[k]!
          // An endpoint marker deliberately masks its first/last connected
          // carrier plus that incident bend. Other ink, even on the same route,
          // is not granted an ownership exemption.
          if (other === index && (piece.join ? piece.point === (source ? 1 : routes[index]!.points.length - 2) : source ? piece.point <= 1 : piece.point >= routes[index]!.points.length - 3)) continue
          if (hits(candidate, piece)) return false
        }
      }
    for (const peer of seated) {
      charge(5)
      if (candidate.maxX <= peer.minX || candidate.minX >= peer.maxX || candidate.maxY <= peer.minY || candidate.minY >= peer.maxY) continue
      if (classMarkerPiecesOverlap(candidate.pieces, peer.pieces, charge)) return false
    }
    return true
  }
  let proposals = 0
  records(3 * edges.length + 2)
  charge(3 * edges.length)
  const spent = new Uint8Array(3 * edges.length)
  const yieldTrack = (index: number, source: boolean, current: Pose | undefined, vertical: boolean, rescue: number, obstacleInput: { bounds: RoutingBox; obstacles: readonly RoutingBox[] }, contactOwner = -1, contact?: MeasuredSharpContactWitness, repairRoute = -1): boolean => {
    let yielded = false
          for (let other = 0; other < ranges.length && !yielded && proposals < 8; other++) {
            charge()
            if (contact ? other !== repairRoute : rescue === 0 && other === index) continue
            const range = ranges[other]!,
              foreign = routes[other]!.points
            for (let k = range.begin; k < range.end && !yielded && proposals < 8; k++) {
              charge(8)
              const blocker = carriers[k]!,
                j = blocker.point
              if (blocker.join || j < 1 || j + 2 >= foreign.length) continue
              const a = foreign[j]!,
                b = foreign[j + 1]!,
                before = foreign[j - 1]!,
                after = foreign[j + 2]!,
                horizontal = a.y === b.y
              let collision = false
              if (contact) {
                charge(5)
                const segment = other === contactOwner ? contact.candidateSegment : contact.peerSegment
                // Incoming segment i ends at point[i]. The three changed
                // strips cover i=j..j+2, including both moved corner joins.
                collision = segment >= j && segment <= j + 2
              } else {
              if (horizontal !== vertical) continue
              // Moving an internal run changes both neighboring legs and its
              // two corner joins. Require an ACTUAL non-exempt collision in
              // that exact support, including on the current route itself.
              charge(4)
              const own = other === index, incident = own && (source ? j <= 1 : j >= foreign.length - 3)
              collision = !incident && hits(current!, blocker)
              if (rescue === 0 && !collision) continue
              // Current ranges store every strip in point order, followed by
              // the existing joins in strictly increasing point order. Borrow
              // the two adjacent strips directly; do not rescan unrelated ink.
              for (let side = 0; side < 2 && !collision; side++) {
                charge(8)
                const support = carriers[range.begin + j + (side === 0 ? -1 : 1)]!
                if (own && (source ? support.point <= 1 : support.point >= foreign.length - 3)) continue
                if (hits(current!, support)) collision = true
              }
              if (!collision) {
                charge(3)
                let lo = range.begin + foreign.length - 1,
                  hi = range.end
                // Missing collinear joins remain missing. Lower-bound lookup
                // preserves the original j-then-j+1 join visitation order.
                while (lo < hi) {
                  charge(3)
                  const mid = lo + Math.floor((hi - lo) / 2)
                  if (carriers[mid]!.point < j) lo = mid + 1
                  else hi = mid
                }
                for (let cursor = lo; cursor < range.end && !collision; cursor++) {
                  charge(8)
                  const support = carriers[cursor]!
                  if (support.point > j + 1) break
                  if (own && support.point === (source ? 1 : foreign.length - 2)) continue
                  if (hits(current!, support)) collision = true
                }
              }
              }
              if (!collision) continue
              // An actual glyph collision or exact failed contact selects this
              // support. Free events only propose coordinates; full proofs decide.
              const spanLow = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
                spanHigh = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
              // Partial face coverage is not infeasibility; the existing paid
              // internal-track constructor also serves the exact contact witness.
              if (horizontal ? before.x !== a.x || after.x !== b.x : before.y !== a.y || after.y !== b.y) continue
              const labelSize = edges[other]!.label,
                label = labelSize ? routes[other]!.labelPosition : undefined
              // A translated labelled run would lose its fixed caption spine.
              // An adjacent leg may change length only beyond the COMPLETE
              // occupied caption interval; its line and label center stay fixed.
              let priorCaption = false,
                nextCaption = false
              if (label && rescue === 0) {
                let protectedSpine = false
                for (let q = j - 1; q <= j + 1; q++) {
                  charge(6)
                  if (pointOnMeasuredSegment(label, foreign[q]!, foreign[q + 1]!)) {
                    protectedSpine = true
                    break
                  }
                }
                if (protectedSpine) continue
              } else if (label) {
                charge(18)
                if (pointOnMeasuredSegment(label, a, b)) continue
                priorCaption = pointOnMeasuredSegment(label, before, a)
                nextCaption = pointOnMeasuredSegment(label, b, after)
              }
              const oldFixed = horizontal ? a.y : a.x,
                prior = horizontal ? before.y : before.x,
                next = horizontal ? after.y : after.x
              let lower = horizontal ? obstacleInput.bounds.y : obstacleInput.bounds.x,
                upper = lower + (horizontal ? obstacleInput.bounds.height : obstacleInput.bounds.width)
              if (oldFixed === prior || oldFixed === next) continue
              if (oldFixed > prior) lower = Math.max(lower, prior)
              else upper = Math.min(upper, prior)
              if (oldFixed > next) lower = Math.max(lower, next)
              else upper = Math.min(upper, next)
              if (label && labelSize && (priorCaption || nextCaption)) {
                charge()
                // Raw interval containment proves a painted straight spine
                // only for sharp carriers. Rounded adjacent captions retain
                // the original conservative veto until curve erosion is owned.
                if (carrierBendRadius !== 0) continue
                charge(6)
                const center = horizontal ? label.y : label.x,
                  occupiedHalf = (horizontal ? labelSize.height : labelSize.width) / 2 + 2 + half,
                  captionLow = center - occupiedHalf,
                  captionHigh = center + occupiedHalf
                let protectedSpine = false
                for (let side = 0; side < 2; side++) {
                  charge(12)
                  if (side === 0 ? !priorCaption : !nextCaption) continue
                  const fixed = side === 0 ? prior : next
                  if (captionLow < Math.min(fixed, oldFixed) || captionHigh > Math.max(fixed, oldFixed)) {
                    protectedSpine = true
                    break
                  }
                  if (fixed <= captionLow) lower = Math.max(lower, captionHigh)
                  else if (fixed >= captionHigh) upper = Math.min(upper, captionLow)
                  else {
                    protectedSpine = true
                    break
                  }
                }
                if (protectedSpine) continue
              }
              if (!(lower < upper)) continue
              let eventCount = 2
              cuts[0] = lower
              cuts[1] = 0
              cuts[2] = upper
              cuts[3] = 0
              records(1)
              const emit = (lo: number, hi: number): void => {
                charge(2)
                lo = Math.max(lower, lo)
                hi = Math.min(upper, hi)
                if (lo < hi) {
                  cuts[2 * eventCount] = lo
                  cuts[2 * eventCount + 1] = 1
                  eventCount++
                  cuts[2 * eventCount] = hi
                  cuts[2 * eventCount + 1] = -1
                  eventCount++
                }
              }
              if (contact) {
                charge(12)
                const peerIndex = other === contactOwner ? contact.peerIndex : contactOwner,
                  peerSegment = other === contactOwner ? contact.peerSegment : contact.candidateSegment,
                  peer = carriers[ranges[peerIndex]!.begin + peerSegment - 1]!
                // This is a wall for choosing a proposal, not a contact proof.
                // Its inflated incoming strip also contains its miter corner.
                emit((horizontal ? peer.minY : peer.minX) - half - 0.01, (horizontal ? peer.maxY : peer.maxX) + half + 0.01)
              }
              for (const box of obstacleInput.obstacles) {
                charge(5)
                if (horizontal ? box.x + box.width + half < spanLow || box.x - half > spanHigh : box.y + box.height + half < spanLow || box.y - half > spanHigh) continue
                emit((horizontal ? box.y : box.x) - half, (horizontal ? box.y + box.height : box.x + box.width) + half)
              }
              for (const glyph of all) {
                charge(5)
                if (horizontal ? glyph.maxX + half < spanLow || glyph.minX - half > spanHigh : glyph.maxY + half < spanLow || glyph.minY - half > spanHigh) continue
                emit((horizontal ? glyph.minY : glyph.minX) - half - 0.01, (horizontal ? glyph.maxY : glyph.maxX) + half + 0.01)
              }
              for (let c = 0; c < carriers.length; c++) {
                charge(5)
                const peer = carriers[c]!
                if (!peer.current || c === k || peer.join || (peer.a.y === peer.b.y) !== horizontal) continue
                if (horizontal ? peer.maxX < spanLow || peer.minX > spanHigh : peer.maxY < spanLow || peer.minY > spanHigh) continue
                emit((horizontal ? peer.minY : peer.minX) - half - 0.01, (horizontal ? peer.maxY : peer.maxX) + half + 0.01)
              }
              for (let e = 1; e < eventCount; e++) {
                const v = cuts[2 * e]!,
                  d = cuts[2 * e + 1]!
                let q = e
                while (q > 0) {
                  charge()
                  if (cuts[2 * (q - 1)]! <= v) break
                  cuts[2 * q] = cuts[2 * (q - 1)]!
                  cuts[2 * q + 1] = cuts[2 * (q - 1) + 1]!
                  q--
                }
                cuts[2 * q] = v
                cuts[2 * q + 1] = d
              }
              let previousDistance = -1,
                previousEvent = -1
              for (let choice = 0; choice < 8 && proposals < 8; choice++) {
                let active = 0,
                  event = -1,
                  distance = Infinity,
                  value = 0
                for (let e = 1; e < eventCount; e++) {
                  charge(3)
                  active += cuts[2 * (e - 1) + 1]!
                  const lo = cuts[2 * (e - 1)]!,
                    hi = cuts[2 * e]!,
                    mid = lo + (hi - lo) / 2,
                    d = Math.abs(mid - oldFixed)
                  if (active !== 0 || !(lo < hi) || mid === oldFixed || d < previousDistance || (d === previousDistance && e <= previousEvent)) continue
                  if (d < distance) {
                    event = e
                    distance = d
                    value = mid
                  }
                }
                if (event < 0) break
                previousDistance = distance
                previousEvent = event
                proposals++
                records(foreign.length + 1)
                reservePoints(2)
                charge(foreign.length)
                const trial = foreign.slice(),
                  first = { x: a.x, y: a.y },
                  last = { x: b.x, y: b.y }
                if (horizontal) {
                  first.y = last.y = value
                } else {
                  first.x = last.x = value
                }
                trial[j] = first
                trial[j + 1] = last
                let paintOkay = true
                // All changed segments/joins against ALL current glyphs,
                // including later, unseated endpoint reservations. Endpoints
                // and their normal directions remain fixed. Changed terminal
                // lengths and joins still pass the complete owned-path proof.
                for (let segment = j - 1; segment <= j + 1 && paintOkay; segment++) {
                  updateCarrier(changedCarrier, trial[segment]!, trial[segment + 1]!)
                  if (!parallelClear(other, changedCarrier)) {
                    paintOkay = false
                    break
                  }
                  for (const glyph of all) {
                    charge(2)
                    const ownIncident = segment !== j && glyph.owner === other && (glyph.source ? segment <= 1 : segment >= foreign.length - 3)
                    if (!ownIncident && hits(glyph, changedCarrier)) {
                      paintOkay = false
                      break
                    }
                  }
                  if (!paintOkay) break
                  // Preserve attached normal masking only at its own endpoint;
                  // every other new incident-leg extension is separately proved.
                  if (segment !== j) {
                    charge(6)
                    const fixed = segment === j - 1 ? before : after,
                      oldEnd = segment === j - 1 ? a : b,
                      newEnd = segment === j - 1 ? first : last
                    const oldLength = Math.abs(oldEnd.x - fixed.x) + Math.abs(oldEnd.y - fixed.y),
                      newLength = Math.abs(newEnd.x - fixed.x) + Math.abs(newEnd.y - fixed.y)
                    if (newLength > oldLength) {
                      updateCarrier(changedCarrier, oldEnd, newEnd)
                      for (const glyph of all) {
                        charge(4)
                        // This exact endpoint pose owns its collinear attached
                        // normal shaft, including an outward length extension.
                        // The opposite head, transverse support and every new
                        // bend still undergo the unchanged complete ink tests.
                        if(glyph.owner===other && (glyph.source?segment===0:segment===foreign.length-2))continue
                        if (glyph.owner === other && (glyph.source ? segment <= 1 : segment >= foreign.length - 3) && hits(glyph, changedCarrier)) {
                          paintOkay = false
                          break
                        }
                      }
                    }
                  }
                }
                charge(4)
                for (let point = Math.max(1, j - 1); point <= Math.min(trial.length - 2, j + 2) && paintOkay; point++) {
                  charge(4)
                  const u = trial[point - 1]!,
                    v = trial[point]!,
                    w = trial[point + 1]!
                  if ((u.x === v.x) === (v.x === w.x)) continue
                  changedCarrier.join = true
                  updateCarrier(changedCarrier, v, v)
                  for (const glyph of all) {
                    charge()
                    const fixedOwnIncident = glyph.owner === other && point !== j && point !== j + 1 && point === (glyph.source ? 1 : foreign.length - 2)
                    if (!fixedOwnIncident && hits(glyph, changedCarrier)) {
                      paintOkay = false
                      break
                    }
                  }
                  changedCarrier.join = false
                }
                if (!paintOkay || !accept(other, trial)) continue
                routes[other]!.points = trial
                refresh(other)
                changed(other)
                yielded = true
                break
              }
            }
          }
    return yielded
  }
  let poseCursor = 0
  for (let index = 0; index < edges.length; index++) {
    charge()
    const edge = edges[index]!
    if (edge.visible === false) continue
    endpoint: for (let role = 0; role < 2; role++) {
      charge()
      const template = role === 0 ? edge.markerPaint?.start : edge.markerPaint?.end
      if (!template?.length) continue
      let path = routes[index]!.points
      const source = role === 0
      let p = source ? path[0]! : path.at(-1)!,
        q = source ? path[1]! : path.at(-2)!
      let current = all[poseCursor++]!
      proposals = 0
      if (!clear(current, index, source)) {
        const box = subjects[source ? edge.source : edge.target]!,
          vertical = q.x === p.x
        const low = vertical ? box.x : box.y,
          high = low + (vertical ? box.width : box.height),
          origin = vertical ? p.x : p.y
        const extentLow = (vertical ? current.minX : current.minY) - origin,
          extentHigh = (vertical ? current.maxX : current.maxY) - origin
        // First execute the complete legacy foreign-track and face-seat
        // strategy. Added own/adjacent rescue runs only after that strategy
        // would decline, retaining every proposal already spent.
        for (let rescue = 0; rescue < 2; rescue++) {
        charge()
        if (carrierWidth !== undefined && ink) {
          let yielded = false
          do {
          charge(3)
          yielded = false
          yielded = yieldTrack(index, source, current, vertical, rescue, ink)
          if (!yielded) break
          // A current-route track edit keeps the glyph pose, but its owned
          // path array/first bend changed. Never build a later proposal from
          // the preceding revision. Repeated edits share the ORIGINAL eight.
          charge(4)
          path = routes[index]!.points
          p = source ? path[0]! : path.at(-1)!
          q = source ? path[1]! : path.at(-2)!
          if (clear(current, index, source)) {
            records(1)
            seated.push(current)
            charge()
            spent[2 * index + role] = proposals
            continue endpoint
          }
          } while (rescue === 1 && proposals < 8)
        }
        let count = 2
        cuts[0] = low
        cuts[1] = 0
        cuts[2] = high
        cuts[3] = 0
        // Actual bounds only propose free intervals. Exact painted pieces decide
        // every acceptance; overlapping AABBs alone never reject a marker.
        for (const peer of seated) {
          charge(6)
          if (vertical ? current.maxY <= peer.minY || current.minY >= peer.maxY : current.maxX <= peer.minX || current.minX >= peer.maxX) continue
          const a = Math.max(low, (vertical ? peer.minX : peer.minY) - extentHigh - 0.01),
            b = Math.min(high, (vertical ? peer.maxX : peer.maxY) - extentLow + 0.01)
          if (a < b) {
            cuts[2 * count] = a
            cuts[2 * count + 1] = 1
            count++
            cuts[2 * count] = b
            cuts[2 * count + 1] = -1
            count++
          }
        }
        if (carrierWidth !== undefined)
          for (let other = 0; other < ranges.length; other++) {
            charge()
            if (other === index) continue
            const range = ranges[other]!
            if (vertical ? current.maxY <= range.minY || current.minY >= range.maxY : current.maxX <= range.minX || current.minX >= range.maxX) continue
            for (let k = range.begin; k < range.end; k++) {
              charge(6)
              const peer = carriers[k]!
              if (vertical ? current.maxY <= peer.minY || current.minY >= peer.maxY : current.maxX <= peer.minX || current.minX >= peer.maxX) continue
              const a = Math.max(low, (vertical ? peer.minX : peer.minY) - extentHigh - 0.01),
                b = Math.min(high, (vertical ? peer.maxX : peer.maxY) - extentLow + 0.01)
              if (a < b) {
                cuts[2 * count] = a
                cuts[2 * count + 1] = 1
                count++
                cuts[2 * count] = b
                cuts[2 * count + 1] = -1
                count++
              }
            }
          }
        // In-place insertion sort is paid and stable; no discarded scratch.
        for (let i = 1; i < count; i++) {
          const v = cuts[2 * i]!,
            delta = cuts[2 * i + 1]!
          let j = i
          while (j > 0) {
            charge()
            if (cuts[2 * (j - 1)]! <= v) break
            cuts[2 * j] = cuts[2 * (j - 1)]!
            cuts[2 * j + 1] = cuts[2 * (j - 1) + 1]!
            j--
          }
          cuts[2 * j] = v
          cuts[2 * j + 1] = delta
        }
        let accepted = false,
          previousWidth = Infinity,
          previousSlot = -1,
          previousClass = -1
        // At most eight interval midpoints: proved AABB-free gaps first, then
        // uncertain gaps, each widest-first with stable coordinate ties. Exact
        // canonical pieces remain the verdict for every attempted seat.
        for (let attempt = 0; attempt < 8 && proposals < 8; attempt++) {
          let slot = -1,
            width = 0,
            kind = 2,
            active = 0
          for (let i = 1; i < count; i++) {
            charge(2)
            active += cuts[2 * (i - 1) + 1]!
            const span = cuts[2 * i]! - cuts[2 * (i - 1)]!,
              freeClass = active === 0 ? 0 : 1
            const later = freeClass > previousClass || (freeClass === previousClass && (span < previousWidth || (span === previousWidth && i > previousSlot)))
            if (span > 0 && later && (freeClass < kind || (freeClass === kind && span > width))) {
              width = span
              slot = i
              kind = freeClass
            }
          }
          if (slot < 0) break
          const value = cuts[2 * (slot - 1)]! + width / 2
          previousWidth = width
          previousSlot = slot
          previousClass = kind
          proposals++
          const straight = path.length === 2
          charge(3)
          let turn = 0
          if (straight) {
            const from = vertical ? p.y : p.x, to = vertical ? q.y : q.x, sign = Math.sign(to-from)
            let firstDepth = sign > 0 ? (vertical ? current.maxY : current.maxX)-from : from-(vertical ? current.minY : current.minX), otherDepth=0
            for (const glyph of all) {
              charge(5)
              if (glyph.owner===index && glyph.source!==source) otherDepth=Math.max(otherDepth,sign>0?to-(vertical?glyph.minY:glyph.minX):(vertical?glyph.maxY:glyph.maxX)-to)
            }
            charge(10)
            const margin=half+carrierBendRadius, lead=Math.min(8,Math.abs(to-from)), begin=from+sign*Math.max(lead,firstDepth+margin)
            let end=to-sign*Math.max(lead,otherDepth+margin)
            if(edge.label){
              charge(9)
              const label=routes[index]!.labelPosition
              if(!label||!pointOnMeasuredSegment(label,p,q))continue
              const center=vertical?label.y:label.x,extent=(vertical?edge.label.height:edge.label.width)/2+2+half
              end=sign>0?Math.min(end,center-extent):Math.max(end,center+extent)
            }
            if (!(sign*(end-begin)>0)) continue
            turn=begin+(end-begin)/2
          }
          records((straight?4:path.length) + 1)
          reservePoints(straight?4:3)
          charge(path.length + 6)
          const port = { x: p.x, y: p.y }, bend = { x: q.x, y: q.y }
          if (vertical) {
            port.x = value; bend.x = value
            if(straight)bend.y=turn
            if (Math.abs(port.y - box.y) < 1e-7) port.y = box.y
            else if (Math.abs(port.y - box.y - box.height) < 1e-7) port.y = box.y + box.height
          } else {
            port.y = value; bend.y = value
            if(straight)bend.x=turn
            if (Math.abs(port.x - box.x) < 1e-7) port.x = box.x
            else if (Math.abs(port.x - box.x - box.width) < 1e-7) port.x = box.x + box.width
          }
          const candidate = straight ? (source ? [port,bend,vertical?{x:q.x,y:turn}:{x:turn,y:q.y},q] : [q,vertical?{x:q.x,y:turn}:{x:turn,y:q.y},bend,port]) : path.slice()
          candidate[source ? 0 : candidate.length - 1] = port
          candidate[source ? 1 : candidate.length - 2] = bend
          // Normalize only the untouched leaf endpoint's sub-1e-7 face error;
          // the emitted contact is unchanged, and the opposite normal remains
          // subject to the complete original proof below.
          const otherIndex = source ? candidate.length - 1 : 0,
            otherNext = source ? candidate.length - 2 : 1,
            otherOld = candidate[otherIndex]!,
            other = { x: otherOld.x, y: otherOld.y },
            otherBox = subjects[source ? edge.target : edge.source]!
          if (candidate[otherNext]!.x === other.x) {
            if (Math.abs(other.y - otherBox.y) < 1e-7) other.y = otherBox.y
            else if (Math.abs(other.y - otherBox.y - otherBox.height) < 1e-7) other.y = otherBox.y + otherBox.height
          } else if (candidate[otherNext]!.y === other.y) {
            if (Math.abs(other.x - otherBox.x) < 1e-7) other.x = otherBox.x
            else if (Math.abs(other.x - otherBox.x - otherBox.width) < 1e-7) other.x = otherBox.x + otherBox.width
          }
          if (other.x !== otherOld.x || other.y !== otherOld.y) {
            // The old endpoint may already own a reserved marker. Preserve its
            // actual sharp writer spelling (also sufficient for precision3),
            // not an assumed decimal rounding rule. Formatting temporaries and
            // bounded numeric-string scans are precharged before evaluation.
            records(16)
            charge(256)
            if (formatSvgNumber(other.x) !== formatSvgNumber(otherOld.x) || formatSvgNumber(other.y) !== formatSvgNumber(otherOld.y)) continue
          }
          candidate[otherIndex] = other
          const moved = pose(template, port, bend, index, source)
          if (!clear(moved, index, source)) continue
          let carrierClear = true, coupled = false
          // Every unchanged segment retains its previous positive proof. Only
          // segments incident to either of the three owned changed Points can
          // introduce ink over an earlier glyph; prove those current pieces.
          if (carrierWidth !== undefined)
            for (let cursor = 1; cursor < candidate.length; cursor++) {
              charge()
              if (!straight && !coupled && (source ? cursor > 2 && cursor !== candidate.length - 1 : cursor < candidate.length - 2 && cursor !== 1)) continue
              updateCarrier(changedCarrier, candidate[cursor - 1]!, candidate[cursor]!)
              if (!parallelClear(index, changedCarrier)) {
                // A sharp unlabelled four-point Z may need its port AND row
                // to move together. Enter only after the existing middle-row
                // proof rejects it; every formerly passing candidate is kept.
                charge(5)
                if (!coupled && !straight && cursor === 2 && candidate.length === 4 && !edge.label && carrierBendRadius === 0) {
                  const across = candidate[otherNext]!,
                    from = vertical ? port.y : port.x,
                    row = vertical ? bend.y : bend.x,
                    to = vertical ? other.y : other.x,
                    sign = Math.sign(row - from)
                  charge(6)
                  if ((vertical ? across.y === row && across.x === other.x : across.x === row && across.y === other.y) && sign * (to - row) > 0) {
                    charge(10)
                    const depth = sign > 0 ? (vertical ? moved.maxY : moved.maxX) - from : from - (vertical ? moved.minY : moved.minX),
                      lead = Math.min(8, Math.abs(row - from)),
                      oppositeLead = Math.min(8, Math.abs(to - row))
                    let oppositeDepth = 0
                    for (const glyph of all) {
                      charge(5)
                      if (glyph.owner === index && glyph.source !== source) oppositeDepth = Math.max(oppositeDepth, sign > 0 ? to - (vertical ? glyph.minY : glyph.minX) : (vertical ? glyph.maxY : glyph.maxX) - to)
                    }
                    charge(8)
                    const begin = from + sign * Math.max(lead, depth + half),
                      end = to - sign * Math.max(oppositeLead, oppositeDepth + half),
                      oldLimit = row - sign * carrierWidth,
                      limit = sign > 0 ? Math.min(end, oldLimit) : Math.max(end, oldLimit)
                    if (sign * (limit - begin) > 0) {
                      charge(4)
                      const nextRow = begin + (limit - begin) / 2
                      records(2)
                      reservePoints(1)
                      const oppositeBend = { x: across.x, y: across.y }
                      if (vertical) bend.y = oppositeBend.y = nextRow
                      else bend.x = oppositeBend.x = nextRow
                      candidate[otherNext] = oppositeBend
                      coupled = true
                      // Reprove ALL changed supports, including the first one
                      // already visited, against every current endpoint glyph.
                      cursor = 0
                      continue
                    }
                  }
                }
                carrierClear = false
                break
              }
              for (const original of straight || coupled ? all : seated) {
                charge(coupled ? 4 : 3)
                const peer = coupled && original.owner === index && original.source === source ? moved : original
                const ownIncident = peer.owner===index && (straight || coupled ? (peer.source ? cursor===1 : cursor===candidate.length-1) : (peer.source ? cursor<=2 : cursor>=candidate.length-2))
                if (!ownIncident && hits(peer, changedCarrier)) {
                  carrierClear = false
                  break
                }
              }
              if (!carrierClear) break
            }
          if (carrierClear && carrierWidth !== undefined)
            for (let cursor = 1; cursor + 1 < candidate.length; cursor++) {
              charge()
              if (!straight && !coupled && (source ? cursor > 2 && cursor !== candidate.length - 2 : cursor < candidate.length - 3 && cursor !== 1)) continue
              const a = candidate[cursor - 1]!,
                b = candidate[cursor]!,
                c = candidate[cursor + 1]!
              charge(4)
              if ((a.x === b.x) === (b.x === c.x)) continue
              changedCarrier.join = true
              updateCarrier(changedCarrier, b, b)
              changedCarrier.join = false
              // Keep the join rectangle's prepared bounds while hits reads its
              // explicit join flag; restore the scratch tag before next use.
              changedCarrier.join = true
              for (const original of straight || coupled ? all : seated) {
                charge(coupled ? 4 : 3)
                const peer = coupled && original.owner === index && original.source === source ? moved : original
                const ownIncident = !straight && !coupled && peer.owner===index && (peer.source ? cursor===1 : cursor===candidate.length-2)
                if (!ownIncident && hits(peer, changedCarrier)) {
                  carrierClear = false
                  break
                }
              }
              changedCarrier.join = false
              if (!carrierClear) break
            }
          if (!carrierClear || !accept(index, candidate)) continue
          if (straight && carrierWidth !== undefined) growStraightRange(index,candidate)
          routes[index]!.points = candidate
          if (carrierWidth !== undefined) refresh(index)
          current = moved
          all[poseCursor - 1] = moved
          changed(index)
          accepted = true
          break
        }
        if (!accepted) {
          if (rescue === 0) continue
          fail('No physically clear measured marker seat at occurrence ' + index + ' role ' + role)
        }
        break
        }
      }
      records(1)
      seated.push(current)
      charge()
      spent[2 * index + role] = proposals
    }
  }
  if (inspectContact && ink && carrierWidth !== undefined && carrierBendRadius === 0) {
    records(1)
    const witness: MeasuredSharpContactWitness = { candidateSegment: -1, peerIndex: -1, peerSegment: -1 }
    for (let index = 0; index < routes.length; index++) {
      charge()
      if (edges[index]!.visible === false) continue
      while (inspectContact(index, witness)) {
        let repaired = false
        for (let side = 0; side < 2 && !repaired; side++) {
          charge(3)
          const other = side === 0 ? index : witness.peerIndex,
            paint = edges[other]!.markerPaint,
            marked = !!(paint?.start?.length || paint?.end?.length)
          for (let role = 0; role < (marked ? 2 : 1) && !repaired; role++) {
            charge(4)
            if (marked && !(role === 0 ? paint?.start?.length : paint?.end?.length)) continue
            const slot = marked ? 2 * other + role : 2 * edges.length + other
            proposals = spent[slot]!
            if (proposals >= 8) continue
            repaired = yieldTrack(other, role === 0, undefined, false, 1, ink, index, witness, other)
            charge()
            spent[slot] = proposals
          }
        }
        if (!repaired) fail('No physically clear measured sharp contact repair at occurrence ' + index)
      }
    }
  }
}
