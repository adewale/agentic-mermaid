import { describe, expect, test } from 'bun:test'
import type { Point } from '../types.ts'
import { createEndpointSparseVisibilityGraph, createSparseAdjacencyStoragePool, createSparseQueryWorkspacePool, createSparseVisibilityGraph } from '../layout/compound-sparse-visibility.ts'
import { createCompoundObstacleIndex } from '../layout/compound-obstacle-index.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

class VisibilityRefusal extends Error {}

interface Box { x: number; y: number; width: number; height: number }

function crossesInterior(a: Point, b: Point, box: Box): boolean {
  if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width
    && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
  if (a.y === b.y) return a.y > box.y && a.y < box.y + box.height
    && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
  throw new Error('A routed segment is not orthogonal')
}

describe('shared sparse visibility and storage ownership', () => {
  test('sparse compound visibility preserves terminal leads around an overlapping obstacle union', () => {
    const bounds = { x: 0, y: 0, width: 220, height: 160 }
    const obstacles = [{ x: 0, y: 50, width: 20, height: 40 },
      { x: 70, y: 25, width: 60, height: 75 }, { x: 105, y: 60, width: 55, height: 65 }]
    const terminal = { port: { x: 20, y: 70 }, stub: { x: 28, y: 70 }, penalty: 0 }, goal = { x: 190, y: 70 }
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    reason => { throw new VisibilityRefusal(reason) })
    expect(() => graph.route([terminal], goal)).toThrow('no bounded clear corridor')
  })

  test('endpoint sparse corridors retain all intersecting solids within the original host bounds', () => {
    const obstacles = [{ x: 0, y: 40, width: 20, height: 40 }, { x: 90, y: 30, width: 30, height: 100 },
      ...Array.from({ length: 40 }, (_, index) => ({ x: 300 + index * 6, y: 30 + index * 9, width: 4, height: 4 }))]
    const terminal = { port: { x: 20, y: 60 }, stub: { x: 28, y: 60 }, penalty: 0 }, goal = { x: 230, y: 60 }
    const graph = createEndpointSparseVisibilityGraph({ x: 0, y: 0, width: 600, height: 500 },
      { x: 0, y: 0, width: 200, height: 200 }, obstacles, [terminal], goal, 8,
      { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }, 300,
      reason => { throw new VisibilityRefusal(reason) })
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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

  test('retired sparse graphs reuse physical adjacency storage within a cumulative arc budget', () => {
    const work = { pairs: 1_000_000, arcs: 180, swaps: 1_000_000 }
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
    let allocated = 0
    const reserve = (amount: number): void => { if (allocated + amount > 32768) fail('shared expansion limit'); allocated += amount }
    const canTraverse = (a: Point, b: Point): boolean => a.x !== b.x || ![0, 80, 100].includes(a.x)
    const first = createSparseVisibilityGraph(bounds, obstacles, [terminal], [goal], 8, work, 32768, fail, reserve)
    try { first.route([terminal], goal, undefined, canTraverse) } catch (error) { if (!(error instanceof VisibilityRefusal)) throw error }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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
    const fail = (reason: string): never => { throw new VisibilityRefusal(reason) }
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

})
