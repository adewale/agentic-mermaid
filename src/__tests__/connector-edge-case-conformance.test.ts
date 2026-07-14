import { describe, expect, test } from 'bun:test'
import { Resvg } from '@resvg/resvg-js'

import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { RoughBackend } from '../scene/rough-backend.ts'
import { HybridBackend } from '../scene/hybrid-backend.ts'
import { hitTestConnector } from '../scene/hit-test.ts'
import { nodeWorldBounds } from '../scene/bounds.ts'
import {
  connectorEndpointAnchors,
  connectorUnitTangent,
  flattenCubicBezier,
} from '../scene/connector-geometry.ts'
import type { ConnectorFields } from '../scene/marks.ts'

const BACKENDS = [DefaultBackend, RoughBackend, HybridBackend] as const

function connector(
  id: string,
  fields: Pick<ConnectorFields, 'geometry'> & Partial<Omit<ConnectorFields, 'id' | 'role' | 'geometry' | 'lineStyle' | 'paint'>>,
  crisp: string,
) {
  return marks.connector({
    id,
    role: 'edge',
    lineStyle: 'solid',
    paint: { fill: 'none', stroke: '#243447', strokeWidth: '2' },
    ...fields,
  }, crisp)
}

function draw(node: ReturnType<typeof connector>, backend: (typeof BACKENDS)[number]): string {
  return backend.drawNode(node, {
    seed: 17,
    style: { name: 'look:connector-edge-cases', stroke: backend === HybridBackend ? 'freehand' : 'jittered' },
  })
}

describe('connector named edge-case conformance', () => {
  test('cubic controls are flattened into hittable route geometry without becoming visible segments', () => {
    const start = { x: 0, y: 0 }
    const control1 = { x: 100, y: 0 }
    const control2 = { x: 100, y: 100 }
    const end = { x: 200, y: 100 }
    const points = flattenCubicBezier(start, control1, control2, end)
    const startTangent = connectorUnitTangent(start, control1)!
    const endTangent = connectorUnitTangent(control2, end)!
    const node = connector('cubic-route', {
      geometry: { kind: 'path', d: 'M 0 0 C 100 0 100 100 200 100', points },
      route: { contours: [{ start, end, closed: false, startTangent, endTangent }] },
    }, '<path d="M 0 0 C 100 0 100 100 200 100" fill="none" stroke="#243447" stroke-width="2" />')

    expect(points.length).toBeGreaterThan(4)
    expect(points[0]).toEqual(start)
    expect(points.at(-1)).toEqual(end)
    expect(node.route.startTangent).toEqual({ x: 1, y: 0 })
    expect(node.route.endTangent).toEqual({ x: 1, y: 0 })
    // Exact cubic point at t=.25: it must hit the flattened curve. A point on
    // the old start->control1 polygon segment must not be a false positive.
    expect(hitTestConnector(node, { x: 59.375, y: 15.625 })).toBe(true)
    expect(hitTestConnector(node, { x: 50, y: 0 })).toBe(false)

    const controlPolygon = connector('cubic-route', {
      geometry: { kind: 'polyline', points: [start, control1, control2, end] },
    }, '<polyline points="0,0 100,0 100,100 200,100" fill="none" stroke="#243447" stroke-width="2" />')
    const visibleSketch = (svg: string) => svg.split('\n').filter(line => !line.includes('stroke-opacity="0"')).join('\n')
    expect(visibleSketch(draw(node, RoughBackend))).not.toBe(visibleSketch(draw(controlPolygon, RoughBackend)))
  })

  test('rejects non-unit top-level route tangents before they enter terminal semantics', () => {
    expect(() => connector('invalid-route-tangent', {
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      route: { startTangent: { x: 2, y: 0 }, endTangent: { x: 0, y: 9 } },
    }, '<line x1="0" y1="0" x2="10" y2="0" />')).toThrow(/route tangents must be finite unit vectors/)
  })

  test('rejects duplicate endpoint and tangent fields that contradict route geometry', () => {
    expect(() => connector('contradictory-endpoint', {
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      endpoints: { start: { point: { x: 1, y: 0 } } },
    }, '<line x1="0" y1="0" x2="10" y2="0" />')).toThrow(/endpoints\.start\.point disagrees/)

    expect(() => connector('contradictory-tangent', {
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      route: { startTangent: { x: -1, y: 0 } },
    }, '<line x1="0" y1="0" x2="10" y2="0" />')).toThrow(/startTangent disagrees with its contour tangent authority/)

    expect(() => connector('contradictory-contour-tangent', {
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      route: {
        contours: [{
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
          closed: false,
          startTangent: { x: 0, y: 1 },
          endTangent: { x: 0, y: 1 },
        }],
      },
    }, '<line x1="0" y1="0" x2="10" y2="0" />')).toThrow(/contours\[0\]\.startTangent disagrees with linear route geometry/)

    expect(() => connector('contradictory-linear-path-tangent', {
      geometry: {
        kind: 'path',
        d: 'M 0 0 L 10 0',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      },
      route: {
        contours: [{
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
          closed: false,
          startTangent: { x: 0, y: -1 },
        }],
      },
    }, '<path d="M 0 0 L 10 0" />')).toThrow(/contours\[0\]\.startTangent disagrees with linear route geometry/)
  })

  test('multiple typed subpaths never gain a synthetic bridge', () => {
    const endpointMarker = {
      id: 'subpath-endpoint', shape: 'circle' as const,
      bounds: { x0: -12, y0: -12, x1: 12, y1: 12 },
      units: 'userSpaceOnUse' as const,
    }
    const node = connector('multiple-subpaths', {
      geometry: {
        kind: 'path',
        d: 'M 10 20 L 50 20 M 90 20 L 130 20',
        points: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 90, y: 20 }, { x: 130, y: 20 }],
        subpaths: [
          { points: [{ x: 10, y: 20 }, { x: 50, y: 20 }], closed: false },
          { points: [{ x: 90, y: 20 }, { x: 130, y: 20 }], closed: false },
        ],
      },
      markers: { start: endpointMarker, mid: [], end: endpointMarker },
    }, '<path d="M 10 20 L 50 20 M 90 20 L 130 20" fill="none" stroke="#243447" stroke-width="2" />')

    expect(connectorEndpointAnchors(node.geometry)).toEqual({
      starts: [{ x: 10, y: 20 }, { x: 90, y: 20 }],
      ends: [{ x: 50, y: 20 }, { x: 130, y: 20 }],
    })
    expect(node.route.contours).toEqual([
      { start: { x: 10, y: 20 }, end: { x: 50, y: 20 }, closed: false, startTangent: { x: 1, y: 0 }, endTangent: { x: 1, y: 0 } },
      { start: { x: 90, y: 20 }, end: { x: 130, y: 20 }, closed: false, startTangent: { x: 1, y: 0 }, endTangent: { x: 1, y: 0 } },
    ])
    expect(node.terminalProjection.markerPlacements).toEqual({
      start: [
        { markerId: 'subpath-endpoint', point: { x: 10, y: 20 }, contourIndex: 0 },
        { markerId: 'subpath-endpoint', point: { x: 90, y: 20 }, contourIndex: 1 },
      ],
      mid: [],
      end: [
        { markerId: 'subpath-endpoint', point: { x: 50, y: 20 }, contourIndex: 0 },
        { markerId: 'subpath-endpoint', point: { x: 130, y: 20 }, contourIndex: 1 },
      ],
    })
    expect(nodeWorldBounds(node)).toEqual({ x0: -2, y0: 8, x1: 142, y1: 32 })
    expect(hitTestConnector(node, { x: 30, y: 20 })).toBe(true)
    expect(hitTestConnector(node, { x: 70, y: 20 })).toBe(false)
    expect(draw(node, DefaultBackend)).toContain('M 10 20 L 50 20 M 90 20 L 130 20')
    for (const backend of [RoughBackend, HybridBackend]) {
      const output = draw(node, backend)
      // Invisible carrier + two independently generated visible contours.
      expect(output.match(/<path\b/g)?.length, backend.id).toBeGreaterThanOrEqual(3)
    }
    expect(() => connector('missing-subpaths', {
      geometry: {
        kind: 'path', d: 'M 0 0 L 10 0 M 20 0 L 30 0',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }],
      },
    }, '<path d="M 0 0 L 10 0 M 20 0 L 30 0" />')).toThrow('no typed subpaths')
  })

  test('Z closure and an explicit final L remain distinct but equally hittable', () => {
    const zClosed = connector('z-closed', {
      geometry: {
        kind: 'path', d: 'M 0 0 L 10 0 L 10 10 Z',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      },
      route: { closed: true },
    }, '<path d="M 0 0 L 10 0 L 10 10 Z" fill="none" stroke="#243447" stroke-width="2" />')
    const explicitLine = connector('explicit-final-line', {
      geometry: {
        kind: 'path', d: 'M 0 0 L 10 0 L 10 10 L 0 0',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }],
      },
      route: { closed: false },
    }, '<path d="M 0 0 L 10 0 L 10 10 L 0 0" fill="none" stroke="#243447" stroke-width="2" />')

    expect(zClosed.route.closed).toBe(true)
    expect(explicitLine.route.closed).toBe(false)
    expect(hitTestConnector(zClosed, { x: 5, y: 5 })).toBe(true)
    expect(hitTestConnector(explicitLine, { x: 5, y: 5 })).toBe(true)
    expect(draw(zClosed, DefaultBackend)).toContain('10 10 Z')
    expect(draw(explicitLine, DefaultBackend)).toContain('10 10 L 0 0')
    expect(() => connector('false-closure', {
      geometry: { kind: 'path', d: 'M 0 0 L 10 0 Z', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      route: { closed: false },
    }, '<path d="M 0 0 L 10 0 Z" />')).toThrow('close commands disagree')
  })

  test('closed topology has one path-only invariant across SVG, sketch, hit, endpoints, and markers', () => {
    expect(() => connector('closed-polyline', {
      geometry: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
      route: { closed: true },
    }, '<polyline points="0,0 10,0 10,10" />')).toThrow(/closed route topology requires path geometry/)
    expect(() => connector('divergent-hit-closure', {
      geometry: { kind: 'path', d: 'M 0 0 L 10 0 Z', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      route: { closed: true },
      hit: { closed: false },
    }, '<path d="M 0 0 L 10 0 Z" />')).toThrow(/hit.closed must match route.closed/)

    const marker = {
      id: 'closed-end', shape: 'circle' as const,
      bounds: { x0: -2, y0: -2, x1: 2, y1: 2 },
      units: 'userSpaceOnUse' as const,
    }
    const node = connector('closed-path-endpoint', {
      geometry: {
        kind: 'path', d: 'M 2 3 L 12 3 L 12 13 Z',
        points: [{ x: 2, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 13 }],
      },
      route: { closed: true },
      markers: { end: marker },
    }, '<path d="M 2 3 L 12 3 L 12 13 Z" fill="none" stroke="#243447" stroke-width="2" />')

    expect(node.endpoints.end?.point).toEqual({ x: 2, y: 3 })
    expect(node.route.contours[0]).toMatchObject({ start: { x: 2, y: 3 }, end: { x: 2, y: 3 }, closed: true })
    expect(node.terminalProjection.markerPlacements.end).toEqual([
      { markerId: 'closed-end', point: { x: 2, y: 3 }, contourIndex: 0 },
    ])
    expect(hitTestConnector(node, { x: 7, y: 8 })).toBe(true)
    expect(draw(node, DefaultBackend)).toContain('L 12 13 Z')
    expect(draw(node, RoughBackend)).toContain('marker-end="url(#closed-end)"')
  })

  test('zero-length paths remain finite and do not crash a backend', () => {
    const node = connector('zero-length', {
      geometry: { kind: 'path', d: 'M 25 25 L 25 25', points: [{ x: 25, y: 25 }, { x: 25, y: 25 }] },
    }, '<path d="M 25 25 L 25 25" fill="none" stroke="#243447" stroke-width="2" />')
    expect(hitTestConnector(node, { x: 25, y: 25 })).toBe(true)
    for (const backend of BACKENDS) expect(() => draw(node, backend), backend.id).not.toThrow()
  })

  test('odd/even dash arrays and offsets survive every graphical backend', () => {
    for (const [id, dash, offset] of [
      ['odd-dash', [7, 3, 2], 1],
      ['even-dash', [7, 3], -2],
    ] as const) {
      const node = connector(id, {
        geometry: { kind: 'line', x1: 10, y1: 20, x2: 130, y2: 20 },
        stroke: { dash: { array: dash, offset } },
      }, `<line x1="10" y1="20" x2="130" y2="20" fill="none" stroke="#243447" stroke-width="2" stroke-dasharray="${dash.join(' ')}" stroke-dashoffset="${offset}" />`)
      for (const backend of BACKENDS) {
        const output = draw(node, backend)
        expect(output, `${backend.id}/${id}`).toContain(`stroke-dasharray="${dash.join(' ')}"`)
        expect(output, `${backend.id}/${id}`).toContain(`stroke-dashoffset="${offset}"`)
      }
    }
  })

  test('acute miters, visible marker overflow, and transforms enter world bounds', () => {
    const marker = {
      id: 'overflow-marker',
      shape: 'arrow' as const,
      bounds: { x0: -6, y0: -6, x1: 18, y1: 6 },
      ref: { x: 0, y: 0 },
      units: 'userSpaceOnUse' as const,
      overflow: 'visible' as const,
    }
    const node = connector('miter-transform-marker', {
      geometry: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10.1, y: 10 }] },
      stroke: { width: 4, lineJoin: 'miter', miterLimit: 10, nonScaling: true },
      markers: { end: marker },
      transform: { kind: 'rotate', angle: 90, cx: 0, cy: 0 },
    }, '<polyline points="0,0 10,0 10.1,10" fill="none" stroke="#243447" stroke-width="4" stroke-linejoin="miter" stroke-miterlimit="10" vector-effect="non-scaling-stroke" />')

    const bounds = nodeWorldBounds(node)!
    expect(bounds.x0).toBeLessThanOrEqual(-30)
    expect(bounds.y0).toBeLessThanOrEqual(-20)
    expect(bounds.y1).toBeGreaterThanOrEqual(30)
    expect(hitTestConnector(node, { x: 0, y: 5 })).toBe(true)
    expect(hitTestConnector(node, { x: 5, y: 0 })).toBe(false)
    for (const backend of BACKENDS) {
      const output = draw(node, backend)
      expect(output, backend.id).toContain('transform="rotate(90 0 0)"')
      expect(output, backend.id).toContain('marker-end="url(#overflow-marker)"')
      expect(output, backend.id).toContain('vector-effect="non-scaling-stroke"')
    }
  })

  test('edge-case SVG from every backend remains rasterizable PNG input', () => {
    const node = connector('raster-edge-case', {
      geometry: {
        kind: 'path', d: 'M 10 20 L 50 20 M 90 20 L 130 20',
        points: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 90, y: 20 }, { x: 130, y: 20 }],
        subpaths: [
          { points: [{ x: 10, y: 20 }, { x: 50, y: 20 }], closed: false },
          { points: [{ x: 90, y: 20 }, { x: 130, y: 20 }], closed: false },
        ],
      },
    }, '<path d="M 10 20 L 50 20 M 90 20 L 130 20" fill="none" stroke="#243447" stroke-width="2" />')

    for (const backend of BACKENDS) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="40" viewBox="0 0 140 40">${draw(node, backend)}</svg>`
      const png = new Resvg(svg).render().asPng()
      expect([...png.slice(0, 8)], backend.id).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    }
  })
})
