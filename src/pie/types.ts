// ============================================================================
// Pie chart types
//
// Models Mermaid pie chart diagrams in parsed and positioned form.
//
// Mermaid pie syntax:
//   pie [showData]
//   [title <text>]
//   "<label>" : <positive number>
//   ...
//
// `showData` renders the raw numeric value alongside each legend label.
// Values must be positive numbers (> 0); negative values are a hard error.
// ============================================================================

import type { PositionedDiagram } from '../types.ts'
import type { PieVisualConfig } from './config.ts'

/** A single labelled slice of the pie. */
export interface PieEntry {
  /** The slice label (contents of the `"..."` quotes). */
  label: string
  /** The slice value — a positive number (supported to two decimal places). */
  value: number
}

/** Parsed pie chart — logical structure from Mermaid text. */
export interface PieChart {
  /** Optional diagram title (`title <text>`). */
  title?: string
  /** When true (`pie showData`), render the numeric value after each label. */
  showData: boolean
  /** Slices in source order. Pie slices are drawn clockwise in this order. */
  entries: PieEntry[]
}

// ============================================================================
// Positioned pie chart — ready for SVG rendering
// ============================================================================

/** An on-slice percentage label, placed by the layout's collision policy. */
export interface PieSliceLabel {
  /** Display text (upstream format: integer percent + '%'). */
  text: string
  /** Label anchor (text-anchor: middle; vertically centered). */
  x: number
  y: number
  fontSize: number
}

export interface PositionedPieSlice {
  /** The original entry label. */
  label: string
  /** The original entry value. */
  value: number
  /** value / total, in [0, 1]. */
  fraction: number
  /** Start angle in radians (clockwise from 12 o'clock). */
  startAngle: number
  /** End angle in radians. */
  endAngle: number
  /** SVG path `d` attribute for the slice wedge (annular in donut mode). */
  path: string
  /**
   * On-slice percentage label. Absent when the label is suppressed by the
   * deterministic small-slice policy (rounds to "0%", doesn't fit its wedge,
   * or would overlap an already-placed neighbor label).
   */
  pctLabel?: PieSliceLabel
}

export interface PositionedPieLegendItem {
  label: string
  value: number
  fraction: number
  /** Top-left of the swatch. */
  x: number
  y: number
  swatchSize: number
  /** Baseline-ish y for the legend text. */
  textX: number
  textY: number
  /**
   * Display lines of the row (label lines from `<br/>`, with the value/percent
   * suffix riding on the last line). The renderer joins with '\n'; layout
   * measures each line so multiline rows size and clear correctly.
   */
  lines: string[]
}

export interface PositionedPieChart extends PositionedDiagram {
  width: number
  height: number
  title?: { text: string; x: number; y: number }
  /** Pie circle center + radius. */
  cx: number
  cy: number
  radius: number
  /** Donut hole radius (donutHole * radius); 0 for a plain pie. */
  innerRadius: number
  slices: PositionedPieSlice[]
  legend: PositionedPieLegendItem[]
  /** Whether numeric values are shown in the legend (`showData`). */
  showData: boolean
  /** Sum of all entry values (for percentage / value formatting). */
  total: number
  /** Resolved pie config/theme-variable knobs (paint half consumed by the renderer). */
  visual: PieVisualConfig
}
