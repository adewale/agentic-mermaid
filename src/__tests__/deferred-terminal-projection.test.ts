import { describe, expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { deriveConnectorTerminalProjection } from '../scene/connector-terminal.ts'
import { deferredTerminalProjectionInput, withDeferredTerminalProjections } from '../scene/deferred-terminal-projection.ts'
import { EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, freezeBoundedFirstPartyData, snapshotBoundedExternalData } from '../scene/external-data-snapshot.ts'
import { admitFamilyScene } from '../scene/admission.ts'
import { getFamily } from '../agent/families.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { serializeMarkerResources } from '../scene/marker-resources.ts'
import type { ConnectorMark, SceneDoc } from '../scene/ir.ts'

function edge(id = 'message'): ConnectorMark {
  return marks.connector({
    id, role: 'message',
    geometry: { kind: 'line', x1: 10, y1: 20, x2: 90, y2: 20 },
    lineStyle: 'dashed', paint: { stroke: '#111', strokeDasharray: '4 2' },
    endpoints: { from: 'a', to: 'b' },
    terminalProjection: { diagnostics: ['Preserved diagnostic'] },
  })
}

describe('deferred terminal projection', () => {
  test('stays deferred through built-in admission, group ownership and SVG serialization', () => {
    const original = withDeferredTerminalProjections(edge)
    expect(deferredTerminalProjectionInput(original)).toBeDefined()
    const group = marks.group({ id: 'messages', role: 'message', open: '<g>', close: '</g>', children: [{ node: original, indent: 2 }] })
    const retained = group.children[0]!.node as ConnectorMark
    expect(deferredTerminalProjectionInput(retained)).toBeDefined()
    const colors = { bg: '#fff', fg: '#111' }
    const doc: SceneDoc = {
      family: 'sequence', width: 100, height: 50, colors, transparent: false,
      parts: [marks.documentOpen({ id: 'prelude', width: 100, height: 50, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">'), group, marks.documentClose()],
    }
    expect(admitFamilyScene(getFamily('sequence')!, doc, false)).toBe(doc)
    expect(Object.isFrozen(retained)).toBe(true)
    expect(Object.isFrozen(retained.route)).toBe(true)
    expect(Object.keys(retained)).toContain('terminalProjection')
    expect(Object.getOwnPropertyDescriptor(retained, 'terminalProjection')?.enumerable).toBe(true)
    expect(sceneNodeSerialization(group)).toContain('<line')
    expect(deferredTerminalProjectionInput(retained)).toBeDefined()
    const expected = deriveConnectorTerminalProjection({
      geometry: retained.route.geometry, lineStyle: retained.lineStyle, endpoints: retained.endpoints,
      relationship: retained.relationship, route: retained.route, stroke: retained.stroke,
      markers: retained.markers, labels: retained.labels, hit: retained.hit,
      additionalDiagnostics: ['Preserved diagnostic'],
    })
    const projection = retained.terminalProjection
    expect(projection).toEqual(expected)
    expect(retained.terminalProjection).toBe(projection)
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.route.contours[0])).toBe(true)
    expect(Object.isFrozen(projection.diagnostics)).toBe(true)
    expect(() => { retained.terminalProjection = expected }).toThrow(/readonly/)
  })

  test('keeps a large connector batch deferred through admission and freezes later projections', () => {
    const group = marks.group({
      id: 'messages', role: 'message', open: '<g>', close: '</g>',
      children: Array.from({ length: 400 }, (_, index) => ({
        indent: 2, node: withDeferredTerminalProjections(() => edge(`message:${index}`)),
      })),
    })
    const nodes = group.children.map(child => child.node as ConnectorMark)
    const colors = { bg: '#fff', fg: '#111' }
    const doc: SceneDoc = {
      family: 'sequence', width: 100, height: 50, colors, transparent: false,
      parts: [marks.documentOpen({ id: 'prelude', width: 100, height: 50, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">'), group, marks.documentClose()],
    }
    admitFamilyScene(getFamily('sequence')!, doc, false)
    const svg = sceneNodeSerialization(group)
    expect(nodes.every(node => deferredTerminalProjectionInput(node) !== undefined)).toBe(true)
    expect(svg).toContain('data-id="message:0"')
    expect(svg).toContain('data-id="message:399"')
    for (const node of [nodes[0]!, nodes.at(-1)!]) {
      const projection = node.terminalProjection
      expect(projection.endpoints.from).toBe('a')
      expect(projection.endpoints.to).toBe('b')
      expect(projection.geometry).toBe(node.route.geometry)
      expect(projection.diagnostics.at(-1)).toBe('Preserved diagnostic')
      expect(Object.isFrozen(projection)).toBe(true)
      expect(Object.isFrozen(projection.route.contours[0])).toBe(true)
      expect(Object.isFrozen(projection.diagnostics)).toBe(true)
      expect(node.terminalProjection).toBe(projection)
    }
    expect(deferredTerminalProjectionInput(nodes[1]!)).toBeDefined()
    expect(sceneNodeSerialization(group)).toBe(svg)
  })

  test.each([
    ['maxObjects', 1500],
    ['maxTextBytes', 60_000],
    ['maxAggregateArrayEntries', 700],
    ['maxAggregateProperties', 5000],
    ['maxAggregatePropertyKeyBytes', 100_000],
  ] as const)('reconciles projections under %s pressure while retaining unused deferred projections', (field, bound) => {
    const group = marks.group({
      id: 'messages', role: 'message', open: '<g>', close: '</g>',
      children: Array.from({ length: 12 }, (_, index) => ({
        indent: 2, node: withDeferredTerminalProjections(() => edge(`message:${index}`)),
      })),
    })
    const nodes = group.children.map(child => child.node as ConnectorMark)
    const svg = sceneNodeSerialization(group)
    freezeBoundedFirstPartyData(group, { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, [field]: bound })
    const pending = nodes.filter(node => deferredTerminalProjectionInput(node) !== undefined)
    expect(pending.length).toBeGreaterThan(0)
    expect(deferredTerminalProjectionInput(nodes[0]!)).toBeUndefined()
    expect(deferredTerminalProjectionInput(nodes.at(-1)!)).toBeUndefined()
    expect(sceneNodeSerialization(group)).toBe(svg)
    for (const node of [nodes[0]!, pending.at(-1)!, nodes.at(-1)!]) {
      const projection = node.terminalProjection
      expect(projection.endpoints).toEqual(node.endpoints)
      expect(projection.geometry).toBe(node.route.geometry)
      expect(projection.diagnostics.at(-1)).toBe('Preserved diagnostic')
      expect(Object.isFrozen(node)).toBe(true)
      expect(Object.isFrozen(projection)).toBe(true)
      expect(Object.isFrozen(projection.route.contours[0]!.start)).toBe(true)
      expect(Object.isFrozen(projection.diagnostics)).toBe(true)
      expect(node.terminalProjection).toBe(projection)
      expect(() => { node.terminalProjection = projection }).toThrow(/readonly/)
    }
    expect(sceneNodeSerialization(group)).toBe(svg)
  })

  test.each([
    ['array entries', { maxAggregateArrayEntries: 1000 }, () => new Array(500).fill(0)],
    ['text bytes', { maxTextBytes: 100_000 }, () => 'x'.repeat(15_000)],
  ] as const)('makes room before charging a large later increment of %s', (_name, constrained, tail) => {
    const nodes = Array.from({ length: 6 }, (_, index) => withDeferredTerminalProjections(() => edge(`message:${index}`)))
    const value = { nodes, tail: tail() }
    expect(freezeBoundedFirstPartyData(value, { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, ...constrained })).toBe(value)
    expect(deferredTerminalProjectionInput(nodes[0]!)).toBeUndefined()
    expect(deferredTerminalProjectionInput(nodes.at(-1)!)).toBeDefined()
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.tail)).toBe(true)
  })

  test('preserves eager depth rejection when later projections reach their original property position', () => {
    const make = (defer: boolean) => {
      const lower = () => {
        const nodes = Array.from({ length: 6 }, (_, index) => edge(`message:${index}`))
        let nested: Record<string, unknown> = {}
        for (let index = 0; index < 16; index++) nested = { next: nested }
        const transform = { kind: 'rotate' as const, angle: 0, cx: 0, cy: 0, nested }
        nodes.push(marks.connector({
          id: 'deep-transform', role: 'message', transform,
          geometry: { kind: 'line', x1: 10, y1: 20, x2: 90, y2: 20 },
          lineStyle: 'solid', paint: {},
        }))
        return { nodes }
      }
      return defer ? withDeferredTerminalProjections(lower) : lower()
    }
    const limits = { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, maxObjects: 1500, maxDepth: 20 }
    // The retained nested value reaches depth 21 through the projection,
    // before the shallower public transform can mark it as already visited.
    for (const defer of [false, true]) {
      expect(() => freezeBoundedFirstPartyData(make(defer), limits)).toThrow('External Scene input object graph is too deeply nested')
    }
  })

  test('keeps direct constructors and path validation eager and restores scope after a failure', () => {
    expect(deferredTerminalProjectionInput(edge())).toBeUndefined()
    expect(() => withDeferredTerminalProjections(() => { throw new Error('lowering failed') })).toThrow('lowering failed')
    expect(deferredTerminalProjectionInput(edge())).toBeUndefined()
    const path = withDeferredTerminalProjections(() => marks.connector({
      id: 'path', role: 'edge', geometry: { kind: 'path', d: 'M0 0 L1 1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      lineStyle: 'solid', paint: {},
    }))
    expect(deferredTerminalProjectionInput(path)).toBeUndefined()
  })

  test('captures diagnostics before the source array can change', () => {
    const diagnostics = ['Original']
    const node = withDeferredTerminalProjections(() => marks.connector({ id: 'e', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }, lineStyle: 'solid', paint: {}, terminalProjection: { diagnostics } }))
    diagnostics[0] = 'Changed'
    freezeBoundedFirstPartyData(node, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS)
    expect(node.terminalProjection.diagnostics.at(-1)).toBe('Original')
  })

  test('materializes the admitted own-data capture despite later prototype fields and getters', () => {
    const arrow = {
      id: 'arrow', shape: 'arrow' as const, size: { width: 8, height: 5 }, ref: { x: 7, y: 2.5 },
      geometry: { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 8, y: 2.5 }, { x: 0, y: 5 }] },
    }
    const nodes = [false, true].map(dashed => withDeferredTerminalProjections(() => marks.connector({
      id: dashed ? 'dashed-message' : 'plain-message', role: 'message',
      // A degenerate route also leaves contour/route tangents absent.
      geometry: { kind: 'line', x1: 20, y1: 20, x2: 20, y2: 20 },
      lineStyle: dashed ? 'dashed' : 'solid',
      paint: { stroke: '#111', ...(dashed ? { strokeDasharray: '4 2' } : {}) },
      markers: { end: arrow }, labels: [{ text: 'Kept' }],
    })))
    const colors = { bg: '#fff', fg: '#111' }
    const doc: SceneDoc = { family: 'sequence', width: 100, height: 50, colors, transparent: false, parts: [
      marks.documentOpen({ id: 'prelude', width: 100, height: 50, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">'),
      marks.definitions({ id: 'defs', markerResources: [arrow] }, `<defs>${serializeMarkerResources([arrow])}</defs>`),
      ...nodes, marks.documentClose(),
    ] }
    admitFamilyScene(getFamily('sequence')!, doc, false)
    const expected = nodes.map(node => deriveConnectorTerminalProjection(deferredTerminalProjectionInput(node)!))
    const expectedJson = JSON.stringify(expected)
    const expectedSvg = doc.parts.map(sceneNodeSerialization).join('\n')
    const injected: Record<string, unknown> = {
      projection: { unexpected: true }, transform: { kind: 'translate', x: 99, y: 99 },
      dash: { array: '999', offset: 99 }, start: { id: 'foreign-start', shape: 'circle' }, end: { id: 'foreign-end', shape: 'circle' },
      anchor: { x: 99, y: 99 }, owner: { id: 'foreign-owner', role: 'node' }, point: { x: 99, y: 99 },
      startTangent: { x: 0, y: 1 }, endTangent: { x: 0, y: 1 },
      geometry: { kind: 'circle', cx: 99, cy: 99, r: 99 }, size: { width: 99, height: 99 },
      viewBox: { x: 0, y: 0, width: 99, height: 99 }, ref: { x: 99, y: 99 }, bounds: { x0: 0, y0: 0, x1: 99, y1: 99 },
      paint: { fill: 'red' }, halo: { width: 99 }, visual: { kind: 'inline' },
      opacity: 0.2, offset: 99, pathLength: 99, paintOrder: 'markers stroke fill', mixBlendMode: 'multiply', nonScaling: true,
      additionalDiagnostics: ['Added after admission'],
    }
    const prior = new Map(Object.keys(injected).map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]))
    let inheritedReads = 0
    let pending = false
    let actual: ReturnType<typeof deriveConnectorTerminalProjection>[] = []
    let actualJson = '', actualSvg = ''
    try {
      for (const key of Object.keys(injected)) Object.defineProperty(Object.prototype, key, {
        configurable: true,
        get() { inheritedReads++; return injected[key] },
      })
      pending = nodes.every(node => deferredTerminalProjectionInput(node) !== undefined)
      actual = nodes.map(node => node.terminalProjection)
      actualJson = JSON.stringify(actual)
      actualSvg = doc.parts.map(sceneNodeSerialization).join('\n')
    } finally {
      for (const [key, descriptor] of prior) {
        if (descriptor) Object.defineProperty(Object.prototype, key, descriptor)
        else Reflect.deleteProperty(Object.prototype, key)
      }
    }
    expect(pending).toBe(true)
    expect(inheritedReads).toBe(0)
    expect(actualJson).toBe(expectedJson)
    expect(actualSvg).toBe(expectedSvg)
    expect(actual).toEqual(expected)
    for (let index = 0; index < nodes.length; index++) {
      const projection = actual[index]!, node = nodes[index]!
      expect(Object.isFrozen(projection)).toBe(true)
      expect(projection.geometry).toBe(node.route.geometry)
      expect(projection.hit.geometry).toBe(node.hit.geometry)
      expect(projection.markers.end).not.toBe(node.markers.end)
      expect(Object.hasOwn(projection, 'transform')).toBe(false)
      expect(Object.hasOwn(projection.endpoints.start!, 'owner')).toBe(false)
      expect(Object.hasOwn(projection.labels[0]!, 'anchor')).toBe(false)
    }
    // No introduced prototype value became an owned/frozen projection field.
    for (const value of Object.values(injected)) if (value !== null && typeof value === 'object') expect(Object.isFrozen(value)).toBe(false)
  })

  test('external snapshots materialize only registered getters and never invoke a borrowed getter', () => {
    const node = withDeferredTerminalProjections(edge)
    const descriptor = Object.getOwnPropertyDescriptor(node, 'terminalProjection')!
    const forged = {}
    Object.defineProperty(forged, 'terminalProjection', descriptor)
    expect(() => snapshotBoundedExternalData(forged, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS)).toThrow(/enumerable data property/)
    expect(deferredTerminalProjectionInput(node)).toBeDefined()
    const snapshot = snapshotBoundedExternalData(node, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS) as ConnectorMark
    expect(snapshot.terminalProjection).toEqual(node.terminalProjection)
    expect(Object.getOwnPropertyDescriptor(snapshot, 'terminalProjection')).toHaveProperty('value')
    expect(Object.isFrozen(snapshot.terminalProjection)).toBe(true)
  })

  test('every resource cap falls back to exact accounting with the same acceptance and diagnostic', () => {
    const limits = EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS
    const unicodeEdge = (): ConnectorMark => marks.connector({
      id: 'unicode-keys', role: 'edge', lineStyle: 'solid', paint: {},
      geometry: { kind: 'polyline', points: [
        { x: 0, y: 0, ['é'.repeat(20)]: 1, ['漢'.repeat(20)]: 2 },
        { x: 1, y: 1, ['😀'.repeat(20)]: 3, ['\ud800'.repeat(20)]: 4 },
        { x: 2, y: 0, ['\udc00'.repeat(20)]: 5 },
      ] },
      markers: {
        start: { id: 'start', shape: 'circle' },
        mid: [{ id: 'middle', shape: 'circle' }],
        end: { id: 'end', shape: 'circle' },
      },
    })
    const placementFields = new Set<keyof typeof limits>(['maxObjects', 'maxAggregateProperties', 'maxAggregateArrayEntries', 'maxAggregatePropertyKeyBytes'])
    const batch = () => ({
      nodes: Array.from({ length: 6 }, (_, index) => edge(`message:${index}`)),
      // The late ASCII value exhausts every pending text reservation before
      // exact UTF-8 accounting decides acceptance or the original diagnostic.
      tail: 'x'.repeat(20_000),
    })
    for (const field of Object.keys(limits) as Array<keyof typeof limits>) {
      const constructors: Array<() => unknown> = placementFields.has(field) ? [edge, unicodeEdge, batch] : field === 'maxTextBytes' ? [edge, batch] : [edge]
      const bounds = field === 'maxAggregatePropertyKeyBytes' ? [0, 1, 5, 24, 100, 1000, 4000, 64_000]
        : field === 'maxTextBytes' ? [0, 1, 5, 24, 100, 1000, 20_000, 30_000] : [0, 1, 5, 24, 100, 1000]
      for (const make of constructors) {
        for (const bound of bounds) {
          const constrained = { ...limits, [field]: bound }
          const outcome = (defer: boolean): string => {
            try {
              const node = defer ? withDeferredTerminalProjections(make) : make()
              freezeBoundedFirstPartyData(node, constrained, 'scene')
              return 'accepted'
            } catch (error) { return error instanceof Error ? error.message : String(error) }
          }
          expect(outcome(true), `${field}=${bound}, ${make.name}`).toBe(outcome(false))
        }
      }
    }
  })

  test('charges repeated marker identifiers at every polyline vertex before returning', () => {
    const make = () => marks.connector({
      id: 'many-midpoints', role: 'edge',
      geometry: { kind: 'polyline', points: Array.from({ length: 1000 }, (_, x) => ({ x, y: 0 })) },
      lineStyle: 'solid', paint: {}, markers: { mid: [{ id: 'm'.repeat(1000), shape: 'circle' }] },
    })
    const limits = { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, maxTextBytes: 500_000 }
    expect(() => freezeBoundedFirstPartyData(make(), limits)).toThrow(/text values exceed/)
    expect(() => freezeBoundedFirstPartyData(withDeferredTerminalProjections(make), limits)).toThrow(/text values exceed/)
  })
})
