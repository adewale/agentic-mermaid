// Regression: fan-out peers with differing label widths must be equalized and
// aligned (the "warnings"/"ok" symmetry).
//
// In `C -->|warnings| D["warnings"]` + `C -->|ok| E["ok"]`, D and E are genuine
// fan-out peers of C. ELK places them at different widths (97 vs 60) AND
// different main-axis positions (~32px apart, driven by that width gap), so they
// look mismatched. applySymmetricFanoutEmissions exists to equalize such peers,
// but its same-rank gate previously rejected any pair more than 28px apart —
// tighter than the very width-driven drift it was meant to absorb — so it bailed
// and the asymmetry stood. Widening that gate to 40 (still below layerSpacing,
// and AFTER the peer confirmation, so non-peers are never affected) lets the pass
// equalize them. Reverting the gate to 28 fails the assertions below.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid, layoutMermaid } from '../agent/index.ts'
import { parseMermaid as parseGraph } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { layoutFlow } from '../layout/geometry.ts'
import { doglegBetween, sourceEmissionPort, targetFlowPort } from '../layout/passes/shared.ts'
import { bundleEdgePaths } from '../layout/passes/edge-bundling.ts'
import { applySymmetricFanoutEmissions } from '../layout/passes/fanout.ts'
import { resolveRenderStyle } from '../styles.ts'
import { renderMermaidSVG } from '../index.ts'

const SYM = [
  'flowchart LR',
  '  A["warnings"] -->|warnings| B["ok"]',
  '  B -->|ok| C["rendered"]',
  '  A2["same word: warnings"] --> A',
  '  B2["same word: ok"] --> B',
  '  C -->|warnings| D["warnings"]',
  '  C -->|ok| E["ok"]',
].join('\n')

describe('fan-out peer symmetry', () => {
  for (const direction of ['TD', 'LR']) test(`grouped diamond targets keep their authored containment (${direction})`, () => {
    const source = `flowchart ${direction}
A[Christmas] -->|Get money| B(Go shopping)
B --> C{Let me think}
B --> G[/Another/]
C ==>|One| D[Laptop]
C -->|Two| E[iPhone]
C -->|Three| F[fa:fa-car Car]
subgraph section
C
D
E
F
G
end`
    const positioned = layoutGraphSync(parseGraph(source))
    const group = positioned.groups.find(group => group.id === 'section')!
    expect(group).toBeDefined()
    for (const id of ['C', 'D', 'E', 'F', 'G']) {
      const node = positioned.nodes.find(node => node.id === id)!
      expect(node.x).toBeGreaterThanOrEqual(group.x)
      expect(node.y).toBeGreaterThanOrEqual(group.y)
      expect(node.x + node.width).toBeLessThanOrEqual(group.x + group.width)
      expect(node.y + node.height).toBeLessThanOrEqual(group.y + group.height)
    }
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('iPhone')
    expect(svg).toContain('section')
  })
  test.each(['LR', 'RL', 'TD', 'BT'] as const)('an internal fork continues its admitted centre trunk (%s)', direction => {
    const graph = parseGraph(`flowchart ${direction}\nA-->C\nC-->D\nC-->E[Longer child]`)
    const { nodes, edges, groups } = layoutGraphSync(graph)
    const style = resolveRenderStyle()
    const forks = edges.filter(edge => edge.source === 'C')
    // The incoming route is explicitly centred so the test isolates the
    // writer from upstream differences in which port a layout happens to use.
    const incoming = edges.find(edge => edge.target === 'C')!
    const start = sourceEmissionPort(nodes.find(node => node.id === 'A')!, direction, 0, 1)
    const end = targetFlowPort(nodes.find(node => node.id === 'C')!, direction)
    const { main } = layoutFlow(direction)
    incoming.points = doglegBetween(start, end, direction, (start[main] + end[main]) / 2)
    const bundled = bundleEdgePaths(edges, nodes, groups, graph.direction, style)
    expect(forks.length).toBe(2)
    expect(forks.every(edge => bundled.has(edge))).toBe(true)
    const first = forks[0]!, second = forks[1]!
    const trunk = first.points.slice(0, 2).map(point => ({ ...point }))
    expect(second.points.slice(0, 2)).toEqual(trunk)
    expect(Math.hypot(trunk[1]!.x - trunk[0]!.x, trunk[1]!.y - trunk[0]!.y)).toBeGreaterThan(0)
    applySymmetricFanoutEmissions(nodes, edges, groups, graph, bundled, style)
    expect(first.points.slice(0, 2)).toEqual(trunk)
    expect(second.points.slice(0, 2)).toEqual(trunk)
    expect(first.points[0]).not.toBe(second.points[0])
    expect(first.points[1]).not.toBe(second.points[1])
  })
  test('peers with differing label widths are equalized to a common width and aligned', () => {
    const p = parseMermaid(SYM)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    const D = layout.nodes.find(n => n.id === 'D')!
    const E = layout.nodes.find(n => n.id === 'E')!
    expect(D).toBeDefined()
    expect(E).toBeDefined()
    // Equal width (both widened to the wider "warnings" box) ...
    expect(D.w).toBe(E.w)
    // ... and aligned on the main (flow) axis — LR ⇒ identical x.
    expect(D.x).toBe(E.x)
  })
})
