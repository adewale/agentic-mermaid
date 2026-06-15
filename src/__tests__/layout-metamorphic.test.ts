import { describe, expect, test } from 'bun:test'

import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { parseMermaid } from '../parser.ts'
import { auditRouteContracts } from '../route-contracts.ts'
import type { MermaidGraph, PositionedEdge } from '../types.ts'

function cleanLayout(source: string): { graph: MermaidGraph; edgeSummary: string[] } {
  const graph = parseMermaid(source)
  const positioned = layoutGraphSync(graph)
  expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
  expect(auditRouteContracts(positioned, graph)).toEqual([])
  return {
    graph,
    edgeSummary: positioned.edges.map(edgeContractSummary),
  }
}

function edgeContractSummary(edge: PositionedEdge): string {
  const cert = edge.routeCertificate
  return [
    edge.style,
    edge.hasArrowStart ? 'start' : 'nostart',
    edge.hasArrowEnd ? 'end' : 'noend',
    cert?.routeClass ?? 'missing-class',
    cert?.invariant ?? 'missing-invariant',
    cert?.bendCount ?? 'missing-bends',
    cert?.sourcePort ?? 'missing-source-port',
    cert?.targetPort ?? 'missing-target-port',
  ].join(':')
}

function withoutBendCounts(summary: string): string {
  return summary.split(':').filter((_part, index) => index !== 5).join(':')
}

describe('layout metamorphic properties', () => {
  test('renaming node IDs preserves route contracts and audit cleanliness', () => {
    const before = cleanLayout(`flowchart LR
  Start --> Choice{Choose}
  Choice -->|Yes| Ship[Ship]
  Choice -->|No| Queue[Queue]
  Queue --> Choice`)
    const after = cleanLayout(`flowchart LR
  Alpha --> Beta{Choose}
  Beta -->|Yes| Gamma[Ship]
  Beta -->|No| Delta[Queue]
  Delta --> Beta`)
    expect(after.edgeSummary).toEqual(before.edgeSummary)
  })

  test('LR/RL mirror keeps the same route contract classes', () => {
    const lr = cleanLayout(`flowchart LR
  A --> B{Gate}
  B --> C
  D --> B
  C --> A`)
    const rl = cleanLayout(`flowchart RL
  A --> B{Gate}
  B --> C
  D --> B
  C --> A`)
    expect(rl.edgeSummary.map(s => s.replace(/:E|:W/g, ':H'))).toEqual(lr.edgeSummary.map(s => s.replace(/:E|:W/g, ':H')))
  })

  test('adding an isolated node does not perturb existing route contracts', () => {
    const base = cleanLayout(`flowchart TD
  A --> B
  B --> C
  A --> D
  D --> C`)
    const withIsolated = cleanLayout(`flowchart TD
  A --> B
  B --> C
  A --> D
  D --> C
  Z[Isolated]`)
    expect(withIsolated.edgeSummary).toEqual(base.edgeSummary)
  })

  test('wrapping a graph in a subgraph preserves route-contract cleanliness', () => {
    const base = cleanLayout(`flowchart LR
  A --> B
  B --> C
  A --> D
  D --> C`)
    const wrapped = cleanLayout(`flowchart LR
  subgraph Wrapped
    A --> B
    B --> C
    A --> D
    D --> C
  end`)
    expect(wrapped.edgeSummary.map(withoutBendCounts)).toEqual(base.edgeSummary.map(withoutBendCounts))
  })
})
