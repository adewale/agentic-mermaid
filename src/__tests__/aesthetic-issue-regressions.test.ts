// ============================================================================
// Issue-keyed regression fixtures for the layout-aesthetic complaints catalogued
// in docs/mermaid-layout-complaints.md (the C2–C13 clusters) and
// docs/issue-derived-test-cases.md.
//
// Why this file exists: the *behavior* behind these upstream complaints was
// already guarded by the general ugly-detector (eval/ugly-detector/detect.ts),
// the route certificates, and the perceptual quality metrics — but no test was
// keyed to the upstream issue number, so `git grep '#6476'` found only docs.
// Each test below takes a small graph that represents one upstream complaint and
// asserts, through the real renderer, that Agentic Mermaid does not exhibit it.
//
// These are "we don't have that complaint" guards, not "we fixed Mermaid":
// every cited issue is a bug in mermaid-js's own (dagre) renderer, which this
// fork does not share. See docs/mermaid-layout-complaints.md Part 2 (R4) and
// the Q1 caveat in that doc.
// ============================================================================

import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { detectSvg, type Finding } from '../../eval/ugly-detector/detect.ts'
import { parseMermaid, layoutMermaid, measureQuality } from '../agent/index.ts'

/** Hard geometric defects from the ugly-detector on real renderer output. */
function hardFindings(src: string): Finding[] {
  return detectSvg(renderMermaidSVG(src, { embedFontImport: false })).filter(f => f.severity === 'hard')
}

function crossings(src: string): number {
  const p = parseMermaid(src)
  if (!p.ok) throw new Error('parse failed')
  return measureQuality(layoutMermaid(p.value)).edgeCrossings
}

describe('layout-aesthetic regression fixtures (issue-keyed)', () => {
  // upstream: mermaid-js/mermaid#6476 — "Unnecessary crossing of edges between
  // nodes": dagre crosses two edges that could be uncrossed by swapping
  // endpoints. K2,2 is planar, so a faithful layout has zero crossings.
  test('#6476 avoidable edge crossings: a planar bipartite graph renders with none', () => {
    const src = 'flowchart LR\n  A --> C\n  B --> D\n  A --> D\n  B --> C'
    expect(crossings(src)).toBe(0)
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#5601 — "stateDiagrams overlap edges even if the
  // diagram is planar". The same small planar state machine must stay planar.
  test('#5601 planar state diagram is rendered planar (no edge crossings)', () => {
    const src = 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> Idle\n  Running --> [*]'
    expect(crossings(src)).toBe(0)
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#5060 — "Avoidable overlapping curves in
  // flow-chart": parallel edges between the same pair must not collapse into one
  // another or produce geometric defects. (Label-vs-label proximity is a known
  // metric gap; this guards the curve geometry and crossing count.)
  test('#5060 parallel labeled edges do not overlap into geometric defects', () => {
    const src = 'flowchart LR\n  A -->|first| B\n  A -->|second| B\n  B --> C'
    expect(crossings(src)).toBe(0)
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#2792 — "graph lines sometimes overlap boxes":
  // a transitive edge (A->C alongside A->B->C) must route around B, never
  // through its interior. The detector flags any edge-through-node as hard.
  test('#2792 a transitive edge does not pass through an intervening node', () => {
    const src = 'flowchart TD\n  A --> B\n  B --> C\n  A --> C'
    expect(hardFindings(src).filter(f => f.kind === 'edge-through-node')).toEqual([])
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#2131 — "State diagram: mis-aligned labels".
  // Edge labels on multiple edges between a pair must keep clear distance from
  // unrelated nodes (no label landing on a third node).
  test('#2131 edge labels keep clearance from unrelated nodes', () => {
    const src = 'flowchart LR\n  A -->|yes| B\n  A -->|no| B\n  B --> C'
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    const m = measureQuality(layoutMermaid(p.value))
    expect(m.labelEdgeProximity).toBeGreaterThan(4) // default min in checkQuality
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#6336 — "Self-edges/loops look very awkward in
  // state diagrams" (and #6049 for flowcharts): a self-loop must stay on the
  // node outline (no floating endpoint) and not cross the node interior.
  test('#6336 / #6049 a self-loop renders with endpoints on the outline, no defects', () => {
    const src = 'flowchart TD\n  A --> B\n  B --> B\n  B --> C'
    const p = parseMermaid(src)
    if (!p.ok) throw new Error('parse failed')
    const layout = layoutMermaid(p.value)
    expect(layout.edges.some(e => e.from === 'B' && e.to === 'B')).toBe(true) // self-loop survives
    expect(hardFindings(src)).toEqual([]) // no floating-endpoint / edge-through-node / hitch
  })
})
