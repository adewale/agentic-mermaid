import { beforeAll, describe, expect, test } from 'bun:test'

import { knownStyles, renderMermaidSVG } from '../index.ts'
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

function assertCleanHierarchyCase(source: string, from: string, to: string): void {
  const graph = parseMermaid(source)
  const positioned = layoutGraphSync(graph)
  const edge = positioned.edges.find(e => e.source === from && e.target === to)
  expect(edge, `${from}->${to} edge should be present`).toBeDefined()
  expect(edge!.points.length).toBeGreaterThanOrEqual(2)
  expect(edge!.points.every(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))).toBe(true)
  expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
  expect(auditRouteContracts(positioned, graph)).toEqual([])
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

  for (const direction of ['LR', 'RL', 'TB', 'BT']) {
    for (const [from, to] of [['X', 'B'], ['B', 'Outer'], ['Outer', 'B']] as const) {
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
        }
        expect(renderMermaidSVG(source)).toContain('request')
      })
    }
  }

  test('authored identifiers resembling boundary ports retain their own endpoints', () => {
    const source = `flowchart LR
      Box_out_0[Client]
      subgraph Box
        direction TB
        sign_in_worker[Worker]
      end
      sign_in_worker -->|reply| Box_out_0`
    assertCleanHierarchyCase(source, 'sign_in_worker', 'Box_out_0')
    const layout = layoutMermaidWithReceipt(source, { debug: true }).layout
    expect(layout.nodes.map(node => node.id).sort()).toEqual(['Box_out_0', 'sign_in_worker'])
    expect(layout.edges.map(edge => ({ from: edge.from, to: edge.to })))
      .toEqual([{ from: 'sign_in_worker', to: 'Box_out_0' }])
    expect(renderMermaidSVG(source)).toContain('reply')
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

// A group's title may widen it (only SEPARATE hierarchy handling honors the
// minimum width), but a title that fits must not change the INCLUDE_CHILDREN
// layout: the group still holds exactly its padding around its content.
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
  test('a group whose title fits holds exactly its bottom padding below its content, in every style', () => {
    for (const name of [undefined, ...knownStyles()]) {
      const { style, face } = resolveStyleStackWithFace(name)
      const options = { style, styleFace: face }
      const positioned = layoutGraphSync(parseMermaid(TITLED_GROUPS), options)
      const group = positioned.groups.find(candidate => candidate.id === 'edge')!
      const web = positioned.nodes.find(candidate => candidate.id === 'web')!
      expect(group.y + group.height - (web.y + web.height), name ?? 'default')
        .toBeCloseTo(resolveRenderStyle(options, undefined, face).groupPaddingY, 1)
    }
  })
})
