import type {
  RadarChart,
  PositionedRadarChart,
  PositionedRadarRing,
  PositionedRadarAxis,
  PositionedRadarCurve,
  PositionedRadarTickLabel,
  PositionedRadarLegendItem,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { RadarVisualConfig } from './config.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { wrapLabelToWidth } from '../shared/label-wrap.ts'
import { resolveRenderStyle, STROKE_WIDTHS } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { radarValueRatio, resolveRadarScale } from './scale.ts'

// ============================================================================
// Radar chart layout engine
//
// Places N equi-angular spokes from a center (axis 0 at 12 o'clock, clockwise),
// concentric graticule rings, one closed area per curve, vertex dots, radial
// axis labels, an optional ring-value scale, and a legend column. Values map to
// a radius in [min,max]; `axisScaleFactor` scales only the drawn spoke length
// (not the rings or data), matching upstream.
//
// `graticule circle` → circular rings + a smooth closed Catmull-Rom curve
// (tension `curveTension`, default 0.17, matching upstream `closedRoundCurve`).
// `graticule polygon` → polygonal rings + straight polygon curves.
//
// All coordinates are direct pixel positions — the renderer never recomputes
// geometry. Deterministic: no randomness, no clock.
// ============================================================================

const R = {
  radius: 120,
  margin: 22,
  titleFontSize: 18,
  titleGap: 16,
  axisFontSize: 12.5,
  /** Gap between the axis-label ring and the measured label box. */
  axisLabelPad: 8,
  /** Max width one axis label may occupy before wrapping to a second line. */
  axisLabelMaxWidth: 96,
  legendFontSize: 13,
  legendSwatch: 14,
  legendGap: 30,
  legendRowGap: 9,
  legendSwatchToText: 8,
  ringLabelFontSize: 9.5,
  dotRadius: 3,
  curveStrokeWidth: 2.2,
} as const

/** Style defaults shared by layout AND renderer so measured text matches
 *  drawn text. Explicit RenderOptions style faces still win. */
export function radarStyleDefaults(visual: RadarVisualConfig = {}): RenderStyleDefaults {
  return {
    nodeLabelFontSize: visual.legendFontSize ?? R.legendFontSize, // legend text
    edgeLabelFontSize: visual.axisLabelFontSize ?? R.axisFontSize, // axis labels
    groupHeaderFontSize: visual.titleFontSize ?? R.titleFontSize, // title
    nodeLabelFontWeight: 500,
    edgeLabelFontWeight: 500,
    groupHeaderFontWeight: 600,
    nodePaddingX: 0,
    nodePaddingY: 0,
    nodeLineWidth: visual.curveStrokeWidth ?? R.curveStrokeWidth,
    edgeLineWidth: visual.axisStrokeWidth ?? 1,
    groupCornerRadius: 0,
    groupPaddingX: 0,
    groupPaddingY: 0,
    groupLineWidth: STROKE_WIDTHS.outerBox,
  }
}

function round(n: number): number { return Math.round(n * 100) / 100 }
function clamp(n: number, min: number, max: number): number { return Math.min(Math.max(n, min), max) }

/** Axis i of n. Angle 0 = 12 o'clock; positive = clockwise (pie convention). */
function axisAngle(i: number, n: number): number { return (2 * Math.PI * i) / n }
function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) }
}

/**
 * Closed curve `d` through `pts`. `graticule polygon` → straight polygon;
 * `graticule circle` → smooth closed Catmull-Rom (tension `t`), the exact
 * conversion upstream's `closedRoundCurve` uses (interpolates THROUGH each
 * vertex, so the dot markers sit on the curve). Family-local path construction
 * — the pie-slice-path analogue — not a shared primitive.
 */
function curvePath(pts: Array<{ x: number; y: number }>, smooth: boolean, t: number): string {
  if (pts.length === 0) return ''
  if (!smooth || pts.length < 3) {
    return 'M ' + pts.map(p => `${round(p.x)} ${round(p.y)}`).join(' L ') + ' Z'
  }
  const n = pts.length
  let d = `M ${round(pts[0]!.x)} ${round(pts[0]!.y)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!
    const c1x = p1.x + (p2.x - p0.x) * t, c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t, c2y = p2.y - (p3.y - p1.y) * t
    d += ` C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2.x)} ${round(p2.y)}`
  }
  return d + ' Z'
}

/**
 * Lay out a parsed radar chart into pixel space.
 * Throws on a degenerate scale (max ≤ min) rather than emitting NaN geometry.
 */
export function layoutRadarChart(
  chart: RadarChart,
  options: RenderOptions = {},
  visual: RadarVisualConfig = {},
  styleFace?: InternalStyleFace,
): PositionedRadarChart {
  const style = resolveRenderStyle(options, radarStyleDefaults(visual), styleFace)
  const n = chart.axes.length

  // Radius from config (min(width,height)/2 minus label gutter) or default.
  let radius: number = R.radius
  if (visual.width !== undefined || visual.height !== undefined) {
    const w = visual.width ?? visual.height ?? R.radius * 2
    const h = visual.height ?? visual.width ?? R.radius * 2
    radius = clamp(Math.min(w, h) / 2 - 56, 40, 400)
  }
  const axisScale = visual.axisScaleFactor ?? 1
  const labelFactor = visual.axisLabelFactor ?? 1.05
  const tension = visual.curveTension ?? 0.17
  const smooth = chart.graticule === 'circle' && tension > 0

  const scaleDomain = resolveRadarScale(chart)
  const { min, max } = scaleDomain
  const scale = (value: number): number => radius * radarValueRatio(value, scaleDomain)

  const axisFont = style.edgeLabelFontSize
  const axisWeight = style.edgeLabelFontWeight
  const titleFont = style.groupHeaderFontSize
  const titleWeight = style.groupHeaderFontWeight

  // Axis labels: wrapped to a width budget (upstream #7683 — long labels wrap
  // instead of clipping). Measure to size the gutters.
  const wrappedAxes = chart.axes.map(a => wrapLabelToWidth(a.label, R.axisLabelMaxWidth, axisFont, axisWeight).split('\n'))
  let maxAxisLines = 1
  let maxAxisLabelWidth = 0
  for (const lines of wrappedAxes) {
    maxAxisLines = Math.max(maxAxisLines, lines.length)
    for (const line of lines) maxAxisLabelWidth = Math.max(maxAxisLabelWidth, measureTextWidth(line, axisFont, axisWeight))
  }
  const axisLabelBlockH = maxAxisLines * axisFont * 1.3

  // Legend metrics (all curves are legended, incl. arity-mismatched ones).
  const legendFont = style.nodeLabelFontSize
  const legendWeight = style.nodeLabelFontWeight
  const wantLegend = chart.showLegend && chart.curves.length > 0
  let legendTextWidth = 0
  if (wantLegend) {
    for (const curve of chart.curves) {
      legendTextWidth = Math.max(legendTextWidth, measureTextWidth(curve.label, legendFont, legendWeight))
    }
  }
  const legendSwatch = visual.legendBoxSize ?? R.legendSwatch
  const legendRowHeight = Math.max(legendSwatch, legendFont)
  const legendWidth = wantLegend ? legendSwatch + R.legendSwatchToText + legendTextWidth : 0
  const legendHeight = wantLegend
    ? chart.curves.length * legendRowHeight + Math.max(0, chart.curves.length - 1) * R.legendRowGap
    : 0

  // Canvas: reserve label gutters around the ring, a title band on top, and a
  // legend column on the right.
  const marginL = visual.marginLeft ?? R.margin
  const marginR = visual.marginRight ?? R.margin
  const marginT = visual.marginTop ?? R.margin
  const marginB = visual.marginBottom ?? R.margin
  const rExt = radius * Math.max(labelFactor, 1, axisScale)
  const sideGutter = maxAxisLabelWidth + R.axisLabelPad
  const vGutter = axisLabelBlockH + R.axisLabelPad
  const titleHeight = chart.title ? titleFont + R.titleGap : 0

  const naturalContentW = 2 * rExt + 2 * sideGutter
  const naturalContentH = 2 * rExt + 2 * vGutter
  // Mermaid's configured frame width/height are independent. Radius still
  // derives from their minimum, while the larger dimension remains reserved
  // as real canvas space rather than being collapsed back to a square.
  const contentW = Math.max(naturalContentW, visual.width ?? 0)
  const contentH = Math.max(naturalContentH, visual.height ?? 0)
  const bodyHeight = Math.max(contentH, legendHeight)
  const legendColW = wantLegend ? R.legendGap + legendWidth : 0

  const baseWidth = marginL + contentW + legendColW + marginR
  const baseCx = marginL + contentW / 2
  const titleWidth = chart.title ? measureTextWidth(chart.title, titleFont, titleWeight) : 0
  const titleLeftExtra = Math.max(0, titleWidth / 2 - baseCx)
  const titleRightExtra = Math.max(0, baseCx + titleWidth / 2 - baseWidth)
  const width = baseWidth + titleLeftExtra + titleRightExtra
  const height = marginT + titleHeight + bodyHeight + marginB
  const cx = baseCx + titleLeftExtra
  const cy = marginT + titleHeight + bodyHeight / 2

  // Rings.
  const rings: PositionedRadarRing[] = []
  for (let k = 1; n > 0 && k <= chart.ticks; k++) {
    const rr = (radius * k) / chart.ticks
    const value = min + ((max - min) * k) / chart.ticks
    const points = chart.graticule === 'polygon'
      ? chart.axes.map((_a, i) => { const p = polar(cx, cy, rr, axisAngle(i, n)); return { x: round(p.x), y: round(p.y) } })
      : []
    rings.push({ r: round(rr), value: round(value), points, emphasized: k === chart.ticks })
  }

  // Spokes + axis labels.
  const axes: PositionedRadarAxis[] = chart.axes.map((axis, i) => {
    const angle = axisAngle(i, n)
    const spoke = polar(cx, cy, radius * axisScale, angle)
    const label = polar(cx, cy, radius * labelFactor + R.axisLabelPad, angle)
    const horiz = Math.sin(angle)
    const anchor: 'start' | 'middle' | 'end' = horiz > 0.3 ? 'start' : horiz < -0.3 ? 'end' : 'middle'
    return {
      id: axis.id,
      x: round(spoke.x),
      y: round(spoke.y),
      labelX: round(label.x),
      labelY: round(label.y),
      anchor,
      lines: wrappedAxes[i]!,
    }
  })

  // Curves.
  const curves: PositionedRadarCurve[] = chart.curves.map((curve, index) => {
    const drawable = curve.values.length === n
    const vertices = drawable
      ? curve.values.map((v, i) => { const p = polar(cx, cy, scale(v), axisAngle(i, n)); return { x: round(p.x), y: round(p.y) } })
      : []
    return {
      id: curve.id,
      label: curve.label,
      colorIndex: index,
      areaPath: drawable ? curvePath(vertices, smooth, tension) : '',
      vertices,
      arityMismatch: !drawable,
    }
  })

  // Ring value labels (Agentic extension) — along the gap ray between axis 0
  // and axis 1 so they never sit on a spoke.
  const tickLabels: PositionedRadarTickLabel[] = []
  if (visual.tickLabels && n > 0) {
    const gapAngle = axisAngle(0, n) + Math.PI / n
    for (const ring of rings) {
      const p = polar(cx, cy, ring.r, gapAngle)
      tickLabels.push({ text: formatTick(ring.value), x: round(p.x), y: round(p.y) })
    }
  }

  // Legend rows (vertical, right of the plot, centered on the plot).
  const legend: PositionedRadarLegendItem[] = []
  if (wantLegend) {
    const legendX = titleLeftExtra + marginL + contentW + R.legendGap
    let rowY = cy - legendHeight / 2
    chart.curves.forEach((curve, index) => {
      legend.push({
        label: curve.label,
        colorIndex: index,
        x: round(legendX),
        y: round(rowY),
        swatchSize: legendSwatch,
        textX: round(legendX + legendSwatch + R.legendSwatchToText),
        textY: round(rowY + legendRowHeight / 2),
      })
      rowY += legendRowHeight + R.legendRowGap
    })
  }

  return {
    width: round(width),
    height: round(height),
    cx: round(cx),
    cy: round(cy),
    radius: round(radius),
    title: chart.title
      ? { text: chart.title, x: round(cx), y: round(marginT + titleFont / 2), fontSize: titleFont }
      : undefined,
    accessibility: chart.accessibility ? { ...chart.accessibility } : undefined,
    rings,
    axes,
    curves,
    tickLabels,
    legend,
    polygonGraticule: chart.graticule === 'polygon',
    typography: {
      axisFontSize: axisFont,
      axisFontWeight: axisWeight,
      legendFontSize: legendFont,
      legendFontWeight: legendWeight,
      titleFontSize: titleFont,
      titleFontWeight: titleWeight,
      tickFontSize: R.ringLabelFontSize,
      tickFontWeight: axisWeight,
    },
    visual,
  }
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

/** Historical layout constants (defaults; config overrides via
 *  radarStyleDefaults / layoutRadarChart). Exported for tests. */
export const RADAR_METRICS = {
  radius: R.radius,
  axisFontSize: R.axisFontSize,
  titleFontSize: R.titleFontSize,
  legendFontSize: R.legendFontSize,
  dotRadius: R.dotRadius,
} as const
