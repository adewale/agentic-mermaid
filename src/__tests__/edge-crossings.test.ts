import { describe, expect, test } from 'bun:test'
import { checkQuality, measureQuality } from '../agent/quality.ts'
import { positionedToRenderedLayout } from '../agent/layout-to-rendered.ts'
import { toFinite } from '../agent/types.ts'
import { assessLayout, countEdgeCrossings, measureRubricMetrics } from '../layout-rubric.ts'
import { parseMermaid } from '../parser.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { resolveRenderStyle } from '../styles.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import type { Point, PositionedEdge, PositionedGraph } from '../types.ts'

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
