import { describe, expect, test } from 'bun:test'

import {
  asFlowchart,
  checkQuality,
  layoutMermaid,
  measureQuality,
  mutate,
  parseMermaid,
  renderMermaidPNG,
  serializeMermaid,
  verifyMermaid,
} from '../agent/index.ts'
import type { FlowchartMutationOp, FlowchartValidDiagram } from '../agent/types.ts'

const EXPECTED_AUTH_FLOW_SOURCE = `---
title: Auth Flow
---
flowchart LR
  A[User] --> B[Login Page]
  B --> C{Valid Credentials?}
  C -->|No| B
  C -->|Yes| D{MFA Enabled?}
  D -->|Yes| E[Enter MFA Code]
  E --> F{Code Valid?}
  F -->|No| E
  D -->|No| G[Create Session]
  F -->|Yes| G
  G --> H[Dashboard]
`

const AUTH_FLOW_OPS: FlowchartMutationOp[] = [
  { kind: 'add_node', id: 'A', label: 'User' },
  { kind: 'add_node', id: 'B', label: 'Login Page' },
  { kind: 'add_node', id: 'C', label: 'Valid Credentials?', shape: 'diamond' },
  { kind: 'add_node', id: 'D', label: 'MFA Enabled?', shape: 'diamond' },
  { kind: 'add_node', id: 'E', label: 'Enter MFA Code' },
  { kind: 'add_node', id: 'F', label: 'Code Valid?', shape: 'diamond' },
  { kind: 'add_node', id: 'G', label: 'Create Session' },
  { kind: 'add_node', id: 'H', label: 'Dashboard' },
  { kind: 'add_edge', from: 'A', to: 'B' },
  { kind: 'add_edge', from: 'B', to: 'C' },
  { kind: 'add_edge', from: 'C', to: 'B', label: 'No' },
  { kind: 'add_edge', from: 'C', to: 'D', label: 'Yes' },
  { kind: 'add_edge', from: 'D', to: 'E', label: 'Yes' },
  { kind: 'add_edge', from: 'E', to: 'F' },
  { kind: 'add_edge', from: 'F', to: 'E', label: 'No' },
  { kind: 'add_edge', from: 'D', to: 'G', label: 'No' },
  { kind: 'add_edge', from: 'F', to: 'G', label: 'Yes' },
  { kind: 'add_edge', from: 'G', to: 'H' },
]

function buildAuthFlowWithAgenticMermaid(): FlowchartValidDiagram {
  const parsed = parseMermaid('---\ntitle: Auth Flow\n---\nflowchart LR')
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('parse failed')

  const flow = asFlowchart(parsed.value)
  expect(flow).not.toBeNull()
  if (!flow) throw new Error('expected flowchart')
  let current: FlowchartValidDiagram = flow

  for (const op of AUTH_FLOW_OPS) {
    const next = mutate(current, op)
    expect({ op, ok: next.ok, error: next.ok ? undefined : next.error }).toMatchObject({ op, ok: true })
    if (!next.ok) throw new Error(`mutate failed: ${JSON.stringify(next.error)}`)
    current = next.value
  }

  const verify = verifyMermaid(current)
  expect(verify.ok).toBe(true)
  expect(verify.warnings).toEqual([])
  return current
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('tweet auth-flow agent workflow', () => {
  test('builds the flowchart through typed mutations and returns a PNG', () => {
    const diagram = buildAuthFlowWithAgenticMermaid()
    expect(serializeMermaid(diagram)).toBe(EXPECTED_AUTH_FLOW_SOURCE)

    const png = renderMermaidPNG(diagram, { fitTo: { width: 1600 }, background: '#f8f7f4' })
    const size = pngSize(png)
    expect(size.width).toBe(1600)
    expect(size.height).toBeGreaterThan(0)
    expect(png.length).toBeGreaterThan(10_000)
  })

  test('keeps the primary LR path in source order and routes feedback edges backward', () => {
    const diagram = buildAuthFlowWithAgenticMermaid()
    const layout = layoutMermaid(diagram)
    const centers = new Map(layout.nodes.map(n => [n.id, n.x + n.w / 2]))

    for (const [left, right] of [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'G'], ['G', 'H']] as const) {
      expect(centers.get(left)!).toBeLessThan(centers.get(right)!)
    }

    for (const id of ['C->B', 'F->E']) {
      const edge = layout.edges.find(e => e.id === id)
      expect(edge).toBeDefined()
      const start = edge!.path[0]!
      const end = edge!.path[edge!.path.length - 1]!
      expect(start[0]).toBeGreaterThan(end[0])
    }
  })

  test('pins visual-quality signals beyond verify.ok', () => {
    const diagram = buildAuthFlowWithAgenticMermaid()
    const verify = verifyMermaid(diagram)
    expect(verify.ok).toBe(true)

    const layout = layoutMermaid(diagram)
    const metrics = measureQuality(layout)
    expect(metrics.edgeCrossings).toBe(0)
    expect(metrics.labelLegibility).toBe(1)
    expect(metrics.whitespaceBalance).toBeGreaterThan(0.05)
    expect(metrics.whitespaceBalance).toBeLessThan(0.55)
    expect(metrics.aspectRatio).toBeLessThanOrEqual(7)

    const verdict = checkQuality(layout, { aspectBand: [0.2, 7] })
    expect(verdict).toMatchObject({ ok: true, violations: [] })
  })
})
