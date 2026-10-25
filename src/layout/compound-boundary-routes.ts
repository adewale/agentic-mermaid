import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { Direction, Point } from '../types.ts'
import { scoreMeasuredRouteCrossings, segmentEntersMeasuredBox } from './measured-route-safety.ts'
import { simplifyOrthogonal, type RoutingBox, type Terminal } from './compound-visibility.ts'
import { createEndpointSparseVisibilityGraph, createSparseAdjacencyStoragePool, createSparseQueryWorkspacePool, createSparseVisibilityGraph, type SparseQueryWorkspacePool } from './compound-sparse-visibility.ts'
import { createLazyVisibilityGrid } from './compound-lazy-visibility.ts'
import { routeAncestorBoundaryConnection, type AncestorBoundaryPlan } from './ancestor-boundary-routes.ts'
import { createCompoundObstacleIndex, createCompoundPeerGuard, type CompoundObstacleQueries } from './compound-obstacle-index.ts'

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

/** Prepare one exact candidate check against the currently selected peers.
 * Hidden pending quotients retain metadata slots but execute no shaft pairs. */
export function createBoundaryContactValidator(
  input: MeasuredGraph, index: number, routes: readonly { points: Point[]; style: string }[],
  work: ChannelWork, fail: (reason: string) => never,
): (points: Point[]) => boolean {
  let peerSegments = 0
  for (let other = 0; other < routes.length; other++) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
    if (other !== index && routes[other]!.style !== 'invisible') peerSegments += Math.max(0, routes[other]!.points.length - 1)
  }
  return points => {
    work.pairs -= 3 * Math.max(0, points.length - 1) * peerSegments + points.length + peerSegments
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
    return scoreMeasuredRouteCrossings(points, index, routes, input) !== undefined
  }
}

/** Close every final pair involving a boundary rescue. Finite orthogonal
 * visible pairs are symmetric and need one exact check. Other candidates
 * retain the original directional checks against every visible peer. */
export function assertFinalBoundaryContacts(
  input: MeasuredGraph, placed: AgenticLayout, rescued: ReadonlySet<number>, work: ChannelWork, fail: (reason: string) => never,
): void {
  const charge = (amount = 1): void => {
    work.pairs -= amount
    if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
  }
  const routes = placed.edges.map((route, index) => {
    charge()
    let orthogonal = route.points.length >= 2
    for (let cursor = 0; orthogonal && cursor < route.points.length; cursor++) {
      charge()
      const point = route.points[cursor]!
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
        || cursor > 0 && point.x !== route.points[cursor - 1]!.x && point.y !== route.points[cursor - 1]!.y) orthogonal = false
    }
    return { ...route, style: input.edges[index]!.visible === false ? 'invisible' : 'solid', orthogonal, covered: false }
  })
  for (const index of rescued) {
    const route = routes[index]!, points = route.points
    const symmetric = route.orthogonal && input.edges[index]!.visible !== false
    let peerSegments = 0
    for (let other = 0; other < routes.length; other++) {
      charge()
      const peer = routes[other]!
      peer.style = input.edges[other]!.visible === false || symmetric && peer.covered ? 'invisible' : 'solid'
      if (other !== index && peer.style !== 'invisible') peerSegments += Math.max(0, peer.points.length - 1)
    }
    charge(3 * Math.max(0, points.length - 1) * peerSegments + points.length + peerSegments + routes.length)
    if (scoreMeasuredRouteCrossings(points, index, routes, input) === undefined) fail('cross-hierarchy routes have an uncertified shared contact')
    if (symmetric) route.covered = true
  }
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
  const clearance = Math.max(8, input.edgeSpacing ?? 6)
  const nodes = placed.nodes.map((point, index): RoutingBox => ({ ...point, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
  const subjects = [...nodes, ...frames]
  const completed = new Set<number>()
  const rescued = new Set<number>()
  for (const [index, endpoints] of lifted) {
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
      for (let other = 0; other < placed.edges.length; other++) {
        if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
        const route = placed.edges[other]!, measured = input.edges[other]!
        if (measured.label && route.labelPosition) {
          const label = inflate({ x: route.labelPosition.x - measured.label.width / 2, y: route.labelPosition.y - measured.label.height / 2, width: measured.label.width, height: measured.label.height }, 2)
          obstacles.push(label)
          solidObstacles.push(label)
        }
        if (other === index || measured.visible === false || ancestorPlan?.connections.has(other)) continue
        for (let cursor = 1; cursor < route.points.length; cursor++) {
          if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
          const a = route.points[cursor - 1]!, b = route.points[cursor]!
          obstacles.push(inflate({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }, Math.max(2, (input.edgeSpacing ?? 6) / 2)))
        }
      }
      let solidIndex: CompoundObstacleQueries | undefined
      const solidQueries = () => solidIndex ??= createCompoundObstacleIndex(solidObstacles, work, fail)
      const host = endpoints.host, frame = host < 0 ? undefined : frames[host], pad = host < 0 ? undefined : headerGroups[host]!.padding
      const bounds = frame && pad ? { x: frame.x + pad.left, y: frame.y + pad.top, width: frame.width - pad.left - pad.right, height: frame.height - pad.top - pad.bottom }
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
        const contactsClear = createBoundaryContactValidator(input, index, routes, work, fail)
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
              return scoreMeasuredRouteCrossings(source ? [terminal.port, terminal.stub] : [terminal.stub, terminal.port], index, incident, input) !== undefined
            })
          }
          const starts = edge.label && !crossingSource ? [] : sparseTerminals(edge.source, true)
          const ends = edge.label && !crossingTarget ? [] : sparseTerminals(edge.target, false)
          work.pairs -= routePoints + routes.length
          if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
          const peerShafts = routes.flatMap((route, other) => {
            if (other === index || route.style === 'invisible') return []
            const path = simplifyOrthogonal(route.points)
            return path.slice(1).map((point, cursor) => [path[cursor]!, point] as const)
          })
          const canTraverse = createCompoundPeerGuard(peerShafts, work, fail)
          const attempt = (route: () => void): boolean => {
            try { route(); return points !== undefined } catch (error) {
              if (!(error instanceof BoundaryRouteDecline)) throw error
              decline = error.reason
              return false
            }
          }
          if (!edge.label) {
            const search = (interiorChannels: boolean): void => {
              const graph = keepGraph(createSparseVisibilityGraph(bounds, solidObstacles, [...starts, ...ends], [routeStart, routeEnd], clearance, work, expansionLimit - expanded, corridorFail, reserveExpanded, interiorChannels, solidQueries, sparseWorkspaces(), peerShafts, sparseAdjacencies()))
              for (const target of ends) {
                if (points) break
                if (!solidQueries().entersSegment(target.stub.x, target.stub.y, target.port.x, target.port.y)) attempt(() => { graph.route(starts, target.stub, first => {
                  const accepted = accept(simplifyOrthogonal([...first, target.port]))
                  if (accepted) { points = accepted; return true }
                  return false
                }, canTraverse) })
              }
            }
            search(false)
            if (!points && decline === 'cross-hierarchy route has no bounded clear corridor') search(true)
          } else {
            const frameFor = (endpoint: number): RoutingBox => owners[endpoint]! < 0 ? subjects[endpoint]! : frames[owners[endpoint]!]!
            const sourceGraph = crossingSource ? keepGraph(createEndpointSparseVisibilityGraph(bounds, frameFor(edge.source), solidObstacles, starts, routeStart, clearance, work, expansionLimit - expanded, corridorFail, reserveExpanded, false, solidQueries, sparseWorkspaces(), peerShafts, sparseAdjacencies())) : undefined
            type Suffixes = { graph?: ReturnType<typeof createEndpointSparseVisibilityGraph>; paths: Point[][]; complete: boolean }
            const ordinary: Suffixes = { paths: [], complete: false }, guided: Suffixes = { paths: [], complete: false }
            const sourcePaths: Point[][] = []
            const finishSparse = (first: Point[], interiorChannels = false): boolean => {
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
              // The peer ink, terminals and target graph do not change while
              // testing this edge's source arrivals. Retain complete suffixes;
              // rechecking their full join does not allocate another search.
              const target = interiorChannels ? guided : ordinary
              for (const last of target.paths) if (join(last)) return true
              if (target.complete) return false
              const selected = attempt(() => {
                target.graph ??= keepGraph(createEndpointSparseVisibilityGraph(bounds, frameFor(edge.target), solidObstacles, ends, routeEnd, clearance, work, expansionLimit - expanded, corridorFail, reserveExpanded, interiorChannels, solidQueries, sparseWorkspaces(), peerShafts, sparseAdjacencies()))
                target.graph.route(ends, routeEnd, last => {
                  target.paths.push(last)
                  return join(last)
                }, canTraverse)
              })
              if (!selected && decline === 'cross-hierarchy route has no bounded clear corridor') target.complete = true
              return selected
            }
            const ordinarySource = (first: Point[]): boolean => { sourcePaths.push(first); return finishSparse(first) }
            if (sourceGraph) attempt(() => { sourceGraph.route(starts, routeStart, ordinarySource, canTraverse) })
            else ordinarySource([routeStart])
            if (!points && decline === 'cross-hierarchy route has no bounded clear corridor') {
              if (crossingTarget) for (const first of sourcePaths) if (finishSparse(first, true)) break
              if (!points && crossingSource) {
                const graph = keepGraph(createEndpointSparseVisibilityGraph(bounds, frameFor(edge.source), solidObstacles, starts, routeStart, clearance, work, expansionLimit - expanded, corridorFail, reserveExpanded, true, solidQueries, sparseWorkspaces(), peerShafts, sparseAdjacencies()))
                attempt(() => { graph.route(starts, routeStart, first => finishSparse(first) || finishSparse(first, true), canTraverse) })
              }
            }
          }
        } catch (error) {
          if (!(error instanceof BoundaryRouteDecline)) throw error
          decline = error.reason
        }
        if (!points) fail(decline)
        rescued.add(index)
      }
      const finalPoints = points
      if (edge.label && !finalPoints.some((point, cursor) => cursor > 0 && onSegment(raw.labelPosition!, finalPoints[cursor - 1]!, point))) fail('cross-hierarchy route lost its reserved label corridor')
      routePoints += finalPoints.length - raw.points.length
      if (routePoints > 2048) fail('agentic local cross-hierarchy route-point limit')
      placed.edges[index] = { ...raw, points: finalPoints }
      completed.add(index)
    } finally {
      if (graphs) for (const graph of graphs) graph.retire()
    }
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
          work.pairs -= 3 * Math.max(0, points.length - 1) * peerSegments + points.length + peerSegments
          if (work.pairs < 0) fail('agentic local cross-hierarchy crossing-work limit')
          return scoreMeasuredRouteCrossings(points, index, routes, input) !== undefined
        },
      })
      routePoints += result.points.length - raw.points.length
      if (routePoints > 2048) fail('agentic local cross-hierarchy route-point limit')
      placed.edges[index] = { ...raw, ...result }
      finalized.add(index)
      rescued.add(index)
    }
  }
  if (rescued.size) assertFinalBoundaryContacts(input, placed, rescued, work, fail)
  const boundaryRoutes = [...lifted.keys()]
  if (ancestorPlan?.connections.size) {
    for (const index of ancestorPlan.connections.keys()) if (!lifted.has(index)) boundaryRoutes.push(index)
    boundaryRoutes.sort((left, right) => left - right)
  }
  return { ...placed, expandedVertices: expanded, boundaryRoutes }
}
