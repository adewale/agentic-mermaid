// ============================================================================
// Radar (spider / star-plot) chart types
//
// Models Mermaid `radar-beta` diagrams in parsed and positioned form.
//
// Mermaid radar-beta syntax (see mermaid.js.org/syntax/radar.html and
// packages/parser/src/language/radar/radar.langium):
//   radar-beta[:]
//   title <text>
//   axis  id["Label"], id2, …                 (label optional → label = id)
//   curve id["Label"]{v1, v2, …}              (positional, axis order)
//   curve id["Label"]{axisId: v, …}           (keyed, colon optional)
//   max <n>  min <n>  ticks <n>               (body options)
//   graticule circle|polygon                  (rings + curve edge style)
//   showLegend true|false
//
// Axis 0 sits at 12 o'clock; axes proceed clockwise. Values map to a radius
// in [min,max]. `graticule circle` draws circular rings and a smooth
// (Catmull-Rom, tension 0.17) closed curve; `graticule polygon` draws
// polygonal rings and straight polygon curves.
//
// Faithfulness contract (docs/project/lessons-learned.md, Loop 17 ER lesson):
// malformed lines (empty curve, negative numbers, keyed-entry missing an axis,
// degenerate scale) ERROR LOUDLY — never silently dropped.
// ============================================================================

import type { PositionedDiagram } from '../types.ts'
import type { RadarVisualConfig } from './config.ts'

/** A single radial axis (spoke). */
export interface RadarAxis {
  /** Axis identifier (grammar ID; used to resolve keyed curve entries). */
  id: string
  /** Display label. Defaults to `id` when no `["Label"]` was given. */
  label: string
}

/** A single plotted curve (series). Values are in axis-declaration order. */
export interface RadarCurve {
  /** Curve identifier. */
  id: string
  /** Display label. Defaults to `id` when no `["Label"]` was given. */
  label: string
  /** One value per axis, in axis order. Non-negative (grammar has no sign). */
  values: number[]
}

/** Parsed radar chart — logical structure from Mermaid text. */
export interface RadarChart {
  /** Optional diagram title (`title <text>` or frontmatter `title:`). */
  title?: string
  /** Mermaid-universal accessibility metadata. */
  accessibility?: { title?: string; description?: string }
  /** Axes (spokes) in declaration order. */
  axes: RadarAxis[]
  /** Curves (series) in declaration order. */
  curves: RadarCurve[]
  /** Lower scale bound (default 0). */
  min: number
  /** Upper scale bound; undefined = auto (max of all curve values). */
  max?: number
  /** Concentric ring count (default 5; parser-enforced integer range 1..64). */
  ticks: number
  /** Ring + curve-edge style (default 'circle'). */
  graticule: 'circle' | 'polygon'
  /** Whether to draw the legend (default true). */
  showLegend: boolean
}

// ============================================================================
// Positioned radar chart — ready for SVG rendering
// ============================================================================

/** A concentric graticule ring. */
export interface PositionedRadarRing {
  /** Pixel radius from the plot center. */
  r: number
  /** The scale value this ring represents (min + k/ticks·(max−min)). */
  value: number
  /** Polygon vertices for `graticule polygon` (empty for circle rings). */
  points: Array<{ x: number; y: number }>
  /** True for the outermost ring (drawn slightly stronger). */
  emphasized: boolean
}

/** A radial spoke plus its outward axis label. */
export interface PositionedRadarAxis {
  id: string
  /** Spoke endpoint (on the outer ring). */
  x: number
  y: number
  /** Axis label anchor (outside the outer ring). */
  labelX: number
  labelY: number
  anchor: 'start' | 'middle' | 'end'
  /** Wrapped label lines (≥1). */
  lines: string[]
  /** Widest measured label line (px) — the de-collision/knockout footprint. */
  labelWidth: number
  /** Leader line from the outer ring to a label displaced clear of a neighbour
   *  (quadrant-style); present only when the label was relocated. */
  leader?: { x1: number; y1: number; x2: number; y2: number }
}

/** One positioned curve. */
export interface PositionedRadarCurve {
  id: string
  label: string
  /** Palette slot; the renderer resolves the actual color per-theme. */
  colorIndex: number
  /** Closed area path `d` (smooth spline or straight polygon). Empty when the
   *  curve's value count does not match the axis count (Mermaid skips drawing
   *  such curves but still legends them). */
  areaPath: string
  /** Vertex dots (empty when the curve is not drawable). */
  vertices: Array<{ x: number; y: number }>
  /** True when value count ≠ axis count — not drawn, but kept in the legend. */
  arityMismatch: boolean
}

/** Optional ring value label (Agentic extension; off unless `tickLabels`). */
export interface PositionedRadarTickLabel {
  text: string
  x: number
  y: number
  /** Knockout box dimensions (centered on x,y) so the value reads over rings
   *  and translucent silhouettes — the flowchart bordered-label-box discipline. */
  w: number
  h: number
}

export interface PositionedRadarLegendItem {
  label: string
  /** Wrapped legend label lines (≥1) — budget-wrapped with reserved row height. */
  lines: string[]
  colorIndex: number
  x: number
  y: number
  swatchSize: number
  textX: number
  textY: number
}

/** Exact resolved typography shared by layout, public projection, and SVG. */
export interface PositionedRadarTypography {
  axisFontSize: number
  axisFontWeight: number
  legendFontSize: number
  legendFontWeight: number
  titleFontSize: number
  titleFontWeight: number
  tickFontSize: number
  tickFontWeight: number
}

export interface PositionedRadarChart extends PositionedDiagram {
  width: number
  height: number
  /** Plot center. */
  cx: number
  cy: number
  /** Outer radius (data max maps here). */
  radius: number
  title?: { text: string; x: number; y: number; fontSize: number }
  accessibility?: { title?: string; description?: string }
  rings: PositionedRadarRing[]
  axes: PositionedRadarAxis[]
  curves: PositionedRadarCurve[]
  /** Ring value labels (present only when `tickLabels` is enabled). */
  tickLabels: PositionedRadarTickLabel[]
  legend: PositionedRadarLegendItem[]
  /** True when `graticule polygon` (rings are N-gons; curves are straight). */
  polygonGraticule: boolean
  typography: PositionedRadarTypography
  /** Resolved radarChart config the layout used — the renderer reads the SAME
   *  values so paint cannot drift. */
  visual: RadarVisualConfig
}
