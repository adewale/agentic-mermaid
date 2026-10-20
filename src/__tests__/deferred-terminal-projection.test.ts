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

function edge(): ConnectorMark {
  return marks.connector({
    id: 'message', role: 'message',
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
    for (const field of Object.keys(limits) as Array<keyof typeof limits>) {
      for (const bound of [0, 1, 5, 24, 100, 1000]) {
        const constrained = { ...limits, [field]: bound }
        const outcome = (defer: boolean): string => {
          try {
            const node = defer ? withDeferredTerminalProjections(edge) : edge()
            freezeBoundedFirstPartyData(node, constrained, 'scene')
            return 'accepted'
          } catch (error) { return error instanceof Error ? error.message : String(error) }
        }
        expect(outcome(true), `${field}=${bound}`).toBe(outcome(false))
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
