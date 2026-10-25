import { beforeAll, describe, expect, test } from 'bun:test'

import { knownStyles, renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt } from '../agent/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
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
