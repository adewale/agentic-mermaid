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
  /** Resolved fill color (hex or a CSS var() reference). */
  color: string
  /** SVG path `d` attribute for the slice wedge. */
  path: string
}

export interface PositionedPieLegendItem {
  label: string
  value: number
  fraction: number
  color: string
  /** Top-left of the swatch. */
  x: number
  y: number
  swatchSize: number
  /** Baseline-ish y for the legend text. */
  textX: number
  textY: number
}

export interface PositionedPieChart {
  width: number
  height: number
  title?: { text: string; x: number; y: number }
  /** Pie circle center + radius. */
  cx: number
  cy: number
  radius: number
  slices: PositionedPieSlice[]
  legend: PositionedPieLegendItem[]
  /** Whether numeric values are shown in the legend (`showData`). */
  showData: boolean
  /** Sum of all entry values (for percentage / value formatting). */
  total: number
}
