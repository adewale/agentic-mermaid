import { describe, expect, test } from 'bun:test'

import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { parseMermaid } from '../parser.ts'
import { auditRouteContracts } from '../route-contracts.ts'

const SUPPORTED_ENDPOINT_CASES = ([
  ['INCLUDE_CHILDREN', false, 'X', 'A'],
  ['INCLUDE_CHILDREN', false, 'X', 'B'],
  ['INCLUDE_CHILDREN', false, 'X', 'Inner'],
  ['INCLUDE_CHILDREN', false, 'X', 'Outer'],
  ['INCLUDE_CHILDREN', false, 'A', 'X'],
  ['INCLUDE_CHILDREN', false, 'A', 'B'],
  ['INCLUDE_CHILDREN', false, 'A', 'Inner'],
  ['INCLUDE_CHILDREN', false, 'B', 'X'],
  ['INCLUDE_CHILDREN', false, 'B', 'A'],
  ['INCLUDE_CHILDREN', false, 'Inner', 'X'],
  ['INCLUDE_CHILDREN', false, 'Inner', 'A'],
  ['INCLUDE_CHILDREN', false, 'Outer', 'X'],
  ['SEPARATE', true, 'X', 'A'],
  ['SEPARATE', true, 'X', 'Inner'],
  ['SEPARATE', true, 'X', 'Outer'],
  ['SEPARATE', true, 'A', 'X'],
  ['SEPARATE', true, 'A', 'B'],
  ['SEPARATE', true, 'A', 'Inner'],
  ['SEPARATE', true, 'A', 'Outer'],
  ['SEPARATE', true, 'B', 'A'],
  ['SEPARATE', true, 'B', 'Inner'],
  ['SEPARATE', true, 'Inner', 'X'],
  ['SEPARATE', true, 'Inner', 'A'],
  ['SEPARATE', true, 'Inner', 'B'],
  ['SEPARATE', true, 'Inner', 'Outer'],
  ['SEPARATE', true, 'Outer', 'X'],
  ['SEPARATE', true, 'Outer', 'A'],
  ['SEPARATE', true, 'Outer', 'Inner'],
] as const).map(([mode, withDirectionOverride, from, to]) => [`${mode} ${from}->${to}`, withDirectionOverride, from, to] as const)

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
  test.each(SUPPORTED_ENDPOINT_CASES)('%s routes without stale coordinates', (_name, withDirectionOverride, from, to) => {
    assertCleanHierarchyCase(nestedGraph(withDirectionOverride, from, to), from, to)
  })
})
