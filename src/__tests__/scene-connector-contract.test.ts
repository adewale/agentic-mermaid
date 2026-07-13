import { describe, expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { RoughBackend } from '../scene/rough-backend.ts'
import { HybridBackend } from '../scene/hybrid-backend.ts'
import { nodeWorldBounds } from '../scene/bounds.ts'
import { resolveSceneRoleTraits, sceneRoleTraits } from '../scene/roles.ts'
import { validatePrimitiveCapabilities } from '../scene/capabilities.ts'
import { hitTestConnector, hitTestSceneConnectors } from '../scene/hit-test.ts'
import { serializeMarkerResource } from '../scene/marker-resources.ts'

describe('typed Scene connector contract', () => {
  const crisp = '<line data-id="typed-id" data-role="edge" data-from="typed-a" data-to="typed-b" x1="0" y1="2" x2="10" y2="2" stroke="#00aa55" stroke-width="4" stroke-opacity="0" stroke-dasharray="9 2" stroke-dashoffset="0" stroke-linecap="square" stroke-linejoin="bevel" stroke-miterlimit="7" pathLength="40" paint-order="stroke fill" vector-effect="non-scaling-stroke" marker-end="url(#typed-arrow)" />'
  const connector = marks.connector({
    id: 'typed-id',
    role: 'edge',
    geometry: { kind: 'line', x1: 0, y1: 2, x2: 10, y2: 2 },
    lineStyle: 'dashed',
    paint: { stroke: '#00aa55', strokeWidth: '4', strokeDasharray: '9 2', strokeDashoffset: '0' },
    endpoints: { from: 'typed-a', to: 'typed-b' },
    relationship: { kind: 'dependency', direction: 'forward' },
    route: { ownership: 'layout', bendRadius: 3, labelAnchors: [{ x: 5, y: 0 }] },
    stroke: {
      opacity: 0,
      dash: { array: '9 2', offset: 0 },
      lineCap: 'square',
      lineJoin: 'bevel',
      miterLimit: 7,
      pathLength: 40,
      paintOrder: 'stroke fill',
      nonScaling: true,
    },
    labels: [{ id: 'edge-label', text: 'ships', anchor: { x: 5, y: 0 }, halo: { width: 3 } }],
    endMarker: {
      id: 'typed-arrow',
      shape: 'arrow',
      bounds: { x0: -2, y0: -4, x1: 4, y1: 4 },
      units: 'userSpaceOnUse',
      scale: 2,
    },
  }, crisp)

  test('semantic fields are authoritative and complete without crisp parsing', () => {
    expect(connector.identity).toEqual({ id: 'typed-id', role: 'edge', from: 'typed-a', to: 'typed-b' })
    expect(connector.endpoints.from).toBe('typed-a')
    expect(connector.endpoints.start?.point).toEqual({ x: 0, y: 2 })
    expect(connector.relationship).toEqual({ kind: 'dependency', direction: 'forward' })
    expect(connector.route.ownership).toBe('layout')
    expect(connector.route.geometry).toBe(connector.geometry)
    expect(connector.route.startTangent).toEqual({ x: 1, y: 0 })
    expect(connector.route.endTangent).toEqual({ x: 1, y: 0 })
    expect(connector.stroke).toMatchObject({
      color: '#00aa55', width: '4', opacity: 0, lineCap: 'square', lineJoin: 'bevel',
      miterLimit: 7, pathLength: 40, paintOrder: 'stroke fill', nonScaling: true,
    })
    expect(connector.stroke.dash).toEqual({ array: '9 2', offset: 0 })
    expect(connector.markers.end?.id).toBe('typed-arrow')
    expect(connector.labels[0]?.text).toBe('ships')
    expect(connector.hit).toMatchObject({ strokeWidth: 6, pointerEvents: 'stroke' })
    expect(connector.terminalProjection).toMatchObject({
      realization: 'projected', topology: 'line', direction: 'forward', relationship: 'dependency',
      markers: { mid: [], end: { id: 'typed-arrow', shape: 'arrow' } },
      labels: [{ id: 'edge-label', text: 'ships' }], lineStyle: 'dashed',
    })
    expect(connector.terminalProjection.strokeLosses).toEqual(expect.arrayContaining([
      'continuous-geometry', 'bend-radius', 'stroke-width', 'stroke-opacity',
      'stroke-cap', 'stroke-join', 'dash-pattern', 'dash-offset', 'path-length',
      'paint-order', 'non-scaling-stroke',
    ]))
    expect(connector.terminalProjection.diagnostics.length).toBeGreaterThan(0)
  })

  test('rejects a crisp compatibility projection that disagrees with typed semantics', () => {
    expect(() => marks.connector({
      id: 'divergent',
      role: 'edge',
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 4, y2: 0 },
      lineStyle: 'solid',
      paint: { stroke: '#00aa55', strokeWidth: '2' },
    }, '<line x1="0" y1="0" x2="4" y2="0" stroke="#ff0000" stroke-width="2" />')).toThrow('crisp stroke disagrees')
  })

  test('terminal projection derives start/mid/end markers and labels from typed semantics', () => {
    const marker = (id: string, shape: 'arrow' | 'circle' | 'cross') => ({ id, shape })
    const projected = marks.connector({
      id: 'all-marker-positions',
      role: 'edge',
      geometry: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 10, y: 0 }] },
      lineStyle: 'solid',
      paint: { stroke: '#111', strokeWidth: '1' },
      endpoints: { from: 'a', to: 'b' },
      markers: {
        start: marker('start', 'circle'),
        mid: [marker('middle', 'cross')],
        end: marker('end', 'arrow'),
      },
      labels: [{ id: 'label', text: 'relates' }],
    }, '<polyline points="0,0 5,2 10,0" />')
    expect(projected.terminalProjection).toMatchObject({
      direction: 'bidirectional',
      relationship: 'edge',
      topology: 'polyline',
      markers: {
        start: { id: 'start', shape: 'circle' },
        mid: [{ id: 'middle', shape: 'cross' }],
        end: { id: 'end', shape: 'arrow' },
      },
      labels: [{ id: 'label', text: 'relates' }],
    })
  })

  test('default is byte-exact while rough and hybrid consume typed stroke', () => {
    expect(DefaultBackend.drawNode(connector, { seed: 1 })).toBe(crisp)
    for (const backend of [RoughBackend, HybridBackend]) {
      const output = backend.drawNode(connector, {
        seed: 11,
        style: { name: 'look:connector-contract', stroke: backend === HybridBackend ? 'freehand' : 'jittered', strokeWidth: 1.5 },
      })
      expect(output).toContain('stroke-opacity="0"')
      expect(output).toContain('stroke="#00aa55"')
      expect(output).toContain('stroke-width="6"')
      expect(output).toContain('stroke-dasharray="9 2"')
      expect(output).toContain('stroke-dashoffset="0"')
      expect(output).toContain('stroke-opacity="0"')
      expect(output).toContain('stroke-linecap="square"')
      expect(output).toContain('stroke-linejoin="bevel"')
      expect(output).toContain('stroke-miterlimit="7"')
      expect(output).toContain('pathLength="40"')
      expect(output).toContain('paint-order="stroke fill"')
      expect(output).toContain('vector-effect="non-scaling-stroke"')
      expect(output).not.toContain('stroke-width="148.5"')
    }
  })

  test('visual bounds include typed stroke and marker projection', () => {
    const bounds = nodeWorldBounds(connector)
    expect(bounds).toBeDefined()
    // End marker radius is max(|bounds - ref|) * scale = 8 at x=10.
    expect(bounds).toEqual({ x0: -2, y0: -6, x1: 18, y1: 10 })
  })

  test('path points make tangents, mid-marker bounds, and hit testing total', () => {
    const path = marks.connector({
      id: 'typed-path',
      role: 'edge',
      geometry: {
        kind: 'path',
        d: 'M0,0 Q5,10 10,0',
        points: [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }],
      },
      lineStyle: 'solid',
      paint: { stroke: '#111', strokeWidth: '2' },
      markers: {
        mid: [{ id: 'mid', shape: 'circle', bounds: { x0: -10, y0: -10, x1: 10, y1: 10 } }],
      },
    }, '<path d="M0,0 Q5,10 10,0" stroke="#111" stroke-width="2" />')
    expect(path.route.startTangent).toEqual({ x: 0.4472135954999579, y: 0.8944271909999159 })
    expect(path.route.endTangent).toEqual({ x: 0.4472135954999579, y: -0.8944271909999159 })
    expect(nodeWorldBounds(path)).toEqual({ x0: -5, y0: -4, x1: 15, y1: 20 })
    expect(hitTestConnector(path, { x: 5, y: 10 })).toBe(true)
  })

  test('hit testing consumes typed route and stroke instead of crisp SVG', () => {
    expect(hitTestConnector(connector, { x: 5, y: 4.9 })).toBe(true)
    expect(hitTestConnector(connector, { x: 5, y: 6.1 })).toBe(false)
    const hits = hitTestSceneConnectors({
      family: 'test', width: 20, height: 20, colors: { bg: '#fff', fg: '#000' }, parts: [connector],
    }, { x: 5, y: 2 })
    expect(hits.map(hit => hit.id)).toEqual(['typed-id'])
    expect(hits[0]?.connector).toBe(connector)
  })

  test('rough marker projection reserializes typed resources without marker XML parsing', () => {
    const marker = {
      id: 'typed-resource', shape: 'arrow' as const,
      size: { width: 8, height: 5 }, ref: { x: 7, y: 2.5 }, orient: 'auto' as const,
      geometry: { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 8, y: 2.5 }, { x: 0, y: 5 }] },
      paint: { fill: '#111' },
    }
    const definitions = marks.definitions(
      { id: 'defs', markerResources: [marker] },
      `<defs>\n${serializeMarkerResource(marker)}\n</defs>`,
    )
    const output = RoughBackend.render({ family: 'test', width: 20, height: 20, colors: { bg: '#fff', fg: '#000' }, parts: [definitions] }, { seed: 1 })
    expect(output).toContain('markerUnits="userSpaceOnUse"')
    expect(output).toContain('points="0 0, 8 2.5, 0 5"')
  })

  test('typed marker serialization escapes attributes and rejects invalid geometry', () => {
    const hostile = serializeMarkerResource({
      id: 'arrow" onload="alert(1)', shape: 'arrow',
      size: { width: 8, height: 5 }, ref: { x: 7, y: 2.5 }, orient: 'auto',
      geometry: { kind: 'path', d: 'M0 0 L8 2.5 L0 5 Z' },
      paint: { fill: 'red" onclick="alert(2)' },
    })
    expect(hostile).not.toContain('id="arrow" onload=')
    expect(hostile).not.toContain('fill="red" onclick=')
    expect(hostile).toContain('&quot;')
    expect(() => serializeMarkerResource({
      id: 'bad', shape: 'arrow', size: { width: Number.NaN, height: 5 }, ref: { x: 0, y: 0 },
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 },
    })).toThrow('size must be positive')
  })
})

describe('role traits and primitive capabilities', () => {
  test('namespaced roles cannot acquire current or future core traits by local-name collision', () => {
    expect(resolveSceneRoleTraits('vendor:edge').source).toBe('namespaced-safe')
    expect(sceneRoleTraits('vendor:edge')).toMatchObject({ domIdentity: true, relation: false, sketch: 'none' })
    expect(sceneRoleTraits('vendor:edge')).not.toBe(sceneRoleTraits('edge'))
    expect(resolveSceneRoleTraits('vendor:sparkle').source).toBe('namespaced-safe')
    expect(sceneRoleTraits('vendor:sparkle')).toMatchObject({ domIdentity: true, relation: false, sketch: 'none' })
  })

  test('lossy/unsupported claims are explicit and duplicate claims are rejected', () => {
    expect(validatePrimitiveCapabilities([{
      target: 'terminal:unicode', primitive: 'connector', feature: 'markers',
      operation: 'terminal-project', realization: 'lossy', diagnostic: 'marker shape collapses to an arrow glyph',
    }]).valid).toBe(true)
    const invalid = validatePrimitiveCapabilities([
      { target: 'terminal:unicode', primitive: 'connector', feature: 'markers', operation: 'terminal-project', realization: 'unsupported' },
      { target: 'terminal:unicode', primitive: 'connector', feature: 'markers', operation: 'terminal-project', realization: 'native' },
    ])
    expect(invalid.valid).toBe(false)
    expect(invalid.diagnostics).toHaveLength(2)
  })

  test('graphical backend claims split connector stroke behavior and evidence every loss', () => {
    const claims = (backend: typeof RoughBackend) => new Map(
      backend.capabilities
        .filter(claim => claim.primitive === 'connector' && claim.operation === 'render')
        .map(claim => [claim.feature, claim]),
    )
    const rough = claims(RoughBackend)
    const hybrid = claims(HybridBackend)
    expect(rough.get('dash-offset')).toMatchObject({ realization: 'emulated', evidence: expect.any(String) })
    expect(rough.get('dash-restart')).toMatchObject({ realization: 'lossy', diagnostic: expect.any(String), evidence: expect.any(String) })
    expect(rough.get('stroke-cap')).toMatchObject({ realization: 'emulated', evidence: expect.any(String) })
    expect(hybrid.get('stroke-cap')).toMatchObject({ realization: 'lossy', diagnostic: expect.any(String), evidence: expect.any(String) })
    expect(hybrid.get('non-scaling-stroke')).toMatchObject({ realization: 'lossy', diagnostic: expect.any(String), evidence: expect.any(String) })
  })
})
