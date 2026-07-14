import { describe, expect, test } from 'bun:test'

import { lowerArchitectureScene } from '../architecture/renderer.ts'
import { DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import { lowerClassScene } from '../class/renderer.ts'
import { lowerErScene } from '../er/renderer.ts'
import { lowerJourneyScene } from '../journey/renderer.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { preprocessMermaidLines } from '../mermaid-source.ts'
import { lowerGraphScene } from '../renderer.ts'
import * as marks from '../scene/marks.ts'
import { nodeWorldBounds } from '../scene/bounds.ts'
import { projectConnectorPath } from '../scene/connector-geometry.ts'
import { hitTestConnector } from '../scene/hit-test.ts'
import type { ConnectorMark, SceneDoc, ScenePoint } from '../scene/ir.ts'

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
  const found = connectors(doc)
  expect(found).toHaveLength(1)
  return found[0]!
}

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

function assertRoundedProjection(connector: ConnectorMark): void {
  expect(connector.geometry.kind).toBe('path')
  if (connector.geometry.kind !== 'path') return
  expect(connector.geometry.d).toBe(ROUNDED_D)
  expect(connector.geometry.points.length).toBeGreaterThan(RIGHT_ANGLE_POINTS.length)
  expect(connector.geometry.points.some(point =>
    Math.hypot(point.x - ROUNDED_MIDPOINT.x, point.y - ROUNDED_MIDPOINT.y) < 1e-9)).toBe(true)
  expect(pointToRouteDistance(ROUNDED_MIDPOINT, RIGHT_ANGLE_POINTS))
    .toBeGreaterThan(connector.hit.strokeWidth / 2)
  expect(hitTestConnector(connector, ROUNDED_MIDPOINT)).toBe(true)
  expect(connector.route.contours).toEqual([{
    start: RIGHT_ANGLE_POINTS[0]!,
    end: RIGHT_ANGLE_POINTS[2]!,
    closed: false,
    startTangent: { x: 1, y: 0 },
    endTangent: { x: 0, y: 1 },
  }])
  expect(connector.route.startTangent).toEqual({ x: 1, y: 0 })
  expect(connector.route.endTangent).toEqual({ x: 0, y: 1 })
  expect(connector.route.geometry).toBe(connector.geometry)
  expect(connector.hit.geometry).toBe(connector.geometry)
  expect(connector.terminalProjection.geometry).toBe(connector.geometry)
  expect(connector.crisp).toContain(`d="${ROUNDED_D}"`)
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
  expect(connector.geometry.kind).toBe('path')
  if (connector.geometry.kind !== 'path') return
  const cubic = firstCubic(connector.geometry.d)
  const visiblePoint = cubicPoint(cubic, 0.25)
  expect(connector.geometry.points.length).toBeGreaterThan(oldRoute.length)
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
  expect(connector.route.geometry).toBe(connector.geometry)
  expect(connector.hit.geometry).toBe(connector.geometry)
  expect(connector.terminalProjection.geometry).toBe(connector.geometry)
  expect(connector.crisp).toContain(`d="${connector.geometry.d}"`)
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
    }, `<path d="${d}" fill="none" stroke="#111827" stroke-width="2" />`)
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
    expect(connector.geometry.kind === 'path' ? connector.geometry.d : '').toBe(
      'M 0 0 C 50 0, 50 100, 100 100',
    )
  })

  test('flowchart rounded edges expose flattened quadratic corners', () => {
    assertRoundedProjection(onlyConnector(lowerGraphScene({
      positioned: {
        width: 120,
        height: 120,
        nodes: [],
        groups: [],
        edges: [{
          source: 'A', target: 'B', style: 'solid',
          hasArrowStart: false, hasArrowEnd: false,
          points: RIGHT_ANGLE_POINTS.map(point => ({ ...point })),
        }],
      },
      colors: COLORS,
      resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 20 } } },
    })))
  })

  test('architecture rounded edges share the same quadratic projection', () => {
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
          points: RIGHT_ANGLE_POINTS.map(point => ({ ...point })),
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
    })))
  })

  test('class rounded relationships share the same quadratic projection', () => {
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
          points: RIGHT_ANGLE_POINTS.map(point => ({ ...point })),
        }],
      },
      colors: COLORS,
      resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 20 } } },
    })))
  })

  test('ER rounded relationships share the same quadratic projection', () => {
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
          points: RIGHT_ANGLE_POINTS.map(point => ({ ...point })),
        }],
      },
      colors: COLORS,
      resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 20 } } },
    })))
  })
})
