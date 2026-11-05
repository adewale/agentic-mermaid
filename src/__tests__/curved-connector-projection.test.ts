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
import { graphEdgeMarkerPaintRegions, graphEdgePathProjection } from '../graph-connectors.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedEdge } from '../types.ts'
import { projectConnectorPath } from '../scene/connector-geometry.ts'
import { hitTestConnector } from '../scene/hit-test.ts'
import type { ConnectorMark, SceneDoc, ScenePoint } from '../scene/ir.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { parseRegisteredMermaid, serializeMermaid } from '../agent/core.ts'

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

/** Read the absolute commands actually served by the connector writer. */
function writtenPath(d: string): { start: ScenePoint; ends: ScenePoint[]; cubics: Cubic[] } {
  const commands = [...d.matchAll(/([MLC])\s*([^MLC]*)/g)]
  const start: ScenePoint = { x: NaN, y: NaN }, ends: ScenePoint[] = [], cubics: Cubic[] = []
  let cursor = start
  for (const [index, command] of commands.entries()) {
    const values = command[2]!.trim().split(/[\s,]+/).map(Number)
    expect(values.every(Number.isFinite)).toBe(true)
    expect(values).toHaveLength(command[1] === 'C' ? 6 : 2)
    const end = { x: values.at(-2)!, y: values.at(-1)! }
    if (index === 0) { expect(command[1]).toBe('M'); Object.assign(start, end) }
    else {
      if (command[1] === 'C') cubics.push({ start: cursor, control1: { x: values[0]!, y: values[1]! }, control2: { x: values[2]!, y: values[3]! }, end })
      else expect(command[1]).toBe('L')
      ends.push(end)
    }
    cursor = end
  }
  return { start, ends, cubics }
}

function authoredConnector(curve: string, points: ScenePoint[], bendRadius = 0): ConnectorMark {
  return onlyConnector(lowerGraphScene({
    positioned: { width: 200, height: 160, nodes: [], groups: [], edges: [{
      source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: false, curve, points,
    }] },
    colors: COLORS, resolved: { renderOptions: {}, styleFace: { edge: { bendRadius } } },
  }))
}

function connectorPath(connector: ConnectorMark): string {
  return /\bd="([^"]*)"/.exec(sceneNodeSerialization(connector))![1]!
}

function expectConnectedCirclePaint(connector: ConnectorMark): void {
  const attributes = Object.fromEntries(scanSvgStartTags(sceneNodeSerialization(connector))[0]!.attributes.map(attribute => [attribute.name, attribute.value]))
  const path = attributes.d !== undefined ? writtenPath(attributes.d) : (() => {
    const points = attributes.points!.trim().split(/\s+/).map(pair => {
      const [x, y] = pair.split(',').map(Number)
      return { x: x!, y: y! }
    })
    return { start: points[0]!, ends: points.slice(1), cubics: [] }
  })()
  const vertices = [path.start, ...path.ends]
  const length = vertices.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - vertices[index]!.x, point.y - vertices[index]!.y), 0)
  expect(path.cubics).toHaveLength(0)
  expect(connector.stroke.lineCap).toBe('butt')
  const dash = connector.stroke.dash
  expect(dash).toBeDefined()
  if (!dash) return
  const intervals = typeof dash.array === 'string' ? dash.array.split(/[\s,]+/).map(Number) : [...dash.array]
  expect(intervals.every(interval => Number.isFinite(interval) && interval >= 0)).toBe(true)
  expect(attributes['stroke-dasharray']!.split(/[\s,]+/).map(Number)).toEqual(intervals)
  const pattern = intervals.length % 2 ? [...intervals, ...intervals] : intervals
  const period = pattern.reduce((sum, interval) => sum + interval, 0)
  expect(period).toBeGreaterThan(length)
  const offset = Number(dash.offset ?? 0)
  const phase = ((offset % period) + period) % period
  const runs: Array<{ start: number; end: number }> = []
  for (const cycle of [-1, 0, 1]) {
    let distance = cycle * period - phase
    for (const [index, interval] of pattern.entries()) {
      if (index % 2 === 0 && interval > 0 && distance < length && distance + interval > 0) {
        runs.push({ start: Math.max(0, distance), end: Math.min(length, distance + interval) })
      }
      distance += interval
    }
  }
  expect(runs).toHaveLength(1)
  const run = runs[0]!
  let startGap = 0, endGap = 0
  for (const end of ['start', 'end'] as const) {
    const marker = connector.markers[end]
    if (!marker) continue
    expect(marker.geometry?.kind).toBe('circle')
    expect(marker.units).toBe('userSpaceOnUse')
    expect(attributes[`marker-${end}`]).toBe(`url(#${marker.id})`)
    if (marker.geometry?.kind !== 'circle' || !marker.ref) continue
    const extent = Number.parseFloat(marker.paint?.strokeWidth ?? '1') / 2
    if (end === 'start') startGap = marker.geometry.cx + marker.geometry.r + extent - marker.ref.x
    else endGap = marker.ref.x - marker.geometry.cx + marker.geometry.r + extent
  }
  // The single connected shaft reaches each ring's near painted side. A
  // shorter run would avoid absorption while leaving the terminal detached.
  expect(run.start).toBeCloseTo(startGap, 9)
  expect(run.end).toBeCloseTo(length - endGap, 9)
  expect(run.end).toBeGreaterThan(run.start)
  expect(connector.hit.geometry).toBe(connector.route.geometry)
  expect(connector.terminalProjection.geometry).toBe(connector.route.geometry)
}

function expectNaturalJoins(cubics: Cubic[]): void {
  expect(cubics.length).toBeGreaterThan(1)
  for (let index = 1; index < cubics.length; index++) {
    const left = cubics[index - 1]!, right = cubics[index]!
    expect(left.end).toEqual(right.start)
    for (const axis of ['x', 'y'] as const) {
      // First and second derivatives at the same unit-spaced knot.
      expect(left.end[axis] - left.control2[axis]).toBeCloseTo(right.control1[axis] - right.start[axis], 7)
      expect(left.end[axis] - 2 * left.control2[axis] + left.control1[axis])
        .toBeCloseTo(right.control2[axis] - 2 * right.control1[axis] + right.start[axis], 7)
    }
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

  test('natural interpolates noncollinear knots with C2 continuity, free ends and the same visible projection', () => {
    const points = [{ x: 0, y: 0 }, { x: 60, y: 60 }, { x: 120, y: 0 }]
    const connector = authoredConnector('natural', points), path = writtenPath(connectorPath(connector))
    // Independent solution of the three-knot natural spline: x is linear;
    // the first y polynomial is 90t - 30t^3 and the second is its reflection.
    expect(path.cubics).toEqual([
      { start: points[0]!, control1: { x: 20, y: 30 }, control2: { x: 40, y: 60 }, end: points[1]! },
      { start: points[1]!, control1: { x: 80, y: 60 }, control2: { x: 100, y: 30 }, end: points[2]! },
    ])
    expectNaturalJoins(path.cubics)
    const first = path.cubics[0]!, last = path.cubics.at(-1)!
    for (const axis of ['x', 'y'] as const) {
      expect(first.start[axis] - 2 * first.control1[axis] + first.control2[axis]).toBe(0)
      expect(last.end[axis] - 2 * last.control2[axis] + last.control1[axis]).toBe(0)
    }
    expect(connector.route.startTangent).toEqual(unit(points[0]!, { x: 20, y: 30 }))
    expect(connector.route.endTangent).toEqual(unit({ x: 100, y: 30 }, points[2]!))
    const visible = { x: 30, y: 41.25 }
    expect(pointToRouteDistance(visible, points)).toBeGreaterThan(connector.hit.strokeWidth / 2)
    expect(hitTestConnector(connector, visible)).toBe(true)
    expect(connector.hit.geometry).toBe(connector.route.geometry)
    expect(connector.terminalProjection.geometry).toBe(connector.route.geometry)
    const bounds = nodeWorldBounds(connector)!
    expect(bounds.x0).toBeLessThanOrEqual(0)
    expect(bounds.x1).toBeGreaterThanOrEqual(120)
    expect(bounds.y1).toBeGreaterThanOrEqual(60)
  })

  test.each(['linear', 'natural', 'basis', 'cardinal', 'catmullRom', 'monotoneX', 'monotoneY'])('%s with two points degenerates to the authored straight segment', curve => {
    const points = [{ x: 0, y: 0 }, { x: 90, y: 60 }]
    const connector = authoredConnector(curve, points), path = writtenPath(connectorPath(connector))
    expect(path.start).toEqual(points[0]!)
    expect(path.ends.at(-1)).toEqual(points[1])
    expect(path.cubics).toHaveLength(0)
    expect(connector.route.startTangent).toEqual(unit(points[0]!, points[1]!))
    expect(connector.route.endTangent).toEqual(unit(points[0]!, points[1]!))
  })

  test('linear retains all noncollinear route legs even with a rounding style', () => {
    const connector = authoredConnector('linear', RIGHT_ANGLE_POINTS, 24)
    const path = writtenPath(connectorPath(connector))
    expect(path.cubics).toHaveLength(0)
    expect([path.start, ...path.ends]).toEqual(RIGHT_ANGLE_POINTS)
    expect(connector.route.startTangent).toEqual({ x: 1, y: 0 })
    expect(connector.route.endTangent).toEqual({ x: 0, y: 1 })
    expect(hitTestConnector(connector, { x: 95, y: 5 })).toBe(false)
  })

  test('lowering retains captured STEP terminal paint when later curve and point getters change', () => {
    let curveReads = 0, pointReads = 0
    const edge: PositionedEdge = {
      id: 'e1', source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, endMarker: 'circle',
      label: 'kept', labelPosition: { x: 24, y: -12 }, inlineStyle: { stroke: '#000', 'stroke-width': '10px' },
      get curve() { return ++curveReads === 1 ? 'step' : 'linear' },
      // Admission checks the route length before the first projection captures it.
      get points() { return ++pointReads <= 2 ? [{ x: 0, y: 0 }, { x: 90, y: 60 }] : [{ x: 100, y: 100 }, { x: 580, y: 100 }] },
    }
    const connector = onlyConnector(lowerGraphScene({
      positioned: { width: 200, height: 160, nodes: [], groups: [], edges: [edge] },
      colors: COLORS, resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 0 } } },
    }))
    const emitted = scanSvgStartTags(sceneNodeSerialization(connector))[0]!
    const attributes = Object.fromEntries(emitted.attributes.map(attribute => [attribute.name, attribute.value]))
    const path = writtenPath(attributes.d!)
    expect(emitted.name).toBe('path')
    expect(path.start).toEqual({ x: 0, y: 0 })
    expect(path.ends).toEqual([{ x: 45, y: 0 }, { x: 45, y: 60 }, { x: 90, y: 60 }])
    expect(path.cubics).toHaveLength(0)
    expect(attributes).toMatchObject({ 'data-id': 'e1', 'data-from': 'A', 'data-to': 'B' })
    expect(connector.route.contours).toEqual([{ start: { x: 0, y: 0 }, end: { x: 90, y: 60 }, closed: false, startTangent: { x: 1, y: 0 }, endTangent: { x: 1, y: 0 } }])
    expect(connector.hit.geometry).toBe(connector.route.geometry)
    expect(connector.terminalProjection.geometry).toBe(connector.route.geometry)
    expect(connector.stroke.color).toBe('#000')
    expect(Number.parseFloat(String(connector.stroke.width))).toBe(10)
    expectConnectedCirclePaint(connector)
  })

  test.each([
    { name: 'STEP', curve: 'step', points: [{ x: 0, y: 0 }, { x: 90, y: 60 }], ends: [{ x: 45, y: 0 }, { x: 45, y: 60 }, { x: 90, y: 60 }], bothEnds: false },
    { name: 'reverse mixed turns with duplicate endpoints', curve: 'linear', points: [{ x: 100, y: 80 }, { x: 100, y: 80 }, { x: 40, y: 80 }, { x: 40, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 }], ends: [{ x: 100, y: 80 }, { x: 40, y: 80 }, { x: 40, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 }], bothEnds: true },
    { name: 'split co-directed terminal runs', curve: 'linear', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 118 }, { x: 28, y: 118 }, { x: 32, y: 118 }], ends: [{ x: 4, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 118 }, { x: 28, y: 118 }, { x: 32, y: 118 }], bothEnds: true },
  ])('lowering gaps $name by served arclength rather than the endpoint chord', row => {
    const connector = onlyConnector(lowerGraphScene({
      positioned: { width: 200, height: 160, nodes: [], groups: [], edges: [{
        id: 'e1', source: 'A', target: 'B', style: 'solid', hasArrowStart: row.bothEnds, startMarker: 'circle', hasArrowEnd: true, endMarker: 'circle', curve: row.curve,
        points: [...row.points], labelPosition: { x: 45, y: 30 }, inlineStyle: { stroke: '#000', 'stroke-width': '10px' },
      }] },
      colors: COLORS, resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 0 } } },
    }))
    const path = writtenPath(connectorPath(connector))
    expect(path.start).toEqual(row.points[0]!)
    expect(path.ends).toEqual([...row.ends])
    const vertices = [path.start, ...path.ends]
    const length = vertices.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - vertices[index]!.x, point.y - vertices[index]!.y), 0)
    expect(length).toBe(150)
    expect(length).toBeGreaterThan(Math.hypot(path.ends.at(-1)!.x - path.start.x, path.ends.at(-1)!.y - path.start.y))
    expectConnectedCirclePaint(connector)
  })

  test.each([
    { name: 'bumpX cubic', curve: 'bumpX', points: [{ x: 0, y: 0 }, { x: 90, y: 60 }], radius: 0, command: 'C' },
    { name: 'rounded quadratic', curve: undefined, points: RIGHT_ANGLE_POINTS.map(point => ({ ...point })), radius: 20, command: 'Q' },
  ])('lowering leaves a nonlinear $name carrier stroke unmodified', row => {
    const connector = onlyConnector(lowerGraphScene({
      positioned: { width: 200, height: 160, nodes: [], groups: [], edges: [{
        id: 'e1', source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, endMarker: 'circle', ...(row.curve ? { curve: row.curve } : {}),
        points: [...row.points], labelPosition: { x: 45, y: 30 }, inlineStyle: { stroke: '#000', 'stroke-width': '10px' },
      }] },
      colors: COLORS, resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: row.radius } } },
    }))
    const emitted = scanSvgStartTags(sceneNodeSerialization(connector))[0]!
    const attributes = Object.fromEntries(emitted.attributes.map(attribute => [attribute.name, attribute.value]))
    expect(attributes.d).toContain(row.command)
    expect(attributes).toMatchObject({ 'data-id': 'e1', 'data-from': 'A', 'data-to': 'B' })
    expect(attributes['marker-end']).toBe(`url(#${connector.markers.end!.id})`)
    expect(attributes['stroke-dasharray']).toBeUndefined()
    expect(connector.stroke.dash).toBeUndefined()
    expect(connector.stroke.color).toBe('#000')
    expect(Number.parseFloat(String(connector.stroke.width))).toBe(10)
    expect(connector.route.startTangent).toEqual({ x: 1, y: 0 })
    expect(connector.route.endTangent).toEqual(row.command === 'Q' ? { x: 0, y: 1 } : { x: 1, y: 0 })
    expect(connector.hit.geometry).toBe(connector.route.geometry)
    expect(connector.terminalProjection.geometry).toBe(connector.route.geometry)
  })

  test.each([
    { name: 'all duplicate points', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }], bothEnds: false },
    { name: 'route shorter than the circle gap', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }], bothEnds: false },
    { name: 'last leg turns within the circle gap', points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 4 }], bothEnds: false },
    { name: 'first leg turns within the circle gap', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 48 }], bothEnds: true },
    { name: 'last leg reverses within the circle gap', points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 44, y: 0 }], bothEnds: false },
    { name: 'last perpendicular corner paint reaches the circle gap', points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 10 }], bothEnds: false, cornerInk: true },
    { name: 'first perpendicular corner paint reaches the circle gap', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 48 }], bothEnds: true, cornerInk: true },
  ])('lowering leaves $name unmodified instead of gapping around a corner or reversal', row => {
    const connector = onlyConnector(lowerGraphScene({
      positioned: { width: 200, height: 160, nodes: [], groups: [], edges: [{
        id: 'e1', source: 'A', target: 'B', style: 'solid', hasArrowStart: row.bothEnds, startMarker: 'circle', hasArrowEnd: true, endMarker: 'circle', curve: 'linear',
        points: [...row.points], labelPosition: { x: 24, y: -12 }, inlineStyle: { stroke: '#000', 'stroke-width': '10px' },
      }] },
      colors: COLORS, resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 0 } } },
    }))
    const attributes = Object.fromEntries(scanSvgStartTags(sceneNodeSerialization(connector))[0]!.attributes.map(attribute => [attribute.name, attribute.value]))
    const path = writtenPath(attributes.d!)
    expect(path.start).toEqual(row.points[0]!)
    expect(path.ends.at(-1) ?? path.start).toEqual(row.points.at(-1)!)
    expect(path.cubics).toHaveLength(0)
    expect(attributes['marker-end']).toBe(`url(#${connector.markers.end!.id})`)
    if (row.bothEnds) expect(attributes['marker-start']).toBe(`url(#${connector.markers.start!.id})`)
    if ('cornerInk' in row && row.cornerInk) {
      const marker = connector.markers[row.bothEnds ? 'start' : 'end']!
      expect(marker.geometry?.kind).toBe('circle')
      if (marker.geometry?.kind === 'circle' && marker.ref) {
        const extent = Number.parseFloat(marker.paint?.strokeWidth ?? '1') / 2
        const gap = row.bothEnds ? marker.geometry.cx + marker.geometry.r + extent - marker.ref.x
          : marker.ref.x - marker.geometry.cx + marker.geometry.r + extent
        const terminalRun = row.bothEnds ? row.points.slice(0, 2) : row.points.slice(-2)
        const runLength = Math.hypot(terminalRun[1]!.x - terminalRun[0]!.x, terminalRun[1]!.y - terminalRun[0]!.y)
        // The centreline clears the ring, but the perpendicular 10px stroke
        // reaches half its width back into the terminal's straight runway.
        expect(runLength).toBeGreaterThan(gap)
        expect(runLength).toBeLessThan(gap + Number.parseFloat(String(connector.stroke.width)) / 2)
      }
    }
    expect(attributes['stroke-dasharray']).toBeUndefined()
    expect(connector.stroke.dash).toBeUndefined()
    expect(connector.hit.geometry).toBe(connector.route.geometry)
    expect(connector.terminalProjection.geometry).toBe(connector.route.geometry)
  })

  test.each([
    { name: 'two-point', points: [{ x: 0, y: 0 }, { x: 48, y: 0 }], gap: true },
    { name: 'three-point', points: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 48, y: 0 }], gap: false },
  ])('lowering preserves the unprojected $name carrier contract', row => {
    const connector = onlyConnector(lowerGraphScene({
      positioned: { width: 200, height: 160, nodes: [], groups: [], edges: [{
        id: 'e1', source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, endMarker: 'circle',
        points: [...row.points], labelPosition: { x: 24, y: -12 }, inlineStyle: { stroke: '#000', 'stroke-width': '10px' },
      }] },
      colors: COLORS, resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 0 } } },
    }))
    const attributes = Object.fromEntries(scanSvgStartTags(sceneNodeSerialization(connector))[0]!.attributes.map(attribute => [attribute.name, attribute.value]))
    expect(attributes.d).toBeUndefined()
    expect(connector.route.geometry.kind).toBe('polyline')
    if (connector.route.geometry.kind === 'polyline') expect(connector.route.geometry.points).toEqual([...row.points])
    if (row.gap) expectConnectedCirclePaint(connector)
    else { expect(connector.stroke.dash).toBeUndefined(); expect(attributes['stroke-dasharray']).toBeUndefined() }
  })

  test('lowering preserves the plain rounded two-point terminal gap', () => {
    const connector = onlyConnector(lowerGraphScene({
      positioned: { width: 200, height: 160, nodes: [], groups: [], edges: [{
        id: 'e1', source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, endMarker: 'circle',
        points: [{ x: 0, y: 0 }, { x: 48, y: 0 }], labelPosition: { x: 24, y: 0 }, inlineStyle: { stroke: '#000', 'stroke-width': '10px' },
      }] },
      colors: COLORS, resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: 20 } } },
    }))
    const emitted = scanSvgStartTags(sceneNodeSerialization(connector))[0]!
    const attributes = Object.fromEntries(emitted.attributes.map(attribute => [attribute.name, attribute.value]))
    const path = writtenPath(attributes.d!)
    expect(path.start).toEqual({ x: 0, y: 0 })
    expect(path.ends).toEqual([{ x: 48, y: 0 }])
    expect(path.cubics).toHaveLength(0)
    expect(attributes).toMatchObject({ 'data-id': 'e1', 'data-from': 'A', 'data-to': 'B' })
    expect(attributes['marker-end']).toBe(`url(#${connector.markers.end!.id})`)
    expectConnectedCirclePaint(connector)
    expect(connector.route.startTangent).toEqual({ x: 1, y: 0 })
    expect(connector.route.endTangent).toEqual({ x: 1, y: 0 })
    expect(connector.hit.geometry).toBe(connector.route.geometry)
    expect(connector.terminalProjection.geometry).toBe(connector.route.geometry)
  })

  test.each(['bumpX', 'bumpY'])('%s retains its chosen parallel endpoint tangents', curve => {
    const connector = authoredConnector(curve, [{ x: 0, y: 0 }, { x: 90, y: 60 }])
    const path = writtenPath(connectorPath(connector)), cubic = path.cubics[0]!
    expect(path.cubics).toHaveLength(1)
    expect(cubic.control1).toEqual(curve === 'bumpX' ? { x: 45, y: 0 } : { x: 0, y: 30 })
    expect(cubic.control2).toEqual(curve === 'bumpX' ? { x: 45, y: 60 } : { x: 90, y: 30 })
    assertCubicProjection(connector, [{ x: 0, y: 0 }, { x: 90, y: 60 }])
  })

  test('basis rounds interior waypoints with the cubic B-spline convex weights and attached ends', () => {
    const points = [{ x: 0, y: 0 }, { x: 60, y: 60 }, { x: 120, y: 0 }]
    const connector = authoredConnector('basis', points), path = writtenPath(connectorPath(connector))
    expect(path.start).toEqual(points[0]!)
    expect(path.ends).toEqual([{ x: 10, y: 10 }, { x: 60, y: 40 }, { x: 110, y: 10 }, points[2]!])
    expect(path.cubics[0]!.control1).toEqual({ x: 20, y: 20 })
    expect(path.cubics[0]!.control2).toEqual({ x: 40, y: 40 })
    expect(hitTestConnector(connector, points[1]!)).toBe(false)
    expect(hitTestConnector(connector, { x: 60, y: 40 })).toBe(true)
  })

  test.each(['cardinal', 'catmullRom'])('%s interpolates knots using its own parameterized continuous tangent', curve => {
    const points = [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 150, y: 40 }, { x: 210, y: 100 }]
    const path = writtenPath(connectorPath(authoredConnector(curve, points)))
    expect(path.cubics).toHaveLength(3)
    expect(path.ends).toEqual(points.slice(1))
    const left = path.cubics[0]!, right = path.cubics[1]!
    const incoming = { x: left.end.x - left.control2.x, y: left.end.y - left.control2.y }
    const outgoing = { x: right.control1.x - right.start.x, y: right.control1.y - right.start.y }
    if (curve === 'cardinal') {
      // Zero-tension cardinal derivative is half the two-neighbour chord.
      expect(incoming.x).toBeCloseTo((150 - 0) / 6, 8)
      expect(incoming.y).toBeCloseTo((40 - 0) / 6, 8)
      expect(outgoing.x).toBeCloseTo(incoming.x, 8)
      expect(outgoing.y).toBeCloseTo(incoming.y, 8)
    } else {
      // Centripetal knots are spaced by sqrt(chord length). The derivative
      // of the three-point interpolating quadratic is shared at the knot;
      // Bezier derivatives scale with each interval's parameter length.
      const before = Math.sqrt(50), after = Math.sqrt(120)
      const dx = 30 / before - 150 / (before + after) + 120 / after
      const dy = 40 / before - 40 / (before + after)
      expect(incoming.x).toBeCloseTo(dx * before / 3, 7)
      expect(incoming.y).toBeCloseTo(dy * before / 3, 7)
      expect(outgoing.x).toBeCloseTo(dx * after / 3, 7)
      expect(outgoing.y).toBeCloseTo(dy * after / 3, 7)
    }
  })

  test.each(['monotoneX', 'monotoneY'])('%s preserves local extrema and has a continuous tangent on noncollinear knots', curve => {
    const points = [{ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 150, y: 20 }, { x: 210, y: 100 }]
    const route = curve === 'monotoneX' ? points : points.map(point => ({ x: point.y, y: point.x }))
    const path = writtenPath(connectorPath(authoredConnector(curve, route)))
    expect(path.ends).toEqual(route.slice(1))
    const axis = curve === 'monotoneX' ? 'y' : 'x'
    for (let index = 0; index < path.cubics.length; index++) {
      const cubic = path.cubics[index]!
      const minimum = Math.min(cubic.start[axis], cubic.end[axis]), maximum = Math.max(cubic.start[axis], cubic.end[axis])
      for (const t of [0.125, 0.25, 0.5, 0.75, 0.875]) {
        const value = cubicPoint(cubic, t)[axis]
        expect(value).toBeGreaterThanOrEqual(minimum)
        expect(value).toBeLessThanOrEqual(maximum)
      }
      if (index > 0) expect(cubic.control1[axis]).toBe(cubic.start[axis])
      if (index < path.cubics.length - 1) expect(cubic.control2[axis]).toBe(cubic.end[axis])
    }
  })

  test.each([
    { curve: 'step', ends: [{ x: 45, y: 0 }, { x: 45, y: 60 }, { x: 90, y: 60 }] },
    { curve: 'stepBefore', ends: [{ x: 0, y: 60 }, { x: 90, y: 60 }] },
    { curve: 'stepAfter', ends: [{ x: 90, y: 0 }, { x: 90, y: 60 }] },
  ])('$curve changes at the authored side of each step', ({ curve, ends }) => {
    const path = writtenPath(connectorPath(authoredConnector(curve, [{ x: 0, y: 0 }, { x: 90, y: 60 }])))
    expect(path.cubics).toHaveLength(0)
    expect(path.ends).toEqual([...ends])
  })

  test('unknown curve names survive source round-trip but refuse misleading rendered geometry', () => {
    const source = 'flowchart LR\nA e1@--> B\ne1@{ curve: futureSpline }'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(serializeMermaid(parsed.value)).toContain('curve: futureSpline')
    expect(() => renderMermaidSVGWithReceipt(source)).toThrow('Unsupported edge curve "futureSpline"')
    expect(() => authoredConnector('constructor', RIGHT_ANGLE_POINTS)).toThrow('Unsupported edge curve "constructor"')
  })

  test('mutable and getter routes receive fresh projected endpoints at the final written precision', () => {
    let endpointY = 123.35000000000001
    const points: ScenePoint[] = [{ x: 100, y: 97.05 }, { x: 124, y: 97.05 }, { x: 124, y: endpointY }, { x: 148, get y() { return endpointY } }]
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, curve: 'natural', points }
    const first = graphEdgePathProjection(edge, {})!
    expect(first.contours[0]!.end).toEqual({ x: 148, y: 123.35 })
    expect(first.geometry.points.at(-1)).toEqual(first.contours[0]!.end)
    expect(writtenPath(first.geometry.d).ends.at(-1)).toEqual(first.contours[0]!.end)
    endpointY = 164.45000000000002
    points[2]!.y = endpointY
    const next = graphEdgePathProjection(edge, {})!
    expect(next.contours[0]!.end).toEqual({ x: 148, y: 164.45 })
    expect(next.geometry.points.at(-1)).toEqual(next.contours[0]!.end)
    expect(first.contours[0]!.end).toEqual({ x: 148, y: 123.35 })
  })

  test('one projection reads its curve choice once while later calls observe a changed getter', () => {
    let reads = 0
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: false,
      points: [{ x: 0, y: 0 }, { x: 60, y: 60 }, { x: 120, y: 0 }],
      get curve() { return ++reads === 1 ? 'natural' : 'linear' },
    }
    expectNaturalJoins(writtenPath(graphEdgePathProjection(edge, {})!.geometry.d).cubics)
    expect(reads).toBe(1)
    expect(writtenPath(graphEdgePathProjection(edge, {})!.geometry.d).cubics).toHaveLength(0)
    expect(reads).toBe(2)
  })

  test.each([
    { curve: 'natural', points: [{ x: 4, y: 7 }], constant: true },
    { curve: 'natural', points: [{ x: 4, y: 7 }, { x: 4, y: 7 }, { x: 4, y: 7 }], constant: true },
    { curve: 'natural', points: Array.from({ length: 3 }, () => ({ x: 123.12345678901, y: 123.12345678901 })), constant: true },
    { curve: 'monotoneX', points: [{ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 30, y: 60 }, { x: 90, y: 0 }], constant: false },
  ])('$curve preserves finite geometry for coincident route points ($constant)', ({ curve, points, constant }) => {
    const projection = graphEdgePathProjection({ source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: false, curve, points: [...points] }, {})!
    const path = writtenPath(projection.geometry.d)
    expect(path.start).toEqual(points[0]!)
    expect(path.ends.at(-1) ?? path.start).toEqual(points.at(-1)!)
    if (constant) {
      expect(projection.contours[0]!.startTangent).toBeUndefined()
      expect(projection.contours[0]!.endTangent).toBeUndefined()
    } else {
      expect(path.cubics).toHaveLength(2)
      expect(path.ends).toEqual([{ x: 30, y: 60 }, { x: 90, y: 0 }])
    }
  })

  test.each(['agentic', 'elk'] as const)('public %s SVG keeps linear legs, natural joins and real endpoint contacts', backend => {
    const result = renderMermaidSVGWithReceipt('flowchart LR\nA e1@==> B\nA e2@--> C\ne1@{ curve: linear }\ne2@{ curve: natural }', {
      graphLayout: { backend, fallback: 'none' }, layoutSafety: 'strict', embedFontImport: false,
    })
    expect(result.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
    const tags = scanSvgStartTags(result.svg).map(tag => ({ name: tag.name, attributes: Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])) }))
    const edge = (id: string) => tags.find(tag => tag.attributes['data-id'] === id && tag.attributes.class === 'edge')!.attributes
    const linear = writtenPath(edge('e1').d!), natural = writtenPath(edge('e2').d!)
    expect(linear.cubics).toHaveLength(0)
    expect(linear.ends.length).toBeGreaterThan(1)
    expectNaturalJoins(natural.cubics)
    // Inspect served node rectangles alongside actual path coordinates;
    // certificate status and curve-name metadata do not establish contact.
    for (const [id, path] of [['e1', linear], ['e2', natural]] as const) {
      const attributes = edge(id)
      expect(attributes['data-from']).toBe('A')
      expect(attributes['data-to']).toBe(id === 'e1' ? 'B' : 'C')
      expect(attributes['marker-end']).toMatch(/^url\(#arrowhead\)$/)
      const target = tags.find(tag => tag.attributes['data-id'] === attributes['data-to'] && tag.attributes.class === 'node')!
      const rectangleIndex = tags.indexOf(target) + 1, rectangle = tags[rectangleIndex]!.attributes
      const source = tags.find(tag => tag.attributes['data-id'] === 'A' && tag.attributes.class === 'node')!
      const sourceRectangle = tags[tags.indexOf(source) + 1]!.attributes
      expect(path.start.x).toBeCloseTo(Number(sourceRectangle.x) + Number(sourceRectangle.width), 7)
      expect(path.start.y).toBeGreaterThan(Number(sourceRectangle.y))
      expect(path.start.y).toBeLessThan(Number(sourceRectangle.y) + Number(sourceRectangle.height))
      const end = path.ends.at(-1)!
      expect(end.x).toBeCloseTo(Number(rectangle.x), 7)
      expect(end.y).toBeGreaterThan(Number(rectangle.y))
      expect(end.y).toBeLessThan(Number(rectangle.y) + Number(rectangle.height))
    }
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
