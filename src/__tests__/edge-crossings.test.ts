import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { checkQuality, measureQuality } from '../agent/quality.ts'
import { positionedToRenderedLayout } from '../agent/layout-to-rendered.ts'
import { toFinite } from '../agent/types.ts'
import { assessLayout, countEdgeCrossings, measureRubricMetrics } from '../layout-rubric.ts'
import { parseMermaid } from '../parser.ts'
import { countIndexedPolylineCrossings, countPolylineCrossings, crossingPoint, distinctCrossingLocations, retainCrossingLocation, type CrossingPolyline } from '../shared/edge-crossings.ts'
import { resolveRenderStyle } from '../styles.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import type { Point, PositionedEdge, PositionedGraph } from '../types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

function edge(points: Array<[number, number]>, source = 'A', target = 'B', style: PositionedEdge['style'] = 'solid'): PositionedEdge {
  return { source, target, style, hasArrowStart: false, hasArrowEnd: true, points: points.map(([x, y]) => ({ x, y })) }
}

function crossingMeasurements(edges: PositionedEdge[]): number[] {
  const positioned: PositionedGraph = { nodes: [], edges, groups: [], width: 1000, height: 1000 }
  return [countEdgeCrossings(edges), measureQuality(positionedToRenderedLayout(positioned, 'flowchart')).edgeCrossings]
}

describe('shared visible proper-crossing metric', () => {
  test('sharing a graph endpoint never hides a crossing elsewhere', () => {
    const edges = [edge([[0, 0], [100, 100]], 'A', 'B'), edge([[0, 100], [100, 0]], 'A', 'C')]
    expect(crossingMeasurements(edges)).toEqual([1, 1])
    expect(crossingMeasurements([edges[0]!, edge([[0, 0], [100, 0]], 'A', 'C')])).toEqual([0, 0])
  })

  test('endpoint tolerance measures pixels rather than a fraction of segment length', () => {
    const crossing = edge([[1, -100], [1, 100]], 'C', 'D')
    expect(crossingMeasurements([edge([[0, 0], [100, 0]]), crossing])).toEqual([1, 1])
    expect(crossingMeasurements([edge([[0, 0], [100000, 0]]), crossing])).toEqual([1, 1])
    expect(crossingMeasurements([edge([[0, 0], [100000, 0]]), edge([[0.005, -100], [0.005, 100]], 'C', 'D')])).toEqual([0, 0])
  })

  test('public paths retain subpixel evidence needed to agree near rounded endpoints', () => {
    const edges = [edge([[0.51, 0.51], [100.51, 0.51]]), edge([[0.6, -10.51], [0.6, 10.51]], 'C', 'D')]
    const layout = positionedToRenderedLayout({ nodes: [], edges, groups: [], width: 101, height: 101 }, 'flowchart')
    expect(layout.edges[0]!.path[0]).toEqual([toFinite(0.51), toFinite(0.51)])
    expect(crossingMeasurements(edges)).toEqual([1, 1])
  })

  test('an exact zero-padding canvas contains its fractional-width node', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart TD\nA[WWWWWWWWWWW]'), { padding: 0 })
    const layout = positionedToRenderedLayout(positioned, 'flowchart')
    const node = layout.nodes[0]!
    expect(layout.bounds.w).toBe(toFinite(positioned.width))
    expect(layout.bounds.h).toBe(toFinite(positioned.height))
    expect(node.x + node.w).toBeLessThanOrEqual(layout.bounds.w)
    expect(node.y + node.h).toBeLessThanOrEqual(layout.bounds.h)
    expect(positioned.width % 1).not.toBe(0)
  })

  test('nested groups and their canvas retain exact shared boundaries', () => {
    const positioned: PositionedGraph = {
      nodes: [{ id: 'A', label: 'A', shape: 'rectangle', x: 0.3, y: 0.3, width: 9.8, height: 9.8 }], edges: [], width: 10.4, height: 10.4,
      groups: [{ id: 'outer', label: 'Outer', x: 0.1, y: 0.1, width: 10.3, height: 10.3, children: [
        { id: 'inner', label: 'Inner', x: 0.2, y: 0.2, width: 10.1, height: 10.1, nodeIds: ['A'], children: [] },
      ] }],
    }
    const layout = positionedToRenderedLayout(positioned, 'flowchart')
    const outer = layout.groups[0]!, inner = layout.groups[1]!, node = layout.nodes[0]!
    expect([outer.x, outer.y, outer.w, outer.h]).toEqual([0.1, 0.1, 10.3, 10.3].map(toFinite))
    expect([inner.x, inner.y, inner.w, inner.h]).toEqual([0.2, 0.2, 10.1, 10.1].map(toFinite))
    expect(inner.parentId).toBe('outer')
    expect(inner.members).toEqual(['A'])
    expect(node.x + node.w).toBeLessThanOrEqual(inner.x + inner.w)
    expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w)
    expect(outer.x + outer.w).toBeLessThanOrEqual(layout.bounds.w)
  })

  test('hidden structural routes survive projection and do not add crossings', () => {
    const edges = [edge([[0, 0], [100, 100]]), edge([[0, 100], [100, 0]], 'C', 'D', 'invisible')]
    const layout = positionedToRenderedLayout({ nodes: [], edges, groups: [], width: 100, height: 100 }, 'flowchart')
    expect(layout.edges[0]!.visibility).toBeUndefined()
    expect(layout.edges[1]!.visibility).toBe('hidden')
    expect(crossingMeasurements(edges)).toEqual([0, 0])
    // Existing extensions that omit visibility keep visible-edge semantics.
    delete layout.edges[1]!.visibility
    expect(measureQuality(layout).edgeCrossings).toBe(1)
  })

  test('adding hidden structural routes cannot dilute a visible crossing violation', () => {
    const visible = [edge([[0, 0], [100, 100]]), edge([[0, 100], [100, 0]], 'C', 'D')]
    const hidden = Array.from({ length: 20 }, () => edge([[0, 100], [100, 0]], 'E', 'F', 'invisible'))
    const project = (edges: PositionedEdge[]) => positionedToRenderedLayout({ nodes: [], edges, groups: [], width: 100, height: 100 }, 'flowchart')
    const before = checkQuality(project(visible))
    const after = checkQuality(project([...visible, ...hidden]))
    const crossings = (verdict: typeof before) => verdict.ranked.filter(violation => violation.metric === 'edgeCrossings')
    expect(crossings(before)).toHaveLength(1)
    expect(after.metrics.edgeCrossings).toBe(1)
    expect(after.metrics.edgeCount).toBe(22)
    expect(crossings(after)).toEqual(crossings(before))
    expect(crossings(after)[0]!.message).toContain('1/1 (100.0%)')
  })

  test('subdivision, repeated points, route order, and route direction preserve one crossing', () => {
    const routes = [edge([[0, 50], [50, 50], [50, 50], [100, 50]]), edge([[50, 0], [50, 50], [50, 100]], 'C', 'D')]
    for (const reverseEdges of [false, true]) for (const reversePoints of [false, true]) {
      const edges = routes.map(route => ({ ...route, points: reversePoints ? [...route.points].reverse() : route.points }))
      if (reverseEdges) edges.reverse()
      expect(crossingMeasurements(edges)).toEqual([1, 1])
    }
  })

  test('nearby crossing locations do not depend on route traversal or input order', () => {
    const horizontal = edge([[-10, 0], [10, 0]])
    // The crossings at x=0, 0.006 and 0.012 are three distinct locations.
    // Physical endpoint contact tolerance must not merge nearby incidences.
    const points: Array<[number, number]> = [
      [-1, -1], [1, (1 - 0.006) / (1 + 0.006)], [-1, -1],
      [1, 1], [-1, -1], [1, (1 - 0.012) / (1 + 0.012)], [-1, -1],
    ]
    for (const subdivide of [false, true]) for (const reverseEdges of [false, true]) for (const reverseFirst of [false, true]) for (const reverseSecond of [false, true]) {
      const polyline = subdivide ? points.flatMap((point, index): Array<[number, number]> => {
        const next = points[index + 1]
        return next ? [point, [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]] : [point]
      }) : points
      const routes = [
        { ...horizontal, points: reverseFirst ? [...horizontal.points].reverse() : horizontal.points },
        edge(reverseSecond ? [...polyline].reverse() : polyline, 'C', 'D'),
      ]
      if (reverseEdges) routes.reverse()
      expect(crossingMeasurements(routes)).toEqual([3, 3])
    }
  })

  test('an interior crossing near a bend is not snapped to that bend', () => {
    const diagonal = edge([[0, 3], [3, -3]])
    for (const subdivide of [false, true]) for (const reversePoints of [false, true]) {
      const points: Array<[number, number]> = [[-1, 1], [1, 1.002], ...(subdivide ? [[0.5, 2.001] as [number, number]] : []), [0, 3]]
      const routes = [diagonal, edge(points, 'C', 'D')].map(route => ({
        ...route, points: reversePoints ? [...route.points].reverse() : route.points,
      }))
      expect(crossingMeasurements(routes)).toEqual([1, 1])
    }
  })

  test('intersection roundoff at an internal vertex preserves tangency versus crossing', () => {
    // B's final segment lies on y=x+2. A approaches (0,2) from below;
    // leaving below merely touches B, while leaving above crosses it.
    const second = edge([[-3, 2], [-2, 0], [1, 3]], 'C', 'D')
    for (const [endY, expected] of [[0, 0], [3, 1]] as const) {
      const first = edge([[-1.98, 0], [0, 2], [-1, endY]])
      for (const subdivide of [false, true]) for (const reverseEdges of [false, true]) for (const reversePoints of [false, true]) {
        const routes = [first, second].map(route => ({
          ...route,
          points: route.points.flatMap((point, index) => {
            const next = route.points[index + 1]
            return subdivide && next ? [point, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }] : [point]
          }),
        })).map(route => ({ ...route, points: reversePoints ? route.points.reverse() : route.points }))
        if (reverseEdges) routes.reverse()
        expect(crossingMeasurements(routes)).toEqual([expected, expected])
      }
    }
  })

  test('retracing a long diagonal does not count its single crossing twice', () => {
    // B retraces y=x. A crosses that line once, near (232222,232222).
    // Rounding in million-unit segment arithmetic must not create a second
    // location when two calculations land a few ULPs apart at that crossing.
    const routes = [
      edge([[-1990000, 3010000], [2010000, -1990000]]),
      edge([[10000, 10000], [2010000, 2010000], [-1990000, -1990000]], 'C', 'D'),
    ]
    for (const subdivide of [false, true]) for (const reverseEdges of [false, true]) for (const reversePoints of [false, true]) {
      const transformed = routes.map(route => ({
        ...route,
        points: route.points.flatMap((point, index) => {
          const next = route.points[index + 1]
          return subdivide && next ? [point, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }] : [point]
        }),
      })).map(route => ({ ...route, points: reversePoints ? route.points.reverse() : route.points }))
      if (reverseEdges) transformed.reverse()
      expect(crossingMeasurements(transformed)).toEqual([1, 1])
    }
  })

  test('collinear subdivisions retain a crossing even when the new segment is tiny', () => {
    const vertical = edge([[0.5, -1], [0.5, 1]], 'C', 'D')
    for (const halfLength of [1e-2, 1e-6, 1e-10, 1e-13]) {
      const horizontal = edge([[0, 0], [0.5 - halfLength, 0], [0.5 + halfLength, 0], [1, 0]])
      for (const reversePoints of [false, true]) {
        const routes = [horizontal, vertical].map(route => ({ ...route, points: reversePoints ? [...route.points].reverse() : route.points }))
        expect(crossingMeasurements(routes)).toEqual([1, 1])
      }
    }
  })

  test('counts distinct incidences while excluding tangencies, shared ink, and self-crossings', () => {
    const horizontal = edge([[0, 50], [100, 50]])
    const twice = edge([[25, 0], [25, 100], [75, 100], [75, 0]], 'C', 'D')
    expect(crossingMeasurements([horizontal, twice])).toEqual([2, 2])
    expect(crossingMeasurements([horizontal, edge([[25, 0], [50, 50], [75, 0]], 'C', 'D')])).toEqual([0, 0])
    expect(crossingMeasurements([horizontal, edge([[25, 50], [75, 50]], 'C', 'D')])).toEqual([0, 0])
    expect(crossingMeasurements([edge([[0, 0], [100, 100], [0, 100], [100, 0]])])).toEqual([0, 0])
    // Three route pairs can cross at one physical coordinate.
    expect(crossingMeasurements([horizontal, edge([[50, 0], [50, 100]], 'C', 'D'), edge([[0, 0], [100, 100]], 'E', 'F')])).toEqual([3, 3])
  })

  test('involved-edge filtering preserves indices when hidden routes are omitted', () => {
    const edges = [edge([[0, 0], [100, 100]], 'E', 'F', 'invisible'), edge([[0, 50], [100, 50]]), edge([[50, 0], [50, 100]], 'C', 'D')]
    expect(countEdgeCrossings(edges, new Set([0]))).toBe(0)
    expect(countEdgeCrossings(edges, new Set([1]))).toBe(1)
    expect(countEdgeCrossings(edges, new Set([2]))).toBe(1)
  })

  test('translation and scale retain crossings outside the physical contact tolerance', () => {
    const points: Point[][] = [[{ x: 0, y: 0 }, { x: 100, y: 100 }], [{ x: 0, y: 100 }, { x: 100, y: 0 }]]
    for (const scale of [0.1, 1, 1000]) for (const offset of [-10000, 0, 10000]) {
      expect(countPolylineCrossings(points.map(path => ({ points: path.map(p => ({ x: p.x * scale + offset, y: p.y * scale + offset })) })))).toBe(1)
    }
  })

  test('final bend totals and production pass budgets both ignore invisible routes', () => {
    const graph = parseMermaid('flowchart LR\nA --> B\nC ~~~ D')
    const edges = [edge([[0, 0], [50, 0], [50, 100]]), edge([[0, 100], [10, 100], [10, 200], [50, 200]], 'C', 'D', 'invisible')]
    const positioned = { nodes: [], edges, groups: [], width: 100, height: 200 }
    const metrics = assessLayout(graph, positioned).metrics
    expect(metrics.totalBends).toBe(1)
    expect(metrics.maxBendsPerEdge).toBe(1)
    expect(measureRubricMetrics(graph, positioned, ['bends'], resolveRenderStyle({})).bends).toBe(metrics.totalBends)
  })
})

/** Every pair of segments with overlapping closed boxes, in the metric's
 * canonical segment order: the definition the indexed evaluation must equal. */
function allPairsCrossings(routes: readonly CrossingPolyline[], involved?: ReadonlySet<number>): number {
  const segments = routes.flatMap((route, edgeIndex) => route.visible === false ? [] : route.points.slice(1).flatMap((b, offset) => {
    const a = route.points[offset]!
    return a.x === b.x && a.y === b.y ? [] : [{ a, b, edgeIndex, pointIndex: offset, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) }]
  }))
  segments.sort((p, q) => p.minX - q.minX || p.minY - q.minY || p.edgeIndex - q.edgeIndex || p.pointIndex - q.pointIndex)
  const locations = new Map<string, NonNullable<ReturnType<typeof crossingPoint>>[]>()
  for (let later = 0; later < segments.length; later++) {
    for (let earlier = 0; earlier < later; earlier++) {
      const s = segments[later]!, t = segments[earlier]!
      if (s.edgeIndex === t.edgeIndex || t.maxX < s.minX || t.maxY < s.minY || t.minY > s.maxY) continue
      if (involved && !involved.has(s.edgeIndex) && !involved.has(t.edgeIndex)) continue
      const point = crossingPoint(s, t, routes)
      if (!point) continue
      const key = `${Math.min(s.edgeIndex, t.edgeIndex)}:${Math.max(s.edgeIndex, t.edgeIndex)}`
      const points = locations.get(key)
      if (points) retainCrossingLocation(points, point)
      else locations.set(key, [point])
    }
  }
  let crossings = 0
  for (const points of locations.values()) crossings += distinctCrossingLocations(points)
  return crossings
}

const polylineOf = (points: Array<[number, number]>): CrossingPolyline => ({ points: points.map(([x, y]) => ({ x, y })) })

describe('indexed crossing evaluation', () => {
  // A coarse lattice makes collinear overlaps, shared bends, T-contacts and
  // duplicate points common; offsets straddle the 0.01 endpoint radius and the
  // indexed counter's 0.05 margin. Diagonal and retracing steps take the
  // pairwise path beside clean orthogonal routes in the same input.
  const offset = fc.constantFrom(0, 0, 0, 0.005, -0.005, 0.02, 0.0499, 0.05, 0.0501, -0.06, 1e-9, 0.5)
  const step = fc.record({
    axis: fc.constantFrom('x', 'y', 'x', 'y', 'diagonal'),
    delta: fc.integer({ min: -3, max: 3 }),
    jitter: offset,
  })
  const polyline = fc.record({
    start: fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 }), offset, offset),
    steps: fc.array(step, { maxLength: 7, size: 'max' }),
    visible: fc.constantFrom(true, true, true, false),
  }).map(({ start: [x0, y0, dx, dy], steps, visible }): CrossingPolyline => {
    let x = x0 * 10 + dx, y = y0 * 10 + dy
    const points = [{ x, y }]
    for (const { axis, delta, jitter } of steps) {
      // Axis steps stay exactly axis-aligned; their length is off-lattice.
      if (axis !== 'y') x += delta * 10 + jitter
      if (axis !== 'x') y += delta * 10 + (axis === 'y' ? jitter : 0)
      points.push({ x, y })
    }
    return { points, ...(visible ? {} : { visible: false }) }
  })
  const scene = fc.record({
    routes: fc.array(polyline, { minLength: 2, maxLength: 36, size: 'max' }),
    involved: fc.option(fc.uniqueArray(fc.integer({ min: 0, max: 35 }), { maxLength: 4 }), { nil: undefined }),
    scale: fc.constantFrom(1, 1, 1, 0.001, 1e6),
  })

  type SceneValue = typeof scene extends fc.Arbitrary<infer T> ? T : never

  test('equals the all-pairs evaluation for every route set', () => {
    fc.assert(fc.property(scene, ({ routes, involved, scale }) => {
      const scaled = scale === 1 ? routes : routes.map(route => ({ ...route, points: route.points.map(p => ({ x: p.x * scale, y: p.y * scale })) }))
      const set = involved && new Set(involved)
      const expected = allPairsCrossings(scaled, set)
      expect(countIndexedPolylineCrossings(scaled, set)).toBe(expected)
      expect(countPolylineCrossings(scaled, set)).toBe(expected)
    }), fcParameters<[SceneValue]>({ numRuns: 300, examples: [
      // Reduced counterexamples from incorrect indexed variants: a crossing
      // inside the margin at a horizontal's far end; a route endpoint inside
      // the 0.01 contact radius; a retraced horizontal; and a route whose
      // non-adjacent segments come within the margin of each other.
      [{ routes: [polylineOf([[0, 10.0499], [0, 0.0499]]), polylineOf([[0, 0]]), polylineOf([[0.5, 10], [-9.5, 10]])], involved: undefined, scale: 1 }],
      [{ routes: [polylineOf([[0, 19.995], [0, 29.995]]), polylineOf([[0.05, 20], [-9.95, 20]]), polylineOf([[0, 0]]), polylineOf([[0, 0]])], involved: undefined, scale: 1 }],
      [{ routes: [polylineOf([[0, 0], [0, 20]]), polylineOf([[0, 0]]), polylineOf([[0, 10], [-10, 10], [0.5, 10]])], involved: undefined, scale: 1 }],
      [{ routes: [polylineOf([[0, 0], [0, 20], [-10, 20], [-10, 10], [0.0501, 10]]), polylineOf([[0, 0]]), polylineOf([[0, 0]])], involved: undefined, scale: 1 }],
    ] }))
  })

  test('a dense orthogonal channel counts every crossing without visiting each pair', () => {
    // n sources fan to n targets through one channel: n² (n-1)² / 4 proper crossings.
    const n = 24, routes: CrossingPolyline[] = []
    for (let s = 0; s < n; s++) for (let t = 0; t < n; t++) {
      const y = 100 + (s * n + t) * 2
      routes.push({ points: [{ x: s * 40, y: 0 }, { x: s * 40, y }, { x: t * 40 + 7, y }, { x: t * 40 + 7, y: 2000 }] })
    }
    expect(countPolylineCrossings(routes)).toBe(allPairsCrossings(routes))
  })

  test('non-finite and very large coordinates stay with the reference evaluation', () => {
    expect(countIndexedPolylineCrossings([{ points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }] }, { points: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }])).toBeUndefined()
    expect(countIndexedPolylineCrossings([{ points: [{ x: 0, y: 0 }, { x: 1e13, y: 0 }] }, { points: [{ x: 5, y: -1 }, { x: 5, y: 1 }] }])).toBeUndefined()
  })
})
