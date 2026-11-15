import { beforeAll, describe, expect, test } from 'bun:test'

import { knownStyles, renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt } from '../agent/index.ts'
import { LAYOUT_PIPELINE, convertToElkFormat, layoutGraphSync } from '../layout-engine.ts'
import type { ElkNode, ElkExtendedEdge } from 'elkjs'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { parseMermaid } from '../parser.ts'
import { auditRouteContracts } from '../route-contracts.ts'
import { resolveStyleStackWithFace } from '../scene/style-registry.ts'
import { resolveRenderStyle } from '../styles.ts'
import { scanSvgStartTags, decodedSvgAttributeValue } from '../svg-structure.ts'
import { measureRenderedText, renderedTextReady } from './helpers/rendered-text.ts'
import { extractEdgesRecursively, type ElkHierarchySegment } from '../layout/passes/elk-edges.ts'
import type { PositionedEdge } from '../types.ts'

beforeAll(renderedTextReady)

test.each([
  ['horizontal subdivision', [[0, 0], [10, 0]], [[15, 0], [20, 0]], [[0, 0], [10, 0], [20, 0]]],
  ['vertical subdivision', [[0, 0], [0, 10]], [[0, 15], [0, 20]], [[0, 0], [0, 10], [0, 20]]],
  ['shared endpoint', [[0, 0], [10, 0]], [[10, 0], [20, 0]], [[0, 0], [10, 0], [20, 0]]],
  ['real corner', [[0, 0], [10, 0]], [[10, 5], [20, 5]], [[0, 0], [10, 0], [10, 5], [20, 5]]],
  ['reversal', [[0, 0], [10, 0]], [[15, 0], [5, 0]], [[0, 0], [10, 0], [15, 0], [5, 0]]],
  ['backtracking overlap', [[0, 0], [10, 0]], [[5, 0], [20, 0]], [[0, 0], [10, 0], [5, 0], [20, 0]]],
  // Two container frames can flatten one vertical run one roundoff apart.
  ['roundoff vertical subdivision', [[193.34, 529.6], [348.04, 529.6]], [[348.03999999999996, 519.6], [348.03999999999996, 410.2]], [[193.34, 529.6], [348.04, 529.6], [348.04, 410.2]]],
  ['roundoff corner', [[0, 0], [348.04, 0]], [[348.03999999999996, 20], [400, 20]], [[0, 0], [348.04, 0], [348.04, 20], [400, 20]]],
  ['sub-pixel corner beyond roundoff', [[0, 0], [348.04, 0]], [[348.04001, 20], [400, 20]], [[0, 0], [348.04, 0], [348.04001, 20], [400, 20]]],
] as const)('hierarchy extraction preserves ink at a %s', (_name, first, second, expected) => {
  const graph = parseMermaid('flowchart LR\nA-->B')
  const segments: ElkHierarchySegment[] = [first, second].map((points, order) => ({
    id: `part-${order}`, sources: ['A'], targets: ['B'], hierarchySegment: { edgeIndex: 0, order },
    sections: [{ id: `section-${order}`, startPoint: { x: points[0][0], y: points[0][1] }, endPoint: { x: points[1][0], y: points[1][1] } }],
  }))
  const edges: PositionedEdge[] = []
  extractEdgesRecursively({ id: 'root', edges: segments }, graph, edges, 0, 0)
  expect(edges[0]!.points.map(point => [point.x, point.y])).toEqual(expected.map(point => [...point]))
})

// The whole bounded model: every ordered pair of distinct endpoints among a
// top-level node (X), a node in Outer (A), a node in Inner (B), and the two
// subgraphs themselves, under both hierarchy modes (SEPARATE is what a
// direction override inside a subgraph selects).
const ENDPOINTS = ['X', 'A', 'B', 'Inner', 'Outer'] as const
const MODES = [['INCLUDE_CHILDREN', false], ['SEPARATE', true]] as const

const ALL_ENDPOINT_CASES = MODES.flatMap(([mode, withDirectionOverride]) =>
  ENDPOINTS.flatMap(from => ENDPOINTS.filter(to => to !== from).map(to => [`${mode} ${from}->${to}`, withDirectionOverride, from, to] as const)))

function nestedGraph(withDirectionOverride: boolean, from: string, to: string): string {
  return `flowchart LR
  X
  Y
  subgraph Outer
    ${withDirectionOverride ? 'direction TB' : ''}
    A
    subgraph Inner
      ${withDirectionOverride ? 'direction TB' : ''}
      B
    end
  end
  ${from} --> ${to}`
}

function assertCleanHierarchyCase(source: string, from: string, to: string) {
  const graph = parseMermaid(source)
  const positioned = layoutGraphSync(graph)
  const edge = positioned.edges.find(e => e.source === from && e.target === to)
  expect(edge, `${from}->${to} edge should be present`).toBeDefined()
  expect(edge!.points.length).toBeGreaterThanOrEqual(2)
  expect(edge!.points.every(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))).toBe(true)
  expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
  expect(auditRouteContracts(positioned, graph)).toEqual([])
  return positioned
}

describe('bounded hierarchy endpoint model', () => {
  test.each(ALL_ENDPOINT_CASES)('%s routes without stale coordinates', (_name, withDirectionOverride, from, to) => {
    assertCleanHierarchyCase(nestedGraph(withDirectionOverride, from, to), from, to)
  })
})

describe('public hierarchy endpoints', () => {
  for (const [from, to] of [['X', 'B'], ['B', 'Outer'], ['Outer', 'B']] as const) {
    for (const multiline of [false, true]) {
      test(`${from}->${to} emitted shaft clears ${multiline ? 'multiline' : 'plain'} group-title glyphs`, () => {
        const source = nestedGraph(true, from, to).replace('subgraph Outer', multiline ? 'subgraph Outer[Outer<br/>Boundary]' : 'subgraph Outer')
        const svg = renderMermaidSVG(source, { embedFontImport: false })
        const headers = measureRenderedText(svg).texts.filter(text => ['Outer', 'Outer Boundary', 'Inner'].includes(text.content))
        expect(headers).toHaveLength(2)
        const carrier = scanSvgStartTags(svg).find(tag => decodedSvgAttributeValue(tag, 'data-role') === 'edge')!
        expect(carrier.name).toBe('polyline')
        const coordinates = decodedSvgAttributeValue(carrier, 'points')!.trim().split(/[\s,]+/).map(Number)
        expect(coordinates.length).toBeGreaterThanOrEqual(4)
        expect(coordinates.every(Number.isFinite)).toBe(true)
        for (const text of headers) {
          expect(text.box, `${text.content} has visible glyphs`).toBeDefined()
          const box = text.box!
          for (let i = 2; i < coordinates.length; i += 2) {
            const x1 = coordinates[i - 2]!, y1 = coordinates[i - 1]!, x2 = coordinates[i]!, y2 = coordinates[i + 1]!
            const clear = Math.max(x1, x2) <= box.x || Math.min(x1, x2) >= box.x + box.width
              || Math.max(y1, y2) <= box.y || Math.min(y1, y2) >= box.y + box.height
            expect(clear, `${from}->${to} shaft crosses ${text.content}`).toBe(true)
          }
        }
      })
    }
  }

  test('a single traversed boundary keeps the inherited-direction comparison title readable', () => {
    const source = `flowchart LR
      subgraph subgraph1
        direction TB
        top1[top] --> bottom1[bottom]
      end
      subgraph subgraph2
        direction TB
        top2[top] --> bottom2[bottom]
      end
      outside --> subgraph1
      outside ---> top2`
    const options = { graphLayout: { backend: 'elk' as const, fallback: 'none' as const }, embedFontImport: false }
    const positioned = assertCleanHierarchyCase(source, 'outside', 'top2')
    const layout = layoutMermaidWithReceipt(source, { ...options, debug: true }).layout
    expect(layout.edges.map(edge => ({ from: edge.from, to: edge.to })))
      .toEqual([{ from: 'outside', to: 'subgraph1' }, { from: 'outside', to: 'top2' }, { from: 'top1', to: 'bottom1' }, { from: 'top2', to: 'bottom2' }])
    const rendered = renderMermaidSVGWithReceipt(source, options), svg = rendered.svg
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    const headers = measureRenderedText(svg).texts.filter(text => ['subgraph1', 'subgraph2'].includes(text.content))
    expect(headers).toHaveLength(2)
    for (const carrier of scanSvgStartTags(svg).filter(tag => decodedSvgAttributeValue(tag, 'data-role') === 'edge')) {
      expect(decodedSvgAttributeValue(carrier, 'marker-end')).toBeDefined()
      const coordinates = decodedSvgAttributeValue(carrier, 'points')!.trim().split(/[\s,]+/).map(Number)
      for (const text of headers) {
        expect(text.box, `${text.content} has visible glyphs`).toBeDefined()
        const box = text.box!
        for (let i = 2; i < coordinates.length; i += 2) {
          const x1 = coordinates[i - 2]!, y1 = coordinates[i - 1]!, x2 = coordinates[i]!, y2 = coordinates[i + 1]!
          const clear = Math.max(x1, x2) <= box.x || Math.min(x1, x2) >= box.x + box.width
            || Math.max(y1, y2) <= box.y || Math.min(y1, y2) >= box.y + box.height
          expect(clear, `emitted shaft crosses ${text.content}`).toBe(true)
        }
      }
      for (const group of positioned.groups) {
        const height = group.headerHeight!
        expect(height).toBeGreaterThan(0)
        for (let i = 2; i < coordinates.length; i += 2) {
          const x1 = coordinates[i - 2]!, y1 = coordinates[i - 1]!, x2 = coordinates[i]!, y2 = coordinates[i + 1]!
          const clear = Math.max(x1, x2) <= group.x || Math.min(x1, x2) >= group.x + group.width
            || Math.max(y1, y2) <= group.y || Math.min(y1, y2) >= group.y + height
          expect(clear, `emitted shaft crosses ${group.id} header band`).toBe(true)
        }
      }
    }
  })

  for (const direction of ['LR', 'RL', 'TB', 'BT']) {
    for (const [from, to] of [['X', 'B'], ['B', 'Outer'], ['Outer', 'B'], ['X', 'Outer'], ['Outer', 'X']] as const) {
      test(`${direction} ${from}->${to} retains its labeled edge through three scopes`, () => {
        const source = `flowchart ${direction}
          X[Client]
          subgraph Outer
            direction TB
            subgraph Middle
              direction LR
              subgraph Inner
                direction TB
                B[Worker]
              end
            end
          end
          ${from} -->|request| ${to}`
        assertCleanHierarchyCase(source, from!, to!)
        const layout = layoutMermaidWithReceipt(source, { debug: true }).layout
        expect(layout.edges.map(edge => ({ from: edge.from, to: edge.to, label: edge.label?.text })))
          .toEqual([{ from, to, label: 'request' }])
        expect(layout.nodes.map(node => node.id).sort()).toEqual(['B', 'X'])
        for (const group of layout.groups.filter(group => group.id === from || group.id === to)) {
          const path = layout.edges[0]!.path, start = group.id === from
          const endpoint = start ? path[0]! : path.at(-1)!
          const neighbour = start ? path[1]! : path.at(-2)!
          const verticalFace = Math.min(Math.abs(endpoint[0] - group.x), Math.abs(endpoint[0] - group.x - group.w)) < 1e-5
          const horizontalFace = Math.min(Math.abs(endpoint[1] - group.y), Math.abs(endpoint[1] - group.y - group.h)) < 1e-5
          const normal = (verticalFace && Math.abs(endpoint[1] - neighbour[1]) < 1e-5)
            || (horizontalFace && Math.abs(endpoint[0] - neighbour[0]) < 1e-5)
          expect(normal, `${group.id} connection must meet its border normally`).toBe(true)
          if (direction === 'TB' && from === 'X' && to === 'Outer' || direction === 'BT' && from === 'Outer' && to === 'X') {
            expect(endpoint[1], 'an exterior group endpoint may still use its north face').toBeCloseTo(group.y, 5)
            expect(neighbour[1]).toBeLessThan(group.y)
          }
        }
        expect(renderMermaidSVG(source)).toContain('request')
      })
    }
  }

  test.each(['LR', 'RL', 'TB', 'BT'].flatMap(direction => [['sign_in_worker', 'Box_out_0'], ['Box_out_0', 'sign_in_worker']].map(([from, to]) => ({ direction, from: from!, to: to! }))))('authored identifiers resembling boundary ports retain their own endpoints $direction $from->$to', ({ direction, from, to }) => {
    const source = `flowchart ${direction}
      Box_out_0[Client]
      subgraph Box
        direction TB
        sign_in_worker[Worker]
      end
      ${from} -->|reply| ${to}`
    const positioned = assertCleanHierarchyCase(source, from, to)
    for (const backend of ['elk', 'agentic'] as const) {
      const options = { graphLayout: { backend, fallback: 'none' as const } }
      const layout = layoutMermaidWithReceipt(source, { ...options, debug: true }).layout
      expect(layout.nodes.map(node => node.id).sort()).toEqual(['Box_out_0', 'sign_in_worker'])
      expect(layout.edges.map(edge => ({ from: edge.from, to: edge.to })))
        .toEqual([{ from, to }])
      expect(layout.edges[0]!.label?.text).toBe('reply')
      const svg = renderMermaidSVG(source, options)
      expect(svg).toContain('reply')
      const carrier = scanSvgStartTags(svg).find(tag => decodedSvgAttributeValue(tag, 'data-role') === 'edge')!
      expect(decodedSvgAttributeValue(carrier, 'marker-end')).toBeDefined()
      const coordinates = decodedSvgAttributeValue(carrier, 'points')!.trim().split(/[\s,]+/).map(Number)
      const points: Array<[number, number]> = Array.from({ length: coordinates.length / 2 }, (_, i) => [coordinates[i * 2]!, coordinates[i * 2 + 1]!])
      const expectedPoints = layout.edges[0]!.path
      expect(coordinates).toHaveLength(expectedPoints.length * 2)
      for (let i = 0; i < expectedPoints.length; i++) for (const axis of [0, 1] as const) {
        const value = expectedPoints[i]![axis]
        // Twelve significant digits round by at most half a decimal unit at
        // exponent floor(log10(abs(value))) - 11, plus binary subtraction noise.
        const halfUnit = value === 0 ? 0 : 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(value))) - 11)
        expect(Math.abs(points[i]![axis] - value)).toBeLessThanOrEqual(halfUnit + Number.EPSILON * Math.abs(value))
        if (i) {
          const previous = expectedPoints[i - 1]![axis], delta = points[i]![axis] - points[i - 1]![axis]
          if (delta !== 0) expect(Math.sign(delta)).toBe(Math.sign(value - previous))
          else {
            // Rounding can collapse an arithmetic-noise step, but cannot
            // erase a step distinguishable at the writer's stated precision.
            const previousHalfUnit = previous === 0 ? 0 : 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(previous))) - 11)
            expect(Math.abs(value - previous)).toBeLessThanOrEqual(halfUnit + previousHalfUnit + Number.EPSILON * (Math.abs(value) + Math.abs(previous)))
          }
        }
      }
      const header = measureRenderedText(svg).texts.find(text => text.content === 'Box')!
      expect(header.box, `${backend} Box has visible title glyphs`).toBeDefined()
      const group = layout.groups.find(group => group.id === 'Box')!
      const headerHeight = positioned.groups.find(group => group.id === 'Box')!.headerHeight!
      expect(headerHeight).toBeGreaterThan(0)
      for (let i = 1; i < points.length; i++) {
        const [x1, y1] = points[i - 1]!, [x2, y2] = points[i]!, box = header.box!
        const clear = Math.max(x1, x2) <= box.x || Math.min(x1, x2) >= box.x + box.width
          || Math.max(y1, y2) <= box.y || Math.min(y1, y2) >= box.y + box.height
        expect(clear, `${backend} emitted shaft crosses Box title glyphs`).toBe(true)
        const headerClear = Math.max(x1, x2) <= group.x || Math.min(x1, x2) >= group.x + group.w
          || Math.max(y1, y2) <= group.y || Math.min(y1, y2) >= group.y + headerHeight
        expect(headerClear, `${backend} emitted shaft crosses Box header band`).toBe(true)
      }
      for (const [id, start] of [[from, true], [to, false]] as const) {
        const node = layout.nodes.find(node => node.id === id)!
        const path = start ? points : points.toReversed()
        const endpoint = path[0]!, next = path.find(point => point[0] !== endpoint[0] || point[1] !== endpoint[1])!
        const [x, y] = endpoint, [nx, ny] = next
        const outward = Math.abs(x - node.x) < 1e-5 && nx < x && Math.abs(ny - y) < 1e-5
          || Math.abs(x - node.x - node.w) < 1e-5 && nx > x && Math.abs(ny - y) < 1e-5
          || Math.abs(y - node.y) < 1e-5 && ny < y && Math.abs(nx - x) < 1e-5
          || Math.abs(y - node.y - node.h) < 1e-5 && ny > y && Math.abs(nx - x) < 1e-5
        expect(outward, `${backend} ${id} must have a physical outward terminal lead`).toBe(true)
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]!, b = points[i]!
          // Reflection can put an exact border at 114.55399999999997 while
          // x+w is 114.55399999999999; ignore only arithmetic noise.
          const noise = 1e-6
          const enters = a[0] === b[0]
            ? a[0] > node.x + noise && a[0] < node.x + node.w - noise && Math.max(a[1], b[1]) > node.y + noise && Math.min(a[1], b[1]) < node.y + node.h - noise
            : a[1] > node.y + noise && a[1] < node.y + node.h - noise && Math.max(a[0], b[0]) > node.x + noise && Math.min(a[0], b[0]) < node.x + node.w - noise
          expect(enters, `${backend} emitted shaft must not traverse its own ${id} body`).toBe(false)
        }
      }
    }
  })

  test('deep branches retain both parallel relationships and their labels', () => {
    const source = `flowchart LR
      X[Client] --> Y[Monitor]
      subgraph Left
        direction TB
        subgraph LeftInner
          direction LR
          subgraph Deep
            direction TB
            A[Source]
          end
        end
      end
      subgraph Right
        direction RL
        subgraph RightInner
          direction TB
          B[Sink]
        end
      end
      A -->|primary| B
      A -->|secondary| B`
    assertCleanHierarchyCase(source, 'A', 'B')
    const layout = layoutMermaidWithReceipt(source, { debug: true }).layout
    expect(layout.edges.filter(edge => edge.from === 'A' && edge.to === 'B').map(edge => edge.label?.text).sort())
      .toEqual(['primary', 'secondary'])
    expect(layout.edges).toHaveLength(3)
    expect(layout.groups.find(group => group.id === 'Deep')?.members).toContain('A')
    expect(layout.groups.find(group => group.id === 'RightInner')?.members).toContain('B')
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('primary')
    expect(svg).toContain('secondary')
  })
})

// Titles and routing may select SEPARATE hierarchy handling. Configured
// content padding remains a minimum when safe boundary routes need more room.
const TITLED_GROUPS = `flowchart TD
  subgraph edge[Edge Layer]
    web[Web App]
  end
  subgraph core[Core Services]
    api[API]
    db[(Postgres)]
  end
  web --> api
  api --> db`

describe('group titles and hierarchy handling', () => {
  test('titled groups retain minimum content padding and clear header bands in every style', () => {
    for (const name of [undefined, ...knownStyles()]) {
      const { style, face } = resolveStyleStackWithFace(name)
      const options = { style, styleFace: face }
      const positioned = layoutGraphSync(parseMermaid(TITLED_GROUPS), options)
      const group = positioned.groups.find(candidate => candidate.id === 'edge')!
      const web = positioned.nodes.find(candidate => candidate.id === 'web')!
      const noise = 8 * Number.EPSILON * Math.max(1, positioned.width, positioned.height)
      expect(group.y + group.height - (web.y + web.height) + noise, name ?? 'default')
        .toBeGreaterThanOrEqual(resolveRenderStyle(options, undefined, face).groupPaddingY)
      expect(positioned.nodes.map(node => [node.id, node.label]).sort()).toEqual([
        ['api', 'API'], ['db', 'Postgres'], ['web', 'Web App'],
      ])
      expect(positioned.groups.map(value => [value.id, value.nodeIds?.toSorted()]).sort()).toEqual([
        ['core', ['api', 'db']], ['edge', ['web']],
      ])
      expect(positioned.edges.toSorted((a, b) => a.edgeIndex! - b.edgeIndex!).map(edge => [
        edge.source, edge.target, edge.hasArrowStart, edge.hasArrowEnd, edge.startMarker ?? null, edge.endMarker ?? null,
      ])).toEqual([['web', 'api', false, true, null, 'arrow'], ['api', 'db', false, true, null, 'arrow']])
      const headers = [...positioned.groups]
      for (let index = 0; index < headers.length; index++) {
        const header = headers[index]!, height = header.headerHeight!
        headers.push(...header.children)
        expect(Number.isFinite(height)).toBe(true)
        expect(height).toBeGreaterThan(0)
        for (const edge of positioned.edges) for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1]!, b = edge.points[i]!
          const enters = Math.max(a.x, b.x) > header.x + noise && Math.min(a.x, b.x) < header.x + header.width - noise
            && Math.max(a.y, b.y) > header.y + noise && Math.min(a.y, b.y) < header.y + height - noise
          expect(enters, `${name ?? 'default'} ${edge.source}->${edge.target} crosses ${header.id} header`).toBe(false)
        }
      }
    }
  })
})

const HIERARCHY_PARAMETER_CLOUD = `graph TD
  subgraph Cloud
    subgraph us-east [US East Region]
      A[Web Server] --> B[App Server]
    end
    subgraph us-west [US West Region]
      C[Web Server] --> D[App Server]
    end
  end
  E[Load Balancer] --> A
  E --> C`

function hierarchyScope(root: ElkNode, id: string): ElkNode {
  const pending = [...(root.children ?? [])]
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index]!
    if (node.id === id) return node
    pending.push(...(node.children ?? []))
  }
  throw new Error(`Missing scope ${id}`)
}

function observeHierarchyPorts<T>(produce: () => T) {
  const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'extractEdgesRecursively')!, run = pass.run
  const snapshots: Array<{ hierarchy: string | undefined; portCount: number; incidences: Array<{ edge: string; port: string; expected: { x: number; y: number }; actual: { x: number; y: number } }> }> = []
  let observationError: unknown
  pass.run = context => {
    if (context.elkResult) try {
      const ports = new Map<string, { x: number; y: number }>()
      const hosted: Array<{ host: ElkNode; x: number; y: number }> = []
      const visit = (node: ElkNode, x: number, y: number) => {
        x += node.x ?? 0; y += node.y ?? 0
        hosted.push({ host: node, x, y })
        for (const port of node.ports ?? []) ports.set(port.id, { x: x + (port.x ?? 0), y: y + (port.y ?? 0) })
        for (const child of node.children ?? []) visit(child, x, y)
      }
      visit(context.elkResult, 0, 0)
      const incidences: typeof snapshots[number]['incidences'] = []
      for (const { host, x, y } of hosted) for (const candidate of host.edges ?? []) {
        const edge = candidate as ElkExtendedEdge
        for (const [ids, key] of [[edge.sources, 'startPoint'], [edge.targets, 'endPoint']] as const) {
          for (const id of ids) {
            const port = ports.get(id)
            if (!port) continue
            // Each retained occurrence in these two fixtures has one section.
            if (edge.sections?.length !== 1) throw new Error(`Unexpected section topology for ${edge.id}`)
            const point = edge.sections[0]![key]
            incidences.push({ edge: edge.id, port: id, expected: port, actual: { x: point.x + x, y: point.y + y } })
          }
        }
      }
      snapshots.push({ hierarchy: context.elkResult.layoutOptions?.['elk.hierarchyHandling'], portCount: ports.size, incidences })
    } catch (error) { observationError = error }
    return run(context)
  }
  let value: T
  try { value = produce() } finally { pass.run = run }
  // Observation errors fail as test-harness errors outside canonical fallback.
  expect(observationError, 'raw boundary observation failed').toBeUndefined()
  return { value, snapshots }
}

function expectSharedHierarchyPorts(snapshots: ReturnType<typeof observeHierarchyPorts>['snapshots'], ports: number) {
  const separate = snapshots.filter(snapshot => snapshot.hierarchy === 'SEPARATE')
  expect(separate.length).toBeGreaterThan(0)
  for (const snapshot of separate) {
    expect(snapshot.portCount).toBe(ports)
    expect(snapshot.incidences).toHaveLength(2 * ports)
    for (const incidence of snapshot.incidences) {
      expect(incidence.actual, `${incidence.edge} shares ${incidence.port}`).toEqual(incidence.expected)
    }
  }
}

describe('hierarchy parameter compatibility', () => {
  test('nested-only overrides select separate layout and pass their direction to descendants', () => {
    const graph = parseMermaid(`flowchart LR
      subgraph Outer
        subgraph Inner
          direction TB
          subgraph Leaf
            A --> B
          end
        end
      end`)
    const elk = convertToElkFormat(graph)
    expect(elk.layoutOptions!['elk.hierarchyHandling']).toBe('SEPARATE')
    expect(hierarchyScope(elk, 'Outer').layoutOptions!['elk.direction']).toBe('RIGHT')
    expect(hierarchyScope(elk, 'Inner').layoutOptions!['elk.direction']).toBe('DOWN')
    expect(hierarchyScope(elk, 'Leaf').layoutOptions!['elk.direction']).toBe('DOWN')
  })

  test('requested separate scopes inherit direction while include input stays implicit', () => {
    const graph = parseMermaid('flowchart TB\nsubgraph G\nA --> B\nend')
    const included = convertToElkFormat(graph), separate = convertToElkFormat(graph, { separateHierarchy: true })
    expect(included.layoutOptions!['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN')
    expect(hierarchyScope(included, 'G').layoutOptions!['elk.direction']).toBeUndefined()
    expect(separate.layoutOptions!['elk.hierarchyHandling']).toBe('SEPARATE')
    expect(hierarchyScope(separate, 'G').layoutOptions!['elk.direction']).toBe('DOWN')
    // No synthetic ports exist here; forcing remains the established policy.
    expect(separate.layoutOptions!['elk.layered.crossingMinimization.forceNodeModelOrder']).toBe('true')
  })

  test.each([
    ['flat', 'flowchart TD\nA --> B'],
    ['aligned boundary', 'flowchart LR\nsubgraph G\nA --> B\nend\nX --> A'],
    ['same-axis reversed child', 'flowchart LR\nsubgraph G\ndirection RL\nA --> B\nend\nX --> A'],
  ])('%s keeps the original forced-order policy', (_name, source) => {
    const elk = convertToElkFormat(parseMermaid(source), { separateHierarchy: true })
    expect(elk.layoutOptions!['elk.layered.crossingMinimization.forceNodeModelOrder']).toBe('true')
    expect(elk.layoutOptions!['elk.layered.considerModelOrder.strategy']).toBe('NODES_AND_EDGES')
  })

  test.each([['TB', 'LR'], ['BT', 'RL'], ['LR', 'TB'], ['RL', 'BT']])(
    '%s parent permits fixed-port resolution for its %s child', (parent, child) => {
      const elk = convertToElkFormat(parseMermaid(`flowchart ${parent}\nsubgraph G\ndirection ${child}\nA --> B\nend\nX --> A`))
      expect(hierarchyScope(elk, 'G').ports).toHaveLength(1)
      expect(elk.layoutOptions!['elk.layered.crossingMinimization.forceNodeModelOrder']).toBe('false')
      expect(elk.layoutOptions!['elk.layered.considerModelOrder.strategy']).toBe('NODES_AND_EDGES')
    },
  )

  test('nested adjacency retains one feasible sibling order with coherent fixed ports', () => {
    const graph = parseMermaid(`flowchart LR
      subgraph Outer
        direction TB
        X[First]
        Y[Second]
        Z[Join]
        subgraph Inner
          direction LR
          A --> B
        end
        X --> Z
        Y --> Z
        Z --> A
      end`)
    const layoutHints = { adjacent: [['Y', 'X']], shortEdges: ['Z->A'] }
    const elk = convertToElkFormat(graph, { layoutHints }), outer = hierarchyScope(elk, 'Outer')
    expect(outer.children!.slice(0, 2).map(node => node.id)).toEqual(['Y', 'X'])
    expect(outer.layoutOptions!['elk.layered.crossingMinimization.forceNodeModelOrder']).toBe('false')
    expect(outer.layoutOptions!['elk.layered.considerModelOrder.strategy']).toBe('NODES_AND_EDGES')
    expect(outer.edges!.find(edge => edge.id === 'e3')!.layoutOptions!['elk.layered.priority.shortness']).toBe('100')
    expect(elk.layoutOptions!['elk.layered.crossingMinimization.forceNodeModelOrder']).toBe('true')

    const { value: positioned, snapshots } = observeHierarchyPorts(() => layoutGraphSync(graph, { layoutHints }))
    expectSharedHierarchyPorts(snapshots, 1)
    const node = (id: string) => positioned.nodes.find(candidate => candidate.id === id)!
    // This connected same-rank fan-in is a feasible preference witness, not an
    // absolute adjacency guarantee for arbitrary hinted diagrams.
    expect(node('Y').x).toBeLessThan(node('X').x)
    expect(node('Y').y).toBeCloseTo(node('X').y, 8)
    expect(positioned.nodes.map(candidate => candidate.id).sort()).toEqual(['A', 'B', 'X', 'Y', 'Z'])
    expect(positioned.edges.map(edge => [edge.source, edge.target]).sort()).toEqual([['A', 'B'], ['X', 'Z'], ['Y', 'Z'], ['Z', 'A']])
    expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    expect(auditRouteContracts(positioned, graph)).toEqual([])
    for (const edge of positioned.edges) for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!
      for (const card of positioned.nodes) {
        // The independently audited outward terminal ray may touch its own
        // outline; every other segment must clear that same card as well.
        if ((card.id === edge.source && i === 1) || (card.id === edge.target && i === edge.points.length - 1)) continue
        const clear = Math.max(a.x, b.x) <= card.x || Math.min(a.x, b.x) >= card.x + card.width
          || Math.max(a.y, b.y) <= card.y || Math.min(a.y, b.y) >= card.y + card.height
        expect(clear, `${edge.source}->${edge.target} clears ${card.id}'s full body`).toBe(true)
      }
    }
    const clearHeaders = (headers: typeof positioned.groups): void => {
      for (const group of headers) {
        expect(Number.isFinite(group.headerHeight)).toBe(true)
        const left = group.x, right = group.x + group.width, top = group.y, bottom = group.y + group.headerHeight!
        for (const edge of positioned.edges) for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1]!, b = edge.points[i]!
          const clear = Math.max(a.x, b.x) <= left || Math.min(a.x, b.x) >= right
            || Math.max(a.y, b.y) <= top || Math.min(a.y, b.y) >= bottom
          expect(clear, `${edge.source}->${edge.target} avoids all of ${group.id}'s header`).toBe(true)
        }
        clearHeaders(group.children)
      }
    }
    clearHeaders(positioned.groups)
  })

  test('the actual Cloud SVG retains four arrows without an opposing shared shaft', () => {
    const { value: { svg, receipt }, snapshots } = observeHierarchyPorts(() => renderMermaidSVGWithReceipt(HIERARCHY_PARAMETER_CLOUD, { embedFontImport: false }))
    expectSharedHierarchyPorts(snapshots, 4)
    expect(receipt.layoutCertification?.status).toBe('passed')
    const carriers = scanSvgStartTags(svg).filter(tag => decodedSvgAttributeValue(tag, 'data-role') === 'edge')
    expect(carriers).toHaveLength(4)
    expect(carriers.map(tag => [decodedSvgAttributeValue(tag, 'data-from'), decodedSvgAttributeValue(tag, 'data-to')]).sort())
      .toEqual([['A', 'B'], ['C', 'D'], ['E', 'A'], ['E', 'C']])
    const paths = carriers.map(tag => {
      expect(decodedSvgAttributeValue(tag, 'data-arrow-end')).toBe('true')
      expect(decodedSvgAttributeValue(tag, 'marker-end')).toMatch(/^url\(#.+\)$/)
      return decodedSvgAttributeValue(tag, 'points')!.trim().split(/\s+/).map(point => point.split(',').map(Number))
    })
    let opposing = 0
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
      for (let a = 1; a < paths[i]!.length; a++) for (let b = 1; b < paths[j]!.length; b++) {
        const p = paths[i]![a - 1]!, q = paths[i]![a]!, r = paths[j]![b - 1]!, s = paths[j]![b]!
        const horizontal = p[1] === q[1]
        if (horizontal !== (r[1] === s[1])) continue
        const axis = horizontal ? 0 : 1, cross = 1 - axis
        if (p[cross] !== r[cross]) continue
        const overlap = Math.min(Math.max(p[axis]!, q[axis]!), Math.max(r[axis]!, s[axis]!))
          - Math.max(Math.min(p[axis]!, q[axis]!), Math.min(r[axis]!, s[axis]!))
        if (overlap > 0 && (q[axis]! - p[axis]!) * (s[axis]! - r[axis]!) < 0) opposing++
      }
    }
    expect(opposing).toBe(0)
  })

  test('the browser rounded-fill fixture keeps its authored downward flow', () => {
    const source = `flowchart TD
  subgraph edge[Edge Layer]
    web[Web App]
  end
  subgraph core[Core Services]
    api[API]
    db[(Postgres)]
  end
  web --> api
  api --> db`
    // Exact editorHash payload resolution: crisp/seed0 is reset before the
    // status-dashboard Look and Salmon Palette, with strict SVG sink policy.
    const { svg, receipt } = renderMermaidSVGWithReceipt(source, {
      embedFontImport: false, security: 'strict', style: ['status-dashboard', 'salmon'],
    })
    expect(['passed', 'unverified']).toContain(receipt.layoutCertification?.status ?? '')
    const tags = scanSvgStartTags(svg), root = tags.find(tag => tag.name === 'svg')!
    const width = Number(decodedSvgAttributeValue(root, 'width')), height = Number(decodedSvgAttributeValue(root, 'height'))
    expect(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0).toBe(true)
    expect(height).toBeGreaterThan(width)
    expect(svg).toContain('A10,10')
    expect(svg).not.toContain('rx="18" ry="18" fill="var(--_group-hdr)"')
    expect(tags.filter(tag => tag.name === 'g' && decodedSvgAttributeValue(tag, 'class') === 'node'
      && decodedSvgAttributeValue(tag, 'data-role') === 'node').map(tag => decodedSvgAttributeValue(tag, 'data-id')).sort())
      .toEqual(['api', 'db', 'web'])
    // Styled paint primitives carry their own body roles beneath the authored
    // wrappers; retaining them must not double the authored subject count.
    expect(tags.filter(tag => decodedSvgAttributeValue(tag, 'data-role') === 'node'
      && decodedSvgAttributeValue(tag, 'data-id')?.startsWith('node-shape:')).map(tag => decodedSvgAttributeValue(tag, 'data-id')).sort())
      .toEqual(['node-shape:api', 'node-shape:db', 'node-shape:web'])
    const carriers = tags.filter(tag => decodedSvgAttributeValue(tag, 'data-role') === 'edge')
    expect(carriers).toHaveLength(2)
    expect(carriers.map(tag => [decodedSvgAttributeValue(tag, 'data-from'), decodedSvgAttributeValue(tag, 'data-to')]).sort())
      .toEqual([['api', 'db'], ['web', 'api']])
    for (const carrier of carriers) {
      const coordinates = (decodedSvgAttributeValue(carrier, 'points') ?? decodedSvgAttributeValue(carrier, 'd'))!
        .match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g)!.map(Number)
      expect(coordinates.length).toBeGreaterThanOrEqual(4)
      expect(coordinates.every(Number.isFinite)).toBe(true)
      expect(coordinates[coordinates.length - 1]!).toBeGreaterThan(coordinates[1]!)
      expect(decodedSvgAttributeValue(carrier, 'data-arrow-end')).toBe('true')
    }
  })

})

describe('protected UP synthetic boundary ports', () => {
  test('a titled inherited UP scope completes the safe incoming SOUTH side before ELK import', () => {
    const graph = parseMermaid('flowchart BT\nsubgraph S1\nA[One]\nend\nsubgraph S2\nB[Two]\nend\nA --> B')
    const elk = convertToElkFormat(graph, {separateHierarchy: true}), target = hierarchyScope(elk, 'S2')
    expect(target.layoutOptions!['elk.direction']).toBe('UP')
    expect(target.layoutOptions!['elk.portConstraints']).toBe('FIXED_SIDE')
    expect(target.ports).toHaveLength(1)
    expect(target.ports![0]!.layoutOptions?.['elk.port.side']).toBe('SOUTH')
    expect(hierarchyScope(elk, 'S1').ports![0]!.layoutOptions?.['elk.port.side']).toBe('EAST')
    expect(elk.layoutOptions!['elk.layered.crossingMinimization.forceNodeModelOrder']).toBe('false')
    expect(graph.direction).toBe('BT')
    expect(graph.subgraphs.map(group => [group.id, group.nodeIds])).toEqual([['S1', ['A']], ['S2', ['B']]])
  })

  test('both undefined UP roles retain their existing safe root-flow preferences when completed', () => {
    const elk = convertToElkFormat(parseMermaid('flowchart LR\nsubgraph G\ndirection BT\nA --> B\nend\nX --> A\nB --> Y'))
    const scope = hierarchyScope(elk, 'G')
    expect(scope.layoutOptions!['elk.direction']).toBe('UP')
    expect(scope.ports!.map(port => [port.id, port.layoutOptions?.['elk.port.side']])).toEqual([['G_in_1', 'WEST'], ['G_out_2', 'EAST']])
    expect(scope.children!.map(node => node.id)).toEqual(['A', 'B'])
  })

  test('an UP outgoing scope retains the existing safe SOUTH preference of its DOWN parent flow', () => {
    const elk = convertToElkFormat(parseMermaid('flowchart TD\nsubgraph G\ndirection BT\nA --> B\nend\nB --> X'))
    expect(hierarchyScope(elk, 'G').ports![0]!.layoutOptions?.['elk.port.side']).toBe('SOUTH')
    expect(elk.layoutOptions!['elk.layered.crossingMinimization.forceNodeModelOrder']).toBe('true')
  })

  test.each([['TD', 'WEST'], ['LR', undefined], ['RL', undefined]] as const)('the existing %s protected input policy is unchanged', (direction, incoming) => {
    const elk = convertToElkFormat(parseMermaid(`flowchart ${direction}\nsubgraph G\nA --> B\nend\nX --> A`), {separateHierarchy: true})
    expect(hierarchyScope(elk, 'G').ports![0]!.layoutOptions?.['elk.port.side']).toBe(incoming)
  })

  test('a headerless UP scope and authored external group contact receive no synthetic-side override', () => {
    const graph = parseMermaid('flowchart BT\nsubgraph G\nA --> B\nend\nX --> A')
    graph.subgraphs[0]!.concurrencyRegion = true
    const elk = convertToElkFormat(graph, {separateHierarchy: true})
    expect(hierarchyScope(elk, 'G').ports![0]!.layoutOptions?.['elk.port.side']).toBeUndefined()
    const external = convertToElkFormat(parseMermaid('flowchart BT\nsubgraph G\nA\nend\nG --> X'), {separateHierarchy: true})
    expect(hierarchyScope(external, 'G').ports).toBeUndefined()
    expect((external.edges![0] as ElkExtendedEdge).sources).toEqual(['G'])
  })

  test('the actual base BT SVG keeps coherent ports, upward flow and clear full headers', () => {
    const source = 'flowchart BT\nsubgraph S1\nA[One]\nend\nsubgraph S2\nB[Two]\nend\nA --> B'
    const {value: {svg, receipt}, snapshots} = observeHierarchyPorts(() => renderMermaidSVGWithReceipt(source, {embedFontImport: false}))
    expectSharedHierarchyPorts(snapshots, 2)
    expect(receipt.layoutCertification?.status).toBe('passed')
    const tags = scanSvgStartTags(svg), carriers = tags.filter(tag => decodedSvgAttributeValue(tag, 'data-role') === 'edge')
    expect(carriers).toHaveLength(1)
    const carrier = carriers[0]!
    expect([decodedSvgAttributeValue(carrier, 'data-from'), decodedSvgAttributeValue(carrier, 'data-to')]).toEqual(['A', 'B'])
    expect(decodedSvgAttributeValue(carrier, 'marker-end')).toMatch(/^url\(#.+\)$/)
    expect(decodedSvgAttributeValue(carrier, 'data-arrow-end')).toBe('true')
    expect(tags.filter(tag => tag.name === 'g' && decodedSvgAttributeValue(tag, 'class') === 'node').map(tag => decodedSvgAttributeValue(tag, 'data-id')).sort()).toEqual(['A', 'B'])
    const cards = new Map(tags.filter(tag => tag.name === 'rect' && decodedSvgAttributeValue(tag, 'data-id')?.startsWith('node-shape:')).map(tag => [decodedSvgAttributeValue(tag, 'data-id')!.slice(11), {
      x: Number(decodedSvgAttributeValue(tag, 'x')), y: Number(decodedSvgAttributeValue(tag, 'y')),
      width: Number(decodedSvgAttributeValue(tag, 'width')), height: Number(decodedSvgAttributeValue(tag, 'height')),
    }]))
    expect([...cards.keys()].sort()).toEqual(['A', 'B'])
    expect(cards.get('B')!.y + cards.get('B')!.height).toBeLessThan(cards.get('A')!.y)
    const points = decodedSvgAttributeValue(carrier, 'points')!.trim().split(/\s+/).map(value => {
      const [x, y] = value.split(',').map(Number); return {x: x!, y: y!}
    })
    const outward = (node: {x: number; y: number; width: number; height: number}, port: {x: number; y: number}, next: {x: number; y: number}) => {
      // Independent SVG12-significant-digit readback allowance for separately
      // emitted body extents; shaft normals remain strict and non-tangent.
      const noise = 1e-6
      return Math.abs(port.x - node.x) < noise && next.y === port.y && next.x < port.x
        || Math.abs(port.x - node.x - node.width) < noise && next.y === port.y && next.x > port.x
        || Math.abs(port.y - node.y) < noise && next.x === port.x && next.y < port.y
        || Math.abs(port.y - node.y - node.height) < noise && next.x === port.x && next.y > port.y
    }
    expect(outward(cards.get('A')!, points[0]!, points[1]!)).toBe(true)
    expect(outward(cards.get('B')!, points.at(-1)!, points.at(-2)!)).toBe(true)
    const bands = [...svg.matchAll(/<g\b[^>]*data-region="subgraph"[^>]*>\s*<rect\b[^>]*>\s*<path\b[^>]*d="([^"]+)"/g)].map(match => {
      const values = match[1]!.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)!.map(Number)
      expect(values).toHaveLength(5)
      return {x: values[0]!, y: values[1]!, width: values[2]! - values[0]!, height: values[3]! - values[1]!}
    })
    expect(bands).toHaveLength(2)
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!, b = points[index]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
      for (const band of bands) expect(Math.max(a.x, b.x) > band.x && Math.min(a.x, b.x) < band.x + band.width
        && Math.max(a.y, b.y) > band.y && Math.min(a.y, b.y) < band.y + band.height).toBe(false)
      for (const [id, card] of cards) {
        if (id === 'A' && index === 1 || id === 'B' && index === points.length - 1) continue
        expect(Math.max(a.x, b.x) > card.x && Math.min(a.x, b.x) < card.x + card.width
          && Math.max(a.y, b.y) > card.y && Math.min(a.y, b.y) < card.y + card.height).toBe(false)
      }
    }
  })
})
