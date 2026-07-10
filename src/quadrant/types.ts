// ============================================================================
// Quadrant chart types
//
// Models Mermaid quadrantChart diagrams in parsed and positioned form.
//
// Mermaid quadrantChart syntax (see
// skills/.../references/upstream/quadrantChart.md):
//   quadrantChart
//   title <text>
//   x-axis <left> --> <right>        (right side optional)
//   y-axis <bottom> --> <top>        (top side optional)
//   quadrant-1 <label>   top-right
//   quadrant-2 <label>   top-left
//   quadrant-3 <label>   bottom-left
//   quadrant-4 <label>   bottom-right
//   <Label>[:::class]: [x, y] [styles]   x,y in [0,1]
//   classDef <class> <styles>
//
// Per-point styling follows upstream (merged mermaid-js/mermaid#5173):
// radius / color / stroke-color / stroke-width, applied directly or via
// classDef + `:::` — see src/quadrant/point-style.ts (the single grammar and
// resolution site).
//
// Faithfulness contract (docs/project/lessons-learned.md, Loop 17 ER lesson):
// malformed lines (out-of-range coords, missing brackets, unknown statements,
// malformed style metadata) ERROR LOUDLY — they are never silently dropped.
// ============================================================================

import type { PositionedDiagram } from '../types.ts'
import type { QuadrantPointStyle, QuadrantClassDefs } from './point-style.ts'
import type { QuadrantVisualConfig } from './config.ts'

export type { QuadrantPointStyle, QuadrantClassDefs } from './point-style.ts'

/** A single plotted point. */
export interface QuadrantPoint {
  /** The point label (the text before the `:`). */
  label: string
  /** Normalized x in [0, 1] (0 = left, 1 = right). */
  x: number
  /** Normalized y in [0, 1] (0 = bottom, 1 = top). */
  y: number
  /** Optional `:::className` class assignment. */
  className?: string
  /** Optional direct styles (win over class styles). */
  style?: QuadrantPointStyle
}

/** Axis label pair. The "far" side is optional in the grammar. */
export interface QuadrantAxis {
  /** x-axis: left label / y-axis: bottom label. Always present once declared. */
  near: string
  /** x-axis: right label / y-axis: top label. Optional. */
  far?: string
}

/** Parsed quadrant chart — logical structure from Mermaid text. */
export interface QuadrantChart {
  /** Optional diagram title (`title <text>`). */
  title?: string
  /** x-axis labels (left / right). */
  xAxis?: QuadrantAxis
  /** y-axis labels (bottom / top). */
  yAxis?: QuadrantAxis
  /**
   * Quadrant region labels indexed 1..4 by Mermaid's numbering:
   *   1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
   * Stored as a 0-based array where index `n-1` holds quadrant-`n`.
   */
  quadrants: [string?, string?, string?, string?]
  /** Plotted points in source order. */
  points: QuadrantPoint[]
  /** classDef styles by class name, in source order (later wins on redefine). */
  classDefs: QuadrantClassDefs
}

// ============================================================================
// Positioned quadrant chart — ready for SVG rendering
// ============================================================================

export interface PositionedQuadrantRegion {
  /** Mermaid quadrant number 1..4. */
  number: 1 | 2 | 3 | 4
  /** Optional region label. */
  label?: string
  /** Background rectangle. */
  x: number
  y: number
  width: number
  height: number
  /** Centered label anchor. */
  labelX: number
  labelY: number
}

/** Axis-aligned label box in canvas pixels. */
export interface QuadrantLabelBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PositionedQuadrantPoint {
  label: string
  /** Original normalized coordinates. */
  nx: number
  ny: number
  /** Pixel center of the plotted circle. */
  cx: number
  cy: number
  /** Resolved radius (direct style > class style > config > default). */
  radius: number
  /** Resolved fill override; undefined = theme default paint. */
  fill?: string
  /** Resolved stroke override; undefined = theme default paint. */
  stroke?: string
  /** Resolved stroke-width override (may carry px); undefined = default. */
  strokeWidth?: string
  /** `:::` class name, emitted as an SVG CSS class on the circle. */
  className?: string
  /** Collision-avoiding label anchor position (layout-computed; the renderer
   *  never recomputes label geometry). */
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'end' | 'middle'
  /** The placed label's box — present iff the label is visible. */
  labelBox?: QuadrantLabelBox
  /** Leader line from the circle edge to a far-placed label (dense charts). */
  leader?: { x1: number; y1: number; x2: number; y2: number }
  /** True when placement hid this label (priority: source order wins). */
  labelHidden?: boolean
}

export interface PositionedQuadrantAxisLabel {
  text: string
  x: number
  y: number
  /** SVG text-anchor for this label. */
  anchor: 'start' | 'middle' | 'end'
  /** Resolved font size (per-axis config wins over the shared edge size). */
  fontSize: number
}

export interface PositionedQuadrantChart extends PositionedDiagram {
  width: number
  height: number
  title?: { text: string; x: number; y: number; fontSize: number }
  /** Square plot area bounds. */
  plot: { x: number; y: number; size: number }
  regions: PositionedQuadrantRegion[]
  points: PositionedQuadrantPoint[]
  axisLabels: PositionedQuadrantAxisLabel[]
  /** Resolved quadrantChart config the layout used — the renderer reads the
   *  SAME values (border widths, useMaxWidth) so paint cannot drift. */
  visual: QuadrantVisualConfig
}
