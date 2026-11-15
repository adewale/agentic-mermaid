import type { Point } from '../types.ts'
import type { ChannelWork } from './channel-tracks.ts'
import { segmentEntersMeasuredBox } from './measured-route-safety.ts'
import { simplifyOrthogonal, type RoutingBox, type Terminal } from './compound-visibility.ts'
import { isCompoundObstacleIndexFor, type CompoundObstacleQueries, type CompoundProjection } from './compound-obstacle-index.ts'

type TransitionGuard = (a: Point, b: Point, arrivalAxis: number, nextAxis: number) => boolean
interface QueryWorkspace {
  active: boolean
  capacity: number
  distance: Float64Array
  parents: Int32Array
  roots: Int32Array
  slots: Int32Array
  heapPages: Map<number, Int32Array>
  reserveHeap: (amount: number) => void
}
export interface SparseQueryWorkspacePool {
  readonly vertices: number
  acquire: (states: number, beforeComparison: () => void) => QueryWorkspace
}

interface AdjacencyStorage {
  active: boolean
  capacity: number
  nodes: Int32Array
  distances: Float64Array
}
export interface SparseAdjacencyStoragePool {
  readonly arcs: number
  acquire: (nodes: number, beforeWork: (amount?: number) => void) => AdjacencyStorage
}

/** Graph storage is retained until the caller retires its graph. Queries of
 * simultaneously retained graphs must never share these physical slots. */
export function createSparseAdjacencyStoragePool(reserveArcs: (amount: number) => void, fail: (reason: string) => never): SparseAdjacencyStoragePool {
  const storages: AdjacencyStorage[] = []
  let allocated = 0
  return { get arcs() { return allocated }, acquire(nodes, beforeWork) {
    const required = nodes * 4
    if (!Number.isSafeInteger(required) || required < 4 || required > 0x7fffffff) fail('agentic local cross-hierarchy visibility-arc limit')
    let selected: AdjacencyStorage | undefined
    for (const candidate of storages) {
      beforeWork()
      if (!candidate.active && candidate.capacity >= required && (!selected || candidate.capacity < selected.capacity)) selected = candidate
    }
    if (!selected) {
      reserveArcs(required)
      allocated += required
      selected = { active: false, capacity: required, nodes: new Int32Array(required), distances: new Float64Array(required) }
      storages.push(selected)
    }
    beforeWork(required)
    selected.nodes.fill(-1, 0, required); selected.distances.fill(0, 0, required)
    selected.active = true
    return selected
  } }
}

/** Physical query storage shared only by this routing call. Buffers stay
 * retained when idle; active nested searches cannot borrow their storage. */
export function createSparseQueryWorkspacePool(reserveVertices: (amount: number) => void, fail: (reason: string) => never): SparseQueryWorkspacePool {
  const workspaces: QueryWorkspace[] = []
  let allocated = 0
  const reserve = (amount: number): void => { reserveVertices(amount); allocated += amount }
  return { get vertices() { return allocated }, acquire(states, beforeComparison) {
    if (!Number.isSafeInteger(states) || states < 1) throw new TypeError('Invalid sparse query capacity')
    let selected: QueryWorkspace | undefined
    for (const candidate of workspaces) {
      beforeComparison()
      if (!candidate.active && candidate.capacity >= states && (!selected || candidate.capacity < selected.capacity)) selected = candidate
    }
    if (!selected) {
      let capacity = Math.min(32, states)
      while (capacity < states) capacity *= 2
      if (!Number.isSafeInteger(capacity)) fail('agentic local cross-hierarchy visibility-expansion limit')
      reserve(capacity)
      selected = { active: false, capacity, distance: new Float64Array(capacity), parents: new Int32Array(capacity), roots: new Int32Array(capacity), slots: new Int32Array(capacity), heapPages: new Map(), reserveHeap: reserve }
      workspaces.push(selected)
    }
    selected.active = true
    return selected
  } }
}

/** Endpoint corridors include the owning frame's perimeter and its quotient
 * anchor, clipped to the original host. Filtering never clips an obstacle. */
export function createEndpointSparseVisibilityGraph(
  host: RoutingBox, frame: RoutingBox, obstacles: readonly RoutingBox[], terminals: readonly Terminal[], anchor: Point,
  clearance: number, work: ChannelWork, remainingVertices: number, fail: (reason: string) => never,
  reserveVertices?: (amount: number) => void,
  interiorChannels = false,
  obstacleQueries?: () => CompoundObstacleQueries,
  queryWorkspaces?: SparseQueryWorkspacePool,
  guideRails?: readonly (readonly [Point, Point])[],
  adjacencyStorage?: SparseAdjacencyStoragePool,
): ReturnType<typeof createSparseVisibilityGraph> {
  work.pairs -= 8
  if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
  const x = Math.max(host.x, Math.min(frame.x - 2 * clearance, anchor.x - clearance))
  const y = Math.max(host.y, Math.min(frame.y - 2 * clearance, anchor.y - clearance))
  const right = Math.min(host.x + host.width, Math.max(frame.x + frame.width + 2 * clearance, anchor.x + clearance))
  const bottom = Math.min(host.y + host.height, Math.max(frame.y + frame.height + 2 * clearance, anchor.y + clearance))
  if (right <= x || bottom <= y) fail('cross-hierarchy route has no bounded clear corridor')
  return createSparseVisibilityGraph({ x, y, width: right - x, height: bottom - y }, obstacles, terminals, [anchor], clearance, work, remainingVertices, fail, reserveVertices, interiorChannels, obstacleQueries, queryWorkspaces, guideRails, adjacencyStorage)
}

/** A sparse rectilinear visibility graph. Obstacle union corners and nearest
 * axis projections replace the Cartesian product of all obstacle coordinates.
 * Every retained segment is checked against the original rectangles. The live
 * vertices count is cumulative logical point/search-state capacity, not bytes;
 * a shared reservation callback enforces the request cap before allocation. */
export function createSparseVisibilityGraph(
  bounds: RoutingBox, obstacles: readonly RoutingBox[], terminals: readonly Terminal[], anchors: readonly Point[],
  clearance: number, work: ChannelWork, remainingVertices: number, fail: (reason: string) => never,
  reserveVertices?: (amount: number) => void,
  interiorChannels = false,
  obstacleQueries?: () => CompoundObstacleQueries,
  queryWorkspaces?: SparseQueryWorkspacePool,
  guideRails?: readonly (readonly [Point, Point])[],
  adjacencyStorage?: SparseAdjacencyStoragePool,
): { vertices: number; retire: () => void; route: (starts: readonly Terminal[], goal: Point, accept?: (points: Point[]) => boolean, canTraverse?: TransitionGuard) => Point[] } {
  const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height
  let allocatedVertices = 0
  const reserve = (amount: number): void => {
    if (allocatedVertices + amount > remainingVertices) fail('agentic local cross-hierarchy visibility-expansion limit')
    reserveVertices?.(amount)
    allocatedVertices += amount
  }
  const charge = (amount = 1): void => {
    work.pairs -= amount
    if (work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
  }
  const inBounds = (p: Point): boolean => p.x >= bounds.x && p.x <= right && p.y >= bounds.y && p.y <= bottom
  const relevant = obstacles.filter(box => {
    charge()
    return box.x <= right && box.x + box.width >= bounds.x && box.y <= bottom && box.y + box.height >= bounds.y
  })
  // A collapsed rectangle can remain a barrier under the strict segment
  // predicate even though its point interior is empty. Keep those scopes on
  // the original solid queries rather than infer free merged intervals.
  // Empty scopes have no solid-query work to remove, so retain their original
  // query path as well (including interruption and adjacency-lease cleanup).
  charge()
  let reuseFreeRays = relevant.length > 0
  for (const box of relevant) {
    charge(8)
    const east = box.x + box.width, south = box.y + box.height
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(east) || !Number.isFinite(south)
      || east <= box.x || south <= box.y) { reuseFreeRays = false; break }
  }
  const points: Point[] = [], identities = new Map<string, number>()
  let index: CompoundObstacleQueries | undefined
  const key = (p: Point): string => `${p.x},${p.y}`
  const clearPoint = (p: Point): boolean => {
    if (obstacleQueries) return !(index ??= obstacleQueries()).containsPoint(p.x, p.y)
    for (const box of relevant) {
      charge()
      if (p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height) return false
    }
    return true
  }
  const add = (p: Point): void => {
    charge()
    if (!Number.isFinite(p.x + p.y)) fail('agentic local cross-hierarchy coordinate limit')
    if (!inBounds(p) || identities.has(key(p)) || !clearPoint(p)) return
    reserve(1)
    identities.set(key(p), points.length)
    points.push({ ...p })
  }
  const corners = (box: RoutingBox): void => {
    for (const x of [box.x, box.x + box.width]) for (const y of [box.y, box.y + box.height]) add({ x, y })
  }
  corners(bounds)
  for (const box of relevant) corners(box)
  // Overlapping rectangles can introduce union corners that are not corners
  // of either input box. Keep their boundary intersections before projecting.
  for (let i = 0; i < relevant.length; i++) for (let j = i + 1; j < relevant.length; j++) {
    charge()
    const a = relevant[i]!, b = relevant[j]!
    if (a.x > b.x + b.width || b.x > a.x + a.width || a.y > b.y + b.height || b.y > a.y + a.height) continue
    for (const [vertical, horizontal] of [[a, b], [b, a]] as const) {
      for (const x of [vertical.x, vertical.x + vertical.width]) for (const y of [horizontal.y, horizontal.y + horizontal.height]) {
        charge()
        if (x >= horizontal.x && x <= horizontal.x + horizontal.width && y >= vertical.y && y <= vertical.y + vertical.height) add({ x, y })
      }
    }
  }
  for (const terminal of terminals) { add(terminal.port); add(terminal.stub) }
  for (const anchor of anchors) add(anchor)
  const terminalPoints = new Set<string>()
  for (const terminal of terminals) { charge(2); terminalPoints.add(key(terminal.port)); terminalPoints.add(key(terminal.stub)) }
  for (const anchor of anchors) { charge(); terminalPoints.add(key(anchor)) }
  if (interiorChannels && relevant.length) {
    let occupiedLeft = right, occupiedRight = bounds.x, occupiedTop = bottom, occupiedBottom = bounds.y
    for (const box of relevant) {
      charge(8)
      occupiedLeft = Math.min(occupiedLeft, Math.max(bounds.x, box.x))
      occupiedRight = Math.max(occupiedRight, Math.min(right, box.x + box.width))
      occupiedTop = Math.min(occupiedTop, Math.max(bounds.y, box.y))
      occupiedBottom = Math.max(occupiedBottom, Math.min(bottom, box.y + box.height))
    }
    charge(4)
    const midpoint = (a: number, b: number): number => a + (b - a) / 2
    const xs = [...(occupiedLeft > bounds.x ? [midpoint(bounds.x, occupiedLeft)] : []), ...(occupiedRight < right ? [midpoint(occupiedRight, right)] : [])]
    const ys = [...(occupiedTop > bounds.y ? [midpoint(bounds.y, occupiedTop)] : []), ...(occupiedBottom < bottom ? [midpoint(occupiedBottom, bottom)] : [])]
    const refine = (coordinate: number, scanline: number, vertical: boolean, outer: number, wall: number): number => {
      if (!guideRails) return coordinate
      let blocked: number | undefined
      const towardWall = wall > coordinate ? 1 : -1
      for (const [a, b] of guideRails) {
        charge()
        const value = vertical ? a.x : a.y
        if ((vertical ? a.x !== b.x : a.y !== b.y)
          || scanline < Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x)
          || scanline > Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x)
          || Math.abs(value - coordinate) > .5
          || value <= Math.min(outer, wall) || value >= Math.max(outer, wall)
          || towardWall * (wall - value) <= 0) continue
        if (blocked === undefined || towardWall * (value - blocked) > 0) blocked = value
      }
      if (blocked === undefined) return coordinate
      let adjacent = wall
      for (const [a, b] of guideRails) {
        charge()
        const value = vertical ? a.x : a.y
        if ((vertical ? a.x !== b.x : a.y !== b.y)
          || scanline < Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x)
          || scanline > Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x)
          || towardWall * (value - blocked) <= 0 || towardWall * (adjacent - value) <= 0) continue
        adjacent = value
      }
      return midpoint(blocked, adjacent)
    }
    // At most four intersections of wholly free outer strips. These are
    // guide vertices; parallel foreign rails only refine a colliding midpoint
    // toward the solid wall. Rails never become obstacles, so perpendicular
    // crossings remain available to the exact transition/final-path checks.
    for (const x of xs) for (const y of ys) {
      const p = { x: refine(x, y, true, x < occupiedLeft ? bounds.x : right, x < occupiedLeft ? occupiedLeft : occupiedRight),
        y: refine(y, x, false, y < occupiedTop ? bounds.y : bottom, y < occupiedTop ? occupiedTop : occupiedBottom) }
      add(p); charge(); terminalPoints.add(key(p))
    }
  }
  type Ray = { fixed: number; lower: number; upper: number }
  const horizontalRays: Ray[] = [], verticalRays: Ray[] = [], terminalHorizontal: Ray[] = [], terminalVertical: Ray[] = []
  const ray = (a: Point, b: Point, terminal: boolean): void => {
    charge()
    if (a.x === b.x && a.y === b.y) return
    if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
    const horizontal = a.y === b.y
    const value = horizontal ? { fixed: a.y, lower: Math.min(a.x, b.x), upper: Math.max(a.x, b.x) }
      : { fixed: a.x, lower: Math.min(a.y, b.y), upper: Math.max(a.y, b.y) }
    ;(horizontal ? horizontalRays : verticalRays).push(value)
    if (terminal) (horizontal ? terminalHorizontal : terminalVertical).push(value)
  }
  const seedCount = points.length
  let projection: CompoundProjection | undefined
  if (obstacleQueries) {
    if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
    projection = { left: bounds.x, right, top: bounds.y, bottom }
  }
  for (let seed = 0; seed < seedCount; seed++) {
    const p = points[seed]!
    let left = bounds.x, east = right, top = bounds.y, south = bottom
    if (projection) {
      // The frozen full-solid index preserves the original strict scanline
      // predicates; boxes outside this domain cannot shrink its bounds.
      const queries = index ??= obstacleQueries!()
      queries.projectPoint(p.x, p.y, bounds, projection)
      left = projection.left; east = projection.right; top = projection.top; south = projection.bottom
    } else for (const box of relevant) {
      charge(4)
      if (p.y > box.y && p.y < box.y + box.height) {
        if (box.x >= p.x) east = Math.min(east, box.x)
        if (box.x + box.width <= p.x) left = Math.max(left, box.x + box.width)
      }
      if (p.x > box.x && p.x < box.x + box.width) {
        if (box.y >= p.y) south = Math.min(south, box.y)
        if (box.y + box.height <= p.y) top = Math.max(top, box.y + box.height)
      }
    }
    const terminal = terminalPoints.has(key(p))
    for (const q of [{ x: left, y: p.y }, { x: east, y: p.y }, { x: p.x, y: top }, { x: p.x, y: south }]) {
      add(q); ray(p, q, terminal)
    }
  }
  const compare = (a: number, b: number): number => {
    if (--work.swaps < 0) fail('agentic local cross-hierarchy coordinate-sort limit')
    return a - b
  }
  const mergedRays = (rays: readonly Ray[]): { coordinates: number[]; lines: Map<number, Ray[]> } => {
    const lines = new Map<number, Ray[]>()
    for (const value of rays) {
      charge()
      const line = lines.get(value.fixed) ?? []
      line.push(value); lines.set(value.fixed, line)
    }
    for (const [coordinate, line] of lines) {
      line.sort((a, b) => compare(a.lower, b.lower) || compare(a.upper, b.upper))
      const merged: Ray[] = []
      for (const value of line) {
        charge()
        const previous = merged.at(-1)
        if (previous && value.lower <= previous.upper) previous.upper = Math.max(previous.upper, value.upper)
        else {
          if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
          merged.push({ ...value })
        }
      }
      lines.set(coordinate, merged)
    }
    return { coordinates: [...lines.keys()].sort(compare), lines }
  }
  const intersections = (terminalRays: readonly Ray[], others: readonly Ray[], horizontal: boolean): ReturnType<typeof mergedRays> => {
    const candidates = mergedRays(others), starts = mergedRays(terminalRays)
    for (const line of starts.lines.values()) for (const start of line) {
      let lower = 0, upper = candidates.coordinates.length
      while (lower < upper) {
        charge()
        const middle = Math.floor((lower + upper) / 2)
        if (candidates.coordinates[middle]! < start.lower) lower = middle + 1
        else upper = middle
      }
      for (let index = lower; index < candidates.coordinates.length; index++) {
        charge()
        const coordinate = candidates.coordinates[index]!
        if (coordinate > start.upper) break
        for (const other of candidates.lines.get(coordinate)!) {
          charge()
          if (other.lower > start.fixed) break
          if (other.upper >= start.fixed) add(horizontal ? { x: coordinate, y: start.fixed } : { x: start.fixed, y: coordinate })
        }
      }
    }
    return candidates
  }
  // A terminal ray crossing another clear ray needs a vertex to turn there.
  // Index only these geometric intersections, rather than every X/Y pair.
  const allVertical = intersections(terminalHorizontal, verticalRays, true)
  const allHorizontal = intersections(terminalVertical, horizontalRays, false)
  let adjacency: AdjacencyStorage | undefined
  try {
    adjacency = adjacencyStorage?.acquire(points.length, charge)
    if (reuseFreeRays && obstacleQueries) {
      // Query presence, ownership lookup, scope identity and three original
      // data-method identities; callbacks/getters remain on the strict path.
      charge(10)
      reuseFreeRays = isCompoundObstacleIndexFor(index, obstacles)
    }
    const neighbors: { node: number; axis: number; distance: number }[][] | undefined = adjacency ? undefined : points.map(() => [])
    const clearSegment = (a: Point, b: Point): boolean => {
      if (obstacleQueries) return !(index ??= obstacleQueries()).entersSegment(a.x, a.y, b.x, b.y)
      for (const box of relevant) {
        charge()
        if (segmentEntersMeasuredBox(a, b, box)) return false
      }
      return true
    }
    for (const axis of [1, 2]) {
      const lines = new Map<number, number[]>()
      points.forEach((p, index) => {
        charge()
        const coordinate = axis === 1 ? p.y : p.x, line = lines.get(coordinate) ?? []
        line.push(index); lines.set(coordinate, line)
      })
      for (const line of lines.values()) {
        // These merged ALL-ray maps were already built for intersections.
        // Each ray stops at the nearest original solid or domain boundary;
        // one connected interval therefore certifies its contained segments.
        if (reuseFreeRays) charge()
        const firstPoint = points[line[0]!]!
        const free = reuseFreeRays ? (axis === 1 ? allHorizontal : allVertical).lines.get(axis === 1 ? firstPoint.y : firstPoint.x) : undefined
        let freeCursor = 0
        line.sort((a, b) => {
          if (--work.swaps < 0) fail('agentic local cross-hierarchy coordinate-sort limit')
          return axis === 1 ? points[a]!.x - points[b]!.x : points[a]!.y - points[b]!.y
        })
        for (let index = 1; index < line.length; index++) {
          if (adjacency) charge()
          else {
            work.arcs -= 2
            if (work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
          }
          const a = line[index - 1]!, b = line[index]!
          const lower = axis === 1 ? points[a]!.x : points[a]!.y, upper = axis === 1 ? points[b]!.x : points[b]!.y
          let certificate: Ray | undefined
          while (reuseFreeRays) {
            charge()
            if (!free || freeCursor >= free.length) break
            const interval = free[freeCursor]!
            charge()
            if (interval.upper >= lower) { certificate = interval; break }
            charge(); freeCursor++
          }
          let covered = false
          if (certificate) {
            charge()
            if (certificate.lower <= lower) {
              charge()
              covered = upper <= certificate.upper
            }
          }
          if (!covered && !clearSegment(points[a]!, points[b]!)) continue
          const distance = Math.abs(points[a]!.x - points[b]!.x) + Math.abs(points[a]!.y - points[b]!.y)
          if (adjacency) {
            const forward = a * 4 + (axis === 1 ? 1 : 3), backward = b * 4 + (axis === 1 ? 0 : 2)
            adjacency.nodes[forward] = b; adjacency.distances[forward] = distance
            adjacency.nodes[backward] = a; adjacency.distances[backward] = distance
          } else {
            neighbors![a]!.push({ node: b, axis, distance }); neighbors![b]!.push({ node: a, axis, distance })
          }
        }
      }
    }
    const locate = (p: Point): number => identities.get(key(p)) ?? -1
    const states = points.length * 3, pageSize = 32
    const pool = queryWorkspaces ?? createSparseQueryWorkspacePool(reserve, fail)
    let retired = false, activeQueries = 0
    return { get vertices() { return allocatedVertices }, retire() {
      if (retired) return
      if (activeQueries) throw new TypeError('Cannot retire a sparse graph during an active query')
      retired = true
      if (adjacency) adjacency.active = false
    }, route(starts, goal, accept = () => true, canTraverse = () => true) {
      if (retired) throw new TypeError('Cannot query a retired sparse graph')
      activeQueries++
      try {
        const target = locate(goal)
        if (target < 0) fail('cross-hierarchy route has no clear anchor')
        charge(states)
        const currentWorkspace = pool.acquire(states, charge)
        try {
          const { distance, parents, roots, slots, heapPages } = currentWorkspace
          distance.fill(Infinity, 0, states); parents.fill(-1, 0, states); roots.fill(-1, 0, states); slots.fill(-1, 0, states)
          let heapSize = 0
          const heap = (index: number): number => heapPages.get(Math.floor(index / pageSize))![index % pageSize]!
          const setHeap = (index: number, state: number): void => {
            const page = Math.floor(index / pageSize)
            let data = heapPages.get(page)
            if (!data) {
              const count = Math.min(pageSize, currentWorkspace.capacity - page * pageSize)
              currentWorkspace.reserveHeap(count)
              data = new Int32Array(count)
              heapPages.set(page, data)
            }
            data[index % pageSize] = state
          }
          const priority = (state: number): number => {
            const p = points[Math.floor(state / 3)]!
            return distance[state]! + Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y)
          }
          const less = (a: number, b: number): boolean => {
            if (--work.swaps < 0) fail('agentic local cross-hierarchy heap-work limit')
            const left = priority(a), right = priority(b)
            return left < right || left === right && a < b
          }
          const swap = (a: number, b: number): void => {
            const saved = heap(a)
            setHeap(a, heap(b)); setHeap(b, saved)
            slots[heap(a)] = a; slots[heap(b)] = b
          }
          const enqueue = (state: number): void => {
            let slot = slots[state]!
            if (slot === -2) return
            if (slot < 0) { slot = heapSize; setHeap(heapSize++, state); slots[state] = slot }
            while (slot > 0) {
              const parent = Math.floor((slot - 1) / 2)
              if (!less(heap(slot), heap(parent))) break
              swap(slot, parent); slot = parent
            }
          }
          const pop = (): number => {
            const first = heap(0), last = heap(--heapSize)
            slots[first] = -2
            if (heapSize) {
              setHeap(0, last); slots[last] = 0
              let slot = 0
              for (;;) {
                let next = slot * 2 + 1
                if (next >= heapSize) break
                if (next + 1 < heapSize && less(heap(next + 1), heap(next))) next++
                if (!less(heap(next), heap(slot))) break
                swap(slot, next); slot = next
              }
            }
            return first
          }
          for (let index = 0; index < starts.length; index++) {
            charge()
            const terminal = starts[index]!, id = locate(terminal.stub)
            if (id < 0 || !inBounds(terminal.port) || !clearPoint(terminal.port) || !clearSegment(terminal.port, terminal.stub)) continue
            const axis = terminal.port.x === terminal.stub.x ? 2 : terminal.port.y === terminal.stub.y ? 1 : 0
            if (!axis) throw new TypeError('Measured terminal lead must be orthogonal')
            if (!canTraverse(terminal.port, terminal.stub, axis, axis)) continue
            const state = id * 3 + axis, value = Math.abs(terminal.stub.x - terminal.port.x) + Math.abs(terminal.stub.y - terminal.port.y) + terminal.penalty
            if (value < distance[state]!) { distance[state] = value; roots[state] = index; enqueue(state) }
          }
          while (heapSize) {
            const state = pop(), id = Math.floor(state / 3), axis = state % 3
            if (id === target) {
              const path: Point[] = []
              let current = state
              while (parents[current]! >= 0) { charge(); path.push(points[Math.floor(current / 3)]!); current = parents[current]! }
              path.push(points[Math.floor(current / 3)]!, starts[roots[current]!]!.port)
              let emitted = 0, previous: Point | undefined
              for (const p of path) {
                charge()
                if (!previous || previous.x !== p.x || previous.y !== p.y) emitted++
                previous = p
              }
              reserve(emitted)
              const candidate = simplifyOrthogonal(path.reverse())
              if (accept(candidate)) return candidate
            }
            const list = neighbors?.[id]
            for (let cursor = 0; cursor < (adjacency ? 4 : list!.length); cursor++) {
              let nextNode: number, nextAxis: number, nextDistance: number
              if (adjacency) {
                const slot = id * 4 + cursor
                nextNode = adjacency.nodes[slot]!
                if (nextNode < 0) { charge(); continue }
                nextAxis = cursor < 2 ? 1 : 2; nextDistance = adjacency.distances[slot]!
              } else {
                const next = list![cursor]!
                nextNode = next.node; nextAxis = next.axis; nextDistance = next.distance
              }
              if (--work.arcs < 0) fail('agentic local cross-hierarchy visibility-arc limit')
              if (parents[state] === -1) {
                charge()
                const terminal = starts[roots[state]!]!, from = points[id]!, to = points[nextNode]!
                const dx = terminal.stub.x - terminal.port.x, dy = terminal.stub.y - terminal.port.y
                // Reversing this root's own nonzero lead makes an invalid cheap
                // path dominate the valid arrivals before full-path acceptance.
                if (dx !== 0 && nextAxis === 1 && Math.sign(to.x - from.x) === -Math.sign(dx)
                  || dy !== 0 && nextAxis === 2 && Math.sign(to.y - from.y) === -Math.sign(dy)) continue
              }
              const nextState = nextNode * 3 + nextAxis
              const value = distance[state]! + nextDistance + (axis === nextAxis ? 0 : clearance * 2)
              if (slots[nextState] !== -2 && value < distance[nextState]! && canTraverse(points[id]!, points[nextNode]!, axis, nextAxis)) {
                distance[nextState] = value; parents[nextState] = state; roots[nextState] = roots[state]!; enqueue(nextState)
              }
            }
          }
          return fail('cross-hierarchy route has no bounded clear corridor')
        } finally { currentWorkspace.active = false }
      } finally { activeQueries-- }
    } }
  } catch (error) {
    if (adjacency) adjacency.active = false
    throw error
  }
}
