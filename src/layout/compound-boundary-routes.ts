import { formatSvgNumber } from '../shared/svg-number.ts'
import { classMarkerPiecesOverlap } from './measured-marker-overlap.ts'
import { seatMeasuredMarkers } from './compound-marker-seating.ts'
import { createOwnedCompoundObstacleIndexFactory } from './compound-obstacle-index.ts'
import { proposeRetainedLabelChannel, compactProvedPath } from './compound-portal-channel.ts'
import { proposeOuterChannel } from './compound-outer-channel.ts'
import { createPeerGeometryOwner, type PeerGeometryOwner, type PeerLease } from './compound-peer-geometry.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { Direction, Point } from '../types.ts'
import { scoreMeasuredRouteCrossings, scoreMeasuredRouteProposalCrossings, measuredRouteContactPairBudget, segmentEntersMeasuredBox, type MeasuredSharpContactWitness } from './measured-route-safety.ts'
import { simplifyOrthogonal, type RoutingBox, type Terminal } from './compound-visibility.ts'
import { createEndpointSparseVisibilityGraph, createSparseAdjacencyStoragePool, createSparseQueryWorkspacePool, createSparseVisibilityGraph, type SparseQueryWorkspacePool } from './compound-sparse-visibility.ts'
import { createLazyVisibilityGrid } from './compound-lazy-visibility.ts'
import { routeAncestorBoundaryConnection, type AncestorBoundaryPlan } from './ancestor-boundary-routes.ts'
import { createCompoundObstacleIndex, type CompoundObstacleQueries } from './compound-obstacle-index.ts'

const inflate = (box: RoutingBox, margin: number): RoutingBox => ({ x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin })
const onSegment = (point: Point, a: Point, b: Point): boolean => (a.x === b.x ? Math.abs(point.x - a.x) < 1e-7 : Math.abs(point.y - a.y) < 1e-7)
  && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)

function terminals(box: RoutingBox, direction: Direction, source: boolean, clearance: number, fractions: readonly number[] = [.5, .25, .75]): Terminal[] {
  const forward = direction === 'LR' ? 'E' : direction === 'RL' ? 'W' : direction === 'BT' ? 'N' : 'S'
  const opposite = { N: 'S', E: 'W', S: 'N', W: 'E' } as const
  const preferred = source ? forward : opposite[forward]
  const sides = [preferred, ...(['N', 'E', 'S', 'W'] as const).filter(side => side !== preferred)]
  return sides.flatMap((side, index) => fractions.map(fraction => {
    const port = side === 'N' || side === 'S'
      ? { x: box.x + fraction * box.width, y: side === 'N' ? box.y : box.y + box.height }
      : { x: side === 'W' ? box.x : box.x + box.width, y: box.y + fraction * box.height }
    const stub = { x: port.x + (side === 'E' ? clearance : side === 'W' ? -clearance : 0), y: port.y + (side === 'S' ? clearance : side === 'N' ? -clearance : 0) }
    return { port, stub, penalty: index * clearance * 2 + Math.abs(fraction - .5) * clearance }
  }))
}

function selfContact(points: readonly Point[], work: ChannelWork, fail: (reason: string) => never): boolean {
  for (let index = 2; index < points.length; index++) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
    const a = points[index - 2]!, b = points[index - 1]!, c = points[index]!
    if ((a.x === b.x && b.x === c.x && Math.sign(b.y - a.y) !== Math.sign(c.y - b.y))
      || (a.y === b.y && b.y === c.y && Math.sign(b.x - a.x) !== Math.sign(c.x - b.x))) return true
  }
  for (let i = 1; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
    const a = points[i - 1]!, b = points[i]!, c = points[j - 1]!, d = points[j]!
    if (a.x === b.x && c.x === d.x) {
      if (a.x === c.x && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >= Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))) return true
    } else if (a.y === b.y && c.y === d.y) {
      if (a.y === c.y && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >= Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))) return true
    } else {
      const x = a.x === b.x ? a.x : c.x, y = a.x === b.x ? c.y : a.y
      if (onSegment({ x, y }, a, b) && onSegment({ x, y }, c, d)) return true
    }
  }
  return false
}

/** Remove closed excursions by retaining only subsegments of the old path.
 * No shortcut adds ink, and the caller still checks the reserved label. */
function removeClosedExcursions(points: readonly Point[], work: ChannelWork, fail: (reason: string) => never): Point[] {
  let result = simplifyOrthogonal(points)
  for (;;) {
    let shortened: Point[] | undefined
    for (let index = 2; index < result.length; index++) {
      if (--work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
      const a = result[index - 2]!, b = result[index - 1]!, c = result[index]!
      if (a.x === b.x && b.x === c.x || a.y === b.y && b.y === c.y) {
        shortened = [...result.slice(0, index - 1), ...result.slice(index)]
        break
      }
    }
    for (let i = 1; !shortened && i < result.length; i++) for (let j = i + 2; j < result.length; j++) {
      if (--work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
      const a = result[i - 1]!, b = result[i]!, c = result[j - 1]!, d = result[j]!
      let contact: Point | undefined
      if (a.x === b.x && c.x === d.x) {
        const low = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)), high = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
        if (a.x === c.x && low <= high) contact = { x: a.x, y: Math.max(low, Math.min(high, a.y)) }
      } else if (a.y === b.y && c.y === d.y) {
        const low = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)), high = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
        if (a.y === c.y && low <= high) contact = { x: Math.max(low, Math.min(high, a.x)), y: a.y }
      } else {
        const point = { x: a.x === b.x ? a.x : c.x, y: a.x === b.x ? c.y : a.y }
        if (onSegment(point, a, b) && onSegment(point, c, d)) contact = point
      }
      if (contact) { shortened = [...result.slice(0, i), contact, ...result.slice(j)]; break }
    }
    if (!shortened) return result
    result = simplifyOrthogonal(shortened)
  }
}

/** Large scopes first try at most64 short rectilinear corridors, sharing a
 * small fraction of the existing pair budget. Every tested shaft still clears
 * all obstacles. Larger scopes decline if these complete paths are blocked. */
function directCorridor(
  bounds: RoutingBox, obstacles: readonly RoutingBox[], starts: readonly Terminal[], goal: Point,
  frames: readonly RoutingBox[], clearance: number, work: ChannelWork,
  probes: { pairs: number; candidates: number }, fail: (reason: string) => never,
  accept: (points: Point[]) => boolean = () => true,
  balanced = false,
  obstacleQueries?: () => CompoundObstacleQueries,
): Point[] | undefined {
  const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height
  const probeEnd = {}
  const reserveProbe = (): void => {
    if (probes.pairs <= 0) throw probeEnd
    probes.pairs--
  }
  const test = (raw: Point[], complete = true): Point[] | undefined => {
    if (probes.candidates <= 0 || probes.pairs <= 0) return
    probes.candidates--
    const path = simplifyOrthogonal(raw)
    for (const point of path) if (!Number.isFinite(point.x + point.y) || point.x < bounds.x || point.x > right || point.y < bounds.y || point.y > bottom) return
    if (selfContact(path, work, fail)) return
    for (let index = 1; index < path.length; index++) {
      if (--work.arcs < 0) fail('agentic local cross-hierarchy direct-arc limit')
      const a = path[index - 1]!, b = path[index]!
      if (obstacleQueries) {
        try { if (obstacleQueries().entersSegment(a.x, a.y, b.x, b.y, reserveProbe)) return } catch (error) {
          if (error === probeEnd) return
          throw error
        }
      } else for (const box of obstacles) {
        if (probes.pairs <= 0) return
        probes.pairs--
        if (--work.pairs < 0) fail('agentic local cross-hierarchy direct-pair limit')
        if (segmentEntersMeasuredBox(a, b, box)) return
      }
    }
    return !complete || accept(path) ? path : undefined
  }
  if (balanced) {
    // Breadth first across endpoint sides: a blocked top port must not spend
    // the whole proposal reserve before a clear side port is considered.
    const available: Terminal[] = []
    for (let fraction = 0; fraction < 3; fraction++) for (let side = 0; side < 4; side++) {
      const terminal = starts[side * 3 + fraction]!
      if (test([terminal.port, terminal.stub], false)) available.push(terminal)
    }
    const attempt = (middle: (stub: Point) => Point[]): Point[] | undefined => {
      if (probes.pairs <= 0 || probes.candidates <= 0) return
      for (const { port, stub } of available) {
        const result = test([port, stub, ...middle(stub), goal])
        if (result) return result
        if (probes.pairs <= 0 || probes.candidates <= 0) return
      }
    }
    for (const middle of [(stub: Point) => [{ x: goal.x, y: stub.y }], (stub: Point) => [{ x: stub.x, y: goal.y }]]) {
      const result = attempt(middle)
      if (result) return result
    }
    for (const frame of frames) {
      const xs = [frame.x - clearance * 2, frame.x + frame.width + clearance * 2, frame.x - clearance, frame.x + frame.width + clearance]
      const ys = [frame.y - clearance, frame.y + frame.height + clearance]
      for (const x of xs) {
        const result = attempt(stub => [{ x, y: stub.y }, { x, y: goal.y }])
        if (result) return result
      }
      for (const y of ys) {
        const result = attempt(stub => [{ x: stub.x, y }, { x: goal.x, y }])
        if (result) return result
      }
      for (const x of xs) for (const y of ys) {
        const result = attempt(stub => [{ x, y: stub.y }, { x, y }, { x: goal.x, y }])
        if (result) return result
      }
      if (probes.pairs <= 0 || probes.candidates <= 0) return
    }
    return
  }
  // Check each side's center before considering quarter ports. A blocked
  // endpoint ray cannot be rescued by any subsequent corridor proposal.
  for (let fraction = 0; fraction < 3; fraction++) for (let side = 0; side < 4; side++) {
    const { port, stub } = starts[side * 3 + fraction]!
    if (!test([port, stub], false)) {
      if (probes.pairs <= 0 || probes.candidates <= 0) return
      continue
    }
    for (const middle of [{ x: goal.x, y: stub.y }, { x: stub.x, y: goal.y }]) {
      const result = test([port, stub, middle, goal])
      if (result) return result
      if (probes.pairs <= 0 || probes.candidates <= 0) return
    }
    for (const frame of frames) {
      const xs = [frame.x - clearance, frame.x + frame.width + clearance]
      const ys = [frame.y - clearance, frame.y + frame.height + clearance]
      for (const x of xs) {
        const result = test([port, stub, { x, y: stub.y }, { x, y: goal.y }, goal])
        if (result) return result
        if (probes.pairs <= 0 || probes.candidates <= 0) return
      }
      for (const y of ys) {
        const result = test([port, stub, { x: stub.x, y }, { x: goal.x, y }, goal])
        if (result) return result
        if (probes.pairs <= 0 || probes.candidates <= 0) return
      }
      for (const x of xs) for (const y of ys) {
        const result = test([port, stub, { x, y: stub.y }, { x, y }, { x: goal.x, y }, goal])
        if (result) return result
        if (probes.pairs <= 0 || probes.candidates <= 0) return
      }
    }
  }
  return undefined
}

class BoundaryRouteDecline {
  constructor(readonly reason: string) {}
}

interface ContactRouteBounds {
  orthogonal: boolean
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function reserveContactBounds(work: ChannelWork, fail: (reason: string) => never, amount = 1): void {
  work.arcs -= amount
  if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
}

function readContactBounds(points: readonly Point[], bounds: ContactRouteBounds, charge: (amount?: number) => void): void {
  charge()
  bounds.orthogonal = points.length >= 2
  bounds.minX = Infinity; bounds.maxX = -Infinity; bounds.minY = Infinity; bounds.maxY = -Infinity
  for (let cursor = 0; bounds.orthogonal && cursor < points.length; cursor++) {
    // Two finite classifications, three orthogonality comparisons and four
    // extrema comparisons. Unsafe routes retain the original exact scorer.
    charge(9)
    const point = points[cursor]!
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
      || cursor > 0 && point.x !== points[cursor - 1]!.x && point.y !== points[cursor - 1]!.y) {
      bounds.orthogonal = false
      return
    }
    bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y)
  }
}

function separatedContactBounds(a: ContactRouteBounds | undefined, b: ContactRouteBounds | undefined, charge: (amount?: number) => void, width?: number): boolean {
  if (!a?.orthogonal || !b?.orthogonal) return false
  charge(width === undefined ? 8 : 20)
  const left = a.minX - b.maxX, right = b.minX - a.maxX, top = a.minY - b.maxY, bottom = b.minY - a.maxY
  // Raw bounds may discard a pair only beyond the actual written ink width.
  // The loose writer-error allowance is broad phase only; scoring stays exact.
  const margin = width === undefined ? .5 : Math.max(.5, width + (Math.abs(a.minX) + Math.abs(a.maxX) + Math.abs(a.minY) + Math.abs(a.maxY)
    + Math.abs(b.minX) + Math.abs(b.maxX) + Math.abs(b.minY) + Math.abs(b.maxY) + width) * 1e-10 + 1e-9)
  return Number.isFinite(left) && Number.isFinite(right) && Number.isFinite(top) && Number.isFinite(bottom)
    && (left > margin || right > margin || top > margin || bottom > margin)
}

/** Prepare one exact candidate check against the currently selected peers.
 * Peer geometry is owned and immutable throughout this one-edge lifetime.
 * Hidden pending quotients retain metadata slots but execute no shaft pairs. */
export function createBoundaryContactValidator(
  input: MeasuredGraph, index: number, routes: readonly { points: Point[]; style: string }[],
  work: ChannelWork, fail: (reason: string) => never,
): (points: Point[]) => boolean {
  return prepareBoundaryContactValidator(input,index,routes,work,fail,scoreMeasuredRouteCrossings)
}

/** Proposal-only search. No success is entered into markerCurrentProofs;
 * the global ALL-visible/rescued closure below remains mandatory. */
function createBoundaryProposalContactValidator(
  input:MeasuredGraph,index:number,routes:readonly {points:Point[];style:string}[],work:ChannelWork,fail:(reason:string)=>never,
):(points:Point[])=>boolean {
  return prepareBoundaryContactValidator(input,index,routes,work,fail,scoreMeasuredRouteProposalCrossings)
}

function prepareBoundaryContactValidator(
  input:MeasuredGraph,index:number,routes:readonly {points:Point[];style:string}[],work:ChannelWork,fail:(reason:string)=>never,
  score:typeof scoreMeasuredRouteCrossings,
):(points:Point[])=>boolean {
  const pairBudget=measuredRouteContactPairBudget(input,score===scoreMeasuredRouteProposalCrossings?'proposal':'complete')
  let peerSegments = 0, peerPoints = 0, peerCount = 0
  for (let other = 0; other < routes.length; other++) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
    if (other !== index && routes[other]!.style !== 'invisible') {
      peerSegments += Math.max(0, routes[other]!.points.length - 1)
      peerPoints += routes[other]!.points.length; peerCount++
    }
  }
  const charge = (amount = 1): void => {
    work.pairs -= amount
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
  }
  if (input.maximumEdgeStrokeWidth !== undefined) reserveContactBounds(work, fail)
  const reserve = input.maximumEdgeStrokeWidth === undefined ? undefined : (amount: number): void => reserveContactBounds(work, fail, amount)
  const exact = (points: Point[]): boolean => {
    work.pairs -= pairBudget * Math.max(0, points.length - 1) * peerSegments + points.length + peerSegments
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
    return score(points, index, routes, input, charge, reserve,undefined,pairBudget) !== undefined
  }
  // Small proofs keep their original admission. Larger proofs are prepared
  // lazily only when the possible subtraction exceeds their comparison work.
  if (peerSegments < 32) return exact
  type PeerBounds = ContactRouteBounds & { points: Point[]; style: string; originalStyle: string }
  let selected: { points: Point[]; style: string }[] | undefined
  let peers: (PeerBounds | undefined)[] | undefined
  let candidate: ContactRouteBounds | undefined
  return points => {
    const segments = Math.max(0, points.length - 1)
    const comparisonWork = 1 + 9 * points.length + (input.maximumEdgeStrokeWidth === undefined ? 8 : 20) * peerCount + routes.length
    const preparationWork = selected ? 0 : 9 * peerPoints + peerCount + 3 * routes.length
    const possibleSubtraction = (pairBudget * segments + 1) * peerSegments
    if (!Number.isSafeInteger(possibleSubtraction) || possibleSubtraction <= comparisonWork + preparationWork) return exact(points)
    if (!selected) {
      reserveContactBounds(work, fail, 2 * routes.length)
      charge(2 * routes.length)
      selected = routes.slice(); peers = new Array(routes.length)
      for (let other = 0; other < routes.length; other++) {
        charge()
        const route = routes[other]!
        if (other === index || route.style === 'invisible') continue
        reserveContactBounds(work, fail)
        const peer: PeerBounds = { points: route.points, style: route.style, originalStyle: route.style,
          orthogonal: false, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
        readContactBounds(route.points, peer, charge)
        selected[other] = peer; peers[other] = peer
      }
      reserveContactBounds(work, fail)
      candidate = { orthogonal: false, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    }
    readContactBounds(points, candidate!, charge)
    let remaining = 0
    for (let other = 0; other < selected.length; other++) {
      charge()
      const peer = peers![other]
      if (!peer) continue
      peer.style = separatedContactBounds(candidate, peer, charge, input.maximumEdgeStrokeWidth) ? 'invisible' : peer.originalStyle
      if (peer.style !== 'invisible') remaining += Math.max(0, peer.points.length - 1)
    }
    charge(pairBudget * segments * remaining + points.length + remaining)
    return score(points, index, selected, input, charge, reserve,undefined,pairBudget) !== undefined
  }
}

/** Close every final pair involving a boundary rescue. Finite orthogonal
 * visible pairs are symmetric and need one exact check. Other candidates
 * retain the original directional checks against every visible peer. */
export function assertFinalBoundaryContacts(
  input: MeasuredGraph, placed: AgenticLayout, rescued: ReadonlySet<number>, work: ChannelWork, fail: (reason: string) => never,
  currentSceneProven?: ReadonlySet<number>,
): void {
  const charge = (amount = 1): void => {
    work.pairs -= amount
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
  }
  // Every known-width entry (including markerless/empty-rescue closure)
  // reserves its own route records, reference array and map callback.
  if (input.maximumEdgeStrokeWidth !== undefined) reserveContactBounds(work, fail, 2 * placed.edges.length + 3)
  const reserve = input.maximumEdgeStrokeWidth === undefined ? undefined : (amount: number): void => reserveContactBounds(work, fail, amount)
  const pairBudget=measuredRouteContactPairBudget(input)
  let visibleSegments = 0, visiblePoints = 0, visibleCount = 0
  const routes = placed.edges.map((route, index) => {
    charge()
    let orthogonal = route.points.length >= 2
    for (let cursor = 0; orthogonal && cursor < route.points.length; cursor++) {
      charge()
      const point = route.points[cursor]!
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
        || cursor > 0 && point.x !== route.points[cursor - 1]!.x && point.y !== route.points[cursor - 1]!.y) orthogonal = false
    }
    const visible = input.edges[index]!.visible !== false
    if (visible) { visibleSegments += Math.max(0, route.points.length - 1); visiblePoints += route.points.length; visibleCount++ }
    return { ...route, style: visible ? 'solid' : 'invisible', orthogonal, covered: false }
  })
  // Local scopes have no physical-width metadata. Close their globally
  // projected routes here too; an untouched route is not a prior proof.
  let allCandidates: number[] | undefined
  if (input.maximumEdgeStrokeWidth !== undefined && input.maximumEdgeBendRadius === 0) {
    reserveContactBounds(work, fail, rescued.size + routes.length + 1)
    allCandidates = []
    // Preserve directional checks for old invisible rescues as well as adding
    // every visible global route. Visibility does not replace that contract.
    for (const index of rescued) {
      charge()
      allCandidates.push(index)
    }
    for (let index = 0; index < routes.length; index++) {
      charge()
      if (input.edges[index]!.visible !== false) {
        charge()
        if (!rescued.has(index)) allCandidates.push(index)
      }
    }
  }
  const candidates = allCandidates ?? rescued
  let bounds: (ContactRouteBounds | undefined)[] | undefined
  if (visibleSegments >= 32) {
    let largest = 0
    for (const index of candidates) { charge();if(currentSceneProven){charge();if(routes[index]!.orthogonal&&input.edges[index]!.visible!==false&&currentSceneProven.has(index))continue} largest = Math.max(largest, routes[index]!.points.length - 1) }
    const possibleSubtraction = (pairBudget * largest + 1) * visibleSegments
    const preparationWork = 9 * visiblePoints + visibleCount + 2 * routes.length + (input.maximumEdgeStrokeWidth === undefined ? 8 : 20) * visibleCount
    if (Number.isSafeInteger(possibleSubtraction) && possibleSubtraction > preparationWork) {
      reserveContactBounds(work, fail, routes.length)
      charge(routes.length)
      bounds = new Array(routes.length)
      for (let index = 0; index < routes.length; index++) {
        charge()
        const route = routes[index]!
        if (route.style === 'invisible' || !route.orthogonal) continue
        reserveContactBounds(work, fail)
        const box: ContactRouteBounds = { orthogonal: false, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
        readContactBounds(route.points, box, charge)
        bounds[index] = box
      }
    }
  }
  for (const index of candidates) {
    const route = routes[index]!, points = route.points
    const symmetric = route.orthogonal && input.edges[index]!.visible !== false
    if(currentSceneProven){charge();if(symmetric&&currentSceneProven.has(index))continue}
    let peerSegments = 0
    for (let other = 0; other < routes.length; other++) {
      charge()
      const peer = routes[other]!
      if(currentSceneProven)charge()
      peer.style = input.edges[other]!.visible === false || symmetric && (peer.covered || peer.orthogonal && currentSceneProven?.has(other)) ? 'invisible' : 'solid'
      if (bounds && other !== index && peer.style !== 'invisible' && separatedContactBounds(bounds[index], bounds[other], charge, input.maximumEdgeStrokeWidth)) peer.style = 'invisible'
      if (other !== index && peer.style !== 'invisible') peerSegments += Math.max(0, peer.points.length - 1)
    }
    charge(pairBudget * Math.max(0, points.length - 1) * peerSegments + points.length + peerSegments + routes.length)
    if (scoreMeasuredRouteCrossings(points, index, routes, input, charge, reserve,undefined,pairBudget) === undefined) fail('cross-hierarchy routes have an uncertified shared contact')
    if (symmetric) route.covered = true
  }
}

/** Restore an emitted-identical endpoint to its subject's exact raw side.
 * Reflection and group translation may otherwise put it just inside the body.
 * This runs after all old leases and before constructing marker reservations. */
export function restoreMeasuredEndpointFaces(input: MeasuredGraph, placed: AgenticLayout, subjects: readonly RoutingBox[], work: ChannelWork, reserveExpanded: (amount: number) => void, fail: (reason: string) => never): void {
  for (let index = 0; index < input.edges.length; index++) for (let role = 0; role < 2; role++) {
    work.pairs -= 10
    if (work.pairs < 0) fail('agentic marker endpoint work limit')
    const route = placed.edges[index]!.points, edge = input.edges[index]!, source = role === 0
    if (route.length < 2) continue
    const endpoint = source ? 0 : route.length - 1, p = route[endpoint]!, q = source ? route[1]! : route.at(-2)!, box = subjects[source ? edge.source : edge.target]!
    let axis: 'x' | 'y', side: number
    if (p.x === q.x && p.y !== q.y) { axis = 'y'; side = q.y > p.y ? box.y + box.height : box.y }
    else if (p.y === q.y && p.x !== q.x) { axis = 'x'; side = q.x > p.x ? box.x + box.width : box.x }
    else continue
    if (p[axis] === side) continue
    work.arcs -= 10
    work.pairs -= 256
    if (work.arcs < 0) fail('agentic marker endpoint capacity limit')
    if (work.pairs < 0) fail('agentic marker endpoint work limit')
    if (formatSvgNumber(p[axis]) !== formatSvgNumber(side)) continue
    reserveExpanded(1)
    if (--work.arcs < 0) fail('agentic marker endpoint capacity limit')
    work.pairs -= 3
    if (work.pairs < 0) fail('agentic marker endpoint work limit')
    route[endpoint] = { x: p.x, y: p.y, [axis]: side }
  }
}

/** Every old query lease has ended. Positive entries belong only to complete
 * CURRENT paths; no negative search certificate is reused. */
function seatFinalMeasuredMarkers(
  input: MeasuredGraph, placed: AgenticLayout, nodes: readonly RoutingBox[],
  frames: readonly RoutingBox[], subjects: readonly RoutingBox[], headerGroups: NonNullable<MeasuredGraph['groups']>,
  work: ChannelWork, reserveExpanded: (amount: number) => void, fail: (reason: string) => never,
  rescued: Set<number>, clearance: number, widthProof: number, proveAll = false,
): Set<number> {
    if (proveAll || input.maximumEdgeBendRadius === 0) restoreMeasuredEndpointFaces(input, placed, subjects, work, reserveExpanded, fail)
    work.arcs -= 14
    if (work.arcs<0) fail('agentic marker full-proof capacity limit')
    const charge = (amount = 1): void => { work.pairs -= amount; if (work.pairs < 0) fail('agentic marker full-proof work limit') }
    const reserve = (amount: number): void => reserveContactBounds(work, fail, amount)
    const markerCurrentProofs=new Set<number>()
    reserveExpanded(4)
    let labelCount=0
    for(let index=0;index<input.edges.length;index++){if(--work.pairs<0)fail('agentic marker full-proof work limit');if(input.edges[index]!.label&&placed.edges[index]!.labelPosition)labelCount++}
    work.arcs-=2*(nodes.length+frames.length+labelCount)+3
    if(work.arcs<0)fail('agentic marker full-proof capacity limit')
    const seatingObstacles:RoutingBox[]=[],seatingBounds={x:0,y:0,width:placed.width,height:placed.height}
    for(let node=0;node<nodes.length;node++){if(--work.pairs<0)fail('agentic marker full-proof work limit');const b=nodes[node]!,m=(input.nodes[node]!.paintStrokeWidth??0)/2;seatingObstacles.push({x:b.x-m,y:b.y-m,width:b.width+2*m,height:b.height+2*m})}
    for(let group=0;group<frames.length;group++){if(--work.pairs<0)fail('agentic marker full-proof work limit');const b=frames[group]!,m=(input.groups![group]!.paintStrokeWidth??0)/2,h=headerGroups[group]!.headerHeight??headerGroups[group]!.padding.top;seatingObstacles.push({x:b.x-m,y:b.y-m,width:b.width+2*m,height:h+2*m})}
    for(let index=0;index<input.edges.length;index++){if(--work.pairs<0)fail('agentic marker full-proof work limit');const l=input.edges[index]!.label,p=placed.edges[index]!.labelPosition;if(l&&p)seatingObstacles.push({x:p.x-l.width/2-2,y:p.y-l.height/2-2,width:l.width+4,height:l.height+4})}
    const proofBox: RoutingBox = {x:0,y:0,width:0,height:0}
    const paintRectangle = [{kind:'polygon' as const,points:[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}]}]
    const validate = (index: number, candidate: Point[], witness?: MeasuredSharpContactWitness, contactOnly = false): boolean => {
      const edge = input.edges[index]!, old = placed.edges[index]!
      charge()
      if (contactOnly) {
        // This is the new final contact audit of an UNCHANGED compound path.
        // Its producer and final owned-surface admission still own geometry.
        // Flat raw paths and ALL proposed replacements take the full branch.
        if (candidate !== old.points || edge.visible === false || candidate.length < 2) return false
        for (let cursor = 0; cursor < candidate.length; cursor++) {
          charge(3)
          const point = candidate[cursor]!
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || cursor && point.x !== candidate[cursor-1]!.x && point.y !== candidate[cursor-1]!.y) return false
        }
      } else {
      if (selfContact(candidate, work, fail)) return false
      for (let cursor = 0; cursor < candidate.length; cursor++) {
        charge(); const point = candidate[cursor]!
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || cursor && point.x !== candidate[cursor-1]!.x && point.y !== candidate[cursor-1]!.y) return false
      }
      for (let role = 0; role < 2; role++) {
        charge(8)
        const source = role === 0, box = subjects[source ? edge.source : edge.target]!
        const p = source ? candidate[0]! : candidate.at(-1)!, q = source ? candidate[1]! : candidate.at(-2)!
        const a = source ? old.points[0]! : old.points.at(-1)!, b = source ? old.points[1]! : old.points.at(-2)!
        if (Math.sign(q.x-p.x) !== Math.sign(b.x-a.x) || Math.sign(q.y-p.y) !== Math.sign(b.y-a.y)
          || Math.abs(q.x-p.x)+Math.abs(q.y-p.y) < Math.min(clearance,Math.abs(b.x-a.x)+Math.abs(b.y-a.y))) return false
        if (p.x < box.x || p.x > box.x+box.width || p.y < box.y || p.y > box.y+box.height) return false
        if (!(Math.abs(p.x-box.x)<1e-7 && q.y===p.y && q.x<p.x || Math.abs(p.x-box.x-box.width)<1e-7 && q.y===p.y && q.x>p.x
          || Math.abs(p.y-box.y)<1e-7 && q.x===p.x && q.y<p.y || Math.abs(p.y-box.y-box.height)<1e-7 && q.x===p.x && q.y>p.y)) return false
      }
      let labelOnOldShaft = false
      if(edge.label){
        if(!old.labelPosition)return false
        for(let cursor=1;cursor<old.points.length;cursor++){charge();if(onSegment(old.labelPosition,old.points[cursor-1]!,old.points[cursor]!)){labelOnOldShaft=true;break}}
        if(edge.source!==edge.target || labelOnOldShaft){
          let retained=false
          for(let cursor=1;cursor<candidate.length;cursor++){charge();if(onSegment(old.labelPosition,candidate[cursor-1]!,candidate[cursor]!)){retained=true;break}}
          if(!retained)return false
        }
      }
      const halfWidth = (widthProof ?? 1)/2
      for (let cursor=1;cursor<candidate.length;cursor++) {
        const a=candidate[cursor-1]!, b=candidate[cursor]!
        for (let node=0;node<nodes.length;node++) { charge(5); const box=nodes[node]!,incident=node===edge.source&&cursor===1||node===edge.target&&cursor===candidate.length-1,margin=incident?0:halfWidth+(input.nodes[node]!.paintStrokeWidth??0)/2
          proofBox.x=box.x-margin;proofBox.y=box.y-margin;proofBox.width=box.width+2*margin;proofBox.height=box.height+2*margin
          if (segmentEntersMeasuredBox(a,b,proofBox)) return false
        }
        for (let group=0;group<frames.length;group++) { charge(5); const box=frames[group]!, height=headerGroups[group]!.headerHeight ?? headerGroups[group]!.padding.top
          proofBox.x=box.x-halfWidth;proofBox.y=box.y-halfWidth;proofBox.width=box.width+2*halfWidth;proofBox.height=height+2*halfWidth
          if (height>0 && segmentEntersMeasuredBox(a,b,proofBox)) return false
        }
        for (let other=0;other<input.edges.length;other++) { charge(); const label=input.edges[other]!.label, center=placed.edges[other]!.labelPosition
          if (!label || !center) continue
          if (other===index && labelOnOldShaft && onSegment(center,a,b)) continue
          charge(4);proofBox.x=center.x-label.width/2-2;proofBox.y=center.y-label.height/2-2;proofBox.width=label.width+4;proofBox.height=label.height+4
          if (segmentEntersMeasuredBox(a,b,proofBox)) return false
        }
      }
      }
      // Original exact contact scorer on CURRENT peers; selected metadata is
      // reserved and scanned before proof. Sharp-separated pairs execute only
      // their support bound; the scorer charges both remaining near predicates.
      work.arcs -= 2*placed.edges.length+1
      if (work.arcs<0) fail('agentic marker full-proof capacity limit')
      // Only an unchanged committed array may reuse a peer's complete contact
      // CURRENT positive proof. Every proposed replacement sees all peers.
      // At the last write of either pair member, its proof saw both arrays;
      // later writes must pass this same complete admission before publication.
      charge(3)
      const unchanged=candidate===old.points&&edge.visible!==false
      let segments=0
      const routes=placed.edges.map((route,other)=>{
        charge()
        let visible=input.edges[other]!.visible!==false
        if(unchanged&&visible&&other!==index){charge(2);if(markerCurrentProofs.has(other))visible=false}
        if(other!==index&&visible)segments+=Math.max(0,route.points.length-1)
        return {...route,style:visible?'solid':'invisible'}
      })
      charge(measuredRouteContactPairBudget(input)*(candidate.length-1)*segments+candidate.length+segments)
      return scoreMeasuredRouteCrossings(candidate,index,routes,input,charge,reserve,witness,measuredRouteContactPairBudget(input))!==undefined
    }
    // One additional call-local inspection callback; no retained search proof.
    reserve(1)
    seatMeasuredMarkers(input.edges, placed.edges, subjects, work, reserveExpanded, fail, validate, index => {
      // Called only AFTER the same accepted array is committed. Every successful
      // marker/yield full proof saw ALL then-current finalized visible routes.
      // At the last change of either finite orthogonal visible pair member,
      // that proof therefore saw both final geometries. No negative result or
      // pre-marker candidate proof is promoted into this call-local ledger.
      charge(2)
      if(!markerCurrentProofs!.has(index)){if(--work.arcs<0)fail('agentic marker full-proof capacity limit');markerCurrentProofs!.add(index)}
      if(!rescued.has(index)){work.arcs--;if(work.arcs<0)fail('agentic marker full-proof capacity limit');rescued.add(index)}
    }, (index,source,pieces,bounds) => {
      work.arcs--
      if(work.arcs<0)fail('agentic marker full-proof capacity limit')
      const markerBoxClear=(x:number,y:number,width:number,height:number):boolean=>{
        charge(5)
        if(bounds.maxX<=x || bounds.minX>=x+width || bounds.maxY<=y || bounds.minY>=y+height)return true
        charge(8)
        const p=paintRectangle[0]!.points
        p[0]!.x=x;p[0]!.y=y;p[1]!.x=x+width;p[1]!.y=y;p[2]!.x=x+width;p[2]!.y=y+height;p[3]!.x=x;p[3]!.y=y+height
        return !classMarkerPiecesOverlap(pieces,paintRectangle,charge)
      }
      const own=source?input.edges[index]!.source:input.edges[index]!.target
      for(let node=0;node<nodes.length;node++){charge();if(node===own)continue;const box=nodes[node]!,half=(input.nodes[node]!.paintStrokeWidth??0)/2
        if(!markerBoxClear(box.x-half,box.y-half,box.width+2*half,box.height+2*half))return false}
      for(let group=0;group<frames.length;group++){charge();const box=frames[group]!,height=headerGroups[group]!.headerHeight??headerGroups[group]!.padding.top,half=(input.groups![group]!.paintStrokeWidth??0)/2
        if(height>0&&!markerBoxClear(box.x-half,box.y-half,box.width+2*half,height+2*half))return false}
      for(let other=0;other<input.edges.length;other++){charge();const label=input.edges[other]!.label,center=placed.edges[other]!.labelPosition
        if(label&&center&&!markerBoxClear(center.x-label.width/2-2,center.y-label.height/2-2,label.width+4,label.height+4))return false}
      return true
    }, widthProof, input.maximumEdgeBendRadius??0, {bounds:seatingBounds,obstacles:seatingObstacles}, input.maximumEdgeBendRadius===0 ? (index,witness) => {
      charge(5)
      witness.candidateSegment=witness.peerIndex=witness.peerSegment=-1
      if(markerCurrentProofs.has(index))return false
      if(validate(index,placed.edges[index]!.points,witness,!proveAll)){
        reserve(1)
        markerCurrentProofs.add(index)
        return false
      }
      // Only an exact sharp refusal owns a support witness. Metric, body,
      // label, unknown or exhausted results cannot become a repair license.
      charge(6)
      if(witness.peerIndex<0||witness.peerIndex>=placed.edges.length||witness.peerIndex===index||witness.candidateSegment<1||witness.candidateSegment>=placed.edges[index]!.points.length||witness.peerSegment<1||witness.peerSegment>=placed.edges[witness.peerIndex]!.points.length)fail('Measured final route violates its owned path or contact reservation')
      return true
    } : undefined)
    if(proveAll)for(let index=0;index<placed.edges.length;index++){
      charge(2)
      if(markerCurrentProofs.has(index))continue
      if(!validate(index,placed.edges[index]!.points))fail('Measured final route violates its owned path or contact reservation')
      if(--work.arcs<0)fail('agentic marker full-proof capacity limit')
      markerCurrentProofs.add(index)
    }
    return markerCurrentProofs
}

/** Flat producers need the same complete marker/path closure. The caller passes
 * the RAW producer's original request ledger. No hierarchy search is repeated. */
export function finalizeFlatMeasuredMarkers(input: MeasuredGraph, placed: AgenticLayout, work: ChannelWork, expansionLimit: number, fail: (reason: string) => never): AgenticLayout {
  if(input.placementOnly || input.groups?.length || input.maximumEdgeStrokeWidth===undefined)return placed
  let marker=false
  for(const edge of input.edges){if(--work.pairs<0)fail('agentic marker metadata work limit');if(edge.markerPaint?.start?.length||edge.markerPaint?.end?.length){marker=true;break}}
  if(!marker){
    if(input.maximumEdgeBendRadius===0){
      reserveContactBounds(work,fail)
      if(--work.pairs<0)fail('agentic marker full-proof work limit')
      assertFinalBoundaryContacts(input,placed,new Set(),work,fail)
    }
    return placed
  }
  const count=input.nodes.length, edges=input.edges.length
  // Body records + both reference arrays, two empty frame views, the set and
  // its slots, and the retained point-reservation closure: reserve before work.
  work.arcs-=3*count+edges+7;work.pairs-=2*count+edges+4
  if(work.arcs<0)fail('agentic flat marker metadata capacity limit')
  if(work.pairs<0)fail('agentic flat marker metadata work limit')
  let expanded=placed.expandedVertices??0
  const reserveExpanded=(amount:number):void=>{
    if(!Number.isSafeInteger(amount)||amount<0)throw new TypeError('Invalid measured marker point reservation')
    if(expanded+amount>expansionLimit)fail('agentic local cross-hierarchy visibility-expansion limit')
    expanded+=amount
  }
  const nodes=placed.nodes.map((point,index):RoutingBox=>({...point,width:input.nodes[index]!.width,height:input.nodes[index]!.height})),subjects=[...nodes]
  const frames:RoutingBox[]=[],headerGroups:NonNullable<MeasuredGraph['groups']>=[],rescued=new Set<number>()
  for(let index=0;index<edges;index++)rescued.add(index)
  // Forest producers may retain duplicate/monotone subdivision vertices.
  // Compact that identical ink before interpreting actual terminal tangents;
  // reversals survive and still fail the complete self-contact proof.
  for(const route of placed.edges){if(--work.pairs<0)fail('agentic flat marker path work limit');compactProvedPath(route.points,work,fail)}
  const proofs=seatFinalMeasuredMarkers(input,placed,nodes,frames,subjects,headerGroups,work,reserveExpanded,fail,rescued,Math.max(8,input.edgeSpacing??6),input.maximumEdgeStrokeWidth,true)
  // The final contact owner reserves its own map/scratch for every entry.
  assertFinalBoundaryContacts(input,placed,rescued,work,fail,proofs)
  // Every current carrier participates in marker proofs, including an
  // unchanged route. The original shortening must preserve all of them.
  work.arcs-=edges+2;work.pairs-=edges
  if(work.arcs<0)fail('agentic marker full-proof capacity limit')
  if(work.pairs<0)fail('agentic marker full-proof work limit')
  const boundaryRoutes:number[]=[]
  for(let index=0;index<edges;index++)boundaryRoutes.push(index)
  return {...placed,expandedVertices:expanded,boundaryRoutes}
}

export function routeCrossHierarchy(
  input: MeasuredGraph, placed: AgenticLayout, owners: Int32Array,
  lifted: ReadonlyMap<number, { source: number; target: number; host: number }>, directions: readonly Direction[],
  work: ChannelWork, expansionLimit: number, fail: (reason: string) => never,
  ancestorPlan?: AncestorBoundaryPlan,
): AgenticLayout {
  const leafCount = input.nodes.length, frames = placed.groups!, groups = input.groups!
  const headerGroups = ancestorPlan?.groups ?? groups
  // Larger inputs can use bounded corridors and sparse visibility, but never
  // the Cartesian grid whose scope envelope remains unchanged.
  const directOnly = groups.length > 16 || lifted.size > 16 || input.edges.length > 128
  let routePoints = placed.edges.reduce((sum, edge) => sum + edge.points.length, 0)
  if (routePoints > 2048) fail('agentic local cross-hierarchy route-point limit')
  let expanded = placed.expandedVertices ?? 0
  // Strategy eligibility retains the original cumulative eager-grid envelope.
  // Physical allocations remain separately reserved by the shared ledger.
  let primaryVirtual = expanded
  const reserveExpanded = (amount: number): void => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError('Invalid compound visibility reservation')
    if (expanded + amount > expansionLimit) fail('agentic local cross-hierarchy visibility-expansion limit')
    expanded += amount
  }
  let queryWorkspaces: SparseQueryWorkspacePool | undefined
  const sparseWorkspaces = () => queryWorkspaces ??= createSparseQueryWorkspacePool(reserveExpanded, fail)
  let adjacencyStorage: ReturnType<typeof createSparseAdjacencyStoragePool> | undefined
  const sparseAdjacencies = () => adjacencyStorage ??= createSparseAdjacencyStoragePool(amount => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError('Invalid compound adjacency reservation')
    work.arcs -= amount
    if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
  }, fail)
  const widthProof = (input as MeasuredGraph & { maximumEdgeStrokeWidth?: number }).maximumEdgeStrokeWidth
  if (widthProof !== undefined) {
    reserveContactBounds(work, fail, 2)
    if (--work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
  }
  const reservePhysicalContact = widthProof === undefined ? undefined : (amount: number): void => reserveContactBounds(work, fail, amount)
  const chargePhysicalContact = widthProof === undefined ? undefined : (amount: number): void => {
    work.pairs -= amount
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
  }
  let markerPaint = false
  if(widthProof!==undefined)for(const edge of input.edges){if(--work.pairs<0)fail('agentic marker metadata work limit');if(edge.markerPaint?.start?.length||edge.markerPaint?.end?.length){markerPaint=true;break}}
  const clearance = Math.max(8, input.edgeSpacing ?? 6)
  const nodes = placed.nodes.map((point, index): RoutingBox => ({ ...point, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
  const subjects = [...nodes, ...frames]
  const completed = new Set<number>()
  const rescued = new Set<number>()
  let solidIndexFactory: ReturnType<typeof createOwnedCompoundObstacleIndexFactory> | undefined
  let peerOwner: PeerGeometryOwner | undefined
  let markerCurrentProofs: Set<number> | undefined
  for (const [index, endpoints] of lifted) for (let paddingAttempt = 0; paddingAttempt < 2; paddingAttempt++) {
    let peerLease: PeerLease | undefined
    let publishPeer = false
    let graphs: { retire: () => void }[] | undefined
    const keepGraph = <T extends { retire: () => void }>(graph: T): T => {
      graphs ??= []
      graphs.push(graph)
      return graph
    }
    try {
      work.pairs -= nodes.length + frames.length
      if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
      const edge = input.edges[index]!, raw = placed.edges[index]!
      const quotient = simplifyOrthogonal(raw.points)
      if (quotient.length < 2 || edge.label && !raw.labelPosition) throw new TypeError('Compound quotient lost its route or label')
      const crossingSource = edge.source !== endpoints.source, crossingTarget = edge.target !== endpoints.target
      const escape = (a: Point, b: Point, distance = clearance): Point => {
        const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y), offset = Math.min(distance, length / 2)
        return { x: a.x + Math.sign(b.x - a.x) * offset, y: a.y + Math.sign(b.y - a.y) * offset }
      }
      const start = crossingSource ? escape(quotient[0]!, quotient[1]!) : quotient[0]!
      const end = crossingTarget ? escape(quotient.at(-1)!, quotient.at(-2)!) : quotient.at(-1)!
      const core = [start, ...quotient.slice(1, -1), end]
      const related = new Set<number>()
      for (const endpoint of [edge.source, edge.target]) for (let parent = owners[endpoint]!; parent >= 0; parent = owners[leafCount + parent]!) related.add(parent)
      const obstacles: RoutingBox[] = nodes.map((box, node) => node === edge.source || node === edge.target ? box : inflate(box, clearance))
      for (let group = 0; group < frames.length; group++) {
        const frame = frames[group]!
        // Endpoint ports lie on this box. Inflation would make every port
        // unreachable; the actual box still forbids a route through its interior.
        if (leafCount + group === edge.source || leafCount + group === edge.target) obstacles.push(frame)
        else if (!related.has(group)) obstacles.push(inflate(frame, clearance))
        else if (groups[group]!.padding.top > 0) obstacles.push(inflate({ ...frame, height: ancestorPlan || leafCount > 64 ? (headerGroups[group]!.headerHeight ?? headerGroups[group]!.padding.top) : groups[group]!.padding.top }, Math.max(2, (input.edgeSpacing ?? 6) / 2)))
      }
      const solidObstacles = [...obstacles]
      let ownReservedLabel: RoutingBox | undefined
      if (edge.label && --work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
      for (let other = 0; other < placed.edges.length; other++) {
        if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
        const route = placed.edges[other]!, measured = input.edges[other]!
        if (measured.label && route.labelPosition) {
          const label = inflate({ x: route.labelPosition.x - measured.label.width / 2, y: route.labelPosition.y - measured.label.height / 2, width: measured.label.width, height: measured.label.height }, 2)
          obstacles.push(label)
          solidObstacles.push(label)
          if (other === index) ownReservedLabel = label
        }
        if (other === index || measured.visible === false || ancestorPlan?.connections.has(other)) continue
        for (let cursor = 1; cursor < route.points.length; cursor++) {
          if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
          const a = route.points[cursor - 1]!, b = route.points[cursor]!
          obstacles.push(inflate({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }, Math.max(2, (input.edgeSpacing ?? 6) / 2)))
        }
      }
      let solidIndex: CompoundObstacleQueries | undefined
      const solidQueries = () => solidIndex ??= (solidIndexFactory ??= createOwnedCompoundObstacleIndexFactory(work, fail))(solidObstacles)
      const host = endpoints.host, frame = host < 0 ? undefined : frames[host], pad = host < 0 ? undefined : headerGroups[host]!.padding
      work.pairs -= 8 // Painted host eligibility, stroke/corner inset and domain selection.
      if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
      const hostRadius = host < 0 ? undefined : groups[host]!.paintCornerRadius
      const paddingInset = widthProof === undefined || hostRadius === undefined ? Infinity : (widthProof + (groups[host]!.paintStrokeWidth ?? 0)) / 2 + hostRadius + 1
      const bounds = frame && pad ? paddingAttempt === 0
        ? { x: frame.x + pad.left, y: frame.y + pad.top, width: frame.width - pad.left - pad.right, height: frame.height - pad.top - pad.bottom }
        : { x: frame.x + paddingInset, y: frame.y + pad.top, width: frame.width - 2 * paddingInset, height: frame.height - pad.top - paddingInset }
        : { x: 0, y: 0, width: placed.width, height: placed.height }
      const sources = crossingSource ? terminals(subjects[edge.source]!, directions[owners[edge.source]! + 1]!, true, clearance) : []
      const targets = crossingTarget ? terminals(subjects[edge.target]!, directions[owners[edge.target]! + 1]!, false, clearance) : []
      const endpointFrames = (endpoint: number): RoutingBox[] => {
        const result: RoutingBox[] = []
        for (let group = owners[endpoint]!; group >= 0; group = owners[leafCount + group]!) {
          if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
          result.push(frames[group]!)
        }
        return result
      }
      let points: Point[] | undefined
      let rejected: Point[] | undefined
      let decline = 'agentic local cross-hierarchy size limit'
      const corridorFail = (reason: string): never => {
        if (reason === 'agentic local cross-hierarchy visibility-expansion limit'
          || reason === 'cross-hierarchy route has no bounded clear corridor'
          || reason === 'cross-hierarchy route needs an unsupported self-contact repair') throw new BoundaryRouteDecline(reason)
        return fail(reason)
      }
      if (!directOnly) try {
        let first = crossingSource ? undefined : [start]
        let last = crossingTarget ? undefined : [end]
        if (leafCount > 64) {
          const probes = { pairs: Math.min(16384, Math.floor(work.pairs / 8)), candidates: 64 }
          if (!first) first = directCorridor(bounds, obstacles, sources, start, endpointFrames(edge.source), clearance, work, probes, fail)
          if (!last) last = directCorridor(bounds, obstacles, targets, end, endpointFrames(edge.target), clearance, work, probes, fail)?.reverse()
          if (!first || !last) fail('large cross-hierarchy route has no bounded direct corridor')
        }
        if (!first || !last) {
          const remaining = expansionLimit - expanded
          const grid = createLazyVisibilityGrid(bounds, obstacles, [...sources, ...targets], [start, end], clearance, work, remaining, corridorFail, reserveExpanded)
          // Preserve the old primary's eligibility. A virtual grid that it
          // declined should not consume the sparse strategy's capacity first.
          if (grid.virtualVertices > remaining || grid.virtualVertices > expansionLimit - primaryVirtual) corridorFail('agentic local cross-hierarchy visibility-expansion limit')
          primaryVirtual += grid.virtualVertices
          first ??= grid.route(sources, start)
          last ??= grid.route(targets, end).reverse()
        }
        points = simplifyOrthogonal([...first, ...core.slice(1, -1), ...last])
        if (selfContact(points, work, fail)) {
          rejected = points
          corridorFail('cross-hierarchy route needs an unsupported self-contact repair')
        }
      } catch (error) {
        if (!(error instanceof BoundaryRouteDecline)) throw error
        decline = error.reason
        points = undefined
      }
      if (!points) {
        const probes = { pairs: Math.min(16384, Math.floor(work.pairs / 8)), candidates: 64 }
        let routeStart = crossingSource ? escape(quotient[0]!, quotient[1]!, clearance * 2) : start
        let routeEnd = crossingTarget ? escape(quotient.at(-1)!, quotient.at(-2)!, clearance * 2) : end
        let routeCore = [routeStart, ...quotient.slice(1, -1), routeEnd]
        if (edge.label && !routeCore.some((point, cursor) => cursor > 0 && onSegment(raw.labelPosition!, routeCore[cursor - 1]!, point))) {
          routeStart = start
          routeEnd = end
          routeCore = core
        }
        // A pending quotient still terminates on an ancestor frame. Its pair is
        // checked when its authored leaf route is finalized below.
        const routes = placed.edges.map((route, other) => ({ ...route, style: input.edges[other]!.visible === false || ancestorPlan?.connections.has(other) || lifted.has(other) && !completed.has(other) ? 'invisible' : 'solid' }))
        const contactsClear = createBoundaryProposalContactValidator(input, index, routes, work, fail)
        const accept = (path: Point[]): Point[] | undefined => {
          const candidate = selfContact(path, work, fail) ? removeClosedExcursions(path, work, fail) : path
          if (candidate.length < 2) return
          for (const source of [true, false]) {
            work.pairs -= 4
            if (work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
            const port = source ? path[0]! : path.at(-1)!, toward = source ? path[1]! : path.at(-2)!
            const endpoint = source ? candidate[0]! : candidate.at(-1)!, next = source ? candidate[1]! : candidate.at(-2)!
            const box = subjects[source ? edge.source : edge.target]!
            const dx = toward.x - port.x, dy = toward.y - port.y
            const length = Math.abs(dx) + Math.abs(dy), lead = Math.min(clearance, length)
            const stub = { x: port.x + Math.sign(dx) * lead, y: port.y + Math.sign(dy) * lead }
            if (endpoint.x !== port.x || endpoint.y !== port.y || !onSegment(stub, endpoint, next)) return
            if (endpoint.x < box.x - 1e-7 || endpoint.x > box.x + box.width + 1e-7 || endpoint.y < box.y - 1e-7 || endpoint.y > box.y + box.height + 1e-7) return
            const outward = Math.abs(endpoint.x - box.x) < 1e-7 && next.y === endpoint.y && next.x < endpoint.x
              || Math.abs(endpoint.x - box.x - box.width) < 1e-7 && next.y === endpoint.y && next.x > endpoint.x
              || Math.abs(endpoint.y - box.y) < 1e-7 && next.x === endpoint.x && next.y < endpoint.y
              || Math.abs(endpoint.y - box.y - box.height) < 1e-7 && next.x === endpoint.x && next.y > endpoint.y
            if (!outward) return
          }
          if (edge.label && !candidate.some((point, cursor) => cursor > 0 && onSegment(raw.labelPosition!, candidate[cursor - 1]!, point))) return
          // The reserve covers segment contact checks, exact crossing scoring,
          // and preparation. Proper crossings remain visible and counted;
          // coincident shafts and uncounted bend/T contacts are rejected.
          return contactsClear(candidate) ? candidate : undefined
        }
        if (rejected) points = accept(rejected)
        const finish = (first: Point[]): boolean => {
          if (!crossingTarget) {
            const candidate = simplifyOrthogonal([...first, ...routeCore.slice(1)])
            const accepted = accept(candidate)
            if (accepted) { points = accepted; return true }
            return false
          }
          return directCorridor(bounds, solidObstacles, targets, routeEnd, endpointFrames(edge.target), clearance, work, probes, fail, last => {
            const candidate = simplifyOrthogonal([...first, ...routeCore.slice(1, -1), ...last.toReversed()])
            const accepted = accept(candidate)
            if (accepted) { points = accepted; return true }
            return false
          }, true, solidQueries) !== undefined
        }
        let legacyDirect: (()=>void)|undefined
        if(widthProof!==undefined&&!points){
          work.arcs-=32 // retained wrapper header/captures BEFORE allocation
          if(work.arcs<0)fail('agentic local cross-hierarchy visibility-arc limit')
          legacyDirect=()=>{
        if (!points && !edge.label) {
          const starts = terminals(subjects[edge.source]!, directions[owners[edge.source]! + 1]!, true, clearance)
          const ends = terminals(subjects[edge.target]!, directions[owners[edge.target]! + 1]!, false, clearance)
          const borders = [...endpointFrames(edge.source), ...endpointFrames(edge.target)]
          for (let fraction = 0; fraction < 3 && !points && probes.candidates > 0; fraction++) for (let side = 0; side < 4 && !points && probes.candidates > 0; side++) {
            const target = ends[side * 3 + fraction]!
            let clear = true
            for (const box of solidObstacles) {
              if (probes.pairs-- <= 0) { clear = false; break }
              if (--work.pairs < 0) fail('agentic local cross-hierarchy direct-pair limit')
              if (segmentEntersMeasuredBox(target.stub, target.port, box)) { clear = false; break }
            }
            if (!clear) continue
            directCorridor(bounds, solidObstacles, starts, target.stub, borders, clearance, work, probes, fail, first => {
              const candidate = simplifyOrthogonal([...first, target.port])
              const accepted = accept(candidate)
              if (accepted) { points = accepted; return true }
              return false
            }, true, solidQueries)
          }
        } else if (!points && crossingSource) directCorridor(bounds, solidObstacles, sources, routeStart, endpointFrames(edge.source), clearance, work, probes, fail, finish, true, solidQueries)
        else if (!points) finish([routeStart])
          }
        }else if(widthProof===undefined){
        if (!points && !edge.label) {
          const starts = terminals(subjects[edge.source]!, directions[owners[edge.source]! + 1]!, true, clearance)
          const ends = terminals(subjects[edge.target]!, directions[owners[edge.target]! + 1]!, false, clearance)
          const borders = [...endpointFrames(edge.source), ...endpointFrames(edge.target)]
          for (let fraction = 0; fraction < 3 && !points && probes.candidates > 0; fraction++) for (let side = 0; side < 4 && !points && probes.candidates > 0; side++) {
            const target = ends[side * 3 + fraction]!
            let clear = true
            for (const box of solidObstacles) {
              if (probes.pairs-- <= 0) { clear = false; break }
              if (--work.pairs < 0) fail('agentic local cross-hierarchy direct-pair limit')
              if (segmentEntersMeasuredBox(target.stub, target.port, box)) { clear = false; break }
            }
            if (!clear) continue
            directCorridor(bounds, solidObstacles, starts, target.stub, borders, clearance, work, probes, fail, first => {
              const candidate = simplifyOrthogonal([...first, target.port])
              const accepted = accept(candidate)
              if (accepted) { points = accepted; return true }
              return false
            }, true, solidQueries)
          }
        } else if (!points && crossingSource) directCorridor(bounds, solidObstacles, sources, routeStart, endpointFrames(edge.source), clearance, work, probes, fail, finish, true, solidQueries)
        else if (!points) finish([routeStart])
        }
        if (!points) try {
          const sparseTerminals = (endpoint: number, source: boolean): Terminal[] => {
            let degree = 0, ordinal = 0, leadSegments = 0
            const incident = routes.map((route, other) => {
              if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
              const peer = input.edges[other]!, owns = peer.source === endpoint || peer.target === endpoint
              if (owns) { degree++; if (other < index) ordinal++ }
              const style = owns ? route.style : 'invisible'
              if (other !== index && style !== 'invisible') leadSegments += Math.max(0, route.points.length - 1)
              return { ...route, style }
            })
            const fractions = [...new Set([(ordinal + 1) / (degree + 1), .5, .25, .75])]
            return terminals(subjects[endpoint]!, directions[owners[endpoint]! + 1]!, source, clearance, fractions).filter(terminal => {
              work.pairs -= 4 * leadSegments + 2
              if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
              // Finalized incident edges already own their physical escape rays.
              // Reject occupied rays before shortest-path state merging can hide
              // an available occurrence-specific port behind the same goal state.
              return scoreMeasuredRouteProposalCrossings(source ? [terminal.port, terminal.stub] : [terminal.stub, terminal.port], index, incident, input, chargePhysicalContact, reservePhysicalContact) !== undefined
            })
          }
          const lateTerminals = (endpoint: number, source: boolean): Terminal[] => {
            let degree = 0, ordinal = 0
            for (let other = 0; other < input.edges.length; other++) {
              if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
              const peer = input.edges[other]!
              if (peer.source === endpoint || peer.target === endpoint) { degree++; if (other < index) ordinal++ }
            }
            // Four terminal records, four retained slots and eight physical
            // points are reserved before this additional phase materializes.
            work.arcs -= 8
            if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
            reserveExpanded(8)
            const box = subjects[endpoint]!, direction = directions[owners[endpoint]! + 1]!, fraction = (ordinal + .5) / (degree + 1)
            const forward = direction === 'LR' ? 'E' : direction === 'RL' ? 'W' : direction === 'BT' ? 'N' : 'S'
            const preferred = source ? forward : forward === 'N' ? 'S' : forward === 'S' ? 'N' : forward === 'E' ? 'W' : 'E'
            const roots = new Array<Terminal>(4)
            // This constant four-face order matches the original generator.
            const sideAt = (index: number): 'N' | 'E' | 'S' | 'W' => index === 0 ? preferred
              : preferred === 'N' ? index === 1 ? 'E' : index === 2 ? 'S' : 'W'
                : preferred === 'E' ? index === 1 ? 'N' : index === 2 ? 'S' : 'W'
                  : preferred === 'S' ? index === 1 ? 'N' : index === 2 ? 'E' : 'W'
                    : index === 1 ? 'N' : index === 2 ? 'E' : 'S'
            for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
              if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
              const side = sideAt(sideIndex)
              const port = side === 'N' || side === 'S'
                ? { x: box.x + fraction * box.width, y: side === 'N' ? box.y : box.y + box.height }
                : { x: side === 'W' ? box.x : box.x + box.width, y: box.y + fraction * box.height }
              const stub = { x: port.x + (side === 'E' ? clearance * 2 : side === 'W' ? -clearance * 2 : 0), y: port.y + (side === 'S' ? clearance * 2 : side === 'N' ? -clearance * 2 : 0) }
              roots[sideIndex] = { port, stub, penalty: sideIndex * clearance * 2 + Math.abs(fraction - .5) * clearance }
            }
            return roots
          }
          let constructiveAccept=accept
          if(widthProof!==undefined){
            work.arcs-=4
            if(work.arcs<0)fail('agentic local cross-hierarchy visibility-arc limit')
            constructiveAccept=path=>accept(compactProvedPath(path,work,fail))
          }
          const starts = edge.label && !crossingSource ? [] : sparseTerminals(edge.source, true)
          const ends = edge.label && !crossingTarget ? [] : sparseTerminals(edge.target, false)
          // Revisions own geometry, never search results. Seed only at the first
          // sparse request; all earlier completed routes are already in routes.
          peerOwner ??= createPeerGeometryOwner(routes, index, placed.width, placed.height, work, reserveExpanded, fail)
          peerLease = peerOwner.acquire(index)
          const peerShafts = peerOwner.rails
          const canTraverse = peerLease.guard
          const hasEligibleRoot = (roots: readonly Terminal[]): boolean => {
            const inside = (point: Point): boolean => point.x >= bounds.x && point.x <= bounds.x + bounds.width
              && point.y >= bounds.y && point.y <= bounds.y + bounds.height
            for (const terminal of roots) {
              work.pairs -= 8
              if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
              const { port, stub } = terminal
              if (!inside(port) || !inside(stub)) continue
              const obstacles = solidQueries()
              if (obstacles.containsPoint(port.x, port.y) || obstacles.containsPoint(stub.x, stub.y)
                || obstacles.entersSegment(port.x, port.y, stub.x, stub.y)) continue
              const axis = port.x === stub.x ? 2 : port.y === stub.y ? 1 : 0
              if (!axis) throw new TypeError('Measured terminal lead must be orthogonal')
              if (canTraverse(port, stub, axis, axis)) return true
            }
            return false
          }
          const attempt = (route: () => void): boolean => {
            try { route(); return points !== undefined } catch (error) {
              if (!(error instanceof BoundaryRouteDecline)) throw error
              decline = error.reason
              return false
            }
          }
          if (!edge.label) {
            if (widthProof !== undefined) {
            work.pairs -= 2 // Explicit measured stroke proof preparation
            if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
            peerOwner.enterQuery(peerLease)
            try { points = proposeOuterChannel(bounds, solidObstacles, starts, ends, peerShafts, solidQueries(), work, reserveExpanded, fail, canTraverse, constructiveAccept, Math.max(.5, widthProof)) }
            finally { peerOwner.leaveQuery(peerLease) }
            }
            if(widthProof!==undefined){work.pairs-=2;if(work.pairs<0)fail('agentic local cross-hierarchy crossing-work limit')}
            if(!points&&legacyDirect)legacyDirect()
            const search = (interiorChannels: boolean): void => {
              const graph = keepGraph(createSparseVisibilityGraph(bounds, solidObstacles, [...starts, ...ends], [routeStart, routeEnd], clearance, work, expansionLimit - expanded, corridorFail, reserveExpanded, interiorChannels, solidQueries, sparseWorkspaces(), peerShafts, sparseAdjacencies()))
              try { for (const target of ends) {
                if (points) break
                if (!solidQueries().entersSegment(target.stub.x, target.stub.y, target.port.x, target.port.y)) attempt(() => {
                  peerOwner!.enterQuery(peerLease!)
                  try { graph.route(starts, target.stub, first => {
                    const accepted = accept(simplifyOrthogonal([...first, target.port]))
                    if (accepted) { points = accepted; return true }
                    return false
                  }, canTraverse) } finally { peerOwner!.leaveQuery(peerLease!) }
                })
              } } finally { graph.retire() }
            }
            if (!points) search(false)
            if (!points && decline === 'cross-hierarchy route has no bounded clear corridor') search(true)
          } else {
            if (widthProof !== undefined && !crossingSource && crossingTarget && ownReservedLabel) {
              work.pairs -= 2 // Explicit measured stroke proof preparation
              if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
              peerOwner.enterQuery(peerLease)
              try { points = proposeRetainedLabelChannel(routeCore, subjects[edge.source]!, raw.labelPosition!, ownReservedLabel, bounds, solidObstacles, ends, peerShafts, solidQueries(), work, clearance, Math.max(.5, widthProof), reserveExpanded, fail, canTraverse, constructiveAccept) }
              finally { peerOwner.leaveQuery(peerLease) }
            }
            if(widthProof!==undefined){work.pairs-=2;if(work.pairs<0)fail('agentic local cross-hierarchy crossing-work limit')}
            if(!points&&legacyDirect)legacyDirect()
            if (!points) {
            const frameFor = (endpoint: number): RoutingBox => owners[endpoint]! < 0 ? subjects[endpoint]! : frames[owners[endpoint]!]!
            type Suffixes = { roots: readonly Terminal[]; interiorChannels: boolean; late?: boolean; graph?: ReturnType<typeof createEndpointSparseVisibilityGraph>; paths: Point[][]; complete: boolean }
            const ordinary: Suffixes = { roots: ends, interiorChannels: false, paths: [], complete: false }
            const guided: Suffixes = { roots: ends, interiorChannels: true, paths: [], complete: false }
            const sourcePaths: Point[][] = []
            const finishSparse = (first: Point[], target = ordinary): boolean => {
              if (!crossingTarget) {
                const accepted = accept(simplifyOrthogonal([...first, ...routeCore.slice(1)]))
                if (accepted) { points = accepted; return true }
                return false
              }
              const join = (last: Point[]): boolean => {
                const accepted = accept(simplifyOrthogonal([...first, ...routeCore.slice(1, -1), ...last.toReversed()]))
                if (accepted) { points = accepted; return true }
                return false
              }
              // Each phase retains only its own immutable terminal domain.
              // Complete suffixes may be joined to later actual source paths.
              for (const last of target.paths) if (join(last)) return true
              if (target.complete) return false
              if (!target.graph && !hasEligibleRoot(target.roots)) {
                target.complete = true
                decline = 'cross-hierarchy route has no bounded clear corridor'
                return false
              }
              const selected = attempt(() => {
                target.graph ??= keepGraph(createEndpointSparseVisibilityGraph(bounds, frameFor(edge.target), solidObstacles, target.roots, routeEnd, clearance, work, expansionLimit - expanded, corridorFail, reserveExpanded, target.interiorChannels, solidQueries, sparseWorkspaces(), peerShafts, sparseAdjacencies()))
                peerOwner!.enterQuery(peerLease!)
                try { target.graph.route(target.roots, routeEnd, last => {
                  if (target.late && --work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
                  target.paths.push(last)
                  return join(last)
                }, canTraverse) } finally { peerOwner!.leaveQuery(peerLease!) }
              })
              if (!selected && decline === 'cross-hierarchy route has no bounded clear corridor') target.complete = true
              if (target.complete || selected) target.graph?.retire()
              return selected
            }
            const searchSource = (roots: readonly Terminal[], interiorChannels: boolean, visit: (path: Point[]) => boolean): boolean => {
              if (!hasEligibleRoot(roots)) {
                decline = 'cross-hierarchy route has no bounded clear corridor'
                return false
              }
              return attempt(() => {
                const graph = keepGraph(createEndpointSparseVisibilityGraph(bounds, frameFor(edge.source), solidObstacles, roots, routeStart, clearance, work, expansionLimit - expanded, corridorFail, reserveExpanded, interiorChannels, solidQueries, sparseWorkspaces(), peerShafts, sparseAdjacencies()))
                peerOwner!.enterQuery(peerLease!)
                try { graph.route(roots, routeStart, visit, canTraverse) }
                finally { try { peerOwner!.leaveQuery(peerLease!) } finally { graph.retire() } }
              })
            }
            const ordinarySource = (first: Point[]): boolean => { sourcePaths.push(first); return finishSparse(first) }
            if (crossingSource) searchSource(starts, false, ordinarySource)
            else ordinarySource([routeStart])
            if (!points && decline === 'cross-hierarchy route has no bounded clear corridor') {
              if (crossingTarget) for (const first of sourcePaths) if (finishSparse(first, guided)) break
              if (!points && crossingSource) searchSource(starts, true, first => {
                if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
                sourcePaths.push(first)
                return finishSparse(first) || finishSparse(first, guided)
              })
            }
            if (!points && decline === 'cross-hierarchy route has no bounded clear corridor') {
              // One additional authored occurrence sample per face. Legacy
              // ordinary/guided attempts remain first and retain their roots.
              let late: Suffixes | undefined
              if (crossingTarget) {
                const roots = lateTerminals(edge.target, false)
                if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
                late = { roots, interiorChannels: false, late: true, paths: [], complete: false }
              }
              if (late) for (const first of sourcePaths) if (finishSparse(first, late)) break
              if (!points && crossingSource) searchSource(lateTerminals(edge.source, true), false,
                first => finishSparse(first) || crossingTarget && (finishSparse(first, guided) || finishSparse(first, late!)))
            }
            }
          }
        } catch (error) {
          if (!(error instanceof BoundaryRouteDecline)) throw error
          decline = error.reason
        }
        if (!points) {
          // Content padding is blank routing space. Retry inside the host's
          // painted border (including corners) only after the original content
          // domain is blocked. Missing canonical radius keeps the old refusal.
          // Each strategy has bounded probes; both attempts share the original
          // cumulative work/vertex ledgers without replenishing any global cap.
          if (paddingAttempt === 0 && frame && pad && widthProof !== undefined
            && groups[host]!.paintStrokeWidth !== undefined && paddingInset < pad.left
            && paddingInset < pad.right && paddingInset < pad.bottom
            && decline === 'cross-hierarchy route has no bounded clear corridor') continue
          fail(decline)
        }
        rescued.add(index)
      }
      const finalPoints = points
      if (edge.label && !finalPoints.some((point, cursor) => cursor > 0 && onSegment(raw.labelPosition!, finalPoints[cursor - 1]!, point))) fail('cross-hierarchy route lost its reserved label corridor')
      routePoints += finalPoints.length - raw.points.length
      if (routePoints > 2048) fail('agentic local cross-hierarchy route-point limit')
      placed.edges[index] = { ...raw, points: finalPoints }
      completed.add(index)
      publishPeer = true
    } finally {
      // Old source/target/guided graphs and nested callbacks end BEFORE release.
      try { if (graphs) for (const graph of graphs) graph.retire() }
      finally { peerLease?.release() }
    }
    // Publish EVERY successful lifted occurrence once the owner exists,
    // including primary/direct successes with no sparse lease of their own.
    if (publishPeer && peerOwner) peerOwner.publish(index, placed.edges[index]!.points,
      input.edges[index]!.visible !== false && !ancestorPlan?.connections.has(index))
    break
  }
  if (ancestorPlan?.connections.size) {
    const finalized = new Set<number>()
    for (const [index, connection] of ancestorPlan.connections) {
      const edge = input.edges[index]!, raw = placed.edges[index]!
      const routes = placed.edges.map((route, other) => ({ ...route, style: input.edges[other]!.visible === false || ancestorPlan.connections.has(other) && !finalized.has(other) ? 'invisible' : 'solid' }))
      const peerSegments = routes.reduce((sum, route, other) => sum + (other === index || route.style === 'invisible' ? 0 : Math.max(0, route.points.length - 1)), 0)
      const ancestors = new Set<number>()
      for (let parent = owners[connection.interior]!; parent >= 0; parent = owners[leafCount + parent]!) {
        if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
        ancestors.add(parent)
      }
      const forbidden: RoutingBox[] = [...nodes]
      for (let group = 0; group < frames.length; group++) {
        if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
        const header = headerGroups[group]!.headerHeight ?? headerGroups[group]!.padding.top
        if (!ancestors.has(group)) forbidden.push(frames[group]!)
        else if (header > 0) forbidden.push({ ...frames[group]!, height: header })
      }
      const result = routeAncestorBoundaryConnection(input, placed, owners, ancestorPlan, index, {
        work, remainingVertices: expansionLimit - expanded, reserveVertices: reserveExpanded, queryWorkspaces: sparseWorkspaces(), fail,
        accept(candidate) {
          const points = candidate.points
          if (points.length < 2 || points.some((point, cursor) => !Number.isFinite(point.x + point.y)
            || cursor > 0 && point.x !== points[cursor - 1]!.x && point.y !== points[cursor - 1]!.y)) throw new TypeError('Ancestor boundary producer returned invalid points')
          if (selfContact(points, work, fail)) return false
          const start = connection.containerEnd === 'source', frame = frames[connection.container]!
          const port = start ? points[0]! : points.at(-1)!, toward = start ? points[1]! : points.at(-2)!
          const header = headerGroups[connection.container]!.headerHeight ?? headerGroups[connection.container]!.padding.top
          if (Math.abs(port.x - frame.x) > 1e-7 || port.y < frame.y + header || port.y > frame.y + frame.height
            || toward.y !== port.y || toward.x - port.x < connection.minimumLead) return false
          const body = start ? points.at(-1)! : points[0]!, next = start ? points.at(-2)! : points[1]!, box = subjects[connection.interior]!
          if (body.x < box.x - 1e-7 || body.x > box.x + box.width + 1e-7 || body.y < box.y - 1e-7 || body.y > box.y + box.height + 1e-7) return false
          const outward = Math.abs(body.x - box.x) < 1e-7 && next.y === body.y && next.x < body.x
            || Math.abs(body.x - box.x - box.width) < 1e-7 && next.y === body.y && next.x > body.x
            || Math.abs(body.y - box.y) < 1e-7 && next.x === body.x && next.y < body.y
            || Math.abs(body.y - box.y - box.height) < 1e-7 && next.x === body.x && next.y > body.y
          if (!outward || Math.abs(next.x - body.x) + Math.abs(next.y - body.y) < ancestorPlan.clearance) return false
          if (edge.label && (!candidate.labelPosition || !points.some((point, cursor) => cursor > 0 && onSegment(candidate.labelPosition!, points[cursor - 1]!, point)))) return false
          for (let cursor = 1; cursor < points.length; cursor++) for (const obstacle of forbidden) {
            if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
            if (segmentEntersMeasuredBox(points[cursor - 1]!, points[cursor]!, obstacle)) return false
          }
          work.pairs -= measuredRouteContactPairBudget(input,'proposal') * Math.max(0, points.length - 1) * peerSegments + points.length + peerSegments
          if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
          return scoreMeasuredRouteProposalCrossings(points, index, routes, input, chargePhysicalContact, reservePhysicalContact) !== undefined
        },
      })
      routePoints += result.points.length - raw.points.length
      if (routePoints > 2048) fail('agentic local cross-hierarchy route-point limit')
      placed.edges[index] = { ...raw, ...result }
      finalized.add(index)
      rescued.add(index)
    }
  }
  // Marker seating runs after ALL old graph/query leases and before final
  // pair closure. It includes primary/local routes, not only boundary rescues.
  if(markerPaint)markerCurrentProofs=seatFinalMeasuredMarkers(input,placed,nodes,frames,subjects,headerGroups,work,reserveExpanded,fail,rescued,clearance,widthProof!)
  if (rescued.size || widthProof !== undefined && input.maximumEdgeBendRadius === 0) assertFinalBoundaryContacts(input, placed, rescued, work, fail, markerCurrentProofs)
  const boundaryRoutes = [...lifted.keys()]
  if (ancestorPlan?.connections.size) {
    for (const index of ancestorPlan.connections.keys()) if (!lifted.has(index)) boundaryRoutes.push(index)
    boundaryRoutes.sort((left, right) => left - right)
  }
  // Native shortening must not revise any newly certified primary/local
  // marker seat after its full combined-path proof and label reservation.
  if(markerPaint){
    let added=false
    for(const index of rescued){work.pairs-=boundaryRoutes.length+1;if(work.pairs<0)fail('agentic marker full-proof work limit')
      if(boundaryRoutes.includes(index))continue
      if(--work.arcs<0)fail('agentic marker full-proof capacity limit')
      boundaryRoutes.push(index);added=true
    }
    if(added)boundaryRoutes.sort((a,b)=>{if(--work.pairs<0)fail('agentic marker full-proof work limit');return a-b})
  }
  if(markerPaint){
    work.arcs-=input.edges.length+1;work.pairs-=input.edges.length
    if(work.arcs<0)fail('agentic marker full-proof capacity limit')
    if(work.pairs<0)fail('agentic marker full-proof work limit')
    const protectedRoutes=new Array<number>(input.edges.length)
    for(let index=0;index<input.edges.length;index++)protectedRoutes[index]=index
    return {...placed,expandedVertices:expanded,boundaryRoutes:protectedRoutes}
  }
  return { ...placed, expandedVertices: expanded, boundaryRoutes }
}
