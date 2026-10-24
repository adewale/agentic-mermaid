import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { directLaneBlockers, laneContextFor } from '../route-contracts.ts'
import { routeChannelMayBlock, type RouteChannelGeometry } from '../shared/route-channel-geometry.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { Point, PositionedEdge } from '../types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

const peer = (points: Point[], ordinal = 0): PositionedEdge => ({
  source: `source${ordinal}`, target: `target${ordinal}`, points, edgeIndex: ordinal,
  style: 'solid', hasArrowStart: false, hasArrowEnd: true,
})
const probe = peer([], -1)
const style = resolveRenderStyle()

function channels(edges: PositionedEdge[], cross: 'x' | 'y', coordinate: number, mainLo: number, mainHi: number) {
  const { ctx } = laneContextFor([], edges, cross === 'x' ? 'TD' : 'LR', style)
  return directLaneBlockers(probe, coordinate, mainLo, mainHi, ctx)
}

describe('revision-owned route channel geometry', () => {
  it('keeps borrowed placement contexts live across in-place peer route changes', () => {
    const edge = peer([{ x: 0, y: 0 }, { x: 0, y: 100 }])
    const { ctx } = laneContextFor([], [edge], 'TD', style)
    expect(directLaneBlockers(probe, 200, 10, 90, ctx)).toEqual([])
    for (const point of edge.points) point.x = 200
    expect(directLaneBlockers(probe, 200, 10, 90, ctx)).toEqual([{ kind: 'channel', id: 'source0->target0' }])
    edge.points.splice(0, 2, { x: 400, y: 0 }, { x: 400, y: 100 })
    expect(directLaneBlockers(probe, 200, 10, 90, ctx)).toEqual([])
  })

  it('builds lazily, reuses one route revision, and invalidates in-place edits, replacement and rollback', () => {
    let reads = 0
    const point = (x: number, y: number): Point => ({ get x() { reads++; return x }, y })
    const edge = peer([point(0, 0), point(0, 100)])
    const geometry: RouteChannelGeometry = new WeakMap()
    expect(reads).toBe(0)
    expect(routeChannelMayBlock(geometry, edge, 'x', 200, 10, 90, 4, 0.01)).toBe(false)
    const builtReads = reads
    expect(routeChannelMayBlock(geometry, edge, 'x', 200, 10, 90, 4, 0.01)).toBe(false)
    expect(reads).toBe(builtReads)

    const original = edge.points
    edge.points = [{ x: 200, y: 0 }, { x: 200, y: 100 }]
    geometry.delete(edge)
    expect(routeChannelMayBlock(geometry, edge, 'x', 200, 10, 90, 4, 0.01)).toBe(true)
    edge.points[0]!.x = 400
    edge.points[1]!.x = 400
    geometry.delete(edge)
    expect(routeChannelMayBlock(geometry, edge, 'x', 200, 10, 90, 4, 0.01)).toBe(false)
    expect(routeChannelMayBlock(geometry, edge, 'y', 50, 390, 410, 4, 0.01)).toBe(false)
    edge.points.splice(1, 1, { x: 500, y: 0 })
    geometry.delete(edge)
    expect(routeChannelMayBlock(geometry, edge, 'y', 0, 410, 490, 4, 0.01)).toBe(true)

    edge.points.splice(0, 2, { x: 200, y: 0 }, { x: 200, y: 100 })
    geometry.delete(edge)
    expect(routeChannelMayBlock(geometry, edge, 'x', 200, 10, 90, 4, 0.01)).toBe(true)
    edge.points = original
    geometry.delete(edge)
    expect(routeChannelMayBlock(geometry, edge, 'x', 200, 10, 90, 4, 0.01)).toBe(false)
    expect(reads).toBeGreaterThan(builtReads)
  })

  it('keeps exact boundary hits, diagonal candidates, shared-target exceptions and authored blocker order', () => {
    const edges = [
      peer([{ x: 0, y: 0 }, { x: 0, y: 100 }], 0),
      peer([{ x: 0.1, y: 0 }, { x: 0.1, y: 100 }], 1),
      peer([{ x: -10, y: 0 }, { x: 20, y: 100 }], 2),
      peer([{ x: 0, y: 0 }, { x: 0.009, y: 100 }], 3),
      { ...peer([{ x: 0, y: 0 }, { x: 0, y: 100 }], 4), target: probe.target },
      peer([], 5),
    ]
    const geometry: RouteChannelGeometry = new WeakMap()
    for (const cross of ['x', 'y'] as const) for (const coordinate of [-4, -3.999, 0, 0.1, 4, 4.1, 50, 104]) {
      const filtered = edges.filter(edge => routeChannelMayBlock(geometry, edge, cross, coordinate, 10, 90, 4, 0.01))
      expect(channels(filtered, cross, coordinate, 10, 90)).toEqual(channels(edges, cross, coordinate, 10, 90))
    }
    expect(channels(edges, 'x', 0, 10, 90)).toEqual([
      { kind: 'channel', id: 'source0->target0' },
      { kind: 'channel', id: 'source1->target1' },
      { kind: 'channel', id: 'source3->target3' },
    ])
    expect(routeChannelMayBlock(geometry, edges[1]!, 'x', 4.1, 10, 90, 4, 0.01)).toBe(true)
  })

  it('falls back for non-finite route/query geometry and retains dense candidates', () => {
    const geometry: RouteChannelGeometry = new WeakMap()
    for (const value of [NaN, Infinity, -Infinity]) {
      const edge = peer([{ x: value, y: 0 }, { x: value, y: 100 }])
      expect(routeChannelMayBlock(geometry, edge, 'x', 0, 10, 90, 4, 0.01)).toBe(true)
      const finite = peer([{ x: 0, y: 0 }, { x: 0, y: 100 }])
      expect(routeChannelMayBlock(geometry, finite, 'x', value, 10, 90, 4, 0.01)).toBe(true)
    }
    const dense = Array.from({ length: 64 }, (_, i) => peer([{ x: 0, y: 0 }, { x: 0, y: 100 }], i))
    expect(dense.filter(edge => routeChannelMayBlock(geometry, edge, 'x', 0, 10, 90, 4, 0.01))).toEqual(dense)
    expect(channels(dense, 'x', 0, 10, 90)).toHaveLength(64)
  })

  it('preserves complete channel evidence across generated routes and repeated geometry revisions', () => {
    const point = fc.record({ x: fc.integer({ min: -1000, max: 1000 }), y: fc.integer({ min: -1000, max: 1000 }) })
    fc.assert(fc.property(
      fc.array(fc.array(point, { maxLength: 12 }), { maxLength: 40 }),
      point,
      fc.integer({ min: 1, max: 300 }),
      (routes, query, span) => {
        const edges = routes.map((points, ordinal) => peer(points, ordinal))
        const geometry: RouteChannelGeometry = new WeakMap()
        for (const cross of ['x', 'y'] as const) {
          const coordinate = query[cross], main = cross === 'x' ? query.y : query.x
          const compare = () => {
            const filtered = edges.filter(edge => routeChannelMayBlock(geometry, edge, cross, coordinate, main - span, main + span, 4, 0.01))
            const expected = channels(edges, cross, coordinate, main - span, main + span)
            expect(channels(filtered, cross, coordinate, main - span, main + span)).toEqual(expected)
          }
          compare()
          for (const edge of edges) {
            for (const p of edge.points) p[cross] = coordinate
            geometry.delete(edge)
          }
          compare()
        }
      },
    ), fcParameters({ numRuns: 1000 }))
  })
})
