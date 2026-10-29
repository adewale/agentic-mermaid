import { describe, expect, spyOn, test } from 'bun:test'

import { lowerArchitectureScene } from '../architecture/renderer.ts'
import { DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import { lowerClassScene } from '../class/renderer.ts'
import { lowerBlockScene } from '../block/renderer.ts'
import { layoutBlockDiagram } from '../block/layout.ts'
import { parseBlockDiagram } from '../block/parser.ts'
import { lowerErScene } from '../er/renderer.ts'
import { lowerJourneyScene } from '../journey/renderer.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { preprocessMermaidLines } from '../mermaid-source.ts'
import { lowerGraphScene } from '../renderer.ts'
import * as marks from '../scene/marks.ts'
import { connectorMarkerPaintRegions, nodeWorldBounds } from '../scene/bounds.ts'
import * as serialization from '../scene/serialization.ts'
import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedEdge } from '../types.ts'
import { projectConnectorPath } from '../scene/connector-geometry.ts'
import { hitTestConnector } from '../scene/hit-test.ts'
import type { ConnectorMark, SceneDoc, ScenePoint } from '../scene/ir.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'

const COLORS = { bg: '#ffffff', fg: '#111827' } as const
const RIGHT_ANGLE_POINTS = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
]
const ROUNDED_D = 'M0,0 L80,0 Q100,0 100,20 L100,100'
const ROUNDED_MIDPOINT = { x: 95, y: 5 }

function connectors(doc: SceneDoc): ConnectorMark[] {
  const found: ConnectorMark[] = []
  const visit = (node: SceneDoc['parts'][number]): void => {
    if (node.kind === 'connector') found.push(node)
    if (node.kind === 'group') for (const child of node.children) visit(child.node)
  }
  for (const part of doc.parts) visit(part)
  return found
}

function onlyConnector(doc: SceneDoc): ConnectorMark {
  const found = connectors(doc).filter(connector => connector.role !== 'chrome')
  expect(found).toHaveLength(1)
  return found[0]!
}

test.each([
  { name: 'straight arrows', radius: 0, marker: 'arrow', thick: false, fixed: false, curve: false },
  { name: 'rounded circles', radius: 20, marker: 'circle', thick: true, fixed: false, curve: false },
  { name: 'fixed rounded crosses', radius: 20, marker: 'cross', thick: false, fixed: true, curve: false },
  { name: 'fixed cubic arrows', radius: 0, marker: 'arrow', thick: false, fixed: true, curve: true },
  { name: 'cubic circles', radius: 0, marker: 'circle', thick: true, fixed: false, curve: true },
] as const)('layout marker queries match lowered $name without admitting discarded Scene nodes', row => {
  const edge: PositionedEdge = {
    source: 'A', target: 'B', style: row.thick ? 'thick' : 'solid',
    hasArrowStart: true, hasArrowEnd: true, startMarker: row.marker, endMarker: row.marker,
    points: RIGHT_ANGLE_POINTS.map(point => ({ ...point })),
    ...(row.fixed ? { inlineStyle: { stroke: 'rgb(20, 40, 60)', 'stroke-width': '4px' } } : {}),
    ...(row.curve ? { curve: 'natural' as const } : {}),
  }
  const styleFace = { edge: { lineWidth: 3, bendRadius: row.radius } }
  const mark = onlyConnector(lowerGraphScene({
    positioned: { width: 120, height: 120, nodes: [], groups: [], edges: [edge] },
    colors: COLORS, resolved: { renderOptions: {}, styleFace },
  }))
  const expected = connectorMarkerPaintRegions(mark)
  expect(expected).toHaveLength(2)
  const admission = spyOn(serialization, 'admitWritableSceneNode')
  try {
    const actual = graphEdgeMarkerPaintRegions(edge, resolveRenderStyle({}, undefined, styleFace))
    expect(actual).toEqual(expected)
    expect(admission).not.toHaveBeenCalled()
  } finally { admission.mockRestore() }
})

function pointToSegmentDistance(point: ScenePoint, start: ScenePoint, end: ScenePoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const squaredLength = dx * dx + dy * dy
  const t = squaredLength === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength))
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t))
}

function pointToRouteDistance(point: ScenePoint, route: readonly ScenePoint[]): number {
  let minimum = Number.POSITIVE_INFINITY
  for (let index = 1; index < route.length; index++) {
    minimum = Math.min(minimum, pointToSegmentDistance(point, route[index - 1]!, route[index]!))
  }
  return minimum
}

function assertRoundedProjection(connector: ConnectorMark, offset = 0): void {
  const route = RIGHT_ANGLE_POINTS.map(point => ({ x: point.x + offset, y: point.y + offset }))
  const midpoint = { x: ROUNDED_MIDPOINT.x + offset, y: ROUNDED_MIDPOINT.y + offset }
  expect(connector.route.geometry.kind).toBe('path')
  if (connector.route.geometry.kind !== 'path') return
  if (offset === 0) expect(connector.route.geometry.d).toBe(ROUNDED_D)
  // Inspect the actual M/L/Q spelling independently of the curve projector.
  // Endpoint legs and both sides of the quadratic join must stay cardinal.
  const emitted = /\bd="([^"]*)"/.exec(sceneNodeSerialization(connector))![1]!
  const values = emitted.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)!.map(Number)
  expect(emitted.match(/[MLQ]/g)).toEqual(['M', 'L', 'Q', 'L'])
  expect(values).toHaveLength(10)
  expect(values[0]).toBeCloseTo(route[0]!.x, 9)
  expect(values[1]).toBeCloseTo(route[0]!.y, 9)
  expect(values[8]).toBeCloseTo(route[2]!.x, 9)
  expect(values[9]).toBeCloseTo(route[2]!.y, 9)
  expect(values[3]).toBe(values[1])
  expect(values[5]).toBe(values[3])
  expect(values[6]).toBe(values[4])
  expect(values[8]).toBe(values[6])
  expect(values[2]).toBeGreaterThan(values[0]!)
  expect(values[4]).toBeGreaterThan(values[2]!)
  expect(values[7]).toBeGreaterThan(values[5]!)
  expect(values[9]).toBeGreaterThan(values[7]!)
  expect(connector.route.geometry.points.length).toBeGreaterThan(RIGHT_ANGLE_POINTS.length)
  expect(connector.route.geometry.points.some(point =>
    Math.hypot(point.x - midpoint.x, point.y - midpoint.y) < 1e-9)).toBe(true)
  expect(pointToRouteDistance(midpoint, route))
    .toBeGreaterThan(connector.hit.strokeWidth / 2)
  expect(hitTestConnector(connector, midpoint)).toBe(true)
  expect(connector.route.contours).toEqual([{
    start: route[0]!,
    end: route[2]!,
    closed: false,
    startTangent: { x: 1, y: 0 },
    endTangent: { x: 0, y: 1 },
  }])
  expect(connector.route.startTangent).toEqual({ x: 1, y: 0 })
  expect(connector.route.endTangent).toEqual({ x: 0, y: 1 })
  expect(connector.hit.geometry).toBe(connector.route.geometry)
  expect(connector.terminalProjection.geometry).toBe(connector.route.geometry)
  if (offset === 0) expect(sceneNodeSerialization(connector)).toContain(`d="${ROUNDED_D}"`)
}

interface Cubic {
  start: ScenePoint
  control1: ScenePoint
  control2: ScenePoint
  end: ScenePoint
}

function firstCubic(d: string): Cubic {
  const values = d.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
  if (values.length < 8 || !/[Cc]/.test(d)) throw new Error(`Expected a cubic path, received: ${d}`)
  return {
    start: { x: values[0]!, y: values[1]! },
    control1: { x: values[2]!, y: values[3]! },
    control2: { x: values[4]!, y: values[5]! },
    end: { x: values[6]!, y: values[7]! },
  }
}

function cubicPoint(cubic: Cubic, t: number): ScenePoint {
  const u = 1 - t
  return {
    x: u ** 3 * cubic.start.x
      + 3 * u ** 2 * t * cubic.control1.x
      + 3 * u * t ** 2 * cubic.control2.x
      + t ** 3 * cubic.end.x,
    y: u ** 3 * cubic.start.y
      + 3 * u ** 2 * t * cubic.control1.y
      + 3 * u * t ** 2 * cubic.control2.y
      + t ** 3 * cubic.end.y,
  }
}

function unit(from: ScenePoint, to: ScenePoint): ScenePoint {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

function assertCubicProjection(connector: ConnectorMark, oldRoute: readonly ScenePoint[]): void {
  expect(connector.route.geometry.kind).toBe('path')
  if (connector.route.geometry.kind !== 'path') return
  const cubic = firstCubic(connector.route.geometry.d)
  const visiblePoint = cubicPoint(cubic, 0.25)
  expect(connector.route.geometry.points.length).toBeGreaterThan(oldRoute.length)
  expect(pointToRouteDistance(visiblePoint, oldRoute)).toBeGreaterThan(connector.hit.strokeWidth / 2)
  expect(hitTestConnector(connector, visiblePoint)).toBe(true)
  expect(connector.route.startTangent).toEqual(unit(cubic.start, cubic.control1))
  expect(connector.route.endTangent).toEqual(unit(cubic.control2, cubic.end))
  expect(connector.route.contours).toEqual([{
    start: cubic.start,
    end: cubic.end,
    closed: false,
    startTangent: unit(cubic.start, cubic.control1),
    endTangent: unit(cubic.control2, cubic.end),
  }])
  expect(connector.hit.geometry).toBe(connector.route.geometry)
  expect(connector.terminalProjection.geometry).toBe(connector.route.geometry)
  expect(sceneNodeSerialization(connector)).toContain(`d="${connector.route.geometry.d}"`)
}

describe('curved connector lowering projections', () => {
  test('adaptive projection preserves cubic extrema outside the waypoint chord for bounds and hits', () => {
    const start = { x: 0, y: 0 }
    const control1 = { x: 120, y: 0 }
    const control2 = { x: -80, y: 0 }
    const end = { x: 20, y: 0 }
    const d = 'M0,0 C120,0 -80,0 20,0'
    const projection = projectConnectorPath(d, start, [{ kind: 'cubic', control1, control2, end }])
    const connector = marks.connector({
      id: 'double-back',
      role: 'edge',
      geometry: projection.geometry,
      lineStyle: 'solid',
      paint: { fill: 'none', stroke: '#111827', strokeWidth: '2' },
      route: { contours: projection.contours },
    })
    const outsideChord = cubicPoint({ start, control1, control2, end }, 0.2)
    const bounds = nodeWorldBounds(connector)

    expect(pointToRouteDistance(outsideChord, [start, end])).toBeGreaterThan(connector.hit.strokeWidth / 2)
    expect(hitTestConnector(connector, outsideChord)).toBe(true)
    expect(Math.min(...projection.geometry.points.map(point => point.x))).toBeLessThan(-5)
    expect(Math.max(...projection.geometry.points.map(point => point.x))).toBeGreaterThan(35)
    expect(bounds?.x0).toBeLessThan(-5)
    expect(bounds?.x1).toBeGreaterThan(35)
    expect(connector.route.startTangent).toEqual({ x: 1, y: 0 })
    expect(connector.route.endTangent).toEqual({ x: 1, y: 0 })
  })

  test('journey experience curves expose the visible cubic, not marker chords', () => {
    const appearance = resolveJourneyRequestAppearance()
    const positioned = layoutJourneyDiagram(parseJourneyDiagram(preprocessMermaidLines(`journey
      section S
      Low: 1
      High: 5`)), appearance)
    const scene = lowerJourneyScene({
      positioned,
      colors: COLORS,
      resolved: {
        renderOptions: {},
        familyAppearance: appearance as unknown as Record<string, unknown>,
      },
    })
    const connector = connectors(scene).find(mark => mark.id === 'experience-curve')
    expect(connector).toBeDefined()
    if (!connector) return
    const oldRoute = positioned.sections.flatMap(section =>
      section.tasks.map(task => ({ x: task.marker.cx, y: task.marker.cy })))
    assertCubicProjection(connector, oldRoute)
  })

  test('flowchart authored curves expose flattened ink and exact cubic tangents', () => {
    const connector = onlyConnector(lowerGraphScene({
      positioned: {
        width: 120,
        height: 120,
        nodes: [],
        groups: [],
        edges: [{
          source: 'A', target: 'B', style: 'solid',
          hasArrowStart: false, hasArrowEnd: false,
          curve: 'natural',
          points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        }],
      },
      colors: COLORS,
      resolved: { renderOptions: {} },
    }))
    assertCubicProjection(connector, [{ x: 0, y: 0 }, { x: 100, y: 100 }])
    expect(connector.route.geometry.kind === 'path' ? connector.route.geometry.d : '').toBe(
      'M 0 0 C 50 0, 50 100, 100 100',
    )
  })

  test.each([0, 32.123456789])('flowchart rounded edges expose flattened quadratic corners at offset %s', offset => {
    assertRoundedProjection(onlyConnector(lowerGraphScene({
      positioned: {
        width: 120,
        height: 120,
        nodes: [],
        groups: [],
        edges: [{
          source: 'A', target: 'B', style: 'solid',
          hasArrowStart: false, hasArrowEnd: false,
          points: RIGHT_ANGLE_POINTS.map(point => ({ x: point.x + offset, y: point.y + offset })),
        }],
      },
      colors: COLORS,
      resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 20 } } },
    })), offset)
  })

  test.each([0, 32.123456789])('architecture rounded edges share the same quadratic projection at offset %s', offset => {
    assertRoundedProjection(onlyConnector(lowerArchitectureScene({
      positioned: {
        width: 120,
        height: 120,
        groups: [],
        services: [],
        junctions: [],
        edges: [{
          source: { id: 'A', side: 'R', boundary: 'item' },
          target: { id: 'B', side: 'B', boundary: 'item' },
          hasArrowStart: false,
          hasArrowEnd: false,
          points: RIGHT_ANGLE_POINTS.map(point => ({ x: point.x + offset, y: point.y + offset })),
          placement: 'satisfied',
          sourceFacesTarget: true,
          targetFacesSource: true,
          obstacleFree: true,
        }],
      },
      colors: COLORS,
      resolved: {
        renderOptions: {},
        familyAppearance: {
          visual: { ...DEFAULT_ARCHITECTURE_VISUAL, edgeBendRadius: 20 },
        },
      },
    })), offset)
  })

  test.each([0, 32.123456789])('class rounded relationships share the same quadratic projection at offset %s', offset => {
    assertRoundedProjection(onlyConnector(lowerClassScene({
      positioned: {
        width: 120,
        height: 120,
        classes: [],
        notes: [],
        namespaces: [],
        relationships: [{
          from: 'A',
          to: 'B',
          type: 'association',
          markerAt: 'to',
          points: RIGHT_ANGLE_POINTS.map(point => ({ x: point.x + offset, y: point.y + offset })),
        }],
      },
      colors: COLORS,
      resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 20 } } },
    })), offset)
  })

  test.each([0, 32.123456789])('block rounded edges retain the same normal joins at offset %s', offset => {
    const positioned = layoutBlockDiagram(parseBlockDiagram('block-beta\nA-->B'))
    assertRoundedProjection(onlyConnector(lowerBlockScene({
      positioned: {
        ...positioned,
        nodes: [],
        edges: [{ ...positioned.edges[0]!, points: RIGHT_ANGLE_POINTS.map(point => ({ x: point.x + offset, y: point.y + offset })) }],
        style: { ...positioned.style, edgeBendRadius: 20 },
      },
      colors: COLORS,
      resolved: { renderOptions: {} },
    })), offset)
  })

  test.each([0, 32.123456789])('ER rounded relationships share the same quadratic projection at offset %s', offset => {
    assertRoundedProjection(onlyConnector(lowerErScene({
      positioned: {
        width: 120,
        height: 120,
        entities: [],
        groups: [],
        relationships: [{
          entity1: 'A',
          entity2: 'B',
          cardinality1: 'one',
          cardinality2: 'one',
          label: '',
          identifying: true,
          points: RIGHT_ANGLE_POINTS.map(point => ({ x: point.x + offset, y: point.y + offset })),
        }],
      },
      colors: COLORS,
      resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 20 } } },
    })), offset)
  })
})
