// ============================================================================
// Sankey diagram types
//
// Models Mermaid sankey diagrams (v10.3.0+, headers `sankey` / `sankey-beta`)
// in parsed and positioned form.
//
// Mermaid sankey syntax is CSV (RFC 4180 subset, see the syntax page):
//   sankey
//
//   source,target,value
//   "quoted, source",target,value
//   ...
//
// Exactly three columns per row; empty lines are allowed; quoted fields may
// contain commas, and a doubled quote inside a quoted field is a literal
// quote. Values must be non-negative numbers. Nodes are implied by the labels
// appearing in source/target columns, in first-appearance order.
// ============================================================================

import type { PositionedDiagram } from '../types.ts'
import type { SankeyVisualConfig } from './config.ts'

/** One flow between two nodes (a parsed CSV row). */
export interface SankeyLink {
  /** Source node label, exactly as authored (after CSV unquoting). */
  source: string
  /** Target node label, exactly as authored (after CSV unquoting). */
  target: string
  /** Flow amount — a non-negative finite number. */
  value: number
}

/** Parsed sankey diagram — logical structure from Mermaid text. */
export interface SankeyDiagram {
  /** Optional diagram title (frontmatter `title:`). */
  title?: string
  /** Node labels in first-appearance order (source before target, row order). */
  nodes: string[]
  /** Flows in source order. Parallel duplicate flows are kept separate. */
  links: SankeyLink[]
}

// ============================================================================
// Positioned sankey diagram — ready for SVG rendering
// ============================================================================

export interface PositionedSankeyNode {
  /** The node label (node identity). */
  label: string
  /** Node throughput: max(sum of incoming, sum of outgoing). */
  value: number
  /** Horizontal layer index (0 = leftmost). */
  layer: number
  /** Node rectangle in final user units. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Label lines (name, plus the formatted value line when `showValues`). */
  labelLines: string[]
  /** Label anchor position and side. */
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'end'
}

export interface PositionedSankeyLink {
  /** Stable link id: `source→target` with an occurrence suffix for duplicates. */
  id: string
  source: string
  target: string
  value: number
  /** Centerline cubic Bézier path (`M sx y0 C mx y0, mx y1, tx y1`). */
  path: string
  /** Routed centerline projection of `path` for typed connector geometry. */
  points: Array<{ x: number; y: number }>
  /** Ribbon thickness (stroke width), value × vertical scale. */
  width: number
  /** Source/target attach coordinates of the centerline. */
  sx: number
  sy: number
  tx: number
  ty: number
}

export interface PositionedSankeyChart extends PositionedDiagram {
  width: number
  height: number
  title?: { text: string; x: number; y: number }
  /** Nodes in first-appearance order (palette/identity order). */
  nodes: PositionedSankeyNode[]
  /** Links in authored order (drawing order; stacking is per-node). */
  links: PositionedSankeyLink[]
  /** Sum of all link values (for the ASCII surface and tooling). */
  total: number
  /** Resolved sankey config knobs (paint half consumed by the renderer). */
  visual: SankeyVisualConfig
}
