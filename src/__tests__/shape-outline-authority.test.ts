import { describe, expect, test } from 'bun:test'
import { FLOWCHART_V11_SHAPES } from '../flowchart-shapes.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { applyRouteContracts, auditRouteContracts, shapePorts } from '../route-contracts.ts'
import { renderedEndpointContact } from '../rendered-endpoint-diagnostics.ts'
import { clipEdgeToShape } from '../shape-clipping.ts'
import { pointOnShapeSide, shapeOutline, shapeRoutingProfile } from '../shape-outline.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedNode } from '../types.ts'

const PAINT = { fill: '#fff', stroke: '#000', strokeWidth: '1' }
const node = (shape: PositionedNode['shape'], semanticShape?: string): PositionedNode => ({
  id: semanticShape ?? shape,
  label: 'X',
  shape,
  ...(semanticShape ? { semanticShape } : {}),
  x: 10,
  y: 20,
  width: 100,
  height: 40,
})

const ENVELOPE_SHAPES = new Set([
  'cloud', 'brace', 'brace-r', 'braces', 'datastore', 'delay', 'h-cyl',
  'lin-cyl', 'curv-trap', 'doc', 'lin-doc', 'docs', 'st-rect', 'flag',
  'bow-rect', 'tag-doc',
])

describe('canonical shape outline authority', () => {
  test('every documented semantic shape declares a bounded routing policy', () => {
    for (const [semanticShape, definition] of Object.entries(FLOWCHART_V11_SHAPES)) {
      const outline = shapeOutline(node(definition.geometry, semanticShape), PAINT)
      expect(outline.geometry, semanticShape).toBeDefined()
      if (semanticShape === 'text') expect(outline.routing.kind, semanticShape).toBe('none')
      else if (ENVELOPE_SHAPES.has(semanticShape)) expect(outline.routing.kind, semanticShape).toBe('envelope')
      else expect(outline.routing.kind, semanticShape).not.toBe('envelope')
    }
  })

  test('exact polygon/circle paint geometry is the routing geometry', () => {
    for (const semanticShape of ['bang', 'notch-rect', 'hourglass', 'bolt', 'tri', 'notch-pent', 'flip-tri', 'tag-rect']) {
      const outline = shapeOutline(node(FLOWCHART_V11_SHAPES[semanticShape]!.geometry, semanticShape), PAINT)
      expect(outline.geometry.kind, semanticShape).toBe('polygon')
      expect(outline.routing.kind, semanticShape).toBe('polygon')
      if (outline.geometry.kind === 'polygon' && outline.routing.kind === 'polygon') {
        expect(outline.routing.points, semanticShape).toEqual(outline.geometry.points)
      }
    }
    const small = shapeOutline(node('circle', 'sm-circ'), PAINT)
    expect(small.geometry).toEqual({ kind: 'circle', cx: 60, cy: 40, r: 8.8 })
    expect(small.routing).toEqual({ kind: 'ellipse', cx: 60, cy: 40, rx: 8.8, ry: 8.8 })
    const crossed = shapeOutline(node('circle', 'cross-circ'), PAINT)
    expect(crossed.routing).toEqual({ kind: 'ellipse', cx: 60, cy: 40, rx: 50, ry: 20 })
  })

  test('state start/end clipping uses the painted outer radius, not the layout box', () => {
    for (const shape of ['state-start', 'state-end'] as const) {
      const state = { ...node(shape), x: 0, y: 0, width: 20, height: 20 }
      const outline = shapeOutline(state, PAINT)
      expect(outline.routing).toEqual({ kind: 'ellipse', cx: 10, cy: 10, rx: 8, ry: 8 })
      expect(clipEdgeToShape([{ x: 20, y: 10 }, { x: 30, y: 10 }], state, true)[0])
        .toEqual({ x: 18, y: 10 })
    }
  })

  test('an explicit zero corner radius remains square on rounded nodes', () => {
    const rounded = node('rounded')
    expect(shapeOutline(rounded, PAINT).geometry).toEqual({
      kind: 'rect', x: 10, y: 20, width: 100, height: 40, rx: 6, ry: 6,
    })
    expect(shapeOutline(rounded, PAINT, 0).geometry).toEqual({
      kind: 'rect', x: 10, y: 20, width: 100, height: 40, rx: 0, ry: 0,
    })
  })

  test('small-circle clipping cannot fall back to its full-size circle geometry', () => {
    const small = node('circle', 'sm-circ')
    const clipped = clipEdgeToShape([{ x: 110, y: 40 }, { x: 140, y: 40 }], small, true)[0]!
    expect(clipped.x).toBeCloseTo(68.8, 8)
    expect(clipped.y).toBe(40)
  })

  test('the settled route pipeline cannot restore a small circle bounding-box port', () => {
    const graph = layoutGraphSync(parseMermaid('flowchart LR\n  A[Source] --> B@{ shape: sm-circ, label: "" }'))
    const target = graph.nodes.find(candidate => candidate.id === 'B')!
    const endpoint = graph.edges[0]!.points.at(-1)!
    expect(endpoint.x).toBeCloseTo(target.x + target.width / 2 - target.height * .22, 8)
    expect(endpoint.y).toBeCloseTo(target.y + target.height / 2, 8)
  })

  test('the final route audit independently rejects a small-circle bounding-box endpoint', () => {
    const source = parseMermaid('flowchart LR\n  A[Source] --> B@{ shape: sm-circ, label: "" }')
    const positioned = layoutGraphSync(source)
    const target = positioned.nodes.find(candidate => candidate.id === 'B')!
    positioned.edges[0]!.points[positioned.edges[0]!.points.length - 1] = {
      x: target.x,
      y: target.y + target.height / 2,
    }
    expect(auditRouteContracts(positioned, source)).toContainEqual({
      code: 'ROUTE_SHAPE_MISANCHOR',
      edge: 'A->B',
      node: 'B',
    })
  })

  test('the settled route pipeline uses painted State pseudostate radii', () => {
    const graph = layoutGraphSync(parseMermaid('stateDiagram-v2\n  direction LR\n  [*] --> Ready\n  Ready --> [*]'))
    const nodeMap = new Map(graph.nodes.map(candidate => [candidate.id, candidate]))
    for (const edge of graph.edges) {
      const source = nodeMap.get(edge.source)!
      const target = nodeMap.get(edge.target)!
      if (source.shape === 'state-start') {
        expect(edge.points[0]!.x).toBeCloseTo(source.x + source.width - 2, 8)
      }
      if (target.shape === 'state-end') {
        expect(edge.points.at(-1)!.x).toBeCloseTo(target.x + 2, 8)
      }
    }
  })

  test('route-contract shortening stays on every exact semantic outline in every direction', () => {
    const directions = ['LR', 'RL', 'TD', 'BT'] as const
    const sides = (direction: typeof directions[number]) => direction === 'LR'
      ? ['E', 'W'] as const : direction === 'RL'
        ? ['W', 'E'] as const : direction === 'BT'
          ? ['N', 'S'] as const : ['S', 'N'] as const
    const failures: string[] = []

    for (const direction of directions) for (const semanticShape of Object.keys(FLOWCHART_V11_SHAPES)) {
      const graph = parseMermaid(`flowchart ${direction}\n  A[Source] --> B@{ shape: ${semanticShape}, label: "X" }`)
      const positioned = layoutGraphSync(graph)
      const edge = positioned.edges[0]!
      const source = positioned.nodes.find(candidate => candidate.id === 'A')!
      const target = positioned.nodes.find(candidate => candidate.id === 'B')!
      const [sourceSide, targetSide] = sides(direction)
      const start = shapePorts(source)[sourceSide]
      const end = shapePorts(target)[targetSide]
      const horizontal = direction === 'LR' || direction === 'RL'
      const main = horizontal ? 'x' : 'y'
      const cross = horizontal ? 'y' : 'x'
      const point = (m: number, c: number) => horizontal ? { x: m, y: c } : { x: c, y: m }
      const m1 = start[main] + (end[main] - start[main]) * .3
      const m2 = start[main] + (end[main] - start[main]) * .7
      const displaced = start[cross] + 5
      edge.points = [start, point(m1, start[cross]), point(m1, displaced), point(m2, displaced), point(m2, end[cross]), end]

      applyRouteContracts(positioned, graph, new Set(), resolveRenderStyle({}))
      for (const [which, endpoint, owner, side] of [
        ['source', edge.points[0]!, source, sourceSide],
        ['target', edge.points.at(-1)!, target, targetSide],
      ] as const) {
        const profile = shapeRoutingProfile(owner)
        if (profile.boundary.kind === 'envelope' || profile.boundary.kind === 'none') continue
        const lane = horizontal ? endpoint.y : endpoint.x
        const expected = pointOnShapeSide(profile, side, lane)
        if (!expected || Math.hypot(endpoint.x - expected.x, endpoint.y - expected.y) > .01) {
          failures.push(`${direction}/${semanticShape}/${which}`)
        }
        const independent = renderedEndpointContact(owner, endpoint, .5)
        if (independent.policy !== 'none' && !independent.onBoundary) {
          failures.push(`${direction}/${semanticShape}/${which}/independent`)
        }
      }
      if (auditRouteContracts(positioned, graph).some(finding => finding.code === 'ROUTE_SHAPE_MISANCHOR')) {
        failures.push(`${direction}/${semanticShape}/audit`)
      }
    }
    expect(failures).toEqual([])
  }, 30_000)
})
