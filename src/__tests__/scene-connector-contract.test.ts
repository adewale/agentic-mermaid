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
import { validateSceneDoc } from '../scene/scene-validation.ts'
import { lowerGraphScene } from '../renderer.ts'

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
      markerPlacements: { start: [], mid: [], end: [{ markerId: 'typed-arrow', point: { x: 10, y: 2 }, contourIndex: 0 }] },
      endpoints: { from: 'typed-a', to: 'typed-b', start: { point: { x: 0, y: 2 } }, end: { point: { x: 10, y: 2 } } },
      route: { ownership: 'layout', closed: false, bendRadius: 3, labelAnchors: [{ x: 5, y: 0 }] },
      stroke: {
        color: '#00aa55', width: '4', opacity: 0, dash: { array: '9 2', offset: 0 },
        lineCap: 'square', lineJoin: 'bevel', miterLimit: 7, pathLength: 40,
        paintOrder: 'stroke fill', nonScaling: true,
      },
      hit: { geometry: { kind: 'line' }, closed: false, strokeWidth: 6, pointerEvents: 'stroke' },
      labels: [{ id: 'edge-label', text: 'ships', anchor: { x: 5, y: 0 }, halo: { width: 3 } }],
      lineStyle: 'dashed',
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
    for (const backend of [DefaultBackend, RoughBackend, HybridBackend]) {
      const output = backend.drawNode(projected, { seed: 7, style: { name: 'look:marker-projection', stroke: 'jittered' } })
      expect(output, backend.id).toContain('marker-start="url(#start)"')
      expect(output, backend.id).toContain('marker-mid="url(#middle)"')
      expect(output, backend.id).toContain('marker-end="url(#end)"')
    }
  })

  test('a built-in flowchart connector associates its separately emitted visual label', () => {
    const scene = lowerGraphScene({
      positioned: {
        width: 120,
        height: 60,
        nodes: [],
        groups: [],
        edges: [{
          source: 'A', target: 'B', label: 'ships', style: 'solid',
          hasArrowStart: false, hasArrowEnd: true,
          points: [{ x: 10, y: 30 }, { x: 110, y: 30 }],
          labelPosition: { x: 60, y: 24 },
        }],
      },
      colors: { bg: '#fff', fg: '#111' },
      resolved: { renderOptions: {} },
    })
    const edge = scene.parts.find(node => node.kind === 'connector')
    const labelGroup = scene.parts.find(node => node.kind === 'group' && node.role === 'edge-label')
    expect(edge?.kind).toBe('connector')
    expect(labelGroup?.kind).toBe('group')
    if (edge?.kind !== 'connector' || labelGroup?.kind !== 'group') return
    const text = labelGroup.children.map(child => child.node).find(node => node.kind === 'text')
    expect(text?.kind).toBe('text')
    if (text?.kind !== 'text') return
    expect(edge.labels).toEqual([expect.objectContaining({
      text: 'ships',
      anchor: { x: 60, y: 24 },
      paint: { fill: 'var(--_text-sec)' },
      fontSize: expect.any(Number),
      textAnchor: 'middle',
      visual: { kind: 'companion', markId: text.id },
    })])
    expect(edge.terminalProjection.labels[0]?.visual).toEqual({ kind: 'companion', markId: text.id })

    expect(validateSceneDoc(scene).valid).toBe(true)
    const edgeIndex = scene.parts.indexOf(edge)
    for (const [markId, message] of [
      ['missing-label', /unknown companion Text mark/],
      [edge.id, /must reference a Text mark/],
    ] as const) {
      const forged = {
        ...scene,
        parts: scene.parts.map((part, index) => index === edgeIndex
          ? {
              ...edge,
              labels: edge.labels.map(label => ({ ...label, visual: { kind: 'companion' as const, markId } })),
            }
          : part),
      }
      expect(validateSceneDoc(forged).diagnostics).toContainEqual(expect.objectContaining({
        code: 'SCENE_REFERENCE',
        path: `scene.parts[${edgeIndex}].labels[0].visual.markId`,
        message: expect.stringMatching(message),
      }))
    }

    const forgedRouteGeometry = {
      ...scene,
      parts: scene.parts.map((part, index) => index === edgeIndex
        ? { ...edge, route: { ...edge.route, geometry: { kind: 'line' as const, x1: 0, y1: 0, x2: 1, y2: 1 } } }
        : part),
    }
    expect(validateSceneDoc(forgedRouteGeometry).diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCENE_FIDELITY',
      path: `scene.parts[${edgeIndex}].route.geometry`,
    }))

    const forgedContourTangent = {
      ...scene,
      parts: scene.parts.map((part, index) => index === edgeIndex
        ? {
            ...edge,
            route: {
              ...edge.route,
              contours: edge.route.contours.map((contour, contourIndex) => contourIndex === 0
                ? { ...contour, startTangent: { x: 0, y: 1 } }
                : contour),
            },
          }
        : part),
    }
    expect(validateSceneDoc(forgedContourTangent).diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCENE_FIDELITY',
      path: `scene.parts[${edgeIndex}].route.contours[0].startTangent`,
      message: expect.stringMatching(/linear route geometry/),
    }))

    const forgedTerminalProjection = {
      ...scene,
      parts: scene.parts.map((part, index) => index === edgeIndex
        ? { ...edge, terminalProjection: { ...edge.terminalProjection, direction: 'reverse' as const } }
        : part),
    }
    expect(validateSceneDoc(forgedTerminalProjection).diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCENE_FIDELITY',
      path: `scene.parts[${edgeIndex}].terminalProjection`,
      message: expect.stringMatching(/canonical projection/),
    }))
    for (const backend of [DefaultBackend, RoughBackend, HybridBackend]) {
      expect(() => backend.render(forgedTerminalProjection, { seed: 0 }))
        .toThrow(/canonical projection/)
    }
  })

  test('rejects mid-marker configurations a single SVG carrier cannot realize', () => {
    const base = {
      id: 'invalid-mid-markers',
      role: 'edge' as const,
      geometry: { kind: 'polyline' as const, points: [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 8, y: 2 }, { x: 10, y: 0 }] },
      lineStyle: 'solid' as const,
      paint: { stroke: '#111', strokeWidth: '1' },
    }
    expect(() => marks.connector({
      ...base,
      markers: { mid: [{ id: 'one', shape: 'circle' }, { id: 'two', shape: 'cross' }] },
    }, '<polyline points="0,0 5,2 8,2 10,0" />')).toThrow('distinct mid markers')
    expect(() => marks.connector({
      ...base,
      markers: { mid: [{ id: 'one', shape: 'circle' }, { id: 'one', shape: 'circle' }, { id: 'one', shape: 'circle' }] },
    }, '<polyline points="0,0 5,2 8,2 10,0" />')).toThrow('one repeated descriptor or one descriptor per interior route point')
  })

  test('default preserves the canonical semantic carrier while rough and hybrid consume typed stroke', () => {
    expect(DefaultBackend.drawNode(connector, { seed: 1 })).toBe(connector.crisp)
    expect(connector.crisp).toContain('data-relationship="dependency"')
    expect(connector.crisp).toContain('data-direction="forward"')
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

  test('path marker bounds fall back to size and SVG default strokeWidth units', () => {
    const sizedPathMarker = {
      id: 'sized-path-marker', shape: 'arrow' as const,
      geometry: { kind: 'path' as const, d: 'M0 0 L8 3 L0 6 Z' },
      size: { width: 8, height: 6 }, ref: { x: 8, y: 3 },
    }
    const node = marks.connector({
      id: 'marker-size-bounds', role: 'edge',
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      lineStyle: 'solid', paint: { stroke: '#111', strokeWidth: '2' },
      markers: { end: sizedPathMarker },
    }, '<line x1="0" y1="0" x2="10" y2="0" stroke="#111" stroke-width="2" />')
    // The 0..8 viewport is radius 8 around refX=8, then scales by width 2.
    expect(nodeWorldBounds(node)).toEqual({ x0: -6, y0: -16, x1: 26, y1: 16 })
    expect(() => marks.connector({
      id: 'unbounded-path-marker', role: 'edge',
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      lineStyle: 'solid', paint: { stroke: '#111', strokeWidth: '2' },
      markers: { end: { id: 'unbounded', shape: 'arrow', geometry: { kind: 'path', d: 'M0 0 L8 3 L0 6 Z' } } },
    }, '<line x1="0" y1="0" x2="10" y2="0" stroke="#111" stroke-width="2" />')).toThrow(/requires bounds, viewBox, or size/)
  })

  test('inline connector label halo defaults to the canonical page background variable', () => {
    const node = marks.connector({
      id: 'inline-label-halo', role: 'edge',
      geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      lineStyle: 'solid', paint: { stroke: '#111', strokeWidth: '1' },
      labels: [{
        text: 'label', anchor: { x: 5, y: 0 }, paint: { fill: '#111' },
        fontSize: 10, textAnchor: 'middle', halo: { width: 3 }, visual: { kind: 'inline' },
      }],
    }, '<line x1="0" y1="0" x2="10" y2="0" stroke="#111" stroke-width="1" />')
    expect(node.crisp).toContain('stroke="var(--bg)"')
    expect(node.crisp).not.toContain('var(--_bg)')
  })

  test('path route points and exact marker vertices keep independent semantics', () => {
    expect(() => marks.connector({
      id: 'ambiguous-path-mid-marker',
      role: 'edge',
      geometry: {
        kind: 'path',
        d: 'M0,0 Q5,10 10,0',
        points: [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }],
      },
      lineStyle: 'solid',
      paint: { stroke: '#111', strokeWidth: '2' },
      markers: { mid: [{ id: 'mid', shape: 'circle' }] },
    }, '<path d="M0,0 Q5,10 10,0" stroke="#111" stroke-width="2" />')).toThrow('no typed interior route points')

    const path = marks.connector({
      id: 'typed-path',
      role: 'edge',
      geometry: {
        kind: 'path',
        d: 'M0,0 Q5,10 10,0 L15,5',
        points: [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, { x: 15, y: 5 }],
        markerMidpoints: [{ x: 10, y: 0 }],
      },
      lineStyle: 'solid',
      paint: { stroke: '#111', strokeWidth: '2' },
      markers: {
        mid: [{ id: 'mid', shape: 'circle', bounds: { x0: -10, y0: -10, x1: 10, y1: 10 } }],
      },
    }, '<path d="M0,0 Q5,10 10,0 L15,5" stroke="#111" stroke-width="2" />')
    expect(path.route.startTangent).toEqual({ x: 0.4472135954999579, y: 0.8944271909999159 })
    expect(path.route.endTangent).toEqual({ x: 0.7071067811865475, y: 0.7071067811865475 })
    expect(path.terminalProjection.markerPlacements.mid).toEqual([
      { markerId: 'mid', point: { x: 10, y: 0 }, contourIndex: 0 },
    ])
    // The quadratic control/routing point at (5,10) is not an SVG marker
    // vertex; only the exact marker midpoint at (10,0) expands marker bounds.
    // Omitted markerUnits has SVG's strokeWidth semantics, so the 20×20
    // marker bounds scale by the connector's authored width of 2.
    expect(nodeWorldBounds(path)).toEqual({ x0: -10, y0: -20, x1: 30, y1: 20 })
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

  test('rough marker projection preserves the shared authored marker-unit authority', () => {
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
    const colors = { bg: '#fff', fg: '#000' }
    const root = marks.prelude({
      id: 'typed-marker-root', width: 20, height: 20, colors,
      transparent: true, font: 'Inter', hasMonoFont: false,
    }, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">')
    const output = RoughBackend.render({
      family: 'test', width: 20, height: 20, colors,
      parts: [root, definitions, marks.documentClose()],
    }, { seed: 1 })
    expect(output).not.toContain('markerUnits=')
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
    for (const feature of ['geometry', 'topology'] as const) {
      expect(rough.get(feature)).toMatchObject({ realization: 'lossy', diagnostic: expect.any(String), evidence: expect.any(String) })
      expect(hybrid.get(feature)).toMatchObject({ realization: 'lossy', diagnostic: expect.any(String), evidence: expect.any(String) })
    }
    expect(rough.get('dash-offset')).toMatchObject({ realization: 'emulated', evidence: expect.any(String) })
    expect(rough.get('dash-restart')).toMatchObject({ realization: 'lossy', diagnostic: expect.any(String), evidence: expect.any(String) })
    expect(rough.get('stroke-cap')).toMatchObject({ realization: 'emulated', evidence: expect.any(String) })
    expect(hybrid.get('stroke-cap')).toMatchObject({ realization: 'lossy', diagnostic: expect.any(String), evidence: expect.any(String) })
    expect(hybrid.get('non-scaling-stroke')).toMatchObject({ realization: 'lossy', diagnostic: expect.any(String), evidence: expect.any(String) })
  })
})
