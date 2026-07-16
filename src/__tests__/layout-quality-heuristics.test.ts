import { describe, expect, test } from 'bun:test'

import { layoutMermaid, parseRegisteredMermaid as parseMermaid, verifyMermaid, measureQuality, checkQuality } from '../agent/index.ts'
import type { RenderedLayout, RenderedLayoutEdge, RenderedLayoutNode } from '../agent/types.ts'

function layoutOf(source: string): RenderedLayout {
  const parsed = parseMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const verify = verifyMermaid(parsed.value)
  expect(verify.ok).toBe(true)
  return layoutMermaid(parsed.value)
}

function centers(layout: RenderedLayout): Map<string, { x: number; y: number }> {
  return new Map(layout.nodes.map(n => [n.id, { x: n.x + n.w / 2, y: n.y + n.h / 2 }]))
}

function nonForwardEdges(layout: RenderedLayout, direction: 'TD' | 'BT' | 'LR' | 'RL'): string[] {
  const c = centers(layout)
  return layout.edges
    .filter(e => e.from !== e.to)
    .filter(e => {
      const from = c.get(e.from)
      const to = c.get(e.to)
      if (!from || !to) return true
      if (direction === 'TD') return from.y >= to.y
      if (direction === 'BT') return from.y <= to.y
      if (direction === 'LR') return from.x >= to.x
      return from.x <= to.x
    })
    .map(e => e.id)
}

function segmentIntersectsRect(a: [number, number], b: [number, number], n: RenderedLayoutNode): boolean {
  const minX = Math.min(a[0], b[0])
  const maxX = Math.max(a[0], b[0])
  const minY = Math.min(a[1], b[1])
  const maxY = Math.max(a[1], b[1])
  return maxX > n.x && minX < n.x + n.w && maxY > n.y && minY < n.y + n.h
}

function edgeNodeCollisions(layout: RenderedLayout): string[] {
  const hits: string[] = []
  for (const edge of layout.edges) {
    for (let i = 0; i < edge.path.length - 1; i++) {
      const a = edge.path[i]!
      const b = edge.path[i + 1]!
      for (const node of layout.nodes) {
        if (node.id === edge.from || node.id === edge.to) continue
        if (segmentIntersectsRect(a, b, node)) hits.push(`${edge.id}/${node.id}`)
      }
    }
  }
  return hits
}

function selfLoopClearance(layout: RenderedLayout, edge: RenderedLayoutEdge): number {
  const node = layout.nodes.find(n => n.id === edge.from)
  expect(node).toBeDefined()
  if (!node) return -Infinity
  const interior = edge.path.slice(1, -1)
  if (interior.length === 0) return -Infinity
  let min = Infinity
  // Endpoints intentionally touch the node boundary; measure the loop bend
  // segments that should sit visibly outside the node.
  for (const [x, y] of interior) {
    const dx = Math.max(node.x - x, 0, x - (node.x + node.w))
    const dy = Math.max(node.y - y, 0, y - (node.y + node.h))
    min = Math.min(min, Math.sqrt(dx * dx + dy * dy))
  }
  return min
}

describe('programmatic bad-layout heuristics', () => {
  test('acyclic fan-in/fan-out edges progress in the declared direction', () => {
    const fanIn = layoutOf(`flowchart TD
      A1 --> A
      A2 --> A
      B1 --> B
      B2 --> B
      A --> C
      B --> C`)
    expect(nonForwardEdges(fanIn, 'TD')).toEqual([])
    expect(edgeNodeCollisions(fanIn)).toEqual([])

    const fanOut = layoutOf(`flowchart LR
      A --> C
      B --> C
      C --> D
      C --> E`)
    expect(nonForwardEdges(fanOut, 'LR')).toEqual([])
    expect(edgeNodeCollisions(fanOut)).toEqual([])

    const bottomToTop = layoutOf(`flowchart BT
      A1 --> A
      A2 --> A
      B1 --> B
      B2 --> B
      A --> C
      B --> C`)
    expect(nonForwardEdges(bottomToTop, 'BT')).toEqual([])
    expect(edgeNodeCollisions(bottomToTop)).toEqual([])

    const rightToLeft = layoutOf(`flowchart RL
      A --> C
      B --> C
      C --> D
      C --> E`)
    expect(nonForwardEdges(rightToLeft, 'RL')).toEqual([])
    expect(edgeNodeCollisions(rightToLeft)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#815 — declared node/source order not preserved
  test('root nodes declared before top-level subgraphs stay before them', () => {
    const layout = layoutOf(`flowchart TD
      A[Root]
      subgraph G[Group]
        B[Inside]
      end`)
    const root = centers(layout).get('A')
    const group = layout.groups.find(g => g.id === 'G')

    expect(root).toBeDefined()
    expect(group).toBeDefined()
    expect(root!.x).toBeLessThan(group!.x + group!.w / 2)
  })

  test('feedback-heavy vertical processes stay vertical and route cleanly', () => {
    const layout = layoutOf(`flowchart TD
      A[User input] --> B[Research]
      B --> C[Validate research]
      C -->|pass| D[Plan]
      C -->|fail| B
      D --> E[Validate plan]
      E -->|pass| F[Launch]
      E -->|fail| D`)
    expect(layout.bounds.h).toBeGreaterThan(layout.bounds.w * 2)
    expect(edgeNodeCollisions(layout)).toEqual([])
    const metrics = measureQuality(layout)
    expect(metrics.edgeCrossings).toBe(0)
    expect(metrics.labelLegibility).toBe(1)
    expect(checkQuality(layout, { aspectBand: [0.1, 5] }).ranked.map(item => item.message)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#6336 (state) / #6049 (flowchart) — ugly self-loops
  test('self-loops stay outside the node and preserve legibility', () => {
    const layout = layoutOf(`flowchart TB
      start([Start])
      start --> green([Change some code])
      green --> finish([Finish])
      green -.->|Incomplete ?| green`)
    const loop = layout.edges.find(e => e.id === 'green->green')
    expect(loop).toBeDefined()
    expect(loop?.path.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(loop ? selfLoopClearance(layout, loop) : -Infinity).toBeGreaterThanOrEqual(8)
    expect(edgeNodeCollisions(layout)).toEqual([])
    expect(measureQuality(layout).labelLegibility).toBe(1)
  })
})
