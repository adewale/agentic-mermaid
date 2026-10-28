import { formatSvgNumber } from '../shared/svg-number.ts'
import { createOwnedMeasuredRouteContactValidator, measuredRouteContactPairBudget, scoreMeasuredRouteCrossings } from '../layout/measured-route-safety.ts'
import { layoutCompoundGraph } from '../layout/agentic-compound-core.ts'
import { assertFinalBoundaryContacts, createBoundaryContactValidator } from '../layout/compound-boundary-routes.ts'
import { proposePortalChannel } from '../layout/compound-portal-channel.ts'
import { proposeOuterChannel } from '../layout/compound-outer-channel.ts'
import { createPeerGeometryOwner } from '../layout/compound-peer-geometry.ts'
import { describe, expect, test, spyOn } from 'bun:test'
import { layoutAgenticGraph, type MeasuredGraph } from '../layout/agentic-layered.ts'
import { type AgenticLayout, layoutLayeredGraph } from '../layout/agentic-layered-core.ts'
import { GraphLayoutUnsupportedError } from '../layout/backend.ts'
import type { Direction, Point } from '../types.ts'
import { countOpposingRouteOverlaps, countParallelRouteOverlaps } from '../layout-rubric.ts'
import { assignChannelTracks } from '../layout/channel-tracks.ts'
import { createEndpointSparseVisibilityGraph, createSparseAdjacencyStoragePool, createSparseQueryWorkspacePool, createSparseVisibilityGraph } from '../layout/compound-sparse-visibility.ts'
import { createVisibilityGrid } from '../layout/compound-visibility.ts'
import { createLazyVisibilityGrid } from '../layout/compound-lazy-visibility.ts'
import { createCompoundObstacleIndex } from '../layout/compound-obstacle-index.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

function measured(overrides: Partial<MeasuredGraph> = {}): MeasuredGraph {
  return {
    nodes: [
      { id: 'left', width: 120, height: 36 },
      { id: 'right', width: 46, height: 80 },
      { id: 'join', width: 95, height: 42 },
      { id: 'sink', width: 62, height: 38 },
      { id: 'disconnected', width: 73, height: 51 },
    ],
    edges: [
      { source: 0, target: 2, minSpan: 1, label: { width: 112, height: 18 } },
      { source: 1, target: 2, minSpan: 1 },
      { source: 2, target: 3, minSpan: 1 },
      { source: 0, target: 3, minSpan: 3, label: { width: 156, height: 22 } },
      { source: 0, target: 3, minSpan: 1, label: { width: 85, height: 18 } },
    ],
    direction: 'TD', padding: 17, nodeSpacing: 24, layerSpacing: 44, ...overrides,
  }
}

interface Box { x: number; y: number; width: number; height: number }

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function onOutline(point: Point, box: Box): boolean {
  return ((Math.abs(point.x - box.x) < 1e-7 || Math.abs(point.x - box.x - box.width) < 1e-7) && point.y >= box.y && point.y <= box.y + box.height)
    || ((Math.abs(point.y - box.y) < 1e-7 || Math.abs(point.y - box.y - box.height) < 1e-7) && point.x >= box.x && point.x <= box.x + box.width)
}

function crossesInterior(a: Point, b: Point, box: Box): boolean {
  if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width
    && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
  if (a.y === b.y) return a.y > box.y && a.y < box.y + box.height
    && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
  throw new Error('A routed segment is not orthogonal')
}

describe('owned measured layered layout', () => {
  test.each(['TD', 'BT', 'LR', 'RL'] as const)('projects terminal leads from the same fractional node borders in %s', direction => {
    const horizontal = direction === 'LR' || direction === 'RL', reverse = direction === 'BT' || direction === 'RL'
    const input = measured({ direction, padding: 40.123456789, nodes: [
      { id: 'a', width: 104.194, height: 36.900000000000006 },
      { id: 'b', width: 72.742, height: 43.287 },
      { id: 'c', width: 91.658, height: 36.900000000000006 },
      { id: 'd', width: 80.082, height: 29.713 },
    ], edges: [{ source: 0, target: 2, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }, { source: 1, target: 3, minSpan: 1 }] })
    const original = structuredClone(input)
    const output = layoutLayeredGraph(input, () => undefined, reason => { throw new GraphLayoutUnsupportedError(reason) })
    expect(input).toEqual(original)
    const target = { ...input.nodes[2]!, ...output.nodes[2]! }, crossSize = horizontal ? target.height : target.width
    const clamp = (horizontal ? target.y : target.x) + crossSize - Math.min(8, crossSize / 6)
    const clampedRoute = output.edges[1]!.points
    expect(horizontal ? clampedRoute.at(-1)!.y : clampedRoute.at(-1)!.x).toBe(clamp)
    expect(horizontal ? clampedRoute.at(-2)!.y : clampedRoute.at(-2)!.x).toBe(clamp)
    for (const [index, route] of output.edges.entries()) {
      const edge = input.edges[index]!
      for (const source of [true, false]) {
        const id = source ? edge.source : edge.target, box = { ...input.nodes[id]!, ...output.nodes[id]! }
        const endpoint = source ? route.points[0]! : route.points.at(-1)!, lead = source ? route.points[1]! : route.points.at(-2)!
        const high = source !== reverse, face = horizontal ? box.x + (high ? box.width : 0) : box.y + (high ? box.height : 0)
        expect(horizontal ? endpoint.x : endpoint.y).toBe(face)
        expect(horizontal ? endpoint.y : endpoint.x).toBe(horizontal ? lead.y : lead.x)
        expect((horizontal ? lead.x - endpoint.x : lead.y - endpoint.y) * (high ? 1 : -1)).toBeGreaterThan(0)
      }
      for (let segment = 1; segment < route.points.length; segment++) {
        const a = route.points[segment - 1]!, b = route.points[segment]!
        expect(a.x === b.x || a.y === b.y).toBe(true)
      }
    }
  })
  test('sparse compound visibility preserves terminal leads around an overlapping obstacle union', () => {
    const bounds = { x: 0, y: 0, width: 220, height: 160 }
    const obstacles = [{ x: 0, y: 50, width: 20, height: 40 },
      { x: 70, y: 25, width: 60, height: 75 }, { x: 105, y: 60, width: 55, height: 65 }]
    const terminal = { port: { x: 20, y: 70 }, stub: { x: 28, y: 70 }, penalty: 0 }, goal = { x: 190, y: 70 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const route = () => createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8,
      { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }, 32768, fail).route([terminal], goal)
    const points = route()
    expect(route()).toEqual(points)
    expect(points[0]).toEqual(terminal.port)
    expect(points.at(-1)).toEqual(goal)
    expect(points[1]!.y).toBe(terminal.port.y)
    expect(points[1]!.x).toBeGreaterThanOrEqual(terminal.stub.x)
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.x)
      expect(point.x).toBeLessThanOrEqual(bounds.width)
      expect(point.y).toBeGreaterThanOrEqual(bounds.y)
      expect(point.y).toBeLessThanOrEqual(bounds.height)
    }
    for (let index = 1; index < points.length; index++) for (const obstacle of obstacles) {
      expect(crossesInterior(points[index - 1]!, points[index]!, obstacle)).toBe(false)
    }
    const indexedWork = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
    const indexed = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8,
      indexedWork, 32768, fail, undefined, false, () => createCompoundObstacleIndex(obstacles, indexedWork, fail))
    expect(indexed.route([terminal], goal)).toEqual(points)
    const constrained = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8,
      { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }, 32768, fail)
      .route([terminal], goal, undefined, (a, b) => Math.min(a.y, b.y) >= 30)
    expect(constrained.some(point => point.y >= 125)).toBe(true)
    for (let index = 1; index < constrained.length; index++) {
      expect(Math.min(constrained[index - 1]!.y, constrained[index]!.y)).toBeGreaterThanOrEqual(30)
      for (const obstacle of obstacles) expect(crossesInterior(constrained[index - 1]!, constrained[index]!, obstacle)).toBe(false)
    }
  })

  test('sparse compound visibility retains a clear route among staggered obstacles within its state budget', () => {
    const bounds = { x: 0, y: 0, width: 600, height: 500 }
    const obstacles = Array.from({ length: 40 }, (_, index) => ({ x: 20 + index * 12, y: 30 + index * 9, width: 4, height: 4 }))
    const terminal = { port: { x: 0, y: 10 }, stub: { x: 8, y: 10 }, penalty: 0 }, goal = { x: 580, y: 10 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const work = () => ({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 })
    const graph = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work(), 10000, fail)
    expect(graph.vertices).toBeLessThanOrEqual(10000)
    expect(graph.route([terminal], goal)).toEqual([terminal.port, goal])
    expect(() => graph.route([terminal], goal, () => false)).toThrow('no bounded clear corridor')
    expect(() => createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work(), 3, fail)).toThrow('visibility-expansion limit')
    expect(() => createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, { pairs: 0, arcs: 0, swaps: 0 }, 10000, fail)).toThrow('obstacle-work limit')
  })

  test('sparse solid projections retain the fresh-history route within a shared comparison budget', () => {
    const bounds = { x: 0, y: 0, width: 600, height: 500 }
    const obstacles = Array.from({ length: 40 }, (_, index) => ({ x: 20 + index * 12, y: 30 + index * 9, width: 4, height: 4 }))
    const terminal = { port: { x: 0, y: 10 }, stub: { x: 8, y: 10 }, penalty: 0 }, goal = { x: 580, y: 10 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const reference = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8,
      { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }, 10000, fail).route([terminal], goal)
    const work = { pairs: 50000, arcs: 65536, swaps: 1_000_000 }
    const indexed = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8,
      work, 10000, fail, undefined, false, () => createCompoundObstacleIndex(obstacles, work, fail))
    expect(indexed.route([terminal], goal)).toEqual(reference)
    expect(reference).toEqual([terminal.port, goal])
    expect(work.pairs).toBeGreaterThanOrEqual(0)
    expect(work.arcs).toBeGreaterThanOrEqual(0)
  })

  test.each([{ pooled: false, indexed: false }, { pooled: true, indexed: false }, { pooled: false, indexed: true }, { pooled: true, indexed: true }])('sparse projected free rays preserve the exact route within the shared solid budget (pooled $pooled, indexed $indexed)', ({ pooled, indexed }) => {
    const bounds = { x: 0, y: 0, width: 600, height: 500 }
    const obstacles = Array.from({ length: 40 }, (_, index) => ({ x: 20 + index * 12, y: 30 + index * 9, width: 4, height: 4 }))
    const terminal = { port: { x: 0, y: 10 }, stub: { x: 8, y: 10 }, penalty: 0 }, goal = { x: 580, y: 10 }
    const work = { pairs: indexed ? 35000 : 100000, arcs: 65536, swaps: 1_000_000 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const adjacency = pooled ? createSparseAdjacencyStoragePool(amount => { work.arcs -= amount; if (work.arcs < 0) fail('shared adjacency limit') }, fail) : undefined
    let queries: ReturnType<typeof createCompoundObstacleIndex> | undefined
    const graph = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work, 10000, fail,
      undefined, false, indexed ? () => queries ??= createCompoundObstacleIndex(obstacles, work, fail) : undefined, undefined, undefined, adjacency)
    const points = graph.route([terminal], goal)
    // Every original solid begins below y=30. The authored eastward lead and
    // entire y=10 lane are clear independently of the ray construction.
    expect(points).toEqual([terminal.port, goal])
    for (let i = 1; i < points.length; i++) for (const box of obstacles) expect(crossesInterior(points[i - 1]!, points[i]!, box)).toBe(false)
    expect(work.pairs).toBeGreaterThanOrEqual(0)
    expect(work.arcs).toBeGreaterThanOrEqual(0)
    graph.retire()
  })

  test.each(['overlap-union', 'partly-outside', 'blocked-gap', 'zero-width', 'zero-height', 'rounded-width'] as const)('sparse free-ray certificates retain strict original solids for %s', kind => {
    const origin = kind === 'rounded-width' ? 2 ** 54 : 0
    const bounds = { x: origin, y: 0, width: origin ? 1024 : 100, height: 100 }
    const vertical = kind === 'zero-height'
    const terminal = vertical ? { port: { x: 50, y: 0 }, stub: { x: 50, y: 8 }, penalty: 0 }
      : { port: { x: origin, y: 50 }, stub: { x: origin + 8, y: 50 }, penalty: 0 }
    const goal = vertical ? { x: 50, y: 100 } : { x: origin + (origin ? 1000 : 100), y: 50 }
    const obstacles = kind === 'overlap-union' ? [{ x: 30, y: 20, width: 30, height: 50 }, { x: 45, y: 45, width: 30, height: 40 }]
      : kind === 'partly-outside' ? [{ x: 40, y: -20, width: 20, height: 90 }]
        : kind === 'zero-height' ? [{ x: 20, y: 50, width: 60, height: 0 }]
          : [{ x: origin + (origin ? 512 : kind === 'zero-width' ? 50 : 40), y: 20, width: kind === 'zero-width' ? 0 : origin ? 1 : 20, height: 60 }]
    const original = structuredClone(obstacles), work = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const solid = createCompoundObstacleIndex(obstacles, work, fail)
    // Even a zero-area or rounded-to-zero wall is a blocker under the
    // original strict SEGMENT predicate; positive point-clearance is insufficient.
    expect(solid.entersSegment(terminal.port.x, terminal.port.y, goal.x, goal.y)).toBe(true)
    const graph = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work, 32768, fail,
      undefined, false, () => solid)
    if (kind === 'zero-width' || kind === 'zero-height' || kind === 'rounded-width') {
      // The first-party scope must retain its original strict barrier
      // semantics, including positive widths rounded to an empty span.
      expect(solid.entersSegment(terminal.port.x, terminal.port.y, goal.x, goal.y)).toBe(true)
      if (origin) expect(obstacles[0]!.x + obstacles[0]!.width).toBe(obstacles[0]!.x)
      expect(obstacles).toEqual(original)
      graph.retire()
      return
    }
    const points = graph.route([terminal], goal, candidate => candidate.every((point, i) => i === 0 || obstacles.every(box => !crossesInterior(candidate[i - 1]!, point, box))), (a, b) => {
      // This sees proposed graph transitions before final route acceptance;
      // a false certificate must not expose an original blocked gap.
      for (const box of obstacles) expect(crossesInterior(a, b, box)).toBe(false)
      return true
    })
    expect(points[0]).toEqual(terminal.port)
    expect(points.at(-1)).toEqual(goal)
    expect(points.length).toBeGreaterThan(2)
    for (let i = 1; i < points.length; i++) for (const box of obstacles) expect(crossesInterior(points[i - 1]!, points[i]!, box)).toBe(false)
    expect(obstacles).toEqual(original)
    if (origin) expect(obstacles[0]!.x + obstacles[0]!.width).toBe(obstacles[0]!.x)
    graph.retire()
  })

  test('sparse compound visibility refuses an unreachable enclosed goal', () => {
    const terminal = { port: { x: 0, y: 80 }, stub: { x: 8, y: 80 }, penalty: 0 }, goal = { x: 120, y: 80 }
    const graph = createSparseVisibilityGraph({ x: 0, y: 0, width: 220, height: 160 }, [
      { x: 90, y: 50, width: 60, height: 10 }, { x: 90, y: 100, width: 60, height: 10 },
      { x: 90, y: 50, width: 10, height: 60 }, { x: 140, y: 50, width: 10, height: 60 },
    ], [terminal], [goal], 8, { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }, 32768,
    reason => { throw new GraphLayoutUnsupportedError(reason) })
    expect(() => graph.route([terminal], goal)).toThrow('no bounded clear corridor')
  })

  test('endpoint sparse corridors retain all intersecting solids within the original host bounds', () => {
    const obstacles = [{ x: 0, y: 40, width: 20, height: 40 }, { x: 90, y: 30, width: 30, height: 100 },
      ...Array.from({ length: 40 }, (_, index) => ({ x: 300 + index * 6, y: 30 + index * 9, width: 4, height: 4 }))]
    const terminal = { port: { x: 20, y: 60 }, stub: { x: 28, y: 60 }, penalty: 0 }, goal = { x: 230, y: 60 }
    const graph = createEndpointSparseVisibilityGraph({ x: 0, y: 0, width: 600, height: 500 },
      { x: 0, y: 0, width: 200, height: 200 }, obstacles, [terminal], goal, 8,
      { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }, 300,
      reason => { throw new GraphLayoutUnsupportedError(reason) })
    expect(graph.vertices).toBeLessThanOrEqual(300)
    const points = graph.route([terminal], goal)
    expect(points[0]).toEqual(terminal.port)
    expect(points.at(-1)).toEqual(goal)
    expect(points[1]!.y).toBe(terminal.port.y)
    expect(points[1]!.x).toBeGreaterThanOrEqual(terminal.stub.x)
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(238)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(216)
    }
    for (let index = 1; index < points.length; index++) for (const obstacle of obstacles) {
      expect(crossesInterior(points[index - 1]!, points[index]!, obstacle)).toBe(false)
    }
  })

  test('nested sparse queries reserve their cumulative capacity before a shared budget can be exceeded', () => {
    const terminal = { port: { x: 0, y: 10 }, stub: { x: 8, y: 10 }, penalty: 0 }, goal = { x: 20, y: 10 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    let allocated = 0
    const reserve = (amount: number): void => {
      if (allocated + amount > 80) fail('shared expansion limit')
      allocated += amount
    }
    const make = () => createSparseVisibilityGraph({ x: 0, y: 0, width: 20, height: 20 }, [], [terminal], [goal], 8,
      { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }, 32768, fail, reserve)
    const first = make(), second = make(), prepared = allocated
    expect(() => first.route([terminal], goal, () => {
      second.route([terminal], goal, () => { first.route([terminal], goal); return true })
      return true
    })).toThrow('shared expansion limit')
    expect(allocated).toBeGreaterThan(prepared)
    expect(allocated).toBeLessThanOrEqual(80)
    expect(first.vertices + second.vertices).toBe(allocated)
  })

  test('sequential sparse goals reuse owned storage while active nested searches reserve their own workspace', () => {
    const bounds = { x: 0, y: 0, width: 20, height: 20 }
    const terminal = { port: { x: 0, y: 10 }, stub: { x: 8, y: 10 }, penalty: 0 }
    const goals = [{ x: 20, y: 10 }, { x: 20, y: 20 }, { x: 20, y: 0 }]
    const work = () => ({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 })
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    let allocated = 0
    const reserve = (amount: number): void => { if (allocated + amount > 100) fail('shared expansion limit'); allocated += amount }
    const graph = createSparseVisibilityGraph(bounds, [], [terminal], goals, 8, work(), 32768, fail, reserve)
    for (const goal of goals) {
      const fresh = createSparseVisibilityGraph(bounds, [], [terminal], goals, 8, work(), 32768, fail)
      expect(graph.route([terminal], goal)).toEqual(fresh.route([terminal], goal))
    }
    expect(allocated).toBeLessThanOrEqual(100)
    expect(graph.vertices).toBe(allocated)
    let nestedAllocated = 0
    const nested = createSparseVisibilityGraph(bounds, [], [terminal], goals, 8, work(), 32768, fail, amount => {
      if (nestedAllocated + amount > 100) fail('shared expansion limit')
      nestedAllocated += amount
    })
    expect(() => nested.route([terminal], goals[0]!, () => { nested.route([terminal], goals[1]!); return true })).toThrow('shared expansion limit')
    expect(nested.vertices).toBe(nestedAllocated)
    expect(nestedAllocated).toBeLessThanOrEqual(100)
  })

  test('successive sparse graphs share inactive physical query buffers without sharing active searches', () => {
    const bounds = { x: 0, y: 0, width: 20, height: 20 }
    const terminal = { port: { x: 0, y: 10 }, stub: { x: 8, y: 10 }, penalty: 0 }
    const goals = [{ x: 20, y: 10 }, { x: 20, y: 20 }, { x: 20, y: 0 }]
    const work = () => ({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 })
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    let allocated = 0
    const reserve = (amount: number): void => { if (allocated + amount > 100) fail('shared expansion limit'); allocated += amount }
    const pool = createSparseQueryWorkspacePool(reserve, fail), sharedWork = work(), graphs: ReturnType<typeof createSparseVisibilityGraph>[] = []
    const queries = [
      { bounds, terminal, goals, goal: goals[0]! },
      { bounds: { x: 40, y: 0, width: 20, height: 10 }, terminal: { port: { x: 40, y: 10 }, stub: { x: 48, y: 10 }, penalty: 0 },
        goals: [{ x: 60, y: 10 }, { x: 60, y: 0 }, { x: 48, y: 0 }], goal: { x: 60, y: 0 } },
      { bounds: { x: 80, y: 0, width: 20, height: 20 }, terminal: { port: { x: 80, y: 10 }, stub: { x: 88, y: 10 }, penalty: 0 },
        goals: [{ x: 100, y: 10 }, { x: 100, y: 20 }, { x: 100, y: 0 }], goal: { x: 100, y: 0 } },
    ]
    for (const query of queries) {
      const graph = createSparseVisibilityGraph(query.bounds, [], [query.terminal], query.goals, 8, sharedWork, 32768, fail, reserve, false, undefined, pool)
      graphs.push(graph)
      const fresh = createSparseVisibilityGraph(query.bounds, [], [query.terminal], query.goals, 8, work(), 32768, fail)
      expect(graph.route([query.terminal], query.goal)).toEqual(fresh.route([query.terminal], query.goal))
    }
    expect(allocated).toBeLessThanOrEqual(100)
    expect(graphs.reduce((sum, graph) => sum + graph.vertices, pool.vertices)).toBe(allocated)
    let nestedAllocated = 0
    const nestedReserve = (amount: number): void => { if (nestedAllocated + amount > 100) fail('shared expansion limit'); nestedAllocated += amount }
    const nestedPool = createSparseQueryWorkspacePool(nestedReserve, fail), nestedWork = work()
    const make = () => createSparseVisibilityGraph(bounds, [], [terminal], goals, 8, nestedWork, 32768, fail, nestedReserve, false, undefined, nestedPool)
    const first = make(), second = make()
    expect(() => first.route([terminal], goals[0]!, () => { second.route([terminal], goals[1]!); return true })).toThrow('shared expansion limit')
    expect(first.vertices + second.vertices + nestedPool.vertices).toBe(nestedAllocated)
    expect(nestedAllocated).toBeLessThanOrEqual(100)
  })

  test('lazy dense visibility preserves legacy routes across queries and charges failures monotonically', () => {
    const bounds = { x: 0, y: 0, width: 220, height: 160 }
    const obstacles = [{ x: 70, y: 25, width: 60, height: 75 }, { x: 105, y: 60, width: 55, height: 65 }]
    const terminals = [70, 120].map(y => ({ port: { x: 20, y }, stub: { x: 28, y }, penalty: 0 }))
    const goals = [{ x: 190, y: 70 }, { x: 190, y: 120 }], blocked = { x: 90, y: 50 }
    const work = () => ({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 })
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const legacy = createVisibilityGrid(bounds, obstacles, terminals, [...goals, blocked], 8, work(), 32768, fail)
    let allocated = 0
    const reserve = (amount: number): void => {
      if (allocated + amount > 32768) fail('shared expansion limit')
      allocated += amount
    }
    const lazy = createLazyVisibilityGrid(bounds, obstacles, terminals, [...goals, blocked], 8, work(), 32768, fail, reserve)
    for (let index = 0; index < goals.length; index++) {
      const expected = legacy.route([terminals[index]!], goals[index]!)
      expect(lazy.route([terminals[index]!], goals[index]!)).toEqual(expected)
      expect(lazy.vertices).toBe(allocated)
    }
    const before = allocated
    expect(() => lazy.route(terminals, blocked)).toThrow('no clear anchor')
    expect(lazy.vertices).toBeGreaterThanOrEqual(before)
    expect(lazy.vertices).toBe(allocated)
    let limited = 0
    const capped = createLazyVisibilityGrid(bounds, obstacles, terminals, goals, 8, work(), 32768, fail, amount => {
      if (limited + amount > 64) fail('shared expansion limit')
      limited += amount
    })
    expect(() => capped.route(terminals, goals[0]!)).toThrow('shared expansion limit')
    expect(limited).toBeLessThanOrEqual(64)
    expect(capped.vertices).toBe(limited)
  })

  test('retired sparse graphs reuse physical adjacency storage within a cumulative arc budget', () => {
    const work = { pairs: 1_000_000, arcs: 180, swaps: 1_000_000 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const reservations: number[] = []
    const pool = createSparseAdjacencyStoragePool(amount => {
      if (work.arcs < amount) fail('shared adjacency limit')
      work.arcs -= amount; reservations.push(amount)
    }, fail)
    const paths: Point[][] = [], expected: Point[][] = []
    for (const offset of [0, 40, -40]) {
      const bounds = { x: offset, y: offset, width: 20, height: 20 }
      const terminal = { port: { x: offset, y: offset + 5 }, stub: { x: offset + 8, y: offset + 5 }, penalty: 0 }, goal = { x: offset + 20, y: offset + 15 }
      const reference = createSparseVisibilityGraph(bounds, [], [terminal], [goal], 8,
        { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }, 32768, fail).route([terminal], goal)
      const graph = createSparseVisibilityGraph(bounds, [], [terminal], [goal], 8,
        work, 32768, fail, undefined, false, undefined, undefined, undefined, pool)
      paths.push(graph.route([terminal], goal)); expected.push(reference)
      graph.retire()
    }
    expect(paths).toEqual(expected)
    expect(reservations).toHaveLength(1)
    expect(pool.arcs).toBe(reservations[0]!)
    expect(work.arcs).toBeGreaterThanOrEqual(0)
  })

  test('simultaneous sparse graph leases isolate nested searches and reject retirement or stale reuse', () => {
    const work = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const pool = createSparseAdjacencyStoragePool(amount => {
      if (work.arcs < amount) fail('shared adjacency limit')
      work.arcs -= amount
    }, fail)
    const make = (offset: number, corner = false) => {
      const bounds = { x: offset, y: offset, width: 20, height: 20 }
      const terminal = corner ? { port: { x: offset, y: offset }, stub: { x: offset, y: offset }, penalty: 0 }
        : { port: { x: offset, y: offset + 5 }, stub: { x: offset + 8, y: offset + 5 }, penalty: 0 }
      const goal = { x: offset + 20, y: offset + (corner ? 20 : 15) }
      const graph = createSparseVisibilityGraph(bounds, [], [terminal], [goal], 8, work, 32768, fail,
        undefined, false, undefined, undefined, undefined, pool)
      const expected = createSparseVisibilityGraph(bounds, [], [terminal], [goal], 8,
        { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }, 32768, fail).route([terminal], goal)
      return { graph, terminal, goal, expected }
    }
    const first = make(0), firstCapacity = pool.arcs, second = make(40)
    expect(pool.arcs).toBe(firstCapacity * 2)
    const firstPoints = first.graph.route([first.terminal], first.goal, () => {
      expect(() => first.graph.retire()).toThrow('active query')
      expect(second.graph.route([second.terminal], second.goal, () => {
        expect(() => second.graph.retire()).toThrow('active query')
        expect(() => first.graph.retire()).toThrow('active query')
        return true
      })).toEqual(second.expected)
      return true
    })
    expect(firstPoints).toEqual(first.expected)
    second.graph.retire()
    const third = make(-40)
    expect(pool.arcs).toBe(firstCapacity * 2)
    const beforeStale = { ...work }
    expect(() => second.graph.route([second.terminal], second.goal)).toThrow('retired sparse graph')
    expect(work).toEqual(beforeStale)
    second.graph.retire()
    const beforeFourth = pool.arcs, fourth = make(80, true)
    expect(pool.arcs).toBeGreaterThan(beforeFourth)
    expect(third.graph.route([third.terminal], third.goal)).toEqual(third.expected)
    expect(fourth.graph.route([fourth.terminal], fourth.goal)).toEqual(fourth.expected)
    expect(first.graph.route([first.terminal], first.goal)).toEqual(firstPoints)
    first.graph.retire(); third.graph.retire(); fourth.graph.retire()
  })

  test.each(['empty-wrapped', 'positive-wrapped', 'positive-replaced'] as const)('a failed sparse construction releases its lease while preserving another live graph (%s)', kind => {
    const work = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const pool = createSparseAdjacencyStoragePool(amount => {
      if (work.arcs < amount) fail('shared adjacency limit')
      work.arcs -= amount
    }, fail)
    const bounds = { x: 0, y: 0, width: 20, height: 20 }, terminal = { port: { x: 0, y: 5 }, stub: { x: 8, y: 5 }, penalty: 0 }, goal = { x: 20, y: 15 }
    const obstacles = kind === 'empty-wrapped' ? [] : [{ x: 8, y: 8, width: 4, height: 4 }]
    const live = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work, 32768, fail,
      undefined, false, undefined, undefined, undefined, pool)
    const firstCapacity = pool.arcs, expected = live.route([terminal], goal), original = structuredClone(expected)
    const queries = createCompoundObstacleIndex(obstacles, work, fail), interrupted = new Error('construction interrupted')
    let abort = true
    const originalQuery = queries.entersSegment
    const guardedQuery = (...args: Parameters<typeof queries.entersSegment>) => {
      if (abort) throw interrupted
      return originalQuery(...args)
    }
    const provider = kind === 'positive-replaced' ? queries : { ...queries, entersSegment: guardedQuery }
    if (kind === 'positive-replaced') queries.entersSegment = guardedQuery
    const construct = () => createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work, 32768, fail,
      undefined, false, () => provider, undefined, undefined, pool)
    expect(construct).toThrow(interrupted)
    expect(pool.arcs).toBe(firstCapacity * 2)
    abort = false
    const next = construct()
    expect(pool.arcs).toBe(firstCapacity * 2)
    expect(next.route([terminal], goal)).toEqual(original)
    expect(live.route([terminal], goal)).toEqual(original)
    expect(expected).toEqual(original)
    next.retire(); live.retire()
  })

  test('adjacency growth retains full old buffers and refuses capacity reuse while both leases are live', () => {
    const work = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const reservations: number[] = []
    let retained = 0
    const pool = createSparseAdjacencyStoragePool(amount => {
      if (retained + amount > 80 || work.arcs < amount) fail('shared adjacency limit')
      work.arcs -= amount; retained += amount; reservations.push(amount)
    }, fail)
    const bounds = { x: 0, y: 0, width: 20, height: 20 }, goal = { x: 20, y: 20 }
    const corner = { port: { x: 0, y: 0 }, stub: { x: 0, y: 0 }, penalty: 0 }
    const side = { port: { x: 0, y: 5 }, stub: { x: 8, y: 5 }, penalty: 0 }
    const make = (terminal: typeof corner) => createSparseVisibilityGraph(bounds, [], [terminal], [goal], 8,
      work, 32768, fail, undefined, false, undefined, undefined, undefined, pool)
    const small = make(corner)
    small.retire()
    const large = make(side)
    expect(reservations).toHaveLength(2)
    expect(reservations[1]!).toBeGreaterThan(reservations[0]!)
    expect(pool.arcs).toBe(reservations[0]! + reservations[1]!)
    const smallAgain = make(corner), beforeRejected = pool.arcs
    expect(() => make(side)).toThrow('shared adjacency limit')
    expect(pool.arcs).toBe(beforeRejected)
    expect(large.route([side], goal).at(-1)).toEqual(goal)
    expect(smallAgain.route([corner], goal).at(-1)).toEqual(goal)
    expect(retained).toBe(pool.arcs)
    large.retire(); smallAgain.retire()
  })

  test('interior sparse guides use free outer strips without refunding a previous search', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 }
    const obstacles = [{ x: 0, y: 0, width: 80, height: 20 }, { x: 0, y: 60, width: 80, height: 20 },
      { x: 40, y: 40, width: 20, height: 20 }]
    const terminal = { port: { x: 60, y: 50 }, stub: { x: 68, y: 50 }, penalty: 0 }, goal = { x: 60, y: 90 }
    const work = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    let allocated = 0
    const reserve = (amount: number): void => { if (allocated + amount > 32768) fail('shared expansion limit'); allocated += amount }
    const canTraverse = (a: Point, b: Point): boolean => a.x !== b.x || ![0, 80, 100].includes(a.x)
    const first = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work, 32768, fail, reserve)
    try { first.route([terminal], goal, undefined, canTraverse) } catch (error) { if (!(error instanceof GraphLayoutUnsupportedError)) throw error }
    const prior = allocated, pairsBefore = work.pairs
    const retry = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work, 32768 - allocated, fail, reserve, true)
    const points = retry.route([terminal], goal, undefined, canTraverse)
    expect(points.some(point => point.x === 90 && point.y === 90)).toBe(true)
    expect(points[0]).toEqual(terminal.port)
    expect(points.at(-1)).toEqual(goal)
    expect(allocated).toBeGreaterThan(prior)
    expect(allocated).toBe(first.vertices + retry.vertices)
    expect(work.pairs).toBeLessThan(pairsBefore)
    for (let index = 1; index < points.length; index++) for (const obstacle of obstacles) {
      expect(crossesInterior(points[index - 1]!, points[index]!, obstacle)).toBe(false)
    }
  })

  test.each([false, true])('outer sparse guides split at actual parallel rails while preserving perpendicular crossings (transpose %s)', transpose => {
    const point = (x: number, y: number): Point => transpose ? { x: y, y: x } : { x, y }
    const bounds = { x: 0, y: 0, width: 100, height: 100 }
    const obstacles = [{ x: 0, y: 0, width: 80, height: 20 }, { x: 0, y: 60, width: 80, height: 20 },
      { x: 40, y: 40, width: 20, height: 20 }].map(box => transpose
      ? { x: box.y, y: box.x, width: box.height, height: box.width } : box)
    const terminal = { port: point(60, 50), stub: point(68, 50), penalty: 0 }, goal = point(60, 90)
    const rails = [[point(90, 0), point(90, 100)], [point(80, 70), point(100, 70)]] as const
    const original = structuredClone(rails)
    const work = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    let allocated = 0
    const reserve = (amount: number): void => { if (allocated + amount > 32768) fail('shared expansion limit'); allocated += amount }
    const canTraverse = (a: Point, b: Point): boolean => transpose
      ? a.y !== b.y || ![0, 80, 90, 100].includes(a.y)
      : a.x !== b.x || ![0, 80, 90, 100].includes(a.x)
    const first = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work, 32768, fail, reserve, true)
    expect(() => first.route([terminal], goal, undefined, canTraverse)).toThrow('no bounded clear corridor')
    const prior = allocated, pairsBefore = work.pairs
    const retry = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work, 32768 - allocated, fail, reserve, true, undefined, undefined, rails)
    const points = retry.route([terminal], goal, undefined, canTraverse)
    expect(points).toContainEqual(point(85, 90))
    expect(points[0]).toEqual(terminal.port)
    expect(points.at(-1)).toEqual(goal)
    expect(allocated).toBeGreaterThan(prior)
    expect(allocated).toBe(first.vertices + retry.vertices)
    expect(work.pairs).toBeLessThan(pairsBefore)
    expect(rails).toEqual(original)
    expect(countPolylineCrossings([{ points }, { points: [...rails[1]] }])).toBe(1)
    for (let index = 1; index < points.length; index++) for (const obstacle of obstacles) {
      expect(crossesInterior(points[index - 1]!, points[index]!, obstacle)).toBe(false)
    }
  })

  test('sparse root transitions retain their selected nonzero lead before alternative paths merge', () => {
    const bounds = { x: 0, y: 0, width: 40, height: 40 }, obstacles = [{ x: 0, y: 0, width: 10, height: 40 }]
    const terminal = { port: { x: 10, y: 10 }, stub: { x: 18, y: 10 }, penalty: 0 }, goal = { x: 30, y: 30 }
    const work = () => ({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 })
    const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
    const canTraverse = (a: Point, b: Point): boolean => a.x !== b.x || ![18, 30].includes(a.x)
    const graph = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work(), 32768, fail)
    const points = graph.route([terminal], goal, path => path[1]!.y === terminal.port.y && path[1]!.x >= terminal.stub.x
      && path.at(-2)!.y === goal.y && path.filter(p => p.x === terminal.port.x && p.y === terminal.port.y).length === 1, canTraverse)
    expect(points[0]).toEqual(terminal.port)
    expect(points[1]!.y).toBe(terminal.port.y)
    expect(points[1]!.x).toBeGreaterThanOrEqual(terminal.stub.x)
    expect(points.at(-1)).toEqual(goal)
    for (let index = 1; index < points.length; index++) expect(crossesInterior(points[index - 1]!, points[index]!, obstacles[0]!)).toBe(false)
    const zero = { port: terminal.port, stub: terminal.port, penalty: 0 }
    const synthetic = createSparseVisibilityGraph(bounds, obstacles, [zero], [goal], 8, work(), 32768, fail)
    expect(synthetic.route([zero], goal, path => path.at(-2)!.y === goal.y, canTraverse).at(-1)).toEqual(goal)
  })

  test('retains labelled cyclic leaf contacts across nested compound scopes', () => {
    const padding = { top: 35, right: 24, bottom: 24, left: 24 }
    const pairs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0], [0, 2], [3, 5], [6, 8], [9, 1], [1, 0], [9, 9]]
    const input = measured({ nodes: Array.from({ length: 10 }, (_, index) => ({
      id: `card-${index}`, width: 70 + index % 3 * 20, height: 40 + index % 2 * 12, parent: index < 5 ? 0 : 1,
    })), groups: [{ id: 'outer', minWidth: 150, padding }, { id: 'inner', parent: 0, minWidth: 150, padding }],
    edges: pairs.map(([source, target], index) => ({ source: source!, target: target!, minSpan: 1,
      ...(index % 3 === 0 ? { label: { width: 80 + index % 4 * 20, height: 18 } } : {}) })) })
    const original = structuredClone(input), output = layoutAgenticGraph(input)
    expect(input).toEqual(original)
    expect(layoutAgenticGraph(input)).toEqual(output)
    expect(output.edges).toHaveLength(input.edges.length)
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    for (const [index, route] of output.edges.entries()) {
      const edge = input.edges[index]!
      expect(onOutline(route.points[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(route.points.at(-1)!, boxes[edge.target]!)).toBe(true)
      for (let segment = 1; segment < route.points.length; segment++) {
        for (const box of boxes) expect(crossesInterior(route.points[segment - 1]!, route.points[segment]!, box)).toBe(false)
        for (const frame of output.groups!) expect(crossesInterior(route.points[segment - 1]!, route.points[segment]!, { ...frame, height: padding.top })).toBe(false)
      }
      if (edge.label) expect(route.labelPosition).toBeDefined()
    }
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('partition blocks preserve spans, parallel contacts and loops in %s', direction => {
    const input = measured({ direction, nodes: [
      { id: 'a', width: 80, height: 40, partition: 0 },
      { id: 'b', width: 60, height: 55, partition: 0 },
      { id: 'c', width: 100, height: 30, partition: 10000 },
      { id: 'unlisted', width: 70, height: 45 },
    ], edges: [
      { source: 0, target: 1, minSpan: 3 },
      { source: 1, target: 2, minSpan: 1 },
      { source: 2, target: 0, minSpan: 2, label: { width: 80, height: 20 } },
      { source: 2, target: 0, minSpan: 1 },
      { source: 2, target: 2, minSpan: 1 },
    ] })
    const original = structuredClone(input), output = layoutAgenticGraph(input)
    expect(input).toEqual(original)
    expect(layoutAgenticGraph(input)).toEqual(output)
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    const horizontal = direction === 'LR' || direction === 'RL'
    const reverse = direction === 'BT' || direction === 'RL'
    const before = (a: Box, b: Box) => reverse
      ? (horizontal ? a.x : a.y) >= (horizontal ? b.x + b.width : b.y + b.height)
      : (horizontal ? a.x + a.width : a.y + a.height) <= (horizontal ? b.x : b.y)
    for (const index of [0, 1, 3]) expect(before(boxes[index]!, boxes[2]!)).toBe(true)
    const mainGap = horizontal ? Math.abs(boxes[1]!.x - boxes[0]!.x) : Math.abs(boxes[1]!.y - boxes[0]!.y)
    expect(mainGap).toBeGreaterThanOrEqual(input.layerSpacing * 3)
    expect(output.edges).toHaveLength(input.edges.length)
    for (const [index, route] of output.edges.entries()) {
      const authored = input.edges[index]!
      expect(onOutline(route.points[0]!, boxes[authored.source]!)).toBe(true)
      expect(onOutline(route.points.at(-1)!, boxes[authored.target]!)).toBe(true)
      for (let segment = 1; segment < route.points.length; segment++) for (const box of boxes) {
        expect(crossesInterior(route.points[segment - 1]!, route.points[segment]!, box)).toBe(false)
      }
    }
    expect(output.edges[2]!.labelPosition).toBeDefined()
    expect(() => layoutAgenticGraph({ ...input, edges: [{ source: 0, target: 2, minSpan: 2048 }] })).toThrow('rank-expansion limit')
    expect(() => layoutAgenticGraph({ ...input, nodes: input.nodes.map(node => ({ ...node, partition: -1 })) })).toThrow('Invalid measured partition')
  })

  test('direct compound corridors retain more than sixteen authored cross-scope leaf contacts', () => {
    const padding = { top: 40, right: 24, bottom: 24, left: 24 }
    const input = measured({ direction: 'LR', nodes: Array.from({ length: 34 }, (_, index) => ({
      id: `leaf-${index}`, width: 80, height: 36, parent: index < 17 ? 0 : 1,
    })), groups: [{ id: 'left', minWidth: 120, padding }, { id: 'right', minWidth: 120, padding }],
    edges: Array.from({ length: 17 }, (_, index) => ({ source: index, target: index + 17, minSpan: 1 })) })
    const original = structuredClone(input), output = layoutAgenticGraph(input)
    expect(input).toEqual(original)
    expect(layoutAgenticGraph(input)).toEqual(output)
    expect(output.edges).toHaveLength(17)
    expect(output.boundaryRoutes).toEqual(Array.from({ length: 17 }, (_, index) => index))
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    for (const [index, route] of output.edges.entries()) {
      expect(onOutline(route.points[0]!, boxes[index]!)).toBe(true)
      expect(onOutline(route.points.at(-1)!, boxes[index + 17]!)).toBe(true)
      for (let segment = 1; segment < route.points.length; segment++) {
        for (const box of boxes) expect(crossesInterior(route.points[segment - 1]!, route.points[segment]!, box)).toBe(false)
        for (const frame of output.groups!) expect(crossesInterior(route.points[segment - 1]!, route.points[segment]!, { ...frame, height: padding.top })).toBe(false)
      }
    }
    expect(() => layoutLayeredGraph(input, () => undefined, reason => { throw new GraphLayoutUnsupportedError(reason) }, { pairs: 0, arcs: 0, swaps: 0 })).toThrow(GraphLayoutUnsupportedError)
  })

  test('compound fan-out reserves distinct authored source rays beyond twelve incident edges', () => {
    const padding = { top: 40, right: 24, bottom: 24, left: 24 }
    const input = measured({ direction: 'LR', nodes: [
      { id: 'hub', width: 120, height: 80, parent: 0 },
      ...Array.from({ length: 18 }, (_, index) => ({ id: `target-${index}`, width: 80, height: 36, parent: 1 })),
    ], groups: [{ id: 'left', minWidth: 120, padding }, { id: 'right', minWidth: 120, padding }],
    edges: Array.from({ length: 18 }, (_, index) => ({ source: 0, target: index + 1, minSpan: 1 })) })
    const output = layoutAgenticGraph(input)
    expect(layoutAgenticGraph(input)).toEqual(output)
    expect(output.edges).toHaveLength(18)
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    const starts = output.edges.map(route => `${route.points[0]!.x},${route.points[0]!.y}`)
    expect(new Set(starts).size).toBe(18)
    for (const [index, route] of output.edges.entries()) {
      expect(onOutline(route.points[0]!, boxes[0]!)).toBe(true)
      expect(onOutline(route.points.at(-1)!, boxes[index + 1]!)).toBe(true)
      for (let segment = 1; segment < route.points.length; segment++) {
        for (const box of boxes) expect(crossesInterior(route.points[segment - 1]!, route.points[segment]!, box)).toBe(false)
        for (const frame of output.groups!) expect(crossesInterior(route.points[segment - 1]!, route.points[segment]!, { ...frame, height: padding.top })).toBe(false)
      }
    }
  })

  test('preserves reciprocal authored routes within an ordered partition', () => {
    const input = measured({ nodes: [
      { id: 'a', width: 80, height: 40, partition: 0 },
      { id: 'b', width: 60, height: 55, partition: 0 },
      { id: 'c', width: 100, height: 30, partition: 1 },
    ], edges: [
      { source: 0, target: 1, minSpan: 1 }, { source: 1, target: 0, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 },
    ] })
    const original = structuredClone(input), output = layoutAgenticGraph(input)
    expect(input).toEqual(original)
    expect(layoutAgenticGraph(input)).toEqual(output)
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    expect(boxes[2]!.y).toBeGreaterThanOrEqual(Math.max(boxes[0]!.y + boxes[0]!.height, boxes[1]!.y + boxes[1]!.height))
    for (const [index, route] of output.edges.entries()) {
      const edge = input.edges[index]!
      expect(onOutline(route.points[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(route.points.at(-1)!, boxes[edge.target]!)).toBe(true)
      for (let segment = 1; segment < route.points.length; segment++) for (const box of boxes) {
        expect(crossesInterior(route.points[segment - 1]!, route.points[segment]!, box)).toBe(false)
      }
    }
  })

  test.each([0, 310, 1_000_000])('retains feasible compact long-edge routes with joint-order budget %s', blockPairs => {
    const input = measured({ compactPrivateRanks: true,
      nodes: Array.from({ length: 5 }, (_, index) => ({ id: String(index), width: 40, height: 40 })),
      edges: [0, 1].flatMap(source => [2, 3, 4].map(target => ({ source, target, minSpan: 3 }))),
    })
    const original = structuredClone(input)
    const place = (budget: number) => layoutLayeredGraph(input, () => undefined,
      reason => { throw new GraphLayoutUnsupportedError(reason) }, undefined,
      { attempts: 0, scorePairs: 0, loopPairs: 0, rankPairs: 200_000, blockPairs: budget, routing: { pairs: 0, arcs: 0, swaps: 0 } })
    const baseline = place(0), output = place(blockPairs)
    expect(input).toEqual(original)
    expect(output.nodes).toHaveLength(5)
    expect(output.edges).toHaveLength(6)
    expect(countPolylineCrossings(output.edges)).toBeLessThanOrEqual(countPolylineCrossings(baseline.edges))
    const boxes = output.nodes.map((node, index) => ({ ...node, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
    for (const [index, route] of output.edges.entries()) {
      const edge = input.edges[index]!
      expect(onOutline(route.points[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(route.points.at(-1)!, boxes[edge.target]!)).toBe(true)
      for (let segment = 1; segment < route.points.length; segment++) for (const box of boxes) {
        expect(crossesInterior(route.points[segment - 1]!, route.points[segment]!, box)).toBe(false)
      }
    }
  })

  test('retains feasible loop routes when optional request work is exhausted', () => {
    const input = measured({ nodes: [{ id: 'loop', width: 120, height: 60 }], edges: [{ source: 0, target: 0, minSpan: 1, label: { width: 80, height: 20 } }] })
    const work = { attempts: 0, scorePairs: 0, loopPairs: 1, rankPairs: 0, routing: { pairs: 0, arcs: 0, swaps: 0 } }
    const output = layoutLayeredGraph(input, () => undefined, reason => { throw new GraphLayoutUnsupportedError(reason) }, undefined, work)
    expect(work.loopPairs).toBeLessThan(0)
    expect(output.edges[0]!.points.length).toBeGreaterThanOrEqual(4)
    const box = { ...output.nodes[0]!, width: 120, height: 60 }
    expect(onOutline(output.edges[0]!.points[0]!, box)).toBe(true)
    expect(onOutline(output.edges[0]!.points.at(-1)!, box)).toBe(true)
    for (let i = 1; i < output.edges[0]!.points.length; i++) expect(crossesInterior(output.edges[0]!.points[i - 1]!, output.edges[0]!.points[i]!, box)).toBe(false)
  })
  for (const direction of ['TD', 'BT', 'LR', 'RL'] satisfies Direction[]) {
    test(`compacts an isolated labelled loop without masking its own shaft in ${direction}`, () => {
      const horizontal = direction === 'LR' || direction === 'RL'
      const input = measured({ direction, padding: 16, nodeSpacing: 24, layerSpacing: 48,
        nodes: [{ id: 'loop', width: horizontal ? 60 : 120, height: horizontal ? 120 : 60 }],
        edges: [{ source: 0, target: 0, minSpan: 1, label: { width: 80, height: 20 } }],
      })
      const output = layoutAgenticGraph(input), edge = output.edges[0]!, label = edge.labelPosition!
      expect(layoutAgenticGraph(input)).toEqual(output)
      expect(edge.points).toHaveLength(4)
      const node = { ...output.nodes[0]!, width: input.nodes[0]!.width, height: input.nodes[0]!.height }
      const pill = { x: label.x - 40, y: label.y - 10, width: 80, height: 20 }
      expect(intersects(node, pill)).toBe(false)
      expect(onOutline(edge.points[0]!, node)).toBe(true)
      expect(onOutline(edge.points.at(-1)!, node)).toBe(true)
      expect(Math.hypot(edge.points[0]!.x - edge.points.at(-1)!.x, edge.points[0]!.y - edge.points.at(-1)!.y)).toBeGreaterThanOrEqual(8)
      for (let i = 1; i < edge.points.length; i++) {
        expect(crossesInterior(edge.points[i - 1]!, edge.points[i]!, node)).toBe(false)
        expect(crossesInterior(edge.points[i - 1]!, edge.points[i]!, pill)).toBe(false)
      }
      expect(pill.x).toBeGreaterThanOrEqual(input.padding)
      expect(pill.y).toBeGreaterThanOrEqual(input.padding)
      expect(pill.x + pill.width).toBeLessThanOrEqual(output.width - input.padding)
      expect(pill.y + pill.height).toBeLessThanOrEqual(output.height - input.padding)
    })
    test(`aligns distinct fan-in ports with reserved lanes in ${direction}`, () => {
      const horizontal = direction === 'LR' || direction === 'RL'
      const input = measured({ direction, padding: 16, nodeSpacing: 24, layerSpacing: 48,
        nodes: [80, 80, 220].map((cross, index) => ({ id: String(index), width: horizontal ? 40 : cross, height: horizontal ? cross : 40 })),
        edges: [{ source: 0, target: 2, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }],
      })
      const output = layoutAgenticGraph(input)
      expect(output.edges.reduce((sum, edge) => sum + edge.points.length - 2, 0)).toBeLessThanOrEqual(2)
      expect(countPolylineCrossings(output.edges)).toBe(0)
      const ends = output.edges.map(edge => edge.points.at(-1)!)
      expect(Math.abs(horizontal ? ends[0]!.y - ends[1]!.y : ends[0]!.x - ends[1]!.x)).toBeGreaterThanOrEqual(8)
      const boxes = output.nodes.map((node, index) => ({ ...node, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
      for (const [index, edge] of output.edges.entries()) {
        expect(onOutline(edge.points[0]!, boxes[input.edges[index]!.source]!)).toBe(true)
        expect(onOutline(edge.points.at(-1)!, boxes[2]!)).toBe(true)
        for (let i = 1; i < edge.points.length; i++) for (const box of boxes) expect(crossesInterior(edge.points[i - 1]!, edge.points[i]!, box)).toBe(false)
      }
    })
  }
  for (const direction of ['TD', 'TB', 'BT', 'LR', 'RL'] satisfies Direction[]) {
    test(`preserves measured geometry, labelled fan-in and long parallel routes in ${direction}`, () => {
      const input = measured({ direction })
      const original = structuredClone(input)
      const output = layoutAgenticGraph(input)
      expect(input).toEqual(original)
      expect(layoutAgenticGraph(input)).toEqual(output)
      expect(output.nodes).toHaveLength(input.nodes.length)
      expect(output.edges).toHaveLength(input.edges.length)
      const boxes = output.nodes.map((node, index) => ({ ...node, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
      for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index]!
        expect(box.x).toBeGreaterThanOrEqual(input.padding)
        expect(box.y).toBeGreaterThanOrEqual(input.padding)
        expect(box.x + box.width).toBeLessThanOrEqual(output.width - input.padding)
        expect(box.y + box.height).toBeLessThanOrEqual(output.height - input.padding)
        for (let other = index + 1; other < boxes.length; other++) expect(intersects(box, boxes[other]!)).toBe(false)
      }
      for (const edge of output.edges) if (edge.labelPosition) expect(edge.points.some(point => point === edge.labelPosition)).toBe(false)
      const labelBoxes = output.edges.flatMap((edge, index) => {
        const measuredLabel = input.edges[index]!.label
        if (!measuredLabel) { expect(edge.labelPosition).toBeUndefined(); return [] }
        expect(edge.labelPosition).toBeDefined()
        return [{
          edgeIndex: index,
          x: edge.labelPosition!.x - measuredLabel.width / 2,
          y: edge.labelPosition!.y - measuredLabel.height / 2,
          ...measuredLabel,
        }]
      })
      for (let index = 0; index < labelBoxes.length; index++) {
        const label = labelBoxes[index]!
        for (const box of boxes) expect(intersects(label, box)).toBe(false)
        for (const other of labelBoxes.slice(index + 1)) expect(intersects(label, other)).toBe(false)
      }
      const horizontal = direction === 'LR' || direction === 'RL'
      const reversed = direction === 'BT' || direction === 'RL'
      for (let index = 0; index < input.edges.length; index++) {
        const edge = input.edges[index]!, route = output.edges[index]!.points
        const source = boxes[edge.source]!, target = boxes[edge.target]!
        const start = route[0]!, end = route.at(-1)!
        if (horizontal) {
          expect(start.x).toBe(source.x + (reversed ? 0 : source.width))
          expect(end.x).toBe(target.x + (reversed ? target.width : 0))
          expect(start.y).toBeGreaterThan(source.y)
          expect(start.y).toBeLessThan(source.y + source.height)
          expect(end.y).toBeGreaterThan(target.y)
          expect(end.y).toBeLessThan(target.y + target.height)
        } else {
          expect(start.y).toBe(source.y + (reversed ? 0 : source.height))
          expect(end.y).toBe(target.y + (reversed ? target.height : 0))
          expect(start.x).toBeGreaterThan(source.x)
          expect(start.x).toBeLessThan(source.x + source.width)
          expect(end.x).toBeGreaterThan(target.x)
          expect(end.x).toBeLessThan(target.x + target.width)
        }
        for (let segment = 1; segment < route.length; segment++) {
          const a = route[segment - 1]!, b = route[segment]!
          // The painted pill masks its own shaft. Every foreign route and
          // every node must stay clear of its occupied label rectangle.
          for (const box of [...boxes, ...labelBoxes.filter(label => label.edgeIndex !== index)]) expect(crossesInterior(a, b, box)).toBe(false)
        }
        const label = output.edges[index]!.labelPosition
        if (label) expect(route.some((point, index) => {
          const previous = route[index - 1]
          return previous && ((point.x === previous.x && label.x === point.x && label.y >= Math.min(point.y, previous.y) && label.y <= Math.max(point.y, previous.y))
            || (point.y === previous.y && label.y === point.y && label.x >= Math.min(point.x, previous.x) && label.x <= Math.max(point.x, previous.x)))
        })).toBe(true)
      }
      expect(output.edges[3]!.points).not.toEqual(output.edges[4]!.points)
    })
  }

  test('minimum rank spans reserve actual distance, including an otherwise empty rank', () => {
    const nodes = [{ id: 'a', width: 40, height: 20 }, { id: 'b', width: 40, height: 20 }]
    const short = layoutAgenticGraph(measured({ nodes, edges: [{ source: 0, target: 1, minSpan: 1 }] }))
    const long = layoutAgenticGraph(measured({ nodes, edges: [{ source: 0, target: 1, minSpan: 4 }] }))
    expect(long.nodes[1]!.y - long.nodes[0]!.y).toBeGreaterThanOrEqual(4 * 44)
    expect(long.height).toBeGreaterThan(short.height)
    expect(long.edges[0]!.points[0]).toEqual({ x: 37, y: 37 })
    expect(long.edges[0]!.points.at(-1)).toEqual({ x: 37, y: long.nodes[1]!.y })
  })

  test('can order a crossed authored bipartite pair without crossing its routes', () => {
    const input = measured({
      nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, width: 40, height: 20 })),
      edges: [{ source: 0, target: 3, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }],
    })
    const output = layoutAgenticGraph(input)
    const sourceOrder = output.nodes[0]!.x - output.nodes[1]!.x
    const targetOrder = output.nodes[3]!.x - output.nodes[2]!.x
    expect(sourceOrder * targetOrder).toBeGreaterThan(0)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('compacts long measured channels without a turn at every rank in %s', direction => {
    const sizes = [40, 200, 20, 200, 40]
    const input = measured({ direction, nodes: sizes.map((size, index) => ({ id: `n${index}`, width: size, height: size })), edges: [
      { source: 0, target: 1, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 },
      { source: 2, target: 3, minSpan: 1 }, { source: 3, target: 4, minSpan: 1 },
      { source: 0, target: 4, minSpan: 1 },
    ] })
    const output = layoutAgenticGraph(input), route = output.edges[4]!.points
    expect(route.length).toBeLessThanOrEqual(6)
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    expect(onOutline(route[0]!, boxes[0]!)).toBe(true)
    expect(onOutline(route.at(-1)!, boxes[4]!)).toBe(true)
    for (let index = 1; index < route.length; index++) for (const box of boxes) expect(crossesInterior(route[index - 1]!, route[index]!, box)).toBe(false)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('keeps interleaved routes distinct instead of hiding crossings in shared ink in %s', direction => {
    const input = measured({ direction, nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, width: 80, height: 40 })), edges: [
      { source: 0, target: 2, minSpan: 1 }, { source: 0, target: 3, minSpan: 1 },
      { source: 1, target: 2, minSpan: 1 }, { source: 1, target: 3, minSpan: 1 },
    ] })
    const output = layoutAgenticGraph(input)
    const routes = output.edges.map((route, index) => ({ ...route, source: input.nodes[input.edges[index]!.source]!.id,
      target: input.nodes[input.edges[index]!.target]!.id, style: 'solid' as const }))
    expect(countOpposingRouteOverlaps(routes)).toBe(0)
    expect(countParallelRouteOverlaps(routes)).toBe(0)
    expect(countPolylineCrossings(routes)).toBeGreaterThan(0)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('shortens parallel routes between unequal boxes without sharing their shafts in %s', direction => {
    const input = measured({ direction, nodes: [{ id: 'a', width: 80, height: 40 }, { id: 'b', width: 40, height: 60 }],
      edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 0, target: 1, minSpan: 1 }] })
    const original = structuredClone(input), placed = layoutAgenticGraph(input)
    const routes = placed.edges.map(edge => ({ ...edge, source: 'a', target: 'b', style: 'solid' as const }))
    expect(routes).toHaveLength(2)
    for (const route of routes) expect(route.points.length).toBeLessThanOrEqual(4)
    expect(countPolylineCrossings(routes)).toBe(0)
    expect(countParallelRouteOverlaps(routes)).toBe(0)
    expect(countOpposingRouteOverlaps(routes)).toBe(0)
    expect(routes[0]!.points).not.toEqual(routes[1]!.points)
    expect(input).toEqual(original)
    expect(layoutAgenticGraph(input)).toEqual(placed)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('keeps a labelled branch beside an unrelated wide root in %s', direction => {
    const horizontal = direction === 'LR' || direction === 'RL'
    const input = measured({ direction, nodes: [80, 80, 80, 200].map((size, index) => ({ id: String(index),
      width: horizontal ? 40 : size, height: horizontal ? size : 40 })), edges: [
      { source: 0, target: 1, minSpan: 1, label: horizontal ? { width: 20, height: 160 } : { width: 160, height: 20 } },
      { source: 1, target: 2, minSpan: 1 },
    ] })
    const original = structuredClone(input), placed = layoutAgenticGraph(input), axis = horizontal ? 'y' : 'x'
    expect(placed.nodes[1]![axis]).toBeLessThan(placed.nodes[3]![axis])
    expect(placed.nodes[1]![axis]).toBe(placed.nodes[2]![axis])
    expect(countPolylineCrossings(placed.edges)).toBe(0)
    expect(input).toEqual(original)
  })

  test('keeps nearly coincident terminal columns out of parallel route ink', () => {
    const steps = [
      { sourceCross: 100.25, targetCross: 140, offset: 0, track: 0 },
      { sourceCross: 20, targetCross: 100, offset: 0, track: 0 },
    ] as import('../layout/channel-tracks.ts').ChannelStep[]
    const height = assignChannelTracks(steps, 60, 6, 180, { pairs: 100, arcs: 100, swaps: 100 }, reason => { throw new Error(reason) })
    const routes = steps.map(step => ({ source: 'a', target: 'b', style: 'solid' as const, points: [
      { x: step.sourceCross, y: 0 }, { x: step.sourceCross, y: step.offset },
      { x: step.targetEscape ?? step.targetCross, y: step.offset },
      ...(step.targetEscape === undefined ? [] : [{ x: step.targetEscape, y: step.targetExit! }, { x: step.targetCross, y: step.targetExit! }]),
      { x: step.targetCross, y: height },
    ] }))
    expect(countParallelRouteOverlaps(routes)).toBe(0)
    expect(countOpposingRouteOverlaps(routes)).toBe(0)
  })

  test('compacts a short incoming branch without lengthening its minimum span', () => {
    const input = measured({ nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, width: 80, height: 40 })), edges: [
      { source: 0, target: 1, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }, { source: 3, target: 2, minSpan: 1 },
    ] })
    const original = structuredClone(input)
    const placed = layoutAgenticGraph(input)
    expect(placed.nodes[3]!.y).toBe(placed.nodes[1]!.y)
    expect(placed.nodes[1]!.y).toBeGreaterThan(placed.nodes[0]!.y)
    expect(placed.nodes[2]!.y).toBeGreaterThan(placed.nodes[1]!.y)
    expect(countPolylineCrossings(placed.edges)).toBe(0)
    expect(input).toEqual(original)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('owns shared routing only for complete, unlabelled fan nets in %s', direction => {
    const input = measured({ direction, shareCompleteFans: true, nodes: ['\0agentic-fan:0', 'b', 'c', 'd'].map((id, index) => ({ id, width: 80 + 10 * index, height: 40 + 20 * index })), edges: [
      { source: 0, target: 2, minSpan: 1 }, { source: 0, target: 3, minSpan: 1 },
      { source: 1, target: 2, minSpan: 1 }, { source: 1, target: 3, minSpan: 1 },
    ] })
    const original = structuredClone(input), shared = layoutAgenticGraph(input)
    expect(shared.nodes).toHaveLength(4)
    expect(shared.edges).toHaveLength(4)
    expect(shared.sharedEdges).toEqual([0, 1, 2, 3])
    expect(countPolylineCrossings(shared.edges)).toBe(0)
    const ink = shared.edges.map((edge, index) => ({ ...edge, style: 'solid' as const, source: input.nodes[input.edges[index]!.source]!.id, target: input.nodes[input.edges[index]!.target]!.id }))
    expect(countParallelRouteOverlaps(ink)).toBe(0)
    expect(countOpposingRouteOverlaps(ink)).toBe(0)
    const boxes = shared.nodes.map((point, index) => ({ ...point, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
    for (const [index, edge] of input.edges.entries()) {
      const path = shared.edges[index]!.points
      expect(onOutline(path[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(path.at(-1)!, boxes[edge.target]!)).toBe(true)
      for (let cursor = 1; cursor < path.length; cursor++) for (const box of boxes) expect(crossesInterior(path[cursor - 1]!, path[cursor]!, box)).toBe(false)
    }
    expect(shared.edges[0]!.points[0]).toEqual(shared.edges[1]!.points[0])
    expect(shared.edges[0]!.points[0]).not.toBe(shared.edges[1]!.points[0])
    expect(input).toEqual(original)
    for (const edges of [input.edges.slice(0, 3), [...input.edges, input.edges[0]!],
      input.edges.map((edge, index) => index === 0 ? { ...edge, label: { width: 80, height: 20 } } : edge),
      input.edges.map((edge, index) => index === 0 ? { ...edge, minSpan: 2 } : edge)]) {
      const result = layoutAgenticGraph({ ...input, edges })
      expect(result.nodes).toHaveLength(4)
      expect(result.edges).toHaveLength(edges.length)
      expect(result.sharedEdges).toBeUndefined()
    }
  })

  test('bounds local rank and dummy work before expanding a large minimum span', () => {
    expect(() => layoutAgenticGraph(measured({ edges: [{ source: 0, target: 1, minSpan: 1000000 }] })))
      .toThrow(GraphLayoutUnsupportedError)
    const nodes = Array.from({ length: 100 }, (_, index) => ({ id: String(index), width: 40, height: 20 }))
    const edges = Array.from({ length: 400 }, () => ({ source: 0, target: 99, minSpan: 100 }))
    expect(() => layoutAgenticGraph(measured({ nodes, edges }))).toThrow('expanded-graph limit')
    const full = Array.from({ length: 4096 }, (_, index) => ({ id: String(index), width: 40, height: 20 }))
    expect(() => layoutAgenticGraph(measured({ nodes: full, edges: [{ source: 0, target: 0, minSpan: 1 }] }))).toThrow('loop-expansion limit')
    // Each scope fits alone; their combined expanded workspace must also fit.
    const groups = Array.from({ length: 17 }, (_, index) => ({ id: `group${index}`, minWidth: 100, padding: { top: 30, right: 20, bottom: 20, left: 20 } }))
    const scoped = Array.from({ length: 34 }, (_, index) => ({ id: `leaf${index}`, width: 40, height: 20, parent: Math.floor(index / 2) }))
    const links = groups.map((_, index) => ({ source: 2 * index, target: 2 * index + 1, minSpan: 1000 }))
    expect(() => layoutAgenticGraph(measured({ nodes: scoped, groups, edges: links }))).toThrow('compound-expansion limit')
    const fanNodes = Array.from({ length: 1002 }, (_, index) => ({ id: `fan${index}`, width: 40, height: 20 }))
    const fanEdges = fanNodes.slice(1).map((_, index) => ({ source: 0, target: index + 1, minSpan: 1, label: { width: 60, height: 20 } }))
    expect(() => layoutAgenticGraph(measured({ nodes: fanNodes, edges: fanEdges }))).toThrow('channel-pair limit')
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('retains authored cyclic, reciprocal and self-loop routes and labels in %s', direction => {
    const input = measured({ direction, nodes: measured().nodes.map((node, index) => index === 0 ? { ...node, id: '\0agentic-loop:0' } : node), edges: [
      { source: 0, target: 1, minSpan: 1, label: { width: 88, height: 18 } },
      { source: 1, target: 2, minSpan: 1 },
      { source: 2, target: 0, minSpan: 1, label: { width: 72, height: 18 } },
      { source: 0, target: 2, minSpan: 1 },
      { source: 2, target: 3, minSpan: 1 },
      { source: 3, target: 1, minSpan: 1, label: { width: 63, height: 18 } },
      { source: 0, target: 0, minSpan: 1, label: { width: 101, height: 38 } },
      { source: 0, target: 0, minSpan: 1 },
      { source: 2, target: 2, minSpan: 1, label: { width: 78, height: 18 } },
    ] })
    const before = structuredClone(input)
    const output = layoutAgenticGraph(input)
    expect(input).toEqual(before)
    expect(layoutAgenticGraph(input)).toEqual(output)
    expect(output.edges).toHaveLength(input.edges.length)
    expect(output.nodes).toHaveLength(input.nodes.length)
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    for (const [index, edge] of input.edges.entries()) {
      const route = output.edges[index]!.points
      expect(onOutline(route[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(route.at(-1)!, boxes[edge.target]!)).toBe(true)
      expect(Boolean(output.edges[index]!.labelPosition)).toBe(Boolean(edge.label))
      for (let point = 1; point < route.length; point++) {
        expect(route[point]!.x === route[point - 1]!.x || route[point]!.y === route[point - 1]!.y).toBe(true)
        for (const box of boxes) expect(crossesInterior(route[point - 1]!, route[point]!, box)).toBe(false)
      }
    }
    expect(output.edges[6]!.points).not.toEqual(output.edges[7]!.points)
  })

  test('reserves nested frame headers and local directions while retaining authored frame endpoints', () => {
    const pad = { top: 35, right: 20, bottom: 20, left: 20 }
    const input = measured({ direction: 'LR', nodes: [
      { id: 'start', width: 80, height: 30 },
      { id: 'a', width: 80, height: 30, parent: 1 }, { id: 'b', width: 100, height: 40, parent: 1 },
      { id: 'c', width: 90, height: 35, parent: 2 }, { id: 'd', width: 110, height: 45, parent: 2 },
      { id: 'end', width: 80, height: 30 },
    ], groups: [
      { id: 'outer', direction: 'TD', minWidth: 300, padding: pad },
      { id: 'left', parent: 0, direction: 'RL', minWidth: 150, padding: pad },
      { id: 'right', parent: 0, direction: 'BT', minWidth: 150, padding: pad },
    ], edges: [
      { source: 0, target: 6, minSpan: 1 }, { source: 6, target: 5, minSpan: 1 },
      { source: 1, target: 2, minSpan: 1, label: { width: 130, height: 25 } },
      { source: 3, target: 4, minSpan: 1 }, { source: 7, target: 8, minSpan: 1 },
    ] })
    const original = structuredClone(input), output = layoutAgenticGraph(input)
    expect(input).toEqual(original)
    expect(layoutAgenticGraph(input)).toEqual(output)
    expect(output.nodes).toHaveLength(6)
    expect(output.groups).toHaveLength(3)
    expect(output.edges).toHaveLength(5)
    const frames = output.groups!
    const boxes = [...output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point })), ...frames]
    for (const [index, edge] of input.edges.entries()) {
      const route = output.edges[index]!
      expect(onOutline(route.points[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(route.points.at(-1)!, boxes[edge.target]!)).toBe(true)
    }
    for (let index = 1; index < frames.length; index++) {
      const frame = frames[index]!, outer = frames[0]!
      expect(frame.y).toBeGreaterThanOrEqual(outer.y + pad.top)
      expect(frame.x).toBeGreaterThanOrEqual(outer.x + pad.left)
      expect(frame.x + frame.width).toBeLessThanOrEqual(outer.x + outer.width - pad.right)
      expect(frame.y + frame.height).toBeLessThanOrEqual(outer.y + outer.height - pad.bottom)
    }
    for (let index = 1; index <= 4; index++) {
      const node = boxes[index]!, frame = frames[index <= 2 ? 1 : 2]!
      expect(node.y).toBeGreaterThanOrEqual(frame.y + pad.top)
      expect(node.x).toBeGreaterThanOrEqual(frame.x + pad.left)
      expect(node.x + node.width).toBeLessThanOrEqual(frame.x + frame.width - pad.right)
      expect(node.y + node.height).toBeLessThanOrEqual(frame.y + frame.height - pad.bottom)
    }
    expect(output.nodes[1]!.x).toBeGreaterThan(output.nodes[2]!.x)
    expect(output.nodes[3]!.y).toBeGreaterThan(output.nodes[4]!.y)
    expect(frames[0]!.width).toBeGreaterThanOrEqual(300)
    expect(() => layoutAgenticGraph({ ...input, edges: [{ source: 1, target: 3, minSpan: 1 }] })).toThrow('no bounded clear corridor')
    const frameLink = layoutAgenticGraph({ ...input, edges: [{ source: 1, target: input.nodes.length + 2, minSpan: 1 }] })
    expect(onOutline(frameLink.edges[0]!.points.at(-1)!, frameLink.groups![2]!)).toBe(true)
    const ancestor = layoutAgenticGraph({ ...input, edges: [{ source: input.nodes.length, target: 1, minSpan: 1 }] })
    expect(onOutline(ancestor.edges[0]!.points[0]!, ancestor.groups![0]!)).toBe(true)
    expect(onOutline(ancestor.edges[0]!.points.at(-1)!, { ...input.nodes[1]!, ...ancestor.nodes[1]! })).toBe(true)
    expect(ancestor.edges[0]!.points[1]!.x).toBeGreaterThan(ancestor.edges[0]!.points[0]!.x)
    for (let segment = 1; segment < ancestor.edges[0]!.points.length; segment++) {
      const a = ancestor.edges[0]!.points[segment - 1]!, b = ancestor.edges[0]!.points[segment]!
      for (const frame of ancestor.groups!) expect(crossesInterior(a, b, { ...frame, height: pad.top })).toBe(false)
      for (let node = 0; node < input.nodes.length; node++) expect(crossesInterior(a, b, { ...input.nodes[node]!, ...ancestor.nodes[node]! })).toBe(false)
    }
    const longAncestor = layoutAgenticGraph({ ...input, edges: [{ source: input.nodes.length, target: 1, minSpan: 2048 }] })
    const longPoints = longAncestor.edges[0]!.points
    expect(longAncestor.nodes).toHaveLength(input.nodes.length)
    expect(longAncestor.groups).toHaveLength(input.groups!.length)
    expect(longAncestor.edges).toHaveLength(1)
    expect(onOutline(longPoints[0]!, longAncestor.groups![0]!)).toBe(true)
    expect(onOutline(longPoints.at(-1)!, { ...input.nodes[1]!, ...longAncestor.nodes[1]! })).toBe(true)
    expect(longPoints[1]!.x - longPoints[0]!.x).toBeGreaterThanOrEqual(180184)
    for (let segment = 1; segment < longPoints.length; segment++) {
      const a = longPoints[segment - 1]!, b = longPoints[segment]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
      for (const frame of longAncestor.groups!) expect(crossesInterior(a, b, { ...frame, height: pad.top })).toBe(false)
      for (let node = 0; node < input.nodes.length; node++) expect(crossesInterior(a, b, { ...input.nodes[node]!, ...longAncestor.nodes[node]! })).toBe(false)
    }
    expect(input).toEqual(original)
    expect(() => layoutAgenticGraph({ ...input, groups: input.groups!.map((group, index) => index === 0 ? { ...group, parent: 1 } : group) })).toThrow(TypeError)
    expect(() => layoutAgenticGraph({ ...input, groups: input.groups!.map(group => ({ ...group, headerHeight: pad.top + 1 })) })).toThrow('Invalid measured compound header')
  })

  test.each(['TB', 'BT', 'LR', 'RL'] as const)('joins cross-scope leaves without entering frame headers in %s', direction => {
    const padding = { top: 35, right: 20, bottom: 20, left: 20 }
    const input = measured({ direction, nodes: [
      { id: 'a', width: 80, height: 30, parent: 0 }, { id: 'b', width: 100, height: 40, parent: 0 },
      { id: 'c', width: 90, height: 35, parent: 1 }, { id: 'd', width: 110, height: 45, parent: 1 },
    ], groups: [{ id: 'left', minWidth: 150, padding }, { id: 'right', minWidth: 150, padding }],
    edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 2, target: 3, minSpan: 1 },
      { source: 1, target: 2, minSpan: 1, label: { width: 100, height: 20 } }] })
    const original = structuredClone(input), output = layoutAgenticGraph(input)
    expect(input).toEqual(original)
    expect(layoutAgenticGraph(input)).toEqual(output)
    expect(output.boundaryRoutes).toEqual([2])
    const path = output.edges[2]!.points
    expect(onOutline(path[0]!, { ...input.nodes[1]!, ...output.nodes[1]! })).toBe(true)
    expect(onOutline(path.at(-1)!, { ...input.nodes[2]!, ...output.nodes[2]! })).toBe(true)
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1]!, b = path[index]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
      for (const frame of output.groups!) expect(crossesInterior(a, b, { ...frame, height: padding.top })).toBe(false)
      for (let node = 0; node < input.nodes.length; node++) expect(crossesInterior(a, b, { ...input.nodes[node]!, ...output.nodes[node]! })).toBe(false)
    }
    expect(output.edges[2]!.labelPosition).toBeDefined()
    const exhausted = { pairs: 0, arcs: 0, swaps: 0 }
    expect(() => layoutLayeredGraph(input, () => undefined, reason => { throw new GraphLayoutUnsupportedError(reason) }, exhausted))
      .toThrow(GraphLayoutUnsupportedError)
  })

  test('bounds large-scope direct probes while preserving the shared routing reserve', () => {
    const groups = Array.from({ length: 4 }, (_, index) => ({ id: `group${index}`, minWidth: 120,
      headerHeight: 28, padding: { top: 44, right: 20, bottom: 20, left: 20 } }))
    const nodes = Array.from({ length: 80 }, (_, index) => ({ id: `node${index}`, parent: Math.floor(index / 20), width: 80, height: 36 }))
    const edges = nodes.flatMap((_, index) => index % 20 ? [{ source: index, target: index - 1, minSpan: 1 }] : [])
    for (let group = 1; group < 4; group++) edges.push({ source: group * 20 - 1, target: group * 20, minSpan: 1 })
    const input = measured({ direction: 'LR', padding: 40, nodes, groups, edges })
    const output = layoutAgenticGraph(input)
    expect(output.nodes).toHaveLength(80)
    expect(output.boundaryRoutes).toHaveLength(3)
    expect(countPolylineCrossings(output.edges)).toBe(0)
    const work = { pairs: 1024, arcs: 65536, swaps: 1_000_000 }
    expect(() => layoutLayeredGraph(input, () => undefined, reason => { throw new GraphLayoutUnsupportedError(reason) }, work))
      .toThrow('large cross-hierarchy route has no bounded direct corridor')
    expect(work.pairs).toBeGreaterThan(0)
  })

  test('invalid measured endpoints remain defects instead of unsupported capabilities', () => {
    expect(() => layoutAgenticGraph(measured({ edges: [{ source: 0, target: 99, minSpan: 1 }] }))).toThrow(TypeError)
    expect(() => layoutAgenticGraph(measured({ nodes: [{ id: 'bad', width: NaN, height: 20 }], edges: [] }))).toThrow(TypeError)
  })
})


describe('bounded complete boundary connectors', () => {
 const fail=(reason:string):never=>{throw new Error(reason)},budget=()=>({pairs:1_000_000,arcs:65536,swaps:1_000_000})
 for(const transpose of [false,true])for(const sign of [-1,1])for(const reverse of [false,true])test(`same-axis exterior contacts retain authored order ${transpose}/${sign}/${reverse}`,()=>{
  const p=(x:number,y:number)=>transpose?{x:y*sign,y:x}:{x,y:y*sign}
  const r=(x:number,y:number,w:number,h:number)=>{const a=p(x,y),b=p(x+w,y+h);return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)}}
  const bounds=r(0,0,100,100),boxes=[r(80,12,12,8),r(62,64,16,16),r(20,40,70,8)],near={port:p(86,20),stub:p(86,28),penalty:0},far={port:p(70,80),stub:p(70,88),penalty:0},source=reverse?far:near,target=reverse?near:far,roots=[source,target],before=structuredClone(roots),work=budget()
  let allocated=0,firstGuard:Point|undefined,firstQuery:Point|undefined
  const indexed=createCompoundObstacleIndex(boxes,work,fail),queries={...indexed,containsPoint(x:number,y:number){firstQuery??={x,y};return indexed.containsPoint(x,y)}}
  const result=proposeOuterChannel(bounds,boxes,[source],[target],[],queries,work,n=>allocated+=n,fail,(a)=>{firstGuard??=a;return true},path=>path)
  expect(result).toBeDefined();expect(result![0]).toEqual(source.port);expect(result!.at(-1)).toEqual(target.port);expect(firstGuard).toEqual(source.port);expect(firstQuery).toEqual(source.port);expect(allocated).toBe(6)
  for(let i=1;i<result!.length;i++){
   const a=result![i-1]!,b=result![i]!
   expect((a.x===b.x)!==(a.y===b.y)).toBe(true)
   for(const box of boxes)expect(a.x===b.x?a.x>box.x&&a.x<box.x+box.width&&Math.max(a.y,b.y)>box.y&&Math.min(a.y,b.y)<box.y+box.height:a.y>box.y&&a.y<box.y+box.height&&Math.max(a.x,b.x)>box.x&&Math.min(a.x,b.x)<box.x+box.width).toBe(false)
  }
  for(const[from,a,b]of [[source,result![0]!,result![1]!],[target,result!.at(-1)!,result!.at(-2)!]]as const){
   const dx=from.stub.x-from.port.x,dy=from.stub.y-from.port.y
   expect((b.x-a.x)*Math.sign(dx)+(b.y-a.y)*Math.sign(dy)).toBeGreaterThanOrEqual(8)
  }
  expect(roots).toEqual(before);expect(work.pairs).toBeLessThan(1_000_000);expect(work.arcs).toBeLessThan(65536)
 })
 test('same-axis exterior candidates retain peer veto, final admission and failure identity',()=>{
  const source={port:{x:70,y:80},stub:{x:70,y:88},penalty:0},target={port:{x:86,y:20},stub:{x:86,y:28},penalty:0},bounds={x:0,y:0,width:100,height:100},boxes=[{x:80,y:12,width:12,height:8},{x:62,y:64,width:16,height:16},{x:20,y:40,width:70,height:8}]
  let guards=0,accepts=0;const work=budget()
  const rejected=proposeOuterChannel(bounds,boxes,[source],[target],[],createCompoundObstacleIndex(boxes,work,fail),work,()=>{},fail,()=>{guards++;return false},path=>{accepts++;return path})
  expect(rejected).toBeUndefined();expect(guards).toBeGreaterThan(0);expect(accepts).toBe(0)
  const finalWork=budget();let proposals=0
  expect(proposeOuterChannel(bounds,boxes,[source],[target],[],createCompoundObstacleIndex(boxes,finalWork,fail),finalWork,()=>{},fail,()=>true,()=>{proposals++;return undefined})).toBeUndefined()
  expect(proposals).toBeGreaterThan(0);expect(proposals).toBeLessThanOrEqual(2)
  const failure=Error('host guard failed'),errorWork=budget()
  expect(()=>proposeOuterChannel(bounds,boxes,[source],[target],[],createCompoundObstacleIndex(boxes,errorWork,fail),errorWork,()=>{},fail,()=>{throw failure},path=>path)).toThrow(failure)
  expect(work.pairs).toBeLessThan(1_000_000);expect(finalWork.pairs).toBeLessThan(1_000_000)
 })
 test('same-axis exterior proof does not spend after its shared budget fails',()=>{
  const source={port:{x:70,y:80},stub:{x:70,y:88},penalty:0},target={port:{x:86,y:20},stub:{x:86,y:28},penalty:0},work={pairs:0,arcs:65536,swaps:1_000_000};let queried=0,accepted=0
  const queries={containsPoint(){queried++;return false},entersSegment(){queried++;return false},projectPoint(){throw Error('not a projection query')}}
  expect(()=>proposeOuterChannel({x:0,y:0,width:100,height:100},[],[source],[target],[],queries,work,()=>{},fail,()=>true,path=>{accepted++;return path})).toThrow('work limit')
  expect(queried).toBe(0);expect(accepted).toBe(0);expect(work.pairs).toBeLessThan(0)
 })
 test('same-axis exterior cannot cross a sealed header or bypass a successful perpendicular route',()=>{
  const source={port:{x:70,y:80},stub:{x:70,y:88},penalty:0},target={port:{x:86,y:20},stub:{x:86,y:28},penalty:0},bounds={x:0,y:0,width:100,height:100},header=[{x:0,y:40,width:100,height:8}],work=budget();let accepted=0
  expect(proposeOuterChannel(bounds,header,[source],[target],[],createCompoundObstacleIndex(header,work,fail),work,()=>{},fail,()=>true,path=>{accepted++;return path})).toBeUndefined()
  expect(accepted).toBe(0)
  const oldSource={port:{x:20,y:30},stub:{x:28,y:30},penalty:0},oldTarget={port:{x:80,y:70},stub:{x:80,y:78},penalty:0},boxes=[{x:10,y:20,width:10,height:20},{x:70,y:60,width:20,height:10}],oldWork=budget()
  const result=proposeOuterChannel(bounds,boxes,[oldSource,source],[oldTarget,target],[],createCompoundObstacleIndex(boxes,oldWork,fail),oldWork,()=>{},fail,()=>true,path=>path)
  expect(result).toEqual([{x:20,y:30},{x:95,y:30},{x:95,y:89},{x:80,y:89},{x:80,y:70}])
 })
 for(const transpose of [false,true])for(const xs of [-1,1])for(const ys of [-1,1])test(`retains real normal leads in reflection ${transpose}/${xs}/${ys}`,()=>{
  const p=(x:number,y:number)=>transpose?{x:y*ys,y:x*xs}:{x:x*xs,y:y*ys}
  const r=(x:number,y:number,w:number,h:number)=>{const a=p(x,y),b=p(x+w,y+h);return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)}}
  const bounds=r(0,0,100,100),boxes=[r(80,12,12,8),r(62,64,16,16)],source={port:p(80,20),stub:p(80,28),penalty:0},target={port:p(70,80),stub:p(70,88),penalty:0},work=budget();let allocated=0
  const result=proposePortalChannel(bounds,boxes,source,[target],[],createCompoundObstacleIndex(boxes,work,fail),work,n=>allocated+=n,fail,()=>true,path=>path)
  expect(result).toBeDefined();expect(result![0]).toEqual(source.port);expect(result!.at(-1)).toEqual(target.port);expect(result!.length).toBe(6);expect(allocated).toBe(6)
  expect(result![1]!.x===result![0]!.x||result![1]!.y===result![0]!.y).toBe(true)
 })
 test('rejects every complete candidate without mutating terminals or refunding work',()=>{
  const roots=[{port:{x:80,y:20},stub:{x:80,y:28},penalty:0},{port:{x:70,y:80},stub:{x:70,y:88},penalty:0}],before=structuredClone(roots),work=budget();let candidates=0
  const result=proposePortalChannel({x:0,y:0,width:100,height:100},[{x:80,y:12,width:12,height:8},{x:62,y:64,width:16,height:16}],roots[0]!,roots.slice(1),[],createCompoundObstacleIndex([],work,fail),work,()=>{},fail,()=>true,()=>{candidates++;return undefined})
  expect(result).toBeUndefined();expect(candidates).toBeGreaterThan(0);expect(candidates).toBeLessThanOrEqual(8);expect(roots).toEqual(before);expect(work.arcs).toBeLessThan(65536)
 })
 test('published peer revisions invalidate released predicates and preserve active leases',()=>{
  const work=budget(),routes=[{style:'solid',points:[{x:0,y:0},{x:10,y:0}]},{style:'solid',points:[{x:50,y:0},{x:60,y:0}]}]
  const owner=createPeerGeometryOwner(routes,0,100,100,work,()=>{},fail),old=owner.acquire(0)
  owner.enterQuery(old)
  expect(()=>owner.publish(0,routes[0]!.points,true)).toThrow('leased')
  expect(()=>old.release()).toThrow('active query')
  owner.leaveQuery(old);old.release();owner.publish(0,[{x:0,y:5},{x:10,y:5}],true)
  expect(()=>old.guard({x:5,y:0},{x:5,y:10},2,2)).toThrow('Stale')
 })
})

describe('measured painted route contacts', () => {
  const input = (width: number | undefined): MeasuredGraph => measured({
    maximumEdgeStrokeWidth: width,
    edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 0, target: 2, minSpan: 1 }],
  })
  const routes = (a: Point[], b: Point[], style = 'solid') => [{ points: a, style: 'solid' }, { points: b, style }]

  test.each([
    { name: 'distinct source ports and a narrow vertical overlap', a: [{ x: 781.361, y: 518.7 }, { x: 781.361, y: 562.7 }, { x: 800, y: 562.7 }], b: [{ x: 751.361, y: 518.7 }, { x: 751.361, y: 550.7 }, { x: 780.379, y: 550.7 }, { x: 780.379, y: 601.5 }], style: 'solid' },
    { name: 'solid and dashed carriers beside a common source', a: [{ x: 1397.784, y: 489.960249676 }, { x: 1361.784, y: 489.960249676 }, { x: 1361.784, y: 439.05 }, { x: 1001.054, y: 439.05 }, { x: 1001.054, y: 478.55 }, { x: 959.054, y: 478.55 }], b: [{ x: 1397.784, y: 502.912812095 }, { x: 1355.784, y: 502.912812095 }, { x: 1355.784, y: 479.35 }, { x: 971.054, y: 479.35 }, { x: 971.054, y: 545.45 }], style: 'dashed' },
  ])('rejects actual one-pixel ink in $name', ({ a: originalA, b: originalB, style }) => {
    const a: Point[] = [...originalA], b: Point[] = [...originalB], ink = routes(a, b, style)
    // These distinct paths share an authored source, not a physical stem.
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(1))).toBeUndefined()
    expect(scoreMeasuredRouteCrossings(b, 1, ink, input(1))).toBeUndefined()
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(undefined))).toBe(0)
  })

  test('retains written boundary contact, proper crossings and actual common terminals', () => {
    const a = [{ x: 0, y: 0 }, { x: 0, y: 20 }]
    for (const x of [1, 2]) expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x, y: 2 }, { x, y: 18 }]), input(1))).toBe(0)
    const crossing = [{ x: -10, y: 10 }, { x: 10, y: 10 }]
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, crossing), input(1))).toBe(1)
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x: 0, y: 0 }, { x: 10, y: 0 }]), input(1))).toBe(0)
    // Both the writer's width and coordinates spell exactly one here.
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x: 1.0000000000002, y: 2 }, { x: 1.0000000000002, y: 18 }]), input(1.0000000000004))).toBe(0)
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x: .2, y: 2 }, { x: .2, y: 18 }]), input(.1))).toBe(0)
    const decimal = [{ x: .2, y: 0 }, { x: .2, y: 20 }]
    expect(scoreMeasuredRouteCrossings(decimal, 0, routes(decimal, [{ x: .3, y: 2 }, { x: .3, y: 18 }]), input(.1))).toBe(0)
    const large = [{ x: 1000000000000.2, y: 0 }, { x: 1000000000000.2, y: 20 }]
    expect(scoreMeasuredRouteCrossings(large, 0, routes(large, [{ x: 1000000000000.3, y: 2 }, { x: 1000000000000.3, y: 18 }]), input(.10001))).toBeUndefined()
    for (const width of [1000000000001, 1.2345678901234568e21]) {
      const written = width === 1000000000001 ? 1000000000001 : 1.23456789012e21
      expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x: written, y: 2 }, { x: written, y: 18 }]), input(width))).toBe(0)
    }
  })

  test('does not discard a short positive support or invisible peer distinction', () => {
    const a = [{ x: 0, y: 0 }, { x: 0, y: 20 }], b = [{ x: .75, y: 2 }, { x: .75, y: 2.005 }]
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, b), input(1))).toBeUndefined()
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, b, 'invisible'), input(1))).toBe(0)
  })

  test('keeps physical peers through the prepared whole-route bounds prune', () => {
    const a = Array.from({ length: 60 }, (_, y) => ({ x: 0, y })), b = Array.from({ length: 33 }, (_, y) => ({ x: .75, y }))
    const ink = routes([], b), fail = (reason: string): never => { throw new Error(reason) }
    const work = { pairs: 1_000_000, arcs: 1000, swaps: 1000 }
    expect(createBoundaryContactValidator(input(1), 0, ink, work, fail)(a)).toBe(false)
    expect(work.pairs).toBeLessThan(1_000_000)
    expect(createBoundaryContactValidator(input(undefined), 0, ink, { pairs: 1_000_000, arcs: 1000, swaps: 1000 }, fail)(a)).toBe(true)
    const placed: AgenticLayout = { topology: 'layered', width: 10, height: 100, nodes: input(1).nodes.map(() => ({ x: 0, y: 0 })), edges: [{ points: a }, { points: b }] }
    expect(() => assertFinalBoundaryContacts(input(1), placed, new Set([0]), { pairs: 1_000_000, arcs: 1000, swaps: 1000 }, fail)).toThrow('uncertified shared contact')
    expect(() => assertFinalBoundaryContacts(input(undefined), placed, new Set([0]), { pairs: 1_000_000, arcs: 1000, swaps: 1000 }, fail)).not.toThrow()
  })

  test('does not infer zero written support from a tiny raw shared endpoint', () => {
    // Conditional long-tail formatting reverses the second tiny segment:
    // the shared endpoint writes1000.12345679, beyond BOTH other endpoints.
    const a = [{ x: 0, y: 1000.1234567894 }, { x: 0, y: 1000.123456789401 }],
      b = [{ x: .75, y: 1000.123456789401 }, { x: .75, y: 1000.1234567895 }]
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, b), input(1))).toBeUndefined()
  })

  test('keeps proved axis-disjoint peers within the existing extra-work allowance', () => {
    const a = [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      ink = [{ points: a, style: 'solid' }, ...Array.from({ length: 100 }, (_, i) => ({ points: [{ x: i + 1, y: 10 }, { x: i + 1, y: 20 }], style: 'solid' }))],
      graph = measured({ maximumEdgeStrokeWidth: 1, edges: ink.map(() => ({ source: 0, target: 1, minSpan: 1 })) })
    let remaining = 300
    expect(scoreMeasuredRouteCrossings(a, 0, ink, graph, amount => (remaining -= amount) >= 0)).toBe(0)
    expect(remaining).toBeGreaterThanOrEqual(0)
  })

  test('charges the same caller allowance and stops at the first refused debit', () => {
    const a = [{ x: 0, y: 0 }, { x: 0, y: 20 }], b = [{ x: 1, y: 2 }, { x: 1, y: 18 }], ink = routes(a, b)
    let full = 0
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(1), amount => { full += amount })).toBe(0)
    expect(full).toBeGreaterThan(0)
    let left = full - 1, stopped = false
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(1), amount => {
      expect(stopped).toBe(false)
      left -= amount
      if (left < 0) stopped = true
      return !stopped
    })).toBeUndefined()
    expect(stopped).toBe(true)
    let legacyVisits = 0
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(undefined), () => { legacyVisits++; return false })).toBe(0)
    expect(legacyVisits).toBe(0)
    let capacityStopped = false
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(1), () => { expect(capacityStopped).toBe(false) }, () => {
      expect(capacityStopped).toBe(false)
      capacityStopped = true
      return false
    })).toBeUndefined()
    expect(capacityStopped).toBe(true)
    const fail = (reason: string): never => { throw new Error(reason) }
    expect(() => createBoundaryContactValidator(input(1), 0, ink, { pairs: 10000, arcs: 1, swaps: 1000 }, fail)(a)).toThrow('visibility-arc limit')
  })
})

describe('written sharp join contact closure', () => {
  const path = (values: readonly (readonly [number, number])[]): Point[] => values.map(([x, y]) => ({ x, y }))
  const fail = (reason: string): never => { throw Error(reason) }
  const budget = () => ({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 })
  const graph = (width = 1, radius: number | undefined = 0, commonSource = false): MeasuredGraph => measured({
    nodes: [{ id: 'a', width: 10, height: 20 }, { id: 'b', width: 10, height: 20 }, { id: 'c', width: 10, height: 50 }],
    edges: [{ source: 0, target: commonSource ? 1 : 2, minSpan: 1 }, { source: commonSource ? 0 : 1, target: 2, minSpan: 1 }],
    maximumEdgeStrokeWidth: width, maximumEdgeBendRadius: radius,
  })
  const cases = [
    { name: '13: separated collinear ends meet through their outer miters', width: 1, common: false, reverseShared: false,
      a: path([[636.974, 869.2], [507.414, 869.2], [507.414, 1119], [250, 1119], [250, 1131.45], [184, 1131.45]]),
      b: path([[636.974, 760.3], [501.414, 760.3], [501.414, 1078.7], [250, 1078.7], [250, 1118.2], [184, 1118.2]]) },
    { name: '38: opposite vertical spans merely touch before their corners merge', width: 1, common: false, reverseShared: true,
      a: path([[430.496, 369.5], [430.496, 384.5], [543.735, 384.5], [543.735, 434.8], [543.258437581, 434.8], [543.258437581, 449.8]]),
      b: path([[556.211, 449.8], [556.211, 434.8], [647.502, 434.8], [647.502, 384.5], [544.421, 384.5], [544.421, 215.3], [386.641, 215.3], [386.641, 200.3]]) },
    { name: 'a shared physical source cannot excuse a remote wide join', width: 22, common: true, reverseShared: false,
      a: path([[0, 0], [10, 0], [10, 30]]), b: path([[0, 0], [0, -30]]) },
  ]
  test.each(cases)('rejects $name', ({ a, b, width, common, reverseShared }) => {
    const input = graph(width, 0, common), routes = [{ points: a, style: 'solid' }, { points: b, style: 'solid' }], before = structuredClone({ input, routes })
    if (reverseShared) { input.edges = [{ source: 0, target: 1, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }]; before.input.edges = structuredClone(input.edges) }
    for (const stable of [false, true]) {
      expect(scoreMeasuredRouteCrossings(a, 0, routes, input, undefined, undefined, undefined, 3, stable)).toBeUndefined()
      expect(scoreMeasuredRouteCrossings(b, 1, routes, input, undefined, undefined, undefined, 3, stable)).toBeUndefined()
    }
    expect(createBoundaryContactValidator(input, 0, routes, budget(), fail)(a)).toBe(false)
    expect({ input, routes }).toEqual(before)
  })
  test('completes a separated field by paying only its executed contact predicates', () => {
    const candidate=path([[0,0],[10,0]]),input=graph(),edges=[input.edges[0]!],routes=[{points:candidate,style:'solid'}]
    input.edges=edges
    for(let i=0;i<40;i++){
      edges.push({source:1,target:2,minSpan:1})
      routes.push({points:path([[100+i,100],[100+i,110]]),style:'solid'})
    }
    const basis=measuredRouteContactPairBudget(input)
    let remaining=250-basis*40-candidate.length-40,stopped=false
    const charge=(amount:number)=>{
      expect(stopped).toBe(false)
      remaining-=amount
      if(remaining<0)stopped=true
      return !stopped
    }
    expect(scoreMeasuredRouteCrossings(candidate,0,routes,input,charge,undefined,undefined,basis)).toBe(0)
    expect(remaining).toBeGreaterThanOrEqual(0)
    expect(scoreMeasuredRouteCrossings(candidate,0,routes,input)).toBe(0)
    expect(scoreMeasuredRouteCrossings(candidate,0,routes,input,undefined,undefined,undefined,basis,true)).toBe(0)
  })
  test('reports only the exact refused supports in caller-owned witness scratch', () => {
    const {a,b}=cases[0]!,routes=[{points:a,style:'solid'},{points:b,style:'solid'}],witness={candidateSegment:-1,peerIndex:-1,peerSegment:-1}
    expect(scoreMeasuredRouteCrossings(a,0,routes,graph(),undefined,undefined,witness)).toBeUndefined()
    expect(witness).toEqual({candidateSegment:3,peerIndex:1,peerSegment:4})
    witness.candidateSegment=witness.peerIndex=witness.peerSegment=-1
    expect(scoreMeasuredRouteCrossings(a,0,routes,graph(),()=>false,undefined,witness)).toBeUndefined()
    expect(witness).toEqual({candidateSegment:-1,peerIndex:-1,peerSegment:-1})
  })
  test('keeps subnormal offset signs under exact served-decimal authority', () => {
    // Exact a+W/2=1.49e-322 lies below b=1.5e-322. Binary
    // subtraction has the opposite sign and its relative error underflows.
    const width=2.1e-322,a=path([[-1,0],[4.4e-323,0],[4.4e-323,1]]),b=path([[1.5e-322,-5e-323],[1,-5e-323]])
    expect(scoreMeasuredRouteCrossings(a,0,[{points:a,style:'solid'},{points:b,style:'solid'}],graph(width))).toBe(0)
    // A real low offset 0 versus high offset +W/2 also reverses binary
    // sign: exact 2.1e-322 < 1.1e-322 + 2.03e-322/2.
    const tinyJoin=path([[-1,0],[1.1e-322,0],[1.1e-322,1]]),tinyStrip=path([[2.1e-322,-5e-323],[1,-5e-323]])
    expect(scoreMeasuredRouteCrossings(tinyJoin,0,[{points:tinyJoin,style:'solid'},{points:tinyStrip,style:'solid'}],graph(2.03e-322))).toBeUndefined()
    const overlap=path([[1.4e-322,-5e-323],[1,-5e-323]])
    expect(scoreMeasuredRouteCrossings(a,0,[{points:a,style:'solid'},{points:overlap,style:'solid'}],graph(width))).toBeUndefined()
  })
  test('retains ordinary proper crossings through collinear subdivision and real common terminals', () => {
    const input = graph(), horizontal = path([[0, 5], [5, 5], [10, 5]]), vertical = path([[5, 0], [5, 10]])
    expect(scoreMeasuredRouteCrossings(horizontal, 0, [{ points: horizontal, style: 'solid' }, { points: vertical, style: 'solid' }], input)).toBe(1)
    const a = path([[0, 0], [10, 0]]), b = path([[0, 0], [0, -10]])
    expect(scoreMeasuredRouteCrossings(a, 0, [{ points: a, style: 'solid' }, { points: b, style: 'solid' }], graph(1, 0, true))).toBe(0)
    const bent = path([[0, 0], [10, 0], [10, 10]]), separated = path([[30, 20], [40, 20]])
    expect(scoreMeasuredRouteCrossings(bent, 0, [{ points: bent, style: 'solid' }, { points: separated, style: 'solid' }], input)).toBe(0)
  })
  test('uses exact served cardinality for raw drift and rechecks the resulting parallel ink', () => {
    const a=path([[1000.0000000000001,0],[1000,10]]),far=path([[1020,0],[1020,10]]),input=graph()
    expect(scoreMeasuredRouteCrossings(a,0,[{points:a,style:'solid'},{points:far,style:'solid'}],input)).toBe(0)
    const overlapping=path([[1000.4,2],[1000.4,8]])
    expect(scoreMeasuredRouteCrossings(a,0,[{points:a,style:'solid'},{points:overlapping,style:'solid'}],input)).toBeUndefined()
    const stillDiagonal=path([[1000.0001,0],[1000,10]])
    expect(scoreMeasuredRouteCrossings(stillDiagonal,0,[{points:stillDiagonal,style:'solid'},{points:far,style:'solid'}],input)).toBeUndefined()
  })
  test('does not borrow a cardinal support bound for an acute diagonal miter', () => {
    // The actual 120-degree miter reaches x=sqrt(3)/2, beyond the
    // width-sized raw-path separation from the peer at x=1.2.
    const a=path([[-10,0],[0,0],[-5,8.660254037844386]]),b=path([[1.2,-2],[1.2,2]]),input=graph(),routes=[{points:a,style:'solid'},{points:b,style:'solid'}]
    expect(scoreMeasuredRouteCrossings(a,0,routes,input)).toBeUndefined()
    expect(scoreMeasuredRouteCrossings(b,1,routes,input)).toBeUndefined()
    expect(createBoundaryContactValidator(input,0,routes,budget(),fail)(a)).toBe(false)
  })
  test('does not claim sharp join authority for absent or rounded geometry metadata', () => {
    const { a, b } = cases[0]!, routes = [{ points: a, style: 'solid' }, { points: b, style: 'solid' }]
    const unknown = graph(); delete unknown.maximumEdgeBendRadius
    expect(scoreMeasuredRouteCrossings(a, 0, routes, unknown)).toBe(0)
    expect(scoreMeasuredRouteCrossings(a, 0, routes, graph(1, 8))).toBe(0)
  })
  test('compares half-width offsets as exact served decimals at a nonbinary boundary', () => {
    // The writer preserves W (eleven fractional digits). Its exact half is
    // 9.234567890105; formatting the DERIVED half would change it to 9.23456789011.
    const width = 18.46913578021, a = path([[-40, 0], [0, 0], [0, 40]]), b = path([[width, -40], [width, -1]])
    expect(scoreMeasuredRouteCrossings(a, 0, [{ points: a, style: 'solid' }, { points: b, style: 'solid' }], graph(width))).toBe(0)
    const shifted = path([[18.4691357802, -40], [18.4691357802, -1]])
    expect(scoreMeasuredRouteCrossings(a, 0, [{ points: a, style: 'solid' }, { points: shifted, style: 'solid' }], graph(width))).toBeUndefined()
  })
  test('does not let a raw metric miss excuse a contact created by actual SVG spelling', () => {
    const a = path([[-10, 1000], [1.0000000000001, 1000], [1.0000000000001, 1010]]), b = path([[1, 990], [1, 999.9999999999999]])
    // Served endpoints both become (1,1000): the positive corner/strip
    // intersection is [1,1.5] x [999.5,1000], not a proper interior crossing.
    expect(scoreMeasuredRouteCrossings(a, 0, [{ points: a, style: 'solid' }, { points: b, style: 'solid' }], graph())).toBeUndefined()
  })
  test('checks globally projected untouched local routes without lifted edges or marker metadata', () => {
    const { a, b } = cases[0]!, input = graph(), original = structuredClone({ a, b })
    input.padding = 0
    input.nodes = input.nodes.map(node => ({ ...node, parent: 0 }))
    input.groups = [{ id: 'scope', minWidth: 0, headerHeight: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } }]
    let placements = 0
    const flat = (local: MeasuredGraph): AgenticLayout => {
      placements++
      return local.nodes.length === 3
        ? { topology: 'layered', width: 700, height: 1200, nodes: [{ x: 636.974, y: 860 }, { x: 636.974, y: 750 }, { x: 174, y: 1100 }], edges: [{ points: a.map(p => ({ ...p })) }, { points: b.map(p => ({ ...p })) }] }
        : { topology: 'layered', width: 700, height: 1200, nodes: [{ x: 0, y: 0 }], edges: [] }
    }
    const work = budget()
    expect(() => layoutCompoundGraph(input, flat, fail, 32768, work)).toThrow('uncertified shared contact')
    expect(placements).toBe(2)
    const placed: AgenticLayout = { topology: 'layered', width: 700, height: 1200, nodes: [], edges: [{ points: a }, { points: b }] }
    expect(() => assertFinalBoundaryContacts(input, placed, new Set(), budget(), fail)).toThrow('uncertified shared contact')
    expect({ a, b }).toEqual(original)
    expect(work.pairs).toBeLessThan(1_000_000)
  })
  test('owned final traversal preserves every physical rejection and exact decimal boundary', () => {
    for(const {a,b} of cases){
      const routes=[{points:a,style:'solid'},{points:b,style:'solid'}],input=graph()
      const owned=createOwnedMeasuredRouteContactValidator(routes,input)
      expect(typeof owned).toBe('function')
      if(typeof owned!=='function')throw new Error('expected owned scorer')
      expect(owned(0)).toBe(scoreMeasuredRouteCrossings(a,0,routes,input)!==undefined)
    }
    // Round-trip multiplication is NOT an exact decimal coefficient proof.
    // 65536.1*1e11 is6553610000000001, although the served coefficient ends0.
    for(const [left,right,width,expected] of [[65536,65536.1,0.10000000001,undefined],[65536.1,65536.2,0.1,0],[0.2,0.3,0.1,0],[1000000000000.2,1000000000000.3,0.10001,undefined]] as const){
      const a=path([[left,0],[left,20]]),b=path([[right,2],[right,18]]),routes=[{points:a,style:'solid'},{points:b,style:'solid'}],input=graph(width)
      const owned=createOwnedMeasuredRouteContactValidator(routes,input)
      if(typeof owned!=='function')throw new Error('expected owned scorer')
      expect(owned(0)).toBe(expected!==undefined)
      expect(scoreMeasuredRouteCrossings(a,0,routes,input)).toBe(expected)
    }
  })
  test('unprepared contact fallback preserves proper crossings and live visibility', () => {
    const routes=Array.from({length:40},(_,i)=>({points:path([[-20,i*10],[20,i*10]]),style:'solid'}))
    routes.push({points:path([[0,-5],[0,405]]),style:'solid'})
    const input=graph();input.edges=routes.map((_,i)=>({source:i*2,target:i*2+1,minSpan:1}))
    const owned=createOwnedMeasuredRouteContactValidator(routes,input,undefined,undefined,true)
    if(typeof owned!=='function')throw new Error('expected owned scorer')
    expect(owned(40)).toBe(true)
    expect(scoreMeasuredRouteCrossings(routes[40]!.points,40,routes,input)).toBe(40)
    for(let i=0;i<40;i+=2)routes[i]!.style='invisible'
    expect(owned(40)).toBe(true)
    expect(scoreMeasuredRouteCrossings(routes[40]!.points,40,routes,input)).toBe(20)
  })
  test('owned preparation rejects acute support before pruning and stops immediately on exhausted work', () => {
    const a=path([[-10,0],[0,0],[-5,8.660254037844386]]),far=path([[1000,0],[1000,20]])
    const acute=createOwnedMeasuredRouteContactValidator([{points:a,style:'solid'},{points:far,style:'solid'}],graph())
    expect(typeof acute==='function'?acute(0):acute).toBe(false)
    for(const candidate of [path([[0,0],[10,0],[10,20]]),path([[1000.0000000000001,0],[1000,10],[1010,10]])]){
      const routes=[{points:candidate,style:'solid'},{points:path([[40,0],[40,20]]),style:'solid'}],input=graph()
      let used=0
      const pay=(n:number)=>{used+=n}
      const complete=createOwnedMeasuredRouteContactValidator(routes,input,pay,pay,true)
      if(typeof complete!=='function')throw new Error('expected owned scorer')
      expect(complete(0)).toBe(true)
      let left=used-1,stopped=false
      const limited=(n:number)=>{if(stopped)throw new Error('visited after exhausted debit');left-=n;if(left<0){stopped=true;return false}return true}
      const bounded=createOwnedMeasuredRouteContactValidator(routes,input,limited,limited,true)
      expect(typeof bounded==='function'?bounded(0):bounded).not.toBe(true)
      expect(stopped).toBe(true)
    }

  })

  test('canonical numeric seeds retain logical crossing counts, subdivision and exact boundaries', () => {
    const seed=(routes:readonly {points:Point[];style:string}[])=>{
      const rows=routes.map(route=>({raw:route.points.map(p=>({...p})),points:route.points.map(p=>({x:Number(formatSvgNumber(p.x)),y:Number(formatSvgNumber(p.y))}))}))
      const horizontal:Array<{key:number;piece:{owner:number;segment:number}}>=[],vertical:typeof horizontal=[],horizontalEnds:typeof horizontal=[],verticalEnds:typeof horizontal=[]
      rows.forEach((row,owner)=>{for(let segment=0;segment+1<row.points.length;segment++){
        const a=row.points[segment]!,b=row.points[segment+1]!
        const piece={owner,segment}
        ;(a.x===b.x?vertical:horizontal).push({key:a.x===b.x?a.x:a.y,piece})
        ;(a.x===b.x?verticalEnds:horizontalEnds).push({key:a.x===b.x?a.y:a.x,piece},{key:a.x===b.x?b.y:b.x,piece})
      }})
      for(const entries of [horizontal,vertical,horizontalEnds,verticalEnds])entries.sort((a,b)=>a.key-b.key||a.piece.owner-b.piece.owner||a.piece.segment-b.piece.segment)
      return {routes:rows,horizontal,vertical,horizontalEnds,verticalEnds}
    }
    const samples=[...cases.map(({a,b,width})=>({a,b,width,expected:undefined})),
      {a:path([[0,5],[5,5],[10,5]]),b:path([[5,0],[5,10]]),width:1,expected:1},
      {a:path([[0,0],[100,0]]),b:path([[0.005,-10],[0.005,10]]),width:1,expected:undefined},
      {a:path([[0.005,0.005],[0.1,0.005],[0.1,1],[-1,1],[-1,0],[1,0]]),b:path([[0,-2],[0,2]]),width:1e-5,expected:undefined},
      {a:path([[0,0],[100,0]]),b:path([[0.005,-10],[0.005,10]]),width:1e-5,expected:undefined},
      {a:path([[65536,0],[65536,20]]),b:path([[65536.1,2],[65536.1,18]]),width:0.10000000001,expected:undefined},
      {a:path([[65536.1,0],[65536.1,20]]),b:path([[65536.2,2],[65536.2,18]]),width:0.1,expected:0},
      {a:path([[0,0],[20,0],[20,10],[0,10],[0,20],[20,20]]),b:path([[10,-5],[10,25]]),width:1,expected:3},
      // Actual served cardinal crossing, with an ELK-sized raw ULP drift.
      // The generic raw-axis helper remains conservative; CONTACT now proves
      // THIS raw and served support pair using the shared crossing primitive.
      {a:path([[1000.0000000000001,0],[1000,10]]),b:path([[990,8.9],[1010,8.9]]),width:1,expected:undefined,admitted:true},
      {a:path([[1000.0000000000001,0],[1000,10]]),b:path([[990,9.995],[1010,9.995]]),width:1,expected:undefined,admitted:false},
      {a:path([[1000.0000000000001,0],[1000,8.9]]),b:path([[990,8.9],[1010,8.9]]),width:1,expected:undefined,admitted:false},
      // A proper strip crossing never excuses the positive outer quarter.
      {a:path([[1000.0000000000001,0],[1000,10],[1010,10]]),b:path([[990,9.75],[1020,9.75]]),width:1,expected:undefined,admitted:false}]
    for(const sample of samples)for(const reverse of [false,true]){
      const {a,b,width,expected}=sample
      const routes=[{points:reverse?a.slice().reverse():a,style:'solid'},{points:reverse?b.slice().reverse():b,style:'solid'}],input=graph(width)
      if(reverse)input.edges=input.edges.map(edge=>({...edge,source:edge.target,target:edge.source}))
      expect(scoreMeasuredRouteCrossings(routes[0]!.points,0,routes,input)).toBe(expected)
      for(const prepared of [seed(routes),undefined]){
        const validate=createOwnedMeasuredRouteContactValidator(routes,input,undefined,undefined,true,prepared)
        if(typeof validate!=='function')throw new Error('expected contact validator')
        expect(validate(0)).toBe('admitted' in sample?sample.admitted===true:expected!==undefined)
      }
    }
  })

})

describe('Native graph preparation reserves actual styled marker room', () => {
  const source = `flowchart LR
  subgraph Core["Routing core"]
    Intake["Intake"] --> Validate{"Valid?"}
    Validate -- yes --> Render["Render SVG"]
    Validate -- no --> Repair["Repair source"]
    Repair --> Validate
  end
  Render --> Export["Export PNG"]
  Render --> Audit["Contrast audit"]
  Audit --> Export`
  const overlaps = (a: readonly number[], b: readonly number[]) => a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!
  for (const direction of ['LR', 'RL', 'TB', 'BT'] as const) test(`global width4 preserves distinct heads and foreign card/carrier clearance: ${direction}`, async () => {
    const engine = await import('../layout-engine.ts'), original = engine.layoutGraphSync
    let result: ReturnType<typeof original> | undefined, graph: Parameters<typeof original>[0] | undefined, before: Parameters<typeof original>[0] | undefined
    const observe = spyOn(engine, 'layoutGraphSync').mockImplementation((...args: Parameters<typeof original>) => {
      graph = args[0]; before = structuredClone(graph)
      expect(args[1]?.styleFace?.edge?.lineWidth).toBe(4)
      result = original(...args)
      return result
    })
    let svg: string
    try {
      const api = await import('../index.ts')
      const rendered = api.renderMermaidSVGWithReceipt(source.replace('flowchart LR', `flowchart ${direction}`), {
        graphLayout: { backend: 'agentic', fallback: 'none' }, padding: 28, font: 'DejaVu Sans', seed: 60131,
        style: { formatVersion: 1, name: 'native-marker-room-owner', stroke: 'crisp', strokeWidth: 4 },
      })
      svg = rendered.svg
    } finally { observe.mockRestore() }
    expect(result).toBeDefined()
    expect(svg).toContain('id="arrowhead" markerWidth="8" markerHeight="5"')
    expect(svg.match(/class="edge"[^>]*stroke-width="4"/g)).toHaveLength(7)
    const placed = result!, edge = (from: string, to: string) => placed.edges.find(e => e.source === from && e.target === to)!
    const node = (id: string) => placed.nodes.find(n => n.id === id)!
    // Literal native SVG arrow viewport is8x5, scaled by global strokeWidth4.
    // Full viewport and4px butt strips are conservative actual paint supports.
    const marker = (e: typeof placed.edges[number]) => {
      const tip = e.points.at(-1)!, near = e.points.slice(0, -1).reverse().find(p => p.x !== tip.x || p.y !== tip.y)!
      expect(tip.x === near.x || tip.y === near.y).toBe(true)
      const dx = Math.sign(tip.x - near.x), dy = Math.sign(tip.y - near.y)
      return dx ? [Math.min(tip.x, tip.x - dx * 32), tip.y - 10, Math.max(tip.x, tip.x - dx * 32), tip.y + 10]
        : [tip.x - 10, Math.min(tip.y, tip.y - dy * 32), tip.x + 10, Math.max(tip.y, tip.y - dy * 32)]
    }
    const a = marker(edge('Render', 'Export')), b = marker(edge('Audit', 'Export')), c = marker(edge('Render', 'Audit'))
    expect(overlaps(a, b)).toBe(false)
    const audit = node('Audit'), body = [audit.x - 2, audit.y - 2, audit.x + audit.width + 2, audit.y + audit.height + 2]
    expect(overlaps(a, body)).toBe(false)
    expect(overlaps(b, body)).toBe(false)
    const foreign = edge('Render', 'Export')
    for (let i = 1; i < foreign.points.length; i++) {
      const p = foreign.points[i - 1]!, q = foreign.points[i]!
      const strip = p.x === q.x ? [p.x - 2, Math.min(p.y, q.y), p.x + 2, Math.max(p.y, q.y)]
        : [Math.min(p.x, q.x), p.y - 2, Math.max(p.x, q.x), p.y + 2]
      expect(overlaps(c, strip)).toBe(false)
    }
    expect(graph).toEqual(before)
    expect(placed.edges.map(e => [e.source, e.target, e.label])).toEqual(graph!.edges.map(e => [e.source, e.target, e.label]))
  })
})


describe('measured endpoint lead admission and work', () => {
  const line = (): MeasuredGraph => ({ nodes: [{id:'A',width:40,height:30},{id:'B',width:40,height:30}], edges:[{source:0,target:1,minSpan:1}], direction:'LR',padding:0,nodeSpacing:24,layerSpacing:48 })
  for (const invalid of [0,-1,NaN,Infinity]) test(`rejects invalid terminal lead ${invalid}`, () => {
    expect(() => layoutAgenticGraph({...line(),minimumTerminalLead:invalid})).toThrow(TypeError)
  })
  test('new lead predicates consume the original supplied routing allowance', () => {
    const work={pairs:2,arcs:100,swaps:100}
    expect(() => layoutLayeredGraph({...line(),minimumTerminalLead:36},()=>undefined,reason=>{throw new Error(reason)},work)).toThrow('terminal-lead work limit')
    expect(work.pairs).toBeLessThan(0)
  })
  test('default known small heads retain the existing adequate gap and inline4 uses fixed units', async () => {
    const {renderMermaidSVGWithReceipt}=await import('../index.ts')
    const options={graphLayout:{backend:'agentic' as const,fallback:'none' as const},embedFontImport:false}
    const ordinary=renderMermaidSVGWithReceipt('flowchart LR\nA-->B',options).svg
    expect(ordinary).toContain('markerWidth="8" markerHeight="5"')
    const inline=renderMermaidSVGWithReceipt('flowchart LR\nA-->B\nlinkStyle 0 stroke-width:4px',options).svg
    expect(inline).toContain('markerWidth="8" markerHeight="8"')
    expect(inline).toContain('markerUnits="userSpaceOnUse"')
  })
  test('one hundred opaque tint changes retain ordinary Native support', async () => {
    const {renderMermaidSVGWithReceipt}=await import('../index.ts')
    const source='flowchart LR\n'+Array.from({length:100},(_,i)=>`N${i}-->N${i+1}`).join('\n')+'\n'+Array.from({length:100},(_,i)=>`linkStyle ${i} stroke:#${(i+4096).toString(16).padStart(6,'0')}`).join('\n')
    const rendered=renderMermaidSVGWithReceipt(source,{graphLayout:{backend:'agentic',fallback:'none'},embedFontImport:false})
    expect(rendered.svg.match(/class="edge"/g)).toHaveLength(100)
    expect(rendered.receipt.layoutDecisions?.every(d=>d.selected==='agentic')).toBe(true)
  })
})


describe('Native preparation ledger custody', () => {
  for (const hostile of [false,true]) test(`prepared requests retain the owned quota with explicit work hostile=${hostile}`, async () => {
    const native=await import('../layout/agentic-layered.ts'),producer=await import('../layout/agentic-producer-core.ts'),core=await import('../layout/agentic-layered-core.ts'),forest=await import('../layout/measured-forest.ts')
    const original=core.layoutLayeredGraph,observed:unknown[]=[]
    const supplied=hostile?Object.defineProperties({pairs:0,arcs:0,swaps:0},{pairs:{get:()=>1e9,set:()=>{}},arcs:{get:()=>1e9,set:()=>{}},swaps:{get:()=>1e9,set:()=>{}}}):{pairs:1,arcs:65536,swaps:1_000_000}
    const raw=spyOn(core,'layoutLayeredGraph').mockImplementation((...args:Parameters<typeof original>)=>{observed.push(args[3]);expect(args[3]).not.toBe(supplied);expect(args[3]!.pairs).toBeLessThan(1_000_000);return original(...args)})
    const owned=spyOn(native,'layoutAgenticCandidate').mockImplementation((graph,options,style,bindings)=>producer.layoutNativeGraphCandidate(graph,options,style,input=>producer.layoutLayeredGraph(input,forest.layoutMeasuredForest,reason=>{throw new GraphLayoutUnsupportedError(reason)},supplied),bindings))
    try{
      const api=await import('../index.ts'),render=()=>api.renderMermaidSVGWithReceipt(`flowchart LR\nLedger${hostile}A-->Ledger${hostile}B`,{graphLayout:{backend:'agentic',fallback:'none'},embedFontImport:false})
      if(hostile){expect(render().svg).toContain('<svg');expect(observed.length).toBeGreaterThan(0)}
      else{expect(render).toThrow('marker preparation work limit');expect(supplied.pairs).toBeLessThan(0);expect(observed).toHaveLength(0)}
    }finally{owned.mockRestore();raw.mockRestore()}
  })
})

describe('marker reservation cache keeps boundary-role identity', () => {
  for (const ancestorFirst of [false,true]) test(`ordinary and ancestor-start use distinct reservations, ancestorFirst=${ancestorFirst}`,async()=>{
    const {renderMermaidSVGWithReceipt}=await import('../index.ts')
    const relations=ancestorFirst?'G <--> A\nX <--> Y':'X <--> Y\nG <--> A'
    const rendered=renderMermaidSVGWithReceipt('flowchart LR\nsubgraph G\nA\nend\n'+relations,{graphLayout:{backend:'agentic',fallback:'none'},embedFontImport:false})
    expect(rendered.svg).toContain('data-id="G"')
    expect(rendered.svg).toContain('data-from="G" data-to="A"')
    expect(rendered.receipt.layoutDecisions?.every(d=>d.selected==='agentic')).toBe(true)
  })
})

describe('painted host padding corridors', () => {
  const input = (radius: number | undefined): MeasuredGraph => ({
    nodes: [
      { id: 'A', width: 100, height: 60, parent: 0, paintStrokeWidth: 1 },
      { id: 'B', width: 100, height: 60, parent: 1, paintStrokeWidth: 1 },
    ],
    groups: [
      { id: 'Parent', minWidth: 0, headerHeight: 20, padding: { top: 36, right: 16, bottom: 16, left: 16 }, paintStrokeWidth: 1, paintCornerRadius: radius },
      { id: 'Child', parent: 0, minWidth: 0, headerHeight: 20, padding: { top: 36, right: 16, bottom: 16, left: 16 }, paintStrokeWidth: 1, paintCornerRadius: radius },
    ],
    edges: [{ source: 0, target: 1, minSpan: 1, label: { width: 40, height: 20 } }],
    maximumEdgeStrokeWidth: 1, maximumEdgeBendRadius: 0,
    direction: 'TB', padding: 40, nodeSpacing: 40, layerSpacing: 80,
  })
  const fail = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason) }
  const budget = () => ({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 })

  test.each([{ radius: 0 }, { radius: 4 }])('routes through blank padding inside the actual radius-$radius host outline', ({ radius }) => {
    const graph = input(radius), before = structuredClone(graph)
    const output = layoutLayeredGraph(graph, () => undefined, fail), host = output.groups![0]!, route = output.edges[0]!
    expect(graph).toEqual(before)
    expect(output.nodes).toHaveLength(2)
    expect(output.groups).toHaveLength(2)
    expect(output.edges).toHaveLength(1)
    expect(output.boundaryRoutes).toEqual([0])
    expect(layoutLayeredGraph(graph, () => undefined, fail)).toEqual(output)
    const nodes = output.nodes.map((point, index) => ({ ...graph.nodes[index]!, ...point }))
    for (const [point, node] of [[route.points[0]!, nodes[0]!], [route.points.at(-1)!, nodes[1]!]] as const) {
      expect(point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height).toBe(true)
      expect(point.x === node.x || point.x === node.x + node.width || point.y === node.y || point.y === node.y + node.height).toBe(true)
    }
    // This route really uses the side padding excluded by the original domain.
    expect(route.points.some(point => point.x > host.x + host.width - 16 || point.x < host.x + 16)).toBe(true)
    const insidePaintedHost = (point: Point) => {
      // Remove the frame's half-stroke. Testing every vertex of each expanded
      // sharp segment rectangle proves its entire ink is in this convex inset.
      const left = host.x + .5, top = host.y + .5, right = host.x + host.width - .5, bottom = host.y + host.height - .5
      const r = Math.max(0, radius - .5)
      const dx = Math.max(left + r - point.x, 0, point.x - (right - r)), dy = Math.max(top + r - point.y, 0, point.y - (bottom - r))
      return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom && dx * dx + dy * dy <= r * r
    }
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!, b = route.points[i]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
      const ink = { x: Math.min(a.x, b.x) - .5, y: Math.min(a.y, b.y) - .5, width: Math.abs(b.x - a.x) + 1, height: Math.abs(b.y - a.y) + 1 }
      for (const x of [ink.x, ink.x + ink.width]) for (const y of [ink.y, ink.y + ink.height]) expect(insidePaintedHost({ x, y })).toBe(true)
      for (const node of nodes) expect(intersects(ink, { x: node.x + .5, y: node.y + .5, width: node.width - 1, height: node.height - 1 })).toBe(false)
      for (const group of output.groups!) expect(intersects(ink, { x: group.x - .5, y: group.y - .5, width: group.width + 1, height: 21 })).toBe(false)
    }
    const label = route.labelPosition!
    expect(label).toBeDefined()
    expect(route.points.some((b, i) => i > 0 && (route.points[i - 1]!.x === b.x ? label.x === b.x && label.y >= Math.min(route.points[i - 1]!.y, b.y) && label.y <= Math.max(route.points[i - 1]!.y, b.y) : label.y === b.y && label.x >= Math.min(route.points[i - 1]!.x, b.x) && label.x <= Math.max(route.points[i - 1]!.x, b.x)))).toBe(true)
    for (const x of [label.x - 22, label.x + 22]) for (const y of [label.y - 12, label.y + 12]) expect(insidePaintedHost({ x, y })).toBe(true)
  })

  test('unknown host corner geometry retains the original corridor refusal', () => {
    const graph = input(0)
    delete graph.groups![0]!.paintCornerRadius
    const before = structuredClone(graph)
    expect(() => layoutLayeredGraph(graph, () => undefined, fail)).toThrow('cross-hierarchy route has no bounded clear corridor')
    expect(graph).toEqual(before)
  })

  test('padding retry spends the same supplied arc ledger without replenishment', () => {
    const unknown = input(0)
    delete unknown.groups![0]!.paintCornerRadius
    const firstAttempt = { ...budget(), arcs: 2400 }
    expect(() => layoutLayeredGraph(unknown, () => undefined, fail, firstAttempt)).toThrow('cross-hierarchy route has no bounded clear corridor')
    expect(firstAttempt.arcs).toBeGreaterThan(0)
    const retry = { ...budget(), arcs: 2400 }
    expect(() => layoutLayeredGraph(input(0), () => undefined, fail, retry)).toThrow('cross-hierarchy visibility-arc limit')
    expect(retry.arcs).toBeLessThan(0)
    expect(retry.pairs).toBeLessThan(firstAttempt.pairs)
    expect(retry.swaps).toBeLessThan(firstAttempt.swaps)
  })

  test('invalid supplied group radii remain defects rather than fallback geometry', () => {
    for (const radius of [-1, NaN, Infinity, -Infinity]) expect(() => layoutLayeredGraph(input(radius), () => undefined, fail)).toThrow('Invalid measured group corner radius')
  })
})
