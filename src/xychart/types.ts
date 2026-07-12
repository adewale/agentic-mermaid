// ============================================================================
// XY Chart types
//
// Models the parsed and positioned representations of a Mermaid xychart
// diagram. Supports bar charts, line charts, and combinations with categorical
// or numeric x-axes.
// ============================================================================

import type { PositionedDiagram } from '../types.ts'

/** Parsed XY chart — logical structure from mermaid text */
export interface XYChart {
  /** Optional chart title */
  title?: string
  /** Optional Mermaid accessibility metadata */
  accessibility?: XYChartAccessibility
  /** Chart orientation: vertical (default) or horizontal */
  horizontal: boolean
  /** Source header orientation, when explicitly present. Config cannot override it. */
  headerOrientation?: 'vertical' | 'horizontal'
  /** X-axis configuration */
  xAxis: XYAxis
  /** Y-axis configuration */
  yAxis: XYAxis
  /** Data series (bar and/or line) */
  series: XYChartSeries[]
  /** Mermaid frontmatter-driven chart options */
  config: XYChartConfig
  /** Mermaid frontmatter-driven chart theme overrides */
  theme: XYChartTheme
}

/** Axis configuration — categorical (labels) or numeric (range) */
export interface XYAxis {
  /** Optional axis title/label */
  title?: string
  /** Categorical labels (e.g., ["jan", "feb", "mar"]) — mutually exclusive with range */
  categories?: string[]
  /** Numeric range — mutually exclusive with categories */
  range?: { min: number; max: number }
}

/** A single data series (bar or line) */
export interface XYChartSeries {
  /** Series type */
  type: 'bar' | 'line'
  /** Optional Mermaid series label */
  label?: string
  /** Data values — one per category, or evenly spaced across numeric range. */
  data: number[]
  /** Mermaid 11.16 per-point text labels, index-aligned with data by parser construction. */
  pointLabels?: Array<string | undefined>
}

export interface XYChartAccessibility {
  title?: string
  description?: string
}

export interface XYChartConfig {
  /** Override total chart width in SVG output */
  width?: number
  /** Override total chart height in SVG output */
  height?: number
  /** When true, emit responsive width/height output */
  useMaxWidth?: boolean
  /** Optional explicit rendered width override */
  useWidth?: number
  /** Title font size in px */
  titleFontSize?: number
  /** Title padding in px */
  titlePadding?: number
  /** Orientation from Mermaid config (`vertical` or `horizontal`) */
  chartOrientation?: 'vertical' | 'horizontal'
  /** Reserve this percentage of the chart box for the plot area */
  plotReservedSpacePercent?: number
  /** Show numeric value labels on bars */
  showDataLabel?: boolean
  /** Hide the chart title even when the source defines one */
  showTitle?: boolean
  /** Hide the legend even when the chart is legend-worthy (upstream PR #7724) */
  showLegend?: boolean
  /** Legend label font size in px */
  legendFontSize?: number
  /** Legend padding in px */
  legendPadding?: number
  /** Per-axis visibility controls */
  xAxis?: XYAxisRenderConfig
  /** Per-axis visibility controls */
  yAxis?: XYAxisRenderConfig
}

export interface XYAxisRenderConfig {
  /** Hide axis labels */
  showLabel?: boolean
  /** Axis label font size in px */
  labelFontSize?: number
  /** Axis label padding in px */
  labelPadding?: number
  /** Hide axis title */
  showTitle?: boolean
  /** Axis title font size in px */
  titleFontSize?: number
  /** Axis title padding in px */
  titlePadding?: number
  /** Hide tick marks */
  showTick?: boolean
  /** Tick length in px */
  tickLength?: number
  /** Tick stroke width in px */
  tickWidth?: number
  /** Hide the axis line */
  showAxisLine?: boolean
  /** Axis line stroke width in px */
  axisLineWidth?: number
}

export interface ResolvedXYAxisRenderConfig {
  showLabel: boolean
  labelFontSize: number
  labelPadding: number
  showTitle: boolean
  titleFontSize: number
  titlePadding: number
  showTick: boolean
  tickLength: number
  tickWidth: number
  showAxisLine: boolean
  axisLineWidth: number
}

export interface ResolvedXYChartConfig {
  width: number
  height: number
  useMaxWidth: boolean
  useWidth?: number
  titleFontSize: number
  titlePadding: number
  chartOrientation: 'vertical' | 'horizontal'
  plotReservedSpacePercent: number
  showDataLabel: boolean
  showTitle: boolean
  showLegend: boolean
  legendFontSize: number
  legendPadding: number
  xAxis: ResolvedXYAxisRenderConfig
  yAxis: ResolvedXYAxisRenderConfig
}

export interface XYChartTheme {
  /** Background override from Mermaid theme variables */
  backgroundColor?: string
  /** Raw Mermaid theme CSS appended to the SVG style block */
  themeCss?: string
  /** Chart title color */
  titleColor?: string
  /** X-axis label color */
  xAxisLabelColor?: string
  /** X-axis tick color */
  xAxisTickColor?: string
  /** X-axis line color */
  xAxisLineColor?: string
  /** X-axis title color */
  xAxisTitleColor?: string
  /** Y-axis label color */
  yAxisLabelColor?: string
  /** Y-axis tick color */
  yAxisTickColor?: string
  /** Y-axis line color */
  yAxisLineColor?: string
  /** Y-axis title color */
  yAxisTitleColor?: string
  /** Legend label color (upstream themeVariables.xyChart.legendTextColor) */
  legendTextColor?: string
  /** Explicit per-series palette */
  plotColorPalette?: string[]
}

// ============================================================================
// Positioned XY chart — ready for SVG rendering
// ============================================================================

export interface PositionedXYChart extends PositionedDiagram {
  width: number
  height: number
  accessibility?: XYChartAccessibility
  /** Whether this is a horizontal (rotated) chart */
  horizontal?: boolean
  /** Title text and position (if present) */
  title?: PositionedTitle
  /** Positioned x-axis with tick marks and labels */
  xAxis: PositionedAxis
  /** Positioned y-axis with tick marks and labels */
  yAxis: PositionedAxis
  /** The plot area bounds (inside axes) */
  plotArea: PlotArea
  /** Positioned bar groups */
  bars: PositionedBar[]
  /** Positioned line polylines */
  lines: PositionedLine[]
  /** Horizontal grid lines for readability */
  gridLines: GridLine[]
  /** Legend items (shown when multiple series) */
  legend: LegendItem[]
  /** Resolved config carried through for rendering decisions */
  config: ResolvedXYChartConfig
  /** Mermaid theme variables carried through for rendering decisions */
  theme: XYChartTheme
}

export interface LegendItem {
  /** Display label */
  label: string
  /** Position of the swatch/icon */
  x: number
  y: number
  /** Series type determines swatch shape (rect for bar, line+dot for line) */
  type: 'bar' | 'line'
  /** Series index within its type (for layout grouping) */
  seriesIndex: number
  /** Global color index across all series (for unified color assignment) */
  colorIndex: number
}

export interface PositionedTitle {
  text: string
  x: number
  y: number
}

export interface PositionedAxis {
  /** Optional axis title text and position */
  title?: { text: string; x: number; y: number; rotate?: number }
  /** Tick positions along the axis */
  ticks: AxisTick[]
  /** Axis line: start and end coordinates */
  line: { x1: number; y1: number; x2: number; y2: number }
  /** Resolved axis config used for sizing and rendering */
  config: ResolvedXYAxisRenderConfig
}

export interface AxisTick {
  /** Label text for this tick */
  label: string
  /** Position of the tick mark on the axis */
  x: number
  y: number
  /** End of the tick mark (short perpendicular line) */
  tx: number
  ty: number
  /** Label anchor position */
  labelX: number
  labelY: number
  /** Text anchor for label */
  textAnchor: 'start' | 'middle' | 'end'
}

export interface PlotArea {
  x: number
  y: number
  width: number
  height: number
}

export interface PositionedBar {
  /** Bar rectangle in SVG coordinates */
  x: number
  y: number
  width: number
  height: number
  /** Original data value */
  value: number
  /** Category label for this bar (e.g. "Jan") */
  label?: string
  /** Series index within bar type (for layout grouping) */
  seriesIndex: number
  /** Global color index across all series */
  colorIndex: number
}

export interface PositionedLine {
  /** Polyline points */
  points: Array<{ x: number; y: number; value: number; label?: string; textLabel?: string }>
  /** Series index within line type (for layout grouping) */
  seriesIndex: number
  /** Global color index across all series */
  colorIndex: number
}

export interface GridLine {
  x1: number
  y1: number
  x2: number
  y2: number
}
