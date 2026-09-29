import { describe, expect, test } from 'bun:test'

import { knownStyles } from '../index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { parseMermaid } from '../parser.ts'
import { auditRouteContracts } from '../route-contracts.ts'
import { resolveStyleStackWithFace } from '../scene/style-registry.ts'
import { resolveRenderStyle } from '../styles.ts'

// The whole bounded model: every ordered pair of distinct endpoints among a
// top-level node (X), a node in Outer (A), a node in Inner (B), and the two
// subgraphs themselves, under both hierarchy modes (SEPARATE is what a
// direction override inside a subgraph selects).
const ENDPOINTS = ['X', 'A', 'B', 'Inner', 'Outer'] as const
const MODES = [['INCLUDE_CHILDREN', false], ['SEPARATE', true]] as const

// Pairs that do NOT route cleanly today, each with its current failure. These
// are product limitations, pinned below with test.failing so a fix is noticed:
// BUG-42 (TODO.md): with direction overrides, an edge
// between Inner's child and the enclosing Outer makes ELK throw
// UnsupportedGraphException, so the render fails (CLI RENDER_FAILED).
// BUG-43 (TODO.md): other edges between a subgraph and
// its own descendants, or across both levels, break a hard rubric metric or a
// route contract (verify reports them; the render does not fail).
const KNOWN_UNSUPPORTED: Readonly<Record<string, string>> = {
  'INCLUDE_CHILDREN A->Outer': 'BUG-43 offOutlineEndpoints',
  'INCLUDE_CHILDREN B->Inner': 'BUG-43 edgeThroughNode (through A)',
  'INCLUDE_CHILDREN B->Outer': 'BUG-43 edgeThroughNode (through X)',
  'INCLUDE_CHILDREN Inner->B': 'BUG-43 offOutlineEndpoints',
  'INCLUDE_CHILDREN Inner->Outer': 'BUG-43 ROUTE_CONTAINER_MISANCHOR',
  'INCLUDE_CHILDREN Outer->A': 'BUG-43 offOutlineEndpoints',
  'INCLUDE_CHILDREN Outer->B': 'BUG-43 edgeThroughNode (through A)',
  'INCLUDE_CHILDREN Outer->Inner': 'BUG-43 ROUTE_CONTAINER_MISANCHOR',
  'SEPARATE X->B': 'BUG-43 offOutlineEndpoints',
  'SEPARATE B->Outer': 'BUG-42 ELK UnsupportedGraphException',
  'SEPARATE Outer->B': 'BUG-42 ELK UnsupportedGraphException',
}

const ALL_ENDPOINT_CASES = MODES.flatMap(([mode, withDirectionOverride]) =>
  ENDPOINTS.flatMap(from => ENDPOINTS.filter(to => to !== from).map(to => [`${mode} ${from}->${to}`, withDirectionOverride, from, to] as const)))
const SUPPORTED_ENDPOINT_CASES = ALL_ENDPOINT_CASES.filter(([name]) => !(name in KNOWN_UNSUPPORTED))
const UNSUPPORTED_ENDPOINT_CASES = ALL_ENDPOINT_CASES.filter(([name]) => name in KNOWN_UNSUPPORTED)

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
  test('covers the whole model: 2 modes x 20 ordered endpoint pairs', () => {
    expect(ALL_ENDPOINT_CASES).toHaveLength(40)
    expect(Object.keys(KNOWN_UNSUPPORTED).filter(name => !ALL_ENDPOINT_CASES.some(([caseName]) => caseName === name))).toEqual([])
  })

  test.each(SUPPORTED_ENDPOINT_CASES)('%s routes without stale coordinates', (_name, withDirectionOverride, from, to) => {
    assertCleanHierarchyCase(nestedGraph(withDirectionOverride, from, to), from, to)
  })

  // Pinned limitations (see KNOWN_UNSUPPORTED). A case that starts passing
  // fails here: move it back to the supported set.
  test.failing.each(UNSUPPORTED_ENDPOINT_CASES)('%s (known unsupported) routes without stale coordinates', (_name, withDirectionOverride, from, to) => {
    assertCleanHierarchyCase(nestedGraph(withDirectionOverride, from, to), from, to)
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
