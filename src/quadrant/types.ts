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
//   <Label>: [x, y]      x,y in [0,1]
//
// Faithfulness contract (docs/project/lessons-learned.md, Loop 17 ER lesson):
// malformed lines (out-of-range coords, missing brackets, unknown statements)
// ERROR LOUDLY — they are never silently dropped.
// ============================================================================

/** A single plotted point. */
export interface QuadrantPoint {
  /** The point label (the text before the `:`). */
  label: string
  /** Normalized x in [0, 1] (0 = left, 1 = right). */
  x: number
  /** Normalized y in [0, 1] (0 = bottom, 1 = top). */
  y: number
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
  /** Resolved fill (a CSS color-mix() expression, theme-variable driven). */
  fill: string
  /** Centered label anchor. */
  labelX: number
  labelY: number
}

export interface PositionedQuadrantPoint {
  label: string
  /** Original normalized coordinates. */
  nx: number
  ny: number
  /** Pixel center of the plotted circle. */
  cx: number
  cy: number
  radius: number
}

export interface PositionedQuadrantAxisLabel {
  text: string
  x: number
  y: number
  /** SVG text-anchor for this label. */
  anchor: 'start' | 'middle' | 'end'
}

export interface PositionedQuadrantChart {
  width: number
  height: number
  title?: { text: string; x: number; y: number }
  /** Square plot area bounds. */
  plot: { x: number; y: number; size: number }
  regions: PositionedQuadrantRegion[]
  points: PositionedQuadrantPoint[]
  axisLabels: PositionedQuadrantAxisLabel[]
}
