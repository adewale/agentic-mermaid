// ============================================================================
// Issue-keyed regression fixtures for the layout-aesthetic complaints catalogued
// in docs/mermaid-layout-complaints.md (the C2–C13 clusters) and
// docs/issue-derived-test-cases.md.
//
// Why this file exists: the general ugly-detector, route certificates, and
// perceptual quality metrics already guarded many of these behaviors, but the
// supported cases lacked issue-keyed fixtures, so `git grep '#6476'` found only
// docs. Each test below takes a small graph that represents one upstream
// complaint and asserts, through the real renderer, that Agentic Mermaid does
// not exhibit it.
//
// These are "we don't have that complaint" guards, not "we fixed Mermaid":
// every cited issue is a bug in mermaid-js's own (dagre) renderer, which this
// fork does not share. See docs/mermaid-layout-complaints.md Part 2 (R4) and
// the Q1 caveat in that doc.
// ============================================================================

import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { detectSvg, parseSvg, type Finding, type Rendered } from '../../eval/ugly-detector/detect.ts'
import { parseRegisteredMermaid as parseMermaid, layoutMermaid, measureQuality, type QualityMetrics } from '../agent/index.ts'

function renderedSvg(src: string): string {
  return renderMermaidSVG(src, { embedFontImport: false })
}

function rendered(src: string): Rendered {
  return parseSvg(renderedSvg(src))
}

/** Hard geometric defects from the ugly-detector on real renderer output. */
function hardFindings(src: string): Finding[] {
  return detectSvg(renderedSvg(src)).filter(f => f.severity === 'hard')
}

function quality(src: string): QualityMetrics {
  const p = parseMermaid(src)
  if (!p.ok) throw new Error('parse failed')
  return measureQuality(layoutMermaid(p.value))
}

function assertRendered(src: string, nodes: string[], edges: Array<[string, string, number?]>): Rendered {
  const r = rendered(src)
  for (const id of nodes) expect(r.nodes.some(n => n.id === id)).toBe(true)
  for (const [from, to, count = 1] of edges) {
    expect(r.edges.filter(e => e.from === from && e.to === to)).toHaveLength(count)
  }
  return r
}

function edgePathSignature(edge: Rendered['edges'][number]): string {
  return edge.pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

function expectDistinctRenderedEdgePaths(r: Rendered, from: string, to: string): void {
  const paths = r.edges.filter(e => e.from === from && e.to === to).map(edgePathSignature)
  expect(new Set(paths).size).toBe(paths.length)
}

interface Rect { x: number; y: number; w: number; h: number }
interface EdgeLabel extends Rect { from: string; to: string; label: string }

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of raw.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)) out[m[1]!] = m[2]!
  return out
}

function hasClass(a: Record<string, string>, cls: string): boolean {
  return (a.class ?? '').split(/\s+/).includes(cls)
}

function numberAttr(a: Record<string, string>, name: string): number {
  const n = Number(a[name])
  if (!Number.isFinite(n)) throw new Error(`missing numeric attribute ${name}`)
  return n
}

function edgeLabels(src: string): EdgeLabel[] {
  const svg = renderedSvg(src)
  const out: EdgeLabel[] = []
  for (const g of svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)) {
    const ga = attrs(g[1]!)
    if (!hasClass(ga, 'edge-label')) continue
    const rect = g[2]!.match(/<rect\b([^>]*)/)
    if (!rect) throw new Error(`edge label ${ga['data-from'] ?? '?'}->${ga['data-to'] ?? '?'} has no halo rect`)
    const ra = attrs(rect[1]!)
    out.push({
      from: ga['data-from'] ?? '',
      to: ga['data-to'] ?? '',
      label: ga['data-label'] ?? '',
      x: numberAttr(ra, 'x'),
      y: numberAttr(ra, 'y'),
      w: numberAttr(ra, 'width'),
      h: numberAttr(ra, 'height'),
    })
  }
  return out
}

function expectEdgeLabels(src: string, labels: Array<[string, string, string]>): EdgeLabel[] {
  const actual = edgeLabels(src)
  for (const [from, to, label] of labels) {
    expect(actual.some(l => l.from === from && l.to === to && l.label === label)).toBe(true)
  }
  return actual
}

function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)))
  return Math.hypot(dx, dy)
}

function expectLabelBoxesSeparated(labels: EdgeLabel[]): void {
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      expect(rectDistance(labels[i]!, labels[j]!)).toBeGreaterThan(0)
    }
  }
}

describe('layout-aesthetic regression fixtures (issue-keyed)', () => {
  // upstream: mermaid-js/mermaid#6476 — "Unnecessary crossing of edges between
  // nodes": dagre crosses two edges that could be uncrossed by swapping
  // endpoints. K2,2 is planar, so a faithful layout has zero crossings.
  test('#6476 avoidable edge crossings: a planar bipartite graph renders with none', () => {
    const src = 'flowchart LR\n  A --> C\n  B --> D\n  A --> D\n  B --> C'
    assertRendered(src, ['A', 'B', 'C', 'D'], [['A', 'C'], ['B', 'D'], ['A', 'D'], ['B', 'C']])
    expect(quality(src).edgeCrossings).toBe(0)
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#5601 — "stateDiagrams overlap edges even if the
  // diagram is planar". The same small planar state machine must stay planar.
  test('#5601 planar state diagram is rendered planar (no edge crossings)', () => {
    const src = 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> Idle\n  Running --> [*]'
    assertRendered(src, ['Idle', 'Running'], [['_start', 'Idle'], ['Idle', 'Running'], ['Running', 'Idle'], ['Running', '_end']])
    expect(quality(src).edgeCrossings).toBe(0)
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#5060 — "Avoidable overlapping curves in
  // flow-chart": parallel edges between the same pair must not collapse into one
  // another, overlap labels, or produce geometric defects.
  test('#5060 parallel labeled edges do not overlap into geometric defects', () => {
    const src = 'flowchart LR\n  A -->|first| B\n  A -->|second| B\n  B --> C'
    const r = assertRendered(src, ['A', 'B', 'C'], [['A', 'B', 2], ['B', 'C']])
    expectDistinctRenderedEdgePaths(r, 'A', 'B')
    const labels = expectEdgeLabels(src, [['A', 'B', 'first'], ['A', 'B', 'second']])
    expectLabelBoxesSeparated(labels.filter(l => l.from === 'A' && l.to === 'B'))
    expect(quality(src).edgeCrossings).toBe(0)
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#2792 — "graph lines sometimes overlap boxes":
  // a transitive edge (A->C alongside A->B->C) must route around B, never
  // through its interior. The detector flags any edge-through-node as hard.
  test('#2792 a transitive edge does not pass through an intervening node', () => {
    const src = 'flowchart TD\n  A --> B\n  B --> C\n  A --> C'
    assertRendered(src, ['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['A', 'C']])
    expect(hardFindings(src).filter(f => f.kind === 'edge-through-node')).toEqual([])
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#2131 — "State diagram: mis-aligned labels".
  // Edge labels on multiple edges between a pair must keep clear distance from
  // unrelated nodes (no label landing on a third node).
  test('#2131 edge labels keep clearance from unrelated nodes', () => {
    const src = 'stateDiagram-v2\n  A --> B: yes\n  A --> B: no\n  B --> C'
    assertRendered(src, ['A', 'B', 'C'], [['A', 'B', 2], ['B', 'C']])
    const labels = expectEdgeLabels(src, [['A', 'B', 'yes'], ['A', 'B', 'no']])
    expectLabelBoxesSeparated(labels.filter(l => l.from === 'A' && l.to === 'B'))
    const m = quality(src)
    expect(m.labelEdgeProximity).toBeGreaterThan(4) // default min in checkQuality
    expect(hardFindings(src)).toEqual([])
  })

  // upstream: mermaid-js/mermaid#6336 — "Self-edges/loops look very awkward in
  // state diagrams" (and #6049 for flowcharts): a self-loop must stay on the
  // node outline (no floating endpoint) and not cross the node interior.
  test('#6336 / #6049 a self-loop renders with endpoints on the outline, no defects', () => {
    const state = 'stateDiagram-v2\n  A --> B\n  B --> B: retry\n  B --> C'
    const flowchart = 'flowchart TD\n  A --> B\n  B --> B\n  B --> C'

    const p = parseMermaid(state)
    if (!p.ok) throw new Error('parse failed')
    const layout = layoutMermaid(p.value)
    assertRendered(state, ['A', 'B', 'C'], [['A', 'B'], ['B', 'B'], ['B', 'C']])
    expectEdgeLabels(state, [['B', 'B', 'retry']])
    expect(layout.edges.some(e => e.from === 'B' && e.to === 'B')).toBe(true) // self-loop survives
    expect(hardFindings(state)).toEqual([]) // no floating-endpoint / edge-through-node / hitch

    assertRendered(flowchart, ['A', 'B', 'C'], [['A', 'B'], ['B', 'B'], ['B', 'C']])
    expect(hardFindings(flowchart)).toEqual([])
  })
})
